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
  "/api/pick",
  "/api/promote",
  "/api/queue/state",
  "/api/companion/pairing-code"
]);

const MAX_QUERY_LENGTH = 200;
const MIN_SEARCH_LENGTH = 3;
const MIN_REQUEST_MATCH_SCORE = 0.5;
const DEFAULT_OVERLAY_THEME = "dark";
const GENERIC_MATCH_TOKENS = new Set(["song", "dance", "just", "version", "remix", "edition"]);

const DEFAULT_ENABLED_GAMES = [
  "jd1", "jd2", "jd3", "jd4",
  "2014", "2015", "2016", "2017", "2018", "2019",
  "2020", "2021", "2022", "2023", "2024", "2025", "2026",
  "jdu", "plus"
];

const FILTER_OPTIONS = [...DEFAULT_ENABLED_GAMES, "youtube"];

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
  DEFAULT_OVERLAY_THEME,
  GENERIC_MATCH_TOKENS,
  DEFAULT_ENABLED_GAMES,
  FILTER_OPTIONS,
  GAME_LABELS
};
