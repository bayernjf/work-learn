const wl = window.workLearn;

function setStatus(text, kind) {
  const el = document.getElementById("status");
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function fmtDate(iso) {
  if (!iso) return "从未";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

async function refresh() {
  setStatus("加载中…");
  const res = await wl.getStats();
  if (!res || !res.ok) {
    setStatus("读取本地库失败：" + ((res && res.error) || "未知错误"), "error");
    return;
  }
  const s = res.stats || {};
  document.getElementById("today").textContent = (s.today && s.today.total) || 0;
  document.getElementById("pending").textContent = (s.counts && s.counts.reviews) || 0;
  const pending = s.pending || {};
  const unsynced = Object.values(pending).reduce((sum, n) => sum + (Number(n) || 0), 0);
  document.getElementById("unsynced").textContent = unsynced;
  document.getElementById("lastSync").textContent = fmtDate(s.lastPulledAt);
  setStatus("");
}

document.getElementById("refresh").addEventListener("click", refresh);

document.getElementById("capture").addEventListener("click", async () => {
  setStatus("采集中…");
  const res = await wl.capture();
  setStatus(res.ok ? "已采集剪贴板内容" : "采集失败：" + res.output, res.ok ? "ok" : "error");
  refresh();
});

document.getElementById("captureSelection").addEventListener("click", async () => {
  setStatus("采集选中文本中…");
  const res = await wl.captureSelection();
  setStatus(res.ok ? "已通过快捷键采集选中文本" : "采集失败：" + res.output, res.ok ? "ok" : "error");
  refresh();
});

document.getElementById("sync").addEventListener("click", async () => {
  setStatus("同步中…");
  const res = await wl.sync();
  setStatus(res.ok ? "同步完成" : "同步失败：" + res.output, res.ok ? "ok" : "error");
  refresh();
});

document.getElementById("openWeb").addEventListener("click", () => wl.openWeb());

wl.onRefresh(refresh);
window.addEventListener("DOMContentLoaded", refresh);
