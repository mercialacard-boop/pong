const { WebSocketServer } = require("ws");
const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Pong Server running");
});

const wss = new WebSocketServer({ server });
const rooms = {};
const W = 560, H = 360, PAD = 12, PW = 10, PH = 70, BALL = 9;

function createRoom() {
  return {
    players: [],
    state: { p1y: H/2-PH/2, p2y: H/2-PH/2, bx: W/2, by: H/2, vx: 4.5, vy: 3.2, score: [0,0], running: false },
    interval: null,
  };
}

function resetBall(state, dir) {
  state.bx = W/2; state.by = H/2;
  const angle = (Math.random()*40-20)*Math.PI/180;
  const spd = 4.5;
  state.vx = dir * spd * Math.cos(angle);
  state.vy = spd * Math.sin(angle);
  if (Math.random() > 0.5) state.vy *= -1;
}

function startLoop(roomId) {
  const room = rooms[roomId];
  if (!room || room.interval) return;
  room.interval = setInterval(() => {
    if (!rooms[roomId]) return clearInterval(room.interval);
    const s = room.state;
    if (!s.running) return;
    s.bx += s.vx; s.by += s.vy;
    if (s.by - BALL < 0) { s.by = BALL; s.vy = Math.abs(s.vy); }
    if (s.by + BALL > H) { s.by = H-BALL; s.vy = -Math.abs(s.vy); }
    if (s.bx-BALL < PAD+PW && s.bx > PAD && s.by > s.p1y && s.by < s.p1y+PH) {
      s.bx = PAD+PW+BALL;
      const rel = (s.by-(s.p1y+PH/2))/(PH/2);
      const spd = Math.min(Math.sqrt(s.vx*s.vx+s.vy*s.vy)+0.3, 11);
      s.vx = spd*Math.cos(rel*60*Math.PI/180);
      s.vy = spd*Math.sin(rel*60*Math.PI/180);
    }
    if (s.bx+BALL > W-PAD-PW && s.bx < W-PAD && s.by > s.p2y && s.by < s.p2y+PH) {
      s.bx = W-PAD-PW-BALL;
      const rel = (s.by-(s.p2y+PH/2))/(PH/2);
      const spd = Math.min(Math.sqrt(s.vx*s.vx+s.vy*s.vy)+0.3, 11);
      s.vx = -(spd*Math.cos(rel*60*Math.PI/180));
      s.vy = spd*Math.sin(rel*60*Math.PI/180);
    }
    let scored = false;
    if (s.bx-BALL < 0) { s.score[1]++; resetBall(s,1); scored=true; }
    if (s.bx+BALL > W) { s.score[0]++; resetBall(s,-1); scored=true; }
    broadcastAll(roomId, { type:"tick", bx:s.bx, by:s.by, p1y:s.p1y, p2y:s.p2y, score:s.score, scored });
  }, 1000/60);
}

wss.on("connection", (ws) => {
  let roomId = null, playerSlot = null;
  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "join") {
      roomId = msg.room;
      if (!rooms[roomId]) rooms[roomId] = createRoom();
      const room = rooms[roomId];
      if (room.players.length < 2) {
        playerSlot = room.players.length + 1;
        room.players.push(ws);
        ws.send(JSON.stringify({ type:"assigned", player:playerSlot, state:room.state }));
        broadcastAll(roomId, { type:"playerCount", count:room.players.length });
        if (room.players.length === 2) {
          room.state.running = true;
          room.state.score = [0,0];
          resetBall(room.state, 1);
          broadcastAll(roomId, { type:"start" });
          startLoop(roomId);
        }
      } else {
        playerSlot = 0;
        ws.send(JSON.stringify({ type:"assigned", player:0, state:room.state }));
      }
      return;
    }
    if (!roomId || !rooms[roomId]) return;
    if (msg.type === "move") {
      const s = rooms[roomId].state;
      if (msg.player === 1) s.p1y = Math.max(0, Math.min(H-PH, msg.y));
      if (msg.player === 2) s.p2y = Math.max(0, Math.min(H-PH, msg.y));
    }
  });
  ws.on("close", () => {
    if (!roomId || !rooms[roomId]) return;
    rooms[roomId].players = rooms[roomId].players.filter(p => p !== ws);
    const count = rooms[roomId].players.length;
    broadcastAll(roomId, { type:"playerCount", count });
    if (count === 0) { clearInterval(rooms[roomId].interval); delete rooms[roomId]; }
    else rooms[roomId].state.running = false;
  });
});

function broadcastAll(roomId, msg) {
  if (!rooms[roomId]) return;
  const str = JSON.stringify(msg);
  rooms[roomId].players.forEach(p => { if (p.readyState === 1) p.send(str); });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pong server on port ${PORT}`));
