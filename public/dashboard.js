const channelElement = document.querySelector("#channel");
const botStatusElement = document.querySelector("#bot-status");
const queueCountElement = document.querySelector("#queue-count");
const queueLimitElement = document.querySelector("#queue-limit");
const songCountElement = document.querySelector("#song-count");
const queueHeadingCountElement = document.querySelector("#queue-heading-count");
const queueElement = document.querySelector("#dashboard-queue");
const queueEmptyElement = document.querySelector("#dashboard-empty");
const historyElement = document.querySelector("#history");
const historyEmptyElement = document.querySelector("#history-empty");
const messageElement = document.querySelector("#message");
const requestForm = document.querySelector("#request-form");
const requestSongInput = document.querySelector("#request-song");
const songList = document.querySelector("#song-list");
const skipButton = document.querySelector("#skip-button");
const clearButton = document.querySelector("#clear-button");
const overlayThemeLabel = document.querySelector("#overlay-theme-label");
const themeButtons = [...document.querySelectorAll("[data-theme]")];
const gameFiltersElement = document.querySelector("#game-filters");
const filterCountElement = document.querySelector("#filter-count");
const applyFiltersButton = document.querySelector("#apply-filters");
const selectAllFiltersButton = document.querySelector("#select-all-filters");
const deselectAllFiltersButton = document.querySelector("#deselect-all-filters");
const showPairingCodeButton = document.querySelector("#show-pairing-code");
const pairingStatusElement = document.querySelector("#pairing-status");
const pairingCodePanel = document.querySelector("#dashboard-pairing-code-panel");
const pairingCodeElement = document.querySelector("#dashboard-pairing-code");
const pairingCodeStatusElement = document.querySelector("#dashboard-pairing-code-status");
const pairingCodeTimer = document.querySelector("#dashboard-pairing-code-timer");
const pairingCodeCountdown = document.querySelector("#dashboard-pairing-code-countdown");

let allSongs = [];
let gameOptions = [];
let currentHistory = [];
let pairingExpiresAt = 0;
let pairingTtlMs = 5 * 60 * 1000;
let pairingCountdownTimer = null;
let pairingRefreshTimer = null;
const adminToken = new URLSearchParams(window.location.search).get("token") || "";

function render(state) {
  currentHistory = state.history || [];
  channelElement.textContent = state.channel ? `#${state.channel}` : "-";
  botStatusElement.textContent = state.botConnected ? "Connected" : "Offline";
  botStatusElement.className = state.botConnected ? "connected" : "offline";
  queueCountElement.textContent = state.queue.length;
  queueLimitElement.textContent = state.maxQueueSize;
  songCountElement.textContent = state.totalSongs;
  queueHeadingCountElement.textContent = `${state.queue.length} waiting`;

  queueElement.replaceChildren(...state.queue.map(renderQueueEntry));
  historyElement.replaceChildren(...state.history.map(renderHistoryEntry));
  queueEmptyElement.hidden = state.queue.length > 0;
  historyEmptyElement.hidden = state.history.length > 0;
  renderOverlayTheme(state.overlayTheme || "dark");
  renderGameFilters(state);
}

function renderOverlayTheme(theme) {
  overlayThemeLabel.textContent = theme === "light" ? "Light" : "Dark";
  for (const button of themeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
  }
}

function renderGameFilters(state) {
  if (!state.availableGames) return;

  gameOptions = state.availableGames;
  const enabled = new Set(state.enabledGames || []);
  filterCountElement.textContent = `${enabled.size} active`;

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

function renderQueueEntry(entry, index) {
  const item = document.createElement("li");
  item.className = "dashboard-item";

  const main = document.createElement("div");
  main.className = "dashboard-song";

  const title = document.createElement("strong");
  title.textContent = `${index + 1}. ${entry.song.title}`;

  const details = document.createElement("span");
  details.textContent = `${entry.song.artist} - ${entry.song.game} - @${entry.user}`;

  const playedBefore = currentHistory.some((h) => h.song.id === entry.song.id || normalize(h.song.title) === normalize(entry.song.title));
  if (playedBefore) {
    const badge = document.createElement("span");
    badge.className = "done-badge";
    badge.textContent = "Done before";
    main.append(title, details, badge);
  } else {
    main.append(title, details);
  }

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "icon-button";
  pick.textContent = "Pick";
  pick.addEventListener("click", () => postJson("/api/pick", { id: entry.id }).catch((error) => showMessage(error.message)));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => removeEntry(entry.id));

  item.append(main, pick, remove);
  return item;
}

function renderHistoryEntry(entry, index) {
  const item = document.createElement("li");
  item.className = "dashboard-item simple";

  const main = document.createElement("div");
  main.className = "dashboard-song";

  const title = document.createElement("strong");
  title.textContent = `${index + 1}. ${entry.song.title}`;

  const details = document.createElement("span");
  details.textContent = `${entry.song.artist} - @${entry.user}`;

  main.append(title, details);
  item.append(main);
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

function clearPairingTimers() {
  clearInterval(pairingCountdownTimer);
  clearTimeout(pairingRefreshTimer);
  pairingCountdownTimer = null;
  pairingRefreshTimer = null;
}

function formatPairingRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function updatePairingCountdown() {
  const remaining = Math.max(0, pairingExpiresAt - Date.now());
  const progress = pairingTtlMs <= 0 ? 0 : remaining / pairingTtlMs;
  pairingCodeCountdown.textContent = formatPairingRemaining(remaining);
  pairingCodeTimer.style.setProperty("--otp-progress", `${Math.round(progress * 360)}deg`);
  pairingStatusElement.textContent = "Visible";
  pairingCodeStatusElement.textContent = "Enter this code in the Android app. The code rotates when the countdown reaches 0.";
}

function schedulePairingRefresh(result) {
  clearPairingTimers();
  pairingTtlMs = Math.max(1, Number(result.ttlSeconds || 300)) * 1000;
  pairingExpiresAt = Number(result.expiresAt) || Date.now() + pairingTtlMs;
  updatePairingCountdown();
  pairingCountdownTimer = setInterval(updatePairingCountdown, 1000);
  pairingRefreshTimer = setTimeout(() => {
    if (!pairingCodePanel.hidden) {
      showPairingCode({ refreshed: true }).catch((error) => {
        pairingCodeStatusElement.textContent = error.message;
      });
    }
  }, Math.max(1000, pairingExpiresAt - Date.now()));
}

async function showPairingCode(options = {}) {
  const result = await postJson("/api/companion/pairing-code", {}, { silent: true });
  pairingCodeElement.textContent = result.code;
  pairingCodePanel.hidden = false;
  schedulePairingRefresh(result);
  showMessage(options.refreshed ? "Phone pairing code refreshed." : "Phone pairing code shown.");
}

async function addRequest(event) {
  event.preventDefault();
  await postJson("/api/request", {
    song: requestSongInput.value.trim()
  });
  requestSongInput.value = "";
}

async function refreshSongs() {
  const response = await fetch("/api/songs");
  allSongs = (await response.json()).songs;
  updateSongSuggestions();
}

async function removeEntry(id) {
  await postJson("/api/remove", { id });
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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

async function boot() {
  const [queueResponse, songsResponse] = await Promise.all([
    fetch("/api/queue"),
    fetch("/api/songs")
  ]);

  render(await queueResponse.json());
  allSongs = (await songsResponse.json()).songs;
  updateSongSuggestions();

  const events = new EventSource("/events");
  events.onmessage = (event) => render(JSON.parse(event.data));
}

requestForm.addEventListener("submit", (event) => {
  addRequest(event).catch((error) => showMessage(error.message));
});

requestSongInput.addEventListener("input", updateSongSuggestions);
skipButton.addEventListener("click", () => postJson("/api/skip").catch((error) => showMessage(error.message)));
clearButton.addEventListener("click", () => {
  if (!window.confirm("Clear the entire queue?")) return;
  postJson("/api/clear").catch((error) => showMessage(error.message));
});
showPairingCodeButton.addEventListener("click", () => {
  showPairingCode().catch((error) => showMessage(error.message));
});

for (const button of themeButtons) {
  button.addEventListener("click", () => {
    postJson("/api/theme", { overlayTheme: button.dataset.theme }).catch((error) => showMessage(error.message));
  });
}

selectAllFiltersButton.addEventListener("click", () => setAllFilters(true));
deselectAllFiltersButton.addEventListener("click", () => setAllFilters(false));

applyFiltersButton.addEventListener("click", async () => {
  const enabledGames = [...gameFiltersElement.querySelectorAll("input:checked")]
    .map((input) => input.value);

  try {
    await postJson("/api/filters", { enabledGames });
    await refreshSongs();
  } catch (error) {
    showMessage(error.message);
  }
});

boot().catch((error) => showMessage(error.message));
