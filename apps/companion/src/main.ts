import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { join } from "node:path";

const WEB_URL = process.env.WORK_LEARN_WEB_URL ?? "https://work-learn.pages.dev";

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
      { label: "打开 Web 语料库", click: () => shell.openExternal(WEB_URL) },
      { type: "separator" },
      { label: "退出", click: () => app.quit() }
    ])
  );
  tray.on("click", () => (window?.isVisible() ? window.hide() : showWindow()));

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

  // Stay alive in the background after the panel is closed.
  app.on("window-all-closed", () => {});
});

app.on("activate", () => showWindow());
