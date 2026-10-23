## 0.13.0 — New look, six themes

The overlay and dashboard have been redesigned, and you can pick the look you like.

- **Six themes** — Dance Floor Poster (the new default), Arcade Neon, Clean Studio, Sticker Pop, Broadcast Console, and Classic, which is the old look. Pick one from the dropdown in the dashboard header; the overlay follows.
- **Light and dark mode** for every theme, with the sun/moon button next to the theme picker. The `!theme` command still works for mods.
- **Dashboard refresh** — a status strip with the queue count, open/closed state and song and game counts, Skip / Open / Close / Clear buttons right under "Now playing", and a collapsible filter panel.
- **Reconnect button** — restarts the bot's chat connection from the dashboard without restarting the app.
- **Default game list** — Decades of Hits is now on and Unlimited is off for new installs. Existing setups keep their own `ENABLED_GAMES`.
- **No stale pages after an update** — the dashboard and overlay now tell browsers and OBS to re-check their files, so an update can't pair the new page with an old script.

The auto-updater will install this on launch as usual. If a browser tab or OBS source still shows the old dashboard once, reload it.
