// server.js
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ÖNEMLİ: public klasörünü tam yol ile servis et
app.use(express.static(path.join(__dirname, 'public')));

// ---- Basit oyun sunucusu (bizim kurduğumuz) ----
const COLORS = ['kirmizi','siyah','mavi','yesil'];
const SEATS = ['S','W','N','E'];

function createDeck() {
  const deck = [];
  for (const renk of COLORS) {
    for (let n = 1; n <= 13; n++) {
      deck.push({sayi:n, renk, id:`${renk}-${n}-a`});
      deck.push({sayi:n, renk, id:`${renk}-${n}-b`});
    }
  }
  deck.push({sayi:0, renk:'sahte', id:'sahte-a'});
  deck.push({sayi:0, renk:'sahte', id:'sahte-b'});
  return deck;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function nextSeat(seat) {
  const i = SEATS.indexOf(seat);
  return SEATS[(i+1) % SEATS.length];
}
function okeyFromGosterge(g) {
  const next = g.sayi === 13 ? 1 : g.sayi + 1;
  return {sayi: next, renk: g.renk};
}

const rooms = {};
function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      hostId: null,
      settings: { mode: 'tekli', bot: 'kolay', turnSeconds: 30 },
      seats: { S:null, W:null, N:null, E:null },
      players: {},
      started: false,
      deck: [], discard: [], gosterge: null, okey: null,
      hands: { S:[], W:[], N:[], E:[] },
      turn: 'S'
    };
  }
  return rooms[roomId];
}
function roomSummary(room) {
  return {
    id: room.id,
    settings: room.settings,
    seats: room.seats,
    players: Object.fromEntries(Object.entries(room.players).map(([id,p]) => [id, {id:p.id, name:p.name, seat:p.seat, isBot:p.isBot}])),
    started: room.started,
    discardTop: room.discard[room.discard.length-1] || null,
    gosterge: room.gosterge ? {sayi:room.gosterge.sayi, renk:room.gosterge.renk} : null,
    okey: room.okey ? room.okey : null,
    turn: room.turn
  };
}
function handFor(socket, room) {
  const pid = socket.data.playerId;
  const player = room.players[pid];
  if (!player) return [];
  const seat = player.seat;
  const okey = room.okey;
  return (room.hands[seat] || []).map(t => ({
    ...t,
    okey: okey && t.sayi === okey.sayi && t.renk === okey.renk
  }));
}
function fillBotsIfNeeded(room) {
  for (const s of SEATS) {
    if (!room.seats[s]) {
      const botId = `bot-${s}-${Math.random().toString(36).slice(2,7)}`;
      const botName = room.settings.bot === 'zor' ? `Bot(${s})🔥` : `Bot(${s})`;
      room.players[botId] = { id: botId, name: botName, seat: s, isBot: true };
      room.seats[s] = botId;
    }
  }
}
function startIfReady(room) {
  const filled = SEATS.every(s => !!room.seats[s]);
  if (filled && !room.started) startGame(room);
}
function startGame(room) {
  room.deck = shuffle(createDeck());
  room.gosterge = room.deck.pop();
  room.okey = okeyFromGosterge(room.gosterge);
  room.turn = SEATS[Math.floor(Math.random()*SEATS.length)];
  for (const s of SEATS) {
    const count = (s === room.turn) ? 21 : 20;
    room.hands[s] = [];
    for (let i=0;i<count;i++) room.hands[s].push(room.deck.pop());
  }
  room.started = true;
  io.to(room.id).emit('state', roomSummary(room));
  maybeBotPlay(room);
}
function drawFromDeck(room, seat) {
  const c = room.deck.pop();
  if (c) room.hands[seat].push(c);
}
function drawFromDiscard(room, seat) {
  const c = room.discard.pop();
  if (c) room.hands[seat].push(c);
}
function discardTile(room, seat, tileId) {
  const hand = room.hands[seat];
  const idx = hand.findIndex(t => t.id === tileId);
  if (idx >= 0) {
    const [card] = hand.splice(idx,1);
    room.discard.push(card);
    return true;
  }
  return false;
}
function botChooseDiscard(room, seat) {
  const hand = room.hands[seat];
  if (!hand.length) return null;
  if (room.settings.bot === 'kolay') {
    return hand[Math.floor(Math.random()*hand.length)].id;
  }
  let bestIdx = 0, bestScore = 999;
  for (let i=0;i<hand.length;i++) {
    const t = hand[i];
    if (t.sayi === 0) { bestIdx = i; break; }
    const nums = hand.filter(x => x.renk === t.renk).map(x => x.sayi);
    const score = [t.sayi-2,t.sayi-1,t.sayi+1,t.sayi+2].reduce((acc,n)=> acc + (nums.includes(n)?1:0), 0);
    if (score < bestScore) { bestScore = score; bestIdx = i; }
  }
  return hand[bestIdx].id;
}
function nextSeat(seat) { return SEATS[(SEATS.indexOf(seat)+1)%SEATS.length]; }
function maybeBotPlay(room) {
  const currentId = room.seats[room.turn];
  const player = room.players[currentId];
  if (!player || !player.isBot || !room.started) return;
  setTimeout(() => {
    drawFromDeck(room, player.seat);
    const tileId = botChooseDiscard(room, player.seat);
    if (tileId) discardTile(room, player.seat, tileId);
    room.turn = nextSeat(room.turn);
    io.to(room.id).emit('state', roomSummary(room));
    maybeBotPlay(room);
  }, 900);
}

// *** ÖNEMLİ: SPA/tek sayfa***
