const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { startNewHand, isOkeyTile, validateWinningHand } = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/**
 * rooms[code] = {
 *   code, hostId,
 *   players: { [socketId]: { id, name, seat: 0-3|null, spectator: bool } }, // max 8 total
 *   seats: [socketId|null, socketId|null, socketId|null, socketId|null],
 *   game: null | gameState (see gameLogic.startNewHand)
 * }
 */
const rooms = {};

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function publicRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, seat: p.seat, spectator: p.spectator })),
    seats: room.seats,
    gameActive: !!room.game && !room.game.finished
  };
}

/** Oyuncuya özel görünüm: kendi eli açık, diğerlerinin sadece taş sayısı görünür. */
function personalGameView(room, socketId) {
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
    myHand: g.hands[socketId] || [],
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

function seatedPlayerIds(room) {
  return room.seats.filter(Boolean);
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name }) => {
    const code = genRoomCode();
    rooms[code] = {
      code,
      hostId: socket.id,
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
    if (Object.keys(room.players).length >= 8) {
      socket.emit('errorMsg', 'Oda dolu (en fazla 8 kişi).');
      return;
    }
    joinRoomInternal(socket, room.code, name);
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
    socket.emit('joinedRoom', { code });
    broadcastRoom(room);
    // Odaya yeni katılana mevcut sesli sohbet katılımcılarını bildir (WebRTC mesh kurulumu için)
    const others = Object.keys(room.players).filter(id => id !== socket.id);
    socket.emit('voicePeers', others);
  }

  socket.on('chooseSeat', seatIndex => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (seatIndex === null) {
      // Seyirciye geç
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
    let tile;
    if (source === 'discard') {
      if (g.discardPile.length === 0) return;
      tile = g.discardPile.pop();
    } else {
      if (g.deck.length === 0) {
        socket.emit('errorMsg', 'Kupada taş kalmadı.');
        return;
      }
      tile = g.deck.pop();
    }
    g.hands[socket.id].push(tile);
    g.phase = 'discard';
    broadcastGame(room);
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
    const idx = hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;
    const [tile] = hand.splice(idx, 1);
    g.discardPile.push(tile);
    g.turnIndex = (g.turnIndex + 1) % 4;
    g.phase = 'draw';
    broadcastGame(room);
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
    // Otomatik kontrolün yakalayamayabileceği geçerli el varyasyonları için:
    // oyuncu elini masaya açar, diğer oyuncular kabul/red oyu verir.
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
    if (room.hostId !== socket.id) return; // sadece host hakemlik yapar (basit çözüm)
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
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const seat = room.players[socket.id]?.seat;
    if (seat !== null && seat !== undefined) room.seats[seat] = null;
    delete room.players[socket.id];
    socket.to(code).emit('voicePeerLeft', socket.id);
    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = Object.keys(room.players)[0];
    }
    broadcastRoom(room);
    if (room.game) broadcastGame(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Okey sunucusu ${PORT} portunda çalışıyor`));


