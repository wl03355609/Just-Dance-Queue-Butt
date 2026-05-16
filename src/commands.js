const { gameKey, stripSearch } = require("./util");

function createCommands(runtime) {
  function handleCommand(message) {
    const [command, ...parts] = message.text.split(" ");
    const arg = parts.join(" ").trim();
    const lower = command.toLowerCase();

    if (lower === "!sr" || lower === "!songrequest") return requestSong(message, arg);
    if (lower === "!random") return randomSong(message, arg);
    if (lower === "!queue") return runtime.twitch.say(runtime.queue.queueSummary());
    if (lower === "!leave") return runtime.queue.leaveQueue(message.user);
    if (lower === "!pick" && arg.toLowerCase() === "random") {
      if (isStreamer(message)) return runtime.queue.pickRandomSong({ announce: true });
      return;
    }
    if (!isMod(message)) return;

    if (lower === "!skip" || lower === "!next") return runtime.queue.skipSong();
    if (lower === "!remove") return runtime.queue.removeSong(arg);
    if (lower === "!clear") return runtime.queue.clearQueue();
    if (lower === "!song") return runtime.twitch.say(runtime.queue.currentSongSummary());
  }

  function requestSong(message, query) {
    runtime.queue.addRequest(message.user, query, { announce: true }).catch(console.error);
  }

  function randomSong(message, arg) {
    const requester = message.user;

    const gate = runtime.queue.checkCanRequest(requester);
    if (!gate.ok) {
      runtime.twitch.say(gate.message);
      return;
    }

    let pool = runtime.catalog;
    if (arg) {
      const filter = runtime.queue.parseRandomFilter(arg);
      if (!filter) {
        runtime.twitch.say(`@${requester} unrecognized filter. Try !random, !random 2021, !random JD+, or !random JD+ 2023.`);
        return;
      }
      pool = runtime.catalog.filter((song) => {
        if (gameKey(song.game) !== filter.gameFilter) return false;
        if (!filter.yearFilter) return true;
        return song.originalGame && song.originalGame.includes(filter.yearFilter);
      });
    }

    const queuedIds = new Set(runtime.state.queue.map((entry) => entry.song.id));
    pool = pool.filter((song) => !queuedIds.has(song.id));

    if (!pool.length) {
      runtime.twitch.say(`@${requester} no songs available for that filter — all matching songs are already in the queue.`);
      return;
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];
    runtime.queue.addQueueEntry(requester, stripSearch(pick), true);
  }

  function isMod(message) {
    const user = message.user.toLowerCase();
    const badges = message.tags.badges || "";

    return (
      user === runtime.config.channel.toLowerCase() ||
      runtime.config.modUsers.map((mod) => mod.toLowerCase()).includes(user) ||
      badges.includes("broadcaster/") ||
      badges.includes("moderator/")
    );
  }

  function isStreamer(message) {
    const user = message.user.toLowerCase();
    const badges = message.tags.badges || "";
    return user === runtime.config.channel.toLowerCase() || badges.includes("broadcaster/");
  }

  return {
    handleCommand,
    isMod,
    isStreamer
  };
}

module.exports = { createCommands };
