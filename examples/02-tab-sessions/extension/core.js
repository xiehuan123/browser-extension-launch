"use strict";

globalThis.TabSessions = (() => {
  const STORAGE_KEY = "tabSessionsV1";
  const MAX_SESSIONS = 30;
  const MAX_TABS = 200;

  function isWebUrl(value) {
    if (typeof value !== "string" || value.length > 16384) return false;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function collectTabs(tabs) {
    const pages = tabs.filter((tab) => tab && isWebUrl(tab.url)).map((tab) => ({
      title: (typeof tab.title === "string" && tab.title.trim() ? tab.title : tab.url).slice(0, 300),
      url: tab.url
    }));
    if (!pages.length) throw new Error("这个窗口还没有可保存的网页。请先打开普通网站。");
    if (pages.length > MAX_TABS) throw new Error(`一次最多保存 ${MAX_TABS} 个网页，请先整理当前窗口。`);
    return { pages, skipped: tabs.length - pages.length };
  }

  function validate(value) {
    if (!Array.isArray(value) || value.length > MAX_SESSIONS) throw new Error("无法识别已保存的清单。");
    const ids = new Set();
    for (const session of value) {
      if (!session || typeof session.id !== "string" || !session.id || ids.has(session.id)
        || typeof session.name !== "string" || !session.name.trim() || session.name.length > 60
        || !Number.isFinite(session.createdAt) || !Array.isArray(session.tabs)
        || !session.tabs.length || session.tabs.length > MAX_TABS
        || !session.tabs.every((tab) => tab && typeof tab.title === "string" && isWebUrl(tab.url))) {
        throw new Error("无法识别已保存的清单；原数据没有改动。");
      }
      ids.add(session.id);
    }
    return value;
  }

  function createSession(name, pages) {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 60) throw new Error("给这份清单起个名字，最多 60 字。");
    const entry = { id: crypto.randomUUID(), name: cleanName, createdAt: Date.now(), tabs: pages };
    validate([entry]);
    return entry;
  }

  function createStore(storage) {
    let sessions = [];
    let loaded = false;
    return {
      get items() { return structuredClone(sessions); },
      async load() {
        const result = await storage.get(STORAGE_KEY);
        const next = validate(result[STORAGE_KEY] ?? []);
        sessions = structuredClone(next);
        loaded = true;
        return this.items;
      },
      async save(next) {
        if (!loaded) throw new Error("请先重新读取清单。");
        validate(next);
        await storage.set({ [STORAGE_KEY]: next });
        sessions = structuredClone(next);
        return this.items;
      }
    };
  }

  async function restoreSession(session, tabsApi) {
    validate([session]);
    // Issue all calls while the popup is open; no current tab is closed or replaced.
    const results = await Promise.allSettled(session.tabs.map((tab) =>
      Promise.resolve().then(() => tabsApi.create({ url: tab.url, active: false }))));
    return {
      opened: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length
    };
  }

  return { STORAGE_KEY, MAX_SESSIONS, collectTabs, createSession, createStore, restoreSession, validate, isWebUrl };
})();
