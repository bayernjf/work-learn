import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, globalShortcut, Notification, clipboard } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const WEB_URL = process.env.WORK_LEARN_WEB_URL ?? "https://work-learn.pages.dev";
const HOTKEY = process.env.WORK_LEARN_HOTKEY ?? "CommandOrControl+Shift+L";

// Resolve the `learn` CLI entry. The CLI is run through the workspace `tsx`
// against its TypeScript source (apps/cli/src/index.ts) — the package's build is
// noEmit, so there is no compiled dist to spawn. This keeps the companion a thin
// shell that reuses the existing core logic (handoff.md:124). The spawned process
// must run under the same Node ABI that better-sqlite3 was built for (Node 22 in
// this repo), so launch the companion from a shell that has that Node on PATH.
function resolveLearn(): { command: string; baseArgs: string[] } {
  const override = process.env.WORK_LEARN_CLI_PATH?.trim();
  if (override) return { command: "node", baseArgs: [override] };
  const cliSrc = join(app.getAppPath(), "..", "cli", "src", "index.ts");
  const tsx = join(app.getAppPath(), "..", "..", "node_modules", ".bin", "tsx");
  return { command: tsx, baseArgs: [cliSrc] };
}

interface LearnResult {
  ok: boolean;
  output: string;
}

function runLearn(extraArgs: string[]): Promise<LearnResult> {
  const { command, baseArgs } = resolveLearn();
  return new Promise((resolve) => {
    const child = spawn(command, [...baseArgs, ...extraArgs], { env: process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e: Error) => resolve({ ok: false, output: e.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output: (out + err).trim() }));
  });
}

function runOsascript(script: string): Promise<LearnResult> {
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", script], { env: process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e: Error) => resolve({ ok: false, output: e.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output: (out + err).trim() }));
  });
}

// Ask the frontmost app to copy its current selection to the pasteboard.
// Requires the app to be trusted for Accessibility (System Settings > Privacy & Security).
async function copySelectionToClipboard(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const script = "tell application \"System Events\" to keystroke \"c\" using {command down}";
  const res = await runOsascript(script);
  return res.ok;
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
  else console.log(`[companion] ${title}: ${body}`);
}

// M2: capture the current selection from anywhere via the global hotkey.
// We copy the selection into the pasteboard, let `learn capture` read it, then
// restore the previous pasteboard contents so the user's clipboard is untouched.
async function captureSelection() {
  const prev = clipboard.readText();
  const copied = await copySelectionToClipboard();
  if (!copied) {
    notify("Work Learn", "无法拷贝选中内容：请在系统设置中授予「辅助功能」权限");
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 120)); // let the target app update the pasteboard
  const result = await runLearn(["capture"]);
  clipboard.writeText(prev);
  if (result.ok) {
    const lines = result.output.trim().split("\n");
    notify("Work Learn", lines[lines.length - 1] || "已采集选中文本");
  } else {
    notify("Work Learn", "采集失败：" + result.output);
  }
  if (window && window.webContents) window.webContents.send("refresh");
}

interface CompanionConfig {
  autoCapture: boolean;
}

function configPath() {
  return join(app.getPath("userData"), "companion-config.json");
}

function loadConfig(): CompanionConfig {
  try {
    return { autoCapture: false, ...(JSON.parse(readFileSync(configPath(), "utf8")) as Partial<CompanionConfig>) };
  } catch {
    return { autoCapture: false };
  }
}

function saveConfig(cfg: CompanionConfig) {
  try {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(cfg));
  } catch {
    /* best effort */
  }
}

// M4: open a real terminal window whose interactive shell is wrapped by
// `learn run`, so the user's terminal agent sessions are recorded automatically
// (closing the window saves the transcript via the existing run command).
async function openRecordedTerminal(): Promise<LearnResult> {
  const { command, baseArgs } = resolveLearn();
  const shellName = (process.env.SHELL ?? "/bin/zsh").split("/").pop() || "zsh";
  const cmd = `${command} ${baseArgs.map((a) => JSON.stringify(a)).join(" ")} run -- ${shellName}`;
  const appleScript = `tell application "Terminal" to do script ${JSON.stringify(cmd)}`;
  return runOsascript(appleScript);
}

async function setAutoCapture(on: boolean) {
  const cfg = loadConfig();
  cfg.autoCapture = on;
  saveConfig(cfg);
  if (on) {
    const res = await openRecordedTerminal();
    notify("Work Learn", res.ok ? "自动采集已开启：已打开录制终端" : "无法打开录制终端：" + res.output);
  } else {
    notify("Work Learn", "自动采集已停止");
  }
}

let tray: Tray | null = null;
let window: BrowserWindow | null = null;

function createWindow() {
  window = new BrowserWindow({
    width: 320,
    height: 440,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadFile(join(__dirname, "renderer", "index.html"));

  window.on("blur", () => {
    if (window && !window.webContents.isDevToolsOpened()) window.hide();
  });
  window.on("closed", () => (window = null));
}

function showWindow() {
  if (!window) createWindow();
  if (window) {
    window.show();
    window.focus();
    if (window.webContents) window.webContents.send("refresh");
  }
}

app.whenReady().then(() => {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("WL");
  tray.setToolTip("Work Learn");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开面板", click: () => showWindow() },
      { label: "采集选中文本", click: () => void captureSelection() },
      { label: "打开录制终端", click: () => void openRecordedTerminal() },
      { label: "打开 Web 语料库", click: () => shell.openExternal(WEB_URL) },
      { type: "separator" },
      { label: "退出", click: () => app.quit() }
    ])
  );
  tray.on("click", () => (window?.isVisible() ? window.hide() : showWindow()));

  const registered = globalShortcut.register(HOTKEY, () => void captureSelection());
  if (!registered) console.warn(`[companion] global shortcut "${HOTKEY}" could not be registered (already in use?)`);

  // M4: if auto-capture was enabled previously, open a recorded terminal on launch.
  if (loadConfig().autoCapture) void openRecordedTerminal();

  ipcMain.handle("get-stats", async (): Promise<unknown> => {
    const { ok, output } = await runLearn(["stats", "--json"]);
    if (!ok) return { ok: false, error: output };
    try {
      return { ok: true, stats: JSON.parse(output) };
    } catch {
      return { ok: false, error: output };
    }
  });
  ipcMain.handle("capture", async (): Promise<LearnResult> => runLearn(["capture"]));
  ipcMain.handle("sync", async (): Promise<LearnResult> => runLearn(["sync"]));
  ipcMain.handle("open-web", async (): Promise<LearnResult> => {
    await shell.openExternal(WEB_URL);
    return { ok: true, output: "" };
  });
  ipcMain.handle("capture-selection", async (): Promise<LearnResult> => {
    await captureSelection();
    return { ok: true, output: "" };
  });
  ipcMain.handle("doctor", async (): Promise<unknown> => {
    const { ok, output } = await runLearn(["doctor"]);
    if (!ok) return { ok: false, error: output };
    try {
      return { ok: true, report: JSON.parse(output) };
    } catch {
      return { ok: false, error: output };
    }
  });
  ipcMain.handle("get-config", async (): Promise<CompanionConfig> => loadConfig());
  ipcMain.handle("open-recorded-terminal", async (): Promise<LearnResult> => {
    const result = await openRecordedTerminal();
    if (result.ok) notify("Work Learn", "已打开录制终端");
    return result;
  });
  ipcMain.handle("set-auto-capture", async (_event, on: boolean): Promise<CompanionConfig> => {
    await setAutoCapture(on);
    return loadConfig();
  });

  // Stay alive in the background after the panel is closed.
  app.on("window-all-closed", () => {});
});

app.on("activate", () => showWindow());
app.on("will-quit", () => globalShortcut.unregisterAll());
