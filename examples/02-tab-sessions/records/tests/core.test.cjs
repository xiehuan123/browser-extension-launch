const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
globalThis.crypto ??= webcrypto;
require("../../extension/core.js");
const core = globalThis.TabSessions;

function fakeStorage(initial = {}) {
  let value = structuredClone(initial);
  return {
    failRead: false, failWrite: false, writes: 0,
    async get() { if (this.failRead) throw new Error("read unavailable"); return structuredClone(value); },
    async set(next) { if (this.failWrite) throw new Error("quota exceeded"); this.writes++; value = structuredClone(next); },
    get value() { return structuredClone(value); }
  };
}
const session = () => core.createSession("旅行", [{ title: "旅游攻略", url: "https://example.com/trip?q=周末#list" }]);

test("snapshot keeps ordered http(s) pages and skips unsupported or missing URLs", () => {
  const result = core.collectTabs([
    { title: "甲", url: "https://example.com/a" },
    { title: "内部", url: "chrome://settings" },
    { title: "乙", url: "http://example.org/b" },
    { url: "file:///tmp/test.html" }, { url: "about:blank" },
    { url: "javascript:alert(1)" }, {}, { url: "chrome-extension://id/popup.html" }
  ]);
  assert.equal(result.skipped, 6);
  assert.deepEqual(result.pages.map((page) => page.title), ["甲", "乙"]);
});
test("snapshot keeps duplicates and falls back to URL for blank titles", () => {
  const result = core.collectTabs([{ url: "https://example.com", title: " " }, { url: "https://example.com" }]);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].title, "https://example.com");
});
test("snapshot rejects credential-bearing URLs and non-Web URLs", () => {
  for (const url of ["https://user:secret@example.com", "data:text/plain,test", "not a url", null]) {
    assert.equal(core.isWebUrl(url), false);
  }
});
test("snapshot rejects a window without supported pages", () => {
  assert.throws(() => core.collectTabs([{ url: "chrome://newtab" }]), /没有可保存/);
});
test("snapshot refuses over 200 pages instead of silently truncating", () => {
  assert.throws(() => core.collectTabs(Array.from({ length: 201 }, () => ({ url: "https://example.com" }))), /200/);
});
test("session names are trimmed and invalid names rejected", () => {
  assert.equal(core.createSession("  旅行  ", session().tabs).name, "旅行");
  assert.throws(() => core.createSession("   ", session().tabs), /名字/);
  assert.throws(() => core.createSession("字".repeat(61), session().tabs), /60/);
});
test("fresh storage starts with no sessions", async () => {
  const store = core.createStore(fakeStorage());
  assert.deepEqual(await store.load(), []);
});
test("save and reload round-trip, and delete persists", async () => {
  const storage = fakeStorage();
  const store = core.createStore(storage);
  await store.load();
  const value = session();
  await store.save([value]);
  const reopened = core.createStore(storage);
  assert.deepEqual(await reopened.load(), [value]);
  await reopened.save([]);
  assert.deepEqual(await core.createStore(storage).load(), []);
});
test("write failure preserves last confirmed state", async () => {
  const storage = fakeStorage();
  const store = core.createStore(storage);
  await store.load();
  const value = session();
  await store.save([value]);
  storage.failWrite = true;
  await assert.rejects(store.save([]), /quota/);
  assert.deepEqual(store.items, [value]);
  assert.deepEqual(storage.value[core.STORAGE_KEY], [value]);
});
test("read failure propagates without making any write", async () => {
  const storage = fakeStorage(); storage.failRead = true;
  const store = core.createStore(storage);
  await assert.rejects(store.load(), /read/);
  await assert.rejects(store.save([]), /读取/);
  assert.equal(storage.writes, 0);
});
test("corrupt storage and duplicate IDs are rejected without clearing data", async () => {
  const a = session();
  const storage = fakeStorage({ [core.STORAGE_KEY]: [a, a] });
  await assert.rejects(core.createStore(storage).load(), /无法识别/);
  assert.equal(storage.writes, 0);
  assert.throws(() => core.validate([{ ...a, tabs: [{ title: "bad", url: "javascript:alert(1)" }] }]), /无法识别/);
});
test("30-session limit is enforced", () => {
  assert.throws(() => core.validate(Array.from({ length: 31 }, session)), /无法识别/);
});
test("callers cannot mutate stored memory through the public items getter", async () => {
  const store = core.createStore(fakeStorage());
  await store.load(); await store.save([session()]);
  store.items[0].tabs[0].url = "javascript:alert(1)";
  assert.equal(store.items[0].tabs[0].url.startsWith("https:"), true);
});
test("restore opens saved URLs as inactive new tabs without closing existing ones", async () => {
  const calls = [];
  const value = session();
  const result = await core.restoreSession(value, { create: async (options) => { calls.push(options); return { id: 5 }; } });
  assert.deepEqual(calls, [{ url: value.tabs[0].url, active: false }]);
  assert.deepEqual(result, { opened: 1, failed: 0 });
});
test("partial restore failure is counted; it does not erase saved pages", async () => {
  const value = core.createSession("两页", [{ title: "one", url: "https://example.com/1" }, { title: "two", url: "https://example.com/2" }]);
  let calls = 0;
  const result = await core.restoreSession(value, { create: async () => { if (++calls === 1) throw new Error("blocked"); return { id: 2 }; } });
  assert.deepEqual(result, { opened: 1, failed: 1 });
  assert.equal(value.tabs.length, 2);
});
test("restore validates malicious URLs before making any browser call", async () => {
  let calls = 0;
  await assert.rejects(core.restoreSession({ ...session(), tabs: [{ title: "bad", url: "javascript:alert(1)" }] }, { create: async () => { calls++; } }), /无法识别/);
  assert.equal(calls, 0);
});
