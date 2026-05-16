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
const updatePill = document.querySelector("#update-pill");
const updatePillText = document.querySelector("#update-pill-text");
const updatePopover = document.querySelector("#update-popover");
const updatePopoverDetail = document.querySelector("#update-popover-detail");
const updatePopoverInstall = document.querySelector("#update-popover-install");
const updatePopoverLater = document.querySelector("#update-popover-later");
const appVersionEl = document.querySelector("#app-version");
const footerReleasesLink = document.querySelector("#footer-releases");
const checkSonglistButton = document.querySelector("#check-songlist");
const songlistStatus = document.querySelector("#songlist-status");
const portInput = document.querySelector("#port");
const companionAccessInput = document.querySelector("#companion-access");
const maxQueueInput = document.querySelector("#max-queue");
const overlayUrlCode = document.querySelector("#overlay-url");
const dashboardUrlCode = document.querySelector("#dashboard-url");
const companionUrlCode = document.querySelector("#companion-url");
const companionLinkRow = document.querySelector("#companion-link-row");
const pairCompanionButton = document.querySelector("#pair-companion");
const pairingCodePanel = document.querySelector("#pairing-code-panel");
const pairingCode = document.querySelector("#pairing-code");
const pairingCodeStatus = document.querySelector("#pairing-code-status");
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
  companionAccessInput.checked = config.companionAccess !== false;
  maxQueueInput.value = config.maxQueueSize || 50;
  overlayUrlCode.textContent = config.overlayUrl;
  dashboardUrlCode.textContent = config.dashboardUrl;
  companionUrlCode.textContent = config.companionUrl || "Not available until the Mac is on Wi-Fi";
  companionLinkRow.hidden = config.companionAccess === false;
  pairCompanionButton.disabled = !config.running || config.companionAccess === false;
  if (!config.running) pairingCodePanel.hidden = true;
  runStatus.textContent = config.running ? "Running" : "Stopped";
  runStatus.className = config.running ? "status running" : "status";
  if (config.appVersion) appVersionEl.textContent = `v${config.appVersion}`;
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
    companionAccess: companionAccessInput.checked,
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

document.querySelector("#copy-companion").addEventListener("click", async () => {
  if (!currentConfig.companionUrl) {
    show("No phone companion URL is available yet.");
    return;
  }
  const ok = await copyText(currentConfig.companionUrl);
  show(ok ? "Phone companion URL copied to clipboard." : "Could not copy — select the URL below manually.");
});

pairCompanionButton.addEventListener("click", async () => {
  try {
    const result = await window.jdApp.createCompanionPairingCode();
    pairingCode.textContent = result.code;
    pairingCodeStatus.textContent = "Enter this code in the Android app within 5 minutes.";
    pairingCodePanel.hidden = false;
    show("Phone pairing code created.");
  } catch (error) {
    pairingCodePanel.hidden = true;
    show(error.message);
  }
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

function hideUpdatePopover() {
  updatePopover.hidden = true;
}

updatePill.addEventListener("click", (event) => {
  event.stopPropagation();
  updatePopover.hidden = !updatePopover.hidden;
});

updatePopoverInstall.addEventListener("click", () => {
  if (pendingUpdate?.canInstall) window.jdApp.installUpdate();
});

updatePopoverLater.addEventListener("click", () => {
  hideUpdatePopover();
});

document.addEventListener("click", (event) => {
  if (!updatePopover.hidden && !updatePopover.contains(event.target) && event.target !== updatePill && !updatePill.contains(event.target)) {
    hideUpdatePopover();
  }
});

function renderUpdateState(info) {
  // The pill is the only update UI. It only appears once a new version is
  // fully downloaded AND that version differs from what's currently running.
  // Everything else (checking, downloading, errors) is silent.
  pendingUpdate = info || null;

  const hasActionableUpdate = info
    && info.status === "downloaded"
    && info.latestVersion
    && info.latestVersion !== info.currentVersion;

  if (!hasActionableUpdate) {
    updatePill.hidden = true;
    hideUpdatePopover();
    return;
  }

  const version = `v${info.latestVersion}`;
  updatePillText.textContent = `↻ ${version}`;
  updatePopoverDetail.textContent = `${info.releaseName || version} is downloaded.`;
  updatePill.hidden = false;
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

footerReleasesLink.addEventListener("click", (event) => {
  event.preventDefault();
  window.jdApp.openReleasePage("https://github.com/wl03355609/Just-Dance-Queue-Butt/releases/latest");
});

window.jdApp.checkSonglist().then(renderSonglistState).catch(() => {
  // Songlist updates fall back to the bundled catalog.
});
