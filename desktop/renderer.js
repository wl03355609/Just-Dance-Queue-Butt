const botModeRow = document.querySelector("#bot-mode-row");
const botModeSelect = document.querySelector("#bot-mode");
const ownAccountSection = document.querySelector("#own-account-section");
const clientIdSection = document.querySelector("#client-id-section");
const clientIdInput = document.querySelector("#client-id");
const loggedInBadge = document.querySelector("#logged-in-badge");
const loggedInUser = document.querySelector("#logged-in-user");
const usernameInput = document.querySelector("#username");
const channelInput = document.querySelector("#channel");
const importButton = document.querySelector("#import-credentials");
const clearImportButton = document.querySelector("#clear-imported-credentials");
const importedHint = document.querySelector("#imported-credentials-hint");
const updateBanner = document.querySelector("#update-banner");
const updateBannerText = document.querySelector("#update-banner-text");
const updateBannerAction = document.querySelector("#update-banner-action");
const updateBannerDismiss = document.querySelector("#update-banner-dismiss");
const checkSonglistButton = document.querySelector("#check-songlist");
const songlistStatus = document.querySelector("#songlist-status");
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
  return channelInput.value.trim().replace(/^#/, "").toLowerCase();
}

function applyBotMode(mode) {
  ownAccountSection.hidden = mode !== "own";
  if (!currentConfig) return;
  if (mode === "bundled" && currentConfig.hasBundledBot) {
    usernameInput.value = currentConfig.bundledBotUsername;
  } else {
    usernameInput.value = currentConfig.username || "";
  }
}

function render(config) {
  currentConfig = config;
  clientIdInput.value = config.clientId || "";
  channelInput.value = config.channel || "";
  portInput.value = config.port || 3000;
  maxQueueInput.value = config.maxQueueSize || 50;
  overlayUrlCode.textContent = config.overlayUrl;
  dashboardUrlCode.textContent = config.dashboardUrl;
  runStatus.textContent = config.running ? "Running" : "Stopped";
  runStatus.className = config.running ? "status running" : "status";
  // Bot mode dropdown
  if (config.hasBundledBot) {
    botModeRow.hidden = false;
    const bundledOpt = botModeSelect.querySelector('option[value="bundled"]');
    if (bundledOpt) bundledOpt.textContent = `${config.bundledBotUsername} (built-in bot)`;
    botModeSelect.value = config.botMode || "bundled";
  } else {
    botModeRow.hidden = true;
    botModeSelect.value = "own";
  }
  applyBotMode(botModeSelect.value);

  // Imported-credentials clear button: only show when the bundled bot came from an import
  clearImportButton.hidden = !config.bundledFromImport;
  if (config.bundledFromImport) {
    importedHint.textContent = `Imported credentials for @${config.bundledBotUsername}. They live in this app's config on this machine.`;
  } else {
    importedHint.innerHTML = "Accepts <code>secrets.js</code>, <code>.json</code>, or <code>.env</code>. The file stays on this machine.";
  }
  renderSonglistState(config.songlist);

  // Client ID field
  if (config.hasBundledClientId) clientIdSection.hidden = true;

  // Logged-in badge (only relevant in "own" mode)
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
    botMode: botModeSelect.value,
    channel: getChannel(),
    port: Number.parseInt(portInput.value, 10) || 3000,
    maxQueueSize: Number.parseInt(maxQueueInput.value, 10) || 50,
    enabledGames: ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "jdu", "plus"]
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

botModeSelect.addEventListener("change", () => {
  applyBotMode(botModeSelect.value);
});

importButton.addEventListener("click", async () => {
  try {
    const result = await window.jdApp.importCredentials();
    if (!result) return; // user canceled the file picker
    render(result);
    show(`Bot credentials imported for @${result.bundledBotUsername}.`);
  } catch (error) {
    show(error.message);
  }
});

clearImportButton.addEventListener("click", async () => {
  try {
    render(await window.jdApp.clearImportedCredentials());
    show("Imported bot credentials cleared.");
  } catch (error) {
    show(error.message);
  }
});

checkSonglistButton.addEventListener("click", async () => {
  try {
    checkSonglistButton.disabled = true;
    const state = await window.jdApp.checkSonglist();
    renderSonglistState(state);
    if (state?.message) show(state.message);
  } catch (error) {
    show(error.message);
  } finally {
    checkSonglistButton.disabled = false;
  }
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
    window.jdApp.openUrl(currentConfig.dashboardUrl);
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

let pendingUpdate = null;

updateBannerAction.addEventListener("click", () => {
  if (pendingUpdate?.canInstall) {
    window.jdApp.installUpdate();
  } else if (pendingUpdate?.releaseUrl) {
    window.jdApp.openReleasePage(pendingUpdate.releaseUrl);
  }
});

updateBannerDismiss.addEventListener("click", () => {
  updateBanner.hidden = true;
});

function renderUpdateState(info) {
  if (!info || info.status === "idle" || info.status === "error") {
    updateBanner.hidden = true;
    return;
  }

  pendingUpdate = info;
  updateBannerText.textContent = info.message || `A newer version is available: ${info.releaseName || `v${info.latestVersion}`} (you have v${info.currentVersion}).`;
  updateBannerAction.hidden = !info.canInstall;
  updateBannerAction.textContent = info.canInstall ? "Restart" : "Download";
  updateBanner.hidden = false;
}

function renderSonglistState(state) {
  if (!state) {
    songlistStatus.textContent = "";
    return;
  }

  const count = state.count ? `${state.count} songs` : "bundled songs";
  const source = state.source === "updated" ? "updated catalog" : "bundled catalog";
  songlistStatus.textContent = state.status === "checking"
    ? "Checking songlist updates..."
    : `${count} using ${source}`;
}

window.jdApp.onUpdateState(renderUpdateState);
window.jdApp.onSonglistState(renderSonglistState);

window.jdApp.checkForUpdate().then(renderUpdateState).catch(() => {
  // Update checks are best-effort; ignore failures (offline, rate-limited, repo private).
});

window.jdApp.checkSonglist().then(renderSonglistState).catch(() => {
  // Songlist updates fall back to the bundled catalog.
});
