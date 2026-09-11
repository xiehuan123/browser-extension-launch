"use strict";

globalThis.TextSnippets = (() => {
  const STORAGE_KEY = "textSnippetsV1";
  const MAX_ITEMS = 200;
  function validate(value) {
    if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error("无法识别已保存的小抄。");
    const ids = new Set();
    for (const item of value) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
        || typeof item.title !== "string" || !item.title.trim() || item.title.length > 80
        || typeof item.text !== "string" || !item.text.trim() || item.text.length > 5000) {
        throw new Error("无法识别已保存的小抄；原数据没有改动。");
      }
      ids.add(item.id);
    }
    return value;
  }
  function createSnippet(title, text) {
    const item = { id: crypto.randomUUID(), title: title.trim(), text: text.trim() };
    if (!item.title || item.title.length > 80) throw new Error("请填写标题，最多 80 字。");
    if (!item.text || item.text.length > 5000) throw new Error("请填写正文，最多 5000 字。");
    return item;
  }
  function search(items, term) {
    const keyword = term.trim().toLocaleLowerCase();
    return items.filter((item) => `${item.title}\n${item.text}`.toLocaleLowerCase().includes(keyword));
  }
  function createStore(storage) {
    let items = [];
    let loaded = false;
    return {
      get items() { return structuredClone(items); },
      async load() {
        const result = await storage.get(STORAGE_KEY);
        const next = validate(result[STORAGE_KEY] ?? []);
        items = structuredClone(next);
        loaded = true;
        return this.items;
      },
      async save(next) {
        if (!loaded) throw new Error("请先重新读取小抄。");
        validate(next);
        await storage.set({ [STORAGE_KEY]: next });
        items = structuredClone(next);
        return this.items;
      }
    };
  }
  async function copySnippet(snippet, clipboard) {
    validate([snippet]);
    await clipboard.writeText(snippet.text);
  }
  return { STORAGE_KEY, MAX_ITEMS, validate, createSnippet, search, createStore, copySnippet };
})();
