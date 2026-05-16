# Just Dance Requests for Twitch

A local Twitch chat plugin for Just Dance streamers. Viewers request songs with `!sr song name`, the bot matches the request against the included Just Dance catalogs, and the queue appears live in a browser/OBS overlay.

This is inspired by Tandashi's archived JDR-Twitch extension, but built as a simpler self-hosted bot so you do not need Twitch Extension review just to run requests on stream.

Current release: **0.8.3 "David Ultra Stinky Butt"**.

## Setup

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Fill in:
   - `TWITCH_USERNAME`: the bot account username, or your channel username.
   - `TWITCH_OAUTH`: a token from <https://twitchtokengenerator.com/> with `chat:read` and `chat:edit`.
   - `TWITCH_CHANNEL`: your channel name.
   - `MOD_USERS`: your channel and trusted mods.
4. Start it:

```bash
npm start
```

Open `http://localhost:3000` as a browser source in OBS.

Open the dashboard URL printed in the terminal for local streamer controls. It includes a local admin token.

## Desktop App

The project can also run as a desktop app. The desktop app starts the local bot/server for you and shows the OBS and dashboard links.

```bash
npm install
npm run desktop
```

In the app:

1. Enter your Twitch app Client ID.
2. Click **Log in with Twitch**.
3. Authorize the app on Twitch using the code shown in the desktop window.
4. Set the channel name.
5. Leave **Phone companion access** on if you want the Android app to connect from the same Wi-Fi network.
6. Click **Start Bot**.
7. Add the overlay URL as a Browser Source in OBS or Streamlabs.

The desktop app stores its login/config locally in your user app data folder. The `.exe` must stay open while you stream.

### Twitch App Client ID

For a distributable app, create a Twitch Developer application and use its Client ID:

- Twitch developer console: <https://dev.twitch.tv/console/apps>
- OAuth flow used by the desktop app: Twitch Device Code Grant
- Scopes requested: `chat:read chat:edit`

## Build Windows Installer

After installing dependencies, build the Windows installer with:

```bash
npm run build:win
```

The installer output goes into `dist/` as `JustDanceRequests-Setup-<version>-ia32.exe`, alongside `latest.yml` and a `.blockmap` file for automatic updates. Upload all three files to the matching GitHub Release. The NSIS installer creates a normal Windows uninstall entry; app data is preserved on uninstall so queues and imported credentials are not erased accidentally. The build also refreshes `dist/songlist.xlsx`.

Users installed through the NSIS installer receive program updates through the in-app updater. Older portable `.exe` builds still need to be replaced manually once.

Do not keep real bot tokens inside `desktop/` for release builds. Put shareable bot credential files in an ignored private folder such as `.private/qutebutt-secrets.js`, then send that file privately to trusted users so they can choose **Import bot credentials file...** in the app. Packaged builds explicitly exclude `desktop/secrets.js`.

## Automatic Updates

The desktop app checks GitHub Releases for a newer version on startup. The flow is intentionally ask-first so a slow network or a fresh launch isn't surprised by a 70+ MB download:

1. **Checking** — a brief "Checking for updates…" banner appears, then auto-hides after 4 seconds if the check is still in flight.
2. **Available** — when a newer release is found, the banner reads "Version X.Y.Z is available. Download in the background?" with a **Download** button. Nothing transfers until you click.
3. **Downloading** — clicking Download starts a silent background fetch. The banner reflects the percentage; the action button is hidden so a stray click can't cancel.
4. **Downloaded** — the banner becomes "Update X.Y.Z is ready. It will install automatically when you close the app, or click Restart now." Closing the app applies the installer; clicking **Restart now** restarts immediately.

You can also trigger a check manually from **Help → Check for Updates…**, jump to the release notes via **Help → View Releases on GitHub**, or open the **Help → About** dialog to confirm which version is running. The current version is also shown at the bottom of the main window.

Update checks are best-effort: any failure (offline, rate-limited, GitHub down) silently leaves the banner hidden so the app keeps working as a normal local bot.

## Chat Commands

- `!sr <song name>`: add a song request. Requires at least 3 characters. Rejected if the same song is already in the queue.
- `!random`: add a random song from the enabled catalog.
- `!random <game>`: add a random song from a specific game — e.g. `!random 2021`, `!random JD+`, `!random JDU`.
- `!random <game> <year>`: add a random song from a year section within JD+ or JDU — e.g. `!random JD+ 2023`, `!random JDU 2021`.
- `!queue`: show the first songs in chat.
- `!leave`: remove your own request.
- `!skip` or `!next`: mark the first request as played. Broadcaster/mod only.
- `!pick random`: randomly mark one queued request as played. Broadcaster only.
- `!remove <number>`: remove a queue item. Broadcaster/mod only.
- `!clear`: clear the full queue. Broadcaster/mod only.
- `!song`: show the last played song. Broadcaster/mod only.

## Local Dashboard

The dashboard gives you buttons for:

- adding a test request without typing in Twitch chat
- **Pick**: mark that queue entry as playing now and move it to history
- **Next**: mark the first request as playing now and move it to history
- removing a specific queue item
- clearing the queue
- switching the OBS overlay between dark and light mode
- filtering requestable games between the included Just Dance game catalogs, Just Dance Unlimited, Just Dance+, and optional YouTube/freeform requests
- checking whether the bot is connected

Queue entries that have already been played in the current session show a **Done before** badge so you can spot repeats at a glance.

Use these URLs while the app is running:

- OBS/browser overlay: `http://localhost:3000`
- Streamer dashboard: use the tokenized URL printed when the bot starts
- Song catalog API: `http://localhost:3000/api/songs`
- Android companion: use the phone companion URL shown in the desktop app, or type the computer's LAN IP into the Android app

The dashboard token protects local queue controls like skip, clear, remove, and game filters. It is generated each time by default; set `ADMIN_TOKEN` in `.env` if you want a stable dashboard URL.

## Android Companion

The Android companion app can control the queue from a phone on the same Wi-Fi
network. The bot exposes companion access by default, so the old separate bridge
is no longer required for normal use.

Desktop app:

1. Keep **Phone companion access** enabled in **Bot Settings**. It is on by default.
2. Start the bot.
3. In the Android app, tap **Scan**, or manually enter the **Phone companion** URL/IP shown in the desktop app.
4. Paste the dashboard token into the Android app if you want controls such as next, clear, pick, remove, filters, or theme switching.

CLI:

```env
PHONE_COMPANION_ACCESS=true
```

When enabled, the bot listens on the computer's Wi-Fi/LAN address as well as
`localhost`. Set `PHONE_COMPANION_ACCESS=false` to keep the server local-only.
If a firewall prompt appears, allow Node.js on private networks. The phone and
computer must be on the same Wi-Fi network.

When the YouTube filter is enabled, requests that do not match the local catalog are added as freeform YouTube requests. When YouTube is disabled, unmatched or filtered-out requests are rejected.

## Song Data

The bundled catalog lives in `data/songs.json`, so you can add alternates, regional songs, fan nicknames, or newer Just Dance+ tracks whenever you want.

The desktop app also updates the songlist independently from the program. On startup and before starting the bot, it checks GitHub for the latest `data/songs.json`, downloads only that JSON file into the user's app data folder, and falls back to the bundled catalog when offline. Users can also click **Update songlist** in the desktop app.

Current included catalogs:

- Just Dance
- Just Dance 2
- Just Dance 3
- Just Dance 4
- Just Dance 2014
- Just Dance 2015
- Just Dance 2016
- Just Dance 2017
- Just Dance 2018
- Just Dance 2019
- Just Dance 2020
- Just Dance 2021
- Just Dance 2022
- Just Dance 2023 Edition
- Just Dance 2024 Edition
- Just Dance 2025 Edition
- Just Dance 2026 Edition
- Just Dance Unlimited classic routines
- Just Dance+ classic routines

The local catalog currently has 1,911 requestable entries.

I refreshed the yearly tracklists from Wikipedia and imported the Just Dance Wiki/Fandom tables for the included game catalogs, Just Dance Unlimited, and Just Dance+ on May 10-11, 2026. The catalog also includes the Wonder Tales seasonal update from May 12, 2026, plus available main-series alternate routines, Kids Mode routines, and VIP routines.

- <https://justdance.fandom.com/wiki/Just_Dance_(video_game)>
- <https://justdance.fandom.com/wiki/Just_Dance_2>
- <https://justdance.fandom.com/wiki/Just_Dance_3>
- <https://justdance.fandom.com/wiki/Just_Dance_4>
- <https://justdance.fandom.com/wiki/Just_Dance_2014>
- <https://justdance.fandom.com/wiki/Just_Dance_2015>
- <https://en.wikipedia.org/wiki/Just_Dance_2016>
- <https://justdance.fandom.com/wiki/Just_Dance_2017>
- <https://justdance.fandom.com/wiki/Just_Dance_2018>
- <https://justdance.fandom.com/wiki/Just_Dance_2019>
- <https://justdance.fandom.com/wiki/Just_Dance_2020>
- <https://justdance.fandom.com/wiki/Just_Dance_2021>
- <https://justdance.fandom.com/wiki/Just_Dance_2022>
- <https://en.wikipedia.org/wiki/Just_Dance_2023_Edition>
- <https://en.wikipedia.org/wiki/Just_Dance_2024_Edition>
- <https://en.wikipedia.org/wiki/Just_Dance_2025_Edition>
- <https://en.wikipedia.org/wiki/Just_Dance_2026_Edition>
- <https://justdance.fandom.com/wiki/Just_Dance_Unlimited>
- <https://justdance.fandom.com/wiki/Just_Dance%2B>

## Filtering Games

Use the **Filtering Games** panel on the dashboard to change what viewers can request while the bot is running.

You can also set the startup default with `ENABLED_GAMES` in `.env`:

```env
ENABLED_GAMES=2018,2022,jdu,plus
```

Supported filter keys include `jd1`, `jd2`, `jd3`, `jd4`, `2014` through `2026`, `jdu`, `plus`, and optional `youtube`.

## Notes

- CLI queue state is saved to `data/queue.json`; desktop app queues are saved per channel in app data.
- When quitting the desktop app with a non-empty queue or history, choose whether to keep it for next time or clear it on exit.
- Runtime is self-contained; npm is only needed for local development and building.
- Twitch chat requires the bot account to be able to join/send messages in your channel.
