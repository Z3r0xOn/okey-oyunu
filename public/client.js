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
  let prevHandIds = [];
  let prevDiscardTopId = null;
  let indicatorRevealed = false;

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

  function resetToLobby() {
    room = null;
    game = null;
    selectedTileId = null;
    prevHandIds = [];
    prevDiscardTopId = null;
    indicatorRevealed = false;
    stopVoice();
    chatMessages.innerHTML = '';
    showView('lobby');
  }

  // ============================================================
  // LOBBY
  // ============================================================
  function getEnteredName() {
    const a = $('#nameInputCreate')?.value.trim();
    const b = $('#nameInputJoin')?.value.trim();
    return a || b || 'Oyuncu';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
      $('#panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  $('#quickPlayBtn').addEventListener('click', () => {
    socket.emit('quickPlay', { name: getEnteredName() });
  });

  $('#createRoomBtn').addEventListener('click', () => {
    const name = $('#nameInputCreate').value.trim() || 'Oyuncu';
    socket.emit('createRoom', { name });
  });

  $('#joinRoomBtn').addEventListener('click', () => {
    const name = $('#nameInputJoin').value.trim() || 'Oyuncu';
    const code = $('#codeInput').value.trim().toUpperCase();
    if (!code) { showToast('Lütfen oda kodunu gir.'); return; }
    socket.emit('joinRoom', { code, name });
  });

  socket.on('connect', () => { myId = socket.id; });
  socket.on('errorMsg', msg => showToast(msg));
  socket.on('onlineCount', n => { $('#onlineCount').textContent = n; });

  socket.on('joinedRoom', ({ code, quick }) => {
    $('#roomCodeLabel').textContent = code;
    $('#roomCodeLabel2').textContent = code;
    if (!quick) showView('waiting');
  });

  $('#copyCodeBtn').addEventListener('click', () => {
    const code = $('#roomCodeLabel').textContent;
    navigator.clipboard?.writeText(code).then(() => showToast('Oda kodu kopyalandı: ' + code));
  });

  $('#leaveWaitingBtn').addEventListener('click', () => location.reload());
  $('#leaveGameBtn').addEventListener('click', () => location.reload());

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

  function tileEl(tile, { clickable = false, faceDown = false } = {}) {
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
      socket.emit('discardTile', tile.id);
      selectedTileId = null;
    } else {
      selectedTileId = tile.id;
      renderGame();
    }
  }

  $('#deckPile').addEventListener('click', () => { pulse($('#deckPile')); socket.emit('drawTile', 'deck'); });
  $('#discardPile').addEventListener('click', () => { pulse($('#discardPile')); socket.emit('drawTile', 'discard'); });
  $('#declareWinBtn').addEventListener('click', () => socket.emit('declareWin'));
  $('#manualWinBtn').addEventListener('click', () => socket.emit('claimManualWin'));

  function pulse(el) {
    el.style.transform = 'scale(0.9)';
    setTimeout(() => { el.style.transform = ''; }, 140);
  }

  function renderGame() {
    if (!game || !room) return;
    const seat = mySeat();

    // Gösterge — ilk gösterimde açılış animasyonu
    const indicatorHost = $('#indicatorTile');
    indicatorHost.className = 'tile';
    if (game.indicator.joker) indicatorHost.classList.add('is-joker');
    else indicatorHost.classList.add('color-' + game.indicator.color);
    indicatorHost.textContent = tileLabel(game.indicator);
    if (!indicatorRevealed) {
      indicatorHost.classList.add('indicator-reveal');
      indicatorRevealed = true;
    }
    $('#okeySpecLabel').textContent = game.okeySpec
      ? `${colorNameTr(game.okeySpec.color)} ${game.okeySpec.number}`
      : '-';

    $('#deckCount').textContent = game.deckCount;

    // Orta yığın — değiştiyse pop animasyonu
    const discardHost = $('#discardTopTile');
    discardHost.className = 'tile';
    if (game.discardTop) {
      if (game.discardTop.joker) discardHost.classList.add('is-joker');
      else discardHost.classList.add('color-' + game.discardTop.color);
      discardHost.textContent = tileLabel(game.discardTop);
      if (game.discardTop.id !== prevDiscardTopId) {
        discardHost.classList.add('tile-pop');
      }
      prevDiscardTopId = game.discardTop.id;
    } else {
      discardHost.classList.add('tile-empty');
      prevDiscardTopId = null;
    }

    const turnPlayer = room.players.find(p => p.seat === game.turnIndex);
    $('#turnBanner').textContent = game.finished
      ? (game.winnerId ? `🏆 ${nameOf(game.winnerId)} eli bitirdi!` : 'El bitti')
      : (turnPlayer ? `Sıra: ${turnPlayer.name}${game.turnIndex === seat ? ' (Sen)' : ''} — ${game.phase === 'draw' ? 'taş çeksin' : 'taş atsın'}` : '-');

    $('#newHandBtn').hidden = !(game.finished && room.hostId === myId);

    renderRackAnimated();
    renderRemoteSeats(seat);
  }

  function renderRackAnimated() {
    const rack = $('#myRack');
    const prevRects = {};
    rack.querySelectorAll('.tile[data-tid]').forEach(el => {
      prevRects[el.dataset.tid] = el.getBoundingClientRect();
    });

    rack.innerHTML = '';
    const hand = (game.myHand || []).slice().sort(sortTiles);
    const newIds = hand.map(t => t.id);

    hand.forEach(t => {
      const el = tileEl(t, { clickable: true });
      el.dataset.tid = t.id;
      rack.appendChild(el);
    });

    requestAnimationFrame(() => {
      rack.querySelectorAll('.tile[data-tid]').forEach(el => {
        const id = el.dataset.tid;
        const old = prevRects[id];
        if (old) {
          const newRect = el.getBoundingClientRect();
          const dx = old.left - newRect.left;
          const dy = old.top - newRect.top;
          if (dx || dy) {
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            requestAnimationFrame(() => {
              el.style.transition = 'transform 0.22s ease';
              el.style.transform = '';
            });
          }
        } else if (!prevHandIds.includes(id)) {
          el.classList.add('tile-enter');
          setTimeout(() => el.classList.remove('tile-enter'), 330);
        }
      });
      prevHandIds = newIds;
    });
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
      if (occupant && occupant.bot) {
        const tag = document.createElement('span');
        tag.className = 'bot-tag';
        tag.textContent = '🤖';
        nameEl.appendChild(tag);
      }
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
    if (!voiceOn && !localStream) return;
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

  socket.on('voicePeers', () => {
    // Sesli sohbet açılınca voiceJoin/voicePeerJoined akışı devreye giriyor.
  });

  socket.on('voicePeerJoined', peerId => {
    if (!voiceOn) return;
    ensurePeer(peerId, true);
  });

  socket.on('voicePeerLeft', peerId => {
    closePeer(peerId);
  });

  socket.on('voiceSignal', async ({ from, signal }) => {
    if (!voiceOn) return;
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
  // Tam ekran / kaydırma engelleme yardımcıları
  // ============================================================
  document.addEventListener('touchmove', e => {
    // Kaydırılabilir alanların (rack, chat, seating) kendi iç kaydırmasına izin ver,
    // sayfanın kendisinin (body) kaymasını/zoom'unu engelle.
    if (e.touches.length > 1) { e.preventDefault(); return; }
  }, { passive: false });

  document.addEventListener('gesturestart', e => e.preventDefault());

  // ============================================================
  // utils
  // ============================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Sayfa her yenilendiğinde ana menüye düşer (state saklanmaz) — bu zaten varsayılan davranış.
  showView('lobby');
})();
