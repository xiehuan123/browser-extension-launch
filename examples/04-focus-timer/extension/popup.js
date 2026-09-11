"use strict";

const duration = document.getElementById("duration");
const timer = document.getElementById("timer");
const status = document.getElementById("status");
const primary = document.getElementById("primary");
const reset = document.getElementById("reset");
const refresh = document.getElementById("refresh");
const error = document.getElementById("error");
let state = null;
let busy = false;
let lastExpiryCheck = 0;

function showError(message = "") {
  error.textContent = message;
  error.hidden = !message;
}

function render() {
  primary.disabled = busy || !state;
  reset.disabled = busy;
  refresh.disabled = busy;
  duration.disabled = busy || !state || ["running", "paused"].includes(state.status);
  if (!state) return;
  duration.value = String(state.durationMinutes);
  const remaining = TimerModel.remaining(state, Date.now());
  const seconds = Math.ceil(remaining / 1000);
  timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  status.textContent = {
    idle: "准备好，就从现在开始。", running: "正在专注，慢慢来。",
    paused: "已暂停，准备好再继续。", completed: "时间到了，休息一会儿吧。"
  }[state.status];
  primary.textContent = {idle: "开始专注", running: "暂停", paused: "继续", completed: "再来一次"}[state.status];
  if (state.status === "running" && remaining === 0) {
    status.textContent = "正在确认到时状态…";
    if (!busy && Date.now() - lastExpiryCheck >= 1000) {
      lastExpiryCheck = Date.now();
      void command("get");
    }
  }
}

async function command(type, extra = {}) {
  if (busy) return;
  busy = true;
  render();
  try {
    const reply = await chrome.runtime.sendMessage({channel: "focus-timer", type, ...extra});
    if (!reply?.ok) throw new Error(reply?.error || "暂时无法读取计时，请重试。");
    if (!TimerModel.valid(reply.state)) throw new Error("收到的计时记录有误，请重试。");
    state = reply.state;
    showError(reply.warning || "");
  } catch (failure) {
    showError(failure.message || "连接计时器失败，请重新打开插件。");
    if (!state) status.textContent = "暂时读不到计时记录。";
  } finally {
    busy = false;
    render();
  }
}

primary.addEventListener("click", () => {
  if (!state) return;
  void command({running: "pause", paused: "resume", idle: "start", completed: "start"}[state.status]);
});
reset.addEventListener("click", () => void command("reset"));
refresh.addEventListener("click", () => void command("get"));
duration.addEventListener("change", () => void command("duration", {minutes: Number(duration.value)}));
chrome.storage.onChanged.addListener((changes, area) => {
  const next = changes.focusTimerV1?.newValue;
  if (area === "local" && TimerModel.valid(next)) {
    state = next;
    render();
  }
});

// This interval only paints the open popup; the deadline lives in storage.
const repaint = setInterval(render, 250);
window.addEventListener("pagehide", () => clearInterval(repaint));
void command("get");
