const { WebSocketServer } = require("ws");
const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200); res.end("Pong Server");
});
const wss = new WebSocketServer({ server });
const rooms = {};

const W=560,H=360,PAD=12,PW=10,BALL=9;
const SPEEDS=[2.5,3.5,4.5,6,8];
const BOUNCE_ACCEL=[0,0.1,0.3,0.6,1.0];
const BOUNCE_ANGLE=[30,45,60,72,80];
const PAD_SIZES=[35,52,70,95,130];
const PW_TYPES=['shrink','grow','speed','slow','swap'];

function createRoom() {
  return {
    players:[], spectators:[],
    mut:{ ballSpeed:3, bounce:3, maxPts:5, padSize:3, powerups:true, compFormat:0 },
    state:{ p1y:H/2-35, p2y:H/2-35, bx:W/2, by:H/2, vx:4.5, vy:3.2,
            p1yPrev:H/2-35, p2yPrev:H/2-35,
            score:[0,0], running:false, swapped:false,
            padScale:[1,1], activePowerups:[] },
    powerups:[], pwTimer:0,
    interval:null, compWins:[0,0]
  };
}

function getPH(room,idx){ return PAD_SIZES[room.mut.padSize-1] * room.state.padScale[idx]; }

function resetBall(room,dir){
  const s=room.state, m=room.mut;
  s.bx=W/2; s.by=H/2;
  s.pwTimer=0; room.powerups=[]; room.pwTimer=0;
  s.padScale=[1,1]; s.activePowerups=[];
  const spd=SPEEDS[m.ballSpeed-1];
  const angle=(Math.random()*40-20)*Math.PI/180;
  s.vx=dir*spd*Math.cos(angle); s.vy=spd*Math.sin(angle);
  if(Math.random()>0.5) s.vy*=-1;
}

function spawnPowerup(room){
  const isSwap=Math.random()<0.08;
  const type=isSwap?'swap':PW_TYPES[Math.floor(Math.random()*4)];
  room.powerups.push({id:Date.now()+Math.random(), x:W*0.25+Math.random()*W*0.5, y:30+Math.random()*(H-60), type, age:0});
}

function startLoop(roomId){
  const room=rooms[roomId];
  if(!room||room.interval) return;
  room.interval=setInterval(()=>{
    if(!rooms[roomId]) return clearInterval(room.interval);
    const s=room.state, m=room.mut;
    if(!s.running) return;

    const ph1=getPH(room,0), ph2=getPH(room,1);
    s.p1yPrev=s.p1y; s.p2yPrev=s.p2y;
    s.bx+=s.vx; s.by+=s.vy;

    let wall=false, hit=false;
    if(s.by-BALL<0){s.by=BALL;s.vy=Math.abs(s.vy);wall=true;}
    if(s.by+BALL>H){s.by=H-BALL;s.vy=-Math.abs(s.vy);wall=true;}

    // Left paddle
    if(s.bx-BALL<PAD+PW && s.bx>PAD && s.by>s.p1y && s.by<s.p1y+ph1){
      s.bx=PAD+PW+BALL;
      const spin=(s.p1y-s.p1yPrev)*0.045;
      const rel=(s.by-(s.p1y+ph1/2))/(ph1/2);
      const maxA=BOUNCE_ANGLE[m.bounce-1]*Math.PI/180;
      const spd=Math.min(Math.sqrt(s.vx*s.vx+s.vy*s.vy)+BOUNCE_ACCEL[m.bounce-1],SPEEDS[m.ballSpeed-1]*2.5);
      s.vx=spd*Math.cos(rel*maxA); s.vy=spd*Math.sin(rel*maxA)+spin; hit=true;
    }
    // Right paddle
    if(s.bx+BALL>W-PAD-PW && s.bx<W-PAD && s.by>s.p2y && s.by<s.p2y+ph2){
      s.bx=W-PAD-PW-BALL;
      const spin=(s.p2y-s.p2yPrev)*0.045;
      const rel=(s.by-(s.p2y+ph2/2))/(ph2/2);
      const maxA=BOUNCE_ANGLE[m.bounce-1]*Math.PI/180;
      const spd=Math.min(Math.sqrt(s.vx*s.vx+s.vy*s.vy)+BOUNCE_ACCEL[m.bounce-1],SPEEDS[m.ballSpeed-1]*2.5);
      s.vx=-(spd*Math.cos(rel*maxA)); s.vy=spd*Math.sin(rel*maxA)+spin; hit=true;
    }

    // Powerups
    let pwEvent=null;
    if(m.powerups){
      room.pwTimer++;
      if(room.pwTimer>420 && room.powerups.length<2 && Math.random()<0.008){
        spawnPowerup(room); room.pwTimer=0;
      }
      for(const p of room.powerups){
        p.age++;
        if(p.age>320){p.remove=true;continue;}
        const dx=s.bx-p.x, dy=s.by-p.y;
        if(!p.hit && Math.sqrt(dx*dx+dy*dy)<18){
          p.hit=true; p.remove=true;
          const player=s.vx<0?2:1;
          pwEvent={type:p.type, player, id:p.id};
          applyPowerupServer(room, p.type, player);
        }
      }
      room.powerups=room.powerups.filter(p=>!p.remove);

      // tick active effects
      s.padScale=[1,1];
      s.activePowerups.forEach(a=>{
        a.ticks--;
        const idx=a.player-1, opp=1-idx;
        if(a.type==='grow')   s.padScale[idx]=Math.min(s.padScale[idx]*1.6,1.6);
        if(a.type==='shrink') s.padScale[opp]=Math.min(s.padScale[opp]*0.5,0.5);
      });
      s.activePowerups=s.activePowerups.filter(a=>a.ticks>0);
    }

    let scored=false;
    if(s.bx-BALL<0){s.score[1]++;resetBall(room,-1);scored=true;}
    if(s.bx+BALL>W){s.score[0]++;resetBall(room,1);scored=true;}

    broadcastRoom(roomId,{
      type:'tick', bx:s.bx, by:s.by, p1y:s.p1y, p2y:s.p2y,
      score:s.score, scored, hit, wall,
      padScale:s.padScale, swapped:s.swapped,
      powerups:room.powerups.map(p=>({id:p.id,x:p.x,y:p.y,type:p.type,age:p.age})),
      pwEvent
    });
  },1000/60);
}

function applyPowerupServer(room, type, player){
  if(type==='swap'){
    room.state.swapped=!room.state.swapped;
    return;
  }
  room.state.activePowerups.push({type, player, ticks:300});
}

wss.on("connection",(ws)=>{
  let roomId=null, playerSlot=null;

  ws.on("message",(raw)=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}

    if(msg.type==="join"){
      roomId=msg.room;
      if(!rooms[roomId]) rooms[roomId]=createRoom();
      const room=rooms[roomId];

      if(room.players.length<2){
        playerSlot=room.players.length+1;
        room.players.push(ws);
        if(playerSlot===1 && msg.mut) Object.assign(room.mut, msg.mut);
        const PH=PAD_SIZES[room.mut.padSize-1];
        room.state.p1y=H/2-PH/2; room.state.p2y=H/2-PH/2;
        ws.send(JSON.stringify({type:"assigned",player:playerSlot,state:room.state,mut:room.mut}));
        broadcastRoom(roomId,{type:"playerCount",count:room.players.length,spectators:room.spectators.length});
        if(room.players.length===2){
          room.state.running=true; room.state.score=[0,0];
          resetBall(room,1);
          broadcastRoom(roomId,{type:"start",mut:room.mut});
          startLoop(roomId);
        }
      } else {
        // spectator
        playerSlot=99;
        room.spectators.push(ws);
        ws.send(JSON.stringify({type:"assigned",player:99,state:room.state,mut:room.mut}));
        broadcastRoom(roomId,{type:"playerCount",count:room.players.length,spectators:room.spectators.length});
      }
      return;
    }

    if(!roomId||!rooms[roomId]) return;
    const room=rooms[roomId];

    if(msg.type==="move"){
      const s=room.state;
      const ph=PAD_SIZES[room.mut.padSize-1];
      if(msg.player===1) s.p1y=Math.max(0,Math.min(H-ph,msg.y));
      if(msg.player===2) s.p2y=Math.max(0,Math.min(H-ph,msg.y));
    }
    if(msg.type==="start" && playerSlot===1){
      const room=rooms[roomId];
      room.state.running=true; room.state.score=[0,0];
      room.compWins=[0,0]; room.state.swapped=false;
      resetBall(room,1);
      broadcastRoom(roomId,{type:"start",mut:room.mut});
    }
  });

  ws.on("close",()=>{
    if(!roomId||!rooms[roomId]) return;
    const room=rooms[roomId];
    room.players=room.players.filter(p=>p!==ws);
    room.spectators=room.spectators.filter(p=>p!==ws);
    const count=room.players.length;
    broadcastRoom(roomId,{type:"playerCount",count,spectators:room.spectators.length});
    if(count===0&&room.spectators.length===0){clearInterval(room.interval);delete rooms[roomId];}
    else if(count<2) room.state.running=false;
  });
});

function broadcastRoom(roomId,msg){
  if(!rooms[roomId]) return;
  const str=JSON.stringify(msg);
  const all=[...rooms[roomId].players,...rooms[roomId].spectators];
  all.forEach(p=>{if(p.readyState===1)p.send(str);});
}

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Pong on port ${PORT}`));
