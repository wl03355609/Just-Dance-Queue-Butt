const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_OVERLAY_THEME,
  MIN_SEARCH_LENGTH,
  FILTER_OPTIONS
} = require("./constants");

const {
  normalize,
  gameKey,
  stripSearch,
  cleanChatText,
  cleanSearchQuery
} = require("./util");

function createQueue(runtime) {
  function loadQueue() {
    try {
      return normalizeQueueState(JSON.parse(fs.readFileSync(runtime.config.queuePath, "utf8")));
    } catch {
      return normalizeQueueState();
    }
  }

  function saveQueue() {
    fs.mkdirSync(path.dirname(runtime.config.queuePath), { recursive: true });
    fs.writeFileSync(runtime.config.queuePath, JSON.stringify(runtime.state, null, 2));
    runtime.server.broadcast();
  }

  function clearQueueState() {
    runtime.state.queue = [];
    runtime.state.history = [];
    saveQueue();
    return runtime.server.publicState();
  }

  function clearHistoryState() {
    runtime.state.history = [];
    saveQueue();
    return runtime.server.publicState();
  }

  function normalizeQueueState(value = {}) {
    return {
      queue: Array.isArray(value.queue) ? value.queue : [],
      history: Array.isArray(value.history) ? value.history : [],
      overlayTheme: sanitizeOverlayTheme(value.overlayTheme)
    };
  }

  function sanitizeOverlayTheme(value) {
    return value === "light" ? "light" : DEFAULT_OVERLAY_THEME;
  }

  function findDuplicateEntry(song) {
    const titleKey = normalize(song.title);
    const index = runtime.state.queue.findIndex((entry) =>
      entry.song.id === song.id || normalize(entry.song.title) === titleKey
    );
    return index === -1 ? null : { entry: runtime.state.queue[index], position: index + 1 };
  }

  async function addRequest(user, query, options = {}) {
    const { announce = true } = options;
    const requester = cleanChatText(user || "viewer").replace(/^@/, "").slice(0, 50) || "viewer";
    const requestedSong = cleanSearchQuery(query);

    if (!requestedSong) {
      const message = `@${requester} usage: !sr song name`;
      if (announce) runtime.twitch.say(message);
      return { ok: false, status: 400, message };
    }

    if (requestedSong.length < MIN_SEARCH_LENGTH) {
      const message = `@${requester} please be more specific — type at least part of the song name.`;
      if (announce) runtime.twitch.say(message);
      return { ok: false, status: 400, message };
    }

    if (runtime.state.queue.length >= runtime.config.maxQueueSize) {
      const message = `@${requester} the queue is full right now.`;
      if (announce) runtime.twitch.say(message);
      return { ok: false, status: 409, message };
    }

    const existing = runtime.state.queue.find((entry) => entry.user.toLowerCase() === requester.toLowerCase());
    if (existing) {
      const message = `@${requester} you are already in queue at #${runtime.state.queue.indexOf(existing) + 1}: ${existing.song.title}. Use !leave to remove it.`;
      if (announce) runtime.twitch.say(message);
      return { ok: false, status: 409, message };
    }

    if (runtime.songs.isAnyUrl(requestedSong)) {
      const youtubeUrl = runtime.songs.extractYoutubeUrl(requestedSong);
      if (!youtubeUrl) {
        const message = `@${requester} Sorry, we meant YouTube requests, not random porn.`;
        if (announce) runtime.twitch.say(message);
        return { ok: false, status: 400, message };
      }
      if (!runtime.songs.isYoutubeEnabled()) {
        const message = `@${requester} YouTube requests are not enabled.`;
        if (announce) runtime.twitch.say(message);
        return { ok: false, status: 400, message };
      }
      const title = await runtime.songs.fetchYoutubeTitle(youtubeUrl);
      if (!title) {
        const message = `@${requester} couldn't find that YouTube video — make sure it's public.`;
        if (announce) runtime.twitch.say(message);
        return { ok: false, status: 404, message };
      }
      const song = runtime.songs.youtubeSong(title);
      const dup = findDuplicateEntry(song);
      if (dup) {
        const message = `@${requester} "${dup.entry.song.title}" is already in the queue at #${dup.position}, requested by @${dup.entry.user}.`;
        if (announce) runtime.twitch.say(message);
        return { ok: false, status: 409, message };
      }
      return addQueueEntry(requester, song, announce);
    }

    const match = runtime.songs.findSong(requestedSong);

    let song;
    if (match) {
      song = stripSearch(match.song);
    } else if (runtime.songs.isYoutubeEnabled()) {
      song = runtime.songs.youtubeSong(requestedSong);
    } else {
      const message = `@${requester} The request: "${requestedSong}" is not available in ${runtime.config.channel}'s filtered games.`;
      if (announce) runtime.twitch.say(message);
      return { ok: false, status: 404, message };
    }

    const duplicate = findDuplicateEntry(song);
    if (duplicate) {
      const message = `@${requester} "${duplicate.entry.song.title}" is already in the queue at #${duplicate.position}, requested by @${duplicate.entry.user}.`;
      if (announce) runtime.twitch.say(message);
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

    runtime.state.queue.push(entry);
    saveQueue();
    const message = `@${requester} added #${runtime.state.queue.length}: ${entry.song.title} - ${entry.song.artist} (${entry.song.game}).`;
    if (announce) runtime.twitch.say(message);
    return { ok: true, status: 200, message, entry };
  }

  function leaveQueue(user) {
    const index = runtime.state.queue.findIndex((entry) => entry.user.toLowerCase() === user.toLowerCase());
    if (index === -1) {
      runtime.twitch.say(`@${user} you are not in the queue.`);
      return;
    }

    const [removed] = runtime.state.queue.splice(index, 1);
    saveQueue();
    runtime.twitch.say(`@${user} removed ${removed.song.title} from the queue.`);
  }

  function skipSong(options = {}) {
    return pickQueueEntryAt(0, options);
  }

  function pickSong(id, position, options = {}) {
    let index = -1;

    if (id) {
      index = runtime.state.queue.findIndex((entry) => entry.id === id);
    } else {
      index = Number.parseInt(position, 10) - 1;
    }

    if (!Number.isInteger(index) || index < 0 || index >= runtime.state.queue.length) {
      const message = "Entry not found in queue.";
      return { ok: false, status: 404, message };
    }

    return pickQueueEntryAt(index, options);
  }

  function pickRandomSong(options = {}) {
    if (!runtime.state.queue.length) {
      const message = "The queue is empty.";
      if (options.announce !== false) runtime.twitch.say(message);
      return { ok: false, status: 409, message };
    }

    const index = Math.floor(Math.random() * runtime.state.queue.length);
    return pickQueueEntryAt(index, options);
  }

  function pickQueueEntryAt(index, options = {}) {
    const { announce = true } = options;
    const [next] = runtime.state.queue.splice(index, 1);
    if (!next) {
      const message = "The queue is empty.";
      if (announce) runtime.twitch.say(message);
      return { ok: false, status: 409, message };
    }

    runtime.state.history.unshift({ ...next, playedAt: new Date().toISOString() });
    runtime.state.history = runtime.state.history.slice(0, 25);
    saveQueue();
    const message = `Now playing: ${next.song.title} - ${next.song.artist}, requested by @${next.user}.`;
    if (announce) runtime.twitch.say(message);
    return { ok: true, status: 200, message, entry: next };
  }

  function removeSong(position) {
    removeQueueEntry(null, position, { announce: true });
  }

  function removeQueueEntry(id, position, options = {}) {
    const { announce = true } = options;
    let index = -1;

    if (id) {
      index = runtime.state.queue.findIndex((entry) => entry.id === id);
    } else {
      index = Number.parseInt(position, 10) - 1;
    }

    if (!Number.isInteger(index) || index < 0 || index >= runtime.state.queue.length) {
      const message = "Usage: !remove queue-number";
      if (announce) runtime.twitch.say(message);
      return { ok: false, status: 400, message };
    }

    const [removed] = runtime.state.queue.splice(index, 1);
    saveQueue();
    const message = `Removed #${index + 1}: ${removed.song.title}, requested by @${removed.user}.`;
    if (announce) runtime.twitch.say(message);
    return { ok: true, status: 200, message, entry: removed };
  }

  function clearQueue(options = {}) {
    const { announce = true } = options;
    runtime.state.queue = [];
    saveQueue();
    const message = "Queue cleared.";
    if (announce) runtime.twitch.say(message);
    return { ok: true, status: 200, message };
  }

  function queueSummary() {
    if (!runtime.state.queue.length) return "The queue is empty. Use !sr song name to request a Just Dance song.";

    return runtime.state.queue
      .slice(0, 5)
      .map((entry, index) => `#${index + 1} ${entry.song.title} (@${entry.user})`)
      .join(" | ");
  }

  function currentSongSummary() {
    if (!runtime.state.history.length) return "No songs have been marked as played yet.";
    const current = runtime.state.history[0];
    return `Last played: ${current.song.title} - ${current.song.artist}, requested by @${current.user}.`;
  }

  function filterSummary() {
    const youtubeEnabled = runtime.songs.isYoutubeEnabled();
    const suffix = youtubeEnabled ? " YouTube requests are enabled." : "";
    return `Filters updated. ${runtime.catalog.length} catalog songs are requestable.${suffix}`;
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

  return {
    loadQueue,
    saveQueue,
    clearQueueState,
    clearHistoryState,
    normalizeQueueState,
    sanitizeOverlayTheme,
    addRequest,
    addQueueEntry,
    leaveQueue,
    skipSong,
    pickSong,
    pickRandomSong,
    pickQueueEntryAt,
    removeSong,
    removeQueueEntry,
    clearQueue,
    queueSummary,
    currentSongSummary,
    filterSummary,
    parseRandomFilter
  };
}

module.exports = { createQueue };
