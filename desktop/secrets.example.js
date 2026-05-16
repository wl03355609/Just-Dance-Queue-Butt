// Copy this file to secrets.js and fill in your values.
// secrets.js is gitignored — NEVER commit it to a public repository.
//
// Get the OAuth token at https://twitchtokengenerator.com/
// Select: Custom Scope Token → check chat:read and chat:edit → Generate
// Copy the "ACCESS TOKEN" value (the long string starting with the letters).
//
// BUNDLED_BOT_USERNAME must exactly match the Twitch account that owns the token.
//
// Two ways to use this file:
// 1. Save it as desktop/secrets.js before running `npm run build:win` to bundle
//    the credentials into the .exe (built-in bot mode for everyone using that build).
// 2. Share the filled-in file privately with a trusted friend; they import it in
//    the desktop app via "Import bot credentials file…" — no rebuild needed.

module.exports = {
  BUNDLED_OAUTH_TOKEN: "",
  BUNDLED_BOT_USERNAME: "qutebutt"
};
