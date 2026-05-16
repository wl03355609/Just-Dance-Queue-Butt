const { createCommands } = require("../src/commands");
const { createQueue } = require("../src/queue");

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

  // Give microtasks a chance to flush (for !sr → addRequest promise paths)
  await new Promise((resolve) => setImmediate(resolve));

  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("Commands test crashed:", error);
  process.exit(1);
});
