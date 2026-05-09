const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const tls = require("node:tls");

loadEnv();

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SONGS_PATH = path.join(ROOT, "data", "songs.json");
const QUEUE_PATH = path.join(ROOT, "data", "queue.json");
const DEFAULT_ENABLED_GAMES = ["2023", "2024", "2025", "2026", "plus"];
const GAME_LABELS = {
  "2023": "Just Dance 2023 Edition",
  "2024": "Just Dance 2024 Edition",
  "2025": "Just Dance 2025 Edition",
  "2026": "Just Dance 2026 Edition",
  plus: "Just Dance+"
};

let config = createConfig();
let songs = [];
let state = { queue: [], history: [] };
let clients = new Set();
let httpServer = null;
let twitch = null;
let reconnectTimer = null;
let twitchBuffer = Buffer.alloc(0);
let twitchReady = false;

if (require.main === module) {
  startRuntime();
}

module.exports = {
  startRuntime,
  stopRuntime,
  publicState,
  normalizeOAuth
};

function startRuntime(overrides = {}) {
  if (httpServer) return runtimeController();

  config = createConfig(overrides);
  songs = loadSongs();
  state = loadQueue();
  clients = new Set();
  startHttpServer();

  if (config.username && config.oauth && config.channel) {
    connectTwitch();
  } else {
    console.log("Twitch chat is not connected yet. Fill in Twitch values before starting chat.");
  }

  return runtimeController();
}

function stopRuntime() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  twitchReady = false;

  if (twitch) {
    twitch.removeAllListeners();
    twitch.end();
    twitch.destroy();
    twitch = null;
  }

  for (const client of clients) client.end();
  clients.clear();

  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

function runtimeController() {
  return {
    config,
    getState: publicState,
    stop: stopRuntime,
    urls: {
      overlay: `http://localhost:${config.port}`,
      dashboard: `http://localhost:${config.port}/dashboard`,
      songs: `http://localhost:${config.port}/api/songs`
    }
  };
}

function createConfig(overrides = {}) {
  const enabledGames = Array.isArray(overrides.enabledGames)
    ? overrides.enabledGames
    : listValue(overrides.enabledGames || process.env.ENABLED_GAMES, DEFAULT_ENABLED_GAMES);

  const modUsers = Array.isArray(overrides.modUsers)
    ? overrides.modUsers
    : listValue(overrides.modUsers || process.env.MOD_USERS, []);

  return {
    username: overrides.username ?? env("TWITCH_USERNAME", ""),
    oauth: normalizeOAuth(overrides.oauth ?? env("TWITCH_OAUTH", "")),
    channel: overrides.channel ?? env("TWITCH_CHANNEL", ""),
    port: numberValue(overrides.port ?? process.env.PORT, 3000),
    maxQueueSize: numberValue(overrides.maxQueueSize ?? process.env.MAX_QUEUE_SIZE, 50),
    enabledGames: sanitizeEnabledGames(enabledGames),
    modUsers,
    queuePath: overrides.queuePath || QUEUE_PATH
  };
}

function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function env(key, fallback) {
  return process.env[key] || fallback;
}

function numberEnv(key, fallback) {
  return numberValue(process.env[key], fallback);
}

function numberValue(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listEnv(key, fallback) {
  return listValue(process.env[key], fallback);
}

function listValue(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeOAuth(value) {
  const token = String(value || "").trim();
  if (!token) return "";
  return token.startsWith("oauth:") ? token : `oauth:${token}`;
}

function loadSongs() {
  const raw = JSON.parse(fs.readFileSync(SONGS_PATH, "utf8"));
  const enabled = new Set(config.enabledGames.map(gameKey));

  return raw
    .filter((song) => enabled.has(gameKey(song.game)))
    .map((song, index) => ({
      id: `${gameKey(song.game)}-${slug(song.title)}-${index}`,
      ...song,
      search: normalize(`${song.title} ${song.artist} ${song.game} ${song.originalGame || ""}`)
    }));
}

function gameOptions() {
  const counts = new Map(DEFAULT_ENABLED_GAMES.map((key) => [key, 0]));

  for (const song of JSON.parse(fs.readFileSync(SONGS_PATH, "utf8"))) {
    const key = gameKey(song.game);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }

  return DEFAULT_ENABLED_GAMES.map((key) => ({
    key,
    label: GAME_LABELS[key] || key,
    count: counts.get(key) || 0
  }));
}

function sanitizeEnabledGames(value) {
  const allowed = new Set(DEFAULT_ENABLED_GAMES);
  return [...new Set(listValue(value, DEFAULT_ENABLED_GAMES).map(gameKey))]
    .filter((key) => allowed.has(key));
}

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync(config.queuePath, "utf8"));
  } catch {
    return { queue: [], history: [] };
  }
}

function saveQueue() {
  fs.mkdirSync(path.dirname(config.queuePath), { recursive: true });
  fs.writeFileSync(config.queuePath, JSON.stringify(state, null, 2));
  broadcast();
}

function startHttpServer() {
  httpServer = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/queue") return sendJson(response, publicState());
    if (url.pathname === "/api/songs") return sendJson(response, { songs });
    if (url.pathname === "/api/search") return searchSongs(url, response);
    if (request.method === "POST") {
      const ct = request.headers["content-type"] || "";
      if (!ct.startsWith("application/json")) return sendError(response, 415, "Content-Type must be application/json.");
      if (url.pathname === "/api/request") return apiRequestSong(request, response);
      if (url.pathname === "/api/skip") return apiSkipSong(response);
      if (url.pathname === "/api/remove") return apiRemoveSong(request, response);
      if (url.pathname === "/api/clear") return apiClearQueue(response);
      if (url.pathname === "/api/filters") return apiUpdateFilters(request, response);
    }
    if (url.pathname === "/events") return streamEvents(request, response);

    const filePath = safePublicPath(routePath(url.pathname));
    if (!filePath) return notFound(response);

    fs.readFile(filePath, (error, data) => {
      if (error) return notFound(response);
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(data);
    });
  });

  httpServer.on("error", (error) => {
    console.error(`Could not start local queue server on port ${config.port}: ${error.message}`);
    console.error("Try changing PORT in .env, for example PORT=3001.");
    process.exitCode = 1;
  });

  httpServer.listen(config.port, "127.0.0.1", () => {
    console.log(`Queue overlay: http://localhost:${config.port}`);
    console.log(`Dashboard:     http://localhost:${config.port}/dashboard`);
    console.log(`Song API:      http://localhost:${config.port}/api/songs`);
  });
}

function routePath(urlPath) {
  if (urlPath === "/") return "/index.html";
  if (urlPath === "/dashboard") return "/dashboard.html";
  return urlPath;
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const resolved = path.resolve(PUBLIC_DIR, `.${decoded}`);
  // startsWith(PUBLIC_DIR) alone is insufficient — a sibling directory whose
  // name starts with "public" (e.g. "public-evil") would pass that check.
  // Require a trailing separator so only true children are allowed.
  const safe = resolved === PUBLIC_DIR || resolved.startsWith(PUBLIC_DIR + path.sep);
  return safe ? resolved : null;
}

function streamEvents(_request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  clients.add(response);
  response.write(`data: ${JSON.stringify(publicState())}\n\n`);
  response.on("close", () => clients.delete(response));
}

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const client of clients) client.write(payload);
}

function publicState() {
  return {
    queue: state.queue,
    history: state.history.slice(0, 10),
    totalSongs: songs.length,
    enabledGames: config.enabledGames,
    availableGames: gameOptions(),
    maxQueueSize: config.maxQueueSize,
    channel: config.channel,
    botConnected: twitchReady
  };
}

function sendJson(response, data) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data, null, 2));
}

function sendError(response, status, message) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: false, message }, null, 2));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function searchSongs(url, response) {
  const query = url.searchParams.get("q") || "";
  const normalized = normalize(query);
  const results = songs
    .map((song) => ({ song: stripSearch(song), score: normalized ? scoreSong(normalized, song) : 0 }))
    .filter((result) => !normalized || result.score >= 0.25)
    .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title))
    .slice(0, 25);

  sendJson(response, { results });
}

async function apiRequestSong(request, response) {
  try {
    const body = await readJsonBody(request);
    const result = addRequest(body.user || "dashboard", body.song || body.query || "", { announce: false });
    if (!result.ok) return sendError(response, result.status || 400, result.message);
    sendJson(response, { ok: true, ...result, state: publicState() });
  } catch (error) {
    sendError(response, 400, error.message);
  }
}

function apiSkipSong(response) {
  const result = skipSong({ announce: true });
  if (!result.ok) return sendError(response, result.status || 400, result.message);
  sendJson(response, { ok: true, ...result, state: publicState() });
}

async function apiRemoveSong(request, response) {
  try {
    const body = await readJsonBody(request);
    const result = removeQueueEntry(body.id, body.position, { announce: false });
    if (!result.ok) return sendError(response, result.status || 400, result.message);
    sendJson(response, { ok: true, ...result, state: publicState() });
  } catch (error) {
    sendError(response, 400, error.message);
  }
}

function apiClearQueue(response) {
  const result = clearQueue({ announce: true });
  if (!result.ok) return sendError(response, result.status || 400, result.message);
  sendJson(response, { ok: true, ...result, state: publicState() });
}

async function apiUpdateFilters(request, response) {
  try {
    const body = await readJsonBody(request);
    const nextEnabledGames = sanitizeEnabledGames(body.enabledGames);
    if (!nextEnabledGames.length) return sendError(response, 400, "Choose at least one game catalog.");

    config.enabledGames = nextEnabledGames;
    songs = loadSongs();
    broadcast();

    sendJson(response, {
      ok: true,
      message: `Filters updated. ${songs.length} songs are requestable.`,
      state: publicState()
    });
  } catch (error) {
    sendError(response, 400, error.message);
  }
}

function notFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".json")) return "application/json";
  return "text/html";
}

function connectTwitch() {
  clearTimeout(reconnectTimer);
  twitchBuffer = Buffer.alloc(0);
  twitchReady = false;

  if (twitch) {
    twitch.removeAllListeners();
    twitch.destroy();
    twitch = null;
  }

  twitch = tls.connect({
    host: "irc-ws.chat.twitch.tv",
    port: 443,
    servername: "irc-ws.chat.twitch.tv"
  }, () => {
    const key = crypto.randomBytes(16).toString("base64");
    twitch.write([
      "GET / HTTP/1.1",
      "Host: irc-ws.chat.twitch.tv",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n"));
  });

  twitch.on("data", onTwitchWebSocketData);
  twitch.on("error", (error) => console.error("Twitch connection error:", error.message));
  twitch.on("close", scheduleReconnect);
}

function onTwitchWebSocketData(chunk) {
  twitchBuffer = Buffer.concat([twitchBuffer, chunk]);

  if (!twitchReady) {
    const headerEnd = twitchBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = twitchBuffer.slice(0, headerEnd).toString("utf8");
    twitchBuffer = twitchBuffer.slice(headerEnd + 4);

    if (!header.startsWith("HTTP/1.1 101")) {
      console.error("Twitch WebSocket upgrade failed.");
      twitch.end();
      return;
    }

    twitchReady = true;
    console.log(`Connected to Twitch chat as ${config.username}.`);
    writeIrc(`PASS ${config.oauth}`);
    writeIrc(`NICK ${config.username}`);
    writeIrc("CAP REQ :twitch.tv/tags twitch.tv/commands");
    writeIrc(`JOIN #${config.channel.toLowerCase()}`);
  }

  let frame;
  while ((frame = readWebSocketFrame()) !== null) {
    if (frame.opcode === 0x1) onTwitchData(frame.payload.toString("utf8"));
    if (frame.opcode === 0x8) twitch.end();
    if (frame.opcode === 0x9) twitch.write(createWebSocketFrame(frame.payload, 0xA));
  }
}

function readWebSocketFrame() {
  if (twitchBuffer.length < 2) return null;

  const first = twitchBuffer[0];
  const second = twitchBuffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (twitchBuffer.length < offset + 2) return null;
    length = twitchBuffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (twitchBuffer.length < offset + 8) return null;
    length = Number(twitchBuffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let mask;
  if (masked) {
    if (twitchBuffer.length < offset + 4) return null;
    mask = twitchBuffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (twitchBuffer.length < offset + length) return null;

  const payload = Buffer.from(twitchBuffer.slice(offset, offset + length));
  twitchBuffer = twitchBuffer.slice(offset + length);

  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return { opcode, payload };
}

function createWebSocketFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const mask = crypto.randomBytes(4);
  let header;

  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  const maskedPayload = Buffer.from(payload);
  for (let index = 0; index < maskedPayload.length; index += 1) {
    maskedPayload[index] ^= mask[index % 4];
  }

  return Buffer.concat([header, mask, maskedPayload]);
}

function scheduleReconnect() {
  if (!config.username || !config.oauth || !config.channel) return;
  reconnectTimer = setTimeout(connectTwitch, 5000);
}

function onTwitchData(chunk) {
  for (const line of chunk.split("\r\n").filter(Boolean)) {
    if (line.startsWith("PING")) {
      writeIrc("PONG :tmi.twitch.tv");
      continue;
    }

    const message = parsePrivmsg(line);
    if (message) handleCommand(message);
  }
}

function parsePrivmsg(line) {
  const match = line.match(/^(?:@([^ ]+) )?:(\w+)!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #\w+ :(.+)$/);
  if (!match) return null;

  const tags = Object.fromEntries(
    (match[1] || "").split(";").filter(Boolean).map((tag) => {
      const [key, value = ""] = tag.split("=");
      return [key, value];
    })
  );

  return {
    user: match[2],
    text: match[3].trim(),
    tags
  };
}

function handleCommand(message) {
  const [command, ...parts] = message.text.split(" ");
  const arg = parts.join(" ").trim();
  const lower = command.toLowerCase();

  if (lower === "!sr" || lower === "!songrequest") return requestSong(message, arg);
  if (lower === "!queue") return say(queueSummary());
  if (lower === "!leave") return leaveQueue(message.user);
  if (!isMod(message)) return;

  if (lower === "!skip" || lower === "!next") return skipSong();
  if (lower === "!remove") return removeSong(arg);
  if (lower === "!clear") return clearQueue();
  if (lower === "!song") return say(currentSongSummary());
}

function requestSong(message, query) {
  addRequest(message.user, query, { announce: true });
}

function addRequest(user, query, options = {}) {
  const { announce = true } = options;
  const requester = String(user || "viewer").trim().replace(/^@/, "") || "viewer";

  if (!query) {
    const message = `@${requester} usage: !sr song name`;
    if (announce) say(message);
    return { ok: false, status: 400, message };
  }

  if (state.queue.length >= config.maxQueueSize) {
    const message = `@${requester} the queue is full right now.`;
    if (announce) say(message);
    return { ok: false, status: 409, message };
  }

  const existing = state.queue.find((entry) => entry.user.toLowerCase() === requester.toLowerCase());
  if (existing) {
    const message = `@${requester} you are already in queue at #${state.queue.indexOf(existing) + 1}: ${existing.song.title}. Use !leave to remove it.`;
    if (announce) say(message);
    return { ok: false, status: 409, message };
  }

  const match = findSong(query);
  if (!match) {
    const message = `@${requester} I could not find "${query}" in the enabled Just Dance catalog.`;
    if (announce) say(message);
    return { ok: false, status: 404, message };
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user: requester,
    song: stripSearch(match.song),
    requestedAt: new Date().toISOString()
  };

  state.queue.push(entry);
  saveQueue();
  const message = `@${requester} added #${state.queue.length}: ${entry.song.title} - ${entry.song.artist} (${entry.song.game}).`;
  if (announce) say(message);
  return { ok: true, status: 200, message, entry };
}

function findSong(query) {
  const normalized = normalize(query);
  const exact = songs.find((song) => normalize(song.title) === normalized);
  if (exact) return { song: exact, score: 1 };

  let best = null;
  for (const song of songs) {
    const score = scoreSong(normalized, song);
    if (!best || score > best.score) best = { song, score };
  }

  return best && best.score >= 0.34 ? best : null;
}

function scoreSong(query, song) {
  if (song.search.includes(query)) return 0.92;

  const queryTokens = new Set(query.split(" ").filter(Boolean));
  const songTokens = new Set(song.search.split(" ").filter(Boolean));
  const overlap = [...queryTokens].filter((token) => songTokens.has(token)).length;
  const tokenScore = overlap / Math.max(queryTokens.size, 1);
  const distanceScore = 1 - levenshtein(query, normalize(song.title)) / Math.max(query.length, song.title.length, 1);

  return Math.max(tokenScore * 0.8, distanceScore);
}

function leaveQueue(user) {
  const index = state.queue.findIndex((entry) => entry.user.toLowerCase() === user.toLowerCase());
  if (index === -1) {
    say(`@${user} you are not in the queue.`);
    return;
  }

  const [removed] = state.queue.splice(index, 1);
  saveQueue();
  say(`@${user} removed ${removed.song.title} from the queue.`);
}

function skipSong(options = {}) {
  const { announce = true } = options;
  const next = state.queue.shift();
  if (!next) {
    const message = "The queue is empty.";
    if (announce) say(message);
    return { ok: false, status: 409, message };
  }

  state.history.unshift({ ...next, playedAt: new Date().toISOString() });
  state.history = state.history.slice(0, 25);
  saveQueue();
  const message = `Now playing: ${next.song.title} - ${next.song.artist}, requested by @${next.user}.`;
  if (announce) say(message);
  return { ok: true, status: 200, message, entry: next };
}

function removeSong(position) {
  removeQueueEntry(null, position, { announce: true });
}

function removeQueueEntry(id, position, options = {}) {
  const { announce = true } = options;
  let index = -1;

  if (id) {
    index = state.queue.findIndex((entry) => entry.id === id);
  } else {
    index = Number.parseInt(position, 10) - 1;
  }

  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) {
    const message = "Usage: !remove queue-number";
    if (announce) say(message);
    return { ok: false, status: 400, message };
  }

  const [removed] = state.queue.splice(index, 1);
  saveQueue();
  const message = `Removed #${index + 1}: ${removed.song.title}, requested by @${removed.user}.`;
  if (announce) say(message);
  return { ok: true, status: 200, message, entry: removed };
}

function clearQueue(options = {}) {
  const { announce = true } = options;
  state.queue = [];
  saveQueue();
  const message = "Queue cleared.";
  if (announce) say(message);
  return { ok: true, status: 200, message };
}

function queueSummary() {
  if (!state.queue.length) return "The queue is empty. Use !sr song name to request a Just Dance song.";

  return state.queue
    .slice(0, 5)
    .map((entry, index) => `#${index + 1} ${entry.song.title} (@${entry.user})`)
    .join(" | ");
}

function currentSongSummary() {
  if (!state.history.length) return "No songs have been marked as played yet.";
  const current = state.history[0];
  return `Last played: ${current.song.title} - ${current.song.artist}, requested by @${current.user}.`;
}

function isMod(message) {
  const user = message.user.toLowerCase();
  const badges = message.tags.badges || "";

  return (
    user === config.channel.toLowerCase() ||
    config.modUsers.map((mod) => mod.toLowerCase()).includes(user) ||
    badges.includes("broadcaster/") ||
    badges.includes("moderator/")
  );
}

function writeIrc(line) {
  if (twitch && twitch.writable && twitchReady) {
    twitch.write(createWebSocketFrame(`${line}\r\n`));
  }
}

function say(text) {
  console.log(`[chat] ${text}`);
  if (!twitch || !twitch.writable || !config.channel) return;
  writeIrc(`PRIVMSG #${config.channel.toLowerCase()} :${text.slice(0, 480)}`);
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function gameKey(value) {
  if (String(value).toLowerCase().includes("+")) return "plus";

  const normalized = normalize(value);
  if (normalized === "plus" || normalized.includes("dance plus")) return "plus";

  const year = normalized.match(/\b20\d{2}\b/);
  return year ? year[0] : normalized;
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function stripSearch(song) {
  const { search, ...publicSong } = song;
  return publicSong;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return matrix[a.length][b.length];
}
