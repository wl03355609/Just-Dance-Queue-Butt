// Reads the song tables on Just Dance Wiki (justdance.fandom.com) pages from
// their wikitext. Only the bits of wiki markup those tables use are handled:
// links, bold/italic quotes, a few templates, <br>, <span>, refs and rowspan.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Splits on `sep` only outside [[...]] and {{...}}, so "[[File:x.png|center|200px]]" stays one piece.
function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const pair = text.slice(i, i + 2);
    if (pair === "[[" || pair === "{{") { depth += 1; i += 1; continue; }
    if ((pair === "]]" || pair === "}}") && depth > 0) { depth -= 1; i += 1; continue; }
    if (depth === 0 && text.startsWith(sep, i)) {
      parts.push(text.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// `| rowspan="2" data-sort-value="1" |'''Solo'''` → attributes + content.
function splitCell(raw) {
  const pieces = splitTopLevel(raw, "|");
  if (pieces.length > 1 && /^\s*[a-z-]+\s*=/i.test(pieces[0])) {
    return { attrs: pieces[0], content: pieces.slice(1).join("|") };
  }
  return { attrs: "", content: raw };
}

// The wikitext between a heading and the next heading of the same or higher level.
function section(wikitext, heading) {
  const lines = wikitext.split("\n");
  const wanted = heading.trim().toLowerCase();
  let level = 0;
  const out = [];
  for (const line of lines) {
    const match = line.match(/^(=+)\s*(.*?)\s*\1\s*$/);
    if (match) {
      if (level && match[1].length <= level) break;
      if (!level && match[2].toLowerCase() === wanted) { level = match[1].length; continue; }
    }
    if (level) out.push(line);
  }
  return level ? out.join("\n") : null;
}

// Every top-level {| ... |} table in `text`, as arrays of row objects keyed by header.
function tables(text) {
  const found = [];
  let depth = 0;
  let current = null;
  for (const line of text.split("\n")) {
    if (/^\s*\{\|/.test(line)) {
      depth += 1;
      if (depth === 1) { current = []; continue; }
    } else if (/^\s*\|\}/.test(line)) {
      depth -= 1;
      if (depth === 0) { found.push(parseTable(current)); current = null; continue; }
    }
    if (current) current.push(line);
  }
  return found;
}

function parseTable(lines) {
  const headers = [];
  const rows = [];
  let cells = null;
  const spans = []; // column index → { content, left }

  function finishRow() {
    if (!cells) return;
    const row = [];
    const spanPending = (from) => spans.some((span, index) => index >= from && span && span.left > 0);
    let source = 0;
    for (let col = 0; source < cells.length || spanPending(col); col += 1) {
      if (spans[col] && spans[col].left > 0) {
        row[col] = spans[col].content;
        spans[col].left -= 1;
        continue;
      }
      if (source >= cells.length) continue;
      const { attrs, content } = cells[source];
      source += 1;
      row[col] = content;
      const rowspan = Number((attrs.match(/rowspan\s*=\s*"?(\d+)/i) || [])[1] || 1);
      spans[col] = rowspan > 1 ? { content, left: rowspan - 1 } : null;
    }
    if (row.length) rows.push(row);
    cells = null;
  }

  let joined = [];
  // A cell can run over several lines; glue continuation lines onto the line that started it.
  for (const line of lines) {
    if (/^\s*(\||!)/.test(line) || !joined.length) joined.push(line);
    else joined[joined.length - 1] += `\n${line}`;
  }

  for (const line of joined) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|+")) continue;
    if (trimmed.startsWith("|-")) { finishRow(); cells = []; continue; }
    if (trimmed.startsWith("!")) {
      for (const raw of splitTopLevel(trimmed.slice(1), "!!")) headers.push(clean(splitCell(raw).content));
      continue;
    }
    if (trimmed.startsWith("|")) {
      if (!cells) cells = [];
      for (const raw of splitTopLevel(trimmed.slice(1), "||")) cells.push(splitCell(raw));
    }
  }
  finishRow();

  return rows.map((row) => {
    const out = {};
    headers.forEach((header, index) => { out[header] = row[index] == null ? "" : row[index]; });
    return out;
  });
}

// Wiki markup → plain text. `templates` maps "G|2024" style calls to their text.
function clean(value, templates = {}) {
  let text = String(value || "");
  text = text.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, " ");
  // Any other tag goes too, repeated until none is left, and a stray < or > is
  // dropped: song data is plain text and no title in the list uses them.
  for (let previous = null; previous !== text;) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  }
  text = text.replace(/[<>]/g, "");
  // Innermost templates first, so {{Starter|''[[A|B]]''}} works.
  for (let guard = 0; guard < 20 && /\{\{[^{}]*\}\}/.test(text); guard += 1) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (match, inner) => expandTemplate(inner, templates));
  }
  text = text.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "");
  for (let guard = 0; guard < 5 && /\[\[[^\]]*\]\]/.test(text); guard += 1) {
    text = text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[([^\]]*)\]\]/g, "$1");
  }
  text = text.replace(/'{2,}/g, "");
  // Row markers such as "(C)" (camera scoring) or "(AG)" after a title.
  text = text.replace(/\s*\([A-Z]{1,3}\)\s*$/, "");
  return text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function expandTemplate(inner, templates) {
  const key = inner.trim();
  if (Object.prototype.hasOwnProperty.call(templates, key)) return templates[key];
  const [name, ...args] = splitTopLevel(key, "|");
  const lower = name.trim().toLowerCase();
  if (["covered", "demo", "reflist", "jduex"].includes(lower)) return "";
  if (lower === "ht") return args[0] || "";
  // Wrappers such as {{Starter|...}} just style their first argument.
  return args.length ? args[0] : "";
}

// The page link inside a cell, e.g. "Abracadabra/Extreme Version" for an alternate routine.
function linkTarget(value) {
  const match = String(value || "").match(/\[\[([^\]|]+)/);
  return match ? match[1].trim() : "";
}

// Every {{G...}} / {{G2...}} call, so they can be expanded once through the wiki API.
function gameTemplates(wikitext) {
  return [...new Set((String(wikitext).match(/\{\{G2?(\|[^{}]*)?\}\}/g) || []).map((call) => call.slice(2, -2).trim()))];
}

// "|release = '''Switch'''<br>October 13, 2026<br>..." → first date as YYYY-MM-DD.
function releaseDate(wikitext) {
  const field = (String(wikitext).match(/^\|\s*release\s*=(.*)$/im) || [])[1] || "";
  const match = field.match(new RegExp(`(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s*(\\d{4})`));
  if (!match) return "";
  const month = String(MONTHS.indexOf(match[1]) + 1).padStart(2, "0");
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

// "|succeeded by = {{G|doh}}" → "G|doh" (still a template call).
function succeededBy(wikitext) {
  const field = (String(wikitext).match(/^\|\s*succeeded by\s*=(.*)$/im) || [])[1] || "";
  const call = field.match(/\{\{(G2?\|[^{}]*)\}\}/);
  if (call) return { template: call[1].trim() };
  const link = linkTarget(field);
  return link ? { page: link } : null;
}

module.exports = {
  splitTopLevel,
  section,
  tables,
  clean,
  linkTarget,
  gameTemplates,
  releaseDate,
  succeededBy
};
