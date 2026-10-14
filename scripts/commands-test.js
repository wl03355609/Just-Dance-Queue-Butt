const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCommands } = require("../src/commands");
const { createQueue } = require("../src/queue");
const { createSongs } = require("../src/songs");
const { gameKey } = require("../src/util");

const checks = [];
let failed = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function makeRuntime({ catalog = [], queue = [], history = [] } = {}) {
  const calls = {
    say: [],
    addRequest: [],
    skipSong: [],
    clearQueue: [],
    removeSong: [],
    pickRandomSong: [],
    leaveQueue: [],
    addQueueEntry: []
  };

  const runtime = {
    config: {
      channel: "streamer",
      modUsers: ["alice"],
      maxQueueSize: 50,
      enabledGames: ["2023"]
    },
    state: { queue, history, overlayTheme: "dark" },
    catalog,
    songs: {
      isYoutubeEnabled: () => false,
      isAnyUrl: () => false
    },
    twitch: {
      say: (msg) => { calls.say.push(msg); }
    },
    server: {
      broadcast: () => {},
      publicState: () => ({})
    },
    queue: null,
    commands: null
  };

  // Use the real queue module for parseRandomFilter, but stub the methods
  // commands.js actually calls so we can observe dispatch.
  const realQueue = createQueue(runtime);
  runtime.queue = {
    parseRandomFilter: realQueue.parseRandomFilter,
    checkCanRequest: realQueue.checkCanRequest,
    queueSummary: () => "summary",
    currentSongSummary: () => "current",
    addRequest: (...args) => { calls.addRequest.push(args); return Promise.resolve({ ok: true }); },
    skipSong: (...args) => { calls.skipSong.push(args); return { ok: true }; },
    clearQueue: (...args) => { calls.clearQueue.push(args); return { ok: true }; },
    removeSong: (...args) => { calls.removeSong.push(args); },
    pickRandomSong: (...args) => { calls.pickRandomSong.push(args); return { ok: true }; },
    leaveQueue: (...args) => { calls.leaveQueue.push(args); },
    addQueueEntry: (...args) => { calls.addQueueEntry.push(args); return { ok: true }; }
  };
  runtime.commands = createCommands(runtime);

  return { runtime, calls };
}

function msg(user, text, badges = "") {
  return { user, text, tags: badges ? { badges } : {} };
}

async function main() {
  // 1. !sr dispatches to addRequest
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("viewer", "!sr Some Song"));
    check("!sr calls addRequest", calls.addRequest.length === 1);
    check("!sr passes user + query", calls.addRequest[0][0] === "viewer" && calls.addRequest[0][1] === "Some Song");
  }

  // 2. !songrequest is an alias
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("viewer", "!songrequest Other Song"));
    check("!songrequest aliases !sr", calls.addRequest.length === 1);
  }

  // 3. !queue says the summary
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("viewer", "!queue"));
    check("!queue triggers say(queueSummary)", calls.say.length === 1 && calls.say[0] === "summary");
  }

  // 4. !leave dispatches to leaveQueue
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("viewer", "!leave"));
    check("!leave calls leaveQueue", calls.leaveQueue.length === 1 && calls.leaveQueue[0][0] === "viewer");
  }

  // 5. Non-mod !skip is rejected silently
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("viewer", "!skip"));
    check("non-mod !skip ignored", calls.skipSong.length === 0);
  }

  // 6. Mod (configured via modUsers) !skip works
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("alice", "!skip"));
    check("mod (modUsers) !skip works", calls.skipSong.length === 1);
  }

  // 7. !next is an alias for !skip
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("alice", "!next"));
    check("!next aliases !skip", calls.skipSong.length === 1);
  }

  // 8. Streamer (by channel name) gets mod-gated commands
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("streamer", "!clear"));
    check("channel owner !clear works", calls.clearQueue.length === 1);
  }

  // 9. Mod by badge can !clear
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("randomname", "!clear", "moderator/1"));
    check("moderator badge !clear works", calls.clearQueue.length === 1);
  }

  // 10. Broadcaster badge counts as streamer
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("randomname", "!clear", "broadcaster/1"));
    check("broadcaster badge !clear works", calls.clearQueue.length === 1);
  }

  // 11. Non-streamer !pick random is ignored (even if they're a mod)
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("alice", "!pick random"));
    check("mod (non-streamer) !pick random ignored", calls.pickRandomSong.length === 0);
  }

  // 12. Streamer !pick random works
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("streamer", "!pick random"));
    check("streamer !pick random works", calls.pickRandomSong.length === 1);
  }

  // 13. Broadcaster badge !pick random works
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("randomname", "!pick random", "broadcaster/1"));
    check("broadcaster badge !pick random works", calls.pickRandomSong.length === 1);
  }

  // 14. Mod-gated !remove dispatches with the position arg
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("alice", "!remove 3"));
    check("!remove passes position arg", calls.removeSong.length === 1 && calls.removeSong[0][0] === "3");
  }

  // 15. Mod-gated !song says the current song summary
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("alice", "!song"));
    check("!song triggers say(currentSongSummary)", calls.say.length === 1 && calls.say[0] === "current");
  }

  // 16. Unknown command is a no-op
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("viewer", "!nope hello"));
    check("unknown command is no-op", calls.say.length === 0 && calls.addRequest.length === 0);
  }

  // 17. Non-command chat (no leading !) is a no-op
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("viewer", "just chatting"));
    check("non-command chat is no-op", calls.say.length === 0);
  }

  // 18. Command casing is normalized
  {
    const { runtime, calls } = makeRuntime();
    runtime.commands.handleCommand(msg("alice", "!SKIP"));
    check("uppercase !SKIP works", calls.skipSong.length === 1);
  }

  // 19. !random with no arg picks from full catalog
  {
    const catalog = [
      { id: "a", title: "A", artist: "X", game: "Just Dance 2023 Edition", search: "a x" },
      { id: "b", title: "B", artist: "Y", game: "Just Dance 2023 Edition", search: "b y" }
    ];
    const { runtime, calls } = makeRuntime({ catalog });
    runtime.commands.handleCommand(msg("viewer", "!random"));
    check("!random adds a queue entry", calls.addQueueEntry.length === 1);
    check("!random picks from catalog", catalog.some((s) => s.title === calls.addQueueEntry[0][1].title));
  }

  // 20. !random with valid game filter resolves
  {
    const catalog = [
      { id: "a", title: "A", artist: "X", game: "Just Dance+", originalGame: "Just Dance 2023 Edition", search: "a x" },
      { id: "b", title: "B", artist: "Y", game: "Just Dance 2022", search: "b y" }
    ];
    const { runtime, calls } = makeRuntime({ catalog });
    runtime.commands.handleCommand(msg("viewer", "!random JD+ 2023"));
    check("!random JD+ 2023 picks JD+ catalog song", calls.addQueueEntry.length === 1);
    check("!random JD+ 2023 respects filter", calls.addQueueEntry[0][1].id === "a");
  }

  // 21. !random with unrecognized filter complains
  {
    const { runtime, calls } = makeRuntime({ catalog: [] });
    runtime.commands.handleCommand(msg("viewer", "!random nonsense"));
    check("!random nonsense triggers say (no addQueueEntry)", calls.say.length === 1 && calls.addQueueEntry.length === 0);
  }

  // 22. !random when queue is full says message and bails
  {
    const queue = Array.from({ length: 50 }, (_, i) => ({ id: `q${i}`, user: `u${i}`, song: { id: `s${i}`, title: `T${i}` } }));
    const { runtime, calls } = makeRuntime({ queue });
    runtime.commands.handleCommand(msg("viewer", "!random"));
    check("!random with full queue says message + no add", calls.say.length === 1 && calls.addQueueEntry.length === 0);
  }

  // 23. !random for user already in queue says message and bails
  {
    const queue = [{ id: "q0", user: "viewer", song: { id: "s0", title: "T0" } }];
    const { runtime, calls } = makeRuntime({ catalog: [{ id: "a", title: "A", game: "Just Dance 2023 Edition", search: "a" }], queue });
    runtime.commands.handleCommand(msg("viewer", "!random"));
    check("!random duplicate user bails", calls.say.length === 1 && calls.addQueueEntry.length === 0);
  }

  // 24. parseRandomFilter direct: year only
  {
    const { runtime } = makeRuntime();
    const f = runtime.queue.parseRandomFilter("2023");
    check("parseRandomFilter(\"2023\") → gameFilter=2023", f && f.gameFilter === "2023" && f.yearFilter === null);
  }

  // 25. parseRandomFilter direct: game + year
  {
    const { runtime } = makeRuntime();
    const f = runtime.queue.parseRandomFilter("JD+ 2023");
    check("parseRandomFilter(\"JD+ 2023\") → plus + 2023", f && f.gameFilter === "plus" && f.yearFilter === "2023");
  }

  // 26. parseRandomFilter direct: invalid
  {
    const { runtime } = makeRuntime();
    check("parseRandomFilter(\"garbage\") → null", runtime.queue.parseRandomFilter("garbage") === null);
  }

  // 27. parseRandomFilter direct: 'youtube' rejected
  {
    const { runtime } = makeRuntime();
    check("parseRandomFilter(\"youtube\") → null", runtime.queue.parseRandomFilter("youtube") === null);
  }

  // 28. gameKey maps Decades of Hits (no year in its name) to its own key
  {
    check("gameKey(\"Just Dance: Decades of Hits\") → decades", gameKey("Just Dance: Decades of Hits") === "decades");
    check("gameKey(\"DoH\") → decades", gameKey("DoH") === "decades");
    check("gameKey(\"Just Dance 2026 Edition\") still → 2026", gameKey("Just Dance 2026 Edition") === "2026");
    check("gameKey(\"Just Dance\") still → jd1", gameKey("Just Dance") === "jd1");
  }

  // 29. parseRandomFilter accepts decades
  {
    const { runtime } = makeRuntime();
    const f = runtime.queue.parseRandomFilter("decades");
    check("parseRandomFilter(\"decades\") → decades", f && f.gameFilter === "decades" && f.yearFilter === null);
  }

  // 30. !random for a game with no songs says so instead of "already in the queue"
  {
    const { runtime, calls } = makeRuntime({ catalog: [{ id: "a", title: "A", game: "Just Dance 2023 Edition", search: "a" }] });
    runtime.commands.handleCommand(msg("viewer", "!random decades"));
    check("!random decades with no songs says no songs + no add",
      calls.say.length === 1 && calls.say[0].includes("no songs available for that filter.") && calls.addQueueEntry.length === 0);
  }

  // 31. "!sr <song> alt" requests a song's alt routine (real songs + queue modules)
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jdb-alt-"));
    const songsPath = path.join(dir, "songs.json");
    fs.writeFileSync(songsPath, JSON.stringify([
      { title: "Hot to Go!", artist: "Chappell Roan", game: "Just Dance: Decades of Hits" },
      { title: "Hot to Go! (Take Away Version)", artist: "Chappell Roan", game: "Just Dance: Decades of Hits" },
      { title: "Feel Special", artist: "Twice", game: "Just Dance 2021" },
      { title: "Feel Special (Extreme Version)", artist: "TWICE", game: "Just Dance 2021" },
      { title: "More & More", artist: "Twice", game: "Just Dance: Decades of Hits" },
      { title: "Blinding Lights", artist: "The Weeknd", game: "Just Dance 2021" },
      { title: "Blinding Lights (Extreme Version)", artist: "The Weeknd", game: "Just Dance 2021" },
      { title: "Blinding Lights (Alternate Version)", artist: "The Weeknd", game: "Just Dance+" },
      { title: "Stronger", artist: "Britney Spears", game: "Just Dance 2022" },
      { title: "Stronger (What Doesn't Kill You)", artist: "Kelly Clarkson", game: "Just Dance 2022" },
      { title: "Dynamite", artist: "BTS", game: "Just Dance 2023 Edition" },
      { title: "Dynamite (Extreme Version)", artist: "BTS", game: "Just Dance 2023 Edition" },
      { title: "Dynamite", artist: "Taio Cruz", game: "Just Dance 3" }
    ]));

    const said = [];
    const runtime = {
      config: {
        channel: "streamer",
        modUsers: [],
        maxQueueSize: 50,
        enabledGames: ["decades", "2021", "2022", "2023", "jd3", "plus"],
        songsPath,
        queuePath: path.join(dir, "queue.json")
      },
      state: { queue: [], history: [], overlayTheme: "dark" },
      catalog: [],
      twitch: { say: (message) => said.push(message) },
      server: { broadcast: () => {}, publicState: () => ({}) }
    };
    runtime.songs = createSongs(runtime);
    runtime.queue = createQueue(runtime);
    runtime.songs.loadSongs();

    const request = (user, query) => runtime.queue.addRequest(user, query, { announce: true });
    const queued = (result) => result.ok ? result.entry.song.title : `(not queued: ${result.message})`;

    const hotToGo = await request("v1", "hot to go alt");
    check("!sr hot to go alt → Take Away Version", queued(hotToGo) === "Hot to Go! (Take Away Version)", queued(hotToGo));

    const feelSpecial = await request("v2", "feel special alt");
    check("!sr feel special alt → Extreme Version (Twice/TWICE)", queued(feelSpecial) === "Feel Special (Extreme Version)", queued(feelSpecial));

    const moreAndMore = await request("v3", "more and more");
    check("!sr more and more → More & More", queued(moreAndMore) === "More & More", queued(moreAndMore));

    const noAlt = await request("v4", "more & more alt");
    check("!sr more & more alt → says there's no alt, queues nothing",
      !noAlt.ok && noAlt.status === 404 && said.at(-1).includes("More & More doesn't have an alt routine"), said.at(-1));

    const several = await request("v5", "blinding lights alt");
    check("!sr blinding lights alt → lists the alt routines, queues nothing",
      !several.ok && several.status === 409 && said.at(-1).includes("Extreme Version, Alternate Version"), said.at(-1));

    const named = await request("v6", "blinding lights alternate version");
    check("!sr blinding lights alternate version → that routine by name", queued(named) === "Blinding Lights (Alternate Version)", queued(named));

    const subtitle = await request("v7", "stronger alt");
    check("!sr stronger alt → a different song's subtitle isn't an alt", !subtitle.ok && subtitle.status === 404, subtitle.message);

    const dynamite = await request("v8", "dynamite alt");
    check("!sr dynamite alt → BTS Extreme, not Taio Cruz", queued(dynamite) === "Dynamite (Extreme Version)", queued(dynamite));

    const classic = await request("v9", "hot to go");
    check("!sr hot to go (no alt) → normal routine", queued(classic) === "Hot to Go!", queued(classic));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Give microtasks a chance to flush (for !sr → addRequest promise paths)
  await new Promise((resolve) => setImmediate(resolve));

  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("Commands test crashed:", error);
  process.exit(1);
});
