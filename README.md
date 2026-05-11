# Just Dance Requests for Twitch

A local Twitch chat plugin for Just Dance streamers. Viewers request songs with `!sr song name`, the bot matches the request against Just Dance 2017-2026, Just Dance Unlimited, and Just Dance+ catalogs, and the queue appears live in a browser/OBS overlay.

This is inspired by Tandashi's archived JDR-Twitch extension, but built as a simpler self-hosted bot so you do not need Twitch Extension review just to run requests on stream.

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
5. Click **Start Bot**.
6. Add the overlay URL as a Browser Source in OBS or Streamlabs.

The desktop app stores its login/config locally in your user app data folder. The `.exe` must stay open while you stream.

### Twitch App Client ID

For a distributable app, create a Twitch Developer application and use its Client ID:

- Twitch developer console: <https://dev.twitch.tv/console/apps>
- OAuth flow used by the desktop app: Twitch Device Code Grant
- Scopes requested: `chat:read chat:edit`

## Build Windows EXE

After installing dependencies, build a Windows installer with:

```bash
npm run build:win
```

The installer output goes into `dist/`.

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
- filtering requestable games between Just Dance 2017-2026, Just Dance Unlimited, Just Dance+, and optional YouTube/freeform requests
- checking whether the bot is connected

Queue entries that have already been played in the current session show a **Done before** badge so you can spot repeats at a glance.

Use these URLs while the app is running:

- OBS/browser overlay: `http://localhost:3000`
- Streamer dashboard: use the tokenized URL printed when the bot starts
- Song catalog API: `http://localhost:3000/api/songs`

The dashboard token protects local queue controls like skip, clear, remove, and game filters. It is generated each time by default; set `ADMIN_TOKEN` in `.env` if you want a stable dashboard URL.

When the YouTube filter is enabled, requests that do not match the local catalog are added as freeform YouTube requests. When YouTube is disabled, unmatched or filtered-out requests are rejected.

## Song Data

The catalog lives in `data/songs.json`, so you can add alternates, regional songs, fan nicknames, or newer Just Dance+ tracks whenever you want.

Current included catalogs:

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

The local catalog currently has 1,372 requestable entries.

I refreshed the yearly tracklists from Wikipedia and imported the Just Dance Wiki/Fandom tables for Just Dance 2017-2022, Just Dance Unlimited, and Just Dance+ on May 10, 2026. The Just Dance+ page states the table is current as of April 28, 2026 and excludes removed songs.

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

## Notes

- CLI queue state is saved to `data/queue.json`; desktop app queues are saved per channel in app data.
- When quitting the desktop app with a non-empty queue or history, choose whether to keep it for next time or clear it on exit.
- The app has no npm dependencies.
- Twitch chat requires the bot account to be able to join/send messages in your channel.
