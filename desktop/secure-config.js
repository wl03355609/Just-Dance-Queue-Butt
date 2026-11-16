// Encrypts the Twitch tokens in the desktop app's config.json with Electron's
// safeStorage (Windows DPAPI / macOS Keychain), so the file no longer holds
// them in plain text. Kept free of Electron imports so it can be tested in Node.

const SECRET_FIELDS = ["accessToken", "refreshToken", "importedBundledOauth"];
const PREFIX = "safeStorage:v1:";

function createSecretStore(safeStorage, { log = console.warn } = {}) {
  let warnedUnavailable = false;
  let warnedDecrypt = false;

  function canEncrypt() {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function isPlainSecret(value) {
    return typeof value === "string" && value !== "" && !value.startsWith(PREFIX);
  }

  // Before writing: replace plain-text secrets with encrypted ones.
  function seal(config) {
    const out = { ...config };
    const available = canEncrypt();
    for (const field of SECRET_FIELDS) {
      if (!isPlainSecret(out[field])) continue;
      if (!available) {
        if (!warnedUnavailable) {
          warnedUnavailable = true;
          log("safeStorage is not available; Twitch tokens are saved without encryption.");
        }
        continue;
      }
      out[field] = PREFIX + safeStorage.encryptString(out[field]).toString("base64");
    }
    return out;
  }

  // After reading: decrypt secrets. Plain-text values from older versions pass
  // through unchanged. A value that can't be decrypted (config copied from
  // another computer or Windows user) becomes "", so the app asks to log in again.
  function open(config) {
    const out = { ...config };
    for (const field of SECRET_FIELDS) {
      const value = out[field];
      if (typeof value !== "string" || !value.startsWith(PREFIX)) continue;
      try {
        out[field] = safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), "base64"));
      } catch (error) {
        if (!warnedDecrypt) {
          warnedDecrypt = true;
          log(`Could not decrypt saved Twitch tokens (${error.message}); log in again.`);
        }
        out[field] = "";
      }
    }
    return out;
  }

  // True when the raw file still has plain-text secrets that could be encrypted now.
  function needsMigration(rawConfig) {
    if (!rawConfig || !canEncrypt()) return false;
    return SECRET_FIELDS.some((field) => isPlainSecret(rawConfig[field]));
  }

  return { seal, open, needsMigration, canEncrypt };
}

module.exports = { createSecretStore, SECRET_FIELDS, PREFIX };
