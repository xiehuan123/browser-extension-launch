"use strict";
// Logic-layer tests of the actual worker source. Chrome APIs and time are mocked.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const extension = path.resolve(__dirname, "../../extension");
const KEY = "focusTimerV1";
const ALARM = "focus-timer-deadline";
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function event() {
  return {listeners: [], addListener(listener) { this.listeners.push(listener); }};
}
function createWorker(existingWorld) {
  const world = existingWorld || {
    now: 1710000000000, data: {}, alarms: new Map(), badge: "", alarmCreates: 0,
    failSet: 0, failGet: 0, failAlarm: 0, logs: []
  };
  const chrome = {
    runtime: {
      id: "timer-test", getURL: (file) => `chrome-extension://timer-test/${file}`,
      onMessage: event(), onInstalled: event(), onStartup: event()
    },
    storage: {local: {
      async get(key) {
        if (world.failGet > 0) { world.failGet--; throw new Error("Mock read failure"); }
        return {[key]: copy(world.data[key])};
      },
      async set(values) {
        if (world.failSet > 0) { world.failSet--; throw new Error("Mock write failure"); }
        Object.assign(world.data, copy(values));
      }
    }},
    alarms: {
      onAlarm: event(), async get(name) { return copy(world.alarms.get(name)); },
      async clear(name) { return world.alarms.delete(name); },
      async create(name, {when}) {
        if (world.failAlarm > 0) { world.failAlarm--; throw new Error("Mock alarm failure"); }
        world.alarmCreates++;
        world.alarms.set(name, {name, scheduledTime: when});
      }
    },
    action: {
      async setBadgeText({text}) { world.badge = text; },
      async setBadgeBackgroundColor() {}, async setTitle({title}) { world.title = title; }
    }
  };
  class ClockDate extends Date { static now() { return world.now; } }
  const context = vm.createContext({chrome, Date: ClockDate, console: {
    error: (...items) => world.logs.push(items.join(" "))
  }});
  context.importScripts = (file) => vm.runInContext(fs.readFileSync(path.join(extension, file), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(extension, "worker.js"), "utf8"), context);
  async function request(type, extra = {}, sender = {id: "timer-test", url: chrome.runtime.getURL("popup.html")}) {
    return new Promise((resolve) => {
      chrome.runtime.onMessage.listeners[0]({channel: "focus-timer", type, ...extra}, sender, (value) => resolve(copy(value)));
    });
  }
  async function flush() { await vm.runInContext("queue", context); }
  async function fire(name = ALARM) {
    world.alarms.delete(name);
    chrome.alarms.onAlarm.listeners.forEach((fn) => fn({name}));
    await flush();
  }
  return {world, chrome, request, flush, fire};
}

test("首次打开默认为 25 分钟，仅创建本地空闲状态", async () => {
  const worker = createWorker();
  const reply = await worker.request("get");
  assert.equal(reply.ok, true);
  assert.equal(reply.state.durationMinutes, 25);
  assert.equal(reply.state.status, "idle");
  assert.equal(reply.state.remainingMs, 1500000);
  assert.equal(worker.world.alarms.size, 0);
});

test("选择 5 分钟并发双击开始只保留一个截止时间和闹钟", async () => {
  const worker = createWorker();
  await worker.request("duration", {minutes: 5});
  const replies = await Promise.all([worker.request("start"), worker.request("start")]);
  assert.equal(replies[0].state.deadline, worker.world.now + 300000);
  assert.equal(replies[1].state.deadline, replies[0].state.deadline);
  assert.equal(worker.world.alarmCreates, 1);
});

test("关闭窗口的模拟时间流逝不会延长截止时间", async () => {
  const worker = createWorker();
  const started = await worker.request("start");
  worker.world.now += 61000;
  const reopened = await worker.request("get");
  assert.equal(reopened.state.deadline, started.state.deadline);
  assert.equal(reopened.state.deadline - worker.world.now, 1439000);
});

test("暂停保存精确余时、取消闹钟，继续从余时恢复", async () => {
  const worker = createWorker();
  await worker.request("duration", {minutes: 5});
  await worker.request("start");
  worker.world.now += 60250;
  const paused = await worker.request("pause");
  assert.equal(paused.state.status, "paused");
  assert.equal(paused.state.remainingMs, 239750);
  assert.equal(worker.world.alarms.has(ALARM), false);
  worker.world.now += 1800000;
  const resumed = await worker.request("resume");
  assert.equal(resumed.state.deadline, worker.world.now + 239750);
  assert.equal(worker.world.alarms.get(ALARM).scheduledTime, resumed.state.deadline);
});

test("暂停时重复开始或继续不覆盖已经在跑的截止时间", async () => {
  const worker = createWorker();
  await worker.request("start");
  worker.world.now += 1000;
  const paused = await worker.request("pause");
  const repeated = await worker.request("start");
  assert.deepEqual(repeated.state, paused.state);
  const first = await worker.request("resume");
  worker.world.now += 1000;
  const second = await worker.request("resume");
  assert.equal(second.state.deadline, first.state.deadline);
});

test("重置保留所选时长，清除闹钟和标记", async () => {
  const worker = createWorker();
  await worker.request("duration", {minutes: 15});
  await worker.request("start");
  worker.world.now += 5000;
  const reset = await worker.request("reset");
  assert.equal(reset.state.status, "idle");
  assert.equal(reset.state.durationMinutes, 15);
  assert.equal(reset.state.remainingMs, 900000);
  assert.equal(worker.world.alarms.has(ALARM), false);
  assert.equal(worker.world.badge, "");
});

test("闹钟到期完成计时并写入 ✓，不自动开启下一轮", async () => {
  const worker = createWorker();
  const started = await worker.request("start");
  worker.world.now = started.state.deadline;
  await worker.fire();
  assert.equal(worker.world.data[KEY].status, "completed");
  assert.equal(worker.world.data[KEY].remainingMs, 0);
  assert.equal(worker.world.badge, "✓");
  assert.equal(worker.world.alarms.size, 0);
});

test("到期后再按暂停不能把已经结束的计时变成可继续", async () => {
  const worker = createWorker();
  const started = await worker.request("start");
  worker.world.now = started.state.deadline + 200;
  const paused = await worker.request("pause");
  assert.equal(paused.state.status, "completed");
  const resumed = await worker.request("resume");
  assert.equal(resumed.state.status, "completed");
});

test("模拟 worker 重启且闹钟丢失，从本地截止时间重建", async () => {
  const original = createWorker();
  const started = await original.request("start");
  original.world.now += 30000;
  original.world.alarms.clear();
  const restarted = createWorker(original.world);
  await restarted.flush();
  assert.equal(restarted.world.data[KEY].deadline, started.state.deadline);
  assert.equal(restarted.world.alarms.get(ALARM).scheduledTime, started.state.deadline);
});

test("模拟睡眠跨过截止时间，worker 恢复后直接完成", async () => {
  const original = createWorker();
  const started = await original.request("start");
  original.world.now = started.state.deadline + 3600000;
  original.world.alarms.clear();
  const restarted = createWorker(original.world);
  await restarted.flush();
  assert.equal(restarted.world.data[KEY].status, "completed");
  assert.equal(restarted.world.badge, "✓");
});

test("已暂停的计时恢复后仍暂停，迟到的旧闹钟不会完成它", async () => {
  const original = createWorker();
  await original.request("start");
  original.world.now += 10000;
  const paused = await original.request("pause");
  original.world.now += 2000000;
  const restarted = createWorker(original.world);
  await restarted.fire();
  assert.deepEqual(restarted.world.data[KEY], paused.state);
  assert.equal(restarted.world.badge, "Ⅱ");
});

test("闹钟过早到达时重新按原截止时间安排，不提前完成", async () => {
  const worker = createWorker();
  const started = await worker.request("start");
  worker.world.now += 10000;
  await worker.fire();
  assert.equal(worker.world.data[KEY].status, "running");
  assert.equal(worker.world.alarms.get(ALARM).scheduledTime, started.state.deadline);
});

test("写入失败保留原状态并提示，后续消息队列仍能成功", async () => {
  const worker = createWorker();
  await worker.request("get");
  worker.world.failSet = 1;
  const failed = await worker.request("start");
  assert.equal(failed.ok, false);
  assert.match(failed.error, /没有保存/);
  assert.equal(worker.world.data[KEY].status, "idle");
  assert.equal(worker.world.alarms.size, 0);
  assert.equal((await worker.request("start")).state.status, "running");
});

test("闹钟设置失败显示警告，刷新可修复且不重新计时", async () => {
  const worker = createWorker();
  await worker.request("get");
  worker.world.failAlarm = 1;
  const started = await worker.request("start");
  assert.equal(started.ok, true);
  assert.match(started.warning, /提醒暂时无法设置/);
  worker.world.now += 1000;
  const refreshed = await worker.request("get");
  assert.equal(refreshed.warning, "");
  assert.equal(refreshed.state.deadline, started.state.deadline);
  assert.equal(worker.world.alarms.get(ALARM).scheduledTime, started.state.deadline);
});

test("外部来源、非法时长及计时中修改时长均被拒绝", async () => {
  const worker = createWorker();
  await worker.request("get");
  const outsider = await worker.request("start", {}, {id: "other", url: "https://example.org/"});
  assert.equal(outsider.ok, false);
  assert.equal((await worker.request("duration", {minutes: 0})).ok, false);
  await worker.request("start");
  const rejected = await worker.request("duration", {minutes: 15});
  assert.equal(rejected.ok, false);
  assert.equal(worker.world.data[KEY].durationMinutes, 25);
});

test("损坏记录不会静默清除，用户重置后可恢复", async () => {
  const worker = createWorker();
  await worker.request("get");
  worker.world.data[KEY] = {schemaVersion: "broken"};
  const failed = await worker.request("get");
  assert.equal(failed.ok, false);
  assert.deepEqual(worker.world.data[KEY], {schemaVersion: "broken"});
  assert.equal((await worker.request("reset")).state.status, "idle");
});

test("读取失败返回错误但后续刷新恢复，不覆盖原计时", async () => {
  const worker = createWorker();
  const started = await worker.request("start");
  worker.world.failGet = 1;
  assert.equal((await worker.request("get")).ok, false);
  const restored = await worker.request("get");
  assert.equal(restored.state.deadline, started.state.deadline);
});
