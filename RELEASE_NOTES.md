## 0.11.1 — Spin Cycle (dashboard dedupe)

A small polish pass on the `!wheel` command shipped in [v0.11.0](https://github.com/wl03355609/Just-Dance-Queue-Butt/releases/tag/v0.11.0).

- **No more duplicated "Wheel" on the dashboard** — a `!wheel` entry already says "Wheel Spin" in its title, so the redundant **Wheel** game label is now hidden on the streamer dashboard.
- **No false "Done before" badge on wheel spins** — since every spin shares the "Wheel Spin" title, repeat spins were being flagged as already played. A wheel spin isn't a specific catalog song, so it's no longer matched against history.
- **Real songs are untouched** — the fix keys off the internal wheel flag, not the title, so an actual catalog song like "Wheels on The Bus" still shows its game and its "Done before" badge as normal.

The auto-updater will install this on launch as usual.
