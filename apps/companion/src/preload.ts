import { contextBridge, ipcRenderer } from "electron";

interface LearnResult {
  ok: boolean;
  output: string;
}

contextBridge.exposeInMainWorld("workLearn", {
  getStats: (): Promise<unknown> => ipcRenderer.invoke("get-stats"),
  capture: (): Promise<LearnResult> => ipcRenderer.invoke("capture"),
  captureSelection: (): Promise<LearnResult> => ipcRenderer.invoke("capture-selection"),
  doctor: (): Promise<unknown> => ipcRenderer.invoke("doctor"),
  sync: (): Promise<LearnResult> => ipcRenderer.invoke("sync"),
  openWeb: (): Promise<LearnResult> => ipcRenderer.invoke("open-web"),
  onRefresh: (callback: () => void) => ipcRenderer.on("refresh", () => callback())
});
