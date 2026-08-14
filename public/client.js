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
    const el=document.createElement('div'); el.className='tile';
    if(!tile){el.classList.add('tile-empty');return el;}
    if(tile.joker){el.classList.add('black');el.textContent='★';}
    else{el.classList.add(colorClass(tile));el.textContent=tile.number;}
    if(isOkey(tile)){el.classList.add('okey-mark');const star=document.createElement('span');star.textContent='★';star.style.cssText='font-size:11px;color:#2e7d32;margin-top:-4px';el.appendChild(star);}
    if(slotIndex!==null){
      el.dataset.slot=slotIndex; el.draggable=true;
      el.addEventListener('click',e=>{e.stopPropagation();selectSlot(slotIndex);});
      el.addEventListener('dblclick',e=>{e.stopPropagation();selectedSlotIndex=slotIndex;discardSelectedTile();});
      el.addEventListener('dragstart',e=>startHtmlDrag(e,slotIndex));
      el.addEventListener('dragend',()=>{draggedIndices=[];clearHighlights();$('#rack-container').classList.remove('drag-active');});
      el.addEventListener('pointerdown',e=>startPointerDrag(e,slotIndex));
    }
    return el;
  }

  function renderRack(){
    const r1=$('#rack-row-1'),r2=$('#rack-row-2');r1.innerHTML='';r2.innerHTML='';
    for(let i=0;i<32;i++){
      const slot=document.createElement('div');slot.className='rack-slot';slot.dataset.index=i;
      slot.addEventListener('dragover',e=>{e.preventDefault();highlightTargets(i,draggedIndices.length||1);});
      slot.addEventListener('dragleave',()=>clearHighlights());
      slot.addEventListener('drop',e=>{e.preventDefault();const action=e.dataTransfer.getData('action');clearHighlights();$('#rack-container').classList.remove('drag-active');if(action==='draw-deck')drawFromDeck(i);else if(action==='draw-discard')drawFromLeftDiscard(i);else if(draggedIndices.length)moveTileToExactSlot(draggedIndices,i);});
      slot.addEventListener('click',()=>{if(!rackSlots[i])return;selectSlot(i);});
      if(rackSlots[i]){const t=createTileElement(rackSlots[i],i);if(selectedSlotIndex===i||draggedIndices.includes(i))t.classList.add('selected');slot.appendChild(t);}
      (i<16?r1:r2).appendChild(slot);
    }
  }
  function clearHighlights(){document.querySelectorAll('.rack-slot.hovered').forEach(x=>x.classList.remove('hovered'));}
  function highlightTargets(start,count){clearHighlights();const rowStart=start<16?0:16,rowEnd=rowStart+16;for(let i=0;i<count&&start+i<rowEnd;i++){const s=document.querySelector(`.rack-slot[data-index="${start+i}"]`);if(s)s.classList.add('hovered');}}
  function getContiguousBlock(idx){const rowStart=idx<16?0:16,rowEnd=rowStart+16;let a=idx,b=idx;while(a>rowStart&&rackSlots[a-1])a--;while(b<rowEnd-1&&rackSlots[b+1])b++;return Array.from({length:b-a+1},(_,i)=>a+i).filter(i=>rackSlots[i]);}
  function selectSlot(i){playSound();if(selectedSlotIndex==null){selectedSlotIndex=i;}else if(selectedSlotIndex===i){selectedSlotIndex=null;}else{[rackSlots[selectedSlotIndex],rackSlots[i]]=[rackSlots[i],rackSlots[selectedSlotIndex]];selectedSlotIndex=null;}draggedIndices=[];renderRack();}
  function moveTileToExactSlot(src,target){const rowStart=target<16?0:16,rowEnd=rowStart+16;const moving=src.map(i=>rackSlots[i]).filter(Boolean);src.forEach(i=>rackSlots[i]=null);let vals=[];for(let i=rowStart;i<rowEnd;i++)if(rackSlots[i])vals.push(rackSlots[i]);let pos=Math.max(0,target-rowStart);vals.splice(pos,0,...moving);for(let i=rowStart;i<rowEnd;i++)rackSlots[i]=vals[i-rowStart]||null;selectedSlotIndex=null;draggedIndices=[];playSound();renderRack();}

  function startHtmlDrag(e,idx){
    draggedIndices=(selectedSlotIndex===idx&&selectedSlotIndex!==null)?[idx]:[idx];
    e.dataTransfer.setData('action','move-rack');
    e.dataTransfer.effectAllowed='move';$('#rack-container').classList.add('drag-active');
  }
  function startPointerDrag(e,idx){
    if(e.pointerType!=='touch')return;
    clearTimeout(longPressTimer); pointerDrag={idx,startX:e.clientX,startY:e.clientY,moved:false};
    longPressTimer=setTimeout(()=>{if(pointerDrag&&!pointerDrag.moved){draggedIndices=getContiguousBlock(idx);renderRack();}},260);
    e.target.setPointerCapture?.(e.pointerId);
    const move=ev=>{
      if(!pointerDrag)return;const dx=ev.clientX-pointerDrag.startX,dy=ev.clientY-pointerDrag.startY;
      if(Math.hypot(dx,dy)>8){pointerDrag.moved=true;clearTimeout(longPressTimer);$('#rack-container').classList.add('drag-active');highlightTouchTarget(ev.clientX,ev.clientY);}
    };
    const up=ev=>{clearTimeout(longPressTimer);if(pointerDrag?.moved){const el=document.elementFromPoint(ev.clientX,ev.clientY);const slot=el?.closest?.('.rack-slot');if(slot){if(!draggedIndices.length)draggedIndices=[idx];moveTileToExactSlot(draggedIndices,Number(slot.dataset.index));}}else if(draggedIndices.length>1&&draggedIndices.includes(idx)){selectedSlotIndex=idx;renderRack();}else selectSlot(idx);pointerDrag=null;$('#rack-container').classList.remove('drag-active');clearHighlights();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
  }
  function highlightTouchTarget(x,y){clearHighlights();const el=document.elementFromPoint(x,y)?.closest?.('.rack-slot');if(el)el.classList.add('hovered');}

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

  function sortTiles(mode){const tiles=rackSlots.filter(Boolean);const key=(t)=>{const c=t.joker?game.okeySpec.color:t.color,n=t.joker?game.okeySpec.number:t.number;return {c,n};};tiles.sort((a,b)=>{const A=key(a),B=key(b);if(mode==='number')return A.n-B.n||A.c.localeCompare(B.c);return COLOR_ORDER.indexOf(A.c)-COLOR_ORDER.indexOf(B.c)||A.n-B.n;});rackSlots.fill(null);tiles.forEach((t,i)=>rackSlots[i]=t);selectedSlotIndex=null;draggedIndices=[];renderRack();playSound();}
  function smartSort(){const tiles=rackSlots.filter(Boolean);const score=t=>{const c=t.joker?game.okeySpec.color:t.color,n=t.joker?game.okeySpec.number:t.number;if(t.joker)return 999;let s=0;tiles.forEach(o=>{if(o.id===t.id)return;const oc=o.joker?game.okeySpec.color:o.color,on=o.joker?game.okeySpec.number:o.number;if(c===oc&&Math.abs(n-on)<=2)s+=3;if(n===on&&c!==oc)s+=2;});return s;};tiles.sort((a,b)=>score(b)-score(a)||((a.number||0)-(b.number||0)));rackSlots.fill(null);tiles.forEach((t,i)=>rackSlots[i]=t);selectedSlotIndex=null;draggedIndices=[];renderRack();playSound();}
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
