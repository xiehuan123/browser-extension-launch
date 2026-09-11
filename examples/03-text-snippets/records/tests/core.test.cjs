const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
globalThis.crypto ??= webcrypto;
require("../../extension/core.js");
const core = globalThis.TextSnippets;

function fakeStorage(initial = {}) {
  let value = structuredClone(initial);
  return {
    failRead: false, failWrite: false, writes: 0,
    async get() { if (this.failRead) throw new Error("read unavailable"); return structuredClone(value); },
    async set(next) { if (this.failWrite) throw new Error("quota exceeded"); this.writes++; value = structuredClone(next); },
    get value() { return structuredClone(value); }
  };
}
const snippet = () => core.createSnippet("收件提醒", "你好，文件已收到。\n我会尽快回复。");

test("creation trims outer whitespace but preserves internal line breaks", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(core.createSnippet(" 提醒 ", " 第一行\n第二行 ")).filter(([key]) => key !== "id")), { title: "提醒", text: "第一行\n第二行" });
});
test("blank and oversized titles are rejected", () => {
  assert.throws(() => core.createSnippet("  ", "正文"), /标题/);
  assert.throws(() => core.createSnippet("字".repeat(81), "正文"), /80/);
});
test("blank and oversized body text is rejected", () => {
  assert.throws(() => core.createSnippet("标题", " \n "), /正文/);
  assert.throws(() => core.createSnippet("标题", "字".repeat(5001)), /5000/);
});
test("search matches title or body with Chinese and case-insensitive English", () => {
  const a = snippet();
  const b = core.createSnippet("Meeting", "Hello Team");
  assert.deepEqual(core.search([a, b], " 收件 "), [a]);
  assert.deepEqual(core.search([a, b], "尽快"), [a]);
  assert.deepEqual(core.search([a, b], "HELLO"), [b]);
  assert.deepEqual(core.search([a, b], "meeting"), [b]);
});
test("empty search shows all items; unmatched search shows none", () => {
  const items = [snippet()];
  assert.deepEqual(core.search(items, "  "), items);
  assert.deepEqual(core.search(items, "不存在"), []);
});
test("fresh storage loads an empty collection", async () => {
  assert.deepEqual(await core.createStore(fakeStorage()).load(), []);
});
test("save, reopen and delete preserve the intended data", async () => {
  const storage = fakeStorage();
  const store = core.createStore(storage);
  await store.load();
  const item = snippet();
  await store.save([item]);
  const reopened = core.createStore(storage);
  assert.deepEqual(await reopened.load(), [item]);
  await reopened.save([]);
  assert.deepEqual(await core.createStore(storage).load(), []);
});
test("a failed write leaves previous in-memory and stored data unchanged", async () => {
  const storage = fakeStorage();
  const store = core.createStore(storage);
  await store.load();
  const item = snippet();
  await store.save([item]);
  storage.failWrite = true;
  await assert.rejects(store.save([]), /quota/);
  assert.deepEqual(store.items, [item]);
  assert.deepEqual(storage.value[core.STORAGE_KEY], [item]);
});
test("read failure prevents writing over unread data", async () => {
  const storage = fakeStorage(); storage.failRead = true;
  const store = core.createStore(storage);
  await assert.rejects(store.load(), /read/);
  await assert.rejects(store.save([]), /读取/);
  assert.equal(storage.writes, 0);
});
test("corrupt records and duplicate IDs are rejected without clearing storage", async () => {
  const item = snippet();
  const storage = fakeStorage({ [core.STORAGE_KEY]: [item, item] });
  await assert.rejects(core.createStore(storage).load(), /无法识别/);
  assert.equal(storage.writes, 0);
  assert.throws(() => core.validate([{ ...item, text: 123 }]), /无法识别/);
});
test("200-item storage limit is enforced", () => {
  assert.throws(() => core.validate(Array.from({ length: 201 }, snippet)), /无法识别/);
});
test("callers cannot mutate confirmed state through the items getter", async () => {
  const store = core.createStore(fakeStorage());
  await store.load(); await store.save([snippet()]);
  store.items[0].text = "overwritten";
  assert.notEqual(store.items[0].text, "overwritten");
});
test("copy sends only body text, preserving newlines and literal HTML", async () => {
  const item = core.createSnippet("标题不复制", "<img src=x onerror=alert(1)>\n第二行");
  let copied;
  await core.copySnippet(item, { writeText: async (text) => { copied = text; } });
  assert.equal(copied, item.text);
  assert.equal(copied.includes("标题不复制"), false);
});
test("clipboard failure propagates and never changes stored text", async () => {
  const item = snippet();
  const original = item.text;
  await assert.rejects(core.copySnippet(item, { writeText: async () => { throw new Error("clipboard denied"); } }), /clipboard/);
  assert.equal(item.text, original);
});
