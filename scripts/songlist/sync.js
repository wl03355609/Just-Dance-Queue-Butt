// Merges Just Dance Wiki song tables into data/songs.json.
//
// Just Dance+ is synced both ways: routines the wiki lists are added, and JD+
// routines it no longer lists (licensing removals) are removed from the JD+
// section only. Boxed games are add-only, so a wiki edit can never delete a
// song from a released game.

const { normalize } = require("../../src/util");
const { clean, linkTarget, section, tables } = require("./wikitext");

const PLUS_GAME = "Just Dance+";
const ARTIST_FILLER = new Set(["ft", "feat", "featuring", "and", "the", "vs", "x", "with", "as", "made", "famous", "by"]);

// Same wording the catalog already uses.
const DIFFICULTY = { hardest: "Extreme" };
const EFFORT = { low: "Chill" };

// Large changes are held back for a person to look at.
const LIMITS = { maxRemovals: 20, maxShrinkRatio: 0.03 };

function titleKey(title) {
  return normalize(title);
}

function sameArtist(left, right) {
  const words = (value) => normalize(value || "").split(" ").filter((word) => word && !ARTIST_FILLER.has(word));
  const leftWords = new Set(words(left));
  return words(right).some((word) => leftWords.has(word));
}

function word(value, map) {
  const text = clean(value).replace(/\s*\(.*\)\s*$/, "").trim();
  return map[text.toLowerCase()] || text;
}

function yearValue(value) {
  const year = Number.parseInt(clean(value), 10);
  return Number.isFinite(year) && year > 1900 ? year : undefined;
}

function compact(song) {
  return Object.fromEntries(Object.entries(song).filter(([, value]) => value !== undefined && value !== ""));
}

// Rows of the "Classic Routines" table on the Just Dance+ page.
function plusSongs(wikitext, templates) {
  const table = tables(section(wikitext, "Classic Routines") || "")[0] || [];
  return table
    .map((row) => compact({
      title: clean(row.Song, templates),
      artist: clean(row.Artist, templates),
      year: yearValue(row.Year),
      game: PLUS_GAME,
      originalGame: clean(row["Original Game"], templates),
      releaseDate: clean(row["Release Date"], templates),
      mode: word(row.Mode, {}),
      difficulty: word(row.Difficulty, DIFFICULTY),
      effort: word(row.Effort, EFFORT)
    }))
    .filter((song) => song.title && song.artist);
}

// Titles of Just Dance+ alternate routines. A few of them sit in the JD+
// section of the songlist, so a full sync must not treat them as removed.
function plusAlternateTitles(wikitext, templates) {
  const table = tables(section(wikitext, "Alternate Routines") || "")[0] || [];
  const titles = [];
  for (const row of table) {
    const base = clean(row.Song, templates);
    const routine = clean(row.Routine, templates);
    const [page, subpage] = linkTarget(row.Song).split("/");
    if (base && routine) titles.push(`${base} (${routine})`);
    if (page && subpage) titles.push(`${page} (${subpage})`);
  }
  return titles;
}

// "Track List" plus "Alternate Routines" of a boxed game's page.
function gameSongs(wikitext, game, templates) {
  const seen = new Set();
  const songs = [];
  const artistByTitle = new Map();

  for (const row of tables(section(wikitext, "Track List") || "")[0] || []) {
    const title = clean(row.Song, templates);
    const artist = clean(row.Artist, templates);
    if (!title || !artist || seen.has(titleKey(title))) continue;
    seen.add(titleKey(title));
    artistByTitle.set(titleKey(title), artist);
    songs.push(compact({ title, artist, year: yearValue(row.Year), game }));
  }

  for (const row of tables(section(wikitext, "Alternate Routines") || "")[0] || []) {
    const base = clean(row.Song, templates) || linkTarget(row.Song).split("/")[0];
    const routine = clean(row.Routine, templates);
    if (!base || !routine) continue;
    const title = `${base} (${routine})`;
    if (seen.has(titleKey(title))) continue;
    seen.add(titleKey(title));
    songs.push(compact({
      title,
      artist: artistByTitle.get(titleKey(base)) || "",
      game,
      mode: word(row.Mode, {}),
      difficulty: word(row.Difficulty, DIFFICULTY),
      effort: word(row.Effort, EFFORT)
    }));
  }
  return songs;
}

function findMatch(candidates, song) {
  const sameTitle = candidates.filter((entry) => titleKey(entry.title) === titleKey(song.title));
  if (sameTitle.length <= 1) return sameTitle[0] || null;
  return sameTitle.find((entry) => sameArtist(entry.artist, song.artist)) || null;
}

// New songs go after the last song of the same game, so the list stays grouped.
function insertAfterGame(catalog, songs) {
  const out = [...catalog];
  for (const song of songs) {
    let index = -1;
    out.forEach((entry, position) => { if (entry.game === song.game) index = position; });
    if (index === -1) out.push(song);
    else out.splice(index + 1, 0, song);
  }
  return out;
}

// One sync run. `sources` is a list of { game, songs, mode: "full" | "add", keep }.
// `keep` lists extra titles that count as still listed but are never added.
function applySources(catalog, sources) {
  const added = [];
  const removed = [];
  let next = [...catalog];

  for (const source of sources) {
    const current = next.filter((song) => song.game === source.game);
    const matched = new Set();
    for (const song of source.songs) {
      const hit = findMatch(current.filter((entry) => !matched.has(entry)), song);
      if (hit) matched.add(hit);
      else if (song.artist) added.push(song);
    }
    if (source.mode === "full") {
      const keep = new Set((source.keep || []).map(titleKey));
      for (const entry of current) {
        if (!matched.has(entry) && !keep.has(titleKey(entry.title))) removed.push(entry);
      }
    }
  }

  const removedSet = new Set(removed);
  next = insertAfterGame(next.filter((song) => !removedSet.has(song)), added);
  return { catalog: next, added, removed };
}

// Why a result is too big to apply without a person, or "" when it's fine.
function blockReason(result, before, sources, limits = LIMITS) {
  for (const source of sources) {
    const current = before.filter((song) => song.game === source.game).length;
    if (source.mode === "full" && current > 0 && source.songs.length < current * 0.5) {
      return `${source.game}: the wiki table has ${source.songs.length} songs, under half of the ${current} in the songlist. The page layout probably changed.`;
    }
  }
  if (result.removed.length > limits.maxRemovals) {
    return `${result.removed.length} songs would be removed (limit ${limits.maxRemovals}).`;
  }
  const shrink = (before.length - result.catalog.length) / Math.max(before.length, 1);
  if (shrink > limits.maxShrinkRatio) {
    return `The songlist would shrink by ${(shrink * 100).toFixed(1)}% (limit ${limits.maxShrinkRatio * 100}%).`;
  }
  return "";
}

module.exports = {
  PLUS_GAME,
  LIMITS,
  plusSongs,
  plusAlternateTitles,
  gameSongs,
  applySources,
  blockReason
};
