(() => {
  const socket = io();
  const $ = s => document.querySelector(s);
  let myId=null, room=null, game=null, mySeatIndex=null;
  let rackSlots=new Array(32).fill(null);
  let selectedSlotIndex=null, draggedIndices=[], pointerDrag=null, longPressTimer=null;
  let soundEnabled=true, audioCtx=null, turnTimer=null, voiceOn=false, localStream=null;
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
    const el=document.createElement('div');
    el.className='tile';
    if(!tile){el.classList.add('tile-empty');return el;}
    if(tile.joker){el.classList.add('black');el.textContent='★';}
    else{el.classList.add(colorClass(tile));el.textContent=tile.number;}
    if(isOkey(tile)){
      el.classList.add('okey-mark');
      const star=document.createElement('span');
      star.textContent='★';
      star.style.cssText='font-size:11px;color:#2e7d32;margin-top:-4px';
      el.appendChild(star);
    }
    if(slotIndex!==null){
      el.dataset.slot=slotIndex;
      // Native HTML5 drag is deliberately disabled for tiles. Pointer drag gives
      // the same behaviour with mouse + touch and lets us hit an exact slot.
      el.draggable=false;
      el.addEventListener('pointerdown',e=>startTilePointer(e,slotIndex));
      el.addEventListener('click',e=>e.stopPropagation());
      el.addEventListener('dblclick',e=>{
        e.stopPropagation();
        if(canDiscard()){
          selectedSlotIndex=slotIndex;
          discardSelectedTile();
        }
      });
    }
    return el;
  }

  function renderRack(){
    const r1=$('#rack-row-1'),r2=$('#rack-row-2');
    r1.innerHTML='';r2.innerHTML='';
    for(let i=0;i<32;i++){
      const slot=document.createElement('div');
      slot.className='rack-slot';
      slot.dataset.index=i;
      slot.addEventListener('dragover',e=>{
        e.preventDefault();
        highlightTargets(i,draggedIndices.length||1);
      });
      slot.addEventListener('dragleave',()=>clearHighlights());
      slot.addEventListener('drop',e=>{
        e.preventDefault();
        const action=e.dataTransfer.getData('action');
        clearHighlights();
        $('#rack-container').classList.remove('drag-active');
        if(action==='draw-deck') drawFromDeck(i);
        else if(action==='draw-discard') drawFromLeftDiscard(i);
      });
      slot.addEventListener('click',()=>{
        if(!rackSlots[i]) return;
        selectSlot(i);
      });
      if(rackSlots[i]){
        const t=createTileElement(rackSlots[i],i);
        if(selectedSlotIndex===i||draggedIndices.includes(i))t.classList.add('selected');
        slot.appendChild(t);
      }
      (i<16?r1:r2).appendChild(slot);
    }
  }

  function clearHighlights(){
    document.querySelectorAll('.rack-slot.hovered').forEach(x=>x.classList.remove('hovered'));
  }

  function highlightTargets(start,count){
    clearHighlights();
    const rowStart=start<16?0:16,rowEnd=rowStart+16;
    for(let i=0;i<count&&start+i<rowEnd;i++){
      const s=document.querySelector(`.rack-slot[data-index="${start+i}"]`);
      if(s)s.classList.add('hovered');
    }
  }

  function getContiguousBlock(idx){
    const rowStart=idx<16?0:16;
    const rowEnd=rowStart+16;
    let start=idx,end=idx;
    while(start>rowStart&&rackSlots[start-1]!==null)start--;
    while(end<rowEnd-1&&rackSlots[end+1]!==null)end++;
    const out=[];
    for(let i=start;i<=end;i++)if(rackSlots[i]!==null)out.push(i);
    return out;
  }

  function selectSlot(i){
    playSound('tile');
    draggedIndices=[];
    if(selectedSlotIndex===null){
      if(rackSlots[i])selectedSlotIndex=i;
    }else if(selectedSlotIndex===i){
      selectedSlotIndex=null;
    }else{
      [rackSlots[selectedSlotIndex],rackSlots[i]]=[rackSlots[i],rackSlots[selectedSlotIndex]];
      selectedSlotIndex=null;
    }
    renderRack();
  }

  // Exact-slot movement from the original VIP rack behaviour:
  // one tile dropped on a tile swaps them; dropping on an empty slot keeps it there.
  // Groups move together and stay inside the same 16-slot row.
  function moveTileToExactSlot(sourceIndices,targetIndex){
    if(!sourceIndices.length)return;
    if(sourceIndices.length===1&&sourceIndices[0]===targetIndex)return;

    const rowStart=targetIndex<16?0:16;
    const rowEnd=rowStart+16;
    const movingTiles=sourceIndices.map(i=>rackSlots[i]).filter(Boolean);
    sourceIndices.forEach(i=>{rackSlots[i]=null;});

    const currentTargetTile=rackSlots[targetIndex];
    if(sourceIndices.length===1&&currentTargetTile!==null){
      rackSlots[targetIndex]=movingTiles[0];
      rackSlots[sourceIndices[0]]=currentTargetTile;
    }else{
      let cursor=targetIndex;
      for(let i=0;i<movingTiles.length;i++){
        if(cursor>=rowEnd)break;
        const existing=rackSlots[cursor];
        rackSlots[cursor]=movingTiles[i];
        if(existing!==null){
          let emptyIdx=-1;
          for(let j=rowStart;j<rowEnd;j++){
            if(rackSlots[j]===null){emptyIdx=j;break;}
          }
          if(emptyIdx!==-1)rackSlots[emptyIdx]=existing;
        }
        cursor++;
      }
    }
    selectedSlotIndex=null;
    draggedIndices=[];
    playSound('tile');
    renderRack();
  }

  function startTilePointer(e,idx){
    if(e.button!==undefined&&e.button!==0)return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(longPressTimer);
    draggedIndices=[];
    pointerDrag={
      idx,
      pointerId:e.pointerId,
      startX:e.clientX,
      startY:e.clientY,
      moved:false,
      group:false,
      longPressed:false
    };
    const el=e.currentTarget;
    el.classList.add('pressing');
    try{el.setPointerCapture(e.pointerId);}catch(_){ }

    longPressTimer=setTimeout(()=>{
      if(!pointerDrag||pointerDrag.idx!==idx)return;
      pointerDrag.longPressed=true;
      pointerDrag.group=true;
      draggedIndices=getContiguousBlock(idx);
      renderRack();
      $('#rack-container').classList.add('drag-active');
    },220);

    const move=ev=>{
      if(!pointerDrag||ev.pointerId!==pointerDrag.pointerId)return;
      const dx=ev.clientX-pointerDrag.startX,dy=ev.clientY-pointerDrag.startY;
      if(Math.hypot(dx,dy)>7&&!pointerDrag.moved){
        pointerDrag.moved=true;
        clearTimeout(longPressTimer);
        if(!pointerDrag.group)draggedIndices=[idx];
        $('#rack-container').classList.add('drag-active');
      }
      if(pointerDrag.moved||pointerDrag.group){
        ev.preventDefault();
        highlightTouchTarget(ev.clientX,ev.clientY);
      }
    };

    const up=ev=>{
      if(!pointerDrag||ev.pointerId!==pointerDrag.pointerId)return;
      clearTimeout(longPressTimer);
      el.classList.remove('pressing');

      const wasDrag=pointerDrag.moved||pointerDrag.group;
      if(wasDrag){
        const targetEl=document.elementFromPoint(ev.clientX,ev.clientY)?.closest?.('.rack-slot');
        if(targetEl){
          moveTileToExactSlot(draggedIndices.length?draggedIndices:[idx],Number(targetEl.dataset.index));
        }else{
          draggedIndices=[];
          renderRack();
        }
      }else{
        // Normal click: preserve the original select/swap behaviour.
        selectSlot(idx);
      }

      pointerDrag=null;
      $('#rack-container').classList.remove('drag-active');
      clearHighlights();
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);
      window.removeEventListener('pointercancel',up);
    };
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',up,{passive:false});
    window.addEventListener('pointercancel',up,{passive:false});
  }

  function highlightTouchTarget(x,y){
    clearHighlights();
    const el=document.elementFromPoint(x,y)?.closest?.('.rack-slot');
    if(el)el.classList.add('hovered');
  }

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
    if(game.finished){stopTimer();const p=room?.players?.find(x=>x.id===game.winnerId);showEndModal(p?.id===myId?'🏆 TEBRİKLER!':'🏆 OYUN BİTTİ',p?`${p.name} eli bitirdi!`:'El bitti.');return;}
    const p=playerAtSeat(game.turnIndex);if(p)status(game.turnIndex===mySeatIndex?(game.phase==='draw'?'Sıra sizde! Ortadan veya soldan taş çekin.':'Taş çektiniz. Şimdi bir taş atın veya bitirin.'):`${p.name} düşünüyor...`);
  }

  function canDraw(){return !!game&&!game.finished&&mySeatIndex!=null&&game.turnIndex===mySeatIndex&&game.phase==='draw';}
  function canDiscard(){return !!game&&!game.finished&&mySeatIndex!=null&&game.turnIndex===mySeatIndex&&game.phase==='discard';}
  function animateTile(src,dst,tile,closed=false){if(!src||!dst)return;const c=createTileElement(closed?null:tile);if(closed)c.classList.add('tile-back');c.style.position='fixed';c.style.left=src.left+'px';c.style.top=src.top+'px';c.style.width=src.width+'px';c.style.height=src.height+'px';c.style.zIndex=9999;c.style.pointerEvents='none';c.style.transition='all .3s ease';document.body.appendChild(c);c.getBoundingClientRect();c.style.left=dst.left+'px';c.style.top=dst.top+'px';setTimeout(()=>c.remove(),320);}

  function drawFromDeck(targetSlot=null){if(!canDraw())return toast(game?.turnIndex!==mySeatIndex?'Sıra sizde değil!':'Zaten taş çektiniz.');const src=$('#deck-tile').getBoundingClientRect();socket.emit('drawTile','deck');playSound('draw');}
  function drawFromLeftDiscard(targetSlot=null){if(!canDraw())return toast('Şu an taş çekemezsin.');const spot=$('#discard-left-spot');if(!spot.querySelector('.tile'))return toast('Solundaki oyuncunun atığı yok.');socket.emit('drawTile','discard');playSound('draw');}
  function discardSelectedTile(){if(!canDiscard())return toast(game?.turnIndex!==mySeatIndex?'Sıra sizde değil!':'Önce taş çekmelisin.');if(selectedSlotIndex==null||!rackSlots[selectedSlotIndex])return toast('Önce atacağın taşı seç.');const t=rackSlots[selectedSlotIndex],slot=document.querySelector(`.rack-slot[data-index="${selectedSlotIndex}"]`);if(slot)animateTile(slot.getBoundingClientRect(),$('#discard-player-spot').getBoundingClientRect(),t);socket.emit('discardTile',t.id);selectedSlotIndex=null;draggedIndices=[];}
  function finishGame(){if(!canDiscard())return toast('Bitmek için sıra sende olmalı ve taş çekmiş olmalısın.');if(selectedSlotIndex==null||!rackSlots[selectedSlotIndex])return toast('Bitiş için atacağın son taşı seç veya sürükle.');const t=rackSlots[selectedSlotIndex];socket.emit('discardAndWin',t.id);}

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
    const allValidPers=[];
    const byColor={};
    COLOR_ORDER.forEach(c=>byColor[c]=[]);
    items.forEach(it=>{if(byColor[it.color])byColor[it.color].push(it);});

    COLOR_ORDER.forEach(col=>{
      const list=byColor[col].slice().sort((a,b)=>a.value-b.value);
      function findRuns(startIndex,currentRun){
        if(currentRun.length>=3)allValidPers.push([...currentRun]);
        if(currentRun.length>=5)return;
        const lastVal=currentRun[currentRun.length-1].value;
        for(let i=startIndex;i<list.length;i++){
          if(list[i].value===lastVal+1)findRuns(i+1,[...currentRun,list[i]]);
        }
      }
      for(let i=0;i<list.length;i++)findRuns(i+1,[list[i]]);
      const tile12=list.find(t=>t.value===12),tile13=list.find(t=>t.value===13),tile1=list.find(t=>t.value===1);
      if(tile12&&tile13&&tile1)allValidPers.push([tile12,tile13,tile1]);
    });

    for(let val=1;val<=13;val++){
      const sameVal=items.filter(it=>it.value===val);
      const colorMap={};
      sameVal.forEach(it=>{if(!colorMap[it.color])colorMap[it.color]=[];colorMap[it.color].push(it);});
      const colors=Object.keys(colorMap);
      if(colors.length>=3){
        function combos(colorIdx,current){
          if(current.length>=3)allValidPers.push([...current]);
          if(current.length===4||colorIdx>=colors.length)return;
          const c=colors[colorIdx];
          colorMap[c].forEach(tile=>combos(colorIdx+1,[...current,tile]));
          combos(colorIdx+1,current);
        }
        combos(0,[]);
      }
    }

    let maxTiles=-1,bestPers=[];
    const LIMIT=16;
    if(allValidPers.length<=LIMIT){
      function search(idx,chosen,used){
        const count=chosen.reduce((n,p)=>n+p.length,0);
        if(count>maxTiles){maxTiles=count;bestPers=[...chosen];}
        if(idx>=allValidPers.length)return;
        search(idx+1,chosen,used);
        const p=allValidPers[idx];
        if(p.every(it=>!used.has(it.id))){
          const next=new Set(used);p.forEach(it=>next.add(it.id));
          search(idx+1,[...chosen,p],next);
        }
      }
      search(0,[],new Set());
    }else{
      const sorted=[...allValidPers].sort((a,b)=>b.length-a.length);
      const used=new Set();
      sorted.forEach(p=>{
        if(p.every(it=>!used.has(it.id))){bestPers.push(p);p.forEach(it=>used.add(it.id));}
      });
      maxTiles=bestPers.reduce((n,p)=>n+p.length,0);
    }

    const usedIds=new Set();
    bestPers.forEach(p=>p.forEach(it=>usedIds.add(it.id)));
    const remaining=items.filter(it=>!usedIds.has(it.id));
    return {pers:bestPers,remaining};
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
    const finish=$('#finish-drop-zone');finish.addEventListener('dragover',e=>{e.preventDefault();if(canDiscard())finish.classList.add('drag-over')});finish.addEventListener('dragleave',()=>finish.classList.remove('drag-over'));finish.addEventListener('drop',e=>{e.preventDefault();finish.classList.remove('drag-over');if(e.dataTransfer.getData('action')==='move-rack'&&draggedIndices.length){selectedSlotIndex=draggedIndices[0];finishGame();}});finish.addEventListener('click',finishGame);
    $('#sortSeriBtn').onclick=smartSort;$('#sortColorBtn').onclick=()=>sortTiles('color');$('#sortNumberBtn').onclick=()=>sortTiles('number');$('#discardBtn').onclick=discardSelectedTile;$('#finishBtn').onclick=finishGame;
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
  socket.on('gameUpdate',state=>{const wasFinished=game?.finished;game=state;showGame();renderGame();startTimer();if(!wasFinished)playSound('draw');});

  setupInteractions();
  showLobby();
})();
