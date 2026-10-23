const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runtime = require("../src/index.js");

const port = 38271;
const queuePath = path.join(os.tmpdir(), `jdb-smoke-${Date.now()}.json`);
const adminToken = "smoke-test-token";

const checks = [];
let failed = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const isPost = method === "POST";
    const data = isPost ? JSON.stringify(body || {}) : null;
    const req = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: urlPath,
      headers: {
        "x-queue-admin": adminToken,
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let chunks = "";
      res.on("data", (c) => { chunks += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch { parsed = chunks; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Boot runtime with no Twitch creds (HTTP only) on a tmp queue file.
  const controller = runtime.startRuntime({
    username: "",
    oauth: "",
    channel: "",
    port,
    adminToken,
    queuePath
  });

  try {
    check("runtime returns controller", controller && controller.config);
    check("runtime port matches", controller.config.port === port);

    const queue1 = await request("GET", "/api/queue");
    check("GET /api/queue returns 200", queue1.status === 200);
    check("queue starts empty", Array.isArray(queue1.body.queue) && queue1.body.queue.length === 0);
    check("totalSongs is populated", queue1.body.totalSongs > 0, `totalSongs=${queue1.body.totalSongs}`);
    check("botConnected reflects no creds", queue1.body.botConnected === false);

    const search = await request("GET", "/api/search?q=anything");
    check("GET /api/search returns 200", search.status === 200);
    check("search returns results", Array.isArray(search.body.results) && search.body.results.length > 0);

    const sampleTitle = search.body.results[0].song.title;

    const addReq = await request("POST", "/api/request", { user: "smoke_tester", song: sampleTitle });
    check("POST /api/request ok", addReq.status === 200 && addReq.body.ok === true, `got ${addReq.status}`);
    check("queue has 1 entry after request", addReq.body.state.queue.length === 1);

    const dup = await request("POST", "/api/request", { user: "smoke_tester", song: sampleTitle });
    check("duplicate user request rejected", dup.body.ok === false);

    const queue2 = await request("GET", "/api/queue");
    check("queue persisted across calls", queue2.body.queue.length === 1);

    const skip = await request("POST", "/api/skip");
    check("POST /api/skip ok", skip.body.ok === true);
    check("queue empty after skip", skip.body.state.queue.length === 0);
    check("history has 1 entry after skip", skip.body.state.history.length === 1);

    const add2 = await request("POST", "/api/request", { user: "user_two", song: sampleTitle });
    check("re-add same song under new user", add2.body.ok === true);

    const remove = await request("POST", "/api/remove", { position: 1 });
    check("POST /api/remove ok", remove.body.ok === true);
    check("queue empty after remove", remove.body.state.queue.length === 0);

    const add3 = await request("POST", "/api/request", { user: "user_three", song: sampleTitle });
    check("add before clear ok", add3.body.ok === true);

    const clear = await request("POST", "/api/clear");
    check("POST /api/clear ok", clear.body.ok === true);
    check("queue empty after clear", clear.body.state.queue.length === 0);

    check("songless games hidden from filters", queue1.body.availableGames.every((game) => game.count !== 0));
    check("decades enabled by default", queue1.body.enabledGames.includes("decades"));
    check("Unlimited disabled by default", !queue1.body.enabledGames.includes("jdu"));

    const filters = await request("POST", "/api/filters", { enabledGames: ["2023", "2024"] });
    check("POST /api/filters ok", filters.body.ok === true);
    const visibleKeys = new Set(filters.body.state.availableGames.map((game) => game.key));
    const enabledAfter = filters.body.state.enabledGames;
    check("filters applied", ["2023", "2024"].every((key) => enabledAfter.includes(key)));
    check("only hidden games kept beyond selection", enabledAfter.every((key) => ["2023", "2024"].includes(key) || !visibleKeys.has(key)), enabledAfter.join(","));

    check("default theme is poster, light", queue1.body.overlayTheme === "poster" && queue1.body.overlayMode === "light");
    check("theme list exposed", Array.isArray(queue1.body.overlayThemes) && queue1.body.overlayThemes.length === 6);
    const theme = await request("POST", "/api/theme", { overlayTheme: "console" });
    check("POST /api/theme ok", theme.body.ok === true);
    check("theme change keeps the current mode", theme.body.state.overlayTheme === "console" && theme.body.state.overlayMode === "light");
    const themeAndMode = await request("POST", "/api/theme", { overlayTheme: "console", overlayMode: "dark" });
    check("theme and mode can be set together", themeAndMode.body.state.overlayTheme === "console" && themeAndMode.body.state.overlayMode === "dark");
    const legacyTheme = await request("POST", "/api/theme", { overlayTheme: "light" });
    check("legacy light value switches the mode only", legacyTheme.body.state.overlayTheme === "console" && legacyTheme.body.state.overlayMode === "light");
    const modeOnly = await request("POST", "/api/theme", { overlayMode: "dark" });
    check("mode can change on its own", modeOnly.body.state.overlayTheme === "console" && modeOnly.body.state.overlayMode === "dark");
    const badTheme = await request("POST", "/api/theme", { overlayTheme: "<script>", overlayMode: "neon" });
    check("unknown theme and mode fall back", badTheme.body.state.overlayTheme === "poster" && badTheme.body.state.overlayMode === "light");

    const reconnect = await request("POST", "/api/bot/reconnect", {});
    check("reconnect without a Twitch login is refused cleanly", reconnect.status === 409 && reconnect.body.ok === false);

    const unauth = await new Promise((resolve, reject) => {
      const data = JSON.stringify({ user: "x", song: "y" });
      const req = http.request({
        host: "127.0.0.1", port, method: "POST", path: "/api/request",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
      }, (res) => {
        let body = ""; res.on("data", (c) => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.write(data); req.end();
    });
    check("POST without admin token rejected", unauth.status === 403);

    const songs = await request("GET", "/api/songs");
    check("GET /api/songs returns 200", songs.status === 200);
    check("/api/songs returns array", Array.isArray(songs.body.songs) && songs.body.songs.length > 0);

    const overlay = await request("GET", "/");
    check("GET / returns 200", overlay.status === 200);
    check("overlay links the favicon", typeof overlay.body === "string" && overlay.body.includes('rel="icon" href="favicon.svg"'));
    const icon = await request("GET", "/favicon.svg");
    check("favicon.svg is served as SVG", icon.status === 200 && icon.headers["content-type"] === "image/svg+xml");
    check("page asset URLs carry a version", /href="themes\.css\?v=\w+"/.test(overlay.body) && /src="app\.js\?v=\w+"/.test(overlay.body) && overlay.body.includes('href="https://fonts.googleapis.com'));
    const script = await request("GET", "/dashboard.js?v=abc");
    check("static files tell caches to re-check", script.status === 200 && script.headers["cache-control"] === "no-cache");
  } finally {
    runtime.stopRuntime();
    try { fs.unlinkSync(queuePath); } catch {}
  }

  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  runtime.stopRuntime();
  process.exit(1);
});
