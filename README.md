# Just Dance Requests for Twitch

A local Twitch chat plugin for Just Dance streamers. Viewers request songs with `!sr song name`, the bot matches the request against Just Dance 2023-2026 and Just Dance+ catalogs, and the queue appears live in a browser/OBS overlay.

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

Open `http://localhost:3000/dashboard` in your browser for local streamer controls.

## Chat Commands

- `!sr <song name>`: add a song request.
- `!queue`: show the first songs in chat.
- `!leave`: remove your own request.
- `!skip` or `!next`: mark the first request as played. Broadcaster/mod only.
- `!remove <number>`: remove a queue item. Broadcaster/mod only.
- `!clearqueue`: clear the full queue. Broadcaster/mod only.
- `!song`: show the last played song. Broadcaster/mod only.

## Local Dashboard

The dashboard gives you buttons for:

- adding a test request without typing in Twitch chat
- skipping to the next request
- removing a specific queue item
- clearing the queue
- checking whether the bot is connected

Use these URLs while the app is running:

- OBS/browser overlay: `http://localhost:3000`
- Streamer dashboard: `http://localhost:3000/dashboard`
- Song catalog API: `http://localhost:3000/api/songs`

## Song Data

The catalog lives in `data/songs.json`, so you can add alternates, regional songs, fan nicknames, or newer Just Dance+ tracks whenever you want.

Current included catalogs:

- Just Dance 2023 Edition
- Just Dance 2024 Edition
- Just Dance 2025 Edition
- Just Dance 2026 Edition
- Just Dance+ classic routines

The local catalog currently has 614 requestable entries: 163 yearly-edition songs and 451 Just Dance+ classic routines.

I refreshed the yearly tracklists from Wikipedia and imported the Just Dance+ classic-routines table from Just Dance Wiki/Fandom on May 10, 2026. The Just Dance+ page states the table is current as of April 28, 2026 and excludes removed songs.

- <https://en.wikipedia.org/wiki/Just_Dance_2023_Edition>
- <https://en.wikipedia.org/wiki/Just_Dance_2024_Edition>
- <https://en.wikipedia.org/wiki/Just_Dance_2025_Edition>
- <https://en.wikipedia.org/wiki/Just_Dance_2026_Edition>
- <https://justdance.fandom.com/wiki/Just_Dance%2B>

## Filtering Games

Use `ENABLED_GAMES` in `.env` to limit what viewers can request:

```env
ENABLED_GAMES=2025,2026,plus
```

## Notes

- Queue state is saved to `data/queue.json`.
- The app has no npm dependencies.
- Twitch chat requires the bot account to be able to join/send messages in your channel.
