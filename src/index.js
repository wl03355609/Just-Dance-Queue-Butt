const { loadEnv, normalizeOAuth, lanUrls } = require("./util");

loadEnv();

const { DEFAULT_OVERLAY_THEME } = require("./constants");
const { createConfig } = require("./config");
const { createSongs } = require("./songs");
const { createQueue } = require("./queue");
const { createTwitch } = require("./twitch");
const { createCommands } = require("./commands");
const { createServer } = require("./server");

const runtime = {
  config: null,
  catalog: [],
  state: { queue: [], history: [], overlayTheme: DEFAULT_OVERLAY_THEME },
  http: { server: null, clients: new Set() },
  bot: { socket: null, buffer: Buffer.alloc(0), ready: false, reconnectTimer: null },
  companion: { pairingCode: "", pairingExpiresAt: 0, pairingAttempts: 0 },
  songs: null,
  queue: null,
  twitch: null,
  commands: null,
  server: null
};

runtime.songs = createSongs(runtime);
runtime.queue = createQueue(runtime);
runtime.twitch = createTwitch(runtime);
runtime.commands = createCommands(runtime);
runtime.server = createServer(runtime);

if (require.main === module) {
  startRuntime();
}

module.exports = {
  startRuntime,
  stopRuntime,
  publicState,
  clearQueueState,
  normalizeOAuth
};

function startRuntime(overrides = {}) {
  if (runtime.http.server) return runtimeController();

  runtime.config = createConfig(overrides);
  runtime.songs.loadSongs();
  Object.assign(runtime.state, runtime.queue.loadQueue());
  runtime.http.clients = new Set();
  runtime.server.startHttpServer();

  if (runtime.config.username && runtime.config.oauth && runtime.config.channel) {
    runtime.twitch.connectTwitch();
  } else {
    console.log("Twitch chat is not connected yet. Fill in Twitch values before starting chat.");
  }

  return runtimeController();
}

function stopRuntime() {
  runtime.twitch.stopTwitch();
  runtime.server.stopHttpServer();
}

function runtimeController() {
  const companionUrls = runtime.config.companionAccess ? lanUrls(runtime.config.port) : [];
  return {
    config: runtime.config,
    getState: runtime.server.publicState,
    clearState: runtime.queue.clearQueueState,
    clearHistory: runtime.queue.clearHistoryState,
    createCompanionPairingCode: runtime.server.createCompanionPairingCode,
    stop: stopRuntime,
    urls: {
      overlay: `http://localhost:${runtime.config.port}`,
      dashboard: `http://localhost:${runtime.config.port}/dashboard?token=${encodeURIComponent(runtime.config.adminToken)}`,
      songs: `http://localhost:${runtime.config.port}/api/songs`,
      companion: companionUrls[0] || "",
      companionUrls
    }
  };
}

function publicState() {
  return runtime.server.publicState();
}

function clearQueueState() {
  return runtime.queue.clearQueueState();
}
