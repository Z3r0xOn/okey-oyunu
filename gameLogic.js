// gameLogic.js — Okey oyununun kurallarını içeren saf (framework'ten bağımsız) mantık katmanı.

const COLORS = ['kirmizi', 'sari', 'mavi', 'siyah']; // kırmızı, sarı, mavi, siyah

let uidCounter = 1;
function nextId() {
  return 'T' + (uidCounter++);
}

/** 106 taşlık desteyi oluşturur: 4 renk x 1-13 x 2 kopya + 2 sahte okey. */
function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let n = 1; n <= 13; n++) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: nextId(), color, number: n, joker: false });
      }
    }
  }
  deck.push({ id: nextId(), color: null, number: null, joker: true });
  deck.push({ id: nextId(), color: null, number: null, joker: true });
  return deck;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Yeni bir el başlatır: deste karılır, gösterge açılır, 4 oyuncuya dağıtılır. */
function startNewHand(seats) {
  // seats: 4 elemanlı dizi, dolu koltuklar oyuncu id'si, boşlar null (oyun 4 dolu koltukla başlar)
  let deck = shuffle(createDeck());
  const indicator = deck.pop();
  const okeySpec = indicatorToOkey(indicator);

  const hands = {};
  const dealerIndex = Math.floor(Math.random() * 4);
  for (let i = 0; i < 4; i++) {
    const playerId = seats[i];
    const count = i === dealerIndex ? 15 : 14;
    hands[playerId] = deck.splice(0, count);
  }

  return {
    deck,
    discardPile: [],
    indicator,
    okeySpec,
    hands,
    dealerIndex,
    turnIndex: dealerIndex, // dealer starts by discarding (already has 15)
    phase: 'discard', // 'draw' | 'discard'
    finished: false,
    winnerId: null
  };
}

function indicatorToOkey(indicator) {
  if (indicator.joker) {
    // Gösterge sahte okey gelirse, okey taşı olarak 1-kırmızı kullanılır (yaygın konvansiyon).
    return { color: 'kirmizi', number: 1 };
  }
  const nextNumber = indicator.number === 13 ? 1 : indicator.number + 1;
  return { color: indicator.color, number: nextNumber };
}

function isOkeyTile(tile, okeySpec) {
  if (tile.joker) return true;
  return tile.color === okeySpec.color && tile.number === okeySpec.number;
}

/**
 * 15 taşlık bir elin geçerli bir "bitiş" eli olup olmadığını kontrol eder.
 * Kurallar (basitleştirilmiş): tüm taşlar 3 ya da 4'lük gruplara ayrılabilmeli.
 * Grup tipleri: aynı renk ardışık sayılar (seri) ya da aynı sayı farklı renkler (set).
 * Sahte okey ve gösterge-okey taşları joker (her taşın yerine geçebilir) olarak kullanılabilir.
 */
function validateWinningHand(hand, okeySpec) {
  if (hand.length !== 15) return false;

  const normals = [];
  let wildCount = 0;
  for (const t of hand) {
    if (isOkeyTile(t, okeySpec)) wildCount++;
    else normals.push({ color: t.color, number: t.number });
  }

  // Özel durum: 7 çift + 1 okey (çift okey bitişi)
  if (checkPairsWin(normals, wildCount)) return true;

  // Genel durum: grup grup ayırma (backtracking)
  return canPartition(normals, wildCount);
}

function checkPairsWin(normals, wildCount) {
  // 7 çift (aynı renk+sayı) + kalan 1 taş okey olmalı.
  if (normals.length + wildCount !== 15) return false;
  const counts = new Map();
  for (const t of normals) {
    const key = t.color + '-' + t.number;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let pairs = 0;
  let leftovers = 0;
  for (const c of counts.values()) {
    pairs += Math.floor(c / 2);
    leftovers += c % 2;
  }
  const neededWildForPairs = leftovers;
  const usedWild = neededWildForPairs;
  const remainingWild = wildCount - usedWild;
  if (remainingWild < 0) return false;
  const finalPairs = pairs + leftovers;
  return finalPairs === 7 && remainingWild === 1;
}

/** normals: {color,number}[]  wildCount: kaç tane joker kullanılabilir. Tümü 3/4'lük gruplara ayrılabiliyor mu? */
function canPartition(normals, wildCount) {
  if (normals.length === 0) return wildCount % 3 === 0 || wildCount === 0 && true;
  const sorted = normals.slice().sort((a, b) => (a.color === b.color ? a.number - b.number : a.color.localeCompare(b.color)));

  function tryRun(arr, wilds, length) {
    const first = arr[0];
    let rest = arr.slice(1);
    let need = length - 1;
    let cursor = first.number;
    let w = wilds;
    while (need > 0) {
      cursor += 1;
      if (cursor > 13) return null;
      const idx = rest.findIndex(t => t.color === first.color && t.number === cursor);
      if (idx !== -1) {
        rest = rest.slice(0, idx).concat(rest.slice(idx + 1));
      } else if (w > 0) {
        w -= 1;
      } else {
        return null;
      }
      need -= 1;
    }
    return { rest, wilds: w };
  }

  function trySet(arr, wilds, length) {
    const first = arr[0];
    let rest = arr.slice(1).filter(t => t.number === first.number);
    let others = arr.slice(1).filter(t => t.number !== first.number);
    const usedColors = new Set([first.color]);
    let w = wilds;
    let need = length - 1;
    let pool = rest.slice();
    while (need > 0) {
      const idx = pool.findIndex(t => !usedColors.has(t.color));
      if (idx !== -1) {
        usedColors.add(pool[idx].color);
        pool = pool.slice(0, idx).concat(pool.slice(idx + 1));
      } else if (w > 0) {
        w -= 1;
      } else {
        return null;
      }
      need -= 1;
    }
    const remaining = others.concat(pool);
    return { rest: remaining, wilds: w };
  }

  function solve(arr, wilds) {
    if (arr.length === 0) return true;
    for (const length of [4, 3]) {
      const runResult = tryRun(arr, wilds, length);
      if (runResult && solve(sortArr(runResult.rest), runResult.wilds)) return true;
      const setResult = trySet(arr, wilds, length);
      if (setResult && solve(sortArr(setResult.rest), setResult.wilds)) return true;
    }
    return false;
  }

  function sortArr(arr) {
    return arr.slice().sort((a, b) => (a.color === b.color ? a.number - b.number : a.color.localeCompare(b.color)));
  }

  return solve(sorted, wildCount);
}

module.exports = {
  createDeck,
  shuffle,
  startNewHand,
  indicatorToOkey,
  isOkeyTile,
  validateWinningHand,
  COLORS
};
