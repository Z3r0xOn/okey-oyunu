const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  startNewHand,
  isOkeyTile,
  validateOpenMeld,
  canAttachToRunMeld,
  attachToRunMeld,
  isWorkableTile,
  computeHandScores,
  WORKABLE_DISCARD_PENALTY
} = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/**
 * rooms[code] = {
 *   code, hostId, quick: bool,
 *   players: { [id]: { id, name, seat: 0-3|null, spectator: bool, bot?: bool } },
 *   seats: [id|null, id|null, id|null, id|null],
 *   scores: { [id]: number },   // el bazlı kümülatif ceza puanı (düşük iyi)
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
    scores: room.scores || {},
    gameActive: !!room.game && !room.game.finished
  };
}

/** Oyuncuya özel görünüm: kendi eli açık, diğerlerinin sadece taş sayısı görünür. Masa (perler) herkese açık. */
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
    seatOfPlayer,
    melds: g.melds,
    openedBy: g.openedBy,
    runOpenValue: g.runOpenValue,
    mustUseDrawnTile: g.turnIndex === seatOfPlayer[id] ? g.mustUseDrawnTile : false,
    drawnTileId: g.turnIndex === seatOfPlayer[id] ? g.drawnTileId : null,
    usedDrawnTileInMeld: g.usedDrawnTileInMeld,
    scores: g.scores
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

function applyScores(room, deltas) {
  room.scores = room.scores || {};
  for (const [pid, delta] of Object.entries(deltas)) {
    room.scores[pid] = (room.scores[pid] || 0) + delta;
  }
}

function finishHand(room, winnerId) {
  const g = room.game;
  g.finished = true;
  g.winnerId = winnerId || null;
  const playerIds = room.seats.filter(Boolean);
  g.scores = computeHandScores(g, playerIds);
  applyScores(room, g.scores);
}

// ---------- shared draw (used by both real players and bots) ----------
function doDraw(room, pid, source) {
  const g = room.game;
  if (!g || g.finished) return false;
  let actualSource = source;
  if (actualSource === 'discard' && g.discardPile.length === 0) actualSource = 'deck';
  let tile;
  if (actualSource === 'discard') {
    tile = g.discardPile.pop();
    g.mustUseDrawnTile = true;
  } else {
    if (g.deck.length === 0) {
      finishHand(room, null); // kupa bitti, kazanan yok
      broadcastGame(room);
      return true;
    }
    tile = g.deck.pop();
    g.mustUseDrawnTile = false;
  }
  g.hands[pid].push(tile);
  g.drawnTileId = tile.id;
  g.usedDrawnTileInMeld = false;
  g.phase = 'play'; // çekildi, artık açma/işleme/atma yapılabilir
  broadcastGame(room);
  return true;
}

function endTurnIfEmpty(room, pid) {
  const g = room.game;
  if (g.hands[pid].length === 0) {
    finishHand(room, pid);
    return true;
  }
  return false;
}

function doDiscard(room, pid, tileId) {
  const g = room.game;
  if (!g || g.finished) return false;
  const hand = g.hands[pid];
  if (!hand || !hand.length) return false;
  if (g.mustUseDrawnTile && !g.usedDrawnTileInMeld) return false; // önce ortadan çekilen taşı kullanmalı
  let idx = tileId ? hand.findIndex(t => t.id === tileId) : Math.floor(Math.random() * hand.length);
  if (idx === -1) idx = Math.floor(Math.random() * hand.length);
  const tile = hand[idx];

  if (isWorkableTile(g.melds, tile, g.okeySpec)) {
    applyScores(room, { [pid]: WORKABLE_DISCARD_PENALTY });
    io.to(room.code).emit('chatMsg', { system: true, text: `İşlek taş atma cezası: bir oyuncuya ${WORKABLE_DISCARD_PENALTY} puan yazıldı.` });
    broadcastRoom(room);
  }

  hand.splice(idx, 1);
  g.discardPile.push(tile);
  g.turnIndex = (g.turnIndex + 1) % 4;
  g.phase = 'draw';
  g.mustUseDrawnTile = false;
  g.drawnTileId = null;
  g.usedDrawnTileInMeld = false;
  broadcastGame(room);
  scheduleBotIfNeeded(room);
  return true;
}

// ---------- bot AI: basit rastgele hamleler (per/çift açmayı denemez, sadece çekip atar) ----------
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
    if (room.game.turnIndex !== turnSeatIdx) return; // stale timer
    if (room.game.phase === 'draw') {
      doDraw(room, pid, 'deck'); // botlar basitlik için hep kupadan çeker (ortadan çekme zorunluluğu doğurmasın diye)
      scheduleBotIfNeeded(room);
    } else if (room.game.phase === 'play') {
      doDiscard(room, pid, null);
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
      scores: {},
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
      scores: {},
      game: null
    };
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;

    room.players[socket.id] = { id: socket.id, name: (name || 'Oyuncu').slice(0, 20), seat: 0, spectator: false };
    room.seats[0] = socket.id;
    room.scores[socket.id] = 0;

    const botNames = shuffleArr(BOT_NAMES).slice(0, 3);
    for (let i = 1; i < 4; i++) {
      const botId = 'bot-' + Math.random().toString(36).slice(2, 9);
      room.players[botId] = { id: botId, name: botNames[i - 1], seat: i, spectator: false, bot: true };
      room.seats[i] = botId;
      room.scores[botId] = 0;
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
    room.scores[socket.id] = room.scores[socket.id] || 0;
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
    seats.forEach(pid => { room.scores[pid] = room.scores[pid] || 0; });
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

  // Elden seçilen taşlarla masaya yeni bir per ("run") ya da çift ("pair") açar.
  socket.on('openMeld', ({ kind, tileIds }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    const g = room.game;
    const seat = room.players[socket.id]?.seat;
    if (seat === null || seat === undefined) return;
    if (g.turnIndex !== seat || g.phase !== 'play') {
      socket.emit('errorMsg', 'Şu anda açma yapamazsın.');
      return;
    }
    const hand = g.hands[socket.id];
    const ids = Array.isArray(tileIds) ? [...new Set(tileIds)] : [];
    const tiles = ids.map(id => hand.find(t => t.id === id)).filter(Boolean);
    if (tiles.length !== ids.length || tiles.length < 2) {
      socket.emit('errorMsg', 'Geçersiz taş seçimi.');
      return;
    }
    const alreadyOpened = !!g.openedBy[socket.id];
    const result = validateOpenMeld(kind, tiles, g.okeySpec, alreadyOpened, g.runOpenValue);
    if (!result.ok) {
      socket.emit('errorMsg', result.error || 'Bu açma geçerli değil.');
      return;
    }
    // taşları elden çıkar
    for (const id of ids) {
      const idx = hand.findIndex(t => t.id === id);
      if (idx !== -1) hand.splice(idx, 1);
    }
    g.melds.push(result.meld);
    g.openedBy[socket.id] = true;
    if (kind === 'run') g.runOpenValue = Math.max(g.runOpenValue, runMeldValue(result.meld));
    if (g.drawnTileId && ids.includes(g.drawnTileId)) g.usedDrawnTileInMeld = true;

    if (endTurnIfEmpty(room, socket.id)) {
      broadcastGame(room);
      return;
    }
    broadcastGame(room);
  });

  function runMeldValue(meld) {
    const length = meld.tiles.length;
    return (length * (2 * meld.start + length - 1)) / 2;
  }

  // Elden tek bir taşı masadaki mevcut bir per'e ekler ("işleme").
  socket.on('addToMeld', ({ meldId, tileId }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    const g = room.game;
    const seat = room.players[socket.id]?.seat;
    if (seat === null || seat === undefined) return;
    if (g.turnIndex !== seat || g.phase !== 'play') {
      socket.emit('errorMsg', 'Şu anda taş işleyemezsin.');
      return;
    }
    if (!g.openedBy[socket.id]) {
      socket.emit('errorMsg', 'Taş işleyebilmek için önce kendi elini açmış olmalısın.');
      return;
    }
    const hand = g.hands[socket.id];
    const tile = hand.find(t => t.id === tileId);
    const meld = g.melds.find(m => m.id === meldId);
    if (!tile || !meld) return;
    const attach = canAttachToRunMeld(meld, tile, g.okeySpec);
    if (!attach.ok) {
      socket.emit('errorMsg', 'Bu taş bu pere işlenemez.');
      return;
    }
    attachToRunMeld(meld, tile, attach.side);
    const idx = hand.findIndex(t => t.id === tileId);
    hand.splice(idx, 1);
    if (g.drawnTileId === tileId) g.usedDrawnTileInMeld = true;

    if (endTurnIfEmpty(room, socket.id)) {
      broadcastGame(room);
      return;
    }
    broadcastGame(room);
  });

  socket.on('discardTile', tileId => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.game || room.game.finished) return;
    const g = room.game;
    const seat = room.players[socket.id]?.seat;
    if (seat === null || seat === undefined) return;
    if (g.turnIndex !== seat || g.phase !== 'play') {
      socket.emit('errorMsg', 'Sıra sende değil.');
      return;
    }
    const hand = g.hands[socket.id];
    if (!hand.some(t => t.id === tileId)) return;
    if (g.mustUseDrawnTile && !g.usedDrawnTileInMeld) {
      socket.emit('errorMsg', 'Ortadan çektiğin taşı bu turda bir açma/işleme hamlesinde kullanmalısın.');
      return;
    }
    doDiscard(room, socket.id, tileId);
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
server.listen(PORT, () => console.log(`51 Okey sunucusu ${PORT} portunda çalışıyor`));
