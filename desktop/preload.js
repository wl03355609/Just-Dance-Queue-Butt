const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jdApp", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  startAuth: (clientId) => ipcRenderer.invoke("auth:start", clientId),
  startRuntime: (config) => ipcRenderer.invoke("runtime:start", config),
  stopRuntime: () => ipcRenderer.invoke("runtime:stop"),
  nextSong: () => ipcRenderer.invoke("runtime:next"),
  openUrl: (url) => ipcRenderer.invoke("open:url", url),
  importCredentials: () => ipcRenderer.invoke("secrets:import"),
  clearImportedCredentials: () => ipcRenderer.invoke("secrets:clearImport"),
  onAuthComplete: (callback) => ipcRenderer.on("auth:complete", (_event, config) => callback(config)),
  onAuthError: (callback) => ipcRenderer.on("auth:error", (_event, message) => callback(message))
});
