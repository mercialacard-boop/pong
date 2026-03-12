const { WebSocketServer } = require("ws");
const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Pong Server running");
});

const wss = new WebSocketServer({ server });

const rooms = {};

wss.on("connection", (ws) => {
  let roomId = null;
  let playerSlot = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      roomId = msg.room;
      if (!rooms[roomId]) rooms[roomId] = { players: [], state: { p1y: 145, p2y: 145, score: [0, 0] } };
      const room = rooms[roomId];

      if (room.players.length < 2) {
        playerSlot = room.players.length + 1;
        room.players.push(ws);
        ws.send(JSON.stringify({ type: "assigned", player: playerSlot, state: room.state }));
        broadcast(roomId, { type: "playerCount", count: room.players.length }, ws);
        if (room.players.length === 2) {
          broadcastAll(roomId, { type: "playerCount", count: 2 });
        }
      } else {
        playerSlot = 0;
        ws.send(JSON.stringify({ type: "assigned", player: 0, state: room.state }));
      }
      return;
    }

    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    if (msg.type === "move") {
      if (msg.player === 1) room.state.p1y = msg.y;
      if (msg.player === 2) room.state.p2y = msg.y;
      broadcast(roomId, msg, ws);
    }

    if (msg.type === "ball" && playerSlot === 1) {
      broadcast(roomId, msg, ws);
    }

    if (msg.type === "score" && playerSlot === 1) {
      room.state.score = msg.score;
      broadcastAll(roomId, msg);
    }

    if (msg.type === "start" && playerSlot === 1) {
      room.state.score = [0, 0];
      broadcastAll(roomId, { type: "start" });
    }
  });

  ws.on("close", () => {
    if (!roomId || !rooms[roomId]) return;
    rooms[roomId].players = rooms[roomId].players.filter(p => p !== ws);
    broadcastAll(roomId, { type: "playerCount", count: rooms[roomId].players.length });
    if (rooms[roomId].players.length === 0) delete rooms[roomId];
  });
});

function broadcast(roomId, msg, exclude) {
  if (!rooms[roomId]) return;
  rooms[roomId].players.forEach(p => {
    if (p !== exclude && p.readyState === 1) p.send(JSON.stringify(msg));
  });
}

function broadcastAll(roomId, msg) {
  if (!rooms[roomId]) return;
  rooms[roomId].players.forEach(p => {
    if (p.readyState === 1) p.send(JSON.stringify(msg));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pong server running on port ${PORT}`));
