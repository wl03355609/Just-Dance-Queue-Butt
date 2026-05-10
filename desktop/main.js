const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { startRuntime, stopRuntime } = require("../src/index");

const DEFAULT_PORT = 3000;
const DEFAULT_GAMES = ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "jdu", "plus"];
const CHAT_SCOPES = ["chat:read", "chat:edit"];

// Fill in your Twitch Developer App Client ID here before building.
// Register at https://dev.twitch.tv/console/apps — use Device Code Grant, no redirect URI needed.
// When non-empty, the Client ID field is hidden from users; they just click "Log in with Twitch".
const BUNDLED_CLIENT_ID = "rpfj350muhxl4ei1kl9glmbkbmea7w";

// Default channel shown in the channel dropdown.
// Users change this to their own channel after logging in with their own Twitch account.
const DEFAULT_CHANNEL = "qutebutt";

// Bot account credentials loaded from desktop/secrets.js (gitignored, never committed).
// Copy desktop/secrets.example.js → desktop/secrets.js and fill in the token before building.
let secrets = { BUNDLED_OAUTH_TOKEN: "", BUNDLED_BOT_USERNAME: "" };
try { secrets = require("./secrets"); } catch {}
const BUNDLED_OAUTH_TOKEN = String(secrets.BUNDLED_OAUTH_TOKEN || "").trim();
const BUNDLED_BOT_USERNAME = String(secrets.BUNDLED_BOT_USERNAME || "").trim();

let mainWindow = null;
let runtime = null;
let authPollTimer = null;

function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function getQueuePath() {
  return path.join(app.getPath("userData"), "queue.json");
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
  const hasBundledBot = Boolean(BUNDLED_OAUTH_TOKEN && BUNDLED_BOT_USERNAME);
  const overlayUrl = runtime?.urls?.overlay || `http://localhost:${port}`;
  const dashboardUrl = runtime?.urls?.dashboard || `http://localhost:${port}/dashboard`;

  return {
    clientId: config.clientId || BUNDLED_CLIENT_ID || "",
    hasBundledClientId: Boolean(BUNDLED_CLIENT_ID),
    hasBundledBot,
    bundledBotUsername: BUNDLED_BOT_USERNAME || "",
    botMode: config.botMode || (hasBundledBot ? "bundled" : "own"),
    username: config.username || "",
    channel: config.channel || DEFAULT_CHANNEL,
    defaultChannel: DEFAULT_CHANNEL,
    loggedIn: Boolean(config.accessToken),
    port,
    enabledGames: config.enabledGames || DEFAULT_GAMES,
    maxQueueSize: config.maxQueueSize || 50,
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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  clearTimeout(authPollTimer);
  stopRuntime();
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

    const useBundledBot = config.botMode === "bundled" && Boolean(BUNDLED_OAUTH_TOKEN) && Boolean(BUNDLED_BOT_USERNAME);

    let username, oauth;
    if (useBundledBot) {
      username = BUNDLED_BOT_USERNAME;
      oauth = BUNDLED_OAUTH_TOKEN;
    } else {
      const readyConfig = await ensureFreshToken(config);
      if (!readyConfig.accessToken) throw new Error("Log in with Twitch before starting the bot.");
      username = readyConfig.username;
      oauth = readyConfig.accessToken;
    }

    const channel = String(config.channel || username || "").trim().replace(/^#/, "").toLowerCase();
    if (!channel) throw new Error("Enter the Twitch channel to join.");

    stopRuntime();
    runtime = startRuntime({
      username,
      oauth,
      channel,
      port: config.port || DEFAULT_PORT,
      maxQueueSize: config.maxQueueSize || 50,
      enabledGames: config.enabledGames || DEFAULT_GAMES,
      modUsers: [channel, username].filter(Boolean),
      queuePath: getQueuePath()
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
