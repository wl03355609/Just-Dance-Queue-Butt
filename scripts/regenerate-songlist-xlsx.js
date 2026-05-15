const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const XLSX_PATH = path.join(ROOT, "songlist.xlsx");
const SONGS_PATH = path.join(ROOT, "data", "songs.json");

const COLUMNS = [
  { header: "Title", key: "title", type: "string" },
  { header: "Artist", key: "artist", type: "string" },
  { header: "Year", key: "year", type: "number" },
  { header: "Game", key: "game", type: "string" },
  { header: "Original Game", key: "originalGame", type: "string" },
  { header: "Region", key: "region", type: "string" },
  { header: "Release Date", key: "releaseDate", type: "string" },
  { header: "Mode", key: "mode", type: "string" },
  { header: "Difficulty", key: "difficulty", type: "string" },
  { header: "Effort", key: "effort", type: "string" }
];

function colLetter(index) {
  let n = index;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSheetXml(songs) {
  const rows = [];

  const headerCells = COLUMNS.map((col, i) => {
    const ref = `${colLetter(i)}1`;
    return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(col.header)}</t></is></c>`;
  }).join("");
  rows.push(`<row r="1">${headerCells}</row>`);

  songs.forEach((song, songIndex) => {
    const rowNum = songIndex + 2;
    const cells = COLUMNS.map((col, i) => {
      const ref = `${colLetter(i)}${rowNum}`;
      const raw = song[col.key];
      if (col.type === "number" && typeof raw === "number" && Number.isFinite(raw)) {
        return `<c r="${ref}"><v>${raw}</v></c>`;
      }
      const text = raw === undefined || raw === null ? "" : String(raw);
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
    }).join("");
    rows.push(`<row r="${rowNum}">${cells}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`No existing xlsx at ${XLSX_PATH} to use as a template.`);
    process.exit(1);
  }

  const songs = JSON.parse(fs.readFileSync(SONGS_PATH, "utf8"));
  console.log(`Loaded ${songs.length} songs from data/songs.json`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "songlist-xlsx-"));
  try {
    execFileSync("unzip", ["-qq", XLSX_PATH, "-d", workDir], { stdio: "inherit" });

    const sheetPath = path.join(workDir, "xl", "worksheets", "sheet1.xml");
    fs.writeFileSync(sheetPath, buildSheetXml(songs));
    console.log(`Wrote regenerated sheet (${songs.length + 1} rows).`);

    fs.rmSync(XLSX_PATH, { force: true });
    execFileSync("zip", ["-qr", XLSX_PATH, "."], { cwd: workDir, stdio: "inherit" });

    const size = fs.statSync(XLSX_PATH).size;
    console.log(`Wrote ${path.relative(ROOT, XLSX_PATH)} (${size.toLocaleString()} bytes).`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
