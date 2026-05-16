const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const {
  PUBLIC_DIR,
  MUTATING_API_PATHS,
  DEFAULT_OVERLAY_THEME
} = require("./constants");

const {
  cleanSearchQuery,
  normalize,
  stripSearch,
  headerValue,
  timingSafeEqual,
  cleanSecret,
  lanUrls
} = require("./util");

const {
  sanitizeEnabledGames
} = require("./config");

function createServer(runtime) {
  function startHttpServer() {
    runtime.http.server = http.createServer((request, response) => {
      let url;
      try {
        url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      } catch {
        return sendError(response, 400, "Invalid request URL.");
      }

      if (url.pathname === "/api/queue") return sendJson(response, publicState());
      if (url.pathname === "/api/songs") return sendJson(response, { songs: runtime.catalog });
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

    runtime.http.server.on("error", (error) => {
      console.error(`Could not start local queue server on port ${runtime.config.port}: ${error.message}`);
      console.error("Try changing PORT in .env, for example PORT=3001.");
      process.exitCode = 1;
    });

    const host = runtime.config.companionAccess ? "0.0.0.0" : "127.0.0.1";
    runtime.http.server.listen(runtime.config.port, host, () => {
      console.log(`Queue overlay: http://localhost:${runtime.config.port}`);
      console.log(`Dashboard:     http://localhost:${runtime.config.port}/dashboard?token=${encodeURIComponent(runtime.config.adminToken)}`);
      console.log(`Song API:      http://localhost:${runtime.config.port}/api/songs`);
      if (runtime.config.companionAccess) {
        const urls = lanUrls(runtime.config.port);
        if (urls.length) {
          console.log("Phone companion:");
          for (const url of urls) console.log(`  ${url}`);
        } else {
          console.log("Phone companion: enabled, but no LAN IPv4 address was found.");
        }
      } else {
        console.log("Phone companion: disabled.");
      }
    });
  }

  function stopHttpServer() {
    for (const client of runtime.http.clients) client.end();
    runtime.http.clients.clear();

    if (runtime.http.server) {
      runtime.http.server.close();
      runtime.http.server = null;
    }
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
    runtime.http.clients.add(response);
    response.write(`data: ${JSON.stringify(publicState())}\n\n`);
    response.on("close", () => runtime.http.clients.delete(response));
  }

  function broadcast() {
    const payload = `data: ${JSON.stringify(publicState())}\n\n`;
    for (const client of runtime.http.clients) client.write(payload);
  }

  function publicState() {
    return {
      queue: runtime.state.queue,
      history: runtime.state.history.slice(0, 10),
      totalSongs: runtime.catalog.length,
      enabledGames: runtime.config.enabledGames,
      availableGames: runtime.availableGames,
      maxQueueSize: runtime.config.maxQueueSize,
      overlayTheme: runtime.state.overlayTheme || DEFAULT_OVERLAY_THEME,
      channel: runtime.config.channel,
      botConnected: runtime.twitch.isConnected()
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
    const expected = runtime.config.adminToken;
    if (!expected) return false;

    const headerToken = headerValue(request.headers["x-queue-admin"]);
    const auth = headerValue(request.headers.authorization);
    const bearerToken = auth.replace(/^Bearer\s+/i, "");
    const queryToken = url.searchParams.get("token") || "";

    return [headerToken, bearerToken, queryToken]
      .map(cleanSecret)
      .some((token) => timingSafeEqual(token, expected));
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
    const results = runtime.catalog
      .map((song) => ({ song: stripSearch(song), score: normalized ? runtime.songs.scoreSong(normalized, song) : 0 }))
      .filter((result) => !normalized || result.score >= 0.25)
      .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title))
      .slice(0, 25);

    sendJson(response, { results });
  }

  async function withJsonBody(request, response, handler) {
    try {
      const body = await readJsonBody(request);
      const result = await handler(body);
      if (!result.ok) return sendError(response, result.status || 400, result.message);
      sendJson(response, { ok: true, ...result, state: publicState() });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  }

  function apiRequestSong(request, response) {
    return withJsonBody(request, response, (body) =>
      runtime.queue.addRequest(body.user || "test", body.song || body.query || "", { announce: false })
    );
  }

  function apiSkipSong(response) {
    const result = runtime.queue.skipSong({ announce: true });
    if (!result.ok) return sendError(response, result.status || 400, result.message);
    sendJson(response, { ok: true, ...result, state: publicState() });
  }

  function apiRemoveSong(request, response) {
    return withJsonBody(request, response, (body) =>
      runtime.queue.removeQueueEntry(body.id, body.position, { announce: false })
    );
  }

  function apiClearQueue(response) {
    const result = runtime.queue.clearQueue({ announce: true });
    if (!result.ok) return sendError(response, result.status || 400, result.message);
    sendJson(response, { ok: true, ...result, state: publicState() });
  }

  function apiPickSong(request, response) {
    return withJsonBody(request, response, (body) =>
      runtime.queue.pickSong(body.id, body.position, { announce: true })
    );
  }

  async function apiUpdateFilters(request, response) {
    try {
      const body = await readJsonBody(request);
      const nextEnabledGames = sanitizeEnabledGames(body.enabledGames);
      if (!nextEnabledGames.length) return sendError(response, 400, "Choose at least one game catalog.");

      runtime.config.enabledGames = nextEnabledGames;
      runtime.songs.loadSongs();
      broadcast();

      sendJson(response, {
        ok: true,
        message: runtime.queue.filterSummary(),
        state: publicState()
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  }

  async function apiUpdateTheme(request, response) {
    try {
      const body = await readJsonBody(request);
      runtime.state.overlayTheme = runtime.queue.sanitizeOverlayTheme(body.overlayTheme || body.theme);
      runtime.queue.saveQueue();

      sendJson(response, {
        ok: true,
        message: `Overlay theme set to ${runtime.state.overlayTheme}.`,
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

  return {
    startHttpServer,
    stopHttpServer,
    broadcast,
    publicState
  };
}

module.exports = { createServer };
