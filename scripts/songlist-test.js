const zlib = require("node:zlib");

const { tables, section, clean, releaseDate, succeededBy } = require("./songlist/wikitext");
const { plusSongs, plusAlternateTitles, gameSongs, applySources, blockReason } = require("./songlist/sync");
const { songlistXlsx } = require("./songlist/xlsx");

let failed = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const TEMPLATES = { "G|4": "Just Dance 4", "G|2024": "Just Dance 2024 Edition", G2: "Just Dance", "G2|2": "Just Dance 2" };

const PLUS_PAGE = `{{Infobox videogame
|release = October 25, 2022
}}
==Track List==
===Classic Routines===
{| class="wikitable sortable"
|+As of October 20, 2026, 4 songs are currently available in the service.
|-
! scope="col" |Song
! scope="col" |Artist
! scope="col" |Year
! scope="col" |Mode
! scope="col" |Difficulty
! scope="col" |Effort
! scope="col" |Cover
! scope="col" |Original Game
! scope="col" |Release Date
|-
|''[[Baby One More Time]]''{{Covered}}|| Britney Spears<br>(The Girly Team)||1998||'''Quartet'''||'''Easy'''
|'''Low'''||[[File:Baby cover.jpg|center|180px]]||{{G|4}}||Available at launch
|-
|[[Just Dance (song)|{{G2}}]] (C)||Lady Gaga ft. Colby O'Donis||2008||'''Solo'''||'''Easy'''
|'''Chill'''||[[File:Justdance cover.png|center|180px]]||{{G|2024}}||Available at launch
|-
|[[Toxic (Just Dance 2)|''Toxic'' ({{G2|2}})]] (C)
|Britney Spears
|2003
|'''Solo'''
|'''Hardest'''
|'''Chill'''
|[[File:Toxic cover.png|180px]]
|{{G|4}}
|January 27, 2026
|-
|''[[Don't Cha]]'' (C)
|The Pussycat Dolls ft. Busta Rhymes
|2005
|'''Trio'''
|'''Medium'''
|'''Chill'''
|[[File:DontCha Cover 2x.png|180px]]
|{{G|2024}}
|October 20, 2026
|}

===Alternate Routines===
{| class="wikitable sortable"
|-
! Song !! Routine !! Mode !! Difficulty !! Effort !! Cover !! Original Game !! Release Date
|-
|''[[Chiwawa/Remastered Version, by Barbie|Chiwawa]]''
|'''Barbie Version'''
|'''Solo'''
|'''Medium'''
|'''Moderate'''
|[[File:Barbie.jpg|center|180px]]
|{{G|4}}
|October 17, 2023
|}

===Removed Songs===
`;

const GAME_PAGE = `{{Infobox videogame
|release = '''Switch'''<br>October 13, 2026<br>'''Switch 2'''<br>November 10, 2026<ref name="x">https://example.com</ref>
|succeeded by = {{G|doh}}
}}
==Track List==
{| class="wikitable sortable"
|+'''There are 2 songs in this game.'''
|-
! scope="col" | Song
! scope="col" | Artist
! scope="col" | Year
! scope="col" | Mode
! scope="col" | Difficulty
! scope="col" | Effort
! scope="col" | Icon
|-
|{{Starter|''[[All Star|<span style="color:#FFFFFF">All Star</span>]]''}}
|Smash Mouth
|1999
| data-sort-value="4" |'''Quartet'''
| data-sort-value="1" |'''Easy'''
| data-sort-value="2" |'''Moderate'''
|[[File:AllStar Cover 2x.png|center|200px]]
|-
| rowspan="2" |''[[Hung Up]]'' (AG)
| rowspan="2" |Madonna
| rowspan="2" |2005
| rowspan="2" data-sort-value="3" |'''Trio'''
| data-sort-value="3" |'''Hard<br>(P1 & P3)'''
| rowspan="2" data-sort-value="2" |'''Moderate'''
| rowspan="2" |[[File:HungUp Cover 2x.png|center|200px]]
|-
| data-sort-value="1" |'''Easy<br>(P2)'''
|}

==Alternate Routines==
{| class="wikitable sortable"
|-
! scope="col" | Song
! scope="col" |Routine
! scope="col" |Mode
! scope="col" |Difficulty
! scope="col" |Effort
! scope="col" |Icon
|-
|''[[Hung Up/Cosmic Fitness Version|Hung Up]]''
|'''Cosmic Fitness Version'''
| data-sort-value="1" |'''Solo'''
| data-sort-value="1" |'''Easy'''
| data-sort-value="3" |'''Intense'''
|[[File:HungUpALT Cover 2x.png|center|200px]]
|}

==Unreleased Routines==
{| class="wikitable"
|-
! Song !! Artist !! Year
|-
|''[[Left Out]]'' || Nobody || 2025
|}
`;

// Wikitext helpers
check("clean strips links, quotes, spans and markers", clean(`{{Starter|''[[All Star|<span style="color:#FFF">All Star</span>]]''}} (C)`) === "All Star");
check("clean expands known templates", clean("[[Toxic (Just Dance 2)|''Toxic'' ({{G2|2}})]] (C)", TEMPLATES) === "Toxic (Just Dance 2)");
check("clean leaves no HTML behind", clean("<scr<script>ipt>alert(1)</script> Song") === "alert(1) Song", clean("<scr<script>ipt>alert(1)</script> Song"));
check("clean turns <br> into a space", clean("Britney Spears<br>(The Girly Team)") === "Britney Spears (The Girly Team)");
check("section stops at the next heading of the same level", !section(GAME_PAGE, "Alternate Routines").includes("Left Out"));
check("release date reads the first date in the infobox", releaseDate(GAME_PAGE) === "2026-10-13");
check("succeeded by reads the game template", succeededBy(GAME_PAGE).template === "G|doh");

const rows = tables(section(GAME_PAGE, "Track List"))[0];
check("rowspan cells carry down to the next row", rows.length === 3 && rows[2].Artist === "Madonna" && clean(rows[2].Difficulty) === "Easy (P2)");

// Just Dance+
const plus = plusSongs(PLUS_PAGE, TEMPLATES);
check("JD+ table gives every row", plus.length === 4, `${plus.length}`);
check("JD+ row fields", JSON.stringify(plus[0]) === JSON.stringify({
  title: "Baby One More Time",
  artist: "Britney Spears (The Girly Team)",
  year: 1998,
  game: "Just Dance+",
  originalGame: "Just Dance 4",
  releaseDate: "Available at launch",
  mode: "Quartet",
  difficulty: "Easy",
  effort: "Chill"
}), JSON.stringify(plus[0]));
check("JD+ {{G2}} title and Hardest → Extreme", plus[1].title === "Just Dance" && plus[2].difficulty === "Extreme");
check("JD+ alternate titles include the page form", plusAlternateTitles(PLUS_PAGE, TEMPLATES).includes("Chiwawa (Remastered Version, by Barbie)"));

// Boxed game
const game = gameSongs(GAME_PAGE, "Just Dance 2027 Edition", TEMPLATES);
check("boxed game: track list deduped plus alternates, unreleased skipped", game.map((song) => song.title).join("|") === "All Star|Hung Up|Hung Up (Cosmic Fitness Version)", game.map((song) => song.title).join("|"));
check("alternate routine takes the base song's artist", game[2].artist === "Madonna" && game[2].effort === "Intense");

// Merging
const catalog = [
  { title: "Baby One More Time", artist: "Britney Spears", game: "Just Dance+" },
  { title: "Just Dance", artist: "Lady Gaga", game: "Just Dance+" },
  { title: "Toxic (Just Dance 2)", artist: "Britney Spears", game: "Just Dance+" },
  { title: "Chiwawa (Remastered Version, by Barbie)", artist: "Wanko Ni Mero Mero", game: "Just Dance+" },
  { title: "Gone Song", artist: "Someone", game: "Just Dance+" },
  { title: "All Star", artist: "Smash Mouth", game: "Just Dance 2027 Edition" },
  { title: "Old Song", artist: "Old", game: "Just Dance 2" }
];
const sources = [
  { game: "Just Dance+", mode: "full", songs: plus, keep: plusAlternateTitles(PLUS_PAGE, TEMPLATES) },
  { game: "Just Dance 2027 Edition", mode: "add", songs: game }
];
const result = applySources(catalog, sources);
check("adds only songs not in the songlist", result.added.map((song) => song.title).join("|") === "Don't Cha|Hung Up|Hung Up (Cosmic Fitness Version)", result.added.map((song) => song.title).join("|"));
check("removes JD+ songs the wiki no longer lists, keeps listed alternates", result.removed.map((song) => song.title).join("|") === "Gone Song");
check("new songs go after their game's last song", result.catalog[4].title === "Don't Cha" && result.catalog[6].title === "Hung Up" && result.catalog[8].title === "Old Song", result.catalog.map((song) => song.title).join("|"));
check("small change is not held back", blockReason(result, catalog, sources) === "");

const many = { ...result, removed: Array.from({ length: 25 }, () => ({})) };
check("many removals are held back", /25 songs would be removed/.test(blockReason(many, catalog, sources)));
check("a broken wiki table is held back", /under half/.test(blockReason(result, catalog, [{ game: "Just Dance+", mode: "full", songs: plus.slice(0, 1) }])));

// Spreadsheet
const xlsx = songlistXlsx([{ title: "A & B <x>", artist: "C", year: 2020, game: "Just Dance 2027 Edition" }]);
check("xlsx is a zip", xlsx.readUInt32LE(0) === 0x04034b50);
const sheetStart = xlsx.indexOf(Buffer.from("xl/worksheets/sheet1.xml")) + "xl/worksheets/sheet1.xml".length;
const sheetLength = xlsx.readUInt32LE(xlsx.indexOf(Buffer.from("xl/worksheets/sheet1.xml")) - 30 + 18);
const sheet = zlib.inflateRawSync(xlsx.subarray(sheetStart, sheetStart + sheetLength)).toString("utf8");
check("xlsx sheet escapes text and writes numbers", sheet.includes("<t>A &amp; B &lt;x&gt;</t>") && sheet.includes('<c r="C2" t="n"><v>2020</v></c>'));
check("xlsx is the same for the same songlist", songlistXlsx([{ title: "x", artist: "y", game: "z" }]).equals(songlistXlsx([{ title: "x", artist: "y", game: "z" }])));

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll songlist checks passed.");
