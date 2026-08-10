// gameLogic.js — Düz (klasik) Okey kuralları.
// 106 taş: 4 renk x 1-13 x 2 + 2 sahte okey.

const COLORS = ['kirmizi', 'sari', 'mavi', 'siyah'];
let uidCounter = 1;

function nextId() {
  return 'T' + (uidCounter++);
}

function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let number = 1; number <= 13; number++) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: nextId(), color, number, joker: false, fake: false });
      }
    }
  }
  deck.push({ id: nextId(), color: null, number: null, joker: true, fake: true });
  deck.push({ id: nextId(), color: null, number: null, joker: true, fake: true });
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

/**
 * Klasik düz Okey başlangıcı:
 * 1 oyuncu 15, diğer 3 oyuncu 14 taş alır. 15 taşı alan oyuncu başlar ve taş atar.
 * Gösterge açılır; göstergenin aynı renkte bir üstü okeydir.
 */
function startNewHand(seats) {
  if (!Array.isArray(seats) || seats.length !== 4 || seats.some(x => !x)) {
    throw new Error('Düz Okey 4 dolu koltukla başlatılmalıdır.');
  }

  let deck = shuffle(createDeck());
  let indicator = deck.pop();
  // Gösterge sahte okey gelirse yeniden gösterge açılır; sahte taş tekrar kupaya döner.
  while (indicator.joker) {
    deck.push(indicator);
    deck = shuffle(deck);
    indicator = deck.pop();
  }
  const okeySpec = indicatorToOkey(indicator);
  const hands = {};
  const dealerIndex = Math.floor(Math.random() * 4);

  for (let i = 0; i < 4; i++) {
    const playerId = seats[i];
    hands[playerId] = deck.splice(0, i === dealerIndex ? 15 : 14);
  }

  return {
    deck,
    discardPile: [],
    indicator,
    okeySpec,
    hands,
    dealerIndex,
    turnIndex: dealerIndex,
    phase: 'discard', // Başlayan oyuncunun zaten 15 taşı vardır.
    finished: false,
    winnerId: null,
    winningDiscardId: null
  };
}

function indicatorToOkey(indicator) {
  // Sahte okeyin kendi numarası yoktur. Klasik masalarda bu durumda yeni gösterge açılır.
  // Sunucu tarafında startNewHand bu durumu yeniden dağıtımla çözer.
  if (indicator.joker) return null;
  return {
    color: indicator.color,
    number: indicator.number === 13 ? 1 : indicator.number + 1
  };
}

function isOkeyTile(tile, okeySpec) {
  if (!tile) return false;
  if (tile.joker) return true; // Gerçek okey + sahte okey joker görevi görür.
  return !!okeySpec && tile.color === okeySpec.color && tile.number === okeySpec.number;
}

function validateWinningHand(hand, okeySpec) {
  if (!Array.isArray(hand) || hand.length !== 14 || !okeySpec) return false;

  const normals = [];
  let wildCount = 0;
  for (const tile of hand) {
    if (isOkeyTile(tile, okeySpec)) wildCount++;
    else normals.push({ color: tile.color, number: tile.number });
  }

  // Klasik düz Okey'de normal bitiş: 3/4'lük seri veya gruplar.
  if (canPartition(normals, wildCount)) return true;

  // 7 çift de geçerli klasik bitiştir.
  return checkPairsWin(normals, wildCount);
}

function checkPairsWin(normals, wildCount) {
  if (normals.length + wildCount !== 14) return false;

  const counts = new Map();
  for (const tile of normals) {
    const key = tile.color + '-' + tile.number;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let pairs = 0;
  let singles = 0;
  for (const count of counts.values()) {
    pairs += Math.floor(count / 2);
    singles += count % 2;
  }

  // Her tek taş bir jokerle eşleşebilir. Kalan jokerler ikişerli çift oluşturur.
  if (singles > wildCount) return false;
  const remainingWild = wildCount - singles;
  pairs += singles + Math.floor(remainingWild / 2);
  return pairs === 7;
}

function canPartition(normals, wildCount) {
  if (normals.length === 0) return wildCount % 3 === 0;

  const sorted = sortTiles(normals);
  const memo = new Map();

  function keyFor(arr, wilds) {
    return arr.map(t => `${t.color[0]}${t.number}`).join(',') + '|' + wilds;
  }

  function takeIndex(arr, idx) {
    return arr.slice(0, idx).concat(arr.slice(idx + 1));
  }

  function solve(arr, wilds) {
    if (arr.length === 0) return wilds % 3 === 0;
    if (wilds < 0) return false;

    const key = keyFor(arr, wilds);
    if (memo.has(key)) return memo.get(key);

    const first = arr[0];

    // Seri: aynı renkte ardışık 3 veya 4 taş. 13'ten sonra 1'e sarma yoktur.
    for (const length of [3, 4]) {
      let remaining = arr.slice(1);
      let needWild = 0;
      let valid = true;
      for (let n = first.number + 1; n < first.number + length; n++) {
        const idx = remaining.findIndex(t => t.color === first.color && t.number === n);
        if (idx >= 0) remaining = takeIndex(remaining, idx);
        else needWild++;
      }
      if (valid && needWild <= wilds && solve(sortTiles(remaining), wilds - needWild)) {
        memo.set(key, true);
        return true;
      }
    }

    // Grup: aynı sayı, farklı renklerden 3 veya 4 taş.
    for (const length of [3, 4]) {
      const usedColors = new Set([first.color]);
      let remaining = arr.slice(1);
      let needWild = 0;

      while (usedColors.size < length) {
        const idx = remaining.findIndex(t => t.number === first.number && !usedColors.has(t.color));
        if (idx >= 0) {
          usedColors.add(remaining[idx].color);
          remaining = takeIndex(remaining, idx);
        } else {
          needWild++;
          usedColors.add(`__wild_${needWild}`);
        }
      }

      if (needWild <= wilds && solve(sortTiles(remaining), wilds - needWild)) {
        memo.set(key, true);
        return true;
      }
    }

    memo.set(key, false);
    return false;
  }

  return solve(sorted, wildCount);
}

function sortTiles(arr) {
  const order = new Map(COLORS.map((c, i) => [c, i]));
  return arr.slice().sort((a, b) => {
    if (a.color === b.color) return a.number - b.number;
    return (order.get(a.color) ?? 99) - (order.get(b.color) ?? 99);
  });
}

/** 15 taşlık elde, atılacak taşı bulup kalan 14 taşın bitip bitmediğini kontrol eder. */
function findWinningDiscard(hand, okeySpec) {
  if (!Array.isArray(hand) || hand.length !== 15) return null;
  for (const tile of hand) {
    const remaining = hand.filter(t => t.id !== tile.id);
    if (validateWinningHand(remaining, okeySpec)) return tile;
  }
  return null;
}

module.exports = {
  createDeck,
  shuffle,
  startNewHand,
  indicatorToOkey,
  isOkeyTile,
  validateWinningHand,
  findWinningDiscard,
  COLORS
};
