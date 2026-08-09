(() => {
  const socket = io();

  // ---------- state ----------
  let myId = null;
  let room = null;      // publicRoomState
  let game = null;      // personalGameView
  let selectedTileId = null;
  let voiceOn = false;
  let localStream = null;
  const peerConnections = {}; // peerId -> RTCPeerConnection
  const audioEls = {};        // peerId -> <audio>

  const COLOR_SYMBOL = { kirmizi: '●', sari: '●', mavi: '●', siyah: '●' };

  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  // ---------- DOM refs ----------
  const $ = sel => document.querySelector(sel);
  const viewLobby = $('#view-lobby');
  const viewWaiting = $('#view-waiting');
  const viewGame = $('#view-game');
  const toast = $('#toast');

  function showView(name) {
    viewLobby.hidden = name !== 'lobby';
    viewWaiting.hidden = name !== 'waiting';
    viewGame.hidden = name !== 'game';
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  // ============================================================
  // LOBBY
  // ============================================================
  $('#createRoomBtn').addEventListener('click', () => {
    const name = $('#nameInput').value.trim() || 'Oyuncu';
    socket.emit('createRoom', { name });
  });

  $('#joinRoomBtn').addEventListener('click', () => {
    const name = $('#nameInput').value.trim() || 'Oyuncu';
    const code = $('#codeInput').value.trim().toUpperCase();
    if (!code) { showToast('Lütfen oda kodunu gir.'); return; }
    socket.emit('joinRoom', { code, name });
  });

  socket.on('connect', () => { myId = socket.id; });
  socket.on('errorMsg', msg => showToast(msg));

  socket.on('joinedRoom', ({ code }) => {
    $('#roomCodeLabel').textContent = code;
    $('#roomCodeLabel2').textContent = code;
    showView('waiting');
  });

  $('#copyCodeBtn').addEventListener('click', () => {
    const code = $('#roomCodeLabel').textContent;
    navigator.clipboard?.writeText(code).then(() => showToast('Oda kodu kopyalandı: ' + code));
  });

  // ============================================================
  // WAITING / SEATING
  // ============================================================
  const seatGrid = $('#seatGrid');
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('button');
    btn.className = 'seat-btn';
    btn.dataset.seat = i;
    btn.innerHTML = `<span class="seat-num">Koltuk ${i + 1}</span><span class="seat-name">Boş</span>`;
    btn.addEventListener('click', () => socket.emit('chooseSeat', i));
    seatGrid.appendChild(btn);
  }
  $('#spectatorBtn').addEventListener('click', () => socket.emit('chooseSeat', null));
  $('#startGameBtn').addEventListener('click', () => socket.emit('startGame'));
  $('#newHandBtn').addEventListener('click', () => socket.emit('newHand'));

  socket.on('roomUpdate', state => {
    room = state;
    renderWaiting();
    if (state.gameActive) showView('game');
  });

  function renderWaiting() {
    if (!room) return;
    const isHost = room.hostId === myId;
    const seatEls = seatGrid.querySelectorAll('.seat-btn');
    seatEls.forEach((btn, i) => {
      const occupantId = room.seats[i];
      const occupant = room.players.find(p => p.id === occupantId);
      btn.classList.toggle('occupied', !!occupant);
      btn.classList.toggle('mine', occupantId === myId);
      btn.querySelector('.seat-name').textContent = occupant ? occupant.name : 'Boş';
    });

    const list = $('#playersList');
    list.innerHTML = '';
    room.players.forEach(p => {
      const div = document.createElement('div');
      div.className = 'player-chip' + (p.id === room.hostId ? ' host' : '');
      const spot = p.seat !== null ? `Koltuk ${p.seat + 1}` : 'İzleyici';
      div.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="spot">— ${spot}</span>`;
      list.appendChild(div);
    });

    const filledSeats = room.seats.filter(Boolean).length;
    $('#startGameBtn').hidden = !isHost;
    $('#startGameBtn').disabled = filledSeats !== 4;
    $('#startHint').textContent = isHost
      ? (filledSeats === 4 ? 'Herkes hazır — oyunu başlatabilirsin.' : `Oyun başlamadan önce 4 koltuğun dolu olması gerekiyor (${filledSeats}/4).`)
      : 'Oda kurucusunun oyunu başlatmasını bekleyin.';
  }

  // ============================================================
  // GAME
  // ============================================================
  socket.on('gameUpdate', state => {
    game = state;
    if (game) {
      showView('game');
      renderGame();
    }
  });

  function mySeat() {
    if (!room) return null;
    const me = room.players.find(p => p.id === myId);
    return me ? me.seat : null;
  }

  function tileLabel(tile) {
    if (tile.joker) return '★';
    return String(tile.number);
  }

  function tileEl(tile, { clickable = false, small = false, faceDown = false } = {}) {
    const el = document.createElement('div');
    el.className = 'tile';
    if (faceDown) { el.classList.add('tile-back'); return el; }
    if (!tile) { el.classList.add('tile-empty'); return el; }
    if (tile.joker) el.classList.add('is-joker');
    else el.classList.add('color-' + tile.color);
    if (game && game.okeySpec && !tile.joker && tile.color === game.okeySpec.color && tile.number === game.okeySpec.number) {
      el.classList.add('is-okey');
    }
    el.textContent = tileLabel(tile);
    if (clickable) {
      el.classList.add('clickable');
      el.addEventListener('click', () => onTileClick(tile));
      if (tile.id === selectedTileId) el.classList.add('selected');
    }
    return el;
  }

  function onTileClick(tile) {
    if (!game || game.finished) return;
    const seat = mySeat();
    if (seat === null || game.turnIndex !== seat || game.phase !== 'discard') {
      showToast('Önce taş çekmen gerekiyor / sıra sende değil.');
      return;
    }
    if (selectedTileId === tile.id) {
      // ikinci tık: taşı at
      socket.emit('discardTile', tile.id);
      selectedTileId = null;
    } else {
      selectedTileId = tile.id;
      renderGame();
    }
  }

  $('#deckPile').addEventListener('click', () => socket.emit('drawTile', 'deck'));
  $('#discardPile').addEventListener('click', () => socket.emit('drawTile', 'discard'));
  $('#declareWinBtn').addEventListener('click', () => socket.emit('declareWin'));
  $('#manualWinBtn').addEventListener('click', () => socket.emit('claimManualWin'));

  function renderGame() {
    if (!game || !room) return;
    const seat = mySeat();

    $('#indicatorTile').replaceWith(buildIndicator());
    $('#okeySpecLabel').textContent = game.okeySpec
      ? `${colorNameTr(game.okeySpec.color)} ${game.okeySpec.number}`
      : '-';

    $('#deckCount').textContent = game.deckCount;
    const discardWrap = $('#discardTopTile');
    discardWrap.replaceWith(tileEl(game.discardTop, {}));
    // re-select after replace (id lost) — fix by re-querying
    document.querySelector('.discard-pile .tile').id = 'discardTopTile';

    const turnPlayer = room.players.find(p => p.seat === game.turnIndex);
    $('#turnBanner').textContent = game.finished
      ? (game.winnerId ? `🏆 ${nameOf(game.winnerId)} eli bitirdi!` : 'El bitti')
      : (turnPlayer ? `Sıra: ${turnPlayer.name}${game.turnIndex === seat ? ' (Sen)' : ''} — ${game.phase === 'draw' ? 'taş çeksin' : 'taş atsın'}` : '-');

    $('#newHandBtn').hidden = !(game.finished && room.hostId === myId);

    // rack (kendi elim)
    const rack = $('#myRack');
    rack.innerHTML = '';
    const hand = (game.myHand || []).slice().sort(sortTiles);
    hand.forEach(t => rack.appendChild(tileEl(t, { clickable: true })));

    renderRemoteSeats(seat);
  }

  function buildIndicator() {
    const el = tileEl(game.indicator, {});
    el.id = 'indicatorTile';
    return el;
  }

  function sortTiles(a, b) {
    if (a.joker && b.joker) return 0;
    if (a.joker) return 1;
    if (b.joker) return -1;
    if (a.color === b.color) return a.number - b.number;
    return a.color.localeCompare(b.color);
  }

  function nameOf(id) {
    const p = room.players.find(x => x.id === id);
    return p ? p.name : '?';
  }

  function colorNameTr(c) {
    return { kirmizi: 'Kırmızı', sari: 'Sarı', mavi: 'Mavi', siyah: 'Siyah' }[c] || c;
  }

  function renderRemoteSeats(mySeatIdx) {
    const zones = { 1: $('#seatRight'), 2: $('#seatTop'), 3: $('#seatLeft') };
    Object.values(zones).forEach(z => (z.innerHTML = ''));
    if (mySeatIdx === null) return;

    for (let s = 0; s < 4; s++) {
      if (s === mySeatIdx) continue;
      const rel = (s - mySeatIdx + 4) % 4; // 1=right,2=top,3=left
      const zone = zones[rel];
      if (!zone) continue;
      const occupantId = room.seats[s];
      const occupant = room.players.find(p => p.id === occupantId);
      const wrap = document.createElement('div');
      wrap.className = 'seat-remote-inner';
      const nameEl = document.createElement('div');
      nameEl.className = 'rname';
      nameEl.textContent = occupant ? occupant.name : 'Boş koltuk';
      const tilesEl = document.createElement('div');
      tilesEl.className = 'mini-tiles';
      const count = occupantId ? (game.otherCounts?.[occupantId] || 0) : 0;
      for (let i = 0; i < count; i++) tilesEl.appendChild(tileEl(null, { faceDown: true }));
      wrap.appendChild(nameEl);
      wrap.appendChild(tilesEl);
      zone.appendChild(wrap);
      zone.classList.toggle('active', game.turnIndex === s && !game.finished);
    }
  }

  // ============================================================
  // CHAT
  // ============================================================
  const chatPanel = $('#chatPanel');
  const chatMessages = $('#chatMessages');
  function toggleChat() { chatPanel.hidden = !chatPanel.hidden; }
  $('#chatToggleBtn').addEventListener('click', toggleChat);
  $('#chatToggleBtn2').addEventListener('click', toggleChat);
  $('#chatCloseBtn').addEventListener('click', toggleChat);

  $('#chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chatMsg', text);
    input.value = '';
  });

  socket.on('chatMsg', msg => {
    const div = document.createElement('div');
    if (msg.system) {
      div.className = 'chat-msg system';
      div.textContent = msg.text;
    } else {
      div.className = 'chat-msg';
      div.innerHTML = `<span class="who">${escapeHtml(msg.name)}:</span>${escapeHtml(msg.text)}`;
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  // ============================================================
  // MANUAL WIN CLAIM DIALOG
  // ============================================================
  const manualDialog = $('#manualWinDialog');
  socket.on('manualWinClaim', ({ claimantId, claimantName, hand }) => {
    $('#manualWinTitle').textContent = `${claimantName} elini açtı`;
    const tilesWrap = $('#manualWinTiles');
    tilesWrap.innerHTML = '';
    hand.slice().sort(sortTiles).forEach(t => tilesWrap.appendChild(tileEl(t, {})));

    const actions = $('#manualWinActions');
    actions.innerHTML = '';
    if (room.hostId === myId && claimantId !== myId) {
      const accept = document.createElement('button');
      accept.className = 'btn btn-small btn-gold';
      accept.textContent = 'Kabul Et (Bitti)';
      accept.addEventListener('click', () => { socket.emit('resolveManualWin', { claimantId, accepted: true }); manualDialog.hidden = true; });
      const reject = document.createElement('button');
      reject.className = 'btn btn-small btn-ghost';
      reject.textContent = 'Reddet';
      reject.addEventListener('click', () => { socket.emit('resolveManualWin', { claimantId, accepted: false }); manualDialog.hidden = true; });
      actions.append(accept, reject);
    } else {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn btn-small btn-ghost';
      closeBtn.textContent = 'Kapat';
      closeBtn.addEventListener('click', () => { manualDialog.hidden = true; });
      actions.append(closeBtn);
      showToast(room.hostId === myId ? 'Kendi elini onaylayamazsın.' : 'Masa (oda kurucusu) bu iddiayı değerlendiriyor...');
    }
    manualDialog.hidden = false;
  });

  // ============================================================
  // VOICE CHAT (WebRTC mesh, socket.io signaling)
  // ============================================================
  $('#voiceToggleWaiting').addEventListener('click', toggleVoice);
  $('#voiceToggleGame').addEventListener('click', toggleVoice);

  async function toggleVoice() {
    if (voiceOn) {
      stopVoice();
    } else {
      await startVoice();
    }
  }

  async function startVoice() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      showToast('Mikrofon erişimi reddedildi ya da bulunamadı.');
      return;
    }
    voiceOn = true;
    setVoiceButtonsState(true);
    socket.emit('voiceJoin');
  }

  function stopVoice() {
    voiceOn = false;
    setVoiceButtonsState(false);
    socket.emit('voiceLeave');
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    Object.keys(peerConnections).forEach(closePeer);
  }

  function setVoiceButtonsState(on) {
    ['#voiceToggleWaiting', '#voiceToggleGame'].forEach(sel => {
      const btn = $(sel);
      btn.classList.toggle('active', on);
      btn.textContent = on ? '🔊 Ses Açık' : '🎤 Sesi Aç';
    });
  }

  function closePeer(peerId) {
    peerConnections[peerId]?.close();
    delete peerConnections[peerId];
    const audioEl = audioEls[peerId];
    if (audioEl) { audioEl.remove(); delete audioEls[peerId]; }
  }

  function ensurePeer(peerId, isInitiator) {
    if (peerConnections[peerId]) return peerConnections[peerId];
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[peerId] = pc;

    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('voiceSignal', { to: peerId, signal: { type: 'ice', candidate: e.candidate } });
    };
    pc.ontrack = e => {
      let audioEl = audioEls[peerId];
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.dataset.peer = peerId;
        document.body.appendChild(audioEl);
        audioEls[peerId] = audioEl;
      }
      audioEl.srcObject = e.streams[0];
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voiceSignal', { to: peerId, signal: { type: 'offer', sdp: pc.localDescription } });
      };
    }
    return pc;
  }

  socket.on('voicePeers', peerIds => {
    // Yeni katılan kişi için gelecekte sesi açarsa bu liste kullanılacak; şimdilik saklamaya gerek yok,
    // sesli sohbet açılınca voiceJoin/voicePeerJoined akışı devreye giriyor.
  });

  socket.on('voicePeerJoined', peerId => {
    if (!voiceOn) return;
    ensurePeer(peerId, true);
  });

  socket.on('voicePeerLeft', peerId => {
    closePeer(peerId);
  });

  socket.on('voiceSignal', async ({ from, signal }) => {
    if (!voiceOn) return; // sesim kapalıysa sinyalleri yoksay
    const pc = ensurePeer(from, false);
    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voiceSignal', { to: from, signal: { type: 'answer', sdp: pc.localDescription } });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === 'ice') {
      try { await pc.addIceCandidate(signal.candidate); } catch (_) {}
    }
  });

  // ============================================================
  // utils
  // ============================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
