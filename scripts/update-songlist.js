// Syncs data/songs.json and songlist.xlsx with the Just Dance Wiki
// (https://justdance.fandom.com, CC BY-SA). Run daily by
// .github/workflows/songlist-update.yml.
//
//   node scripts/update-songlist.js [--dry-run] [--force] [--summary file.md] [--cache dir]
//
// --dry-run   report what would change without writing files
// --force     apply changes the safety limits would hold back
// --summary   write a Markdown summary of the run to this file
// --cache     read/write fetched wiki responses in this folder (for testing offline)
//
// Prints one JSON line: { changed, blocked, reason, added, removed, newGames, upcoming }.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { clean, gameTemplates, releaseDate, succeededBy, linkTarget } = require("./songlist/wikitext");
const { PLUS_GAME, plusSongs, plusAlternateTitles, gameSongs, applySources, blockReason } = require("./songlist/sync");
const { songlistXlsx } = require("./songlist/xlsx");

const ROOT = path.resolve(__dirname, "..");
const SONGS_PATH = path.join(ROOT, "data", "songs.json");
const XLSX_PATH = path.join(ROOT, "songlist.xlsx");
const STATE_PATH = path.join(ROOT, "data", "songlist-sync.json");
const API = "https://justdance.fandom.com/api.php";
const USER_AGENT = "JustDanceQueueButt-songlist/1.0 (+https://github.com/wl03355609/Just-Dance-Queue-Butt)";
// Boxed games whose wiki pages are still checked for late additions.
const TRACKED_GAMES = 2;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.indexOf(name) === -1 ? null : args[args.indexOf(name) + 1]);
const dryRun = flag("--dry-run");
const force = flag("--force");
const summaryPath = option("--summary");
const cacheDir = option("--cache");

async function api(params) {
  const query = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const cacheFile = cacheDir && path.join(cacheDir, `${crypto.createHash("sha1").update(query.toString()).digest("hex")}.json`);
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${API}?${query}`, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${body.error.code}: ${body.error.info}`);
      if (cacheFile) {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(body));
      }
      return body;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw new Error(`Wiki request failed (${query.get("page") || query.get("action")}): ${lastError.message}`);
}

async function page(title) {
  try {
    const body = await api({ action: "parse", page: title, prop: "wikitext", redirects: "1" });
    return { title: body.parse.title, wikitext: body.parse.wikitext };
  } catch (error) {
    if (/missingtitle/.test(error.message)) return null;
    throw error;
  }
}

// Expands {{G|2024}}-style calls to plain names ("Just Dance 2024 Edition") in one request.
async function expandGameTemplates(calls) {
  const unique = [...new Set(calls)];
  if (!unique.length) return {};
  const marker = "\n@@SPLIT@@\n";
  const body = await api({ action: "expandtemplates", text: unique.map((call) => `{{${call}}}`).join(marker), prop: "wikitext" });
  const parts = body.expandtemplates.wikitext.split(marker);
  if (parts.length !== unique.length) throw new Error("Template expansion returned an unexpected shape.");
  return Object.fromEntries(unique.map((call, index) => [call, clean(parts[index])]));
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

// The game after the newest tracked one: its wiki infobox's "succeeded by",
// or else the next yearly "Just Dance <year> Edition" page if one exists.
async function findNextGame(newest, known) {
  const next = newest && succeededBy(newest.wikitext);
  const titles = [];
  if (next && next.page) titles.push(next.page);
  if (next && next.template) {
    const body = await api({ action: "expandtemplates", text: `{{${next.template}}}`, prop: "wikitext" });
    titles.push(linkTarget(body.expandtemplates.wikitext));
  }
  const year = new Date().getUTCFullYear();
  titles.push(`Just Dance ${year} Edition`, `Just Dance ${year + 1} Edition`);
  for (const title of titles) {
    if (!title || known.has(title)) continue;
    const found = await page(title);
    if (found && !known.has(found.title)) return found;
  }
  return null;
}

function songLine(song) {
  const where = song.game === PLUS_GAME && song.originalGame ? ` (from ${song.originalGame})` : "";
  return `- ${song.title} - ${song.artist}${where}`;
}

function buildSummary(result) {
  const lines = [];
  if (result.blocked) {
    lines.push(`Songlist update held back: ${result.reason}`, "", "Nothing was changed. Run the \"Update songlist\" workflow with force to apply it anyway.", "");
  }
  const byGame = new Map();
  for (const song of result.added) {
    if (!byGame.has(song.game)) byGame.set(song.game, []);
    byGame.get(song.game).push(song);
  }
  for (const [game, songs] of byGame) {
    lines.push(`Added to ${game} (${songs.length}):`, ...songs.map(songLine), "");
  }
  if (result.removed.length) {
    lines.push(`Removed from ${PLUS_GAME} (${result.removed.length}):`, ...result.removed.map(songLine), "");
  }
  if (result.newGames.length) lines.push(`New game: ${result.newGames.join(", ")}`, "");
  lines.push(`Songlist total: ${result.total} songs.`, "", "Source: Just Dance Wiki (justdance.fandom.com), CC BY-SA.");
  return lines.join("\n");
}

async function main() {
  const before = JSON.parse(fs.readFileSync(SONGS_PATH, "utf8"));
  const state = readState();
  const today = new Date().toISOString().slice(0, 10);

  const plusPage = await page(PLUS_GAME);
  if (!plusPage) throw new Error("The Just Dance+ wiki page is missing.");
  const gamePages = [];
  for (const game of state.games) {
    const found = await page(game);
    if (found) gamePages.push({ game, wikitext: found.wikitext });
  }

  // A newer boxed game joins once its release date has passed.
  const newGames = [];
  const upcoming = [];
  const knownGames = new Set([...before.map((song) => song.game), ...state.games]);
  const nextPage = await findNextGame(gamePages[gamePages.length - 1], knownGames);
  if (nextPage) {
    const released = releaseDate(nextPage.wikitext);
    if (released && released <= today) {
      gamePages.push({ game: nextPage.title, wikitext: nextPage.wikitext });
      newGames.push(nextPage.title);
    } else {
      upcoming.push({ game: nextPage.title, releaseDate: released || null });
    }
  }

  const templates = await expandGameTemplates([plusPage, ...gamePages].flatMap((item) => gameTemplates(item.wikitext)));
  const sources = [
    { game: PLUS_GAME, mode: "full", songs: plusSongs(plusPage.wikitext, templates), keep: plusAlternateTitles(plusPage.wikitext, templates) },
    ...gamePages.map((item) => ({ game: item.game, mode: "add", songs: gameSongs(item.wikitext, item.game, templates) }))
  ];

  const merged = applySources(before, sources);
  const reason = force ? "" : blockReason(merged, before, sources);
  const changed = !reason && (merged.added.length > 0 || merged.removed.length > 0);
  const result = {
    changed,
    blocked: Boolean(reason),
    reason,
    added: merged.added,
    removed: merged.removed,
    newGames,
    upcoming,
    total: reason ? before.length : merged.catalog.length
  };

  if (!dryRun && !reason) {
    const games = [...state.games, ...newGames].slice(-TRACKED_GAMES);
    if (changed) {
      fs.writeFileSync(SONGS_PATH, `${JSON.stringify(merged.catalog, null, 2)}\n`);
      fs.writeFileSync(XLSX_PATH, songlistXlsx(merged.catalog));
    }
    if (games.join() !== state.games.join()) {
      fs.writeFileSync(STATE_PATH, `${JSON.stringify({ games }, null, 2)}\n`);
    }
  }

  if (summaryPath) fs.writeFileSync(summaryPath, `${buildSummary(result)}\n`);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
