const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jdApp", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  startAuth: (clientId) => ipcRenderer.invoke("auth:start", clientId),
  startRuntime: (config) => ipcRenderer.invoke("runtime:start", config),
  stopRuntime: () => ipcRenderer.invoke("runtime:stop"),
  nextSong: () => ipcRenderer.invoke("runtime:next"),
  createCompanionPairingCode: () => ipcRenderer.invoke("companion:pairingCode"),
  openUrl: (url) => ipcRenderer.invoke("open:url", url),
  importCredentials: () => ipcRenderer.invoke("secrets:import"),
  clearImportedCredentials: () => ipcRenderer.invoke("secrets:clearImport"),
  checkForUpdate: (options) => ipcRenderer.invoke("update:check", options),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openReleasePage: (url) => ipcRenderer.invoke("update:openReleasePage", url),
  checkSonglist: () => ipcRenderer.invoke("songlist:check"),
  onAuthComplete: (callback) => ipcRenderer.on("auth:complete", (_event, config) => callback(config)),
  onAuthError: (callback) => ipcRenderer.on("auth:error", (_event, message) => callback(message)),
  onUpdateState: (callback) => ipcRenderer.on("update:state", (_event, state) => callback(state)),
  onSonglistState: (callback) => ipcRenderer.on("songlist:state", (_event, state) => callback(state))
});
