const clientIdSection = document.querySelector("#client-id-section");
const clientIdInput = document.querySelector("#client-id");
const loggedInBadge = document.querySelector("#logged-in-badge");
const loggedInUser = document.querySelector("#logged-in-user");
const usernameInput = document.querySelector("#username");
const channelSelect = document.querySelector("#channel-select");
const channelCustom = document.querySelector("#channel-custom");
const portInput = document.querySelector("#port");
const maxQueueInput = document.querySelector("#max-queue");
const overlayUrlCode = document.querySelector("#overlay-url");
const dashboardUrlCode = document.querySelector("#dashboard-url");
const message = document.querySelector("#message");
const runStatus = document.querySelector("#run-status");
const authCode = document.querySelector("#auth-code");
const userCode = document.querySelector("#user-code");

let currentConfig = null;

function getChannel() {
  if (channelSelect.value === "__custom__") {
    return channelCustom.value.trim().replace(/^#/, "").toLowerCase();
  }
  return channelSelect.value;
}

function renderChannelSelect(channel, defaultChannel) {
  const isDefault = channel === defaultChannel || !channel;
  // Make sure the default channel option exists and is up to date
  const defaultOpt = channelSelect.querySelector(`option[value="${defaultChannel}"]`);
  if (defaultOpt) defaultOpt.textContent = `${defaultChannel} (default)`;

  if (isDefault || channelSelect.querySelector(`option[value="${channel}"]`)) {
    channelSelect.value = isDefault ? defaultChannel : channel;
    channelCustom.hidden = true;
  } else {
    channelSelect.value = "__custom__";
    channelCustom.value = channel;
    channelCustom.hidden = false;
  }
}

function render(config) {
  currentConfig = config;
  clientIdInput.value = config.clientId || "";
  usernameInput.value = config.username || "";
  usernameInput.placeholder = config.username ? "" : (config.defaultSpeaker || "not logged in");
  renderChannelSelect(config.channel, config.defaultChannel || "qutebutt");
  portInput.value = config.port || 3000;
  maxQueueInput.value = config.maxQueueSize || 50;
  overlayUrlCode.textContent = config.overlayUrl;
  dashboardUrlCode.textContent = config.dashboardUrl;
  runStatus.textContent = config.running ? "Running" : "Stopped";
  runStatus.className = config.running ? "status running" : "status";
  document.querySelector("#next-button").disabled = !config.running;

  if (config.hasBundledClientId) {
    clientIdSection.hidden = true;
  }

  if (config.loggedIn && config.username) {
    loggedInBadge.hidden = false;
    loggedInUser.textContent = config.username;
    document.querySelector("#login-button").textContent = "Re-login with Twitch";
  } else {
    loggedInBadge.hidden = true;
    document.querySelector("#login-button").textContent = "Log in with Twitch";
  }
}

function formConfig() {
  return {
    clientId: clientIdInput.value.trim(),
    channel: getChannel(),
    port: Number.parseInt(portInput.value, 10) || 3000,
    maxQueueSize: Number.parseInt(maxQueueInput.value, 10) || 50,
    enabledGames: ["2023", "2024", "2025", "2026", "plus"]
  };
}

function show(text) {
  message.textContent = text;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

channelSelect.addEventListener("change", () => {
  channelCustom.hidden = channelSelect.value !== "__custom__";
  if (!channelCustom.hidden) channelCustom.focus();
});

document.querySelector("#login-button").addEventListener("click", async () => {
  try {
    const config = await window.jdApp.saveConfig(formConfig());
    render(config);
    const auth = await window.jdApp.startAuth(clientIdInput.value.trim());
    userCode.textContent = auth.userCode;
    authCode.hidden = false;
    show("Twitch login opened. Enter the code shown above, then come back here.");
  } catch (error) {
    show(error.message);
  }
});

document.querySelector("#save-button").addEventListener("click", async () => {
  try {
    render(await window.jdApp.saveConfig(formConfig()));
    show("Settings saved.");
  } catch (error) {
    show(error.message);
  }
});

document.querySelector("#start-button").addEventListener("click", async () => {
  try {
    render(await window.jdApp.startRuntime(formConfig()));
    show("Bot is running. Copy the OBS URL below and add it as a Browser Source in OBS or Streamlabs.");
  } catch (error) {
    show(error.message);
  }
});

document.querySelector("#next-button").addEventListener("click", async () => {
  try {
    const data = await window.jdApp.nextSong();
    const song = data.entry?.song;
    show(song
      ? `Marked as played: ${song.title} — ${song.artist}`
      : data.message || "Moved to next song.");
  } catch (error) {
    show(error.message);
  }
});

document.querySelector("#stop-button").addEventListener("click", async () => {
  render(await window.jdApp.stopRuntime());
  show("Bot stopped.");
});

document.querySelector("#overlay-link").addEventListener("click", () => {
  window.jdApp.openUrl(currentConfig.overlayUrl);
});

document.querySelector("#dashboard-link").addEventListener("click", () => {
  window.jdApp.openUrl(currentConfig.dashboardUrl);
});

document.querySelector("#copy-overlay").addEventListener("click", async () => {
  const ok = await copyText(currentConfig.overlayUrl);
  show(ok ? "OBS overlay URL copied to clipboard." : "Could not copy — select the URL below manually.");
});

document.querySelector("#copy-dashboard").addEventListener("click", async () => {
  const ok = await copyText(currentConfig.dashboardUrl);
  show(ok ? "Dashboard URL copied to clipboard." : "Could not copy — select the URL below manually.");
});

window.jdApp.onAuthComplete((config) => {
  authCode.hidden = true;
  render(config);
  show(`Logged in as ${config.username}. Set your channel below if needed, then click Start Bot.`);
});

window.jdApp.onAuthError((error) => {
  show(error);
});

window.jdApp.getConfig().then(render).catch((error) => show(error.message));
