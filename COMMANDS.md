# Command Permissions

This file lists chat commands and local dashboard actions for permission review.

## Chat Commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `!sr <song name>` | Any viewer | Adds one catalog request for the viewer. If YouTube is enabled, unmatched freeform text is added as a YouTube request. |
| `!songrequest <song name>` | Any viewer | Same as `!sr`. |
| `!random` | Any viewer | Adds one random catalog song for the viewer from the enabled filters. |
| `!random <game>` | Any viewer | Adds one random catalog song from a game filter, such as `!random 2021`, `!random JD+`, or `!random JDU`. |
| `!random <game> <year>` | Any viewer | Adds one random song from a JD+ or JDU year section, such as `!random JD+ 2023`. |
| `!queue` | Any viewer | Shows the first queued songs in chat. |
| `!leave` | Any viewer | Removes that viewer's own queued request. |
| `!skip` | Broadcaster or mod | Marks the first queued request as playing now and moves it to history. |
| `!next` | Broadcaster or mod | Same as `!skip`. |
| `!pick random` | Broadcaster only | Randomly chooses one queued request, marks it as playing now, and moves it to history. |
| `!remove <number>` | Broadcaster or mod | Removes a queued request by queue position without adding it to history. |
| `!clear` | Broadcaster or mod | Clears the current queue without clearing history. |
| `!song` | Broadcaster or mod | Shows the most recently played song from history. |
| `!open` | Broadcaster or mod | Opens the queue so anyone can use `!sr` / `!random` again. |
| `!close` | Broadcaster or mod | Closes the queue. Viewer chat requests are rejected with "Queue is currently closed". Only the broadcaster can still add via chat; dashboard and paired-phone admin adds still work. |

## Permission Notes

- `Broadcaster only` means the channel owner or a Twitch `broadcaster` badge.
- `Broadcaster or mod` means the channel owner, configured `MOD_USERS`, or a Twitch `broadcaster`/`moderator` badge.
- Unauthorized mod-only commands are ignored by the bot.
- A picked or skipped request is added to history automatically.
- A removed or cleared request is not added to history.

## Dashboard Actions

Dashboard actions require the local dashboard admin token.

| Action | What it does |
| --- | --- |
| Add | Adds a request from the dashboard form. |
| Pick | Marks that selected queue entry as playing now and moves it to history. |
| Next | Marks the first queue entry as playing now and moves it to history. |
| Remove | Removes a queue entry without adding it to history. |
| Clear Queue | Clears the queue without clearing history. |
| Overlay Appearance | Switches the OBS overlay between dark and light mode. |
| Filtering Games | Changes which catalog filters are requestable. |
