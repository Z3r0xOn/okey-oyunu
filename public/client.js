(() => {
  const socket = io();

  // ---------- STATE ----------
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

  // --- SİSTEM 1 & 2 VERİ MODELİ (ISTAKA & DRAG) ---
  const RACK_SIZE = 22;
  let rackData = new Array(RACK_SIZE).fill(null);
  let draggedTileIndex = null;

  // --- SİSTEM 3 SÜRE YÖNETİMİ ---
  let timerInterval = null;
  let timeRemaining = 100;

  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  // ---------- DOM REFS ----------
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
  // TAM EKRAN MANTIĞI
  // ============================================================
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }

  function enterFullscreen() {
    const el = document.documentElement;
    try {
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req) {
        const result = req.call(el);
        if (result && result.catch) result.catch(() => {});
      }
    } catch (_) {}
  }

  function exitFullscreen() {
    try {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exit) exit.call(document);
    } catch (_) {}
  }

  function updateFullscreenBtn() {
    const btn = $('#fullscreenBtn');
    if (!btn) return;
    btn.textContent = isFullscreen() ? '⤢' : '⛶';
    btn.title = isFullscreen() ? 'Tam ekrandan çık' : 'Tam ekran';
  }

  $('#fullscreenBtn')?.addEventListener('click', () => {
    if (isFullscreen()) exitFullscreen(); else enterFullscreen();
  });
  ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'].forEach(evt =>
    document.addEventListener(evt, updateFullscreenBtn)
  );

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
    enterFullscreen();
    socket.emit('quickPlay', { name: getEnteredName() });
  });

  $('#createRoomBtn').addEventListener('click', () => {
    enterFullscreen();
    const name = $('#nameInputCreate').value.trim() || 'Oyuncu';
    socket.emit('createRoom', { name });
  });

  $('#joinRoomBtn').addEventListener('click', () => {
    const code = $('#codeInput').value.trim().toUpperCase();
    if (!code) { showToast('Lütfen oda kodunu gir.'); return; }
    enterFullscreen();
    const name = $('#nameInputJoin').value.trim() || 'Oyuncu';
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
  $('#startGameBtn').addEventListener('click', () => { enterFullscreen(); socket.emit('startGame'); });
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
  // GAME MEKANİKLERİ VE SOKET ENTEGRASYONU
  // ============================================================
  socket.on('gameUpdate', state => {
    const prevTurn = game?.turnIndex;
    const prevPhase = game?.phase;
    game = state;

    if (game) {
      showView('game');
      syncHandToRack(game.myHand || []);

      // Sıra değişimi kontrolü ve Zamanlayıcı sıfırlama
      if (prevTurn !== game.turnIndex || prevPhase !== game.phase) {
        resetTimer();
      }

      renderGame();
    }
  });

  function mySeat() {
    if (!room) return null;
    const me = room.players.find(p => p.id === myId);
    return me ? me.seat : null;
  }

  function tileLabel(tile) {
    if (!tile) return '';
    if (tile.joker) return '★';
    return String(tile.number);
  }

  // Sunucudan gelen el verisi ile yerel rackData dizisini eşleştir
  function syncHandToRack(serverHand) {
    const currentRackTiles = rackData.filter(t => t !== null);
    const serverHandIds = new Set(serverHand.map(t => t.id));

    // Sunucuda kalmayan taşları yerel ıstakadan temizle
    for (let i = 0; i < RACK_SIZE; i++) {
      if (rackData[i] && !serverHandIds.has(rackData[i].id)) {
        rackData[i] = null;
      }
    }

    // Yeni gelen taşları en yakın boş slotlara yerleştir
    serverHand.forEach(tile => {
      const exists = rackData.some(t => t && t.id === tile.id);
      if (!exists) {
        const emptySlotIndex = rackData.indexOf(null);
        if (emptySlotIndex !== -1) {
          rackData[emptySlotIndex] = tile;
        }
      }
    });
  }

  // ============================================================
  // SİSTEM 1: GELİŞMİŞ TAŞ ELEMANI & SÜRÜKLE BIRAK MANTIĞI
  // ============================================================
  function createTileElement(tile, index) {
    const el = document.createElement('div');
    el.className = 'tile tile-classic';
    el.dataset.tid = tile.id;
    el.dataset.index = index;
    el.draggable = true;

    if (tile.joker) {
      el.classList.add('is-joker');
    } else {
      el.classList.add('color-' + tile.color);
    }

    if (game && game.okeySpec && !tile.joker && tile.color === game.okeySpec.color && tile.number === game.okeySpec.number) {
      el.classList.add('is-okey');
    }

    el.textContent = tileLabel(tile);

    if (tile.id === selectedTileId) {
      el.classList.add('selected');
    }

    // Sürükleme Etkinlikleri
    el.addEventListener('dragstart', (e) => {
      draggedTileIndex = index;
      setTimeout(() => el.classList.add('dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      draggedTileIndex = null;
    });

    // Tıklama Etkinliği (Çift tıklama / Seçip atma)
    el.addEventListener('click', () => onTileClick(tile));

    return el;
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  // ============================================================
  // SİSTEM 2: TAŞ BIRAKMA VE ISTAKADA KAYDIRMA (SHIFTING)
  // ============================================================
  function handleDrop(e) {
    e.preventDefault();
    const targetSlot = e.target.closest('.slot');
    if (!targetSlot) return;

    const targetIndex = parseInt(targetSlot.dataset.index);
    if (draggedTileIndex === null || draggedTileIndex === targetIndex) return;

    const tileToMove = rackData[draggedTileIndex];

    // Hedef slot doluysa en yakın boş yere kaydır
    if (rackData[targetIndex] !== null) {
      let emptyIndex = findNearestEmptySlot(targetIndex);
      if (emptyIndex !== -1) {
        rackData[emptyIndex] = rackData[targetIndex];
      }
    }

    rackData[targetIndex] = tileToMove;
    rackData[draggedTileIndex] = null;

    renderRackAnimated();
  }

  function findNearestEmptySlot(startIndex) {
    for (let i = 1; i < RACK_SIZE; i++) {
      if (startIndex + i < RACK_SIZE && rackData[startIndex + i] === null) return startIndex + i;
      if (startIndex - i >= 0 && rackData[startIndex - i] === null) return startIndex - i;
    }
    return -1;
  }

  // ============================================================
  // SİSTEM 4: KLONLAMA İLE "UÇAN TAŞ" ANİMASYONLU TAŞ ÇEKME
  // ============================================================
  function drawTileAnimated(type) {
    const seat = mySeat();
    if (seat === null || game.turnIndex !== seat || game.phase !== 'draw') {
      showToast('Sıra sende değil ya da zaten taş çektin.');
      return;
    }

    const emptySlotIndex = rackData.indexOf(null);
    if (emptySlotIndex === -1) {
      showToast('Istakanızda boş slot kalmadı.');
      return;
    }

    const srcArea = type === 'deck' ? $('#deckPile') : $('#discardPile');
    const targetSlotEl = document.querySelector(`.slot[data-index="${emptySlotIndex}"]`);

    if (srcArea && targetSlotEl) {
      const srcRect = srcArea.getBoundingClientRect();
      const dstRect = targetSlotEl.getBoundingClientRect();

      const flyingTile = document.createElement('div');
      flyingTile.className = 'tile tile-classic flying-tile';
      flyingTile.textContent = type === 'discard' && game.discardTop ? tileLabel(game.discardTop) : '🂠';
      if (type === 'discard' && game.discardTop) {
        flyingTile.classList.add(game.discardTop.joker ? 'is-joker' : 'color-' + game.discardTop.color);
      } else {
        flyingTile.classList.add('tile-back');
      }

      flyingTile.style.left = srcRect.left + 'px';
      flyingTile.style.top = srcRect.top + 'px';
      document.body.appendChild(flyingTile);

      requestAnimationFrame(() => {
        flyingTile.style.left = dstRect.left + 'px';
        flyingTile.style.top = dstRect.top + 'px';
      });

      setTimeout(() => {
        if (flyingTile.parentNode) document.body.removeChild(flyingTile);
        socket.emit('drawTile', type);
      }, 350);
    } else {
      socket.emit('drawTile', type);
    }
  }

  // Event Listeners for Drawing Tiles
  $('#deckPile').addEventListener('click', () => { pulse($('#deckPile')); drawTileAnimated('deck'); });
  $('#discardPile').addEventListener('click', () => { pulse($('#discardPile')); drawTileAnimated('discard'); });
  $('#drawDeckBtn').addEventListener('click', () => drawTileAnimated('deck'));
  $('#drawDiscardBtn').addEventListener('click', () => drawTileAnimated('discard'));

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
      renderRackAnimated();
    }
  }

  $('#declareWinBtn').addEventListener('click', () => socket.emit('declareWin'));
  $('#manualWinBtn').addEventListener('click', () => socket.emit('claimManualWin'));
  $('#smartSortBtn').addEventListener('click', smartSort);

  function pulse(el) {
    el.style.transform = 'scale(0.9)';
    setTimeout(() => { el.style.transform = ''; }, 140);
  }

  // ============================================================
  // SİSTEM 3: DİNAMİK SÜRE VE ZAMANLAYICI MANTIĞI
  // ============================================================
  function startTurnTimer() {
    const bar = $('#timerBar');
    if (!bar) return;

    clearInterval(timerInterval);
    timeRemaining = 100;
    const isMyTurn = game && mySeat() === game.turnIndex && !game.finished;

    timerInterval = setInterval(() => {
      timeRemaining -= 1.5;
      bar.style.width = Math.max(0, timeRemaining) + '%';

      if (timeRemaining < 30) {
        bar.style.backgroundColor = '#e84118';
      } else {
        bar.style.backgroundColor = '#4cd137';
      }

      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        if (isMyTurn) {
          showToast('Süreniz doldu!');
          if (game.phase === 'draw') {
            socket.emit('drawTile', 'deck');
          }
        }
      }
    }, 350);
  }

  function resetTimer() {
    const bar = $('#timerBar');
    if (bar) bar.style.backgroundColor = '#4cd137';
    startTurnTimer();
  }

  // ============================================================
  // SİSTEM 5: AKILLI DİZME ALGORİTMASI (RENK VE SAYI SIRALAMA)
  // ============================================================
  function smartSort() {
    let activeTiles = rackData.filter(t => t !== null);

    activeTiles.sort((a, b) => {
      if (a.joker && b.joker) return 0;
      if (a.joker) return 1;
      if (b.joker) return -1;

      if (a.color === b.color) {
        return a.number - b.number;
      }
      return a.color.localeCompare(b.color);
    });

    rackData.fill(null);
    activeTiles.forEach((tile, index) => {
      rackData[index] = tile;
    });

    renderRackAnimated();
    showToast('Taşlar akıllı olarak sıralandı.');
  }

  // ============================================================
  // MASAYI RENDER ETME
  // ============================================================
  function renderGame() {
    if (!game || !room) return;
    const seat = mySeat();

    // Gösterge
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

    // Orta Atılan Taş
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

  // Slot Tabanlı 22 Slotlu Istakayı Çiz
  function renderRackAnimated() {
    const rowTop = $('#rackRowTop');
    const rowBottom = $('#rackRowBottom');
    if (!rowTop || !rowBottom) return;

    rowTop.innerHTML = '';
    rowBottom.innerHTML = '';

    for (let i = 0; i < RACK_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = i;

      slot.addEventListener('dragover', handleDragOver);
      slot.addEventListener('drop', handleDrop);

      const tile = rackData[i];
      if (tile) {
        const tileEl = createTileElement(tile, i);
        slot.appendChild(tileEl);
      }

      if (i < 11) {
        rowTop.appendChild(slot);
      } else {
        rowBottom.appendChild(slot);
      }
    }
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
      const rel = (s - mySeatIdx + 4) % 4; // 1=right, 2=top, 3=left
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
      for (let i = 0; i < count; i++) tilesEl.appendChild(createMiniTileBack());
      wrap.appendChild(nameEl);
      wrap.appendChild(tilesEl);
      zone.appendChild(wrap);
      zone.classList.toggle('active', game.turnIndex === s && !game.finished);
    }
  }

  function createMiniTileBack() {
    const el = document.createElement('div');
    el.className = 'tile tile-back';
    return el;
  }

  // ============================================================
  // CHAT
  // ============================================================
  const chatPanel = $('#chatPanel');
  const chatMessages = $('#chatMessages');
  function toggleChat() { chatPanel.hidden = !chatPanel.hidden; }
  $('#chatToggleBtn')?.addEventListener('click', toggleChat);
  $('#chatToggleBtn2')?.addEventListener('click', toggleChat);
  $('#chatCloseBtn')?.addEventListener('click', toggleChat);

  $('#chatForm')?.addEventListener('submit', e => {
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
    hand.slice().sort((a,b) => a.number - b.number).forEach(t => {
      const el = document.createElement('div');
      el.className = 'tile tile-classic ' + (t.joker ? 'is-joker' : 'color-' + t.color);
      el.textContent = tileLabel(t);
      tilesWrap.appendChild(el);
    });

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
  // VOICE CHAT (WebRTC)
  // ============================================================
  $('#voiceToggleWaiting')?.addEventListener('click', toggleVoice);
  $('#voiceToggleGame')?.addEventListener('click', toggleVoice);

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
      if (btn) {
        btn.classList.toggle('active', on);
        btn.textContent = on ? '🔊 Ses Açık' : '🎤 Sesi Aç';
      }
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

  // Mobil Dokunma ve Zoom Engelleme
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1) { e.preventDefault(); }
  }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  showView('lobby');
})();
