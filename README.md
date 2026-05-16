# Just Dance Requests for Twitch

A local Twitch chat request bot for Just Dance streams. Viewers request songs with `!sr song name`, the bot matches requests against the included Just Dance catalogs, and the queue appears in an OBS/browser overlay.

## Links

- Desktop bot releases: <https://github.com/wl03355609/Just-Dance-Queue-Butt/releases/latest>
- Android companion project: <https://github.com/wl03355609/Just-Dance-Android-Companion>
- Android companion releases: <https://github.com/wl03355609/Just-Dance-Android-Companion/releases/latest>

## Android Companion

The Android companion controls the queue from a phone on the same Wi-Fi network as the bot. It can scan for the bot automatically, add requests, search songs, change filters, control next/pick/remove/clear, and switch the overlay theme.

To link it:

1. Start the desktop bot.
2. Leave **Phone companion access** enabled.
3. Open the Android companion and tap **Scan**, or enter the phone companion URL shown in the desktop app.
4. In the desktop bot app, click **Show Code** under **Phone companion**.
5. On Android, tap **Update Token** and enter the 6-digit pairing code.

The pairing code rotates every 5 minutes while it is shown in the desktop app. The browser dashboard does not show pairing codes.

## Desktop Bot

Download the installer from the latest desktop bot release. The desktop app starts the local bot/server, shows the OBS overlay URL, shows the streamer dashboard URL, and can display the phone pairing code.

In the app:

1. Choose the bot account mode.
2. Log in with Twitch if using your own account.
3. Set the channel name.
4. Keep **Phone companion access** on if you use the Android app.
5. Click **Start Bot**.
6. Add the overlay URL as a Browser Source in OBS or Streamlabs.

The desktop app stores login/config locally in your user app data folder. It must stay open while you stream.

## Chat Commands

- `!sr <song name>`: add a song request.
- `!random`: add a random song from the enabled catalog.
- `!random <game>`: add a random song from a specific game, such as `!random 2021`, `!random JD+`, or `!random JDU`.
- `!random <game> <year>`: add a random song from a year section within JD+ or JDU, such as `!random JD+ 2023`.
- `!queue`: show the first songs in chat.
- `!leave`: remove your own request.
- `!skip` or `!next`: mark the first request as played. Broadcaster/mod only.
- `!pick random`: randomly mark one queued request as played. Broadcaster only.
- `!remove <number>`: remove a queue item. Broadcaster/mod only.
- `!clear`: clear the queue. Broadcaster/mod only.
- `!song`: show the last played song. Broadcaster/mod only.
- `!open`: open the queue so viewers can request again. Broadcaster/mod only.
- `!close`: close the queue. Only the broadcaster can keep adding via chat; everyone else sees "Queue is currently closed". Broadcaster/mod only.

## Dashboard

The dashboard is for streamer controls in a browser. Use the tokenized dashboard URL shown by the desktop app or terminal.

Dashboard and phone actions that change the queue announce in Twitch chat, including add, remove, next, pick, and clear. Theme and filter changes stay local.

The streamer/channel can add more than one request and can exceed the normal queue size limit. Viewer requests still respect the queue size and one-request-at-a-time limits.

## Game Filters

Use the dashboard **Filtering Games** panel to choose what viewers can request. Supported keys include main games from `jd1` through `jd4`, yearly games from `2014` through `2026`, `jdu`, `plus`, and optional `youtube`.

When the YouTube filter is enabled, unmatched requests can be added as freeform YouTube requests. When YouTube is disabled, unmatched or filtered-out requests are rejected.

## Song Data

The bundled catalog includes main-series Just Dance games, Just Dance Unlimited, Just Dance+, alternate routines, Kids Mode routines, VIP routines, and newer seasonal updates.

The desktop app can update the songlist independently from the program. On startup and before starting the bot, it checks for the latest `data/songs.json`, downloads it into app data, and falls back to the bundled catalog when offline. You can also click **Update songlist** in the desktop app.

## Notes

- OBS/browser overlay: `http://localhost:3000`
- Song catalog API: `http://localhost:3000/api/songs`
- Desktop app queues are saved per channel in app data.
- CLI queue state is saved to `data/queue.json`.
- Twitch chat requires the bot account to be able to join/send messages in your channel.
