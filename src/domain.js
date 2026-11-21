'use strict';

function comb(n, k) {
  if (k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n - k) k = n - k;
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return r;
}

function isInt(v) { return Number.isInteger(v); }

function validateDeckConfiguration(deckSize, handSize, outside) {
  const errors = [];
  if (!isInt(deckSize) || deckSize < 1) errors.push('deckSize must be an integer >= 1');
  if (!isInt(handSize) || handSize < 0) errors.push('handSize must be an integer >= 0');
  if (!isInt(outside) || outside < 0) errors.push('outside must be an integer >= 0');
  if (errors.length === 0 && handSize + outside > deckSize) errors.push('handSize + outside must be <= deckSize');
  return errors;
}

function DeckConfiguration(deckSize, handSize, outside) {
  const errors = validateDeckConfiguration(deckSize, handSize, outside);
  if (errors.length) throw new Error(errors.join('; '));
  return Object.freeze({ deckSize, handSize, outside });
}

const CONDITION_TYPES = ['drawAtLeast', 'drawExactly', 'remainAtLeast', 'remainExactly'];

function validateCardEntry(card, deckSize) {
  const errors = [];
  if (!card || typeof card.name !== 'string') errors.push('card name must be a string');
  if (!isInt(card.copies) || card.copies < 0) errors.push('copies must be an integer >= 0');
  if (isInt(card.copies) && isInt(deckSize) && card.copies > deckSize) errors.push('copies must be <= deckSize');
  return errors;
}

function CardEntry(name, copies) {
  if (typeof name !== 'string') throw new Error('card name must be a string');
  if (!isInt(copies) || copies < 0) throw new Error('copies must be an integer >= 0');
  return Object.freeze({ name, copies });
}

function DrawCondition(cardIndex, type, needed, enabled) {
  if (!isInt(cardIndex) || cardIndex < 0) throw new Error('cardIndex must be an integer >= 0');
  if (!CONDITION_TYPES.includes(type)) throw new Error('unknown condition type: ' + type);
  if (!isInt(needed) || needed < 0) throw new Error('needed must be an integer >= 0');
  return Object.freeze({ cardIndex, type, needed, enabled: enabled !== false });
}

function ConditionCombination(name, conditions, enabled) {
  if (typeof name !== 'string') throw new Error('combination name must be a string');
  if (!Array.isArray(conditions)) throw new Error('conditions must be an array');
  return Object.freeze({ name, conditions, enabled: enabled !== false });
}

const MULLIGAN_MODES = ['none', 'noChoiceNoDup', 'noChoiceDup', 'choiceNoDup', 'choiceDup'];

function MulliganPolicy(mode, count) {
  if (!MULLIGAN_MODES.includes(mode)) throw new Error('unknown mulligan mode: ' + mode);
  const c = count === undefined ? 1 : count;
  if (!isInt(c) || c < 0) throw new Error('mulligan count must be an integer >= 0');
  if (mode === 'none' && c !== 0) return Object.freeze({ mode, count: 0 });
  return Object.freeze({ mode, count: c });
}

function validateCalculationRequest(req) {
  const errors = [];
  if (!req) return ['request is required'];
  errors.push(...validateDeckConfiguration(req.deckSize, req.handSize, req.outside));
  if (!Array.isArray(req.cards) || req.cards.length === 0) {
    errors.push('at least one card is required');
  } else {
    let total = 0;
    req.cards.forEach((c) => {
      errors.push(...validateCardEntry(c, req.deckSize));
      if (isInt(c.copies)) total += c.copies;
    });
    if (isInt(req.deckSize) && total > req.deckSize) errors.push('total copies must be <= deckSize');
  }
  if (!Array.isArray(req.combinations) || req.combinations.length === 0) {
    errors.push('at least one combination is required');
  } else {
    if (req.combinations.length > 31) errors.push('at most 31 combinations are allowed');
    req.combinations.forEach((combo, ci) => {
      if (!Array.isArray(combo.conditions)) { errors.push('combination ' + ci + ' conditions must be an array'); return; }
      combo.conditions.forEach((cond) => {
        if (!isInt(cond.cardIndex) || cond.cardIndex < 0 || (Array.isArray(req.cards) && cond.cardIndex >= req.cards.length)) errors.push('condition cardIndex out of range');
        if (!CONDITION_TYPES.includes(cond.type)) errors.push('unknown condition type');
        if (!isInt(cond.needed) || cond.needed < 0) errors.push('needed must be an integer >= 0');
      });
    });
  }
  return errors;
}

function CalculationRequest(deckSize, handSize, outside, cards, combinations, mulligan) {
  const req = { deckSize, handSize, outside, cards, combinations, mulligan: mulligan || MulliganPolicy('none', 0) };
  const errors = validateCalculationRequest(req);
  if (errors.length) throw new Error(errors.join('; '));
  return Object.freeze(req);
}

function conditionSatisfied(cond, drawn, remaining) {
  const d = drawn[cond.cardIndex];
  const r = remaining[cond.cardIndex];
  if (cond.type === 'drawAtLeast') return d >= cond.needed;
  if (cond.type === 'drawExactly') return d === cond.needed;
  if (cond.type === 'remainAtLeast') return r >= cond.needed;
  return r === cond.needed;
}

function combinationSatisfied(combo, drawn, remaining) {
  if (combo.enabled === false) return false;
  return combo.conditions.every((c) => c.enabled === false || conditionSatisfied(c, drawn, remaining));
}

function anyCombinationSatisfied(combinations, drawn, remaining) {
  return combinations.some((combo) => combinationSatisfied(combo, drawn, remaining));
}

function drawOnlySatisfied(combinations, drawn) {
  return combinations.some((combo) => {
    if (combo.enabled === false) return false;
    return combo.conditions.every((c) => {
      if (c.enabled === false) return true;
      if (c.type === 'drawAtLeast') return drawn[c.cardIndex] >= c.needed;
      if (c.type === 'drawExactly') return drawn[c.cardIndex] === c.needed;
      return true;
    });
  });
}

function handDistribution(counts, deckSize, handSize) {
  const n = counts.length;
  const other = deckSize - counts.reduce((a, b) => a + b, 0);
  const total = comb(deckSize, handSize);
  const out = [];
  const drawn = new Array(n).fill(0);
  (function rec(i, left, ways) {
    if (i === n) {
      const p = ways * comb(other, left) / total;
      if (p > 0) out.push({ drawn: drawn.slice(), p });
      return;
    }
    const max = Math.min(counts[i], left);
    for (let d = 0; d <= max; d++) {
      drawn[i] = d;
      rec(i + 1, left - d, ways * comb(counts[i], d));
    }
    drawn[i] = 0;
  })(0, handSize, 1);
  return out;
}

function enumerateJoint(counts, deckSize, handSize, outside) {
  const states = [];
  const hands = handDistribution(counts, deckSize, handSize);
  const n = counts.length;
  const other = deckSize - counts.reduce((a, b) => a + b, 0);
  for (const h of hands) {
    const remCounts = counts.map((k, i) => k - h.drawn[i]);
    const remOther = other - (handSize - h.drawn.reduce((a, b) => a + b, 0));
    const totalOut = comb(deckSize - handSize, outside);
    const oVec = new Array(n).fill(0);
    (function recOut(i, left, ways) {
      if (i === n) {
        const w = ways * comb(remOther, left);
        if (w <= 0) return;
        const p = h.p * w / totalOut;
        if (p <= 0) return;
        const remaining = remCounts.map((k, j) => k - oVec[j]);
        states.push({ drawn: h.drawn.slice(), remaining, p });
        return;
      }
      const max = Math.min(remCounts[i], left);
      for (let o = 0; o <= max; o++) {
        oVec[i] = o;
        recOut(i + 1, left - o, ways * comb(remCounts[i], o));
      }
      oVec[i] = 0;
    })(0, outside, 1);
  }
  return states;
}

function baseProbability(req) {
  const counts = req.cards.map((c) => c.copies);
  const states = enumerateJoint(counts, req.deckSize, req.handSize, req.outside);
  let p = 0;
  for (const s of states) if (anyCombinationSatisfied(req.combinations, s.drawn, s.remaining)) p += s.p;
  return p;
}

function redrawDistribution(poolCounts, poolSize, draw) {
  return handDistribution(poolCounts, poolSize, draw);
}

function finalHandDistribution(req) {
  const counts = req.cards.map((c) => c.copies);
  const m = req.mulligan;
  const first = handDistribution(counts, req.deckSize, req.handSize);
  if (m.mode === 'none' || m.count === 0) return first;
  const out = new Map();
  function add(drawn, p) {
    if (p <= 0) return;
    const k = drawn.join(',');
    out.set(k, (out.get(k) || 0) + p);
  }
  if (m.mode === 'noChoiceDup') {
    const keepP = first.reduce((a, h) => a + (drawOnlySatisfied(req.combinations, h.drawn) ? h.p : 0), 0);
    for (const h of first) add(h.drawn, h.p * (drawOnlySatisfied(req.combinations, h.drawn) ? 1 : 0) + h.p * 0);
    for (const h of first) {
      const p = h.p * (1 - keepP);
      add(h.drawn, p);
    }
    return [...out.entries()].map(([k, p]) => ({ drawn: k.split(',').map(Number), p }));
  }
  for (const h of first) {
    if (drawOnlySatisfied(req.combinations, h.drawn)) { add(h.drawn, h.p); continue; }
    if (m.mode === 'noChoiceNoDup') {
      const pool = counts.map((k, i) => k - h.drawn[i]);
      const redraw = redrawDistribution(pool, req.deckSize - req.handSize, req.handSize);
      for (const r of redraw) add(r.drawn, h.p * r.p);
    } else if (m.mode === 'choiceNoDup' || m.mode === 'choiceDup') {
      let best = null;
      let bestP = -1;
      const keep = new Array(counts.length).fill(0);
      (function recKeep(i) {
        if (i === counts.length) {
          const keptTotal = keep.reduce((a, b) => a + b, 0);
          const need = req.handSize - keptTotal;
          let pool;
          let poolSize;
          if (m.mode === 'choiceNoDup') { pool = counts.map((k, j) => k - h.drawn[j]); poolSize = req.deckSize - req.handSize; }
          else { pool = counts.map((k, j) => k - keep[j]); poolSize = req.deckSize - keptTotal; }
          const redraw = redrawDistribution(pool, poolSize, need);
          let succ = 0;
          for (const r of redraw) {
            const finalDrawn = keep.map((k, j) => k + r.drawn[j]);
            if (drawOnlySatisfied(req.combinations, finalDrawn)) succ += r.p;
          }
          if (succ > bestP) { bestP = succ; best = keep.slice(); }
          return;
        }
        for (let k = 0; k <= h.drawn[i]; k++) { keep[i] = k; recKeep(i + 1); }
        keep[i] = 0;
      })(0);
      void best;
      const keptTotal = best.reduce((a, b) => a + b, 0);
      const need = req.handSize - keptTotal;
      let pool; let poolSize;
      if (m.mode === 'choiceNoDup') { pool = counts.map((k, j) => k - h.drawn[j]); poolSize = req.deckSize - req.handSize; }
      else { pool = counts.map((k, j) => k - best[j]); poolSize = req.deckSize - keptTotal; }
      const redraw = redrawDistribution(pool, poolSize, need);
      for (const r of redraw) add(best.map((k, j) => k + r.drawn[j]), h.p * r.p);
    }
  }
  return [...out.entries()].map(([k, p]) => ({ drawn: k.split(',').map(Number), p }));
}

function probabilityWithMulligan(req) {
  const counts = req.cards.map((c) => c.copies);
  const finals = finalHandDistribution(req);
  const n = counts.length;
  const other = req.deckSize - counts.reduce((a, b) => a + b, 0);
  let p = 0;
  for (const f of finals) {
    const remCounts = counts.map((k, i) => k - f.drawn[i]);
    const remOther = other - (req.handSize - f.drawn.reduce((a, b) => a + b, 0));
    const totalOut = comb(req.deckSize - req.handSize, req.outside);
    const oVec = new Array(n).fill(0);
    (function recOut(i, left, ways) {
      if (i === n) {
        const w = ways * comb(remOther, left);
        if (w <= 0) return;
        const prob = f.p * w / totalOut;
        if (prob <= 0) return;
        const remaining = remCounts.map((k, j) => k - oVec[j]);
        if (anyCombinationSatisfied(req.combinations, f.drawn, remaining)) p += prob;
        return;
      }
      const max = Math.min(remCounts[i], left);
      for (let o = 0; o <= max; o++) { oVec[i] = o; recOut(i + 1, left - o, ways * comb(remCounts[i], o)); }
      oVec[i] = 0;
    })(0, req.outside, 1);
  }
  return p;
}

function ProbabilityCalculator(req) {
  const errors = validateCalculationRequest(req);
  if (errors.length) throw new Error(errors.join('; '));
  if (req.mulligan && req.mulligan.mode !== 'none' && req.mulligan.count > 0) return probabilityWithMulligan(req);
  return baseProbability(req);
}

function TurnProgressionCalculator(req, maxTurns) {
  const errors = validateCalculationRequest(req);
  if (errors.length) throw new Error(errors.join('; '));
  const turns = maxTurns === undefined ? 15 : maxTurns;
  const series = [];
  const noMulligan = Object.assign({}, req, { mulligan: MulliganPolicy('none', 0) });
  for (let t = 0; t <= turns; t++) {
    const hand = Math.min(req.handSize + t, req.deckSize - req.outside);
    series.push({ turn: t, draws: hand, probability: baseProbability(Object.assign({}, noMulligan, { handSize: hand })) });
  }
  return series;
}

const FACTORY_DEFAULTS = Object.freeze({ deckSize: 40, handSize: 5, outside: 0, firstCardCopies: 4, neededCount: 1 });
const DEFAULTS_STORAGE_KEY = 'tcg-cal-defaults-v1';

function validateDefaultSettings(s) {
  const errors = [];
  if (!s || typeof s !== 'object') return ['settings must be an object'];
  if (!isInt(s.deckSize) || s.deckSize < 1) errors.push('deckSize must be an integer >= 1');
  if (!isInt(s.handSize) || s.handSize < 0) errors.push('handSize must be an integer >= 0');
  if (!isInt(s.outside) || s.outside < 0) errors.push('outside must be an integer >= 0');
  if (isInt(s.deckSize) && isInt(s.handSize) && isInt(s.outside) && s.handSize + s.outside > s.deckSize) errors.push('handSize + outside must be <= deckSize');
  if (!isInt(s.firstCardCopies) || s.firstCardCopies < 0) errors.push('firstCardCopies must be an integer >= 0');
  if (!isInt(s.neededCount) || s.neededCount < 0) errors.push('neededCount must be an integer >= 0');
  return errors;
}

function DefaultSettings(values) {
  const merged = Object.assign({}, FACTORY_DEFAULTS, values || {});
  const errors = validateDefaultSettings(merged);
  if (errors.length) throw new Error(errors.join('; '));
  return Object.freeze(merged);
}

function loadDefaultSettings(storage) {
  try {
    const raw = storage.getItem(DEFAULTS_STORAGE_KEY);
    if (raw === null || raw === undefined) return DefaultSettings();
    const parsed = JSON.parse(raw);
    if (validateDefaultSettings(parsed).length) return DefaultSettings();
    return DefaultSettings(parsed);
  } catch (e) {
    return DefaultSettings();
  }
}

function saveDefaultSettings(storage, settings) {
  const errors = validateDefaultSettings(settings);
  if (errors.length) throw new Error(errors.join('; '));
  storage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(settings));
  return DefaultSettings(settings);
}

function resolveDefaults(preset, saved) {
  if (preset) return Object.assign({}, saved, preset);
  return Object.assign({}, saved);
}

const TITLE_PRESETS = [
  { id: 'none', name: '選択なし', mulligan: 'none' },
  { id: 'sv-evolve', name: 'シャドウバース エボルヴ', mulligan: 'noChoiceNoDup', deckSize: 40, handSize: 5 },
  { id: 'union-arena', name: 'ユニオンアリーナ', mulligan: 'noChoiceNoDup' },
  { id: 'zx', name: 'Z/X', mulligan: 'noChoiceDup', deckSize: 40, handSize: 5 },
  { id: 'one-piece', name: 'ONE PIECEカードゲーム', mulligan: 'noChoiceDup', deckSize: 50, handSize: 5 },
  { id: 'digimon', name: 'デジモンカードゲーム', mulligan: 'noChoiceDup', deckSize: 50, handSize: 5 },
  { id: 'shadowverse', name: 'シャドウバース', mulligan: 'choiceNoDup', deckSize: 40, handSize: 3 },
  { id: 'hearthstone', name: 'ハースストーン', mulligan: 'choiceNoDup', deckSize: 30, handSize: 3 },
  { id: 'weiss', name: 'ヴァイスシュヴァルツ', mulligan: 'choiceNoDup', deckSize: 50, handSize: 5 },
  { id: 'wixoss', name: 'ウィクロス', mulligan: 'choiceDup', deckSize: 40, handSize: 5 },
  { id: 'vanguard', name: 'ヴァンガード', mulligan: 'choiceDup', deckSize: 50, handSize: 5 },
];

function formatPercent(p, round4) {
  if (!(p >= 0) || p > 1) throw new Error('probability must be in [0, 1]');
  const pct = p * 100;
  if (round4 === false) {
    if (p > 0 && pct < 0.0001) return pct.toExponential(2) + '%';
    return pct.toFixed(4) + '%';
  }
  return Number(pct.toFixed(4)) + '%';
}

const api = {
  comb, DeckConfiguration, CardEntry, DrawCondition, ConditionCombination,
  MulliganPolicy, CalculationRequest, validateCalculationRequest,
  ProbabilityCalculator, TurnProgressionCalculator,
  FACTORY_DEFAULTS, DEFAULTS_STORAGE_KEY, DefaultSettings,
  loadDefaultSettings, saveDefaultSettings, resolveDefaults,
  TITLE_PRESETS, formatPercent, CONDITION_TYPES, MULLIGAN_MODES,
  handDistribution, enumerateJoint, finalHandDistribution,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.TcgCal = api;
