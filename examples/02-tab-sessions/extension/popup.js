"use strict";

const store = TabSessions.createStore(chrome.storage.local);
const form = document.querySelector("#session-form");
const nameInput = document.querySelector("#session-name");
const saveButton = document.querySelector("#save-button");
const retryButton = document.querySelector("#retry-button");
const status = document.querySelector("#status");
const list = document.querySelector("#session-list");
let ready = false;
let busy = false;

function announce(message, error = false) {
  status.textContent = message;
  status.dataset.tone = error ? "error" : "success";
}

function setBusy(value) {
  busy = value;
  nameInput.disabled = value || !ready;
  saveButton.disabled = value || !ready;
  retryButton.disabled = value;
  list.querySelectorAll("button").forEach((button) => { button.disabled = value || !ready; });
}

function render() {
  const sessions = store.items;
  list.replaceChildren();
  document.querySelector("#count").textContent = `${sessions.length} 份`;
  document.querySelector("#empty-state").hidden = sessions.length > 0;
  for (const session of sessions) {
    const item = document.createElement("li");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${session.name} · ${session.tabs.length} 个网页`;
    const pages = document.createElement("ol");
    for (const tab of session.tabs) {
      const page = document.createElement("li");
      const title = document.createElement("p");
      title.textContent = tab.title;
      const url = document.createElement("small");
      url.textContent = tab.url;
      page.append(title, url);
      pages.append(page);
    }
    details.append(summary, pages);
    const actions = document.createElement("div");
    actions.className = "actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "重新打开";
    restore.setAttribute("aria-label", `重新打开 ${session.name} 中的 ${session.tabs.length} 个网页`);
    restore.addEventListener("click", async () => {
      if (busy || !ready) return;
      setBusy(true);
      announce("正在新开标签页，请稍等……");
      try {
        const result = await TabSessions.restoreSession(session, chrome.tabs);
        announce(result.failed
          ? `已打开 ${result.opened} 个，${result.failed} 个未能打开。清单仍在；再次打开会重复新增已成功的网页。`
          : `已在当前窗口新开 ${result.opened} 个网页，原有标签页都还在。`, result.failed > 0);
      } catch {
        announce("未能重新打开，请展开清单查看网址后手动打开。", true);
      } finally { setBusy(false); }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "删除清单";
    remove.setAttribute("aria-label", `删除清单 ${session.name}`);
    remove.addEventListener("click", async () => {
      if (busy || !ready) return;
      setBusy(true);
      try {
        await store.save(store.items.filter((entry) => entry.id !== session.id));
        render();
        announce("清单已删除，已打开的网页没有关闭。");
        nameInput.focus();
      } catch { announce("删除没有保存成功，清单仍保留，请重试。", true); }
      finally { setBusy(false); nameInput.focus(); }
    });
    actions.append(restore, remove);
    item.append(details, actions);
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
    announce("点击清单名字查看网址，点击“重新打开”找回网页。");
  } catch {
    announce("暂时读不到清单。原数据没有改动，请重新读取。", true);
    retryButton.hidden = false;
  } finally { setBusy(false); }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !ready) return;
  setBusy(true);
  let saved = false;
  try {
    if (store.items.length >= TabSessions.MAX_SESSIONS) throw new Error("已经有 30 份清单了，请先删除不需要的清单。");
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const { pages, skipped } = TabSessions.collectTabs(tabs);
    const session = TabSessions.createSession(nameInput.value, pages);
    try { await store.save([session, ...store.items]); }
    catch { throw new Error("保存没有成功，原有清单仍保留，请重试。"); }
    saved = true;
    render();
    nameInput.value = "";
    announce(`已保存 ${pages.length} 个网页${skipped ? `，跳过 ${skipped} 个不支持的页面` : ""}。当前网页都还在。`);
  } catch (error) {
    announce(error instanceof Error && error.message.match(/[\u4e00-\u9fff]/)
      ? error.message : "暂时无法读取当前窗口的网页，请重开插件后再试。", true);
  } finally {
    setBusy(false);
    if (saved) nameInput.focus();
  }
});
retryButton.addEventListener("click", load);
load();
