const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ---- Game helpers ----

const COLORS = ['kirmizi','siyah','mavi','yesil']; // red, black, blue, green
const SEATS = ['S','W','N','E']; // south, west, north, east (clockwise)

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

// ---- Room state ----
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
    okey: okey && t.sayi === okey.sayi && t.renk === okey.renk ? true : false
  }));
}

function fillBotsIfNeeded(room) {
  for (const s of ['S','W','N','E']) {
    if (!room.seats[s]) {
      const botId = `bot-${s}-${Math.random().toString(36).slice(2,7)}`;
      const botName = room.settings.bot === 'zor' ? `Bot(${s})🔥` : `Bot(${s})`;
      room.players[botId] = { id: botId, name: botName, seat: s, isBot: true };
      room.seats[s] = botId;
    }
  }
}

function startIfReady(room) {
  const filled = ['S','W','N','E'].every(s => !!room.seats[s]);
  if (filled && !room.started) startGame(room);
}

function startGame(room) {
  room.deck = shuffle(createDeck());
  room.gosterge = room.deck.pop();
  room.okey = okeyFromGosterge(room.gosterge);
  room.turn = ['S','W','N','E'][Math.floor(Math.random()*4)];
  for (const s of ['S','W','N','E']) {
    const count = (s === room.turn) ? 21 : 20;
    room.hands[s] = [];
    for (let i=0;i<count;i++) room.hands[s].push(room.deck.pop());
  }
  room.started = true;
  io.to(room.id).emit('state', roomSummary(room));
  maybeBotPlay(room);
}

function drawFromDeck(room, seat) {
  const card = room.deck.pop();
  if (card) room.hands[seat].push(card);
  return card;
}
function drawFromDiscard(room, seat) {
  const card = room.discard.pop();
  if (card) room.hands[seat].push(card);
  return card;
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
function advanceTurn(room) {
  room.turn = nextSeat(room.turn);
}
function botChooseDiscard(room, seat) {
  const hand = room.hands[seat];
  if (!hand.length) return null;
  if (room.settings.bot === 'kolay') {
    const pick = Math.floor(Math.random()*hand.length);
    return hand[pick].id;
  }
  // naive 'zor'
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
function maybeBotPlay(room) {
  const currentId = room.seats[room.turn];
  const player = room.players[currentId];
  if (!player || !player.isBot || !room.started) return;
  setTimeout(() => {
    drawFromDeck(room, player.seat);
    const tileId = botChooseDiscard(room, player.seat);
    if (tileId) discardTile(room, player.seat, tileId);
    advanceTurn(room);
    io.to(room.id).emit('state', roomSummary(room));
    maybeBotPlay(room);
  }, 900);
}

// ---- Socket events ----
io.on('connection', (socket) => {
  const url = new URL(socket.handshake.headers.referer || `http://x/?room=masa-1`);
  const roomId = url.searchParams.get('room') || 'masa-1';
  const room = getRoom(roomId);
  socket.join(roomId);
  socket.data.roomId = roomId;

  socket.emit('hello', { roomId, summary: roomSummary(room) });

  socket.on('join', ({name}) => {
    const emptySeat = ['S','W','N','E'].find(s => !room.seats[s]);
    if (!emptySeat) { socket.emit('errorMsg', 'Masa dolu.'); return; }
    const pid = socket.id;
    room.players[pid] = { id: pid, name: name || 'Oyuncu', seat: emptySeat, isBot: false, socketId: socket.id };
    room.seats[emptySeat] = pid;
    if (!room.hostId) room.hostId = pid;
    socket.data.playerId = pid;
    io.to(roomId).emit('state', roomSummary(room));
  });

  socket.on('chooseSettings', ({mode, bot, turnSeconds}) => {
    const pid = socket.data.playerId;
    if (room.hostId !== pid || room.started) return;
    if (mode === 'tekli' || mode === 'esli') room.settings.mode = mode;
    if (bot === 'kolay' || bot === 'zor') room.settings.bot = bot;
    if (typeof turnSeconds === 'number' && turnSeconds >= 10 && turnSeconds <= 90) room.settings.turnSeconds = Math.floor(turnSeconds);
    io.to(roomId).emit('state', roomSummary(room));
  });

  socket.on('startOrFill', () => {
    if (room.started) return;
    fillBotsIfNeeded(room);
    startIfReady(room);
  });

  socket.on('draw', ({from}) => {
    const pid = socket.data.playerId;
    const p = room.players[pid];
    if (!(p && p.seat === room.turn && !p.isBot)) return;
    if (from === 'deck') drawFromDeck(room, p.seat);
    else if (from === 'discard' && room.discard.length) drawFromDiscard(room, p.seat);
    io.to(room.id).emit('state', roomSummary(room));
  });

  socket.on('discard', ({tileId}) => {
    const pid = socket.data.playerId;
    const p = room.players[pid];
    if (!(p && p.seat === room.turn && !p.isBot)) return;
    if (!discardTile(room, p.seat, tileId)) return;
    advanceTurn(room);
    io.to(room.id).emit('state', roomSummary(room));
    maybeBotPlay(room);
  });

  socket.on('requestHand', () => {
    const r = getRoom(socket.data.roomId);
    socket.emit('yourHand', handFor(socket, r));
  });

  socket.on('chatPreset', ({text}) => {
    const p = room.players[socket.data.playerId];
    if (!p) return;
    io.to(roomId).emit('chat', {from: p.name, text: String(text).slice(0,64), ts: Date.now()});
  });

  socket.on('disconnect', () => {
    const pid = socket.data.playerId;
    if (pid && room.players[pid]) {
      const seat = room.players[pid].seat;
      delete room.players[pid];
      if (room.seats[seat] === pid) room.seats[seat] = null;
      if (room.started) {
        const botId = `bot-${seat}-${Math.random().toString(36).slice(2,7)}`;
        room.players[botId] = { id: botId, name: `Bot(${seat})`, seat, isBot: true };
        room.seats[seat] = botId;
      } else {
        if (room.hostId === pid) room.hostId = null;
      }
      io.to(roomId).emit('state', roomSummary(room));
    }
  });
});

server.listen(PORT, () => {
  console.log('Server listening on *:' + PORT);
});