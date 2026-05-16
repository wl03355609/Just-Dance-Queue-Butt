const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { startRuntime, stopRuntime } = require("../src/index");

const DEFAULT_PORT = 3000;
const DEFAULT_GAMES = ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "jdu", "plus"];
const CHAT_SCOPES = ["chat:read", "chat:edit"];
const RELEASES_PAGE_URL = "https://github.com/wl03355609/Just-Dance-Queue-Butt/releases/latest";
const SONGLIST_URL = "https://raw.githubusercontent.com/wl03355609/Just-Dance-Queue-Butt/main/data/songs.json";

// Fill in your Twitch Developer App Client ID here before building.
// Register at https://dev.twitch.tv/console/apps — use Device Code Grant, no redirect URI needed.
// When non-empty, the Client ID field is hidden from users; they just click "Log in with Twitch".
const BUNDLED_CLIENT_ID = "rpfj350muhxl4ei1kl9glmbkbmea7w";

// Default channel shown in the channel dropdown.
// Users change this to their own channel after logging in with their own Twitch account.
const DEFAULT_CHANNEL = "qutebutt";

// Bot account credentials loaded from desktop/secrets.js (gitignored, never committed).
// Copy desktop/secrets.example.js → desktop/secrets.js and fill in the token before building.
// Users can also import a credentials file at runtime — see ipcMain "secrets:import".
let secrets = { BUNDLED_OAUTH_TOKEN: "", BUNDLED_BOT_USERNAME: "" };
try { secrets = require("./secrets"); } catch {}
const BUILD_TIME_OAUTH = String(secrets.BUNDLED_OAUTH_TOKEN || "").trim();
const BUILD_TIME_USERNAME = String(secrets.BUNDLED_BOT_USERNAME || "").trim();

function effectiveBundled(config = readConfig()) {
  const importedUsername = String(config.importedBundledUsername || "").trim();
  const importedOauth = String(config.importedBundledOauth || "").trim();
  const username = importedUsername || BUILD_TIME_USERNAME;
  const oauth = importedOauth || BUILD_TIME_OAUTH;
  return {
    username,
    oauth,
    hasBundled: Boolean(username && oauth),
    fromImport: Boolean(importedUsername && importedOauth)
  };
}

function parseCredentialsFile(text, filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON in credentials file.");
    }
    return {
      username: String(data.BUNDLED_BOT_USERNAME || data.username || data.TWITCH_USERNAME || "").trim(),
      oauth: String(data.BUNDLED_OAUTH_TOKEN || data.oauth || data.TWITCH_OAUTH || "").trim()
    };
  }

  if (ext === ".env") {
    const env = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = value;
    }
    return {
      username: String(env.TWITCH_USERNAME || env.BUNDLED_BOT_USERNAME || "").trim(),
      oauth: String(env.TWITCH_OAUTH || env.BUNDLED_OAUTH_TOKEN || "").trim()
    };
  }

  // Default: .js parsing via regex — no eval, so the picked file can't run code.
  const tokenMatch = text.match(/BUNDLED_OAUTH_TOKEN\s*[:=]\s*["']([^"']*)["']/);
  const userMatch = text.match(/BUNDLED_BOT_USERNAME\s*[:=]\s*["']([^"']*)["']/);
  return {
    username: userMatch ? userMatch[1].trim() : "",
    oauth: tokenMatch ? tokenMatch[1].trim() : ""
  };
}

let mainWindow = null;
let runtime = null;
let authPollTimer = null;
let quitAfterPrompt = false;
let quitPromptActive = false;
let updateCheckStarted = false;
let songlistCheckPromise = null;
let updateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  latestVersion: "",
  releaseName: "",
  releaseUrl: RELEASES_PAGE_URL,
  message: "",
  percent: 0,
  canInstall: false
};
let songlistState = {
  status: "idle",
  source: "bundled",
  count: 0,
  updatedAt: "",
  message: ""
};

function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function getQueuePath(channel = readConfig().channel || DEFAULT_CHANNEL) {
  return path.join(app.getPath("userData"), "queues", `${sanitizeChannelName(channel) || "default"}.json`);
}

function getSonglistPath() {
  return path.join(app.getPath("userData"), "songlist", "songs.json");
}

function getSonglistMetaPath() {
  return path.join(app.getPath("userData"), "songlist", "songs-meta.json");
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
  } catch {
    return {
      clientId: "",
      username: "",
      channel: DEFAULT_CHANNEL,
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      port: DEFAULT_PORT,
      enabledGames: DEFAULT_GAMES,
      maxQueueSize: 50
    };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

function publicConfig(config = readConfig()) {
  const port = config.port || DEFAULT_PORT;
  const bundled = effectiveBundled(config);
  const overlayUrl = runtime?.urls?.overlay || `http://localhost:${port}`;
  const dashboardUrl = runtime?.urls?.dashboard || `http://localhost:${port}/dashboard`;

  return {
    clientId: config.clientId || BUNDLED_CLIENT_ID || "",
    hasBundledClientId: Boolean(BUNDLED_CLIENT_ID),
    hasBundledBot: bundled.hasBundled,
    bundledBotUsername: bundled.username,
    bundledFromImport: bundled.fromImport,
    botMode: config.botMode || (bundled.hasBundled ? "bundled" : "own"),
    username: config.username || "",
    channel: config.channel || DEFAULT_CHANNEL,
    defaultChannel: DEFAULT_CHANNEL,
    loggedIn: Boolean(config.accessToken),
    port,
    enabledGames: config.enabledGames || DEFAULT_GAMES,
    maxQueueSize: config.maxQueueSize || 50,
    songlist: currentSonglistInfo(),
    overlayUrl,
    dashboardUrl,
    running: Boolean(runtime)
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#080b10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  registerIpc();
  setupAutoUpdater();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (event) => {
  if (quitAfterPrompt) return;
  event.preventDefault();
  promptBeforeQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc() {
  ipcMain.handle("config:get", () => publicConfig());

  ipcMain.handle("config:save", (_event, patch) => {
    const current = readConfig();
    const next = {
      ...current,
      clientId: String(patch.clientId || current.clientId || "").trim(),
      botMode: String(patch.botMode || current.botMode || "own"),
      channel: String(patch.channel || current.channel || "").trim().replace(/^#/, "").toLowerCase(),
      port: Number.parseInt(patch.port, 10) || current.port || DEFAULT_PORT,
      maxQueueSize: Number.parseInt(patch.maxQueueSize, 10) || current.maxQueueSize || 50,
      enabledGames: Array.isArray(patch.enabledGames) && patch.enabledGames.length ? patch.enabledGames : current.enabledGames || DEFAULT_GAMES
    };
    writeConfig(next);
    return publicConfig(next);
  });

  ipcMain.handle("auth:start", async (_event, clientId) => {
    const cleanClientId = String(clientId || readConfig().clientId || BUNDLED_CLIENT_ID || "").trim();
    if (!cleanClientId) throw new Error("Enter your Twitch app Client ID first.");

    const config = readConfig();
    config.clientId = cleanClientId;
    writeConfig(config);

    return startDeviceLogin(cleanClientId);
  });

  ipcMain.handle("runtime:start", async (_event, patch = {}) => {
    const saved = readConfig();
    const config = { ...saved, ...patch };
    writeConfig(config);

    const bundled = effectiveBundled(config);
    const useBundledBot = config.botMode === "bundled" && bundled.hasBundled;

    let username, oauth;
    if (useBundledBot) {
      username = bundled.username;
      oauth = bundled.oauth;
    } else {
      const readyConfig = await ensureFreshToken(config);
      if (!readyConfig.accessToken) throw new Error("Log in with Twitch before starting the bot.");
      username = readyConfig.username;
      oauth = readyConfig.accessToken;
    }

    const channel = String(config.channel || username || "").trim().replace(/^#/, "").toLowerCase();
    if (!channel) throw new Error("Enter the Twitch channel to join.");

    await checkSonglistUpdate({ silent: true });

    stopRuntime();
    runtime = startRuntime({
      username,
      oauth,
      channel,
      port: config.port || DEFAULT_PORT,
      maxQueueSize: config.maxQueueSize || 50,
      enabledGames: config.enabledGames || DEFAULT_GAMES,
      modUsers: [channel, username].filter(Boolean),
      queuePath: getQueuePath(channel),
      songsPath: getEffectiveSonglistPath()
    });

    const next = { ...config, channel };
    writeConfig(next);
    return publicConfig(next);
  });

  ipcMain.handle("runtime:stop", () => {
    stopRuntime();
    runtime = null;
    return publicConfig();
  });

  ipcMain.handle("runtime:next", async () => {
    if (!runtime) throw new Error("Start the bot first.");
    const port = readConfig().port || DEFAULT_PORT;
    const response = await fetch(`http://localhost:${port}/api/skip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Queue-Admin": runtime.config.adminToken
      }
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || "The queue is empty.");
    return data;
  });

  ipcMain.handle("open:url", (_event, url) => {
    return openLocalAppUrl(url);
  });

  ipcMain.handle("secrets:import", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("Main window is not available.");
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import bot credentials",
      filters: [
        { name: "Credentials files", extensions: ["js", "json", "env"] },
        { name: "All files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      throw new Error(`Could not read file: ${error.message}`);
    }

    const parsed = parseCredentialsFile(text, filePath);
    if (!parsed.username || !parsed.oauth) {
      throw new Error("That file doesn't contain a bot username and OAuth token. Expected fields: BUNDLED_BOT_USERNAME / BUNDLED_OAUTH_TOKEN, or TWITCH_USERNAME / TWITCH_OAUTH, or username / oauth.");
    }

    const oauth = parsed.oauth.startsWith("oauth:") ? parsed.oauth : `oauth:${parsed.oauth}`;
    const config = readConfig();
    config.importedBundledUsername = parsed.username;
    config.importedBundledOauth = oauth;
    config.botMode = "bundled";
    writeConfig(config);
    return publicConfig(config);
  });

  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) {
      return setUpdateState({
        status: "idle",
        message: "",
        canInstall: false
      }, { silent: true });
    }

    if (updateState.status === "downloading" || updateState.status === "downloaded") {
      return updateState;
    }

    if (updateCheckStarted && updateState.status === "checking") {
      return updateState;
    }

    updateCheckStarted = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      setUpdateState({
        status: "error",
        message: `Could not check for updates: ${error.message}`,
        canInstall: false
      });
    }
    return updateState;
  });

  ipcMain.handle("update:install", () => {
    if (updateState.status !== "downloaded") return updateState;
    quitAfterPrompt = true;
    clearTimeout(authPollTimer);
    stopRuntime();
    runtime = null;
    autoUpdater.quitAndInstall(false, true);
    return updateState;
  });

  ipcMain.handle("songlist:check", () => checkSonglistUpdate());

  ipcMain.handle("update:openReleasePage", (_event, url) => {
    let target;
    try {
      target = new URL(String(url || ""));
    } catch {
      target = new URL(RELEASES_PAGE_URL);
    }
    if (target.protocol !== "https:" || target.hostname.toLowerCase() !== "github.com") {
      target = new URL(RELEASES_PAGE_URL);
    }
    return shell.openExternal(target.toString());
  });

  ipcMain.handle("secrets:clearImport", () => {
    const config = readConfig();
    delete config.importedBundledUsername;
    delete config.importedBundledOauth;
    if (config.botMode === "bundled" && !BUILD_TIME_OAUTH) {
      config.botMode = "own";
    }
    writeConfig(config);
    return publicConfig(config);
  });
}

function currentSonglistInfo() {
  const cachedPath = getSonglistPath();
  const meta = readJsonFile(getSonglistMetaPath(), {});
  const cachedCount = countSongs(cachedPath);
  if (cachedCount > 0) {
    songlistState = {
      ...songlistState,
      source: "updated",
      count: cachedCount,
      updatedAt: meta.updatedAt || "",
      message: songlistState.status === "checking" ? songlistState.message : `Songlist updated${meta.updatedAt ? ` ${dateOnly(meta.updatedAt)}` : ""}.`
    };
    return songlistState;
  }

  const bundledCount = countSongs(path.resolve(__dirname, "..", "data", "songs.json"));
  songlistState = {
    ...songlistState,
    source: "bundled",
    count: bundledCount,
    updatedAt: "",
    message: songlistState.status === "checking" ? songlistState.message : "Using bundled songlist."
  };
  return songlistState;
}

function getEffectiveSonglistPath() {
  return countSongs(getSonglistPath()) > 0 ? getSonglistPath() : undefined;
}

async function checkSonglistUpdate(options = {}) {
  if (songlistCheckPromise) return songlistCheckPromise;

  songlistCheckPromise = doCheckSonglistUpdate(options)
    .finally(() => {
      songlistCheckPromise = null;
    });
  return songlistCheckPromise;
}

async function doCheckSonglistUpdate(options = {}) {
  setSonglistState({
    ...currentSonglistInfo(),
    status: "checking",
    message: "Checking songlist updates..."
  }, options);

  const meta = readJsonFile(getSonglistMetaPath(), {});
  const headers = {
    Accept: "application/json",
    "User-Agent": "JustDanceRequests-Desktop"
  };
  if (meta.etag) headers["If-None-Match"] = meta.etag;

  try {
    const response = await fetch(SONGLIST_URL, {
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (response.status === 304) {
      return setSonglistState({
        ...currentSonglistInfo(),
        status: "idle",
        message: "Songlist is already up to date."
      }, options);
    }

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const text = await response.text();
    const songs = parseSonglist(text);
    const updatedAt = new Date().toISOString();
    const songlistPath = getSonglistPath();

    fs.mkdirSync(path.dirname(songlistPath), { recursive: true });
    fs.writeFileSync(songlistPath, JSON.stringify(songs, null, 2) + "\n");
    fs.writeFileSync(getSonglistMetaPath(), JSON.stringify({
      updatedAt,
      count: songs.length,
      etag: response.headers.get("etag") || "",
      source: SONGLIST_URL
    }, null, 2) + "\n");

    return setSonglistState({
      status: "updated",
      source: "updated",
      count: songs.length,
      updatedAt,
      message: `Songlist updated (${songs.length} songs).`
    }, options);
  } catch (error) {
    return setSonglistState({
      ...currentSonglistInfo(),
      status: "error",
      message: `Could not update songlist: ${error.message}.`
    }, options);
  }
}

function setSonglistState(next, options = {}) {
  songlistState = next;
  if (!options.silent && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("songlist:state", songlistState);
  }
  return songlistState;
}

function parseSonglist(text) {
  let songs;
  try {
    songs = JSON.parse(text);
  } catch {
    throw new Error("Downloaded songlist was not valid JSON");
  }

  if (!Array.isArray(songs) || songs.length < 100) {
    throw new Error("Downloaded songlist did not look complete");
  }

  const invalid = songs.find((song) => !song || typeof song.title !== "string" || typeof song.game !== "string");
  if (invalid) {
    throw new Error("Downloaded songlist had invalid entries");
  }

  return songs;
}

function countSongs(filePath) {
  try {
    const songs = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(songs) ? songs.length : 0;
  } catch {
    return 0;
  }
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      status: "checking",
      message: "Checking for updates...",
      canInstall: false
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "downloading",
      latestVersion: updateVersion(info),
      releaseName: updateReleaseName(info),
      releaseUrl: updateReleaseUrl(info),
      message: `Downloading update ${updateVersion(info)}...`,
      percent: 0,
      canInstall: false
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    setUpdateState({
      status: "downloading",
      message: `Downloading update ${Math.round(percent)}%...`,
      percent,
      canInstall: false
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      status: "downloaded",
      latestVersion: updateVersion(info),
      releaseName: updateReleaseName(info),
      releaseUrl: updateReleaseUrl(info),
      message: `Update ${updateVersion(info)} is ready. Restart to install it.`,
      percent: 100,
      canInstall: true
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdateState({
      status: "idle",
      latestVersion: updateVersion(info),
      releaseName: updateReleaseName(info),
      releaseUrl: updateReleaseUrl(info),
      message: "",
      percent: 0,
      canInstall: false
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({
      status: "error",
      message: `Could not update automatically: ${error.message}`,
      canInstall: false
    });
  });
}

function setUpdateState(patch, options = {}) {
  updateState = {
    ...updateState,
    currentVersion: app.getVersion(),
    ...patch
  };
  if (!options.silent) sendUpdateState();
  return updateState;
}

function sendUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("update:state", updateState);
}

function updateVersion(info = {}) {
  return String(info.version || info.tag || info.tag_name || "").replace(/^v/i, "");
}

function updateReleaseName(info = {}) {
  return String(info.releaseName || info.name || info.tag || info.version || "").trim();
}

function updateReleaseUrl(info = {}) {
  return String(info.releaseNotesUrl || info.html_url || RELEASES_PAGE_URL);
}

async function promptBeforeQuit() {
  if (quitPromptActive) return;
  quitPromptActive = true;

  if (runtime && queueHasEntries(runtime.getState())) {
    const options = {
      type: "question",
      buttons: ["Keep Queue But Clear History", "Clear Queue And History", "Don't Exit"],
      defaultId: 0,
      cancelId: 2,
      message: "What do you want to do before exiting?",
      detail: "Keep Queue But Clear History saves your current queue for next time. Don't Exit cancels and keeps the bot running."
    };
    const choice = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);

    if (choice.response === 2) {
      quitPromptActive = false;
      return;
    }

    if (choice.response === 0) runtime.clearHistory();
    if (choice.response === 1) runtime.clearState();
  }

  clearTimeout(authPollTimer);
  stopRuntime();
  runtime = null;
  quitAfterPrompt = true;
  app.quit();
}

function queueHasEntries(state) {
  return Boolean((state.queue && state.queue.length) || (state.history && state.history.length));
}

function sanitizeChannelName(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

async function startDeviceLogin(clientId) {
  clearTimeout(authPollTimer);

  const payload = new URLSearchParams({
    client_id: clientId,
    scopes: CHAT_SCOPES.join(" ")
  });

  const response = await fetch("https://id.twitch.tv/oauth2/device", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Could not start Twitch login.");

  openTwitchVerificationUrl(data.verification_uri);
  pollDeviceToken(clientId, data.device_code, data.interval || 5);

  return {
    verificationUri: data.verification_uri,
    userCode: data.user_code,
    expiresIn: data.expires_in
  };
}

async function pollDeviceToken(clientId, deviceCode, intervalSeconds) {
  clearTimeout(authPollTimer);

  authPollTimer = setTimeout(async () => {
    try {
      const payload = new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      });

      const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload
      });
      const data = await response.json();

      if (!response.ok) {
        if (data.message && data.message.includes("authorization_pending")) {
          return pollDeviceToken(clientId, deviceCode, intervalSeconds);
        }
        if (data.message && data.message.includes("slow_down")) {
          return pollDeviceToken(clientId, deviceCode, intervalSeconds + 5);
        }
        throw new Error(data.message || "Twitch login failed.");
      }

      const identity = await validateToken(data.access_token);
      const config = {
        ...readConfig(),
        clientId,
        username: identity.login,
        channel: readConfig().channel || identity.login,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || "",
        expiresAt: Date.now() + (data.expires_in || 0) * 1000
      };
      writeConfig(config);
      mainWindow?.webContents.send("auth:complete", publicConfig(config));
    } catch (error) {
      mainWindow?.webContents.send("auth:error", error.message);
    }
  }, intervalSeconds * 1000);
}

async function ensureFreshToken(config) {
  if (!config.accessToken) return config;
  if (!config.refreshToken || Date.now() < (config.expiresAt || 0) - 60_000) return config;

  const payload = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "refresh_token",
    refresh_token: config.refreshToken
  });

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Could not refresh Twitch login.");

  const next = {
    ...config,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || config.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 0) * 1000
  };
  writeConfig(next);
  return next;
}

async function validateToken(accessToken) {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Could not validate Twitch login.");
  return data;
}

function openLocalAppUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("Invalid local URL.");
  }

  const expectedPort = String(readConfig().port || DEFAULT_PORT);
  const host = url.hostname.toLowerCase();
  const port = url.port || (url.protocol === "http:" ? "80" : "443");
  const allowedHosts = new Set(["localhost", "127.0.0.1"]);

  if (url.protocol !== "http:" || !allowedHosts.has(host) || port !== expectedPort) {
    throw new Error("Only this app's local URLs can be opened here.");
  }

  return shell.openExternal(url.toString());
}

function openTwitchVerificationUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("Invalid Twitch verification URL.");
  }

  const allowedHosts = new Set(["twitch.tv", "www.twitch.tv", "id.twitch.tv"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Twitch returned an unexpected verification URL.");
  }

  return shell.openExternal(url.toString());
}
