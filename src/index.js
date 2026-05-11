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
const MUTATING_API_PATHS = new Set(["/api/request", "/api/skip", "/api/remove", "/api/clear", "/api/filters", "/api/theme", "/api/pick", "/api/promote"]);
const MAX_QUERY_LENGTH = 200;
const MIN_SEARCH_LENGTH = 3;
const MIN_REQUEST_MATCH_SCORE = 0.5;
const DEFAULT_OVERLAY_THEME = "dark";
const GENERIC_MATCH_TOKENS = new Set(["song", "dance", "just", "version", "remix", "edition"]);
const DEFAULT_ENABLED_GAMES = ["jd1", "jd2", "jd3", "jd4", "2014", "2015", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "jdu", "plus", "abba"];
const FILTER_OPTIONS = [...DEFAULT_ENABLED_GAMES, "youtube"];
const GAME_LABELS = {
  jd1: "Just Dance",
  jd2: "Just Dance 2",
  jd3: "Just Dance 3",
  jd4: "Just Dance 4",
  "2014": "Just Dance 2014",
  "2015": "Just Dance 2015",
  "2017": "Just Dance 2017",
  "2018": "Just Dance 2018",
  "2019": "Just Dance 2019",
  "2020": "Just Dance 2020",
  "2021": "Just Dance 2021",
  "2022": "Just Dance 2022",
  "2023": "Just Dance 2023 Edition",
  "2024": "Just Dance 2024 Edition",
  "2025": "Just Dance 2025 Edition",
  "2026": "Just Dance 2026 Edition",
  jdu: "Just Dance Unlimited",
  plus: "Just Dance+",
  abba: "ABBA: You Can Dance",
  youtube: "YouTube"
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
  clearQueueState,
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
    clearState: clearQueueState,
    clearHistory: clearHistoryState,
    stop: stopRuntime,
    urls: {
      overlay: `http://localhost:${config.port}`,
      dashboard: `http://localhost:${config.port}/dashboard?token=${encodeURIComponent(config.adminToken)}`,
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
    username: sanitizeTwitchName(overrides.username ?? env("TWITCH_USERNAME", "")),
    oauth: normalizeOAuth(overrides.oauth ?? env("TWITCH_OAUTH", "")),
    channel: sanitizeTwitchName(overrides.channel ?? env("TWITCH_CHANNEL", "")),
    port: numberValue(overrides.port ?? process.env.PORT, 3000),
    maxQueueSize: numberValue(overrides.maxQueueSize ?? process.env.MAX_QUEUE_SIZE, 50),
    enabledGames: sanitizeEnabledGames(enabledGames),
    modUsers: modUsers.map(sanitizeTwitchName).filter(Boolean),
    adminToken: cleanSecret(overrides.adminToken ?? env("ADMIN_TOKEN", "")) || crypto.randomBytes(24).toString("hex"),
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
  const token = cleanSecret(value);
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
  const counts = new Map(FILTER_OPTIONS.map((key) => [key, 0]));

  for (const song of JSON.parse(fs.readFileSync(SONGS_PATH, "utf8"))) {
    const key = gameKey(song.game);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }

  return FILTER_OPTIONS.map((key) => ({
    key,
    label: GAME_LABELS[key] || key,
    count: key === "youtube" ? null : counts.get(key) || 0
  }));
}

function sanitizeEnabledGames(value) {
  const allowed = new Set(FILTER_OPTIONS);
  return [...new Set(listValue(value, DEFAULT_ENABLED_GAMES).map(gameKey))]
    .filter((key) => allowed.has(key));
}

function loadQueue() {
  try {
    return normalizeQueueState(JSON.parse(fs.readFileSync(config.queuePath, "utf8")));
  } catch {
    return normalizeQueueState();
  }
}

function saveQueue() {
  fs.mkdirSync(path.dirname(config.queuePath), { recursive: true });
  fs.writeFileSync(config.queuePath, JSON.stringify(state, null, 2));
  broadcast();
}

function clearQueueState() {
  state = { ...state, queue: [], history: [] };
  saveQueue();
  return publicState();
}

function clearHistoryState() {
  state = { ...state, history: [] };
  saveQueue();
  return publicState();
}

function normalizeQueueState(value = {}) {
  return {
    queue: Array.isArray(value.queue) ? value.queue : [],
    history: Array.isArray(value.history) ? value.history : [],
    overlayTheme: sanitizeOverlayTheme(value.overlayTheme)
  };
}

function startHttpServer() {
  httpServer = http.createServer((request, response) => {
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch {
      return sendError(response, 400, "Invalid request URL.");
    }

    if (url.pathname === "/api/queue") return sendJson(response, publicState());
    if (url.pathname === "/api/songs") return sendJson(response, { songs });
    if (url.pathname === "/api/search") return searchSongs(url, response);
    if (request.method === "POST") {
      if (MUTATING_API_PATHS.has(url.pathname) && !isAdminRequest(request, url)) {
        return sendError(response, 403, "Dashboard token is missing or invalid.");
      }
      const ct = request.headers["content-type"] || "";
      if (!ct.startsWith("application/json")) return sendError(response, 415, "Content-Type must be application/json.");
      if (url.pathname === "/api/request") return apiRequestSong(request, response);
      if (url.pathname === "/api/skip") return apiSkipSong(response);
      if (url.pathname === "/api/remove") return apiRemoveSong(request, response);
      if (url.pathname === "/api/clear") return apiClearQueue(response);
      if (url.pathname === "/api/filters") return apiUpdateFilters(request, response);
      if (url.pathname === "/api/theme") return apiUpdateTheme(request, response);
      if (url.pathname === "/api/pick" || url.pathname === "/api/promote") return apiPickSong(request, response);
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
    console.log(`Dashboard:     http://localhost:${config.port}/dashboard?token=${encodeURIComponent(config.adminToken)}`);
    console.log(`Song API:      http://localhost:${config.port}/api/songs`);
  });
}

function routePath(urlPath) {
  if (urlPath === "/") return "/index.html";
  if (urlPath === "/dashboard") return "/dashboard.html";
  return urlPath;
}

function safePublicPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
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
    overlayTheme: state.overlayTheme || DEFAULT_OVERLAY_THEME,
    channel: config.channel,
    botConnected: twitchReady
  };
}

function sendJson(response, data) {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data, null, 2));
}

function sendError(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify({ ok: false, message }, null, 2));
}

function isAdminRequest(request, url) {
  const expected = config.adminToken;
  if (!expected) return false;

  const headerToken = headerValue(request.headers["x-queue-admin"]);
  const auth = headerValue(request.headers.authorization);
  const bearerToken = auth.replace(/^Bearer\s+/i, "");
  const queryToken = url.searchParams.get("token") || "";

  return [headerToken, bearerToken, queryToken]
    .map(cleanSecret)
    .some((token) => timingSafeEqual(token, expected));
}

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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
  const query = cleanSearchQuery(url.searchParams.get("q") || "");
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
    const result = await addRequest(body.user || "test", body.song || body.query || "", { announce: false });
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

async function apiPickSong(request, response) {
  try {
    const body = await readJsonBody(request);
    const result = pickSong(body.id, body.position, { announce: true });
    if (!result.ok) return sendError(response, result.status || 400, result.message);
    sendJson(response, { ok: true, ...result, state: publicState() });
  } catch (error) {
    sendError(response, 400, error.message);
  }
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
      message: filterSummary(),
      state: publicState()
    });
  } catch (error) {
    sendError(response, 400, error.message);
  }
}

async function apiUpdateTheme(request, response) {
  try {
    const body = await readJsonBody(request);
    state.overlayTheme = sanitizeOverlayTheme(body.overlayTheme || body.theme);
    saveQueue();

    sendJson(response, {
      ok: true,
      message: `Overlay theme set to ${state.overlayTheme}.`,
      state: publicState()
    });
  } catch (error) {
    sendError(response, 400, error.message);
  }
}

function sanitizeOverlayTheme(value) {
  return value === "light" ? "light" : DEFAULT_OVERLAY_THEME;
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
  if (lower === "!random") return randomSong(message, arg);
  if (lower === "!queue") return say(queueSummary());
  if (lower === "!leave") return leaveQueue(message.user);
  if (lower === "!pick" && arg.toLowerCase() === "random") {
    if (isStreamer(message)) return pickRandomSong({ announce: true });
    return;
  }
  if (!isMod(message)) return;

  if (lower === "!skip" || lower === "!next") return skipSong();
  if (lower === "!remove") return removeSong(arg);
  if (lower === "!clear") return clearQueue();
  if (lower === "!song") return say(currentSongSummary());
}

function requestSong(message, query) {
  addRequest(message.user, query, { announce: true }).catch(console.error);
}

function randomSong(message, arg) {
  const requester = message.user;

  if (state.queue.length >= config.maxQueueSize) {
    say(`@${requester} the queue is full right now.`);
    return;
  }

  const existing = state.queue.find((entry) => entry.user.toLowerCase() === requester.toLowerCase());
  if (existing) {
    say(`@${requester} you are already in queue at #${state.queue.indexOf(existing) + 1}: ${existing.song.title}. Use !leave to remove it.`);
    return;
  }

  let pool = songs;
  if (arg) {
    const filter = parseRandomFilter(arg);
    if (!filter) {
      say(`@${requester} unrecognized filter. Try !random, !random 2021, !random JD+, or !random JD+ 2023.`);
      return;
    }
    pool = songs.filter((song) => {
      if (gameKey(song.game) !== filter.gameFilter) return false;
      if (!filter.yearFilter) return true;
      return song.originalGame && song.originalGame.includes(filter.yearFilter);
    });
  }

  const queuedIds = new Set(state.queue.map((entry) => entry.song.id));
  pool = pool.filter((song) => !queuedIds.has(song.id));

  if (!pool.length) {
    say(`@${requester} no songs available for that filter — all matching songs are already in the queue.`);
    return;
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];
  addQueueEntry(requester, stripSearch(pick), true);
}

function parseRandomFilter(arg) {
  const yearMatch = arg.match(/\b(20\d{2})\b/);
  const yearFilter = yearMatch ? yearMatch[1] : null;
  const gameArg = arg.replace(/\b20\d{2}\b/, "").trim();

  if (gameArg) {
    const key = gameKey(gameArg);
    if (!FILTER_OPTIONS.includes(key) || key === "youtube") return null;
    return { gameFilter: key, yearFilter };
  }

  if (yearFilter && FILTER_OPTIONS.includes(yearFilter)) {
    return { gameFilter: yearFilter, yearFilter: null };
  }

  return null;
}

async function addRequest(user, query, options = {}) {
  const { announce = true } = options;
  const requester = cleanChatText(user || "viewer").replace(/^@/, "").slice(0, 50) || "viewer";
  const requestedSong = cleanSearchQuery(query);

  if (!requestedSong) {
    const message = `@${requester} usage: !sr song name`;
    if (announce) say(message);
    return { ok: false, status: 400, message };
  }

  if (requestedSong.length < MIN_SEARCH_LENGTH) {
    const message = `@${requester} please be more specific — type at least part of the song name.`;
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

  if (isAnyUrl(requestedSong)) {
    const youtubeUrl = extractYoutubeUrl(requestedSong);
    if (!youtubeUrl) {
      const message = `@${requester} Sorry, we meant YouTube requests, not random porn.`;
      if (announce) say(message);
      return { ok: false, status: 400, message };
    }
    if (!isYoutubeEnabled()) {
      const message = `@${requester} YouTube requests are not enabled.`;
      if (announce) say(message);
      return { ok: false, status: 400, message };
    }
    const title = await fetchYoutubeTitle(youtubeUrl);
    if (!title) {
      const message = `@${requester} couldn't find that YouTube video — make sure it's public.`;
      if (announce) say(message);
      return { ok: false, status: 404, message };
    }
    const song = youtubeSong(title);
    const dup = state.queue.find((e) => e.song.id === song.id || normalize(e.song.title) === normalize(song.title));
    if (dup) {
      const pos = state.queue.indexOf(dup) + 1;
      const message = `@${requester} "${dup.song.title}" is already in the queue at #${pos}, requested by @${dup.user}.`;
      if (announce) say(message);
      return { ok: false, status: 409, message };
    }
    return addQueueEntry(requester, song, announce);
  }

  const match = findSong(requestedSong);

  let song;
  if (match) {
    song = stripSearch(match.song);
  } else if (isYoutubeEnabled()) {
    song = youtubeSong(requestedSong);
  } else {
    const message = `@${requester} The request: "${requestedSong}" is not available in ${config.channel}'s filtered games.`;
    if (announce) say(message);
    return { ok: false, status: 404, message };
  }

  const duplicate = state.queue.find((entry) => entry.song.id === song.id || normalize(entry.song.title) === normalize(song.title));
  if (duplicate) {
    const pos = state.queue.indexOf(duplicate) + 1;
    const message = `@${requester} "${duplicate.song.title}" is already in the queue at #${pos}, requested by @${duplicate.user}.`;
    if (announce) say(message);
    return { ok: false, status: 409, message };
  }

  return addQueueEntry(requester, song, announce);
}

function addQueueEntry(requester, song, announce) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user: requester,
    song,
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

  return best && best.score >= MIN_REQUEST_MATCH_SCORE ? best : null;
}

function scoreSong(query, song) {
  if (song.search.includes(query)) return 0.92;

  const queryTokens = new Set(query.split(" ").filter(Boolean));
  const songTokens = new Set(song.search.split(" ").filter(Boolean));
  const overlappingTokens = [...queryTokens].filter((token) => songTokens.has(token));
  const overlap = overlappingTokens.length;
  const tokenScore = overlap / Math.max(queryTokens.size, 1);
  const distanceScore = 1 - levenshtein(query, normalize(song.title)) / Math.max(query.length, song.title.length, 1);

  if (hasMissingNumericToken(queryTokens, songTokens)) return 0;
  if (queryTokens.size > 1 && overlap > 0 && overlappingTokens.every((token) => GENERIC_MATCH_TOKENS.has(token))) return 0;
  if (queryTokens.size > 1 && overlap === 0 && distanceScore < 0.75) return 0;

  return Math.max(tokenScore * 0.8, distanceScore);
}

function hasMissingNumericToken(queryTokens, songTokens) {
  return [...queryTokens].some((token) => /^\d+$/.test(token) && !songTokens.has(token));
}

function isYoutubeEnabled() {
  return config.enabledGames.includes("youtube");
}

function isAnyUrl(text) {
  return /^https?:\/\//i.test(text);
}

function extractYoutubeUrl(text) {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/i.test(text) ? text : null;
}

async function fetchYoutubeTitle(url) {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.title === "string" && data.title ? data.title : null;
  } catch {
    return null;
  }
}

function youtubeSong(title) {
  return {
    id: `youtube-${slug(title)}`,
    title,
    artist: "YouTube",
    game: "YouTube"
  };
}

function filterSummary() {
  const youtubeEnabled = isYoutubeEnabled();
  const suffix = youtubeEnabled ? " YouTube requests are enabled." : "";
  return `Filters updated. ${songs.length} catalog songs are requestable.${suffix}`;
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
  return pickQueueEntryAt(0, options);
}

function pickSong(id, position, options = {}) {
  let index = -1;

  if (id) {
    index = state.queue.findIndex((entry) => entry.id === id);
  } else {
    index = Number.parseInt(position, 10) - 1;
  }

  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) {
    const message = "Entry not found in queue.";
    return { ok: false, status: 404, message };
  }

  return pickQueueEntryAt(index, options);
}

function pickRandomSong(options = {}) {
  if (!state.queue.length) {
    const message = "The queue is empty.";
    if (options.announce !== false) say(message);
    return { ok: false, status: 409, message };
  }

  const index = Math.floor(Math.random() * state.queue.length);
  return pickQueueEntryAt(index, options);
}

function pickQueueEntryAt(index, options = {}) {
  const { announce = true } = options;
  const [next] = state.queue.splice(index, 1);
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

function isStreamer(message) {
  const user = message.user.toLowerCase();
  const badges = message.tags.badges || "";
  return user === config.channel.toLowerCase() || badges.includes("broadcaster/");
}

function writeIrc(line) {
  if (twitch && twitch.writable && twitchReady) {
    const safeLine = cleanIrcLine(line);
    if (!safeLine) return;
    twitch.write(createWebSocketFrame(`${safeLine}\r\n`));
  }
}

function say(text) {
  const safeText = cleanChatText(text).slice(0, 480);
  if (!safeText) return;
  console.log(`[chat] ${safeText}`);
  if (!twitch || !twitch.writable || !config.channel) return;
  writeIrc(`PRIVMSG #${config.channel.toLowerCase()} :${safeText}`);
}

function cleanSecret(value) {
  return String(value || "").trim().replace(/[\r\n]/g, "");
}

function cleanSearchQuery(value) {
  return cleanChatText(value).slice(0, MAX_QUERY_LENGTH);
}

function cleanChatText(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIrcLine(value) {
  return String(value || "").replace(/[\r\n\u0000]/g, "");
}

function sanitizeTwitchName(value) {
  return String(value || "")
    .trim()
    .replace(/^[@#]/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
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
  const raw = String(value).toLowerCase();
  if (raw.includes("+")) return "plus";
  if (raw.includes("unlimited")) return "jdu";

  const normalized = normalize(value);
  if (normalized === "plus" || normalized.includes("dance plus")) return "plus";
  if (normalized === "jdu" || normalized.includes("dance unlimited")) return "jdu";
  if (normalized.includes("abba")) return "abba";

  if (/^(jd1|just dance 1|just dance)$/.test(normalized)) return "jd1";
  if (/^(jd2|just dance 2)$/.test(normalized)) return "jd2";
  if (/^(jd3|just dance 3)$/.test(normalized)) return "jd3";
  if (/^(jd4|just dance 4)$/.test(normalized)) return "jd4";

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
