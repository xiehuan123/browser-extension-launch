import { PageNotes, NotesError, normalizePageUrl } from "./notes.mjs";

const service = new PageNotes(chrome);
const title = document.getElementById("page-title");
const url = document.getElementById("page-url");
const editor = document.getElementById("note");
const count = document.getElementById("count");
const save = document.getElementById("save");
const clear = document.getElementById("clear");
const remove = document.getElementById("delete");
const status = document.getElementById("status");
let session = null;
let savedText = null;
let busy = true;
let blocked = false;

function message(text, kind = "info") {
  status.textContent = text;
  status.dataset.kind = kind;
}

function updateControls() {
  const unavailable = busy || blocked || !session;
  editor.readOnly = unavailable;
  save.disabled = unavailable || !editor.value.trim() || editor.value === savedText;
  clear.disabled = unavailable || !editor.value;
  remove.disabled = unavailable || savedText === null;
  count.textContent = `${editor.value.length} / 10000`;
}

function invalidate() {
  if (!service.session || blocked) return;
  service.invalidate();
  blocked = true;
  message("网页已切换或正在跳转。请先复制要保留的文字，再关闭便签并从目标网页重新打开。", "error");
  updateControls();
}

function reportError(error, action) {
  if (error instanceof NotesError) {
    if (["stale", "invalid-record", "unsupported", "unavailable", "loading"].includes(error.code)) blocked = true;
    message(error.message, "error");
  } else {
    message(`${action}失败，内容没有确认保存。请保留输入，稍后再试；若反复出现，请联系制作者。`, "error");
  }
}

chrome.tabs.onActivated.addListener((info) => {
  const bound = service.session;
  if (bound && info.windowId === bound.windowId && info.tabId !== bound.tabId) invalidate();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const bound = service.session;
  if (!bound || bound.tabId !== tabId) return;
  if (changeInfo.status === "loading") return invalidate();
  if (changeInfo.url) {
    try {
      if (normalizePageUrl(changeInfo.url) !== bound.url) invalidate();
    } catch {
      invalidate();
    }
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (service.session?.tabId === tabId) invalidate();
});

editor.addEventListener("input", () => {
  message(editor.value === savedText ? "内容与已保存的便签一致。" : "有未保存的修改，关闭窗口前请点“保存便签”。");
  updateControls();
});
clear.addEventListener("click", () => {
  editor.value = "";
  message("已清空输入，已保存的便签还在。要删除记录，请点“删除本页便签”。");
  updateControls();
  editor.focus();
});

document.getElementById("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || blocked || !session) return;
  busy = true;
  updateControls();
  message("正在保存…");
  try {
    const note = await service.save(session, editor.value);
    savedText = note.text;
    if (!blocked) message("已保存在这台电脑。下次打开同一网址就能找回。");
  } catch (error) {
    reportError(error, "保存");
  } finally {
    busy = false;
    updateControls();
  }
});

remove.addEventListener("click", async () => {
  if (busy || blocked || !session || savedText === null) return;
  busy = true;
  updateControls();
  message("正在删除本页便签…");
  try {
    await service.remove(session);
    savedText = null;
    editor.value = "";
    if (!blocked) message("已删除本页便签，其他网页的便签不受影响。");
  } catch (error) {
    reportError(error, "删除");
  } finally {
    busy = false;
    updateControls();
  }
});

try {
  const result = await service.open();
  session = result.session;
  savedText = result.note?.text ?? null;
  title.textContent = session.title || "未命名网页";
  url.textContent = session.url;
  editor.value = savedText ?? "";
  message(savedText === null ? "这页还没有便签，写下你想记住的事吧。" : "已找回这页的便签，可以继续修改。");
} catch (error) {
  blocked = true;
  title.textContent = "暂时无法打开这页的便签";
  reportError(error, "读取");
} finally {
  busy = false;
  updateControls();
}
