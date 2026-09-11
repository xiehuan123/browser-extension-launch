"use strict";
importScripts("timer-model.js");

const STORAGE_KEY = "focusTimerV1";
const ALARM_NAME = "focus-timer-deadline";
let queue = Promise.resolve();

// Every event joins this queue; only this worker writes the timer state.
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

async function alignReminder(state) {
  const warnings = [];
  try {
    if (state.status === "running") {
      const alarm = await chrome.alarms.get(ALARM_NAME);
      if (!alarm || alarm.scheduledTime !== state.deadline) {
        await chrome.alarms.create(ALARM_NAME, {when: state.deadline});
      }
    } else {
      await chrome.alarms.clear(ALARM_NAME);
    }
  } catch {
    warnings.push("计时已保存，但到时提醒暂时无法设置；请点“刷新状态”重试。");
  }
  try {
    const text = {idle: "", running: "ON", paused: "Ⅱ", completed: "✓"}[state.status];
    await chrome.action.setBadgeBackgroundColor({color: state.status === "completed" ? "#237A56" : "#A45026"});
    await chrome.action.setBadgeText({text});
    await chrome.action.setTitle({title: {
      idle: "专注一会儿", running: "专注计时中", paused: "专注计时已暂停", completed: "时间到了，休息一会儿"
    }[state.status]});
  } catch {
    warnings.push("计时已保存，但工具栏标记未更新；请点“刷新状态”重试。");
  }
  return warnings.join(" ");
}

async function processCommand(command) {
  let data;
  try {
    data = await chrome.storage.local.get(STORAGE_KEY);
  } catch {
    throw new Error("暂时读不到计时记录，请点“刷新状态”重试。");
  }
  const stored = data[STORAGE_KEY];
  let previous = stored ?? TimerModel.initial();
  if (!TimerModel.valid(previous)) {
    if (command.type === "reset") previous = TimerModel.initial();
    else throw new Error("计时记录格式有误。可点击“重置”恢复默认计时。");
  }
  const state = TimerModel.transition(previous, command, Date.now());
  if (JSON.stringify(state) !== JSON.stringify(stored)) {
    try {
      await chrome.storage.local.set({[STORAGE_KEY]: state});
    } catch {
      throw new Error("这次操作没有保存，请点“刷新状态”查看原计时，再重试。");
    }
  }
  return {state, warning: await alignReminder(state)};
}

function refreshInBackground() {
  return enqueue(() => processCommand({type: "get"})).catch(async (error) => {
    console.error("专注计时恢复失败", error.message);
    try { await chrome.action.setBadgeText({text: "!"}); } catch { /* Opening popup offers retry. */ }
  });
}

// Register listeners synchronously so a waking worker can receive its triggering event.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) {
    sendResponse({ok: false, error: "这个操作来源不受支持。"});
    return false;
  }
  if (!message || typeof message !== "object" || message.channel !== "focus-timer") {
    sendResponse({ok: false, error: "无法识别这个操作。"});
    return false;
  }
  enqueue(() => processCommand(message)).then(
    (result) => sendResponse({ok: true, ...result}),
    (error) => sendResponse({ok: false, error: error.message})
  );
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshInBackground();
});
chrome.runtime.onInstalled.addListener(refreshInBackground);
chrome.runtime.onStartup.addListener(refreshInBackground);

// Alarms may be absent after restart; persisted deadline is the source of truth.
refreshInBackground();
