const fs = require("node:fs");
const crypto = require("node:crypto");

const {
  QUEUE_PATH,
  SONGS_PATH,
  DEFAULT_ENABLED_GAMES,
  FILTER_OPTIONS,
  GAME_LABELS
} = require("./constants");

const {
  env,
  cleanSecret,
  numberValue,
  listValue,
  normalizeOAuth,
  sanitizeTwitchName,
  gameKey
} = require("./util");

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

function sanitizeEnabledGames(value) {
  const allowed = new Set(FILTER_OPTIONS);
  return [...new Set(listValue(value, DEFAULT_ENABLED_GAMES).map(gameKey))]
    .filter((key) => allowed.has(key));
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

module.exports = {
  createConfig,
  sanitizeEnabledGames,
  gameOptions
};
