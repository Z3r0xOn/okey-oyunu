(() => {
  const socket = io();

  // ---------- state ----------
  let myId = null;
  let room = null;      // publicRoomState
  let game = null;      // personalGameView
  let voiceOn = false;
  let localStream = null;
  const peerConnections = {}; // peerId -> RTCPeerConnection
  const audioEls = {};        // peerId -> <audio>
  let indicatorRevealed = false;

  // ---------- rack (klasik 51-okey taşlığı) ----------
  const RACK_SLOTS = 32; // 16 taş x 2 sıra
  let localRack = new Array(RACK_SLOTS).fill(null); // slot -> tileId | null
  let tileMap = {};       // tileId -> tile object (mevcut elden)
  let selectedSlotIndex = null;
  let pendingDrawTargetSlot = null;

  // ---------- ses efektleri ----------
  let soundEnabled = true;
  let audioCtx = null;

  // ---------- görsel sıra süre çubuğu (bilgilendirme amaçlı, otomatik oynatmaz) ----------
  let turnTimerInterval = null;
  let prevTurnKey = null;

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
  // TAM EKRAN (masaüstü + mobil)
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
        if (result && result.catch) result.catch(() => { /* kullanıcı jesti dışı / desteklenmiyor — sessizce yoksay */ });
      }
    } catch (_) { /* ignore */ }
  }

  function exitFullscreen() {
    try {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exit) exit.call(document);
    } catch (_) { /* ignore */ }
  }

  function updateFullscreenBtn() {
    const btn = $('#fullscreenBtn');
    if (!btn) return;
    btn.textContent = isFullscreen() ? '⤢' : '⛶';
    btn.title = isFullscreen() ? 'Tam ekrandan çık' : 'Tam ekran';
  }

  $('#fullscreenBtn').addEventListener('click', () => {
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

  function nameOf(id) {
    const p = room.players.find(x => x.id === id);
    return p ? p.name : '?';
  }

  function tileLabel(tile) {
    if (tile.joker) return '★';
    return String(tile.number);
  }

  function sortTiles(a, b) {
    if (a.joker && b.joker) return 0;
    if (a.joker) return 1;
    if (b.joker) return -1;
    if (a.color === b.color) return a.number - b.number;
    return a.color.localeCompare(b.color);
  }

  function tileEl(tile, { faceDown = false, classic = false } = {}) {
    const el = document.createElement('div');
    el.className = 'tile';
    if (classic) el.classList.add('tile-classic');
    if (faceDown) { el.classList.add('tile-back'); return el; }
    if (!tile) { el.classList.add('tile-empty'); return el; }
    if (tile.joker) el.classList.add('is-joker');
    else el.classList.add('color-' + tile.color);
    if (game && game.okeySpec && !tile.joker && tile.color === game.okeySpec.color && tile.number === game.okeySpec.number) {
      el.classList.add('is-okey');
    }
    el.textContent = tileLabel(tile);
    return el;
  }

  // ---------- ses efektleri ----------
  function playSound(type) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      if (type === 'tile') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.05);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.05);
        osc.start(now); osc.stop(now + 0.05);
      } else if (type === 'draw') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.exponentialRampToValueAtTime(580, now + 0.07);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.07);
        osc.start(now); osc.stop(now + 0.07);
      }
    } catch (_) { /* ses motoru desteklenmiyor olabilir, sessizce yoksay */ }
  }

  $('#soundToggleBtn').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    $('#soundToggleBtn').textContent = soundEnabled ? '🔊' : '🔇';
  });

  // ---------- taşlığı (rack) el ile uzlaştırma ----------
  /** Sunucudan gelen yeni eli, sürükle-bırakla düzenlenmiş yerel taşlık dizisiyle uzlaştırır. */
  function reconcileRack(hand) {
    const handIdSet = new Set(hand.map(t => t.id));
    tileMap = {};
    hand.forEach(t => { tileMap[t.id] = t; });

    // Elden çıkan (atılan) taşları yuvalardan temizle
    for (let i = 0; i < RACK_SLOTS; i++) {
      if (localRack[i] && !handIdSet.has(localRack[i])) localRack[i] = null;
    }

    const placedSet = new Set(localRack.filter(Boolean));
    const newIds = hand.map(t => t.id).filter(id => !placedSet.has(id));

    if (placedSet.size === 0 && newIds.length > 1) {
      // Yeni el dağıtıldı — sıralı şekilde diz
      localRack = new Array(RACK_SLOTS).fill(null);
      hand.slice().sort(sortTiles).forEach((t, i) => { if (i < RACK_SLOTS) localRack[i] = t.id; });
      pendingDrawTargetSlot = null;
      return;
    }

    newIds.forEach(id => {
      let slot = (pendingDrawTargetSlot !== null && localRack[pendingDrawTargetSlot] === null)
        ? pendingDrawTargetSlot
        : localRack.findIndex(s => s === null);
      pendingDrawTargetSlot = null;
      if (slot !== -1) localRack[slot] = id;
    });
  }

  function clearSlotHighlights() {
    document.querySelectorAll('.rack-slot.hovered').forEach(s => s.classList.remove('hovered'));
  }

  function swapSlots(a, b) {
    const tmp = localRack[a]; localRack[a] = localRack[b]; localRack[b] = tmp;
  }

  function moveTile(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    if (localRack[toIdx] === null) { localRack[toIdx] = localRack[fromIdx]; localRack[fromIdx] = null; }
    else swapSlots(fromIdx, toIdx);
  }

  function selectSlot(i) {
    if (!localRack[i]) {
      if (selectedSlotIndex !== null) {
        moveTile(selectedSlotIndex, i);
        selectedSlotIndex = null;
        renderRack();
      }
      return;
    }
    playSound('tile');
    if (selectedSlotIndex === null) selectedSlotIndex = i;
    else if (selectedSlotIndex === i) selectedSlotIndex = null;
    else { swapSlots(selectedSlotIndex, i); selectedSlotIndex = null; }
    renderRack();
  }

  function discardSlot(i) {
    if (!game || game.finished) return;
    const seat = mySeat();
    if (seat === null || game.turnIndex !== seat || game.phase !== 'discard') {
      showToast('Önce taş çekmen gerekiyor / sıra sende değil.');
      return;
    }
    const tid = localRack[i];
    if (!tid) return;
    localRack[i] = null;
    selectedSlotIndex = null;
    playSound('tile');
    socket.emit('discardTile', tid);
    renderRack();
  }

  function sortRackBy(cmp) {
    const tiles = localRack.filter(Boolean).map(id => tileMap[id]).filter(Boolean).sort(cmp);
    localRack = new Array(RACK_SLOTS).fill(null);
    tiles.forEach((t, i) => { if (i < RACK_SLOTS) localRack[i] = t.id; });
    selectedSlotIndex = null;
    playSound('tile');
    renderRack();
  }

  $('#sortColorBtn').addEventListener('click', () => {
    sortRackBy((a, b) => (a.joker ? 1 : b.joker ? -1 : (a.color === b.color ? a.number - b.number : a.color.localeCompare(b.color))));
  });
  $('#sortNumberBtn').addEventListener('click', () => {
    sortRackBy((a, b) => (a.joker ? 1 : b.joker ? -1 : (a.number === b.number ? a.color.localeCompare(b.color) : a.number - b.number)));
  });
  $('#discardSelectedBtn').addEventListener('click', () => {
    if (selectedSlotIndex === null) { showToast('Önce taşlıktan bir taş seç.'); return; }
    discardSlot(selectedSlotIndex);
  });
  $('#manualWinBtn').addEventListener('click', () => socket.emit('claimManualWin'));
  $('#newHandBtn').addEventListener('click', () => socket.emit('newHand'));

  /** İki katlı ahşap taşlığı (32 yuva) sürükle-bırak destekli olarak çizer. */
  function renderRack() {
    const row1 = $('#rackRow1');
    const row2 = $('#rackRow2');
    row1.innerHTML = '';
    row2.innerHTML = '';

    for (let i = 0; i < RACK_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'rack-slot';
      slot.dataset.index = i;

      slot.addEventListener('dragover', e => {
        e.preventDefault();
        clearSlotHighlights();
        slot.classList.add('hovered');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('hovered'));
      slot.addEventListener('drop', e => {
        e.preventDefault();
        clearSlotHighlights();
        $('#rackContainer').classList.remove('drag-active');
        const action = e.dataTransfer.getData('action');
        if (action === 'draw-deck') {
          pendingDrawTargetSlot = i;
          socket.emit('drawTile', 'deck');
        } else if (action === 'draw-discard') {
          pendingDrawTargetSlot = i;
          socket.emit('drawTile', 'discard');
        } else if (action === 'move-tile') {
          const fromIdx = parseInt(e.dataTransfer.getData('fromIndex'), 10);
          if (!Number.isNaN(fromIdx)) {
            moveTile(fromIdx, i);
            playSound('tile');
            renderRack();
          }
        }
      });
      slot.addEventListener('click', () => selectSlot(i));

      const tid = localRack[i];
      if (tid && tileMap[tid]) {
        const t = tileMap[tid];
        const tEl = tileEl(t, { classic: true });
        tEl.classList.add('clickable');
        tEl.draggable = true;
        tEl.dataset.tid = t.id;
        if (selectedSlotIndex === i) tEl.classList.add('selected');
        tEl.addEventListener('dragstart', e => {
          e.dataTransfer.setData('action', 'move-tile');
          e.dataTransfer.setData('fromIndex', String(i));
          playSound('tile');
          $('#rackContainer').classList.add('drag-active');
        });
        tEl.addEventListener('dragend', () => $('#rackContainer').classList.remove('drag-active'));
        tEl.addEventListener('click', e => { e.stopPropagation(); selectSlot(i); });
        tEl.addEventListener('dblclick', e => { e.stopPropagation(); discardSlot(i); });
        slot.appendChild(tEl);
      }

      (i < RACK_SLOTS / 2 ? row1 : row2).appendChild(slot);
    }
  }

  // ---------- kupa (deste) ----------
  const deckPileEl = $('#deckPile');
  deckPileEl.addEventListener('click', () => {
    const seat = mySeat();
    if (!game || game.finished || seat === null || game.turnIndex !== seat || game.phase !== 'draw') {
      showToast('Sıra sende değil ya da zaten taş çektin.');
      return;
    }
    pulse(deckPileEl);
    socket.emit('drawTile', 'deck');
  });
  deckPileEl.addEventListener('dragstart', e => {
    const seat = mySeat();
    if (!game || game.finished || seat === null || game.turnIndex !== seat || game.phase !== 'draw') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('action', 'draw-deck');
    playSound('tile');
    $('#rackContainer').classList.add('drag-active');
  });
  deckPileEl.addEventListener('dragend', () => $('#rackContainer').classList.remove('drag-active'));

  function pulse(el) {
    el.style.transform = 'scale(0.9)';
    setTimeout(() => { el.style.transform = ''; }, 140);
  }

  // ---------- bitiş bölgesi ----------
  const finishZone = $('#finishDropZone');
  finishZone.addEventListener('click', () => socket.emit('declareWin'));
  finishZone.addEventListener('dragover', e => { e.preventDefault(); finishZone.classList.add('drag-over'); });
  finishZone.addEventListener('dragleave', () => finishZone.classList.remove('drag-over'));
  finishZone.addEventListener('drop', e => {
    e.preventDefault();
    finishZone.classList.remove('drag-over');
    const action = e.dataTransfer.getData('action');
    if (action === 'move-tile') socket.emit('declareWin');
  });

  // ---------- el bitti modalı ----------
  const gameEndModal = $('#gameEndModal');
  $('#gameEndNewHandBtn').addEventListener('click', () => { socket.emit('newHand'); gameEndModal.hidden = true; });
  $('#gameEndCloseBtn').addEventListener('click', () => { gameEndModal.hidden = true; });
  let gameEndModalShownFor = null;

  function showGameEndModal() {
    const key = (game.winnerId || 'draw') + ':' + game.turnIndex;
    if (gameEndModalShownFor === key) { gameEndModal.hidden = false; return; }
    gameEndModalShownFor = key;
    $('#gameEndTitle').textContent = game.winnerId ? `🏆 ${nameOf(game.winnerId)} Kazandı!` : '🤝 El Berabere';
    $('#gameEndBody').textContent = game.winnerId === myId
      ? 'Tebrikler, eli bitirdin!'
      : (game.winnerId ? `${nameOf(game.winnerId)} eli bitirdi.` : 'Bu el kimse kazanamadı.');
    $('#gameEndNewHandBtn').hidden = !room || room.hostId !== myId;
    gameEndModal.hidden = false;
  }

  // ---------- görsel sıra süre çubuğu ----------
  function startVisualTurnTimer(seat) {
    clearInterval(turnTimerInterval);
    document.querySelectorAll('.timer-fill').forEach(el => (el.style.width = '100%'));
    if (!game || game.finished || seat === null) return;
    const zones = { 0: '#badgeMe', 1: '#badgeRight', 2: '#badgeTop', 3: '#badgeLeft' };
    const rel = (game.turnIndex - seat + 4) % 4;
    const fill = document.querySelector(zones[rel] + ' .timer-fill');
    if (!fill) return;
    let width = 100;
    turnTimerInterval = setInterval(() => {
      width -= 100 / 60; // ~15sn'lik görsel gösterge
      if (width <= 0) { width = 0; clearInterval(turnTimerInterval); }
      fill.style.width = width + '%';
    }, 250);
  }

  function renderBadges(mySeatIdx) {
    const zones = { 0: 'badgeMe', 1: 'badgeRight', 2: 'badgeTop', 3: 'badgeLeft' };
    if (mySeatIdx === null) {
      Object.values(zones).forEach(id => { $('#' + id).hidden = true; });
      return;
    }
    for (let s = 0; s < 4; s++) {
      const rel = (s - mySeatIdx + 4) % 4;
      const el = $('#' + zones[rel]);
      const occupantId = room.seats[s];
      const occupant = room.players.find(p => p.id === occupantId);
      el.hidden = !occupant;
      if (!occupant) continue;
      el.querySelector('.player-name').textContent = occupant.name + (occupant.bot ? ' 🤖' : '');
      if (rel !== 0) {
        const miniHost = el.querySelector('.mini-tiles');
        miniHost.innerHTML = '';
        const count = game.otherCounts?.[occupantId] || 0;
        for (let i = 0; i < count; i++) miniHost.appendChild(tileEl(null, { faceDown: true }));
      }
      el.classList.toggle('active-turn', game.turnIndex === s && !game.finished);
    }
  }

  function colorNameTr(c) {
    return { kirmizi: 'Kırmızı', sari: 'Sarı', mavi: 'Mavi', siyah: 'Siyah' }[c] || c;
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

    // Okey rozeti (gösterge + 1)
    const okeyHost = $('#okeyHolder');
    okeyHost.className = 'tile';
    if (game.okeySpec) {
      okeyHost.classList.add('color-' + game.okeySpec.color);
      okeyHost.textContent = String(game.okeySpec.number);
      okeyHost.title = colorNameTr(game.okeySpec.color) + ' ' + game.okeySpec.number;
    } else {
      okeyHost.classList.add('tile-empty');
    }

    $('#deckCount').textContent = game.deckCount;

    // Atık taş — sırası gelen koltuğun önünde gösterilir
    ['discardTopSpot', 'discardLeftSpot', 'discardRightSpot', 'discardPlayerSpot'].forEach(id => {
      const spot = $('#' + id);
      spot.innerHTML = '';
      spot.classList.remove('takeable');
      spot.onclick = null;
    });
    if (game.discardTop && seat !== null) {
      const discarderSeat = (game.turnIndex - 1 + 4) % 4;
      const rel = (discarderSeat - seat + 4) % 4; // 0=ben,1=sağ,2=üst,3=sol
      const spotId = rel === 0 ? 'discardPlayerSpot' : rel === 1 ? 'discardRightSpot' : rel === 2 ? 'discardTopSpot' : 'discardLeftSpot';
      const spot = $('#' + spotId);
      const tNode = tileEl(game.discardTop, {});
      spot.appendChild(tNode);
      const takeable = game.phase === 'draw' && game.turnIndex === seat && !game.finished;
      if (takeable) {
        spot.classList.add('takeable');
        tNode.draggable = true;
        tNode.addEventListener('dragstart', e => {
          e.dataTransfer.setData('action', 'draw-discard');
          playSound('tile');
          $('#rackContainer').classList.add('drag-active');
        });
        tNode.addEventListener('dragend', () => $('#rackContainer').classList.remove('drag-active'));
        spot.onclick = () => socket.emit('drawTile', 'discard');
      }
    }

    const turnPlayer = room.players.find(p => p.seat === game.turnIndex);
    $('#turnBanner').textContent = game.finished
      ? (game.winnerId ? `🏆 ${nameOf(game.winnerId)} eli bitirdi!` : 'El bitti')
      : (turnPlayer ? `Sıra: ${turnPlayer.name}${game.turnIndex === seat ? ' (Sen)' : ''} — ${game.phase === 'draw' ? 'taş çeksin' : 'taş atsın'}` : '-');

    $('#newHandBtn').hidden = !(game.finished && room.hostId === myId);

    reconcileRack(game.myHand || []);
    renderRack();
    renderBadges(seat);

    const turnKey = game.turnIndex + ':' + game.phase;
    if (turnKey !== prevTurnKey) {
      prevTurnKey = turnKey;
      startVisualTurnTimer(seat);
    }

    if (game.finished) showGameEndModal();
    else { gameEndModal.hidden = true; gameEndModalShownFor = null; }
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
  // Kaydırma / zoom engelleme (tam ekran hissi)
  // ============================================================
  document.addEventListener('touchmove', e => {
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

  // Sayfa her yenilendiğinde ana menüye düşer (state saklanmaz).
  showView('lobby');
})();
