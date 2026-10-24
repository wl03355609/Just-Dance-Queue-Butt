const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SONGS_PATH = path.join(ROOT, "data", "songs.json");
const QUEUE_PATH = path.join(ROOT, "data", "queue.json");

const MUTATING_API_PATHS = new Set([
  "/api/request",
  "/api/skip",
  "/api/remove",
  "/api/clear",
  "/api/filters",
  "/api/theme",
  "/api/bot/reconnect",
  "/api/pick",
  "/api/promote",
  "/api/queue/state",
  "/api/companion/pairing-code"
]);

const MAX_QUERY_LENGTH = 200;
const MIN_SEARCH_LENGTH = 3;
const MIN_REQUEST_MATCH_SCORE = 0.5;
// Overlay/dashboard looks. Keys are stored in queue.json, so keep them stable.
// `mode` is the look each theme was designed in; every theme also has the other mode.
const OVERLAY_THEMES = [
  { key: "poster", label: "Dance Floor Poster", mode: "light" },
  { key: "arcade", label: "Arcade Neon", mode: "dark" },
  { key: "studio", label: "Clean Studio", mode: "light" },
  { key: "pop", label: "Sticker Pop", mode: "light" },
  { key: "console", label: "Broadcast Console", mode: "dark" },
  // The look the bot shipped with before the themes; kept for channels that had it.
  { key: "classic", label: "Classic", mode: "dark" }
];
const DEFAULT_OVERLAY_THEME = "poster";
const OVERLAY_MODES = ["light", "dark"];

const GENERIC_MATCH_TOKENS = new Set(["song", "dance", "just", "version", "remix", "edition"]);

const DEFAULT_ENABLED_GAMES = [
  "jd1", "jd2", "jd3", "jd4",
  "2014", "2015", "2016", "2017", "2018", "2019",
  "2020", "2021", "2022", "2023", "2024", "2025", "2026",
  "decades", "plus"
];

// Just Dance Unlimited is off by default; streamers can enable it in Filtering Games.
const FILTER_OPTIONS = [...DEFAULT_ENABLED_GAMES, "jdu", "youtube"];

// Games the songlist has but FILTER_OPTIONS doesn't know yet (a new edition the
// songlist update added), as key → name. Filled in when the songlist loads.
const NEW_GAMES = new Map();
// What gameKey() gives for such a game: a year, or a name of two or more words.
const NEW_GAME_KEY = /^(20\d{2}|[a-z0-9]+( [a-z0-9]+){1,7})$/;

const GAME_LABELS = {
  jd1: "Just Dance",
  jd2: "Just Dance 2",
  jd3: "Just Dance 3",
  jd4: "Just Dance 4",
  "2014": "Just Dance 2014",
  "2015": "Just Dance 2015",
  "2016": "Just Dance 2016",
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
  decades: "Just Dance: Decades of Hits",
  jdu: "Just Dance Unlimited",
  plus: "Just Dance+",
  youtube: "YouTube"
};

module.exports = {
  ROOT,
  PUBLIC_DIR,
  SONGS_PATH,
  QUEUE_PATH,
  MUTATING_API_PATHS,
  MAX_QUERY_LENGTH,
  MIN_SEARCH_LENGTH,
  MIN_REQUEST_MATCH_SCORE,
  OVERLAY_THEMES,
  OVERLAY_MODES,
  DEFAULT_OVERLAY_THEME,
  GENERIC_MATCH_TOKENS,
  DEFAULT_ENABLED_GAMES,
  FILTER_OPTIONS,
  GAME_LABELS,
  NEW_GAMES,
  NEW_GAME_KEY
};
