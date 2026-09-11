"use strict";

globalThis.TimerModel = (() => {
  const durations = [5, 15, 25];
  const statuses = ["idle", "running", "paused", "completed"];
  const initial = (minutes = 25) => ({
    schemaVersion: 1, status: "idle", durationMinutes: minutes,
    remainingMs: minutes * 60000, deadline: null
  });
  function valid(state) {
    return state && state.schemaVersion === 1 && statuses.includes(state.status)
      && durations.includes(state.durationMinutes)
      && Number.isFinite(state.remainingMs) && state.remainingMs >= 0
      && state.remainingMs <= state.durationMinutes * 60000
      && (state.status === "running"
        ? Number.isFinite(state.deadline) && state.deadline > 0
        : state.deadline === null);
  }
  function remaining(state, now) {
    return state.status === "running" ? Math.max(0, state.deadline - now) : state.remainingMs;
  }
  function settle(state, now) {
    if (state.status === "running" && remaining(state, now) === 0) {
      return {...state, status: "completed", remainingMs: 0, deadline: null};
    }
    return state;
  }
  function transition(previous, command, now) {
    const state = settle(previous, now);
    switch (command.type) {
      case "get": return state;
      case "duration":
        if (!durations.includes(command.minutes)) throw new Error("请选择 5、15 或 25 分钟。");
        if (state.status === "running" || state.status === "paused") {
          throw new Error("先重置当前计时，再修改时长。");
        }
        return initial(command.minutes);
      case "start":
        if (state.status === "running" || state.status === "paused") return state;
        return {...state, status: "running", remainingMs: state.durationMinutes * 60000,
          deadline: now + state.durationMinutes * 60000};
      case "pause":
        if (state.status !== "running") return state;
        return {...state, status: "paused", remainingMs: remaining(state, now), deadline: null};
      case "resume":
        if (state.status !== "paused") return state;
        return {...state, status: "running", deadline: now + state.remainingMs};
      case "reset": return initial(state.durationMinutes);
      default: throw new Error("无法识别这个操作，请重新打开插件。");
    }
  }
  return Object.freeze({initial, valid, remaining, settle, transition});
})();
