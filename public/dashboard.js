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
const requestUserInput = document.querySelector("#request-user");
const requestSongInput = document.querySelector("#request-song");
const songList = document.querySelector("#song-list");
const skipButton = document.querySelector("#skip-button");
const clearButton = document.querySelector("#clear-button");
const gameFiltersElement = document.querySelector("#game-filters");
const filterCountElement = document.querySelector("#filter-count");
const applyFiltersButton = document.querySelector("#apply-filters");

let allSongs = [];
let gameOptions = [];

function render(state) {
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
  renderGameFilters(state);
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
    text.textContent = `${game.label} (${game.count})`;

    label.append(input, text);
    return label;
  }));
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

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => removeEntry(entry.id));

  main.append(title, details);
  item.append(main, remove);
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

async function postJson(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || "Request failed.");
  showMessage(data.message || "Done.");
  if (data.state) render(data.state);
  return data;
}

function showMessage(message) {
  messageElement.textContent = message;
}

async function addRequest(event) {
  event.preventDefault();
  await postJson("/api/request", {
    user: requestUserInput.value.trim() || "dashboard",
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
    option.label = `${song.artist} - ${song.game}`;
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
