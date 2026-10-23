const channelElement = document.querySelector("#channel");
const botStatusElement = document.querySelector("#bot-status");
const queueCountElement = document.querySelector("#queue-count");
const queueLimitElement = document.querySelector("#queue-limit");
const queueStateElement = document.querySelector("#queue-state");
const songCountElement = document.querySelector("#song-count");
const gamesCountElement = document.querySelector("#games-count");
const currentPlayingElement = document.querySelector("#current-playing");
const currentPlayingTitleElement = document.querySelector("#current-playing-title");
const currentPlayingDetailElement = document.querySelector("#current-playing-detail");
const queueHeadingCountElement = document.querySelector("#queue-heading-count");
const queueElement = document.querySelector("#dashboard-queue");
const queueEmptyElement = document.querySelector("#dashboard-empty");
const historyElement = document.querySelector("#history");
const historyEmptyElement = document.querySelector("#history-empty");
const historyHeadingElement = document.querySelector("#history-heading");
const historyCountElement = document.querySelector("#history-count");
const playedToolsElement = document.querySelector("#played-tools");
const repeatModeSelect = document.querySelector("#repeat-mode");
const newStreamButton = document.querySelector("#new-stream-button");
const messageElement = document.querySelector("#message");
const requestForm = document.querySelector("#request-form");
const requestSongInput = document.querySelector("#request-song");
const songList = document.querySelector("#song-list");
const skipButton = document.querySelector("#skip-button");
const clearButton = document.querySelector("#clear-button");
const queueToggleButton = document.querySelector("#queue-toggle-button");
const reconnectButton = document.querySelector("#reconnect-button");
let queueOpenState = true;
const themeSelect = document.querySelector("#theme-select");
const modeToggleButton = document.querySelector("#mode-toggle-button");
let currentTheme = "poster";
let currentMode = "light";
const gameFiltersElement = document.querySelector("#game-filters");
const filterCountElement = document.querySelector("#filter-count");
const applyFiltersButton = document.querySelector("#apply-filters");
const selectAllFiltersButton = document.querySelector("#select-all-filters");
const deselectAllFiltersButton = document.querySelector("#deselect-all-filters");
const filterToggle = document.querySelector("#filter-toggle");
const filterBody = document.querySelector("#filter-body");

let allSongs = [];
let gameOptions = [];
let currentHistory = [];
let currentPlayed = null; // hosted bot only: songs played this stream
const adminToken = new URLSearchParams(window.location.search).get("token") || "";

function render(state) {
  currentHistory = state.history || [];
  currentPlayed = state.played || null;
  channelElement.textContent = state.channel ? `#${state.channel}` : "-";
  botStatusElement.textContent = state.botConnected ? "Bot in chat" : "Bot offline";
  botStatusElement.className = `pill ${state.botConnected ? "connected" : "offline"}`;
  queueCountElement.textContent = state.queue.length;
  queueLimitElement.textContent = state.maxQueueSize;
  songCountElement.textContent = Number(state.totalSongs || 0).toLocaleString();
  queueHeadingCountElement.textContent = `${state.queue.length} waiting`;

  queueElement.replaceChildren(...state.queue.map(renderQueueEntry));
  queueEmptyElement.hidden = state.queue.length > 0;
  renderHistory(state);
  renderTheme(state);
  renderGameFilters(state);
  renderQueueOpenState(state.queueOpen !== false);
  renderCurrentPlaying(state);
}

// The hosted bot sends `played`: everything played this stream, with the repeat-warning setting.
// The offline bot only has the short history.
function renderHistory(state) {
  if (currentPlayed) {
    const entries = currentPlayed.entries || [];
    historyHeadingElement.textContent = "Played this stream";
    historyCountElement.textContent = `${entries.length} played${currentPlayed.live ? " · live" : ""}`;
    historyElement.replaceChildren(...entries.map((entry, index) => renderHistoryEntry({ song: entry, user: entry.user }, index)));
    historyEmptyElement.hidden = entries.length > 0;
    historyEmptyElement.textContent = "Nothing played this stream yet.";
    playedToolsElement.hidden = false;
    repeatModeSelect.value = currentPlayed.repeatMode || (currentPlayed.warnRepeats === false ? "off" : "skip");
    return;
  }
  historyHeadingElement.textContent = "History";
  historyCountElement.textContent = "Last 10";
  historyElement.replaceChildren(...state.history.slice(0, 10).map(renderHistoryEntry));
  historyEmptyElement.hidden = state.history.length > 0;
  playedToolsElement.hidden = true;
}

function playedBefore(song) {
  const key = normalize(song.title);
  const list = currentPlayed ? currentPlayed.entries.map((entry) => ({ song: entry })) : currentHistory;
  return list.some((h) => (song.id && h.song.id === song.id) || normalize(h.song.title) === key);
}

function renderCurrentPlaying(state) {
  const current = state.history?.[0];
  if (!current) {
    currentPlayingElement.classList.add("is-empty");
    currentPlayingTitleElement.textContent = "Nothing playing yet";
    currentPlayingDetailElement.textContent = "Press Next and the first request lands here.";
    return;
  }
  currentPlayingElement.classList.remove("is-empty");
  currentPlayingTitleElement.textContent = current.song.title;
  currentPlayingDetailElement.textContent = `${current.song.artist} · requested by @${current.user}`;
}

function renderQueueOpenState(open) {
  queueOpenState = open;
  if (queueStateElement) {
    queueStateElement.textContent = open ? "Open" : "Closed";
    queueStateElement.className = `jd-display ${open ? "open" : "closed"}`;
  }
  if (!queueToggleButton) return;
  queueToggleButton.textContent = open ? "Close Queue" : "Open Queue";
}

function renderTheme(state) {
  const themes = Array.isArray(state.overlayThemes) ? state.overlayThemes : [];
  currentTheme = state.overlayTheme || "poster";
  currentMode = state.overlayMode === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = currentTheme;
  document.documentElement.dataset.mode = currentMode;

  if (themeSelect && themes.length && themeSelect.options.length !== themes.length) {
    themeSelect.replaceChildren(...themes.map((theme) => {
      const option = document.createElement("option");
      option.value = theme.key;
      option.textContent = theme.label;
      return option;
    }));
  }
  if (themeSelect) themeSelect.value = currentTheme;
  if (modeToggleButton) {
    const label = currentMode === "dark" ? "Dark mode on. Switch to light mode" : "Light mode on. Switch to dark mode";
    modeToggleButton.setAttribute("aria-label", label);
    modeToggleButton.title = label;
  }
}

function renderGameFilters(state) {
  if (!state.availableGames) return;

  gameOptions = state.availableGames;
  const enabled = new Set(state.enabledGames || []);
  const activeCount = gameOptions.filter((game) => enabled.has(game.key)).length;
  filterCountElement.textContent = `${activeCount} active`;
  if (gamesCountElement) {
    gamesCountElement.replaceChildren(
      document.createTextNode(String(activeCount)),
      Object.assign(document.createElement("small"), { textContent: `/${gameOptions.length}` })
    );
  }

  gameFiltersElement.replaceChildren(...gameOptions.map((game) => {
    const label = document.createElement("label");
    label.className = "filter-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = game.key;
    input.checked = enabled.has(game.key);

    const text = document.createElement("span");
    text.textContent = game.count === null ? `${game.label} (any song)` : `${game.label} (${game.count})`;

    label.append(input, text);
    return label;
  }));
}

function setAllFilters(checked) {
  for (const input of gameFiltersElement.querySelectorAll("input")) {
    input.checked = checked;
  }
  filterCountElement.textContent = `${gameFiltersElement.querySelectorAll("input:checked").length} active`;
}

function positionElement(index) {
  const position = document.createElement("span");
  position.className = "dashboard-position";
  position.textContent = String(index + 1).padStart(2, "0");
  return position;
}

function renderQueueEntry(entry, index) {
  const item = document.createElement("li");
  item.className = "dashboard-item";

  const main = document.createElement("div");
  main.className = "dashboard-song";

  const isWheel = entry.song.wheel === true;

  const title = document.createElement("strong");
  title.textContent = entry.song.title;

  const details = document.createElement("span");
  // Wheel spins already say "Wheel" in the title, so drop the redundant game to avoid duplicate text.
  details.textContent = isWheel
    ? entry.song.artist
    : `${entry.song.artist} · ${entry.song.game}`;

  // A wheel spin isn't a specific catalog song, so it should never be flagged as a repeat.
  if (!isWheel && playedBefore(entry.song)) {
    const badge = document.createElement("span");
    badge.className = "done-badge";
    badge.textContent = "Done before";
    main.append(title, details, badge);
  } else {
    main.append(title, details);
  }

  const actions = document.createElement("div");
  actions.className = "dashboard-actions";

  const requester = document.createElement("span");
  requester.className = "requester";
  requester.textContent = `@${entry.user}`;

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "icon-button";
  pick.textContent = "Pick";
  pick.setAttribute("aria-label", `Play ${entry.song.title} next`);
  pick.addEventListener("click", () => postJson("api/pick", { id: entry.id }).catch((error) => showMessage(error.message)));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${entry.song.title}`);
  remove.addEventListener("click", () => removeEntry(entry.id));

  actions.append(requester, pick, remove);
  item.append(positionElement(index), main, actions);
  return item;
}

function renderHistoryEntry(entry, index) {
  const item = document.createElement("li");
  item.className = "dashboard-item simple";

  const main = document.createElement("div");
  main.className = "dashboard-song";

  const title = document.createElement("strong");
  title.textContent = entry.song.title;

  const details = document.createElement("span");
  details.textContent = `${entry.song.artist} · @${entry.user}`;

  main.append(title, details);
  item.append(positionElement(index), main);
  return item;
}

async function postJson(path, body = {}, options = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || "Request failed.");
  if (!options.silent) showMessage(data.message || "Done.");
  if (data.state) render(data.state);
  return data;
}

function adminHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (adminToken) headers["X-Queue-Admin"] = adminToken;
  return headers;
}

function showMessage(message) {
  messageElement.textContent = message;
}

async function addRequest(event) {
  event.preventDefault();
  await postJson("api/request", {
    song: requestSongInput.value.trim()
  });
  requestSongInput.value = "";
}

async function refreshSongs() {
  const response = await fetch("api/songs");
  allSongs = (await response.json()).songs;
  updateSongSuggestions();
}

async function removeEntry(id) {
  await postJson("api/remove", { id });
}

function updateSongSuggestions() {
  const query = normalize(requestSongInput.value);
  const matches = allSongs
    .filter((song) => {
      if (!query) return true;
      return normalize(`${song.title} ${song.artist} ${song.game}`).includes(query);
    })
    .slice(0, 25);

  songList.replaceChildren(...matches.map((song) => {
    const option = document.createElement("option");
    option.value = song.title;
    option.label = `${song.title} - ${song.artist} - ${song.game}`;
    option.textContent = `${song.title} - ${song.artist} - ${song.game}`;
    return option;
  }));
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

async function boot() {
  const [queueResponse, songsResponse] = await Promise.all([
    fetch("api/queue"),
    fetch("api/songs")
  ]);

  render(await queueResponse.json());
  allSongs = (await songsResponse.json()).songs;
  updateSongSuggestions();

  const events = new EventSource("events");
  events.onmessage = (event) => render(JSON.parse(event.data));
}

requestForm.addEventListener("submit", (event) => {
  addRequest(event).catch((error) => showMessage(error.message));
});

requestSongInput.addEventListener("input", updateSongSuggestions);
skipButton.addEventListener("click", () => postJson("api/skip").catch((error) => showMessage(error.message)));
clearButton.addEventListener("click", () => {
  if (!window.confirm("Clear the entire queue?")) return;
  postJson("api/clear").catch((error) => showMessage(error.message));
});

queueToggleButton.addEventListener("click", () => {
  postJson("api/queue/state", { open: !queueOpenState }).catch((error) => showMessage(error.message));
});

themeSelect.addEventListener("change", () => {
  postJson("api/theme", { overlayTheme: themeSelect.value }).catch((error) => showMessage(error.message));
});

repeatModeSelect.addEventListener("change", () => {
  postJson("api/played/settings", { repeatMode: repeatModeSelect.value }).catch((error) => showMessage(error.message));
});

newStreamButton.addEventListener("click", () => {
  if (!window.confirm("Clear the played list? Songs played so far can be requested again.")) return;
  postJson("api/played/clear").catch((error) => showMessage(error.message));
});

modeToggleButton.addEventListener("click", () => {
  const next = currentMode === "dark" ? "light" : "dark";
  postJson("api/theme", { overlayMode: next }).catch((error) => showMessage(error.message));
});

reconnectButton.addEventListener("click", () => postJson("api/bot/reconnect").catch((error) => showMessage(error.message)));

selectAllFiltersButton.addEventListener("click", () => setAllFilters(true));
deselectAllFiltersButton.addEventListener("click", () => setAllFilters(false));

filterToggle.addEventListener("click", () => {
  const expanded = filterToggle.getAttribute("aria-expanded") === "true";
  filterToggle.setAttribute("aria-expanded", String(!expanded));
  filterBody.hidden = expanded;
});

applyFiltersButton.addEventListener("click", async () => {
  const enabledGames = [...gameFiltersElement.querySelectorAll("input:checked")]
    .map((input) => input.value);

  try {
    await postJson("api/filters", { enabledGames });
    await refreshSongs();
  } catch (error) {
    showMessage(error.message);
  }
});

boot().catch((error) => showMessage(error.message));
