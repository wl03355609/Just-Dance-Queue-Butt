const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { MAX_QUERY_LENGTH } = require("./constants");

function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function env(key, fallback) {
  return process.env[key] || fallback;
}

function numberValue(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listValue(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeOAuth(value) {
  const token = cleanSecret(value);
  if (!token) return "";
  return token.startsWith("oauth:") ? token : `oauth:${token}`;
}

function headerValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cleanSecret(value) {
  return String(value || "").trim().replace(/[\r\n]/g, "");
}

function cleanSearchQuery(value) {
  return cleanChatText(value).slice(0, MAX_QUERY_LENGTH);
}

function cleanChatText(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIrcLine(value) {
  return String(value || "").replace(/[\r\n\u0000]/g, "");
}

function sanitizeTwitchName(value) {
  return String(value || "")
    .trim()
    .replace(/^[@#]/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function gameKey(value) {
  const raw = String(value).toLowerCase();
  if (raw.includes("+")) return "plus";
  if (raw.includes("unlimited")) return "jdu";

  const normalized = normalize(value);
  if (normalized === "plus" || normalized.includes("dance plus")) return "plus";
  if (normalized === "jdu" || normalized.includes("dance unlimited")) return "jdu";

  if (/^(jd1|just dance 1|just dance)$/.test(normalized)) return "jd1";
  if (/^(jd2|just dance 2)$/.test(normalized)) return "jd2";
  if (/^(jd3|just dance 3)$/.test(normalized)) return "jd3";
  if (/^(jd4|just dance 4)$/.test(normalized)) return "jd4";

  const year = normalized.match(/\b20\d{2}\b/);
  return year ? year[0] : normalized;
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function stripSearch(song) {
  const { search, normalizedTitle, ...publicSong } = song;
  return publicSong;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return matrix[a.length][b.length];
}

module.exports = {
  loadEnv,
  env,
  numberValue,
  listValue,
  normalizeOAuth,
  headerValue,
  timingSafeEqual,
  cleanSecret,
  cleanSearchQuery,
  cleanChatText,
  cleanIrcLine,
  sanitizeTwitchName,
  normalize,
  gameKey,
  slug,
  stripSearch,
  levenshtein
};
