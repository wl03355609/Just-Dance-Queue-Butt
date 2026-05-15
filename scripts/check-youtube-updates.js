const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CHANNEL_ID = "UChIjW4BWKLqpojTrS_tX0mg";
const SEEN_PATH = path.join(ROOT, "data", "youtube-seen.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outputArgIndex = args.indexOf("--output");
const outputPath = outputArgIndex !== -1 ? args[outputArgIndex + 1] : null;

const channelId = process.env.JUST_DANCE_CHANNEL_ID || DEFAULT_CHANNEL_ID;
const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

async function main() {
  const feed = await fetchFeed(feedUrl);
  const entries = parseFeed(feed);

  if (!entries.length) {
    console.error(`No entries returned for channel ${channelId}. Feed may have changed format.`);
    process.exit(1);
  }

  const seen = loadSeen();
  const seenIds = new Set(seen);
  const newEntries = entries.filter((entry) => !seenIds.has(entry.videoId));

  const summary = buildSummary(newEntries);
  if (outputPath) {
    fs.writeFileSync(outputPath, summary);
  } else if (newEntries.length) {
    process.stdout.write(summary);
  }

  if (!dryRun && newEntries.length) {
    const updatedSeen = [...new Set([...newEntries.map((e) => e.videoId), ...seen])].slice(0, 200);
    fs.writeFileSync(SEEN_PATH, JSON.stringify(updatedSeen, null, 2) + "\n");
  }

  console.log(JSON.stringify({
    channel: channelId,
    totalEntries: entries.length,
    newCount: newEntries.length,
    newVideoIds: newEntries.map((e) => e.videoId)
  }));
}

async function fetchFeed(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "just-dance-butt/youtube-watch" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`YouTube RSS fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function parseFeed(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const videoId = pluck(block, /<yt:videoId>([^<]+)<\/yt:videoId>/);
    const title = decodeEntities(pluck(block, /<title>([^<]+)<\/title>/));
    const published = pluck(block, /<published>([^<]+)<\/published>/);
    const link = pluck(block, /<link rel="alternate" href="([^"]+)"/);
    if (videoId && title) {
      entries.push({ videoId, title, published, link });
    }
  }
  return entries;
}

function pluck(block, regex) {
  const m = block.match(regex);
  return m ? m[1] : "";
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function loadSeen() {
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function buildSummary(entries) {
  if (!entries.length) {
    return "";
  }

  const lines = [
    `## ${entries.length} new video${entries.length === 1 ? "" : "s"} on the Just Dance channel`,
    "",
    "Review and decide whether to add any of these to `data/songs.json`.",
    "",
    "| Published | Title | Link |",
    "| --- | --- | --- |"
  ];
  for (const entry of entries) {
    const date = entry.published ? entry.published.slice(0, 10) : "";
    const safeTitle = entry.title.replace(/\|/g, "\\|");
    lines.push(`| ${date} | ${safeTitle} | ${entry.link} |`);
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((error) => {
  console.error("YouTube check failed:", error.message);
  process.exit(1);
});
