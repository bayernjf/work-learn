import { contextBridge, ipcRenderer } from "electron";

interface LearnResult {
  ok: boolean;
  output: string;
}

contextBridge.exposeInMainWorld("workLearn", {
  getStats: (): Promise<unknown> => ipcRenderer.invoke("get-stats"),
  capture: (): Promise<LearnResult> => ipcRenderer.invoke("capture"),
  sync: (): Promise<LearnResult> => ipcRenderer.invoke("sync"),
  openWeb: (): Promise<LearnResult> => ipcRenderer.invoke("open-web"),
  onRefresh: (callback: () => void) => ipcRenderer.on("refresh", () => callback())
});
