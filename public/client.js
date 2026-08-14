
    const COLORS = ['black', 'red', 'blue', 'yellow'];
    let deck = [];
    let gosterge = null;
    let okeyTile = null;

    let players = [[], [], [], []];
    let lastDiscards = [null, null, null, null];
    let currentTurn = 0;
    let startingPlayer = 0;
    let drawnThisTurn = false;
    let selectedSlotIndex = null;
    
    let draggedIndices = [];
    let isLongPress = false;
    let longPressTimer = null;

    let isMouseSelecting = false;
    let dragSelectStart = null;

    let totalRoundsPlayed = 0;
    let isGameOver = false;
    let rackSlots = new Array(32).fill(null);

    let turnTimer = null;
    let soundEnabled = true;

    const botNamePool = ["Kadir", "Mert", "Ece", "Barış", "Selin", "Kerem", "Deniz", "Burak", "Zeynep", "Can", "Melis"];
    let playerNames = ["Alya (Siz)", "Kemal", "Gamze", "Deniz"];

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;

    function randomizeBotNames() {
        let shuffled = [...botNamePool].sort(() => 0.5 - Math.random());
        playerNames[1] = shuffled[0];
        playerNames[2] = shuffled[1];
        playerNames[3] = shuffled[2];

        document.getElementById('name-player').innerText = playerNames[0];
        document.getElementById('name-right').innerText = playerNames[1];
        document.getElementById('name-top').innerText = playerNames[2];
        document.getElementById('name-left').innerText = playerNames[3];
    }

    function animateTileFly(srcRect, dstRect, tileData, onComplete, isClosed = false) {
        if (!srcRect || !dstRect) {
            if (onComplete) onComplete();
            return;
        }

        const clone = isClosed ? createClosedTileElement() : createTileElement(tileData);
        if (!clone) {
            if (onComplete) onComplete();
            return;
        }

        clone.style.position = 'fixed';
        clone.style.top = srcRect.top + 'px';
        clone.style.left = srcRect.left + 'px';
        clone.style.width = srcRect.width + 'px';
        clone.style.height = srcRect.height + 'px';
        clone.style.zIndex = '99999';
        clone.style.pointerEvents = 'none';
        clone.style.transition = 'all 0.32s cubic-bezier(0.25, 1, 0.5, 1)';
        clone.style.margin = '0';
        clone.style.boxShadow = '0 8px 20px rgba(0,0,0,0.6)';

        document.body.appendChild(clone);
        clone.getBoundingClientRect();

        clone.style.top = dstRect.top + 'px';
        clone.style.left = dstRect.left + 'px';
        if (dstRect.width && dstRect.height) {
            clone.style.width = dstRect.width + 'px';
            clone.style.height = dstRect.height + 'px';
        }

        setTimeout(() => {
            clone.remove();
            if (onComplete) onComplete();
        }, 330);
    }

    function createClosedTileElement() {
        const el = document.createElement('div');
        el.className = 'tile tile-back';
        return el;
    }

    function playSound(type) {
        if (!soundEnabled) return;
        if (!audioCtx) audioCtx = new AudioContext();
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
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'draw') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(350, now);
            osc.frequency.exponentialRampToValueAtTime(580, now + 0.07);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.07);
            osc.start(now);
            osc.stop(now + 0.07);
        }
    }

    function toggleSound() {
        soundEnabled = !soundEnabled;
        document.getElementById('sound-icon').innerText = soundEnabled ? '🔊' : '🔇';
        document.getElementById('sound-text').innerText = soundEnabled ? 'Ses: AÇIK' : 'Ses: KAPALI';
    }

    function setCustomDragImage(e, tileOrTiles) {
        let tiles = Array.isArray(tileOrTiles) ? tileOrTiles : [tileOrTiles];
        if (!tiles || tiles.length === 0) return;

        let container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            top: -9999px;
            left: -9999px;
            display: flex;
            flex-direction: row;
            gap: 3px;
            pointer-events: none;
            background: transparent;
        `;

        tiles.forEach(tileObj => {
            let ghost = document.createElement('div');
            ghost.className = 'tile';
            ghost.style.position = 'relative';
            ghost.style.transform = 'none';
            ghost.style.margin = '0';
            ghost.style.flexShrink = '0';

            if (!tileObj) {
                ghost.classList.add('tile-back');
            } else {
                let displayColor = tileObj.isSahte ? okeyTile.color : tileObj.color;
                let displayValue = tileObj.isSahte ? okeyTile.value : tileObj.value;
                ghost.classList.add(displayColor);

                let isRealOkey = (!tileObj.isSahte && tileObj.color === okeyTile.color && tileObj.value === okeyTile.value);
                if (isRealOkey || tileObj.isOkeyBadge) {
                    ghost.innerHTML = `<span>${displayValue}</span><span style="font-size:12px; color:#2e7d32;">★</span>`;
                } else {
                    ghost.innerText = displayValue;
                }
            }
            container.appendChild(ghost);
        });

        document.body.appendChild(container);

        if (e.dataTransfer && e.dataTransfer.setDragImage) {
            e.dataTransfer.setDragImage(container, 20, 28);
        }

        setTimeout(() => {
            if (container.parentNode) container.remove();
        }, 100);
    }

    function clearSlotHighlights() {
        document.querySelectorAll('.rack-slot.hovered').forEach(s => s.classList.remove('hovered'));
        document.querySelectorAll('.tile.group-highlight').forEach(t => t.classList.remove('group-highlight'));
    }

    function highlightTargetSlots(startIndex) {
        clearSlotHighlights();
        let count = draggedIndices.length > 0 ? draggedIndices.length : 1;
        let rowEnd = startIndex < 16 ? 16 : 32;

        for (let offset = 0; offset < count; offset++) {
            let targetIdx = startIndex + offset;
            if (targetIdx < rowEnd) {
                const s = document.querySelectorAll('.rack-slot')[targetIdx];
                if (s) s.classList.add('hovered');
            }
        }
    }

    function initGame() {
        totalRoundsPlayed = 0;
        isGameOver = false;
        randomizeBotNames();
        createDeck();
        shuffle(deck);
        determineOkey();
        dealTiles();
        renderRack();
        setupDiscardDropZone();
        setupDeckDrag();
        setupFinishZoneDrag();
        setupGlobalMouseEvents();
        updateUI();

        if (currentTurn === 0) {
            setStatus("Oyun başladı! Oyuna siz başlıyorsunuz (15 taşınız var). Taş çekmeden bir taş atın.");
            startTurnTimer();
        } else {
            setStatus(`Oyun başladı! Oyuna ${playerNames[currentTurn]} başlıyor...`);
            startTurnTimer();
            setTimeout(botStartPlay, 1600);
        }
    }

    function setupGlobalMouseEvents() {
        window.addEventListener('mouseup', () => {
            isMouseSelecting = false;
            dragSelectStart = null;
        });
    }

    function createDeck() {
        deck = [];
        let id = 1;
        COLORS.forEach(color => {
            for (let num = 1; num <= 13; num++) {
                deck.push({ id: id++, color, value: num });
                deck.push({ id: id++, color, value: num });
            }
        });
        deck.push({ id: id++, color: 'black', value: '★', isSahte: true });
        deck.push({ id: id++, color: 'black', value: '★', isSahte: true });
    }

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    function determineOkey() {
        let validIdx = deck.findIndex(t => !t.isSahte);
        gosterge = deck.splice(validIdx, 1)[0];

        let okeyVal = gosterge.value === 13 ? 1 : gosterge.value + 1;
        okeyTile = { color: gosterge.color, value: okeyVal };

        const gHolder = document.getElementById('gosterge-holder');
        gHolder.innerHTML = '';
        gHolder.appendChild(createTileElement(gosterge));

        const oHolder = document.getElementById('okey-holder');
        oHolder.innerHTML = '';
        let okeyDisplayTile = { color: okeyTile.color, value: okeyTile.value, isOkeyBadge: true };
        oHolder.appendChild(createTileElement(okeyDisplayTile));
    }

    function dealTiles() {
        rackSlots.fill(null);
        players = [[], [], [], []];

        startingPlayer = Math.floor(Math.random() * 4);
        currentTurn = startingPlayer;

        for (let p = 0; p < 4; p++) {
            let count = (p === startingPlayer) ? 15 : 14;
            if (p === 0) {
                for (let i = 0; i < count; i++) {
                    rackSlots[i] = deck.pop();
                }
            } else {
                for (let i = 0; i < count; i++) {
                    players[p].push(deck.pop());
                }
            }
        }

        drawnThisTurn = true;
    }

    function setupDeckDrag() {
        const deckTile = document.getElementById('deck-tile');
        deckTile.addEventListener('dragstart', (e) => {
            if (currentTurn !== 0 || drawnThisTurn || isGameOver) {
                e.preventDefault();
                return;
            }
            draggedIndices = [];
            e.dataTransfer.setData('action', 'draw-deck');
            setCustomDragImage(e, null);
            document.getElementById('rack-container').classList.add('drag-active');
            playSound('tile');
        });

        deckTile.addEventListener('dragend', () => {
            document.getElementById('rack-container').classList.remove('drag-active');
        });
    }

    function setupFinishZoneDrag() {
        const finishZone = document.getElementById('finish-drop-zone');

        finishZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (currentTurn === 0 && drawnThisTurn) {
                finishZone.classList.add('drag-over');
            }
        });

        finishZone.addEventListener('dragleave', () => {
            finishZone.classList.remove('drag-over');
        });

        finishZone.addEventListener('drop', (e) => {
            e.preventDefault();
            finishZone.classList.remove('drag-over');

            if (currentTurn !== 0 || !drawnThisTurn) return;

            let action = e.dataTransfer.getData('action');
            if (action === 'move-rack' && draggedIndices.length > 0) {
                selectedSlotIndex = draggedIndices[0];
                finishGame();
            }
        });
    }

    function getContiguousBlock(slotIndex) {
        let rowStart = slotIndex < 16 ? 0 : 16;
        let rowEnd = rowStart + 16;
        
        let start = slotIndex;
        let end = slotIndex;

        while (start > rowStart && rackSlots[start - 1] !== null) {
            start--;
        }
        while (end < rowEnd - 1 && rackSlots[end + 1] !== null) {
            end++;
        }

        let indices = [];
        for (let i = start; i <= end; i++) {
            indices.push(i);
        }
        return indices;
    }

    function selectRangeSlots(startIdx, endIdx) {
        let min = Math.min(startIdx, endIdx);
        let max = Math.max(startIdx, endIdx);
        
        let rowStart = startIdx < 16 ? 0 : 16;
        let rowEnd = rowStart + 15;
        min = Math.max(min, rowStart);
        max = Math.min(max, rowEnd);

        draggedIndices = [];
        for (let i = min; i <= max; i++) {
            if (rackSlots[i] !== null) {
                draggedIndices.push(i);
            }
        }

        renderRack();
    }

    function createTileElement(tile, slotIndex = null) {
        if (!tile) return null;
        const el = document.createElement('div');

        let displayColor = tile.isSahte ? okeyTile.color : tile.color;
        let displayValue = tile.isSahte ? okeyTile.value : tile.value;

        el.className = `tile ${displayColor}`;

        let isRealOkey = (!tile.isSahte && tile.color === okeyTile.color && tile.value === okeyTile.value);

        if (isRealOkey || tile.isOkeyBadge) {
            el.innerHTML = `<span>${displayValue}</span><span style="font-size:12px; color:#2e7d32;">★</span>`;
        } else {
            el.innerText = displayValue;
        }

        if (slotIndex !== null) {
            el.draggable = true;

            el.addEventListener('mousedown', (e) => {
                isLongPress = false;
                isMouseSelecting = true;
                dragSelectStart = slotIndex;

                longPressTimer = setTimeout(() => {
                    isLongPress = true;
                    let block = getContiguousBlock(slotIndex);
                    draggedIndices = block;
                    renderRack();
                }, 220);
            });

            el.addEventListener('mouseenter', () => {
                if (isMouseSelecting && dragSelectStart !== null && dragSelectStart !== slotIndex) {
                    clearTimeout(longPressTimer);
                    selectRangeSlots(dragSelectStart, slotIndex);
                }
            });

            el.addEventListener('mouseup', () => {
                clearTimeout(longPressTimer);
                isMouseSelecting = false;
            });

            el.addEventListener('mouseleave', () => clearTimeout(longPressTimer));

            el.addEventListener('dragstart', (e) => {
                clearTimeout(longPressTimer);
                isMouseSelecting = false;

                let currentlySelected = [];
                document.querySelectorAll('.rack-slot').forEach((s, idx) => {
                    if (s.firstChild && (s.firstChild.classList.contains('selected') || s.firstChild.classList.contains('group-highlight'))) {
                        currentlySelected.push(idx);
                    }
                });

                if (currentlySelected.includes(slotIndex) && currentlySelected.length > 1) {
                    draggedIndices = currentlySelected;
                } else if (draggedIndices.length > 1 && draggedIndices.includes(slotIndex)) {
                    // Seçili aralık korundu
                } else if (isLongPress) {
                    draggedIndices = getContiguousBlock(slotIndex);
                } else {
                    draggedIndices = [slotIndex];
                }

                draggedIndices.forEach(idx => {
                    const slot = document.querySelectorAll('.rack-slot')[idx];
                    if (slot && slot.firstChild) slot.firstChild.classList.add('selected');
                });

                let draggedTiles = draggedIndices.map(idx => rackSlots[idx]);
                setCustomDragImage(e, draggedTiles);

                e.dataTransfer.setData('action', 'move-rack');
                playSound('tile');
            });

            el.addEventListener('dragend', () => {
                isLongPress = false;
                isMouseSelecting = false;
                clearTimeout(longPressTimer);
                clearSlotHighlights();
                renderRack();
            });

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (draggedIndices.length > 1) {
                    draggedIndices = [];
                }
                selectSlot(slotIndex);
            });

            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (currentTurn === 0 && drawnThisTurn && !isGameOver) {
                    selectedSlotIndex = slotIndex;
                    discardSelectedTile();
                }
            });
        }

        return el;
    }

    function renderRack() {
        const row1 = document.getElementById('rack-row-1');
        const row2 = document.getElementById('rack-row-2');
        row1.innerHTML = '';
        row2.innerHTML = '';

        for (let i = 0; i < 32; i++) {
            const slot = document.createElement('div');
            slot.className = 'rack-slot';
            slot.dataset.index = i;

            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                highlightTargetSlots(i);
            });

            slot.addEventListener('dragleave', () => clearSlotHighlights());

            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                clearSlotHighlights();
                document.getElementById('rack-container').classList.remove('drag-active');

                let action = e.dataTransfer.getData('action');

                if (action === 'draw-deck') {
                    drawFromDeck(i);
                } else if (action === 'draw-discard') {
                    drawFromLeftDiscard(i);
                } else if (draggedIndices.length > 0) {
                    moveTileToExactSlot(draggedIndices, i);
                    draggedIndices = [];
                    selectedSlotIndex = null;
                    playSound('tile');
                    renderRack();
                }
            });

            slot.addEventListener('click', () => selectSlot(i));

            if (rackSlots[i]) {
                const tileEl = createTileElement(rackSlots[i], i);
                if (selectedSlotIndex === i || draggedIndices.includes(i)) {
                    tileEl.classList.add('selected');
                }
                slot.appendChild(tileEl);
            }

            if (i < 16) row1.appendChild(slot);
            else row2.appendChild(slot);
        }
    }

    function moveTileToExactSlot(sourceIndices, targetIndex) {
        if (sourceIndices.length === 1 && sourceIndices[0] === targetIndex) return;

        let rowStart = targetIndex < 16 ? 0 : 16;
        let rowEnd = rowStart + 16;

        let movingTiles = sourceIndices.map(idx => rackSlots[idx]);
        
        sourceIndices.forEach(idx => {
            rackSlots[idx] = null;
        });

        let currentTargetTile = rackSlots[targetIndex];
        
        if (sourceIndices.length === 1 && currentTargetTile !== null) {
            rackSlots[targetIndex] = movingTiles[0];
            rackSlots[sourceIndices[0]] = currentTargetTile;
        } else {
            let cursor = targetIndex;
            for (let i = 0; i < movingTiles.length; i++) {
                if (cursor < rowEnd) {
                    let existing = rackSlots[cursor];
                    rackSlots[cursor] = movingTiles[i];
                    
                    if (existing !== null) {
                        let emptyIdx = rackSlots.findIndex((s, sIdx) => s === null && sIdx >= rowStart && sIdx < rowEnd);
                        if (emptyIdx !== -1) {
                            rackSlots[emptyIdx] = existing;
                        }
                    }
                    cursor++;
                }
            }
        }
    }

    function selectSlot(index) {
        playSound('tile');
        draggedIndices = [];
        if (selectedSlotIndex === null) {
            if (rackSlots[index]) selectedSlotIndex = index;
        } else if (selectedSlotIndex === index) {
            selectedSlotIndex = null;
        } else {
            let temp = rackSlots[selectedSlotIndex];
            rackSlots[selectedSlotIndex] = rackSlots[index];
            rackSlots[index] = temp;
            selectedSlotIndex = null;
        }
        renderRack();
    }

    function setupDiscardDropZone() {
        const pSpot = document.getElementById('discard-player-spot');
        pSpot.addEventListener('dragover', (e) => e.preventDefault());
        pSpot.addEventListener('drop', (e) => {
            e.preventDefault();
            if (currentTurn === 0 && drawnThisTurn && draggedIndices.length > 0) {
                selectedSlotIndex = draggedIndices[0];
                discardSelectedTile();
            }
        });
    }

    function checkDeckEmpty() {
        clearInterval(turnTimer);
        isGameOver = true;
        showEndModal("⚠️ TAŞ BİTTİ!", "Destede taş kalmadı ve alınabilecek atık taş da yok! Oyun berabere sona erdi.");
        return true;
    }

    function canCurrentPlayerDraw() {
        if (deck.length > 0) return true;
        let prevIdx = (currentTurn + 3) % 4;
        return !!lastDiscards[prevIdx];
    }

    function drawFromDeck(targetSlotIdx = null) {
        if (isGameOver) return;
        if (currentTurn !== 0) return setStatus("Sıra sizde değil!");
        if (drawnThisTurn) return setStatus("Zaten taş çektiniz! Bir taş atmalısınız.");

        if (deck.length === 0) {
            return setStatus("Deste bitti! Soldan (varsa) atık taşını almayı deneyin.");
        }

        let drawn = deck.pop();
        let emptyIdx = (targetSlotIdx !== null && rackSlots[targetSlotIdx] === null) 
                       ? targetSlotIdx 
                       : rackSlots.findIndex(s => s === null);

        if (emptyIdx !== -1) {
            const deckTile = document.getElementById('deck-tile');
            const srcRect = deckTile.getBoundingClientRect();
            const dstRect = document.querySelectorAll('.rack-slot')[emptyIdx].getBoundingClientRect();

            rackSlots[emptyIdx] = drawn;
            drawnThisTurn = true;
            playSound('draw');

            renderRack();
            updateUI();

            animateTileFly(srcRect, dstRect, drawn, () => {
                if (deck.length === 0) {
                    checkDeckEmpty();
                    return;
                }
                startTurnTimer();
                setStatus("Ortadan taş çekildi. Bir taş seçip atın veya atık alanına bırakın.");
            });
        }
    }

    function drawFromLeftDiscard(targetSlotIdx = null) {
        if (isGameOver) return;
        if (currentTurn !== 0) return setStatus("Sıra sizde değil!");
        if (drawnThisTurn) return setStatus("Zaten taş çektiniz!");
        if (!lastDiscards[3]) return setStatus(`${playerNames[3]} henüz taş atmadı!`);

        let emptyIdx = (targetSlotIdx !== null && rackSlots[targetSlotIdx] === null) 
                       ? targetSlotIdx 
                       : rackSlots.findIndex(s => s === null);

        if (emptyIdx !== -1) {
            let drawnTile = lastDiscards[3];
            const leftSpot = document.getElementById('discard-left-spot');
            const srcRect = leftSpot.getBoundingClientRect();
            const dstRect = document.querySelectorAll('.rack-slot')[emptyIdx].getBoundingClientRect();

            rackSlots[emptyIdx] = drawnTile;
            lastDiscards[3] = null;
            drawnThisTurn = true;
            playSound('draw');

            renderRack();
            updateUI();

            animateTileFly(srcRect, dstRect, drawnTile, () => {
                if (deck.length === 0 && !canCurrentPlayerDraw()) {
                    checkDeckEmpty();
                    return;
                }
                startTurnTimer();
                setStatus(`${playerNames[3]}'in attığı taş alındı! Şimdi bir taş atın.`);
            });
        }
    }

    function discardSelectedTile() {
        if (isGameOver) return;
        if (currentTurn !== 0) return setStatus("Sıra sizde değil!");
        if (!drawnThisTurn) return setStatus("Önce ortadan veya soldan taş çekmelisiniz!");
        
        if (selectedSlotIndex === null || !rackSlots[selectedSlotIndex]) {
            return setStatus("Atmak için önce ıstakanızdan bir taş seçin veya taşa çift tıklayın!");
        }

        let discarded = rackSlots[selectedSlotIndex];
        let dstSpot = document.getElementById('discard-player-spot');
        const srcRect = document.querySelectorAll('.rack-slot')[selectedSlotIndex].getBoundingClientRect();
        const dstRect = dstSpot.getBoundingClientRect();

        rackSlots[selectedSlotIndex] = null;
        selectedSlotIndex = null;
        draggedIndices = [];
        drawnThisTurn = false;
        lastDiscards[0] = discarded;

        playSound('tile');
        renderRack();

        animateTileFly(srcRect, dstRect, discarded, () => {
            dstSpot.innerHTML = '';
            dstSpot.appendChild(createTileElement(discarded));
            
            if (deck.length === 0 && !canCurrentPlayerDraw()) {
                checkDeckEmpty();
                return;
            }

            nextTurn();
        });
    }

    function nextTurn() {
        if (isGameOver) return;
        currentTurn = (currentTurn + 1) % 4;
        drawnThisTurn = false;
        totalRoundsPlayed++;
        updateUI();

        if (deck.length === 0 && !canCurrentPlayerDraw()) {
            checkDeckEmpty();
            return;
        }

        startTurnTimer();

        if (currentTurn !== 0) {
            setStatus(`${playerNames[currentTurn]} düşünüyor...`);
            let botThinkingTime = Math.random() < 0.2 ? 200 : Math.floor(Math.random() * 1000) + 800;
            setTimeout(botPlay, botThinkingTime);
        } else {
            setStatus("Sıra sizde! Ortadan/soldan taş çekin.");
        }
    }

    function botStartPlay() {
        if (isGameOver) return;
        let botIdx = currentTurn;
        let botHand = players[botIdx];

        let worstIdx = findWorstTileIndex(botHand);
        let checkHand = botHand.filter((_, idx) => idx !== worstIdx);
        let winCheck = validateOkeyHand(checkHand);

        if (winCheck.valid) {
            clearInterval(turnTimer);
            isGameOver = true;
            showEndModal("❌ OYUN BİTTİ", `${playerNames[botIdx]} oyunu bitirdi ve kazandı!`);
            return;
        }

        let discarded = botHand.splice(worstIdx, 1)[0];
        lastDiscards[botIdx] = discarded;

        let spotId = getSpotIdByPlayerIndex(botIdx);
        let spot = document.getElementById(spotId);

        let seats = ['seat-bottom', 'seat-right', 'seat-top', 'seat-left'];
        let srcSeat = document.getElementById(seats[botIdx]);
        const srcRect = srcSeat.getBoundingClientRect();
        const dstRect = spot.getBoundingClientRect();

        playSound('tile');

        animateTileFly(srcRect, dstRect, discarded, () => {
            spot.innerHTML = '';
            spot.appendChild(createTileElement(discarded));

            if (deck.length === 0 && !canCurrentPlayerDraw()) {
                checkDeckEmpty();
                return;
            }

            nextTurn();
        });
    }

    function botPlay() {
        if (isGameOver) return;
        let botIdx = currentTurn;
        let botHand = players[botIdx];
        let prevPlayerIdx = (botIdx + 3) % 4;

        let leftDiscard = lastDiscards[prevPlayerIdx];
        let drawDuration = Math.random() < 0.15 ? 0 : Math.floor(Math.random() * 400) + 300;

        let performDrawAction = () => {
            if (deck.length > 0) {
                if (leftDiscard && isUsefulForBot(botHand, leftDiscard)) {
                    botHand.push(leftDiscard);
                    lastDiscards[prevPlayerIdx] = null;
                    document.getElementById(getSpotIdByPlayerIndex(prevPlayerIdx)).innerHTML = '';
                    playSound('draw');
                } else {
                    botHand.push(deck.pop());
                    playSound('draw');
                }
            } else if (leftDiscard) {
                botHand.push(leftDiscard);
                lastDiscards[prevPlayerIdx] = null;
                document.getElementById(getSpotIdByPlayerIndex(prevPlayerIdx)).innerHTML = '';
                playSound('draw');
            } else {
                checkDeckEmpty();
                return;
            }

            let worstIdx = findWorstTileIndex(botHand);
            let checkHand = botHand.filter((_, idx) => idx !== worstIdx);
            let winCheck = validateOkeyHand(checkHand);

            if (winCheck.valid) {
                clearInterval(turnTimer);
                isGameOver = true;
                showEndModal("❌ OYUN BİTTİ", `${playerNames[botIdx]} oyunu bitirdi ve kazandı!`);
                return;
            }

            let discarded = botHand.splice(worstIdx, 1)[0];
            lastDiscards[botIdx] = discarded;

            let spotId = getSpotIdByPlayerIndex(botIdx);
            let spot = document.getElementById(spotId);

            let seats = ['seat-bottom', 'seat-right', 'seat-top', 'seat-left'];
            let srcSeat = document.getElementById(seats[botIdx]);
            const srcRect2 = srcSeat.getBoundingClientRect();
            const dstRect2 = spot.getBoundingClientRect();

            playSound('tile');

            animateTileFly(srcRect2, dstRect2, discarded, () => {
                spot.innerHTML = '';
                spot.appendChild(createTileElement(discarded));

                if (deck.length === 0 && !canCurrentPlayerDraw()) {
                    checkDeckEmpty();
                    return;
                }

                nextTurn();
            });
        };

        if (drawDuration > 0 && deck.length > 0) {
            let deckTileEl = document.getElementById('deck-tile');
            let seats = ['seat-bottom', 'seat-right', 'seat-top', 'seat-left'];
            let targetSeatEl = document.getElementById(seats[botIdx]);
            
            animateTileFly(deckTileEl.getBoundingClientRect(), targetSeatEl.getBoundingClientRect(), null, () => {
                performDrawAction();
            }, true);
        } else {
            performDrawAction();
        }
    }

    function isUsefulForBot(hand, tile) {
        if (Math.random() > 0.4) return false;

        let val = tile.isSahte ? okeyTile.value : tile.value;
        let col = tile.isSahte ? okeyTile.color : tile.color;
        let matchCount = 0;

        for (let t of hand) {
            let tVal = t.isSahte ? okeyTile.value : t.value;
            let tCol = t.isSahte ? okeyTile.color : t.color;

            if (tCol === col && Math.abs(tVal - val) <= 1) matchCount++;
            if (tVal === val) matchCount++;
        }
        return matchCount >= 3;
    }

    function findWorstTileIndex(hand) {
        let scores = hand.map((tile, idx) => {
            if (!tile.isSahte && tile.color === okeyTile.color && tile.value === okeyTile.value) return 999;
            let val = tile.isSahte ? okeyTile.value : tile.value;
            let col = tile.isSahte ? okeyTile.color : tile.color;
            let score = 0;

            hand.forEach((other, oIdx) => {
                if (idx === oIdx) return;
                let oVal = other.isSahte ? okeyTile.value : other.value;
                let oCol = other.isSahte ? okeyTile.color : other.color;

                if (col === oCol && Math.abs(val - oVal) === 1) score += 3;
                if (val === oVal && col !== oCol) score += 3;
                if (val === oVal && col === oCol) score += 2;
            });
            return score;
        });

        let minScore = Math.min(...scores);
        return scores.indexOf(minScore);
    }

    function sortSeri() {
        let tiles = rackSlots.filter(t => t !== null);
        if (tiles.length === 0) return;

        let items = tiles.map(t => {
            let isOkey = (!t.isSahte && t.color === okeyTile.color && t.value === okeyTile.value);
            return {
                tile: t,
                color: t.isSahte ? okeyTile.color : t.color,
                value: t.isSahte ? okeyTile.value : t.value,
                isOkey: isOkey,
                id: t.id
            };
        });

        let bestResult = findBestPerCombination(items);
        let organizedLeftovers = organizeRemaining(bestResult.remaining);

        rackSlots.fill(null);
        let slotIdx = 0;

        bestResult.pers.forEach(per => {
            if (slotIdx + per.length > 32) return;
            per.forEach(item => {
                rackSlots[slotIdx++] = item.tile;
            });
            slotIdx++;
        });

        organizedLeftovers.forEach(group => {
            if (slotIdx < 16 && slotIdx + group.length > 16) {
                slotIdx = 16;
            }
            if (slotIdx + group.length <= 32) {
                group.forEach(item => {
                    rackSlots[slotIdx++] = item.tile;
                });
                slotIdx++;
            }
        });

        selectedSlotIndex = null;
        draggedIndices = [];
        playSound('tile');
        renderRack();
    }

    function findBestPerCombination(items) {
        let allValidPers = [];

        let byColor = {};
        COLORS.forEach(c => byColor[c] = []);
        items.forEach(it => {
            if (byColor[it.color]) byColor[it.color].push(it);
        });

        COLORS.forEach(col => {
            let list = byColor[col];
            list.sort((a,b) => a.value - b.value);

            function findRuns(startIndex, currentRun) {
                if (currentRun.length >= 3) {
                    allValidPers.push([...currentRun]);
                }
                if (currentRun.length >= 5) return;

                let lastVal = currentRun[currentRun.length - 1].value;
                for (let i = startIndex; i < list.length; i++) {
                    if (list[i].value === lastVal + 1) {
                        findRuns(i + 1, [...currentRun, list[i]]);
                    }
                }
            }

            for (let i = 0; i < list.length; i++) {
                findRuns(i + 1, [list[i]]);
            }

            let tile12 = list.find(t => t.value === 12);
            let tile13 = list.find(t => t.value === 13);
            let tile1 = list.find(t => t.value === 1);
            if (tile12 && tile13 && tile1) {
                allValidPers.push([tile12, tile13, tile1]);
            }
        });

        for (let val = 1; val <= 13; val++) {
            let sameVal = items.filter(it => it.value === val);
            let colorMap = {};
            sameVal.forEach(it => {
                if (!colorMap[it.color]) colorMap[it.color] = [];
                colorMap[it.color].push(it);
            });

            let availableColors = Object.keys(colorMap);
            if (availableColors.length >= 3) {
                function getGroupCombos(colorIdx, currentGroup) {
                    if (currentGroup.length >= 3) {
                        allValidPers.push([...currentGroup]);
                    }
                    if (currentGroup.length === 4 || colorIdx >= availableColors.length) return;

                    let c = availableColors[colorIdx];
                    colorMap[c].forEach(tile => {
                        getGroupCombos(colorIdx + 1, [...currentGroup, tile]);
                    });
                    getGroupCombos(colorIdx + 1, currentGroup);
                }
                getGroupCombos(0, []);
            }
        }

        let maxTiles = -1;
        let bestPers = [];
        const EXHAUSTIVE_SEARCH_LIMIT = 16;

        if (allValidPers.length <= EXHAUSTIVE_SEARCH_LIMIT) {
            function searchMaxDisjoint(perIdx, chosenPers, usedItemIds) {
                let tileCount = chosenPers.reduce((acc, p) => acc + p.length, 0);
                if (tileCount > maxTiles) {
                    maxTiles = tileCount;
                    bestPers = [...chosenPers];
                }

                if (perIdx >= allValidPers.length) return;

                searchMaxDisjoint(perIdx + 1, chosenPers, usedItemIds);

                let p = allValidPers[perIdx];
                let canUse = p.every(it => !usedItemIds.has(it.id));
                if (canUse) {
                    let newUsed = new Set(usedItemIds);
                    p.forEach(it => newUsed.add(it.id));
                    searchMaxDisjoint(perIdx + 1, [...chosenPers, p], newUsed);
                }
            }

            searchMaxDisjoint(0, [], new Set());
        } else {
            let sortedPers = [...allValidPers].sort((a, b) => b.length - a.length);
            let usedIds = new Set();
            sortedPers.forEach(p => {
                if (p.every(it => !usedIds.has(it.id))) {
                    bestPers.push(p);
                    p.forEach(it => usedIds.add(it.id));
                }
            });
            maxTiles = bestPers.reduce((acc, p) => acc + p.length, 0);
        }

        let usedIds = new Set();
        bestPers.forEach(p => p.forEach(it => usedIds.add(it.id)));
        let remaining = items.filter(it => !usedIds.has(it.id));

        return { pers: bestPers, remaining };
    }

    function organizeRemaining(remaining) {
        let groups = [];
        let used = new Set();

        for (let i = 0; i < remaining.length; i++) {
            if (used.has(remaining[i].id)) continue;
            for (let j = i + 1; j < remaining.length; j++) {
                if (used.has(remaining[j].id)) continue;
                if (remaining[i].color === remaining[j].color && remaining[i].value === remaining[j].value) {
                    groups.push([remaining[i], remaining[j]]);
                    used.add(remaining[i].id);
                    used.add(remaining[j].id);
                    break;
                }
            }
        }

        for (let i = 0; i < remaining.length; i++) {
            if (used.has(remaining[i].id)) continue;
            for (let j = 0; j < remaining.length; j++) {
                if (i === j || used.has(remaining[j].id)) continue;
                if (remaining[i].color === remaining[j].color && remaining[j].value === remaining[i].value + 1) {
                    groups.push([remaining[i], remaining[j]]);
                    used.add(remaining[i].id);
                    used.add(remaining[j].id);
                    break;
                }
            }
        }

        for (let i = 0; i < remaining.length; i++) {
            if (used.has(remaining[i].id)) continue;
            for (let j = i + 1; j < remaining.length; j++) {
                if (used.has(remaining[j].id)) continue;
                if (remaining[i].value === remaining[j].value && remaining[i].color !== remaining[j].color) {
                    groups.push([remaining[i], remaining[j]]);
                    used.add(remaining[i].id);
                    used.add(remaining[j].id);
                    break;
                }
            }
        }

        let singles = remaining.filter(it => !used.has(it.id));
        singles.sort((a,b) => {
            if (a.color !== b.color) return COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
            return a.value - b.value;
        });

        singles.forEach(s => groups.push([s]));

        return groups;
    }

    function sortByColor() {
        let tiles = rackSlots.filter(t => t !== null);
        tiles.sort((a, b) => {
            let colA = a.isSahte ? okeyTile.color : a.color;
            let colB = b.isSahte ? okeyTile.color : b.color;
            if (colA !== colB) return COLORS.indexOf(colA) - COLORS.indexOf(colB);
            let valA = a.isSahte ? okeyTile.value : a.value;
            let valB = b.isSahte ? okeyTile.value : b.value;
            return valA - valB;
        });
        rackSlots.fill(null);
        let idx = 0;
        tiles.forEach(t => rackSlots[idx++] = t);
        selectedSlotIndex = null;
        draggedIndices = [];
        playSound('tile');
        renderRack();
    }

    function sortByNumber() {
        let tiles = rackSlots.filter(t => t !== null);
        tiles.sort((a, b) => {
            let valA = a.isSahte ? okeyTile.value : a.value;
            let valB = b.isSahte ? okeyTile.value : b.value;
            if (valA !== valB) return valA - valB;
            let colA = a.isSahte ? okeyTile.color : a.color;
            let colB = b.isSahte ? okeyTile.color : b.color;
            return COLORS.indexOf(colA) - COLORS.indexOf(colB);
        });
        rackSlots.fill(null);
        let idx = 0;
        tiles.forEach(t => rackSlots[idx++] = t);
        selectedSlotIndex = null;
        draggedIndices = [];
        playSound('tile');
        renderRack();
    }

    function finishGame() {
        if (isGameOver) return;
        if (currentTurn !== 0) return setStatus("Sıra sizde değil!");
        if (!drawnThisTurn) return setStatus("Bitmek için önce ortadan veya soldan taş çekmelisiniz!");
        if (selectedSlotIndex === null || !rackSlots[selectedSlotIndex]) {
            return setStatus("Lütfen ortadaki Bitiş/Okey alanına atacağınız bitiş taşını sürükleyin veya seçin!");
        }

        let handTiles = rackSlots.filter((t, idx) => t !== null && idx !== selectedSlotIndex);

        if (handTiles.length !== 14) {
            return setStatus("Eliniz bitmek için tam değil! Istakada 14 taş kalmalı.");
        }

        let result = validateOkeyHand(handTiles);

        if (result.valid) {
            clearInterval(turnTimer);
            isGameOver = true;
            let typeMsg = result.type === 'cift' ? "7 Çift ile oyunu kazandınız!" : "Perlerinizi dizerek oyunu kazandınız!";
            showEndModal("🏆 TEBRİKLER!", `Eli başarıyla bitirdiniz! ${typeMsg}`);
        } else {
            setStatus(`❌ Eliniz henüz bitmeye uygun değil! (${result.reason})`);
        }
    }

    function validateOkeyHand(tiles) {
        if (tiles.length !== 14) return { valid: false, reason: "Istakada 14 taş olmalıdır!" };

        if (checkPairsHand(tiles)) {
            return { valid: true, type: 'cift' };
        }

        let sortedTiles = [...tiles].sort((a, b) => {
            let isOkeyA = (!a.isSahte && a.color === okeyTile.color && a.value === okeyTile.value) || a.isSahte;
            let isOkeyB = (!b.isSahte && b.color === okeyTile.color && b.value === okeyTile.value) || b.isSahte;
            if (isOkeyA !== isOkeyB) return isOkeyA ? 1 : -1;
            let colA = a.isSahte ? okeyTile.color : a.color;
            let colB = b.isSahte ? okeyTile.color : b.color;
            if (colA !== colB) return COLORS.indexOf(colA) - COLORS.indexOf(colB);
            let valA = a.isSahte ? okeyTile.value : a.value;
            let valB = b.isSahte ? okeyTile.value : b.value;
            return valA - valB;
        });

        let formatted = sortedTiles.map(t => {
            let isOkey = (!t.isSahte && t.color === okeyTile.color && t.value === okeyTile.value) || t.isSahte;
            return {
                color: t.isSahte ? okeyTile.color : t.color,
                value: t.isSahte ? okeyTile.value : t.value,
                isOkey: isOkey,
                raw: t
            };
        });

        let wildcards = formatted.filter(t => t.isOkey).length;
        let normalTiles = formatted.filter(t => !t.isOkey);

        if (canFormSets(normalTiles, wildcards)) {
            return { valid: true, type: 'normal' };
        }

        return { valid: false, reason: "Taşlarınız nizami per veya 7 çift oluşturmuyor!" };
    }

    function checkPairsHand(tiles) {
        let formatted = tiles.map(t => {
            let isOkey = (!t.isSahte && t.color === okeyTile.color && t.value === okeyTile.value) || t.isSahte;
            return {
                color: t.isSahte ? okeyTile.color : t.color,
                value: t.isSahte ? okeyTile.value : t.value,
                isOkey: isOkey
            };
        });

        let jokers = formatted.filter(t => t.isOkey).length;
        let normals = formatted.filter(t => !t.isOkey);

        let map = {};
        normals.forEach(t => {
            let key = `${t.color}_${t.value}`;
            map[key] = (map[key] || 0) + 1;
        });

        let singlesCount = 0;
        for (let key in map) {
            if (map[key] % 2 !== 0) {
                singlesCount++;
            }
        }

        return jokers >= singlesCount;
    }

    function canFormSets(tiles, wildcards) {
        if (tiles.length === 0) return true;

        for (let size = 3; size <= 5; size++) {
            let combos = getPossiblePerCombos(tiles, size, wildcards);
            for (let combo of combos) {
                let remainingTiles = [...tiles];
                let match = true;
                
                combo.usedTiles.forEach(t => {
                    let idx = remainingTiles.indexOf(t);
                    if (idx !== -1) {
                        remainingTiles.splice(idx, 1);
                    } else {
                        match = false;
                    }
                });

                if (match && canFormSets(remainingTiles, wildcards - combo.usedJokers)) {
                    return true;
                }
            }
        }
        return false;
    }

    function getPossiblePerCombos(tiles, targetSize, jokersAvailable) {
        let result = [];
        if (tiles.length === 0) return result;

        let first = tiles[0];
        let sameColor = tiles.filter(t => t.color === first.color);

        let runCandidates = [first];
        let neededJokers = 0;
        let validRun = true;

        for (let step = 1; step < targetSize; step++) {
            let nextVal = first.value + step;
            if (nextVal > 13) {
                validRun = false;
                break;
            }
            let nextT = sameColor.find(t => t.value === nextVal && !runCandidates.includes(t));
            if (nextT) {
                runCandidates.push(nextT);
            } else {
                neededJokers++;
            }
        }

        if (validRun && neededJokers <= jokersAvailable && (runCandidates.length + neededJokers === targetSize)) {
            result.push({ usedTiles: runCandidates, usedJokers: neededJokers });
        }

        if (targetSize === 3 && (first.value === 12 || first.value === 13 || first.value === 1)) {
            let candidates = [];
            let jokersNeeded = 0;
            [12, 13, 1].forEach(val => {
                let found = sameColor.find(t => t.value === val && !candidates.includes(t));
                if (found) candidates.push(found);
                else jokersNeeded++;
            });

            if (jokersNeeded <= jokersAvailable && candidates.includes(first)) {
                result.push({ usedTiles: candidates, usedJokers: jokersNeeded });
            }
        }

        if (targetSize <= 4) {
            let sameValue = tiles.filter(t => t.value === first.value);
            let uniqueColorMap = {};
            sameValue.forEach(t => {
                if (!uniqueColorMap[t.color]) uniqueColorMap[t.color] = t;
            });
            let otherColorTiles = Object.values(uniqueColorMap).filter(t => t !== first);

            function combos(arr, k) {
                let out = [];
                function helper(start, cur) {
                    if (cur.length === k) { out.push([...cur]); return; }
                    for (let i = start; i < arr.length; i++) {
                        cur.push(arr[i]);
                        helper(i + 1, cur);
                        cur.pop();
                    }
                }
                helper(0, []);
                return out;
            }

            let maxOthers = Math.min(otherColorTiles.length, targetSize - 1);
            for (let numOthers = maxOthers; numOthers >= 0; numOthers--) {
                let jokersNeededForGroup = targetSize - 1 - numOthers;
                if (jokersNeededForGroup > jokersAvailable) continue;
                let subsets = numOthers === 0 ? [[]] : combos(otherColorTiles, numOthers);
                subsets.forEach(subset => {
                    result.push({ usedTiles: [first, ...subset], usedJokers: jokersNeededForGroup });
                });
            }
        }

        return result;
    }

    function getSpotIdByPlayerIndex(pIdx) {
        const spots = ['discard-player-spot', 'discard-right-spot', 'discard-top-spot', 'discard-left-spot'];
        return spots[pIdx];
    }

    function startTurnTimer() {
        clearInterval(turnTimer);
        if (isGameOver) return;

        const bars = ['timer-player', 'timer-right', 'timer-top', 'timer-left'];
        bars.forEach(b => document.getElementById(b).style.width = '100%');

        let activeBar = document.getElementById(bars[currentTurn]);
        let width = 100;

        turnTimer = setInterval(() => {
            width -= 2.5;
            if (activeBar) activeBar.style.width = width + '%';

            if (width <= 0) {
                clearInterval(turnTimer);
                if (currentTurn === 0 && !isGameOver) {
                    if (!drawnThisTurn) {
                        if (deck.length > 0) {
                            let drawn = deck.pop();
                            let emptyIdx = rackSlots.findIndex(s => s === null);
                            if (emptyIdx !== -1) {
                                rackSlots[emptyIdx] = drawn;
                                drawnThisTurn = true;
                                playSound('draw');
                                renderRack();
                                updateUI();
                            }
                        } else if (lastDiscards[3]) {
                            let drawnTile = lastDiscards[3];
                            let emptyIdx = rackSlots.findIndex(s => s === null);
                            if (emptyIdx !== -1) {
                                rackSlots[emptyIdx] = drawnTile;
                                lastDiscards[3] = null;
                                drawnThisTurn = true;
                                playSound('draw');
                                renderRack();
                                updateUI();
                            }
                        } else {
                            checkDeckEmpty();
                            return;
                        }
                    }

                    let activeIndices = rackSlots
                        .map((val, idx) => val !== null ? idx : null)
                        .filter(val => val !== null);

                    if (activeIndices.length > 0) {
                        selectedSlotIndex = activeIndices[Math.floor(Math.random() * activeIndices.length)];
                        discardSelectedTile();
                        setStatus("Süreniz bitti! Otomatik taş çekilip atıldı.");
                    }
                }
            }
        }, 350);
    }

    function showEndModal(title, message) {
        document.getElementById('modal-title').innerHTML = title;
        document.getElementById('modal-body').innerHTML = message;
        document.getElementById('game-modal').classList.add('active');
    }

    function newRound() {
        document.getElementById('game-modal').classList.remove('active');
        initGame();
    }

    function updateUI() {
        document.getElementById('deck-count').innerText = deck.length;

        const seats = ['seat-bottom', 'seat-right', 'seat-top', 'seat-left'];
        seats.forEach((s, idx) => {
            const el = document.getElementById(s);
            if (idx === currentTurn) el.classList.add('active-turn');
            else el.classList.remove('active-turn');
        });

        const leftSpot = document.getElementById('discard-left-spot');
        leftSpot.innerHTML = '';

        if (lastDiscards[3]) {
            let tileEl = createTileElement(lastDiscards[3]);
            if (currentTurn === 0 && !drawnThisTurn && !isGameOver) {
                leftSpot.classList.add('takeable');
                tileEl.draggable = true;
                tileEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('action', 'draw-discard');
                    setCustomDragImage(e, lastDiscards[3]);
                    document.getElementById('rack-container').classList.add('drag-active');
                    playSound('tile');
                });
                tileEl.addEventListener('dragend', () => {
                    document.getElementById('rack-container').classList.remove('drag-active');
                });
            } else {
                leftSpot.classList.remove('takeable');
            }
            leftSpot.appendChild(tileEl);
        } else {
            leftSpot.classList.remove('takeable');
        }
    }

    function setStatus(msg) {
        document.getElementById('status-text').innerText = msg;
    }




// ============================================================
// ONLINE / PARTY ADAPTATION
// OYUN EKRANI yukarıdaki VIP HTML/CSS ile birebir korunur.
// Socket.IO sadece state ve hamleleri taşır.
// ============================================================
const socket = io();
let myId = null;
let room = null;
let game = null;
let onlineReady = false;
let lastHandIds = [];
let lastDiscardIds = [null, null, null, null];
let mySeatIndex = null;
let gameBindingsReady = false;

const LOCAL_COLORS = { kirmizi: 'red', sari: 'yellow', mavi: 'blue', siyah: 'black' };
const LOCAL_COLOR_ORDER = ['black','red','blue','yellow'];

function localTile(t) {
    if (!t) return null;
    if (t.joker) return { id: t.id, color: 'black', value: '★', isSahte: true };
    return { id: t.id, color: LOCAL_COLORS[t.color] || t.color, value: t.number };
}

function localSpec(s) {
    if (!s) return null;
    return { color: LOCAL_COLORS[s.color] || s.color, value: s.number };
}

function serverColorToLocal(c) { return LOCAL_COLORS[c] || c; }
function localColorToServer(c) {
    return { red:'kirmizi', yellow:'sari', blue:'mavi', black:'siyah' }[c] || c;
}

function relativeSeat(serverSeat) {
    if (mySeatIndex === null || serverSeat === null || serverSeat === undefined) return null;
    return (serverSeat - mySeatIndex + 4) % 4;
}

function getPlayerBySeat(seat) {
    if (!room || seat === null || seat === undefined) return null;
    const pid = room.seats[seat];
    return pid ? room.players.find(p => p.id === pid) : null;
}

function getMyServerSeat() {
    if (!room) return null;
    const p = room.players.find(p => p.id === myId);
    return p && p.seat !== null && p.seat !== undefined ? p.seat : null;
}

function syncLocalHand() {
    if (!game) return;
    const incoming = (game.myHand || []).map(localTile);
    const incomingById = new Map(incoming.map(t => [t.id, t]));
    const next = new Array(32).fill(null);

    // Mevcut görsel sıralamayı mümkün olduğunca koru.
    for (let i = 0; i < rackSlots.length; i++) {
        const old = rackSlots[i];
        if (old && incomingById.has(old.id)) {
            next[i] = incomingById.get(old.id);
            incomingById.delete(old.id);
        }
    }

    // Yeni gelen taşları ilk boş slotlara koy.
    for (const t of incoming) {
        if (!incomingById.has(t.id)) continue;
        const idx = next.findIndex(x => x === null);
        if (idx === -1) break;
        next[idx] = t;
        incomingById.delete(t.id);
    }

    rackSlots = next;
    lastHandIds = incoming.map(t => t.id);
}

function updateLocalStateFromServer() {
    if (!game) return;
    mySeatIndex = getMyServerSeat();
    currentTurn = mySeatIndex === null ? 0 : relativeSeat(game.turnIndex);
    drawnThisTurn = mySeatIndex !== null && game.turnIndex === mySeatIndex && game.phase === 'discard';
    isGameOver = !!game.finished;

    deck = new Array(Math.max(0, game.deckCount || 0)).fill(null);
    gosterge = localTile(game.indicator);
    okeyTile = localSpec(game.okeySpec);
    lastDiscards = [null, null, null, null];

    const bySeat = game.discardsBySeat || [];
    for (let s = 0; s < 4; s++) {
        const rel = relativeSeat(s);
        if (rel !== null && bySeat[s]) lastDiscards[rel] = localTile(bySeat[s]);
    }

    syncLocalHand();
}

function renderIndicatorAndOkey() {
    const gHolder = document.getElementById('gosterge-holder');
    const oHolder = document.getElementById('okey-holder');
    if (gHolder) {
        gHolder.innerHTML = '';
        if (gosterge) gHolder.appendChild(createTileElement(gosterge));
    }
    if (oHolder) {
        oHolder.innerHTML = '';
        if (okeyTile) oHolder.appendChild(createTileElement({ color: okeyTile.color, value: okeyTile.value, isOkeyBadge: true }));
    }
}

function renderRemotePlayers() {
    const spots = {
        0: ['seat-bottom','name-player','score-player','timer-player'],
        1: ['seat-right','name-right','score-right','timer-right'],
        2: ['seat-top','name-top','score-top','timer-top'],
        3: ['seat-left','name-left','score-left','timer-left']
    };
    for (const rel of [0,1,2,3]) {
        const [seatId,nameId,scoreId] = spots[rel];
        const el = document.getElementById(seatId);
        const nameEl = document.getElementById(nameId);
        const scoreEl = document.getElementById(scoreId);
        if (!el || !nameEl || !scoreEl) continue;
        const serverSeat = mySeatIndex === null ? null : (mySeatIndex + rel) % 4;
        const p = getPlayerBySeat(serverSeat);
        if (p) {
            nameEl.textContent = rel === 0 ? `${p.name} (Siz)` : p.name;
            const count = rel === 0 ? (game?.myHand?.length || 0) : (game?.otherCounts?.[p.id] || 0);
            scoreEl.textContent = `TAŞ: ${count}`;
        } else {
            nameEl.textContent = rel === 0 ? 'Siz' : 'Boş Koltuk';
            scoreEl.textContent = 'TAŞ: 0';
        }
        el.classList.toggle('active-turn', rel === currentTurn && !isGameOver);
    }
}

function renderAllDiscards() {
    const ids = ['discard-player-spot','discard-right-spot','discard-top-spot','discard-left-spot'];
    ids.forEach((id, rel) => {
        const spot = document.getElementById(id);
        if (!spot) return;
        spot.innerHTML = '';
        const t = lastDiscards[rel];
        if (!t) {
            spot.classList.remove('takeable');
            return;
        }
        const el = createTileElement(t);
        if (rel === 3 && currentTurn === 0 && !drawnThisTurn && !isGameOver) {
            spot.classList.add('takeable');
            el.draggable = true;
            el.addEventListener('dragstart', e => {
                e.dataTransfer.setData('action','draw-discard');
                setCustomDragImage(e,t);
                document.getElementById('rack-container').classList.add('drag-active');
                playSound('tile');
            });
            el.addEventListener('dragend', () => document.getElementById('rack-container').classList.remove('drag-active'));
        } else {
            spot.classList.remove('takeable');
        }
        spot.appendChild(el);
    });
}

function onlineCanDraw() {
    return !!game && !game.finished && mySeatIndex !== null && game.turnIndex === mySeatIndex && game.phase === 'draw';
}

function onlineCanDiscard() {
    return !!game && !game.finished && mySeatIndex !== null && game.turnIndex === mySeatIndex && game.phase === 'discard';
}

function animateStateTransition(previousIds, nextIds) {
    const added = nextIds.filter(id => !previousIds.includes(id));
    if (added.length) playSound('draw');
}

function renderOnlineGame() {
    if (!game) return;
    updateLocalStateFromServer();
    renderIndicatorAndOkey();
    renderRemotePlayers();
    renderRack();
    renderAllDiscards();
    updateUI();

    if (game.finished) {
        clearInterval(turnTimer);
        const winner = room?.players?.find(p => p.id === game.winnerId);
        if (winner) {
            showEndModal(winner.id === myId ? '🏆 TEBRİKLER!' : '🏆 OYUN BİTTİ',
                winner.id === myId ? 'Eli başarıyla bitirdiniz!' : `${winner.name} eli bitirdi!`);
        }
        return;
    }

    startTurnTimer();
    if (currentTurn === 0) {
        if (drawnThisTurn) setStatus('Taş çektiniz. Şimdi bir taş seçip atın veya bitirin.');
        else setStatus('Sıra sizde! Ortadan veya soldan taş çekin.');
    } else {
        const p = getPlayerBySeat((mySeatIndex + currentTurn) % 4);
        setStatus(`${p ? p.name : 'Rakip'} düşünüyor...`);
    }
}

function initGame() {
    // Online oyun başladığında çağrılır; yerel deste oluşturulmaz.
    if (!onlineReady) return;
    if (!gameBindingsReady) {
        setupDeckDrag();
        setupFinishZoneDrag();
        setupDiscardDropZone();
        setupGlobalMouseEvents();
        gameBindingsReady = true;
    }
    renderOnlineGame();
}

function drawFromDeck(targetSlotIdx = null) {
    if (!onlineCanDraw()) {
        if (game && mySeatIndex !== null && game.turnIndex !== mySeatIndex) setStatus('Sıra sizde değil!');
        else if (drawnThisTurn) setStatus('Zaten taş çektiniz! Bir taş atmalısınız.');
        return;
    }
    socket.emit('drawTile','deck');
}

function drawFromLeftDiscard(targetSlotIdx = null) {
    if (!onlineCanDraw()) {
        if (drawnThisTurn) setStatus('Zaten taş çektiniz!');
        else setStatus('Sıra sizde değil!');
        return;
    }
    if (!lastDiscards[3]) return setStatus('Sol tarafta alınabilecek atık taş yok!');
    socket.emit('drawTile','discard');
}

function discardSelectedTile() {
    if (!onlineCanDiscard()) {
        if (currentTurn !== 0) setStatus('Sıra sizde değil!');
        else setStatus('Önce bir taş çekmelisiniz!');
        return;
    }
    if (selectedSlotIndex === null || !rackSlots[selectedSlotIndex]) {
        return setStatus('Atmak için önce ıstakanızdan bir taş seçin veya taşa çift tıklayın!');
    }
    const tile = rackSlots[selectedSlotIndex];
    const slot = document.querySelectorAll('.rack-slot')[selectedSlotIndex];
    if (slot) {
        const src = slot.getBoundingClientRect();
        const dst = document.getElementById('discard-player-spot').getBoundingClientRect();
        animateTileFly(src, dst, tile, null);
    }
    socket.emit('discardTile', tile.id);
    selectedSlotIndex = null;
    draggedIndices = [];
}

function finishGame() {
    if (!onlineCanDiscard()) {
        if (currentTurn !== 0) setStatus('Sıra sizde değil!');
        else setStatus('Bitmek için önce taş çekmelisiniz!');
        return;
    }
    if (!rackSlots.filter(Boolean).length || rackSlots.filter(Boolean).length !== 15) {
        return setStatus('Bitiş için elinizde 15 taş olmalı.');
    }
    socket.emit('declareWin');
}

function startTurnTimer() {
    clearInterval(turnTimer);
    if (!game || game.finished) return;
    const bars = ['timer-player','timer-right','timer-top','timer-left'];
    bars.forEach(id => { const el=document.getElementById(id); if(el) el.style.width='100%'; });
    const activeBar = document.getElementById(bars[currentTurn]);
    let width = 100;
    turnTimer = setInterval(() => {
        width -= 2.5;
        if (activeBar) activeBar.style.width = Math.max(0,width)+'%';
        if (width <= 0) clearInterval(turnTimer);
    }, 350);
}

function updateUI() {
    const count = game ? game.deckCount : 0;
    document.getElementById('deck-count').innerText = count;
    renderRemotePlayers();
    renderAllDiscards();
}

function newRound() {
    document.getElementById('game-modal').classList.remove('active');
    if (room && room.hostId === myId) socket.emit('newHand');
    else setStatus('Yeni eli oda kurucusu başlatabilir.');
}

// ---- Online lobby / room ----
function showOnlineError(msg) {
    const el = document.getElementById('onlineError');
    if (el) el.textContent = msg || '';
}
function showGameScreen() {
    document.getElementById('online-lobby').hidden = true;
    document.getElementById('waiting-overlay').hidden = true;
}
function showLobby() {
    document.getElementById('online-lobby').hidden = false;
    document.getElementById('waiting-overlay').hidden = true;
    document.getElementById('game-board').style.visibility = 'hidden';
    document.getElementById('rack-container').style.visibility = 'hidden';
    document.querySelector('.action-bar').style.visibility = 'hidden';
}
function showWaiting() {
    document.getElementById('online-lobby').hidden = true;
    document.getElementById('waiting-overlay').hidden = false;
    document.getElementById('game-board').style.visibility = 'hidden';
    document.getElementById('rack-container').style.visibility = 'hidden';
    document.querySelector('.action-bar').style.visibility = 'hidden';
}
function showActualGame() {
    showGameScreen();
    document.getElementById('game-board').style.visibility = 'visible';
    document.getElementById('rack-container').style.visibility = 'visible';
    document.querySelector('.action-bar').style.visibility = 'visible';
}

function renderWaiting() {
    if (!room) return;
    document.getElementById('waitingCode').textContent = room.code;
    const grid = document.getElementById('seatGrid');
    grid.innerHTML = '';
    for (let i=0;i<4;i++) {
        const pid = room.seats[i];
        const p = pid ? room.players.find(x=>x.id===pid) : null;
        const b = document.createElement('button');
        b.className = 'vip-seat' + (p ? ' occupied':'') + (pid===myId ? ' mine':'');
        b.innerHTML = `<span>KOLTUK ${i+1}</span><strong>${p ? escapeHtml(p.name) : 'BOŞ'}</strong>`;
        b.onclick = () => socket.emit('chooseSeat', i);
        grid.appendChild(b);
    }
    const list = document.getElementById('waitingPlayers');
    list.innerHTML = Object.values(room.players).map(p => `<div>${p.bot?'🤖':'👤'} ${escapeHtml(p.name)}${p.id===room.hostId?' 👑':''}${p.spectator?' · izleyici':''}</div>`).join('');
    const start = document.getElementById('startGame');
    start.hidden = room.hostId !== myId;
    start.disabled = room.seats.filter(Boolean).length !== 4;
}

function escapeHtml(v) { const d=document.createElement('div'); d.textContent=String(v??''); return d.innerHTML; }

function initOnline() {
    showLobby();
    document.getElementById('createTab').onclick = () => {
        document.getElementById('createTab').classList.add('active');
        document.getElementById('joinTab').classList.remove('active');
        document.getElementById('createPanel').hidden = false;
        document.getElementById('joinPanel').hidden = true;
    };
    document.getElementById('joinTab').onclick = () => {
        document.getElementById('joinTab').classList.add('active');
        document.getElementById('createTab').classList.remove('active');
        document.getElementById('createPanel').hidden = true;
        document.getElementById('joinPanel').hidden = false;
    };
    document.getElementById('createRoom').onclick = () => socket.emit('createRoom',{name:document.getElementById('nameCreate').value.trim()||'Oyuncu'});
    document.getElementById('joinRoom').onclick = () => socket.emit('joinRoom',{code:document.getElementById('roomCode').value.trim().toUpperCase(),name:document.getElementById('nameJoin').value.trim()||'Oyuncu'});
    document.getElementById('quickPlay').onclick = () => socket.emit('quickPlay',{name:document.getElementById('nameCreate').value.trim()||'Oyuncu'});
    document.getElementById('spectatorBtn').onclick = () => socket.emit('chooseSeat',null);
    document.getElementById('startGame').onclick = () => socket.emit('startGame');

    socket.on('connect',()=>{ myId=socket.id; });
    socket.on('errorMsg',msg=>{ showOnlineError(msg); setStatus(msg); });
    socket.on('onlineCount',n=>{});
    socket.on('joinedRoom',({code,quick})=>{
        showOnlineError('');
        if (quick) return;
        showWaiting();
    });
    socket.on('roomUpdate',state=>{
        room=state;
        if (!state.gameActive) renderWaiting();
        else showActualGame();
    });
    socket.on('gameUpdate',state=>{
        const prev = lastHandIds.slice();
        game=state;
        onlineReady=true;
        mySeatIndex=getMyServerSeat();
        showActualGame();
        initGame();
        animateStateTransition(prev,(game.myHand||[]).map(t=>t.id));
    });
    socket.on('chatMsg',m=>{
        if (m.system) setStatus(m.text);
    });
    window.addEventListener('beforeunload',()=>socket.disconnect());
}

window.addEventListener('load', initOnline);
