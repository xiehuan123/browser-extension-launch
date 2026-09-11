"use strict";

const store = TextSnippets.createStore(chrome.storage.local);
const form = document.querySelector("#snippet-form");
const titleInput = document.querySelector("#snippet-title");
const textInput = document.querySelector("#snippet-text");
const searchInput = document.querySelector("#search-input");
const saveButton = document.querySelector("#save-button");
const retryButton = document.querySelector("#retry-button");
const list = document.querySelector("#snippet-list");
const status = document.querySelector("#status");
let ready = false;
let busy = false;

function announce(message, error = false) {
  status.textContent = message;
  status.dataset.tone = error ? "error" : "success";
}
function setBusy(value) {
  busy = value;
  [titleInput, textInput, searchInput, saveButton].forEach((element) => { element.disabled = value || !ready; });
  retryButton.disabled = value;
  list.querySelectorAll("button").forEach((button) => { button.disabled = value || !ready; });
}
function render() {
  const items = store.items;
  const visible = TextSnippets.search(items, searchInput.value);
  list.replaceChildren();
  document.querySelector("#count").textContent = `${items.length} / 200 条`;
  const empty = document.querySelector("#empty-state");
  empty.hidden = visible.length > 0;
  empty.textContent = items.length ? "没有找到，换个关键词试试。" : "还没有小抄。先保存第一条常用回复吧。";
  for (const snippet of visible) {
    const item = document.createElement("li");
    const title = document.createElement("h3");
    title.textContent = snippet.title;
    const content = document.createElement("p");
    content.className = "snippet-text";
    content.textContent = snippet.text;
    const actions = document.createElement("div");
    actions.className = "actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "复制正文";
    copy.setAttribute("aria-label", `复制 ${snippet.title} 的正文`);
    copy.addEventListener("click", async () => {
      if (busy || !ready) return;
      setBusy(true);
      try {
        await TextSnippets.copySnippet(snippet, navigator.clipboard);
        announce("已复制正文，可以到需要的地方粘贴了。");
      } catch { announce("没有复制成功。请选中这条小抄的正文，手动复制。", true); }
      finally { setBusy(false); copy.focus(); }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除 ${snippet.title}`);
    remove.addEventListener("click", async () => {
      if (busy || !ready) return;
      setBusy(true);
      try {
        await store.save(store.items.filter((entry) => entry.id !== snippet.id));
        render();
        announce("这条小抄已删除。");
      } catch { announce("删除没有保存成功，小抄仍保留，请重试。", true); }
      finally { setBusy(false); searchInput.focus(); }
    });
    actions.append(copy, remove);
    item.append(title, content, actions);
    list.append(item);
  }
}
async function load() {
  ready = false;
  setBusy(true);
  retryButton.hidden = true;
  try {
    await store.load();
    ready = true;
    render();
    announce("小抄只保存在这里，保存后下次打开还能找到。");
  } catch {
    announce("暂时读不到小抄。原数据没有改动，请重新读取。", true);
    retryButton.hidden = false;
  } finally { setBusy(false); }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !ready) return;
  setBusy(true);
  try {
    if (store.items.length >= TextSnippets.MAX_ITEMS) throw new Error("已保存 200 条，请先删除不需要的小抄。");
    const snippet = TextSnippets.createSnippet(titleInput.value, textInput.value);
    try { await store.save([snippet, ...store.items]); }
    catch { throw new Error("保存没有成功，输入和原有小抄仍保留，请重试。"); }
    titleInput.value = "";
    textInput.value = "";
    searchInput.value = "";
    render();
    announce("已保存，下次打开还能找到。");
  } catch (error) {
    announce(error instanceof Error ? error.message : "保存没有成功，请重试。", true);
  } finally { setBusy(false); titleInput.focus(); }
});
searchInput.addEventListener("input", render);
retryButton.addEventListener("click", load);
load();
