const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "songlist.xlsx");
const dist = path.join(root, "dist");
const target = path.join(dist, "songlist.xlsx");

if (!fs.existsSync(source)) {
  throw new Error(`Missing songlist export: ${source}`);
}

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied songlist.xlsx to ${path.relative(root, target)}`);
