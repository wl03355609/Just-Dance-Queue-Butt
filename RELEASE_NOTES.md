## 0.11.0 — Spin Cycle

A new chat command for streamers who use the in-game wheel. Builds on [v0.10.0](https://github.com/wl03355609/Just-Dance-Queue-Butt/releases/tag/v0.10.0).

- **New `!wheel` command** — viewers can type `!wheel` to add a "spin the wheel" request to the queue, signalling that they'd like the streamer to spin the in-game wheel.
- **Optional target note** — `!wheel <note>` (e.g. `!wheel Katy`) records a free-text hint asking the streamer to keep spinning until they land on a matching song. The note is the human's call — it is **not** matched against the song catalog, so anything works.
- **Same fairness rules as `!sr`** — respects the open/closed queue, one entry per viewer, and the max queue size. The streamer can still add wheel spins while the queue is closed.

Wheel entries appear in the queue, dashboard, and overlay tagged as **Wheel**, so they're easy to tell apart from normal song requests.

The auto-updater will install this on launch as usual.
