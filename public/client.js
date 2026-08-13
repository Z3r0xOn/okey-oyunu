(() => {
  const socket = io();
  let myId = null, room = null, game = null;
  let selectedSlotIndex = null, draggedIndices = [], rackSlots = new Array(32).fill(null);
  let isMouseSelecting = false, dragSelectStart = null, longPressTimer = null, isLongPress = false;
  let soundEnabled = true, audioCtx = null, turnTimer = null;
  let prevHandIds = [], prevDiscardId = null, indicatorRevealed = false;
  let voiceOn = false, localStream = null;
  const peerConnections = {}, audioEls = {};
  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const $ = s => document.querySelector(s);
  const viewLobby = $('#view-lobby'), viewWaiting = $('#view-waiting'), viewGame = $('#view-game'), toast = $('#toast');

  function showView(name){ viewLobby.hidden=name!=='lobby'; viewWaiting.hidden=name!=='waiting'; viewGame.hidden=name!=='game'; }
  function showToast(msg){ toast.textContent=msg; toast.hidden=false; clearTimeout(showToast.t); showToast.t=setTimeout(()=>toast.hidden=true,3200); }
  function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

  function isFullscreen(){return !!(document.fullscreenElement||document.webkitFullscreenElement||document.msFullscreenElement)}
  function enterFullscreen(){try{const e=document.documentElement,r=e.requestFullscreen||e.webkitRequestFullscreen||e.msRequestFullscreen;if(r){const x=r.call(e);if(x?.catch)x.catch(()=>{})}}catch{}}
  function exitFullscreen(){try{(document.exitFullscreen||document.webkitExitFullscreen||document.msExitFullscreen)?.call(document)}catch{}}
  function updateFullscreenBtn(){const b=$('#fullscreenBtn');if(!b)return;b.textContent=isFullscreen()?'⤢':'⛶';b.title=isFullscreen()?'Tam ekrandan çık':'Tam ekran'}
  $('#fullscreenBtn')?.addEventListener('click',()=>isFullscreen()?exitFullscreen():enterFullscreen());
  ['fullscreenchange','webkitfullscreenchange','MSFullscreenChange'].forEach(e=>document.addEventListener(e,updateFullscreenBtn));

  // ---------- Lobby ----------
  function enteredName(){return $('#nameInputCreate')?.value.trim()||$('#nameInputJoin')?.value.trim()||'Oyuncu'}
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
    document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));$('#panel-'+btn.dataset.tab)?.classList.add('active');
  }));
  $('#quickPlayBtn')?.addEventListener('click',()=>{enterFullscreen();socket.emit('quickPlay',{name:enteredName()})});
  $('#createRoomBtn')?.addEventListener('click',()=>{enterFullscreen();socket.emit('createRoom',{name:$('#nameInputCreate').value.trim()||'Oyuncu'})});
  $('#joinRoomBtn')?.addEventListener('click',()=>{const code=$('#codeInput').value.trim().toUpperCase();if(!code)return showToast('Lütfen oda kodunu gir.');enterFullscreen();socket.emit('joinRoom',{code,name:$('#nameInputJoin').value.trim()||'Oyuncu'})});
  socket.on('connect',()=>{myId=socket.id});
  socket.on('errorMsg',showToast);
  socket.on('onlineCount',n=>{if($('#onlineCount'))$('#onlineCount').textContent=n});
  socket.on('joinedRoom',({code,quick})=>{$('#roomCodeLabel').textContent=code;$('#roomCodeLabel2').textContent=code;if(!quick)showView('waiting')});
  $('#copyCodeBtn')?.addEventListener('click',()=>{const c=$('#roomCodeLabel').textContent;navigator.clipboard?.writeText(c).then(()=>showToast('Oda kodu kopyalandı: '+c))});
  $('#leaveWaitingBtn')?.addEventListener('click',()=>location.reload());
  $('#leaveGameBtn')?.addEventListener('click',()=>location.reload());

  // ---------- Waiting ----------
  const seatGrid=$('#seatGrid');
  for(let i=0;i<4;i++){
    const b=document.createElement('button');b.className='seat-btn';b.innerHTML=`<span class="seat-num">Koltuk ${i+1}</span><span class="seat-name">Boş</span>`;
    b.addEventListener('click',()=>socket.emit('chooseSeat',i));seatGrid.appendChild(b);
  }
  $('#spectatorBtn')?.addEventListener('click',()=>socket.emit('chooseSeat',null));
  $('#startGameBtn')?.addEventListener('click',()=>{enterFullscreen();socket.emit('startGame')});
  $('#newHandBtn')?.addEventListener('click',()=>socket.emit('newHand'));
  socket.on('roomUpdate',s=>{room=s;renderWaiting();if(s.gameActive)showView('game')});
  function renderWaiting(){
    if(!room)return;const host=room.hostId===myId;
    seatGrid.querySelectorAll('.seat-btn').forEach((b,i)=>{const id=room.seats[i],p=room.players.find(x=>x.id===id);b.classList.toggle('occupied',!!p);b.classList.toggle('mine',id===myId);b.querySelector('.seat-name').textContent=p?p.name:'Boş'});
    const list=$('#playersList');list.innerHTML='';room.players.forEach(p=>{const d=document.createElement('div');d.className='player-chip'+(p.id===room.hostId?' host':'');d.innerHTML=`<span>${escapeHtml(p.name)}</span><span class="spot">— ${p.seat!==null?'Koltuk '+(p.seat+1):'İzleyici'}</span>`;list.appendChild(d)});
    const filled=room.seats.filter(Boolean).length;$('#startGameBtn').hidden=!host;$('#startGameBtn').disabled=filled!==4;$('#startHint').textContent=host?(filled===4?'Herkes hazır — oyunu başlatabilirsin.':`Oyun başlamadan önce 4 koltuğun dolu olması gerekiyor (${filled}/4).`):'Oda kurucusunun oyunu başlatmasını bekleyin.';
  }

  // ---------- Sound ----------
  function playSound(type){if(!soundEnabled)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;if(!audioCtx)audioCtx=new AC();if(audioCtx.state==='suspended')audioCtx.resume();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);const n=audioCtx.currentTime;if(type==='tile'){o.type='triangle';o.frequency.setValueAtTime(220,n);o.frequency.exponentialRampToValueAtTime(110,n+.05);g.gain.setValueAtTime(.2,n);g.gain.linearRampToValueAtTime(.01,n+.05);o.start(n);o.stop(n+.05)}else{o.type='sine';o.frequency.setValueAtTime(350,n);o.frequency.exponentialRampToValueAtTime(580,n+.07);g.gain.setValueAtTime(.15,n);g.gain.linearRampToValueAtTime(.01,n+.07);o.start(n);o.stop(n+.07)}}
  function toggleSound(){soundEnabled=!soundEnabled;$('#sound-icon').textContent=soundEnabled?'🔊':'🔇';$('#sound-text').textContent=soundEnabled?'Ses: AÇIK':'Ses: KAPALI'}
  $('#soundBtn')?.addEventListener('click',toggleSound);

  // ---------- Game state ----------
  socket.on('gameUpdate',state=>{game=state;showView('game');syncRack();renderGame()});
  function mySeat(){const p=room?.players.find(x=>x.id===myId);return p?p.seat:null}
  function nameOf(id){const p=room?.players.find(x=>x.id===id);return p?p.name:'?'}
  const colorMap={kirmizi:'red',sari:'yellow',mavi:'blue',siyah:'black'};
  function displayColor(t){return t?.joker?(game?.okeySpec?.color||'kirmizi'):t?.color}
  function tileText(t){return t?.joker?'★':String(t?.number??'')}
  function isOkey(t){return !!(t&&(t.joker||(game?.okeySpec&&t.color===game.okeySpec.color&&t.number===game.okeySpec.number)))}
  function createTileElement(tile,slotIndex=null){
    if(!tile)return null;const el=document.createElement('div');el.className='tile '+(colorMap[displayColor(tile)]||'');
    if(isOkey(tile))el.classList.add('is-okey');el.innerHTML=isOkey(tile)?`<span>${tileText(tile)}</span><span class="star">★</span>`:tileText(tile);
    if(slotIndex!==null){el.draggable=true;wireRackTile(el,slotIndex)}return el;
  }
  function createClosedTile(){const e=document.createElement('div');e.className='tile tile-back';return e}

  function syncRack(){
    if(!game)return;const hand=game.myHand||[];const ids=hand.map(t=>t.id);const old=new Map(rackSlots.filter(Boolean).map(t=>[t.id,t]));
    const newSlots=new Array(32).fill(null);let used=new Set();
    // preserve local positions when possible
    for(let i=0;i<rackSlots.length;i++){const t=rackSlots[i];if(t&&ids.includes(t.id)&&!used.has(t.id)){newSlots[i]=hand.find(x=>x.id===t.id);used.add(t.id)}}
    let cursor=0;for(const t of hand){if(used.has(t.id))continue;while(cursor<32&&newSlots[cursor])cursor++;if(cursor<32){newSlots[cursor]=t;used.add(t.id)}}
    rackSlots=newSlots;prevHandIds=ids;
    if(game.phase==='draw'&&mySeat()===game.turnIndex){selectedSlotIndex=null;draggedIndices=[]}
  }
  function wireRackTile(el,idx){
    el.addEventListener('mousedown',e=>{if(!canEditRack())return;isMouseSelecting=true;dragSelectStart=idx;isLongPress=false;clearTimeout(longPressTimer);longPressTimer=setTimeout(()=>{isLongPress=true;draggedIndices=getContiguousBlock(idx);renderRack()},220)});
    el.addEventListener('mouseenter',()=>{if(isMouseSelecting&&dragSelectStart!==null&&dragSelectStart!==idx){clearTimeout(longPressTimer);selectRangeSlots(dragSelectStart,idx)}});
    el.addEventListener('mouseup',()=>{clearTimeout(longPressTimer);isMouseSelecting=false});el.addEventListener('mouseleave',()=>clearTimeout(longPressTimer));
    el.addEventListener('click',e=>{e.stopPropagation();if(draggedIndices.length>1)draggedIndices=[];selectSlot(idx)});
    el.addEventListener('dblclick',e=>{e.stopPropagation();if(canDiscard())socket.emit('discardTile',rackSlots[idx].id)});
    el.addEventListener('dragstart',e=>{clearTimeout(longPressTimer);isMouseSelecting=false;if(!canEditRack()){e.preventDefault();return}let sel=getSelectedIndices();draggedIndices=sel.includes(idx)&&sel.length>1?sel:(isLongPress?getContiguousBlock(idx):[idx]);e.dataTransfer.setData('action','move-rack');setCustomDragImage(e,draggedIndices.map(i=>rackSlots[i]));playSound('tile')});
    el.addEventListener('dragend',()=>{isLongPress=false;isMouseSelecting=false;clearSlotHighlights();renderRack()});
  }
  function canEditRack(){return !game?.finished&&mySeat()!==null}
  function canDraw(){return !game?.finished&&mySeat()===game?.turnIndex&&game?.phase==='draw'}
  function canDiscard(){return !game?.finished&&mySeat()===game?.turnIndex&&game?.phase==='discard'}
  function getSelectedIndices(){return [...document.querySelectorAll('.rack-slot')].map((s,i)=>s.firstChild?.classList.contains('selected')?i:null).filter(i=>i!==null)}
  function getContiguousBlock(idx){const rs=idx<16?0:16,re=rs+16;let a=idx,b=idx;while(a>rs&&rackSlots[a-1])a--;while(b<re-1&&rackSlots[b+1])b--;return Array.from({length:b-a+1},(_,i)=>a+i)}
  function selectRangeSlots(a,b){const rs=a<16?0:16,re=rs+16;draggedIndices=[];for(let i=Math.max(rs,Math.min(a,b));i<=Math.min(re-1,Math.max(a,b));i++)if(rackSlots[i])draggedIndices.push(i);renderRack()}
  function selectSlot(i){if(!rackSlots[i])return;playSound('tile');draggedIndices=[];if(selectedSlotIndex===null)selectedSlotIndex=i;else if(selectedSlotIndex===i)selectedSlotIndex=null;else{[rackSlots[selectedSlotIndex],rackSlots[i]]=[rackSlots[i],rackSlots[selectedSlotIndex]];selectedSlotIndex=null}renderRack()}
  function moveTileToExactSlot(src,target){if(!src.length||src.includes(target)&&src.length===1)return;const rs=target<16?0:16,re=rs+16;const moving=src.map(i=>rackSlots[i]);src.forEach(i=>rackSlots[i]=null);if(src.length===1&&rackSlots[target]){[rackSlots[target],rackSlots[src[0]]]=[moving[0],rackSlots[target]];return}let c=target;for(const t of moving){while(c<re&&rackSlots[c])c++;if(c>=re)break;rackSlots[c++]=t}}
  function clearSlotHighlights(){document.querySelectorAll('.rack-slot.hovered').forEach(x=>x.classList.remove('hovered'))}
  function highlightTargetSlots(i){clearSlotHighlights();const n=Math.max(1,draggedIndices.length);const end=i<16?16:32;for(let j=0;j<n&&i+j<end;j++)document.querySelectorAll('.rack-slot')[i+j]?.classList.add('hovered')}

  function setCustomDragImage(e,tiles){const box=document.createElement('div');box.style.cssText='position:absolute;left:-9999px;top:-9999px;display:flex;gap:3px';(tiles.length?tiles:[null]).forEach(t=>{const g=t?createTileElement(t):createClosedTile();if(g){g.style.position='relative';box.appendChild(g)}});document.body.appendChild(box);e.dataTransfer?.setDragImage(box,20,28);setTimeout(()=>box.remove(),100)}
  function renderRack(){const r1=$('#rack-row-1'),r2=$('#rack-row-2');r1.innerHTML='';r2.innerHTML='';for(let i=0;i<32;i++){const s=document.createElement('div');s.className='rack-slot';s.dataset.index=i;s.addEventListener('dragover',e=>{e.preventDefault();highlightTargetSlots(i)});s.addEventListener('dragleave',clearSlotHighlights);s.addEventListener('drop',e=>{e.preventDefault();clearSlotHighlights();const a=e.dataTransfer.getData('action');if(a==='draw-deck'&&canDraw()){socket.emit('drawTile','deck');return}if(a==='draw-discard'&&canDraw()){socket.emit('drawTile','discard');return}if(a==='move-rack'){moveTileToExactSlot(draggedIndices,i);draggedIndices=[];selectedSlotIndex=null;renderRack();playSound('tile')}});s.addEventListener('click',()=>selectSlot(i));if(rackSlots[i]){const t=createTileElement(rackSlots[i],i);if(selectedSlotIndex===i||draggedIndices.includes(i))t.classList.add('selected');s.appendChild(t)}(i<16?r1:r2).appendChild(s)}}

  function animateTileFly(src,dst,tile,done,closed=false){if(!src||!dst){done?.();return}const c=closed?createClosedTile():createTileElement(tile);if(!c){done?.();return}c.style.cssText=`position:fixed;top:${src.top}px;left:${src.left}px;width:${src.width}px;height:${src.height}px;z-index:99999;pointer-events:none;transition:all .32s cubic-bezier(.25,1,.5,1);box-shadow:0 8px 20px rgba(0,0,0,.6)`;document.body.appendChild(c);c.getBoundingClientRect();c.style.top=dst.top+'px';c.style.left=dst.left+'px';setTimeout(()=>{c.remove();done?.()},330)}

  function setupDeckAndDiscard(){
    const deck=$('#deck-tile'), left=$('#discard-left-spot'), finish=$('#finish-drop-zone'), pspot=$('#discard-player-spot');
    deck.addEventListener('dragstart',e=>{if(!canDraw()){e.preventDefault();return}e.dataTransfer.setData('action','draw-deck');setCustomDragImage(e,[null]);$('#rack-container').classList.add('drag-active')});
    deck.addEventListener('click',()=>{if(canDraw())socket.emit('drawTile','deck')});
    left.addEventListener('click',()=>{if(canDraw()&&game.discardTop)socket.emit('drawTile','discard')});
    left.addEventListener('dragover',e=>e.preventDefault());
    pspot.addEventListener('dragover',e=>{e.preventDefault()});pspot.addEventListener('drop',e=>{e.preventDefault();if(canDiscard()&&draggedIndices.length)socket.emit('discardTile',rackSlots[draggedIndices[0]].id)});
    finish.addEventListener('dragover',e=>{e.preventDefault();if(canDiscard())finish.classList.add('drag-over')});finish.addEventListener('dragleave',()=>finish.classList.remove('drag-over'));finish.addEventListener('drop',e=>{e.preventDefault();finish.classList.remove('drag-over');if(canDiscard()&&draggedIndices.length)socket.emit('declareWin')});
  }
  function renderGame(){
    if(!game||!room)return;const seat=mySeat();
    $('#deck-count').textContent=game.deckCount;
    const ind=$('#gosterge-holder');ind.innerHTML='';if(game.indicator)ind.appendChild(createTileElement(game.indicator));
    const oh=$('#okey-holder');oh.innerHTML='';if(game.okeySpec)oh.appendChild(createTileElement({id:'okey-display',color:game.okeySpec.color,number:game.okeySpec.number,joker:false}));
    const left=$('#discard-left-spot');left.innerHTML='';left.classList.toggle('takeable',canDraw()&&!!game.discardTop);if(game.discardTop){const t=createTileElement(game.discardTop);left.appendChild(t)}
    const top=$('#discard-top-spot');top.innerHTML='';const right=$('#discard-right-spot');right.innerHTML='';const mine=$('#discard-player-spot');mine.innerHTML='';
    if(game.discardTop)mine.appendChild(createTileElement(game.discardTop));
    const tp=room.players.find(p=>p.seat===game.turnIndex);$('#status-text').textContent=game.finished?(game.winnerId?`🏆 ${nameOf(game.winnerId)} eli bitirdi!`:'El bitti'):(tp?`Sıra: ${tp.name}${game.turnIndex===seat?' (Siz)':''} — ${game.phase==='draw'?'taş çekin':'taş atın'}`:'-');
    const seatEls={0:$('#seat-bottom'),1:$('#seat-right'),2:$('#seat-top'),3:$('#seat-left')};
    for(let s=0;s<4;s++){const pid=room.seats[s],p=room.players.find(x=>x.id===pid),el=seatEls[s];if(!el)continue;el.querySelector('.player-name').textContent=p?(p.id===myId?p.name+' (Siz)':p.name):'Boş';el.querySelector('.player-score').innerHTML=`TAŞ: <span>${pid?(s===seat?(game.myHand?.length||0):(game.otherCounts?.[pid]||0)):0}</span>`;el.classList.toggle('active-turn',game.turnIndex===s&&!game.finished)}
    const zones={1:$('#seat-right'),2:$('#seat-top'),3:$('#seat-left')};Object.values(zones).forEach(z=>z.classList.remove('active-turn'));for(let s=0;s<4;s++){if(s===seat)continue;const rel=(s-seat+4)%4,z=zones[rel];if(!z)continue;z.innerHTML='';const p=room.players.find(x=>x.seat===s);const b=document.createElement('div');b.className='remote-player';b.innerHTML=`<div class="remote-name">${escapeHtml(p?.name||'Boş')}</div><div class="mini-tiles"></div>`;const mt=b.querySelector('.mini-tiles');const n=p?game.otherCounts?.[p.id]||0:0;for(let i=0;i<n;i++)mt.appendChild(createClosedTile());z.appendChild(b);if(game.turnIndex===s&&!game.finished)z.classList.add('active-turn')}
    const seats=['seat-bottom','seat-right','seat-top','seat-left'];seats.forEach((id,i)=>$('#'+id)?.classList.toggle('active-turn',i===game.turnIndex&&!game.finished));
    renderRack();startLocalTimer();
  }
  function startLocalTimer(){clearInterval(turnTimer);if(!game||game.finished)return;document.querySelectorAll('.timer-fill').forEach(x=>x.style.width='100%');const seat=game.turnIndex;const ids=['timer-player','timer-right','timer-top','timer-left'];const bar=$('#'+ids[seat]);if(!bar)return;let w=100;turnTimer=setInterval(()=>{w-=2.5;bar.style.width=Math.max(0,w)+'%';if(w<=0){clearInterval(turnTimer)}},350)}

  function setupRack(){
    $('#sortSeriBtn').addEventListener('click',sortSeri);$('#sortColorBtn').addEventListener('click',sortByColor);$('#sortNumberBtn').addEventListener('click',sortByNumber);$('#discardBtn').addEventListener('click',()=>{if(canDiscard()&&selectedSlotIndex!==null)socket.emit('discardTile',rackSlots[selectedSlotIndex].id)});$('#finishBtn').addEventListener('click',()=>{if(canDiscard())socket.emit('declareWin')});
    setupDeckAndDiscard();window.addEventListener('mouseup',()=>{isMouseSelecting=false;dragSelectStart=null});
  }
  function sortByColor(){const a=rackSlots.filter(Boolean).sort((x,y)=>{const cx=displayColor(x),cy=displayColor(y);return cx===cy?(x.number||99)-(y.number||99):String(cx).localeCompare(String(cy))});rackSlots=new Array(32).fill(null);a.forEach((t,i)=>rackSlots[i]=t);selectedSlotIndex=null;draggedIndices=[];renderRack();playSound('tile')}
  function sortByNumber(){const a=rackSlots.filter(Boolean).sort((x,y)=>(x.number||99)-(y.number||99)||String(displayColor(x)).localeCompare(String(displayColor(y))));rackSlots=new Array(32).fill(null);a.forEach((t,i)=>rackSlots[i]=t);selectedSlotIndex=null;draggedIndices=[];renderRack();playSound('tile')}
  function sortSeri(){sortByColor();showToast('Taşlar renk ve sayıya göre dizildi. Daha gelişmiş per dizilimi server tarafına taşınabilir.')}

  // ---------- Chat ----------
  const chatPanel=$('#chatPanel'),chatMessages=$('#chatMessages');
  function toggleChat(){chatPanel.hidden=!chatPanel.hidden}
  $('#chatToggleBtn')?.addEventListener('click',toggleChat);$('#chatToggleBtn2')?.addEventListener('click',toggleChat);$('#chatCloseBtn')?.addEventListener('click',toggleChat);
  $('#chatForm')?.addEventListener('submit',e=>{e.preventDefault();const i=$('#chatInput'),t=i.value.trim();if(t)socket.emit('chatMsg',t);i.value=''})
  socket.on('chatMsg',m=>{const d=document.createElement('div');d.className='chat-msg'+(m.system?' system':'');d.innerHTML=m.system?escapeHtml(m.text):`<span class="who">${escapeHtml(m.name)}:</span>${escapeHtml(m.text)}`;chatMessages.appendChild(d);chatMessages.scrollTop=chatMessages.scrollHeight});

  // ---------- Manual win ----------
  const manualDialog=$('#manualWinDialog');
  $('#manualWinBtn')?.addEventListener('click',()=>socket.emit('claimManualWin'));
  socket.on('manualWinClaim',({claimantId,claimantName,hand})=>{if(!manualDialog)return;$('#manualWinTitle').textContent=`${claimantName} elini açtı`;const w=$('#manualWinTiles');w.innerHTML='';hand.forEach(t=>w.appendChild(createTileElement(t)));const a=$('#manualWinActions');a.innerHTML='';if(room.hostId===myId&&claimantId!==myId){for(const [txt,ok] of [['Kabul Et (Bitti)',true],['Reddet',false]]){const b=document.createElement('button');b.className='btn btn-small '+(ok?'btn-gold':'btn-ghost');b.textContent=txt;b.onclick=()=>{socket.emit('resolveManualWin',{claimantId,accepted:ok});manualDialog.hidden=true};a.appendChild(b)}}else{const b=document.createElement('button');b.className='btn btn-small btn-ghost';b.textContent='Kapat';b.onclick=()=>manualDialog.hidden=true;a.appendChild(b)}manualDialog.hidden=false});

  // ---------- Voice ----------
  $('#voiceToggleWaiting')?.addEventListener('click',toggleVoice);$('#voiceToggleGame')?.addEventListener('click',toggleVoice);
  async function toggleVoice(){voiceOn?stopVoice():await startVoice()}
  async function startVoice(){try{localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false})}catch{showToast('Mikrofon erişimi reddedildi ya da bulunamadı.');return}voiceOn=true;setVoiceButtons(true);socket.emit('voiceJoin')}
  function stopVoice(){voiceOn=false;setVoiceButtons(false);socket.emit('voiceLeave');localStream?.getTracks().forEach(t=>t.stop());localStream=null;Object.keys(peerConnections).forEach(closePeer)}
  function setVoiceButtons(on){['#voiceToggleWaiting','#voiceToggleGame'].forEach(s=>{const b=$(s);if(b){b.classList.toggle('active',on);b.textContent=on?'🔊 Ses Açık':'🎤 Sesi Aç'}})}
  function closePeer(id){peerConnections[id]?.close();delete peerConnections[id];audioEls[id]?.remove();delete audioEls[id]}
  function ensurePeer(id,init){if(peerConnections[id])return peerConnections[id];const pc=new RTCPeerConnection(rtcConfig);peerConnections[id]=pc;localStream?.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>e.candidate&&socket.emit('voiceSignal',{to:id,signal:{type:'ice',candidate:e.candidate}});pc.ontrack=e=>{let a=audioEls[id];if(!a){a=document.createElement('audio');a.autoplay=true;document.body.appendChild(a);audioEls[id]=a}a.srcObject=e.streams[0]};if(init)pc.onnegotiationneeded=async()=>{const o=await pc.createOffer();await pc.setLocalDescription(o);socket.emit('voiceSignal',{to:id,signal:{type:'offer',sdp:pc.localDescription}})};return pc}
  socket.on('voicePeerJoined',id=>{if(voiceOn)ensurePeer(id,true)});socket.on('voicePeerLeft',closePeer);socket.on('voiceSignal',async({from,signal})=>{if(!voiceOn)return;const pc=ensurePeer(from,false);if(signal.type==='offer'){await pc.setRemoteDescription(signal.sdp);const a=await pc.createAnswer();await pc.setLocalDescription(a);socket.emit('voiceSignal',{to:from,signal:{type:'answer',sdp:pc.localDescription}})}else if(signal.type==='answer'){await pc.setRemoteDescription(signal.sdp)}else if(signal.type==='ice'){try{await pc.addIceCandidate(signal.candidate)}catch{}}});

  // ---------- Touch / init ----------
  document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault()},{passive:false});
  setupRack();showView('lobby');
})();
