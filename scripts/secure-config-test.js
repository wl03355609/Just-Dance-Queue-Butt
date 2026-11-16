const { createSecretStore, PREFIX } = require("../desktop/secure-config");

let failed = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// Stand-in for Electron's safeStorage: reversible, but not plain text.
function fakeSafeStorage({ available = true, key = 7 } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from([...Buffer.from(text, "utf8")].map((b) => b ^ key)),
    decryptString: (buffer) => {
      if (buffer[0] === undefined) throw new Error("empty");
      const text = Buffer.from([...buffer].map((b) => b ^ key)).toString("utf8");
      if (!/^[\x20-\x7e]*$/.test(text)) throw new Error("Error while decrypting the ciphertext");
      return text;
    }
  };
}

const quiet = () => {};
const plain = {
  channel: "qutebutt",
  accessToken: "abc123access",
  refreshToken: "def456refresh",
  importedBundledOauth: "oauth:ghi789",
  expiresAt: 123
};

{
  const store = createSecretStore(fakeSafeStorage(), { log: quiet });
  const sealed = store.seal(plain);
  const json = JSON.stringify(sealed);
  check("seal encrypts every token field", ["accessToken", "refreshToken", "importedBundledOauth"].every((f) => sealed[f].startsWith(PREFIX)));
  check("sealed file has no plain-text tokens", !json.includes("abc123access") && !json.includes("def456refresh") && !json.includes("ghi789"));
  check("seal keeps other fields", sealed.channel === "qutebutt" && sealed.expiresAt === 123);
  check("seal does not mutate its input", plain.accessToken === "abc123access");
  check("open round-trips", JSON.stringify(store.open(sealed)) === JSON.stringify(plain));
  check("seal is idempotent on sealed values", JSON.stringify(store.seal(sealed)) === json);
  check("empty tokens stay empty", store.seal({ accessToken: "" }).accessToken === "");
}

{
  const store = createSecretStore(fakeSafeStorage(), { log: quiet });
  check("plain-text config from older versions needs migration", store.needsMigration(plain));
  check("plain-text config still opens as-is", store.open(plain).accessToken === "abc123access");
  check("sealed config needs no migration", !store.needsMigration(store.seal(plain)));
  check("missing config needs no migration", !store.needsMigration(null));
}

{
  const logs = [];
  const store = createSecretStore(fakeSafeStorage({ available: false }), { log: (m) => logs.push(m) });
  const sealed = store.seal(plain);
  check("without safeStorage, tokens are kept (not lost)", sealed.accessToken === "abc123access");
  check("without safeStorage, a warning is logged once", logs.length === 1, logs.join(" | "));
  store.seal(plain);
  check("warning is not repeated", logs.length === 1);
  check("without safeStorage, no migration is attempted", !store.needsMigration(plain));
}

{
  const writer = createSecretStore(fakeSafeStorage({ key: 7 }), { log: quiet });
  const reader = createSecretStore(fakeSafeStorage({ key: 200 }), { log: quiet });
  const opened = reader.open(writer.seal(plain));
  check("tokens from another machine/user become empty (log in again)", opened.accessToken === "" && opened.refreshToken === "");
  check("other fields survive a failed decrypt", opened.channel === "qutebutt");
}

{
  const throwing = { isEncryptionAvailable: () => { throw new Error("not ready"); } };
  const store = createSecretStore(throwing, { log: quiet });
  check("isEncryptionAvailable throwing is treated as unavailable", store.seal(plain).accessToken === "abc123access");
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll secure-config checks passed.");
