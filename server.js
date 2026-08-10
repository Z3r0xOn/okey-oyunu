const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { startNewHand, validateWinningHand } = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/**
 * rooms[code] = {
 *   code, hostId, quick: bool,
 *   players: { [id]: { id, name, seat: 0-3|null, spectator: bool, bot?: bool } },
 *   seats: [id|null, id|null, id|null, id|null],
 *   game: null | gameState
 * }
 */
const rooms = {};

const BOT_NAMES = ['Ahmet Bot', 'Zeynep Bot', 'Mehmet Bot', 'Elif Bot', 'Can Bot', 'Deniz Bot', 'Ayşe Bot', 'Barış Bot'];

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    quick: !!room.quick,
    players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, seat: p.seat, spectator: p.spectator, bot: !!p.bot })),
    seats: room.seats,
    gameActive: !!room.game && !room.game.finished
  };
}

/** Oyuncuya özel görünüm: kendi eli açık, diğerlerinin sadece taş sayısı görünür. */
function personalGameView(room, id) {
  const g = room.game;
  if (!g) return null;
  const seatOfPlayer = {};
  room.seats.forEach((pid, idx) => { if (pid) seatOfPlayer[pid] = idx; });

  const otherCounts = {};
  for (const [pid, hand] of Object.entries(g.hands)) {
    otherCounts[pid] = hand.length;
  }

  return {
    indicator: g.indicator,
    okeySpec: g.okeySpec,
    discardTop: g.discardPile.length ? g.discardPile[g.discardPile.length - 1] : null,
    discardCount: g.discardPile.length,
    deckCount: g.deck.length,
    turnIndex: g.turnIndex,
    dealerIndex: g.dealerIndex,
    phase: g.phase,
    finished: g.finished,
    winnerId: g.winnerId,
    myHand: g.hands[id] || [],
    otherCounts,
    seatOfPlayer
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomUpdate', publicRoomState(room));
}

function broadcastGame(room) {
  for (const pid of Object.keys(room.players)) {
    io.to(pid).emit('gameUpdate', personalGameView(room, pid));
  }
}

function broadcastOnlineCount() {
  io.emit('onlineCount', io.engine.clientsCount);
}

// ---------- shared draw / discard (used by both real players and bots) ----------
function doDraw(room, pid, source) {
  const g = room.game;
  if (!g || g.finished) return false;
  let actualSource = source;
  if (actualSource === 'discard' && g.discardPile.length === 0) actualSource = 'deck';
  let tile;
  if (actualSource === 'discard') {
    tile = g.discardPile.pop();
  } else {
    if (g.deck.length === 0) return false;
    tile = g.deck.pop();
  }
  g.hands[pid].push(tile);
  g.phase = 'discard';
  broadcastGame(room);
  return true;
}

function doDiscard(room, pid, tileId) {
  const g = room.game;
  if (!g || g.finished) return false;
  const hand = g.hands[pid];
  if (!hand || !hand.length) return false;
  let idx = tileId ? hand.findIndex(t => t.id === tileId) : Math.floor(Math.random() * hand.length);
  if (idx === -1) idx = Math.floor(Math.random() * hand.length);
  const [tile] = hand.splice(idx, 1);
  g.discardPile.push(tile);
  g.turnIndex = (g.turnIndex + 1) % 4;
  g.phase = 'draw';
  broadcastGame(room);
  scheduleBotIfNeeded(room);
  return true;
}

// ---------- bot AI: fully random legal moves ----------
function scheduleBotIfNeeded(room) {
  if (!room.game || room.game.finished) return;
  const g = room.game;
  const turnSeatIdx = g.turnIndex;
  const pid = room.seats[turnSeatIdx];
  const player = room.players[pid];
  if (!player || !player.bot) return;

  const delay = 550 + Math.random() * 900;
  setTimeout(() => {
    if (!rooms[room.code] || !room.game || room.game.finished) return;
    if (room.game.turnIndex !== turnSeatIdx) return; // stale timer, turn already moved on
    if (room.game.phase === 'draw') {
      const useDiscard = Math.random() < 0.12 && room.game.discardPile.length > 0;
      doDraw(room, pid, useDiscard ? 'discard' : 'deck');
      scheduleBotIfNeeded(room); // now in discard phase, chain the next step
    } else if (room.game.phase === 'discard') {
      doDiscard(room, pid, null); // null => bot discards a random tile
    }
  }, delay);
}

io.on('connection', socket => {
  broadcastOnlineCount();

  socket.on('createRoom', ({ name }) => {
    const code = genRoomCode();
    rooms[code] = {
      code,
      hostId: socket.id,
      quick: false,
      players: {},
      seats: [null, null, null, null],
      game: null
    };
    joinRoomInternal(socket, code, name);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms[(code || '').toUpperCase()];
    if (!room) {
      socket.emit('errorMsg', 'Bu kodla bir oda bulunamadı.');
      return;
    }
    if (Object.keys(room.players).filter(id => !room.players[id].bot).length >= 8) {
      socket.emit('errorMsg', 'Oda dolu (en fazla 8 kişi).');
      return;
    }
    joinRoomInternal(socket, room.code, name);
  });

  socket.on('quickPlay', ({ name }) => {
    const code = genRoomCode();
    const room = {
      code,
      hostId: socket.id,
      quick: true,
      players: {},
      seats: [null, null, null, null],
      game: null
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;

    room.players[socket.id] = { id: socket.id, name: (name || 'Oyuncu').slice(0, 20), seat: 0, spectator: false };
    room.seats[0] = socket.id;

    const botNames = shuffleArr(BOT_NAMES).slice(0, 3);
    for (let i = 1; i < 4; i++) {
      const botId = 'bot-' + Math.random().toString(36).slice(2, 9);
      room.players[botId] = { id: botId, name: botNames[i - 1], seat: i, spectator: false, bot: true };
      room.seats[i] = botId;
    }

    socket.emit('joinedRoom', { code, quick: true });
    room.game = startNewHand(room.seats);
    broadcastRoom(room);
    broadcastGame(room);
    scheduleBotIfNeeded(room);
  });

  function joinRoomInternal(socket, code, name) {
    const room = rooms[code];
    socket.join(code);
    socket.data.roomCode = code;
    room.players[socket.id] = {
      id: socket.id,
      name: (name || 'Oyuncu').slice(0, 20),
      seat: null,
      spectator: true
    };
    socket.emit('joinedRoom', { code, quick: false });
    broadcastRoom(room);
    const others = Object.keys(room.players).filter(id => id !== socket.id && !room.players[id].bot);
    socket.emit('voicePeers', others);
  }

  socket.on('chooseSeat', seatIndex => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (seatIndex === null) {
      const curSeat = room.players[socket.id].seat;
      if (curSeat !== null) room.seats[curSeat] = null;
      room.players[socket.id].seat = null;
      room.players[socket.id].spectator = true;
      broadcastRoom(room);
      return;
    }
    if (seatIndex < 0 || seatIndex > 3) return;
    if (room.seats[seatIndex] && room.seats[seatIndex] !== socket.id) {
      socket.emit('errorMsg', 'Bu koltuk dolu.');
      return;
    }
    const curSeat = room.players[socket.id].seat;
    if (curSeat !== null) room.seats[curSeat] = null;
    room.seats[seatIndex] = socket.id;
    room.players[socket.id].seat = seatIndex;
    room.players[socket.id].spectator = false;
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('errorMsg', 'Sadece oda kurucusu oyunu başlatabilir.');
      return;
    }
    const seats = room.seats;
    if (seats.filter(Boolean).length !== 4) {
      socket.emit('errorMsg', 'Oyunu başlatmak için 4 koltuğun da dolu olması gerekir.');
      return;
    }
    room.game = startNewHand(seats);
    broadcastRoom(room);
    broadcastGame(room);
    scheduleBotIfNeeded(room);
  });

  socket.on('drawTile', source => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    const g = room.game;
    const seat = room.players[socket.id]?.seat;
    if (seat === null || seat === undefined) return;
    if (g.turnIndex !== seat || g.phase !== 'draw') {
      socket.emit('errorMsg', 'Sıra sende değil.');
      return;
    }
    if (source === 'discard' && g.discardPile.length === 0) return;
    if (source === 'deck' && g.deck.length === 0) {
      socket.emit('errorMsg', 'Kupada taş kalmadı.');
      return;
    }
    doDraw(room, socket.id, source);
  });

  socket.on('discardTile', tileId => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    const g = room.game;
    const seat = room.players[socket.id]?.seat;
    if (seat === null || seat === undefined) return;
    if (g.turnIndex !== seat || g.phase !== 'discard') {
      socket.emit('errorMsg', 'Sıra sende değil.');
      return;
    }
    const hand = g.hands[socket.id];
    if (!hand.some(t => t.id === tileId)) return;
    doDiscard(room, socket.id, tileId);
  });

  socket.on('declareWin', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    const g = room.game;
    const seat = room.players[socket.id]?.seat;
    if (seat === null || seat === undefined) return;
    const hand = g.hands[socket.id];
    if (hand.length !== 15) {
      socket.emit('errorMsg', 'Bitiş açıklaman için elinde 15 taş olmalı (taş çektikten sonra dene).');
      return;
    }
    const valid = validateWinningHand(hand, g.okeySpec);
    if (valid) {
      g.finished = true;
      g.winnerId = socket.id;
      broadcastGame(room);
      io.to(room.code).emit('chatMsg', { system: true, text: `${room.players[socket.id].name} eli bitirdi! 🎉` });
    } else {
      socket.emit('errorMsg', 'Bu el geçerli bir bitiş değil (otomatik kontrol). İstersen "Elimi Açıyorum" ile masaya danış.');
    }
  });

  socket.on('claimManualWin', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    const g = room.game;
    const hand = g.hands[socket.id];
    io.to(room.code).emit('manualWinClaim', {
      claimantId: socket.id,
      claimantName: room.players[socket.id]?.name,
      hand
    });
  });

  socket.on('resolveManualWin', ({ claimantId, accepted }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    if (room.hostId !== socket.id) return;
    if (accepted) {
      room.game.finished = true;
      room.game.winnerId = claimantId;
      broadcastGame(room);
      io.to(room.code).emit('chatMsg', { system: true, text: `${room.players[claimantId]?.name} eli bitirdi (masa onayıyla)! 🎉` });
    } else {
      io.to(room.code).emit('chatMsg', { system: true, text: `${room.players[claimantId]?.name} elinin bitişi reddedildi, oyun devam ediyor.` });
    }
  });

  socket.on('newHand', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.seats.filter(Boolean).length !== 4) return;
    room.game = startNewHand(room.seats);
    broadcastRoom(room);
    broadcastGame(room);
    scheduleBotIfNeeded(room);
  });

  socket.on('chatMsg', text => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const name = room.players[socket.id]?.name || 'Oyuncu';
    io.to(room.code).emit('chatMsg', { system: false, name, text: String(text).slice(0, 500) });
  });

  // --- WebRTC sesli sohbet sinyalleşmesi (basit mesh, sunucu sadece aracı) ---
  socket.on('voiceJoin', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    socket.to(room.code).emit('voicePeerJoined', socket.id);
  });
  socket.on('voiceLeave', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    socket.to(room.code).emit('voicePeerLeft', socket.id);
  });
  socket.on('voiceSignal', ({ to, signal }) => {
    io.to(to).emit('voiceSignal', { from: socket.id, signal });
  });

  socket.on('disconnect', () => {
    broadcastOnlineCount();
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const seat = room.players[socket.id]?.seat;
    if (seat !== null && seat !== undefined) room.seats[seat] = null;
    delete room.players[socket.id];
    socket.to(code).emit('voicePeerLeft', socket.id);

    const remainingHumans = Object.values(room.players).filter(p => !p.bot);
    if (remainingHumans.length === 0) {
      delete rooms[code];
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = remainingHumans[0].id;
    }
    broadcastRoom(room);
    if (room.game) broadcastGame(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Okey sunucusu ${PORT} portunda çalışıyor`));
