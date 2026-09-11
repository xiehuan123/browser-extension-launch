export const MAX_NOTE_LENGTH = 10000;
const PREFIX = "page-note:v1:";

export class NotesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NotesError";
    this.code = code;
  }
}

export function normalizePageUrl(raw) {
  if (typeof raw !== "string" || !raw) {
    throw new NotesError("unavailable", "还没获得这个网页的网址。请回到网页，再点工具栏里的便签图标。");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new NotesError("unsupported", "这个网址暂时无法使用便签。请打开普通网页后再试。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new NotesError("unsupported", "便签仅支持普通网页；浏览器设置页、新标签页和本地文件暂不支持。");
  }
  if (url.username || url.password) {
    throw new NotesError("unsupported", "这个网址含有登录信息，暂不保存。请使用不含登录信息的网址。");
  }
  // Keep query parameters and their order: they may identify different content.
  url.hash = "";
  return url.href;
}

function sessionFromTab(tab) {
  const url = normalizePageUrl(tab?.url);
  if (!Number.isInteger(tab.id) || tab.id < 0 || !Number.isInteger(tab.windowId)) {
    throw new NotesError("unavailable", "暂时无法确定当前网页，请关闭便签后重新打开。");
  }
  if (tab.status === "loading" || tab.pendingUrl) {
    throw new NotesError("loading", "网页还在跳转，请等它打开后重新点便签图标。");
  }
  return Object.freeze({
    tabId: tab.id,
    windowId: tab.windowId,
    url,
    title: typeof tab.title === "string" ? tab.title.slice(0, 1000) : new URL(url).hostname,
    key: PREFIX + url,
  });
}

export class PageNotes {
  constructor(api, now = () => new Date().toISOString()) {
    this.api = api;
    this.now = now;
    this.session = null;
    this.invalidated = false;
  }

  invalidate() {
    this.invalidated = true;
  }

  async activeTab() {
    const tabs = await this.api.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  async assertCurrent(session) {
    const stale = () => new NotesError("stale", "网页已切换或正在跳转。请先复制要保留的文字，再关闭便签并从目标网页重新打开。");
    if (!session || this.session !== session || this.invalidated) throw stale();
    let current;
    try {
      current = sessionFromTab(await this.activeTab());
    } catch {
      this.invalidate();
      throw stale();
    }
    if (this.invalidated || current.tabId !== session.tabId || current.windowId !== session.windowId || current.url !== session.url) {
      this.invalidate();
      throw stale();
    }
  }

  async open() {
    const session = sessionFromTab(await this.activeTab());
    this.session = session;
    this.invalidated = false;
    const result = await this.api.storage.local.get(session.key);
    // A delayed storage response must never load a note into a different page.
    await this.assertCurrent(session);
    const record = result[session.key];
    if (record === undefined) return { session, note: null };
    if (!record || typeof record !== "object" || record.url !== session.url || typeof record.text !== "string" || record.text.length > MAX_NOTE_LENGTH) {
      throw new NotesError("invalid-record", "这页的旧记录格式不正确，暂未覆盖。请保留记录并联系制作者处理。");
    }
    return { session, note: record };
  }

  async save(session, text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new NotesError("empty", "先写一点内容，再保存。要删掉已保存的便签，请点“删除本页便签”。");
    }
    if (text.length > MAX_NOTE_LENGTH) {
      throw new NotesError("too-long", "便签最多 10000 个字符，请缩短后再保存。");
    }
    await this.assertCurrent(session);
    const record = { url: session.url, title: session.title, text, updatedAt: this.now() };
    // The destination is immutable even if navigation begins during this write.
    await this.api.storage.local.set({ [session.key]: record });
    return record;
  }

  async remove(session) {
    await this.assertCurrent(session);
    await this.api.storage.local.remove(session.key);
  }
}
