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
  await updateHealth();
  await applyConfig();
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
  setStatus(res.ok ? "同步完成" : classifySyncError(res.output), res.ok ? "ok" : "error");
  refresh();
});

document.getElementById("openWeb").addEventListener("click", () => wl.openWeb());

function setDot(id, state) {
  const el = document.getElementById(id);
  el.className = "dot" + (state === true ? " ok" : state === "amber" ? " amber" : " bad");
}

async function updateHealth() {
  try {
    const res = await wl.doctor();
    if (!res || !res.ok) return;
    const checks = (res.report && res.report.checks) || {};
    const tokenOk = !!(checks.token && checks.token.ok);
    const apiOk = !!(checks.api && checks.api.ok);
    const localOk = !!(checks.localDb && checks.localDb.ok);
    setDot("localDot", localOk);
    document.getElementById("localText").textContent = localOk ? "本地库正常（离线可用）" : "本地库异常";
    if (tokenOk && apiOk) {
      setDot("cloudDot", true);
      document.getElementById("cloudText").textContent = "云端已连通";
    } else if (!tokenOk) {
      setDot("cloudDot", "amber");
      document.getElementById("cloudText").textContent = "未配置 Token：采集仅存本地";
    } else {
      setDot("cloudDot", false);
      document.getElementById("cloudText").textContent = "云端不可达（离线）：本地已保存";
    }
  } catch {
    /* ignore health probe errors */
  }
}

function classifySyncError(output) {
  if (/WORK_LEARN_ACCESS_TOKEN/.test(output)) return "未配置 Token：采集已存本地，配置后点「同步云端」上传";
  if (/fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(output)) return "云端不可达（离线）：本地已保存，联网后点「同步云端」重试";
  const msg = (output || "").split("\n").slice(0, 2).join(" ");
  return "同步失败：" + msg;
}

async function applyConfig() {
  try {
    const cfg = await wl.getConfig();
    const box = document.getElementById("autoCapture");
    if (box) box.checked = !!(cfg && cfg.autoCapture);
  } catch {
    /* ignore config read errors */
  }
}

document.getElementById("autoCapture").addEventListener("change", async (e) => {
  const on = e.target.checked;
  setStatus(on ? "开启自动采集中…" : "停止自动采集中…");
  await wl.setAutoCapture(on);
  setStatus(on ? "自动采集已开启" : "自动采集已停止", "ok");
});

document.getElementById("openRecorded").addEventListener("click", async () => {
  setStatus("打开录制终端中…");
  const res = await wl.openRecordedTerminal();
  setStatus(res.ok ? "已打开录制终端" : "打开失败：" + res.output, res.ok ? "ok" : "error");
});

wl.onRefresh(refresh);
window.addEventListener("DOMContentLoaded", refresh);
setInterval(refresh, 8000); // keep stats, cloud health and config fresh while the app runs
