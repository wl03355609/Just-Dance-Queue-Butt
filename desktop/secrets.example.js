// Copy this file to a private location (for example .private/qutebutt-secrets.js)
// and fill in your values. Private credential files are gitignored — NEVER
// commit them to a public repository.
//
// Get the OAuth token at https://twitchtokengenerator.com/
// Select: Custom Scope Token → check chat:read and chat:edit → Generate
// Copy the "ACCESS TOKEN" value (the long string starting with the letters).
//
// BUNDLED_BOT_USERNAME must exactly match the Twitch account that owns the token.
//
// Use this file by sharing it privately with a trusted friend; they import it
// in the desktop app via "Import bot credentials file..." — no rebuild needed.
//
// Do not put a real token in desktop/secrets.js for release builds. Packaged
// builds explicitly exclude that file so bot tokens are not bundled accidentally.

module.exports = {
  BUNDLED_OAUTH_TOKEN: "",
  BUNDLED_BOT_USERNAME: "qutebutt"
};
