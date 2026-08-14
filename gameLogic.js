// Klasik Düz Okey - saf oyun kuralları
const COLORS = ['kirmizi', 'sari', 'mavi', 'siyah'];
let uidCounter = 1;
function nextId(){ return 'T' + (uidCounter++); }

function createDeck(){
  const deck=[];
  for(const color of COLORS) for(let n=1;n<=13;n++) for(let copy=0;copy<2;copy++)
    deck.push({id:nextId(),color,number:n,joker:false});
  deck.push({id:nextId(),color:null,number:null,joker:true});
  deck.push({id:nextId(),color:null,number:null,joker:true});
  return deck;
}
function shuffle(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function indicatorToOkey(indicator){
  if(indicator.joker) return {color:'kirmizi',number:1};
  return {color:indicator.color,number:indicator.number===13?1:indicator.number+1};
}
function isOkeyTile(tile,okeySpec){ return !!tile && (tile.joker || (tile.color===okeySpec.color && tile.number===okeySpec.number)); }

function startNewHand(seats){
  let deck=shuffle(createDeck());
  const indicator=deck.pop();
  const okeySpec=indicatorToOkey(indicator);
  const hands={};
  const dealerIndex=Math.floor(Math.random()*4);
  for(let i=0;i<4;i++){
    const pid=seats[i];
    hands[pid]=deck.splice(0,i===dealerIndex?15:14);
  }
  return {
    deck,discardPile:[],discardBySeat:[null,null,null,null],indicator,okeySpec,hands,
    dealerIndex,turnIndex:dealerIndex,phase:'discard',finished:false,winnerId:null,
    turnStartedAt:Date.now(),turnDuration:20000
  };
}

function normalize(hand,okeySpec){
  const normals=[]; let wildCount=0;
  for(const t of hand){
    if(isOkeyTile(t,okeySpec)) wildCount++;
    else normals.push({color:t.color,number:t.number});
  }
  return {normals,wildCount};
}

function checkSevenPairs(normals,wildCount){
  const counts=new Map();
  for(const t of normals){const k=t.color+'-'+t.number;counts.set(k,(counts.get(k)||0)+1);}
  let pairs=0, singles=0;
  for(const c of counts.values()){pairs+=Math.floor(c/2); if(c%2) singles++;}
  if(singles>wildCount) return false;
  return pairs+singles===7;
}

function canPartition(normals,wildCount){
  const sorted=normals.slice().sort((a,b)=>a.color===b.color?a.number-b.number:a.color.localeCompare(b.color));
  function sortArr(a){return a.slice().sort((x,y)=>x.color===y.color?x.number-y.number:x.color.localeCompare(y.color));}
  function tryRun(arr,w,length){
    const first=arr[0]; let rest=arr.slice(1), cursor=first.number;
    for(let need=1;need<length;need++){
      cursor++;
      if(cursor>13)return null;
      const idx=rest.findIndex(t=>t.color===first.color&&t.number===cursor);
      if(idx!==-1) rest=rest.slice(0,idx).concat(rest.slice(idx+1));
      else if(w>0) w--; else return null;
    }
    return {rest,wilds:w};
  }
  function trySet(arr,w,length){
    const first=arr[0]; let pool=arr.slice(1).filter(t=>t.number===first.number);
    const others=arr.slice(1).filter(t=>t.number!==first.number);
    const used=new Set([first.color]);
    for(let need=1;need<length;need++){
      const idx=pool.findIndex(t=>!used.has(t.color));
      if(idx!==-1){used.add(pool[idx].color);pool=pool.slice(0,idx).concat(pool.slice(idx+1));}
      else if(w>0) w--; else return null;
    }
    return {rest:others.concat(pool),wilds:w};
  }
  function solve(arr,w){
    if(arr.length===0) return w%3===0;
    for(const len of [4,3]){
      const r=tryRun(arr,w,len); if(r&&solve(sortArr(r.rest),r.wilds)) return true;
      const s=trySet(arr,w,len); if(s&&solve(sortArr(s.rest),s.wilds)) return true;
    }
    return false;
  }
  return solve(sorted,wildCount);
}

function validateHand14(hand,okeySpec){
  if(!Array.isArray(hand)||hand.length!==14)return false;
  const {normals,wildCount}=normalize(hand,okeySpec);
  if(checkSevenPairs(normals,wildCount))return true;
  return canPartition(normals,wildCount);
}
function validateWinningHand(hand,okeySpec){
  if(!Array.isArray(hand)||hand.length!==15)return false;
  const {normals,wildCount}=normalize(hand,okeySpec);
  if(checkSevenPairs(normals,wildCount))return true;
  return canPartition(normals,wildCount);
}

module.exports={createDeck,shuffle,startNewHand,indicatorToOkey,isOkeyTile,validateWinningHand,validateHand14,COLORS};
