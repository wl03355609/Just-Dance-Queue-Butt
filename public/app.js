const queueElement = document.querySelector("#queue");
const countElement = document.querySelector("#count");
const emptyElement = document.querySelector("#empty");
const nowPlayingElement = document.querySelector("#now-playing");
const lastSongElement = document.querySelector("#last-song");

function render(state) {
  countElement.textContent = state.queue.length;
  emptyElement.hidden = state.queue.length > 0;
  queueElement.replaceChildren(...state.queue.slice(0, 10).map(renderEntry));

  if (state.history.length) {
    const last = state.history[0];
    lastSongElement.textContent = `${last.song.title} - ${last.song.artist}`;
    nowPlayingElement.hidden = false;
  } else {
    nowPlayingElement.hidden = true;
  }
}

function renderEntry(entry, index) {
  const item = document.createElement("li");
  item.className = "queue-item";

  const position = document.createElement("span");
  position.className = "position";
  position.textContent = String(index + 1).padStart(2, "0");

  const content = document.createElement("div");
  content.className = "song";

  const title = document.createElement("strong");
  title.textContent = entry.song.title;

  const details = document.createElement("span");
  details.textContent = `${entry.song.artist} - ${entry.song.game.replace("Just Dance ", "JD ")}`;

  const user = document.createElement("span");
  user.className = "user";
  user.textContent = `@${entry.user}`;

  content.append(title, details);
  item.append(position, content, user);
  return item;
}

async function boot() {
  const response = await fetch("/api/queue");
  render(await response.json());

  const events = new EventSource("/events");
  events.onmessage = (event) => render(JSON.parse(event.data));
}

boot().catch(() => {
  emptyElement.textContent = "Queue is loading...";
});
