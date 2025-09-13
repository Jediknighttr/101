// server.js (çalışan sade sürüm)
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));

// Sağlık kontrolü (opsiyonel ama faydalı)
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// ----------------- OYUN İSKELETİ -----------------
const COLORS = ['kirmizi','siyah','mavi','yesil'];
const SEATS = ['S','W','N','E'];

function createDeck(){
  const d=[];
  for(const c of COLORS){
    for(let n=1;n<=13;n++){
      d.push({sayi:n,renk:c,id:`${c}-${n}-a`});
      d.push({sayi:n,renk:c,id:`${c}-${n}-b`});
    }
  }
  d.push({sayi:0,renk:'sahte',id:'sahte-a'});
  d.push({sayi:0,renk:'sahte',id:'sahte-b'});
  return d;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function nextSeat(s){ return SEATS[(SEATS.indexOf(s)+1)%SEATS.length]; }
function okeyFromGosterge(g){ const next=g.sayi===13?1:g.sayi+1; return {sayi:next,renk:g.renk}; }

const rooms = {};
function getRoom(id){
  if(!rooms[id]){
    rooms[id] = {
      id, hostId:null,
      settings:{mode:'tekli',bot:'kolay',turnSeconds:30},
      seats:{S:null,W:null,N:null,E:null},
      players:{}, started:false,
      deck:[], discard:[], gosterge:null, okey:null,
      hands:{S:[],W:[],N:[],E:[]}, turn:'S'
    };
  }
  return rooms[id];
}
function roomSummary(r){
  return {
    id:r.id, settings:r.settings, seats:r.seats,
    players:Object.fromEntries(Object.entries(r.players).map(([id,p])=>[id,{id:p.id,name:p.name,seat:p.seat,isBot:p.isBot}])),
    started:r.started, discardTop:r.discard[r.discard.length-1]||null,
    gosterge: r.gosterge?{sayi:r.gosterge.sayi,renk:r.gosterge.renk}:null,
    okey:r.okey, turn:r.turn
  };
}
function handFor(socket,r){
  const pid=socket.data.playerId; const p=r.players[pid]; if(!p) return [];
  const seat=p.seat; const o=r.okey;
  return (r.hands[seat]||[]).map(t=>({...t,okey:o&&t.sayi===o.sayi&&t.renk===o.renk}));
}
function fillBots(r){
  for(const s of SEATS){
    if(!r.seats[s]){
      const id=`bot-${s}-${Math.random().toString(36).slice(2,7)}`;
      r.players[id]={id,name:(r.settings.bot==='zor'?`Bot(${s})🔥`:`Bot(${s})`),seat:s,isBot:true};
      r.seats[s]=id;
    }
  }
}
function startIfReady(r){ if(SEATS.every(s=>!!r.seats[s]) && !r.started) startGame(r); }
function startGame(r){
  r.deck = shuffle(createDeck());
  r.gosterge = r.deck.pop();
  r.okey = okeyFromGosterge(r.gosterge);
  r.turn = SEATS[Math.floor(Math.random()*SEATS.length)];
  for(const s of SEATS){
    const c=(s===r.turn)?21:20;
    r.hands[s]=[];
    for(let i=0;i<c;i++) r.hands[s].push(r.deck.pop());
  }
  r.started = true;
  io.to(r.id).emit('state', roomSummary(r));
  maybeBot(r);
}
function drawDeck(r,seat){ const c=r.deck.pop(); if(c) r.hands[seat].push(c); }
function drawDiscard(r,seat){ const c=r.discard.pop(); if(c) r.hands[seat].push(c); }
function discardTile(r,seat,tileId){
  const h=r.hands[seat]; const i=h.findIndex(t=>t.id===tileId);
  if(i<0) return false;
  const [c]=h.splice(i,1); r.discard.push(c);
  return true;
}
function botChoose(r,seat){
  const h=r.hands[seat]; if(!h.length) return null;
  if(r.settings.bot==='kolay') return h[Math.floor(Math.random()*h.length)].id;
  // basit "zor" sezgisi
  let bi=0, bs=999;
  for(let i=0;i<h.length;i++){
    const t=h[i];
    if(t.sayi===0){ bi=i; break; }
    const nums=h.filter(x=>x.renk===t.renk).map(x=>x.sayi);
    const s=[t.sayi-2,t.sayi-1,t.sayi+1,t.sayi+2].reduce((a,n)=>a+(nums.includes(n)?1:0),0);
    if(s<bs){ bs=s; bi=i; }
  }
  return h[bi].id;
}
function maybeBot(r){
  const id=r.seats[r.turn]; const p=r.players[id];
  if(!p||!p.isBot||!r.started) return;
  setTimeout(()=>{
    drawDeck(r,p.seat);
    const tid=botChoose(r,p.seat); if(tid) discardTile(r,p.seat,tid);
    r.turn = nextSeat(r.turn);
    io.to(r.id).emit('state', roomSummary(r));
    maybeBot(r);
  }, 900);
}

// SPA: tüm GET isteklerini index.html'e yönlendir (statikten sonra gelmeli)
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

// ----------------- SOCKET.IO -----------------
io.on('connection',(socket)=>{
  // Güvenli roomId çözümü
  let roomId = 'masa-1';
  try {
    const ref = socket.handshake.headers.referer || '';
    const u = new URL(ref || 'http://example.com/?room=masa-1');
    roomId = u.searchParams.get('room') || 'masa-1';
  } catch (e) {
    roomId = 'masa-1';
  }
  const room = getRoom(roomId);
  socket.join(roomId);
  socket.data.roomId = roomId;

  socket.emit('hello', {roomId, summary: roomSummary(room)});

  socket.on('join', ({name})=>{
    const empty = SEATS.find(s=>!room.seats[s]);
    if(!empty){ socket.emit('errorMsg','Masa dolu.'); return; }
    const pid = socket.id;
    room.players[pid] = {id:pid, name:name||'Oyuncu', seat:empty, isBot:false, socketId:socket.id};
    room.seats[empty] = pid;
    if(!room.hostId) room.hostId = pid;
    socket.data.playerId = pid;
    io.to(roomId).emit('state', roomSummary(room));
  });

  socket.on('chooseSettings', ({mode,bot,turnSeconds})=>{
    const pid=socket.data.playerId;
    if(room.hostId!==pid || room.started) return;
    if(mode==='tekli'||mode==='esli') room.settings.mode = mode;
    if(bot==='kolay'||bot==='zor') room.settings.bot = bot;
    if(typeof turnSeconds==='number' && turnSeconds>=10 && turnSeconds<=90) room.settings.turnSeconds=Math.floor(turnSeconds);
    io.to(roomId).emit('state', roomSummary(room));
  });

  socket.on('startOrFill', ()=>{
    if(room.started) return;
    fillBots(room);
    startIfReady(room);
  });

  socket.on('draw', ({from})=>{
    const pid=socket.data.playerId; const p=room.players[pid];
    if(!(p && p.seat===room.turn && !p.isBot)) return;
    if(from==='deck') drawDeck(room,p.seat);
    else if(from==='discard' && room.discard.length) drawDiscard(room,p.seat);
    io.to(roomId).emit('state', roomSummary(room));
  });

  socket.on('discard', ({tileId})=>{
    const pid=socket.data.playerId; const p=room.players[pid];
    if(!(p && p.seat===room.turn && !p.isBot)) return;
    if(!discardTile(room,p.seat,tileId)) return;
    room.turn = nextSeat(room.turn);
    io.to(roomId).emit('state', roomSummary(room));
    maybeBot(room);
  });

  socket.on('requestHand', ()=>{
    const r = rooms[socket.data.roomId];
    socket.emit('yourHand', r ? handFor(socket,r) : []);
  });

  socket.on('chatPreset', ({text})=>{
    const p=room.players[socket.data.playerId]; if(!p) return;
    io.to(roomId).emit('chat', {from:p.name, text:String(text).slice(0,64), ts:Date.now()});
  });

  socket.on('disconnect', ()=>{
    const pid=socket.data.playerId;
    if(pid && room.players[pid]){
      const seat=room.players[pid].seat;
      delete room.players[pid];
      if(room.seats[seat]===pid) room.seats[seat]=null;
      if(room.started){
        const id=`bot-${seat}-${Math.random().toString(36).slice(2,7)}`;
        room.players[id]={id,name:`Bot(${seat})`,seat,isBot:true};
        room.seats[seat]=id;
      } else {
        if(room.hostId===pid) room.hostId=null;
      }
      io.to(roomId).emit('state', roomSummary(room));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> {
  console.log('Server listening on *:' + PORT);
});
