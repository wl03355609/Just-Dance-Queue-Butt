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

// Viewers say "alt" for a song's other routine (Take Away, Extreme, …) when the
// song also has a normal one, e.g. "!sr hot to go alt".
const ALT_TOKENS = new Set(["alt", "alternate", "alternative"]);
const ARTIST_FILLER_TOKENS = new Set(["ft", "feat", "featuring", "and", "the", "vs", "x", "with", "as", "made", "famous", "by"]);

function createSongs(runtime) {
  let altBaseById = new Map();

  function loadSongs() {
    const raw = JSON.parse(fs.readFileSync(runtime.config.songsPath || SONGS_PATH, "utf8"));
    const enabled = new Set(runtime.config.enabledGames.map(gameKey));

    runtime.catalog = raw
      .filter((song) => enabled.has(gameKey(song.game)))
      .map((song, index) => ({
        id: `${gameKey(song.game)}-${slug(song.title)}-${index}`,
        ...song,
        search: normalize(`${song.title} ${song.artist} ${song.game} ${song.originalGame || ""}`),
        normalizedTitle: normalize(song.title)
      }));

    const artistsByTitle = new Map();
    for (const song of raw) {
      const key = normalize(song.title);
      if (!artistsByTitle.has(key)) artistsByTitle.set(key, []);
      artistsByTitle.get(key).push(song.artist || "");
    }
    altBaseById = new Map();
    for (const song of runtime.catalog) {
      const base = altBaseTitle(song, artistsByTitle);
      if (base) altBaseById.set(song.id, base);
    }

    const counts = new Map(FILTER_OPTIONS.map((key) => [key, 0]));
    for (const song of raw) {
      const key = gameKey(song.game);
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    }
    // Games with no songs yet (an announced game before launch) stay out of the
    // filter lists so nothing about them shows until a songlist update adds them.
    runtime.availableGames = FILTER_OPTIONS.map((key) => ({
      key,
      label: GAME_LABELS[key] || key,
      count: key === "youtube" ? null : counts.get(key) || 0
    })).filter((game) => game.count !== 0);

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

  // "Hot to Go! (Take Away Version)" is an alt of "Hot to Go!" because a routine
  // with the bare title by the same artist exists. A bracketed subtitle of a
  // different song ("Stronger (What Doesn't Kill You)") or a wiki label
  // ("Wannabe (Spice Girls song)") is not an alt.
  function altBaseTitle(song, artistsByTitle) {
    const match = song.title.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    if (!match || /\bsong$|^just dance\b/i.test(match[2].trim())) return "";
    const base = normalize(match[1]);
    const artists = artistsByTitle.get(base) || [];
    return artists.some((artist) => sameArtist(artist, song.artist)) ? base : "";
  }

  // Artist names are written differently across games ("ft." vs "featuring",
  // "Twice" vs "TWICE"), so any shared name word counts as the same artist.
  function sameArtist(left, right) {
    const words = (value) => normalize(value || "").split(" ").filter((word) => word && !ARTIST_FILLER_TOKENS.has(word));
    const leftWords = new Set(words(left));
    return words(right).some((word) => leftWords.has(word));
  }

  // For "!sr <song> alt": null when the request doesn't ask for an alt, otherwise
  // the requested song and its alt routines in the enabled games.
  function findAltRequest(query) {
    const tokens = normalize(query).split(" ").filter(Boolean);
    const altWords = tokens.filter((token) => ALT_TOKENS.has(token));
    const baseQuery = tokens.filter((token) => !ALT_TOKENS.has(token)).join(" ");
    if (!baseQuery || !altWords.length) return null;

    // A title containing the same word ("Mood (Alternate Version)") is requested by its name.
    const named = findSong(query);
    if (named && named.score >= 0.92 && altWords.every((word) => named.song.normalizedTitle.split(" ").includes(word))) return null;

    const match = findSong(baseQuery);
    if (!match) return null;
    if (altBaseById.has(match.song.id)) return { song: match.song, alternates: [match.song] };

    const seen = new Set();
    const alternates = runtime.catalog.filter((song) => {
      if (altBaseById.get(song.id) !== match.song.normalizedTitle) return false;
      if (!sameArtist(song.artist, match.song.artist) || seen.has(song.normalizedTitle)) return false;
      seen.add(song.normalizedTitle);
      return true;
    });
    return { song: match.song, alternates };
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
    findAltRequest,
    scoreSong,
    isYoutubeEnabled,
    isAnyUrl,
    extractYoutubeUrl,
    fetchYoutubeTitle,
    youtubeSong
  };
}

module.exports = { createSongs };
