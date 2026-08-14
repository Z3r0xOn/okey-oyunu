(() => {
  const socket = io();
  const $ = s => document.querySelector(s);
  let myId=null, room=null, game=null, mySeatIndex=null;
  let rackSlots=new Array(32).fill(null);
  let selectedSlotIndex=null, draggedIndices=[], pointerDrag=null, longPressTimer=null;
  let soundEnabled=true, audioCtx=null, turnTimer=null, voiceOn=false, localStream=null;
  let pendingDraw=null, pendingDiscard=null, previousGame=null;
  const peerConnections={}, audioEls={};
  const COLOR_CLASS={kirmizi:'red',sari:'yellow',mavi:'blue',siyah:'black'};
  const COLOR_ORDER=['kirmizi','sari','mavi','siyah'];

  function status(msg){ $('#status-text').textContent=msg; }
  function toast(msg){ const el=$('#toast'); el.textContent=msg; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,2800); }
  function esc(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML;}
  function mySeat(){return mySeatIndex;}
  function relSeat(serverSeat){return mySeatIndex==null?null:(serverSeat-mySeatIndex+4)%4;}
  function playerAtSeat(seat){const pid=room?.seats?.[seat];return pid?room.players.find(p=>p.id===pid):null;}
  function localTile(t){return t?{...t}:null;}
  function isOkey(t){return !!t && (t.joker || (game?.okeySpec && t.color===game.okeySpec.color && t.number===game.okeySpec.number));}
  function colorClass(t){return t?.joker?'black':(COLOR_CLASS[t.color]||'black');}

  function playSound(type='tile'){
    if(!soundEnabled)return;
    try{
      if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended')audioCtx.resume();
      const o=audioCtx.createOscillator(),g=audioCtx.createGain(),n=audioCtx.currentTime;o.connect(g);g.connect(audioCtx.destination);
      o.type=type==='draw'?'sine':'triangle';o.frequency.setValueAtTime(type==='draw'?350:220,n);o.frequency.exponentialRampToValueAtTime(type==='draw'?580:110,n+.07);g.gain.setValueAtTime(.12,n);g.gain.linearRampToValueAtTime(.01,n+.07);o.start(n);o.stop(n+.07);
    }catch(_){ }
  }
  function toggleSound(){soundEnabled=!soundEnabled;$('#sound-icon').textContent=soundEnabled?'🔊':'🔇';$('#sound-text').textContent=soundEnabled?'Ses: AÇIK':'Ses: KAPALI';}
  $('#soundBtn').addEventListener('click',toggleSound);

  function createTileElement(tile,slotIndex=null){
    if(!tile) return null;
    const el=document.createElement('div');
    el.className='tile';
    if(tile.joker){ el.classList.add('black'); el.textContent='★'; }
    else { el.classList.add(colorClass(tile)); el.textContent=tile.number; }
    if(isOkey(tile)){
      el.classList.add('okey-mark');
      const star=document.createElement('span');
      star.textContent='★';
      star.style.cssText='font-size:12px;color:#2e7d32;margin-top:-4px';
      el.appendChild(star);
    }

    if(slotIndex!==null){
      el.draggable=true;

      // The original VIP interaction model: click-select/swap, mouse drag,
      // contiguous-group long press, and native drag image.
      el.addEventListener('mousedown',e=>{
        if(e.button!==0)return;
        isLongPress=false;
        isMouseSelecting=true;
        dragSelectStart=slotIndex;
        clearTimeout(longPressTimer);
        longPressTimer=setTimeout(()=>{
          isLongPress=true;
          draggedIndices=getContiguousBlock(slotIndex);
          renderRack();
        },220);
      });

      el.addEventListener('mouseenter',()=>{
        if(isMouseSelecting&&dragSelectStart!==null&&dragSelectStart!==slotIndex){
          clearTimeout(longPressTimer);
          selectRangeSlots(dragSelectStart,slotIndex);
        }
      });

      el.addEventListener('mouseup',()=>{
        clearTimeout(longPressTimer);
        isMouseSelecting=false;
      });
      el.addEventListener('mouseleave',()=>clearTimeout(longPressTimer));

      el.addEventListener('dragstart',e=>{
        clearTimeout(longPressTimer);
        isMouseSelecting=false;

        let currentlySelected=[];
        document.querySelectorAll('.rack-slot').forEach((slot,idx)=>{
          if(slot.firstChild && (slot.firstChild.classList.contains('selected')||slot.firstChild.classList.contains('group-highlight'))){
            currentlySelected.push(idx);
          }
        });

        if(currentlySelected.includes(slotIndex)&&currentlySelected.length>1){
          draggedIndices=currentlySelected;
        }else if(draggedIndices.length>1&&draggedIndices.includes(slotIndex)){
          // Keep selected group.
        }else if(isLongPress){
          draggedIndices=getContiguousBlock(slotIndex);
        }else{
          draggedIndices=[slotIndex];
        }

        draggedIndices.forEach(idx=>{
          const slot=document.querySelector(`.rack-slot[data-index="${idx}"]`);
          if(slot&&slot.firstChild)slot.firstChild.classList.add('selected');
        });

        setCustomDragImage(e,draggedIndices.map(idx=>rackSlots[idx]));
        e.dataTransfer.setData('action','move-rack');
        $('#rack-container').classList.add('drag-active');
        playSound('tile');
      });

      el.addEventListener('dragend',()=>{
        isLongPress=false;
        isMouseSelecting=false;
        clearTimeout(longPressTimer);
        clearSlotHighlights();
        $('#rack-container').classList.remove('drag-active');
        renderRack();
      });

      el.addEventListener('click',e=>{
        e.stopPropagation();
        if(draggedIndices.length>1)draggedIndices=[];
        selectSlot(slotIndex);
      });

      el.addEventListener('dblclick',e=>{
        e.stopPropagation();
        if(canDiscard()){
          selectedSlotIndex=slotIndex;
          discardSelectedTile();
        }
      });

      // Touch fallback: same target-slot/group semantics as the original,
      // without replacing the desktop HTML5 drag behaviour.
      el.addEventListener('pointerdown',e=>{
        if(e.pointerType==='mouse')return;
        e.preventDefault();
        const idx=slotIndex;
        let startX=e.clientX,startY=e.clientY,moved=false,grouped=false;
        clearTimeout(longPressTimer);
        el.classList.add('pressing');
        longPressTimer=setTimeout(()=>{
          grouped=true;
          draggedIndices=getContiguousBlock(idx);
          renderRack();
          $('#rack-container').classList.add('drag-active');
        },220);
        const move=ev=>{
          if(ev.pointerId!==e.pointerId)return;
          const dist=Math.hypot(ev.clientX-startX,ev.clientY-startY);
          if(dist>7&&!moved){moved=true;clearTimeout(longPressTimer);if(!grouped)draggedIndices=[idx];$('#rack-container').classList.add('drag-active');}
          if(moved||grouped){ev.preventDefault();highlightTouchTarget(ev.clientX,ev.clientY);}
        };
        const up=ev=>{
          if(ev.pointerId!==e.pointerId)return;
          clearTimeout(longPressTimer);el.classList.remove('pressing');
          if(moved||grouped){
            const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest?.('.rack-slot');
            if(target)moveTileToExactSlot(draggedIndices.length?draggedIndices:[idx],Number(target.dataset.index));
            else {draggedIndices=[];renderRack();}
          }else{
            selectSlot(idx);
          }
          draggedIndices=[];
          pointerDrag=null;
          $('#rack-container').classList.remove('drag-active');
          clearSlotHighlights();
          window.removeEventListener('pointermove',move);
          window.removeEventListener('pointerup',up);
          window.removeEventListener('pointercancel',up);
        };
        window.addEventListener('pointermove',move,{passive:false});
        window.addEventListener('pointerup',up,{passive:false});
        window.addEventListener('pointercancel',up,{passive:false});
      },{passive:false});
    }
    return el;
  }

  function renderRack(){
    const row1=$('#rack-row-1'),row2=$('#rack-row-2');
    row1.innerHTML='';row2.innerHTML='';
    for(let i=0;i<32;i++){
      const slot=document.createElement('div');
      slot.className='rack-slot';
      slot.dataset.index=i;
      slot.addEventListener('dragover',e=>{e.preventDefault();highlightTargetSlots(i);});
      slot.addEventListener('dragleave',()=>clearSlotHighlights());
      slot.addEventListener('drop',e=>{
        e.preventDefault();
        clearSlotHighlights();
        $('#rack-container').classList.remove('drag-active');
        const action=e.dataTransfer.getData('action');
        if(action==='draw-deck')drawFromDeck(i);
        else if(action==='draw-discard')drawFromLeftDiscard(i);
        else if(action==='move-rack'&&draggedIndices.length){
          moveTileToExactSlot(draggedIndices,i);
          draggedIndices=[];selectedSlotIndex=null;renderRack();
        }
      });
      slot.addEventListener('click',()=>selectSlot(i));
      if(rackSlots[i]){
        const t=createTileElement(rackSlots[i],i);
        if(selectedSlotIndex===i||draggedIndices.includes(i))t.classList.add('selected');
        slot.appendChild(t);
      }
      (i<16?row1:row2).appendChild(slot);
    }
  }

  function getContiguousBlock(idx){
    const rowStart=idx<16?0:16,rowEnd=rowStart+16;
    let start=idx,end=idx;
    while(start>rowStart&&rackSlots[start-1]!==null)start--;
    while(end<rowEnd-1&&rackSlots[end+1]!==null)end++;
    const out=[];for(let i=start;i<=end;i++)if(rackSlots[i]!==null)out.push(i);return out;
  }

  function selectRangeSlots(startIdx,endIdx){
    const min=Math.max(Math.min(startIdx,endIdx),startIdx<16?0:16);
    const max=Math.min(Math.max(startIdx,endIdx),(startIdx<16?15:31));
    draggedIndices=[];
    for(let i=min;i<=max;i++)if(rackSlots[i]!==null)draggedIndices.push(i);
    renderRack();
  }

  function moveTileToExactSlot(sourceIndices,targetIndex){
    if(!sourceIndices.length)return;
    if(sourceIndices.length===1&&sourceIndices[0]===targetIndex)return;
    const rowStart=targetIndex<16?0:16,rowEnd=rowStart+16;
    const movingTiles=sourceIndices.map(i=>rackSlots[i]).filter(Boolean);
    sourceIndices.forEach(i=>rackSlots[i]=null);
    const currentTargetTile=rackSlots[targetIndex];
    if(sourceIndices.length===1&&currentTargetTile!==null){
      rackSlots[targetIndex]=movingTiles[0];
      rackSlots[sourceIndices[0]]=currentTargetTile;
    }else{
      let cursor=targetIndex;
      for(const tile of movingTiles){
        if(cursor>=rowEnd)break;
        const existing=rackSlots[cursor];
        rackSlots[cursor]=tile;
        if(existing!==null){
          const emptyIdx=rackSlots.findIndex((s,i)=>s===null&&i>=rowStart&&i<rowEnd);
          if(emptyIdx!==-1)rackSlots[emptyIdx]=existing;
        }
        cursor++;
      }
    }
    selectedSlotIndex=null;draggedIndices=[];playSound('tile');renderRack();
  }

  function selectSlot(index){
    playSound('tile');
    draggedIndices=[];
    if(selectedSlotIndex===null){
      if(rackSlots[index])selectedSlotIndex=index;
    }else if(selectedSlotIndex===index){
      selectedSlotIndex=null;
    }else{
      [rackSlots[selectedSlotIndex],rackSlots[index]]=[rackSlots[index],rackSlots[selectedSlotIndex]];
      selectedSlotIndex=null;
    }
    renderRack();
  }

  function clearSlotHighlights(){
    document.querySelectorAll('.rack-slot.hovered').forEach(s=>s.classList.remove('hovered'));
    document.querySelectorAll('.tile.group-highlight').forEach(t=>t.classList.remove('group-highlight'));
  }

  function highlightTargetSlots(startIndex){
    clearSlotHighlights();
    const count=draggedIndices.length||1,rowEnd=startIndex<16?16:32;
    for(let o=0;o<count;o++){
      const idx=startIndex+o;if(idx>=rowEnd)break;
      const slot=document.querySelector(`.rack-slot[data-index="${idx}"]`);if(slot)slot.classList.add('hovered');
    }
  }

  function highlightTouchTarget(x,y){
    clearSlotHighlights();
    const slot=document.elementFromPoint(x,y)?.closest?.('.rack-slot');
    if(slot)highlightTargetSlots(Number(slot.dataset.index));
  }

  function setCustomDragImage(e,tiles){
    if(!e.dataTransfer||!tiles?.length)return;
    const container=document.createElement('div');
    container.style.cssText='position:absolute;top:-9999px;left:-9999px;display:flex;gap:3px;pointer-events:none;background:transparent;';
    tiles.forEach(tile=>{
      const ghost=createTileElement(tile);
      if(ghost){ghost.style.position='relative';ghost.style.transform='none';ghost.style.margin='0';container.appendChild(ghost);}
    });
    document.body.appendChild(container);
    try{e.dataTransfer.setDragImage(container,20,28);}catch(_){ }
    setTimeout(()=>container.remove(),100);
  }

  function animateTileFly(srcRect,dstRect,tileData,onComplete,isClosed=false){
    if(!srcRect||!dstRect){if(onComplete)onComplete();return;}
    const clone=isClosed?createClosedTileElement():createTileElement(tileData);
    if(!clone){if(onComplete)onComplete();return;}
    clone.classList.add('flying-tile');
    clone.style.position='fixed';
    clone.style.top=srcRect.top+'px';clone.style.left=srcRect.left+'px';
    clone.style.width=srcRect.width+'px';clone.style.height=srcRect.height+'px';
    clone.style.zIndex='99999';clone.style.pointerEvents='none';clone.style.transition='top .34s cubic-bezier(.22,1,.36,1),left .34s cubic-bezier(.22,1,.36,1),width .34s ease,height .34s ease,transform .34s ease,opacity .34s ease';clone.style.margin='0';clone.style.opacity='1';clone.style.boxShadow='0 8px 20px rgba(0,0,0,.6)';
    document.body.appendChild(clone);
    void clone.offsetWidth;
    clone.style.transform='scale(1.04)';
    requestAnimationFrame(()=>{
      clone.style.top=dstRect.top+'px';clone.style.left=dstRect.left+'px';
      if(dstRect.width&&dstRect.height){clone.style.width=dstRect.width+'px';clone.style.height=dstRect.height+'px';}
      clone.style.transform='scale(1)';
    });
    const cleanup=()=>{if(clone.parentNode)clone.parentNode.removeChild(clone);if(onComplete)onComplete();};
    clone.addEventListener('transitionend',cleanup,{once:true});
    setTimeout(cleanup,520);
  }

  function createClosedTileElement(){const el=document.createElement('div');el.className='tile tile-back';return el;}

  function syncHand(){
    const incoming=(game?.myHand||[]).map(localTile);const map=new Map(incoming.map(t=>[t.id,t]));const next=new Array(32).fill(null);
    for(let i=0;i<32;i++){const old=rackSlots[i];if(old&&map.has(old.id)){next[i]=map.get(old.id);map.delete(old.id);}}
    for(const t of incoming){if(!map.has(t.id))continue;const idx=next.findIndex(x=>!x);if(idx<0)break;next[idx]=t;map.delete(t.id);}
    rackSlots=next;
    if(selectedSlotIndex!==null&&!rackSlots[selectedSlotIndex])selectedSlotIndex=null;
  }
  function syncGameState(){
    mySeatIndex=room?room.players.find(p=>p.id===myId)?.seat:null;
    syncHand();
    const bySeat=game?.discardsBySeat||[null,null,null,null];
    const relDiscards=[null,null,null,null];
    bySeat.forEach((t,s)=>{const r=relSeat(s);if(r!=null)relDiscards[r]=t;});
    return relDiscards;
  }

  function renderIndicator(){
    const g=$('#gosterge-holder'),o=$('#okey-holder');g.innerHTML='';o.innerHTML='';if(game?.indicator)g.appendChild(createTileElement(game.indicator));if(game?.okeySpec)o.appendChild(createTileElement({id:'okey-preview',color:game.okeySpec.color,number:game.okeySpec.number}));
  }
  function renderPlayers(){
    const ids=['seat-bottom','seat-right','seat-top','seat-left'],names=['name-player','name-right','name-top','name-left'],scores=['score-player','score-right','score-top','score-left'];
    for(let rel=0;rel<4;rel++){const serverSeat=mySeatIndex==null?null:(mySeatIndex+rel)%4,p=serverSeat==null?null:playerAtSeat(serverSeat),badge=$('#'+ids[rel]);$('#'+names[rel]).textContent=p?(rel===0?`${p.name} (Siz)`:p.name):'Boş';$('#'+scores[rel]).textContent=`TAŞ: ${p?(rel===0?(game?.myHand?.length||0):(game?.otherCounts?.[p.id]||0)):0}`;badge.classList.toggle('active-turn',!!game&&!game.finished&&game.turnIndex===serverSeat);}
  }
  function renderDiscards(relDiscards){
    const ids=['discard-player-spot','discard-right-spot','discard-top-spot','discard-left-spot'];ids.forEach((id,rel)=>{const spot=$('#'+id);spot.innerHTML='';spot.classList.remove('takeable');const t=relDiscards[rel];if(!t)return;const el=createTileElement(t);if(rel===3&&canDraw()){spot.classList.add('takeable');el.addEventListener('click',()=>drawFromLeftDiscard());el.draggable=true;el.addEventListener('dragstart',e=>{e.dataTransfer.setData('action','draw-discard');$('#rack-container').classList.add('drag-active');});}spot.appendChild(el);});
  }
  function renderGame(){if(!game)return;const relDiscards=syncGameState();renderIndicator();renderPlayers();renderRack();renderDiscards(relDiscards);$('#deck-count').textContent=game.deckCount;updateTimer();
    if(game.finished){
      stopTimer();
      document.querySelectorAll('.flying-tile').forEach(el=>el.remove());
      const p=room?.players?.find(x=>x.id===game.winnerId);
      status(p?`${p.name} eli bitirdi!`:'El bitti.');
      showEndModal(p?.id===myId?'🏆 TEBRİKLER!':'🏆 OYUN BİTTİ',p?`${p.name} eli bitirdi!`:'El bitti.');
      return;
    }
    const p=playerAtSeat(game.turnIndex);if(p)status(game.turnIndex===mySeatIndex?(game.phase==='draw'?'Sıra sizde! Ortadan veya soldan taş çekin.':'Taş çektiniz. Şimdi bir taş atın veya bitirin.'):`${p.name} düşünüyor...`);
  }

  function canDraw(){return !!game&&!game.finished&&mySeatIndex!=null&&game.turnIndex===mySeatIndex&&game.phase==='draw';}
  function canDiscard(){return !!game&&!game.finished&&mySeatIndex!=null&&game.turnIndex===mySeatIndex&&game.phase==='discard';}
  function animateTile(src,dst,tile,closed=false){ animateTileFly(src,dst,tile,null,closed); }

  function drawFromDeck(targetSlot=null){
    if(!canDraw())return toast(game?.turnIndex!==mySeatIndex?'Sıra sizde değil!':'Zaten taş çektiniz.');
    const src=$('#deck-tile').getBoundingClientRect();
    pendingDraw={source:'deck',src:{...src},targetSlot};
    socket.emit('drawTile','deck');
  }
  function drawFromLeftDiscard(targetSlot=null){
    if(!canDraw())return toast('Şu an taş çekemezsin.');
    const spot=$('#discard-left-spot'),tile=spot.querySelector('.tile');
    if(!tile)return toast('Solundaki oyuncunun atığı yok.');
    pendingDraw={source:'discard',src:{...spot.getBoundingClientRect()},targetSlot};
    socket.emit('drawTile','discard');
  }
  function discardSelectedTile(){
    if(!canDiscard())return toast(game?.turnIndex!==mySeatIndex?'Sıra sizde değil!':'Önce taş çekmelisin.');
    if(selectedSlotIndex==null||!rackSlots[selectedSlotIndex])return toast('Önce atacağın taşı seç.');
    const t=rackSlots[selectedSlotIndex],slot=document.querySelector(`.rack-slot[data-index="${selectedSlotIndex}"]`);
    if(!slot)return;
    pendingDiscard={tileId:t.id,src:{...slot.getBoundingClientRect()},tile:localTile(t)};
    socket.emit('discardTile',t.id);
    selectedSlotIndex=null;draggedIndices=[];
  }
  function finishGame(){
    if(!canDiscard())return toast('Bitmek için sıra sende olmalı ve taş çekmiş olmalısın.');
    if(selectedSlotIndex==null||!rackSlots[selectedSlotIndex])return toast('Bitiş için atacağın son taşı seç veya sürükle.');
    const t=rackSlots[selectedSlotIndex],slot=document.querySelector(`.rack-slot[data-index="${selectedSlotIndex}"]`);
    if(slot)pendingDiscard={tileId:t.id,src:{...slot.getBoundingClientRect()},tile:localTile(t)};
    socket.emit('discardAndWin',t.id);
    selectedSlotIndex=null;draggedIndices=[];
  }

  function sortTiles(mode){
    const tiles=rackSlots.filter(Boolean);
    const key=t=>{
      const c=t.joker?game.okeySpec.color:t.color;
      const n=t.joker?game.okeySpec.number:t.number;
      return {c,n};
    };
    tiles.sort((a,b)=>{
      const A=key(a),B=key(b);
      if(mode==='number')return A.n-B.n||COLOR_ORDER.indexOf(A.c)-COLOR_ORDER.indexOf(B.c);
      return COLOR_ORDER.indexOf(A.c)-COLOR_ORDER.indexOf(B.c)||A.n-B.n;
    });
    rackSlots.fill(null);
    tiles.forEach((t,i)=>rackSlots[i]=t);
    selectedSlotIndex=null;
    draggedIndices=[];
    renderRack();
    playSound('tile');
  }

  // The real VIP smart arranger: find the largest set of non-overlapping
  // valid runs/sets, then place those groups with a slot gap between them.
  function smartSort(){
    const tiles=rackSlots.filter(Boolean);
    if(!tiles.length)return;

    const items=tiles.map(t=>({
      tile:t,
      color:t.joker?game.okeySpec.color:t.color,
      value:t.joker?game.okeySpec.number:t.number,
      isOkey:isOkey(t),
      id:t.id
    }));

    const best=findBestPerCombination(items);
    const leftovers=organizeRemaining(best.remaining);

    rackSlots.fill(null);
    let slotIdx=0;

    best.pers.forEach(per=>{
      if(slotIdx+per.length>32)return;
      per.forEach(item=>rackSlots[slotIdx++]=item.tile);
      slotIdx++;
    });

    leftovers.forEach(group=>{
      if(slotIdx<16&&slotIdx+group.length>16)slotIdx=16;
      if(slotIdx+group.length<=32){
        group.forEach(item=>rackSlots[slotIdx++]=item.tile);
        slotIdx++;
      }
    });

    selectedSlotIndex=null;
    draggedIndices=[];
    playSound('tile');
    renderRack();
  }

  function findBestPerCombination(items){
    // Okey-aware arranger: numbered okey tiles and joker tiles are wildcards.
    // We enumerate legal 3-5 runs and 3-4 same-number sets, then choose the
    // non-overlapping combination that covers the most real tiles.
    const wild=items.filter(it=>it.isOkey);
    const normal=items.filter(it=>!it.isOkey);
    const candidates=[];
    const seen=new Set();

    function addCandidate(tileList){
      const ids=tileList.map(x=>x.id);
      const key=ids.slice().sort().join('|');
      if(tileList.length>=3&&!seen.has(key)){seen.add(key);candidates.push(tileList);}
    }

    function pickForRequirements(requirements){
      const used=new Set();
      const picked=[];
      let neededWild=0;
      for(const req of requirements){
        const found=normal.find(t=>!used.has(t.id)&&t.color===req.color&&t.value===req.value);
        if(found){picked.push(found);used.add(found.id);}else neededWild++;
      }
      if(neededWild>wild.length)return null;
      const availableWild=wild.filter(t=>!used.has(t.id));
      for(let i=0;i<neededWild;i++)picked.push(availableWild[i]);
      return picked;
    }

    // Standard runs, plus the Okey-specific 12-13-1 short run.
    for(const color of COLOR_ORDER){
      for(let start=1;start<=11;start++){
        for(let len=3;len<=5;len++){
          if(start+len-1>13)continue;
          const req=[];for(let n=start;n<start+len;n++)req.push({color,value:n});
          const picked=pickForRequirements(req);if(picked)addCandidate(picked);
        }
      }
      const special=pickForRequirements([{color,value:12},{color,value:13},{color,value:1}]);
      if(special)addCandidate(special);
    }

    // Same-number sets, 3 or 4 different colours, with missing colours
    // filled by wildcards.
    for(let value=1;value<=13;value++){
      for(let mask=0;mask<(1<<4);mask++){
        const colors=COLOR_ORDER.filter((_,i)=>mask&(1<<i));
        if(colors.length<3||colors.length>4)continue;
        const picked=pickForRequirements(colors.map(color=>({color,value})));
        if(picked)addCandidate(picked);
      }
    }

    // Prefer coverage, then fewer wildcards, then longer groups.
    const score=p=>{
      const wilds=p.filter(x=>x.isOkey).length;
      return p.length*100-wilds*8+p.length;
    };
    candidates.sort((a,b)=>score(b)-score(a));

    // The hand has at most 15 tiles, so use a memoized bit-mask search instead
    // of exponential candidate-by-candidate recursion.
    const indexById=new Map(items.map((t,i)=>[t.id,i]));
    const useful=candidates.slice(0,80).map(p=>({
      tiles:p,
      mask:p.reduce((m,t)=>m|(1<<indexById.get(t.id)),0),
      score:score(p)
    }));
    const byTile=Array.from({length:items.length},()=>[]);
    useful.forEach((c,i)=>{for(let b=0;b<items.length;b++)if(c.mask&(1<<b))byTile[b].push(i);});
    const memo=new Map();
    function solve(mask){
      if(memo.has(mask))return memo.get(mask);
      let first=-1;
      for(let i=0;i<items.length;i++){if(!(mask&(1<<i))){first=i;break;}}
      if(first===-1)return [];
      let best=solve(mask|(1<<first));
      for(const ci of byTile[first]){
        const c=useful[ci];
        if((mask&c.mask)!==0)continue;
        const tail=solve(mask|c.mask);
        const candidate=[c.tiles,...tail];
        const candidateCount=candidate.reduce((n,p)=>n+p.length,0);
        const bestCount=best.reduce((n,p)=>n+p.length,0);
        if(candidateCount>bestCount || (candidateCount===bestCount&&candidate.length>best.length))best=candidate;
      }
      memo.set(mask,best);
      return best;
    }
    const best=solve(0);
    const usedIds=new Set();best.forEach(group=>group.forEach(t=>usedIds.add(t.id)));
    return {pers:best,remaining:items.filter(t=>!usedIds.has(t.id))};
  }

  function organizeRemaining(remaining){
    const groups=[],used=new Set();
    for(let i=0;i<remaining.length;i++){
      if(used.has(remaining[i].id))continue;
      for(let j=i+1;j<remaining.length;j++){
        if(used.has(remaining[j].id))continue;
        if(remaining[i].color===remaining[j].color&&remaining[i].value===remaining[j].value){
          groups.push([remaining[i],remaining[j]]);used.add(remaining[i].id);used.add(remaining[j].id);break;
        }
      }
    }
    for(let i=0;i<remaining.length;i++){
      if(used.has(remaining[i].id))continue;
      for(let j=0;j<remaining.length;j++){
        if(i===j||used.has(remaining[j].id))continue;
        if(remaining[i].color===remaining[j].color&&remaining[j].value===remaining[i].value+1){
          groups.push([remaining[i],remaining[j]]);used.add(remaining[i].id);used.add(remaining[j].id);break;
        }
      }
    }
    for(let i=0;i<remaining.length;i++){
      if(used.has(remaining[i].id))continue;
      for(let j=i+1;j<remaining.length;j++){
        if(used.has(remaining[j].id))continue;
        if(remaining[i].value===remaining[j].value&&remaining[i].color!==remaining[j].color){
          groups.push([remaining[i],remaining[j]]);used.add(remaining[i].id);used.add(remaining[j].id);break;
        }
      }
    }
    const singles=remaining.filter(it=>!used.has(it.id));
    singles.sort((a,b)=>COLOR_ORDER.indexOf(a.color)-COLOR_ORDER.indexOf(b.color)||a.value-b.value);
    singles.forEach(s=>groups.push([s]));
    return groups;
  }

  window.sortSeri=smartSort;window.sortByColor=()=>sortTiles('color');window.sortByNumber=()=>sortTiles('number');window.drawFromDeck=drawFromDeck;window.drawFromLeftDiscard=drawFromLeftDiscard;window.discardSelectedTile=discardSelectedTile;window.finishGame=finishGame;

  function setupInteractions(){
    $('#deck-tile').addEventListener('click',()=>drawFromDeck());
    $('#deck-tile').addEventListener('dragstart',e=>{if(!canDraw()){e.preventDefault();return;}e.dataTransfer.setData('action','draw-deck');$('#rack-container').classList.add('drag-active');});
    $('#deck-tile').addEventListener('dragend',()=>$('#rack-container').classList.remove('drag-active'));
    const discardSpot=$('#discard-player-spot');
    discardSpot.addEventListener('dragover',e=>{e.preventDefault();if(canDiscard()&&draggedIndices.length)discardSpot.classList.add('takeable');});
    discardSpot.addEventListener('dragleave',()=>discardSpot.classList.remove('takeable'));
    discardSpot.addEventListener('drop',e=>{
      e.preventDefault();discardSpot.classList.remove('takeable');
      if(e.dataTransfer.getData('action')==='move-rack'&&draggedIndices.length&&canDiscard()){
        selectedSlotIndex=draggedIndices[0];draggedIndices=[];discardSelectedTile();
      }
    });
    const finish=$('#finish-drop-zone');
    finish.addEventListener('dragover',e=>{e.preventDefault();if(canDiscard())finish.classList.add('drag-over')});
    finish.addEventListener('dragleave',()=>finish.classList.remove('drag-over'));
    finish.addEventListener('drop',e=>{e.preventDefault();finish.classList.remove('drag-over');if(e.dataTransfer.getData('action')==='move-rack'&&draggedIndices.length){selectedSlotIndex=draggedIndices[0];finishGame();}});
    finish.addEventListener('pointerup',e=>{
      if(draggedIndices.length&&canDiscard()){selectedSlotIndex=draggedIndices[0];draggedIndices=[];finishGame();}
    });
    finish.addEventListener('click',finishGame);
    $('#sortSeriBtn').onclick=smartSort;
    $('#sortColorBtn').onclick=()=>sortTiles('color');
    $('#sortNumberBtn').onclick=()=>sortTiles('number');
    $('#discardBtn').onclick=discardSelectedTile;
    $('#finishBtn').onclick=finishGame;
  }

  function startTimer(){stopTimer();if(!game||game.finished)return;updateTimer();turnTimer=setInterval(updateTimer,200);}
  function stopTimer(){clearInterval(turnTimer);turnTimer=null;}
  function updateTimer(){if(!game)return;const bars=['timer-player','timer-right','timer-top','timer-left'];bars.forEach(id=>{const e=$('#'+id);if(e)e.style.width='0%';});const rel=relSeat(game.turnIndex);if(rel==null)return;const e=$('#'+bars[rel]);if(!e)return;const total=game.turnDuration||20000,elapsed=Date.now()-(game.turnStartedAt||Date.now());e.style.width=Math.max(0,Math.min(100,(1-elapsed/total)*100))+'%';}

  function showEndModal(title,msg){$('#modal-title').textContent=title;$('#modal-body').textContent=msg;$('#game-modal').hidden=false;}
  function closeEnd(){ $('#game-modal').hidden=true; }
  $('#newHandBtn').addEventListener('click',()=>{closeEnd();if(room?.hostId===myId)socket.emit('newHand');else toast('Yeni eli oda kurucusu başlatabilir.');});

  // Lobby / room
  function showLobby(){ $('#online-lobby').hidden=false;$('#waiting-overlay').hidden=true; }
  function showWaiting(){ $('#online-lobby').hidden=true;$('#waiting-overlay').hidden=false; }
  function showGame(){ $('#online-lobby').hidden=true;$('#waiting-overlay').hidden=true; }
  $('#createTab').onclick=()=>{$('#createTab').classList.add('active');$('#joinTab').classList.remove('active');$('#createPanel').hidden=false;$('#joinPanel').hidden=true;};
  $('#joinTab').onclick=()=>{$('#joinTab').classList.add('active');$('#createTab').classList.remove('active');$('#createPanel').hidden=true;$('#joinPanel').hidden=false;};
  $('#createRoom').onclick=()=>socket.emit('createRoom',{name:$('#nameCreate').value.trim()||'Oyuncu'});
  $('#joinRoom').onclick=()=>socket.emit('joinRoom',{code:$('#roomCode').value.trim().toUpperCase(),name:$('#nameJoin').value.trim()||'Oyuncu'});
  $('#quickPlay').onclick=()=>socket.emit('quickPlay',{name:$('#nameCreate').value.trim()||'Oyuncu'});
  $('#spectatorBtn').onclick=()=>socket.emit('chooseSeat',null);
  $('#startGame').onclick=()=>socket.emit('startGame');

  function renderWaiting(){if(!room)return;$('#waitingCode').textContent=room.code;const grid=$('#seatGrid');grid.innerHTML='';for(let i=0;i<4;i++){const p=playerAtSeat(i),b=document.createElement('button');b.className='vip-seat'+(p?' occupied':'')+(p?.id===myId?' mine':'');b.innerHTML=`<span>KOLTUK ${i+1}</span><strong>${p?esc(p.name):'BOŞ'}</strong>`;b.onclick=()=>socket.emit('chooseSeat',i);grid.appendChild(b);}$('#waitingPlayers').innerHTML=room.players.map(p=>`<div>${p.bot?'🤖':'👤'} ${esc(p.name)}${p.id===room.hostId?' 👑':''}${p.spectator?' · izleyici':''}</div>`).join('');const host=room.hostId===myId;$('#startGame').hidden=!host;$('#startGame').disabled=room.seats.filter(Boolean).length!==4;}

  // Chat
  $('#chatBtn').onclick=()=>{$('#chatPanel').hidden=!$('#chatPanel').hidden;};$('#chatClose').onclick=()=>$('#chatPanel').hidden=true;$('#chatForm').addEventListener('submit',e=>{e.preventDefault();const t=$('#chatInput').value.trim();if(t)socket.emit('chatMsg',t);$('#chatInput').value='';});
  socket.on('chatMsg',m=>{const d=document.createElement('div');d.className='chat-msg';d.innerHTML=m.system?esc(m.text):`<span class="who">${esc(m.name)}:</span> ${esc(m.text)}`;$('#chatMessages').appendChild(d);$('#chatMessages').scrollTop=$('#chatMessages').scrollHeight;});

  // Voice
  const rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
  $('#voiceBtn').onclick=async()=>{if(voiceOn)stopVoice();else await startVoice();};
  async function startVoice(){try{localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});voiceOn=true;$('#voiceBtn').textContent='🔊 Ses Açık';socket.emit('voiceJoin');}catch(e){toast('Mikrofon erişimi verilemedi.');}}
  function stopVoice(){voiceOn=false;$('#voiceBtn').textContent='🎤 Sesli Sohbet';socket.emit('voiceLeave');localStream?.getTracks().forEach(t=>t.stop());localStream=null;Object.values(peerConnections).forEach(pc=>pc.close());Object.keys(peerConnections).forEach(k=>delete peerConnections[k]);}
  function ensurePeer(id,initiator){if(peerConnections[id])return peerConnections[id];const pc=new RTCPeerConnection(rtcConfig);peerConnections[id]=pc;if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate)socket.emit('voiceSignal',{to:id,signal:{type:'ice',candidate:e.candidate}})};pc.ontrack=e=>{let a=audioEls[id];if(!a){a=document.createElement('audio');a.autoplay=true;document.body.appendChild(a);audioEls[id]=a;}a.srcObject=e.streams[0];};if(initiator)pc.onnegotiationneeded=async()=>{const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('voiceSignal',{to:id,signal:{type:'offer',sdp:pc.localDescription}})};return pc;}
  socket.on('voicePeerJoined',id=>{if(voiceOn)ensurePeer(id,true)});socket.on('voicePeerLeft',id=>{peerConnections[id]?.close();delete peerConnections[id];audioEls[id]?.remove();delete audioEls[id];});socket.on('voiceSignal',async({from,signal})=>{if(!voiceOn)return;const pc=ensurePeer(from,false);if(signal.type==='offer'){await pc.setRemoteDescription(signal.sdp);const ans=await pc.createAnswer();await pc.setLocalDescription(ans);socket.emit('voiceSignal',{to:from,signal:{type:'answer',sdp:pc.localDescription}})}else if(signal.type==='answer')await pc.setRemoteDescription(signal.sdp);else if(signal.type==='ice'){try{await pc.addIceCandidate(signal.candidate)}catch(_){}}});

  // Manual win: optional table approval.
  socket.on('manualWinClaim',({claimantId,claimantName,hand})=>{const box=$('#manualWinDialog');$('#manualWinTitle').textContent=`${claimantName} elini açtı`;const wrap=$('#manualWinTiles');wrap.innerHTML='';hand.forEach(t=>wrap.appendChild(createTileElement(t)));const actions=$('#manualWinActions');actions.innerHTML='';if(room?.hostId===myId&&claimantId!==myId){const a=document.createElement('button');a.textContent='Kabul Et';a.style.background='var(--gold)';a.onclick=()=>{socket.emit('resolveManualWin',{claimantId,accepted:true});box.hidden=true};const r=document.createElement('button');r.textContent='Reddet';r.onclick=()=>{socket.emit('resolveManualWin',{claimantId,accepted:false});box.hidden=true};actions.append(a,r)}else{const b=document.createElement('button');b.textContent='Kapat';b.onclick=()=>box.hidden=true;actions.append(b)}box.hidden=false;});

  socket.on('connect',()=>{myId=socket.id;});
  socket.on('onlineCount',()=>{});
  socket.on('errorMsg',m=>{ $('#onlineError').textContent=m;toast(m);status(m); });
  socket.on('joinedRoom',({quick})=>{if(!quick)showWaiting();});
  socket.on('roomUpdate',state=>{room=state;if(state.gameActive)showGame();else renderWaiting();});
  function animateGameTransition(next){
    const prev=previousGame;
    if(!prev){previousGame=next;return;}
    const prevHandIds=new Set((prev.myHand||[]).map(t=>t.id));
    const nextHand=(next.myHand||[]);
    const added=nextHand.find(t=>!prevHandIds.has(t.id));
    const removedId=(prev.myHand||[]).find(t=>!nextHand.some(n=>n.id===t.id))?.id;

    // Our own pending draw gets a real tile animation into the first newly occupied slot.
    if(added&&pendingDraw){
      const slotIndex=rackSlots.findIndex(t=>t?.id===added.id);
      const target=slotIndex>=0?document.querySelector(`.rack-slot[data-index="${slotIndex}"]`):$('#rack-row-1');
      if(target)animateTile(pendingDraw.src,target.getBoundingClientRect(),added,false);
      playSound('draw');
      pendingDraw=null;
    }

    // Other players drawing: animate a face-down tile from the deck/discard toward their badge.
    const sameTurnDraw=prev.turnIndex===next.turnIndex&&prev.phase==='draw'&&next.phase==='discard';
    if(sameTurnDraw&&!pendingDraw){
      const seat=next.turnIndex,rel=relSeat(seat);
      const targetRel=['seat-bottom','seat-right','seat-top','seat-left'][rel??0];
      const target=$(targetRel?`#${targetRel}`:'#center-area');
      let src=null,closed=true;
      if(next.deckCount<prev.deckCount)src=$('#deck-tile')?.getBoundingClientRect();
      else { const spot=$('#discard-left-spot'); src=spot?.getBoundingClientRect(); }
      if(src&&target)animateTile(src,target.getBoundingClientRect(),null,closed);
    }

    // Our own discard is only animated after the server confirms it.
    if(removedId&&pendingDiscard&&pendingDiscard.tileId===removedId){
      const target=$('#discard-player-spot');
      if(target)animateTile(pendingDiscard.src,target.getBoundingClientRect(),pendingDiscard.tile,false);
      playSound('discard');
      pendingDiscard=null;
    }

    // Other players' discarded tiles animate from their badge to their discard spot.
    const oldD=prev.discardsBySeat||[null,null,null,null],newD=next.discardsBySeat||[null,null,null,null];
    newD.forEach((tile,seat)=>{
      const old=oldD[seat];
      if(tile&&(!old||old.id!==tile.id)&&seat!==mySeatIndex){
        const rel=relSeat(seat);
        const badgeIds=['seat-bottom','seat-right','seat-top','seat-left'];
        const spotIds=['discard-player-spot','discard-right-spot','discard-top-spot','discard-left-spot'];
        const src=$(rel!=null?`#${badgeIds[rel]}`:'#center-area'),dst=$(rel!=null?`#${spotIds[rel]}`:'#center-area');
        if(src&&dst)animateTile(src.getBoundingClientRect(),dst.getBoundingClientRect(),tile,false);
      }
    });
    previousGame=next;
  }

  socket.on('gameUpdate',state=>{const wasFinished=game?.finished;const prev=previousGame;game=state;showGame();renderGame();previousGame=prev;animateGameTransition(state);startTimer();if(!prev&&!wasFinished)playSound('draw');previousGame=state;});

  setupInteractions();
  showLobby();
})();
