const fs = require("node:fs");

const {
  SONGS_PATH,
  MIN_REQUEST_MATCH_SCORE,
  GENERIC_MATCH_TOKENS,
  FILTER_OPTIONS,
  GAME_LABELS
} = require("./constants");

const {
  normalize,
  gameKey,
  slug,
  levenshtein
} = require("./util");

function createSongs(runtime) {
  function loadSongs() {
    const raw = JSON.parse(fs.readFileSync(SONGS_PATH, "utf8"));
    const enabled = new Set(runtime.config.enabledGames.map(gameKey));

    runtime.catalog = raw
      .filter((song) => enabled.has(gameKey(song.game)))
      .map((song, index) => ({
        id: `${gameKey(song.game)}-${slug(song.title)}-${index}`,
        ...song,
        search: normalize(`${song.title} ${song.artist} ${song.game} ${song.originalGame || ""}`),
        normalizedTitle: normalize(song.title)
      }));

    const counts = new Map(FILTER_OPTIONS.map((key) => [key, 0]));
    for (const song of raw) {
      const key = gameKey(song.game);
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    }
    runtime.availableGames = FILTER_OPTIONS.map((key) => ({
      key,
      label: GAME_LABELS[key] || key,
      count: key === "youtube" ? null : counts.get(key) || 0
    }));

    return runtime.catalog;
  }

  function findSong(query) {
    const normalized = normalize(query);
    const exact = runtime.catalog.find((song) => song.normalizedTitle === normalized);
    if (exact) return { song: exact, score: 1 };

    let best = null;
    for (const song of runtime.catalog) {
      const score = scoreSong(normalized, song);
      if (!best || score > best.score) best = { song, score };
      if (best && best.score >= 0.92) break;
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
    const distanceScore = 1 - levenshtein(query, song.normalizedTitle) / Math.max(query.length, song.title.length, 1);

    if (hasMissingNumericToken(queryTokens, songTokens)) return 0;
    if (queryTokens.size > 1 && overlap > 0 && overlappingTokens.every((token) => GENERIC_MATCH_TOKENS.has(token))) return 0;
    if (queryTokens.size > 1 && overlap === 0 && distanceScore < 0.75) return 0;

    return Math.max(tokenScore * 0.8, distanceScore);
  }

  function hasMissingNumericToken(queryTokens, songTokens) {
    return [...queryTokens].some((token) => /^\d+$/.test(token) && !songTokens.has(token));
  }

  function isYoutubeEnabled() {
    return runtime.config.enabledGames.includes("youtube");
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

  return {
    loadSongs,
    findSong,
    scoreSong,
    isYoutubeEnabled,
    isAnyUrl,
    extractYoutubeUrl,
    fetchYoutubeTitle,
    youtubeSong
  };
}

module.exports = { createSongs };
