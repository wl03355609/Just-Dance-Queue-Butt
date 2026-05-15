const tls = require("node:tls");
const crypto = require("node:crypto");

const {
  cleanChatText,
  cleanIrcLine
} = require("./util");

function createTwitch(runtime) {
  function connectTwitch() {
    clearTimeout(runtime.bot.reconnectTimer);
    runtime.bot.buffer = Buffer.alloc(0);
    runtime.bot.ready = false;

    if (runtime.bot.socket) {
      runtime.bot.socket.removeAllListeners();
      runtime.bot.socket.destroy();
      runtime.bot.socket = null;
    }

    runtime.bot.socket = tls.connect({
      host: "irc-ws.chat.twitch.tv",
      port: 443,
      servername: "irc-ws.chat.twitch.tv"
    }, () => {
      const key = crypto.randomBytes(16).toString("base64");
      runtime.bot.socket.write([
        "GET / HTTP/1.1",
        "Host: irc-ws.chat.twitch.tv",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        ""
      ].join("\r\n"));
    });

    runtime.bot.socket.on("data", onTwitchWebSocketData);
    runtime.bot.socket.on("error", (error) => console.error("Twitch connection error:", error.message));
    runtime.bot.socket.on("close", scheduleReconnect);
  }

  function stopTwitch() {
    clearTimeout(runtime.bot.reconnectTimer);
    runtime.bot.reconnectTimer = null;
    runtime.bot.ready = false;

    if (runtime.bot.socket) {
      runtime.bot.socket.removeAllListeners();
      runtime.bot.socket.end();
      runtime.bot.socket.destroy();
      runtime.bot.socket = null;
    }
  }

  function onTwitchWebSocketData(chunk) {
    runtime.bot.buffer = Buffer.concat([runtime.bot.buffer, chunk]);

    if (!runtime.bot.ready) {
      const headerEnd = runtime.bot.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = runtime.bot.buffer.slice(0, headerEnd).toString("utf8");
      runtime.bot.buffer = runtime.bot.buffer.slice(headerEnd + 4);

      if (!header.startsWith("HTTP/1.1 101")) {
        console.error("Twitch WebSocket upgrade failed.");
        runtime.bot.socket.end();
        return;
      }

      runtime.bot.ready = true;
      console.log(`Connected to Twitch chat as ${runtime.config.username}.`);
      writeIrc(`PASS ${runtime.config.oauth}`);
      writeIrc(`NICK ${runtime.config.username}`);
      writeIrc("CAP REQ :twitch.tv/tags twitch.tv/commands");
      writeIrc(`JOIN #${runtime.config.channel.toLowerCase()}`);
    }

    let frame;
    while ((frame = readWebSocketFrame()) !== null) {
      if (frame.opcode === 0x1) onTwitchData(frame.payload.toString("utf8"));
      if (frame.opcode === 0x8) runtime.bot.socket.end();
      if (frame.opcode === 0x9) runtime.bot.socket.write(createWebSocketFrame(frame.payload, 0xA));
    }
  }

  function readWebSocketFrame() {
    const buf = runtime.bot.buffer;
    if (buf.length < 2) return null;

    const first = buf[0];
    const second = buf[1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      length = Number(buf.readBigUInt64BE(offset));
      offset += 8;
    }

    let mask;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.slice(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.slice(offset, offset + length));
    runtime.bot.buffer = buf.slice(offset + length);

    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    return { opcode, payload };
  }

  function createWebSocketFrame(data, opcode = 0x1) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    const mask = crypto.randomBytes(4);
    let header;

    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    const maskedPayload = Buffer.from(payload);
    for (let index = 0; index < maskedPayload.length; index += 1) {
      maskedPayload[index] ^= mask[index % 4];
    }

    return Buffer.concat([header, mask, maskedPayload]);
  }

  function scheduleReconnect() {
    if (!runtime.config.username || !runtime.config.oauth || !runtime.config.channel) return;
    runtime.bot.reconnectTimer = setTimeout(connectTwitch, 5000);
  }

  function onTwitchData(chunk) {
    for (const line of chunk.split("\r\n").filter(Boolean)) {
      if (line.startsWith("PING")) {
        writeIrc("PONG :tmi.twitch.tv");
        continue;
      }

      const message = parsePrivmsg(line);
      if (message) runtime.commands.handleCommand(message);
    }
  }

  function parsePrivmsg(line) {
    const match = line.match(/^(?:@([^ ]+) )?:(\w+)!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #\w+ :(.+)$/);
    if (!match) return null;

    const tags = Object.fromEntries(
      (match[1] || "").split(";").filter(Boolean).map((tag) => {
        const [key, value = ""] = tag.split("=");
        return [key, value];
      })
    );

    return {
      user: match[2],
      text: match[3].trim(),
      tags
    };
  }

  function writeIrc(line) {
    if (runtime.bot.socket && runtime.bot.socket.writable && runtime.bot.ready) {
      const safeLine = cleanIrcLine(line);
      if (!safeLine) return;
      runtime.bot.socket.write(createWebSocketFrame(`${safeLine}\r\n`));
    }
  }

  function say(text) {
    const safeText = cleanChatText(text).slice(0, 480);
    if (!safeText) return;
    console.log(`[chat] ${safeText}`);
    if (!runtime.bot.socket || !runtime.bot.socket.writable || !runtime.config.channel) return;
    writeIrc(`PRIVMSG #${runtime.config.channel.toLowerCase()} :${safeText}`);
  }

  function isConnected() {
    return Boolean(runtime.bot.ready);
  }

  return {
    connectTwitch,
    stopTwitch,
    writeIrc,
    say,
    isConnected
  };
}

module.exports = { createTwitch };
