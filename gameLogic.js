// gameLogic.js — 51 Okey kurallarını içeren saf (framework'ten bağımsız) mantık katmanı.
//
// KURAL ÖZETİ (51 Okey):
//  - 106 taş, gösterge açılır, okey belirlenir (aynı standart okey gibi).
//  - Dağıtım: 15-14-14-14. 15 alan oyuncu ilk oynar (ilk turunda çekmeden atar).
//  - Her turda: kupadan ya da ortadaki (atılmış) taştan 1 taş çekilir -> istenirse
//    masaya "per" (aynı renk ardışık seri, uzunluk >= 3) veya "çift" (eş taş grupları,
//    açılışta en az 4 çift) açılır ve/veya masadaki perlere taş işlenir -> 1 taş atılır.
//  - Bir oyuncunun MASAYA İLK açtığı per'in değeri (temsil ettiği sayıların toplamı):
//      * O ana kadar kimse per açmadıysa >= 51 olmalı.
//      * Biri açtıysa, son açılan per değerinden BÜYÜK olmalı.
//    Çift açmak için ilk açılışta en az 4 çift (8 taş) gerekir, toplam şartı yoktur.
//    Bir oyuncu bir kez açtıktan ("el açtı") sonra, sonraki perleri/çiftleri bu şartlara
//    tabi değildir; sadece geçerli bir per/çift olmaları yeterlidir.
//  - Ortadan (atılmış taştan) çekilen taş, O TUR İÇİNDE mutlaka bir açma ya da işleme
//    hamlesinde kullanılmak zorundadır.
//  - Masadaki bir per'e eklenebilecek (işlenebilecek) bir taşı atan oyuncuya 51 puan
//    ceza yazılır ("işlek taş atma cezası").
//  - Elini tamamen masaya açan/işleyen oyuncu (eli 0 taşa inen) eli kazanır.
//  - Puanlama: kazanana -51 (ceza hanesinden düşülür), diğerleri elde kalan taşların
//    değerleri toplamı kadar ceza alır. Okey/sahte okey elde kalırsa sabit 20 puan
//    ceza sayılır (basitleştirilmiş ev kuralı — masada iken elbette normal değerinde işlenebilir).
//  - Kupa biterse (kimse bitiremeden) el berabere biter, -51 bonusu uygulanmaz.

const COLORS = ['kirmizi', 'sari', 'mavi', 'siyah']; // kırmızı, sarı, mavi, siyah
const WILD_LEFTOVER_PENALTY = 20;
const OPEN_RUN_THRESHOLD = 51;
const OPEN_PAIR_MIN_PAIRS = 4;
const WORKABLE_DISCARD_PENALTY = 51;

let uidCounter = 1;
function nextId() {
  return 'T' + (uidCounter++);
}
let meldUidCounter = 1;
function nextMeldId() {
  return 'M' + (meldUidCounter++);
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

/** Yeni bir el başlatır: deste karılır, gösterge açılır, 4 oyuncuya dağıtılır. */
function startNewHand(seats) {
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

  const openedBy = {};
  seats.forEach(pid => { if (pid) openedBy[pid] = false; });

  return {
    deck,
    discardPile: [],
    indicator,
    okeySpec,
    hands,
    melds: [],          // { id, kind: 'run'|'pair', color?, start?, tiles: [tile,...] }
    openedBy,            // playerId -> bool ("el açtı mı")
    runOpenValue: 0,     // en son per açılışında kullanılan değer (0 = henüz kimse açmadı)
    dealerIndex,
    turnIndex: dealerIndex,
    phase: 'discard',    // dealer 15 taşla başlar: 'draw' | 'discard'. Dealer çekmeden atar -> 'discard'
    drawSource: null,
    mustUseDrawnTile: false,
    drawnTileId: null,
    usedDrawnTileInMeld: false,
    finished: false,
    winnerId: null,
    scores: null         // el bitince: { playerId: delta }
  };
}

// ---------------- per / çift doğrulama ----------------

/**
 * Verilen taşların geçerli bir "per" (aynı renk, ardışık, uzunluk>=3) oluşturup
 * oluşturamayacağını kontrol eder. Joker/sahte-okey taşları boşluk doldurucu olarak kullanılabilir.
 * Döner: null ya da { color, start, length, value }
 */
function tryBuildRun(tiles, okeySpec) {
  if (tiles.length < 3) return null;
  const normals = [];
  let wildCount = 0;
  for (const t of tiles) {
    if (isOkeyTile(t, okeySpec)) wildCount++;
    else normals.push(t);
  }
  if (normals.length === 0) return null; // sadece jokerlerle per belirlenemez (basitleştirme)
  const color = normals[0].color;
  if (!normals.every(t => t.color === color)) return null;
  const nums = normals.map(t => t.number);
  if (new Set(nums).size !== nums.length) return null; // aynı sayı iki kez olamaz

  const length = tiles.length;
  const minN = Math.min(...nums);
  const maxN = Math.max(...nums);
  const maxPossibleStart = Math.min(minN, 13 - length + 1);
  if (maxPossibleStart < 1) return null;

  let bestStart = null;
  for (let s = maxPossibleStart; s >= 1; s--) {
    if (s + length - 1 >= maxN) { bestStart = s; break; }
  }
  if (bestStart === null) return null;

  const value = (length * (2 * bestStart + length - 1)) / 2; // ardışık sayı toplamı
  return { color, start: bestStart, length, value };
}

/**
 * Verilen taşların geçerli bir "çift" grubu (eş taşlardan oluşan, çift sayıda taş)
 * oluşturup oluşturamayacağını kontrol eder.
 * Döner: null ya da { pairs }
 */
function tryBuildPairs(tiles, okeySpec) {
  if (tiles.length < 2 || tiles.length % 2 !== 0) return null;
  const normals = [];
  let wildCount = 0;
  for (const t of tiles) {
    if (isOkeyTile(t, okeySpec)) wildCount++;
    else normals.push(t);
  }
  const counts = new Map();
  for (const t of normals) {
    const key = t.color + '-' + t.number;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let pairs = 0;
  let neededWild = 0;
  for (const c of counts.values()) {
    pairs += Math.floor(c / 2);
    if (c % 2 === 1) neededWild += 1;
  }
  if (neededWild > wildCount) return null;
  const leftoverWild = wildCount - neededWild;
  if (leftoverWild % 2 !== 0) return null;
  pairs += neededWild + Math.floor(leftoverWild / 2);
  if (pairs * 2 !== tiles.length) return null;
  return { pairs };
}

/**
 * Bir oyuncunun elinden seçtiği taşlarla masaya yeni bir per/çift açmasını doğrular.
 * kind: 'run' | 'pair'
 * Döner: { ok: bool, error?: string, meld?: {...} }
 */
function validateOpenMeld(kind, tiles, okeySpec, alreadyOpened, runOpenValue) {
  if (kind === 'run') {
    const built = tryBuildRun(tiles, okeySpec);
    if (!built) return { ok: false, error: 'Geçerli bir per değil (aynı renk, en az 3 ardışık taş olmalı).' };
    if (!alreadyOpened) {
      if (runOpenValue === 0) {
        if (built.value < OPEN_RUN_THRESHOLD) {
          return { ok: false, error: `El açmak için per değeri en az ${OPEN_RUN_THRESHOLD} olmalı (bu per: ${built.value}).` };
        }
      } else if (built.value <= runOpenValue) {
        return { ok: false, error: `Bu per, son açılan per değerinden (${runOpenValue}) büyük olmalı (bu per: ${built.value}).` };
      }
    }
    return { ok: true, meld: { id: nextMeldId(), kind: 'run', color: built.color, start: built.start, tiles: orderRunTiles(tiles, okeySpec, built) } };
  }
  if (kind === 'pair') {
    const built = tryBuildPairs(tiles, okeySpec);
    if (!built) return { ok: false, error: 'Geçerli bir çift grubu değil (eş taşlardan oluşan, çift sayıda taş olmalı).' };
    if (!alreadyOpened && built.pairs < OPEN_PAIR_MIN_PAIRS) {
      return { ok: false, error: `El açmak için en az ${OPEN_PAIR_MIN_PAIRS} çift gerekir (bu grup: ${built.pairs} çift).` };
    }
    return { ok: true, meld: { id: nextMeldId(), kind: 'pair', tiles: tiles.slice() } };
  }
  return { ok: false, error: 'Bilinmeyen açma türü.' };
}

/** tryBuildRun sonucuna göre taşları start..start+length-1 sırasına diz (index=temsil ettiği sayı-start). */
function orderRunTiles(tiles, okeySpec, built) {
  const normals = tiles.filter(t => !isOkeyTile(t, okeySpec));
  const wilds = tiles.filter(t => isOkeyTile(t, okeySpec));
  const slots = new Array(built.length).fill(null);
  for (const t of normals) {
    slots[t.number - built.start] = t;
  }
  let wi = 0;
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) slots[i] = wilds[wi++];
  }
  return slots;
}

/**
 * Elden tek bir taşın, mevcut bir "per" masasına (başa ya da sona) eklenip eklenemeyeceğini kontrol eder.
 * Döner: { ok, side: 'front'|'back' } ya da { ok:false }
 */
function canAttachToRunMeld(meld, tile, okeySpec) {
  if (meld.kind !== 'run') return { ok: false };
  const isWild = isOkeyTile(tile, okeySpec);
  const frontNumber = meld.start - 1;
  const backNumber = meld.start + meld.tiles.length;
  if (frontNumber >= 1 && (isWild || (tile.color === meld.color && tile.number === frontNumber))) {
    return { ok: true, side: 'front' };
  }
  if (backNumber <= 13 && (isWild || (tile.color === meld.color && tile.number === backNumber))) {
    return { ok: true, side: 'back' };
  }
  return { ok: false };
}

function attachToRunMeld(meld, tile, side) {
  if (side === 'front') {
    meld.tiles.unshift(tile);
    meld.start -= 1;
  } else {
    meld.tiles.push(tile);
  }
}

/** Bir taşın, masadaki herhangi bir per'e işlenebilir ("işlek") olup olmadığını kontrol eder. */
function isWorkableTile(melds, tile, okeySpec) {
  for (const m of melds) {
    if (canAttachToRunMeld(m, tile, okeySpec).ok) return true;
  }
  return false;
}

/** Elde kalan taşların ceza değeri. */
function handPenaltyValue(hand, okeySpec) {
  let sum = 0;
  for (const t of hand) {
    sum += isOkeyTile(t, okeySpec) ? WILD_LEFTOVER_PENALTY : t.number;
  }
  return sum;
}

/** El bitince (kazananlı ya da berabere) puan değişimlerini hesaplar. */
function computeHandScores(g, playerIds) {
  const deltas = {};
  for (const pid of playerIds) {
    if (g.winnerId && pid === g.winnerId) {
      deltas[pid] = -OPEN_RUN_THRESHOLD;
    } else {
      deltas[pid] = handPenaltyValue(g.hands[pid] || [], g.okeySpec);
    }
  }
  return deltas;
}

module.exports = {
  COLORS,
  OPEN_RUN_THRESHOLD,
  OPEN_PAIR_MIN_PAIRS,
  WORKABLE_DISCARD_PENALTY,
  WILD_LEFTOVER_PENALTY,
  createDeck,
  shuffle,
  startNewHand,
  indicatorToOkey,
  isOkeyTile,
  tryBuildRun,
  tryBuildPairs,
  validateOpenMeld,
  canAttachToRunMeld,
  attachToRunMeld,
  isWorkableTile,
  handPenaltyValue,
  computeHandScores
};
