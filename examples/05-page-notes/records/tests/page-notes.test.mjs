import test from "node:test";
import assert from "node:assert/strict";
import { PageNotes, normalizePageUrl } from "../../extension/notes.mjs";

const firstTab = () => ({ id: 7, windowId: 1, url: "https://example.test/article?id=1#intro", title: "一篇文章", status: "complete" });

function fixture() {
  let tab = firstTab();
  const data = {};
  const writes = [];
  const removals = [];
  const api = {
    tabs: { query: async () => tab ? [{ ...tab }] : [] },
    storage: { local: {
      get: async (key) => ({ [key]: data[key] }),
      set: async (values) => { writes.push(values); Object.assign(data, values); },
      remove: async (key) => { removals.push(key); delete data[key]; },
    } },
  };
  return { api, data, writes, removals, setTab: (value) => { tab = value; }, service: new PageNotes(api, () => "2026-09-11T00:00:00.000Z") };
}

test("网址键保留查询参数及顺序，去掉 fragment", () => {
  assert.equal(normalizePageUrl("https://Example.test:443/a?b=2&a=1#section"), "https://example.test/a?b=2&a=1");
  assert.notEqual(normalizePageUrl("https://example.test/a?id=1"), normalizePageUrl("https://example.test/a?id=2"));
  assert.equal(normalizePageUrl("https://example.test/a#first"), normalizePageUrl("https://example.test/a#last"));
});

test("拒绝缺失网址、内部页、本地文件和带登录信息的网址", () => {
  for (const url of [undefined, "", "chrome://extensions", "about:blank", "file:///a", "javascript:alert(1)", "not a url", "https://user:pass@example.test"]) {
    assert.throws(() => normalizePageUrl(url));
  }
});

test("保存后重新打开同一网址读回原文，包括空格换行和 HTML 文本", async () => {
  const f = fixture();
  const { session, note } = await f.service.open();
  assert.equal(note, null);
  const text = "  第一行\n<script>alert('保持文本')</script>  ";
  await f.service.save(session, text);
  const reopened = new PageNotes(f.api);
  assert.equal((await reopened.open()).note.text, text);
  assert.equal(f.writes[0][session.key].url, "https://example.test/article?id=1");
});

test("不同 query 的网页便签相互独立", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  await f.service.save(session, "第一篇");
  f.setTab({ ...firstTab(), url: "https://example.test/article?id=2" });
  const result = await new PageNotes(f.api).open();
  assert.equal(result.note, null);
});

test("仅 fragment 变化仍保存到原来的同页键", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  f.setTab({ ...firstTab(), url: "https://example.test/article?id=1#last" });
  await f.service.save(session, "同一页");
  assert.equal(Object.keys(f.writes[0])[0], session.key);
});

test("未获网址读取能力时不加载、不写入便签", async () => {
  const f = fixture();
  f.setTab({ id: 7, windowId: 1, status: "complete" });
  await assert.rejects(f.service.open(), { code: "unavailable" });
  await assert.rejects(f.service.save(null, "不能写入"), { code: "stale" });
  assert.equal(f.writes.length, 0);
});

test("打开时网页正在加载或有待提交导航会拒绝绑定", async () => {
  for (const extra of [{ status: "loading" }, { pendingUrl: "https://elsewhere.test" }]) {
    const f = fixture();
    f.setTab({ ...firstTab(), ...extra });
    await assert.rejects(f.service.open(), { code: "loading" });
  }
});

test("储存读取期间切换页面，不把延迟返回的旧便签交给新页面", async () => {
  const f = fixture();
  f.api.storage.local.get = async () => {
    f.setTab({ ...firstTab(), url: "https://example.test/other" });
    return {};
  };
  await assert.rejects(f.service.open(), { code: "stale" });
  assert.equal(f.writes.length, 0);
});

test("保存前检测换标签、换窗口、换网址、导航中和权限丢失，均不写入", async () => {
  const variants = [
    { ...firstTab(), id: 8 },
    { ...firstTab(), windowId: 2 },
    { ...firstTab(), url: "https://example.test/article?id=2" },
    { ...firstTab(), status: "loading" },
    { ...firstTab(), pendingUrl: "https://elsewhere.test" },
    { id: 7, windowId: 1, status: "complete" },
    null,
  ];
  for (const tab of variants) {
    const f = fixture();
    const { session } = await f.service.open();
    f.setTab(tab);
    await assert.rejects(f.service.save(session, "旧页文字"), { code: "stale" });
    assert.equal(f.writes.length, 0);
  }
});

test("导航事件使旧会话永久失效，即使之后网址相同", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  f.service.invalidate();
  await assert.rejects(f.service.save(session, "旧页文字"), { code: "stale" });
  await assert.rejects(f.service.remove(session), { code: "stale" });
  assert.equal(f.writes.length + f.removals.length, 0);
});

test("状态核验等待期间发生失效，不会写入", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  f.api.tabs.query = async () => {
    f.service.invalidate();
    return [firstTab()];
  };
  await assert.rejects(f.service.save(session, "旧页文字"), { code: "stale" });
  assert.equal(f.writes.length, 0);
});

test("即使保存调用开始后页面才变化，写入键仍固定为打开时的旧页", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  f.api.storage.local.set = async (values) => {
    f.setTab({ ...firstTab(), url: "https://example.test/new" });
    f.service.invalidate();
    f.writes.push(values);
  };
  await f.service.save(session, "原页的文字");
  assert.deepEqual(Object.keys(f.writes[0]), [session.key]);
  assert.equal(f.writes[0][session.key].url, session.url);
});

test("伪造或复制的会话对象不得写入", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  await assert.rejects(f.service.save({ ...session, key: "wrong-key" }, "文字"), { code: "stale" });
  assert.equal(f.writes.length, 0);
});

test("空内容、超长内容不覆盖旧便签", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  await f.service.save(session, "保留");
  await assert.rejects(f.service.save(session, " \n "), { code: "empty" });
  await assert.rejects(f.service.save(session, "字".repeat(10001)), { code: "too-long" });
  assert.equal(f.data[session.key].text, "保留");
  assert.equal(f.writes.length, 1);
});

test("删除仅作用于当前页，切页后的删除被拦截", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  await f.service.save(session, "待删");
  f.data["unrelated"] = { text: "保留" };
  await f.service.remove(session);
  assert.equal(f.data[session.key], undefined);
  assert.deepEqual(f.data.unrelated, { text: "保留" });
  f.setTab({ ...firstTab(), url: "https://example.test/new" });
  await assert.rejects(f.service.remove(session), { code: "stale" });
  assert.equal(f.removals.length, 1);
});

test("错误格式的旧记录不会被当成空便签覆盖", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  f.data[session.key] = { url: session.url, text: 42 };
  await assert.rejects(new PageNotes(f.api).open(), { code: "invalid-record" });
  assert.equal(f.writes.length, 0);
});

test("储存失败会传递错误，不伪造保存成功", async () => {
  const f = fixture();
  const { session } = await f.service.open();
  f.api.storage.local.set = async () => { throw new Error("QUOTA_BYTES quota exceeded"); };
  await assert.rejects(f.service.save(session, "文字"), /quota exceeded/);
  assert.equal(f.data[session.key], undefined);
});
