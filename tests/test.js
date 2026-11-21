'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/domain.js');

function approx(a, b, eps) { assert.ok(Math.abs(a - b) < (eps || 1e-9), `expected ${a} ≈ ${b}`); }
function req(deck, hand, outside, cards, combos, mulligan) {
  return D.CalculationRequest(deck, hand, outside, cards, combos, mulligan || D.MulliganPolicy('none', 0));
}
function oneCard(copies, type, needed) {
  return req(40, 5, 0, [D.CardEntry('A', copies)],
    [D.ConditionCombination('c', [D.DrawCondition(0, type, needed)])]);
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

test('comb basics', () => {
  assert.equal(D.comb(5, 2), 10);
  assert.equal(D.comb(40, 5), 658008);
  assert.equal(D.comb(30, 5), 142506);
  assert.equal(D.comb(5, 0), 1);
  assert.equal(D.comb(5, 6), 0);
});

test('DeckConfiguration validation', () => {
  assert.throws(() => D.DeckConfiguration(0, 5, 0), /deckSize/);
  assert.throws(() => D.DeckConfiguration(40, -1, 0), /handSize/);
  assert.throws(() => D.DeckConfiguration(40, 5, -1), /outside/);
  assert.throws(() => D.DeckConfiguration(40, 36, 5), /handSize \+ outside/);
  assert.throws(() => D.DeckConfiguration(40.5, 5, 0), /deckSize/);
  assert.deepEqual(D.DeckConfiguration(40, 5, 0), { deckSize: 40, handSize: 5, outside: 0 });
});

test('CardEntry and DrawCondition validation', () => {
  assert.throws(() => D.CardEntry('A', -1), /copies/);
  assert.throws(() => D.CardEntry('A', 1.5), /copies/);
  assert.throws(() => D.DrawCondition(0, 'unknown', 1), /condition type/);
  assert.throws(() => D.DrawCondition(0, 'drawAtLeast', -1), /needed/);
  assert.throws(() => D.DrawCondition(-1, 'drawAtLeast', 1), /cardIndex/);
});

test('validateCalculationRequest rejects bad requests', () => {
  const rawBad = { deckSize: 40, handSize: 36, outside: 5, cards: [{ name: 'A', copies: 1 }], combinations: [{ name: 'c', enabled: true, conditions: [{ cardIndex: 0, type: 'drawAtLeast', needed: 1, enabled: true }] }], mulligan: D.MulliganPolicy('none', 0) };
  assert.ok(D.validateCalculationRequest(rawBad).length > 0);
  assert.throws(() => req(40, 5, 0, [D.CardEntry('A', 30), D.CardEntry('B', 20)],
    [D.ConditionCombination('c', [D.DrawCondition(0, 'drawAtLeast', 1)])]), /total copies/);
  assert.throws(() => {
    const combos = Array.from({ length: 32 }, (_, i) => D.ConditionCombination('c' + i, [D.DrawCondition(0, 'drawAtLeast', 1)]));
    req(40, 5, 0, [D.CardEntry('A', 10)], combos);
  }, /31/);
  assert.throws(() => req(40, 5, 0, [D.CardEntry('A', 10)],
    [D.ConditionCombination('c', [D.DrawCondition(5, 'drawAtLeast', 1)])]), /cardIndex/);
});

test('hypergeometric base: 40 deck, 10 copies, 5 draws, >=1', () => {
  approx(D.ProbabilityCalculator(oneCard(10, 'drawAtLeast', 1)), 1 - 142506 / 658008);
});

test('hypergeometric edges: 0 copies is 0, full deck is 1', () => {
  approx(D.ProbabilityCalculator(oneCard(0, 'drawAtLeast', 1)), 0);
  approx(D.ProbabilityCalculator(oneCard(40, 'drawAtLeast', 1)), 1);
  approx(D.ProbabilityCalculator(oneCard(40, 'drawAtLeast', 5)), 1);
  approx(D.ProbabilityCalculator(oneCard(0, 'drawExactly', 0)), 1);
});

test('golden case ex1', () => {
  const r = req(40, 5, 0, [D.CardEntry('永続魔法', 10), D.CardEntry('ハモン', 3)],
    [D.ConditionCombination('組み合わせ1', [D.DrawCondition(0, 'drawAtLeast', 3), D.DrawCondition(1, 'drawAtLeast', 1)])]);
  approx(D.ProbabilityCalculator(r), 0.016276397855345223, 1e-9);
});

test('golden case ex2', () => {
  const r = req(40, 5, 5, [D.CardEntry('ラッキー・ダーツ', 1), D.CardEntry('ロジックキューブ', 4)],
    [D.ConditionCombination('組み合わせ1', [D.DrawCondition(0, 'drawAtLeast', 1), D.DrawCondition(1, 'drawAtLeast', 1, false)]),
     D.ConditionCombination('組み合わせ2', [D.DrawCondition(0, 'remainAtLeast', 1), D.DrawCondition(1, 'drawAtLeast', 1)])]);
  approx(D.ProbabilityCalculator(r), 0.4521236823868404, 1e-9);
});

test('AND/OR: disabled condition and disabled combination are excluded', () => {
  const base = req(40, 5, 0, [D.CardEntry('A', 10), D.CardEntry('B', 3)],
    [D.ConditionCombination('c1', [D.DrawCondition(0, 'drawAtLeast', 1), D.DrawCondition(1, 'drawAtLeast', 1, false)])]);
  const withB = req(40, 5, 0, [D.CardEntry('A', 10), D.CardEntry('B', 3)],
    [D.ConditionCombination('c1', [D.DrawCondition(0, 'drawAtLeast', 1), D.DrawCondition(1, 'drawAtLeast', 1)])]);
  approx(D.ProbabilityCalculator(base), D.ProbabilityCalculator(oneCard(10, 'drawAtLeast', 1)));
  assert.ok(D.ProbabilityCalculator(withB) < D.ProbabilityCalculator(base));
  const disabledCombo = req(40, 5, 0, [D.CardEntry('A', 10), D.CardEntry('B', 3)],
    [D.ConditionCombination('c1', [D.DrawCondition(0, 'drawAtLeast', 1)], false),
     D.ConditionCombination('c2', [D.DrawCondition(1, 'drawAtLeast', 1)])]);
  const onlyB = req(40, 5, 0, [D.CardEntry('A', 10), D.CardEntry('B', 3)],
    [D.ConditionCombination('c2', [D.DrawCondition(1, 'drawAtLeast', 1)])]);
  approx(D.ProbabilityCalculator(disabledCombo), D.ProbabilityCalculator(onlyB));
});

test('condition types: remain is the complement of drawn', () => {
  const remain = req(40, 5, 0, [D.CardEntry('A', 10)],
    [D.ConditionCombination('c', [D.DrawCondition(0, 'remainAtLeast', 9)])]);
  const drawnAtMost1 = req(40, 5, 0, [D.CardEntry('A', 10)],
    [D.ConditionCombination('c', [D.DrawCondition(0, 'drawExactly', 0)]),
     D.ConditionCombination('c2', [D.DrawCondition(0, 'drawExactly', 1)])]);
  approx(D.ProbabilityCalculator(remain), D.ProbabilityCalculator(drawnAtMost1));
  const exact = D.ProbabilityCalculator(oneCard(10, 'drawExactly', 2));
  const atLeast2 = D.ProbabilityCalculator(oneCard(10, 'drawAtLeast', 2));
  const atLeast3 = D.ProbabilityCalculator(oneCard(10, 'drawAtLeast', 3));
  approx(exact, atLeast2 - atLeast3);
});

test('mulligan: none equals base, every mode improves on base', () => {
  const base = D.ProbabilityCalculator(oneCard(10, 'drawAtLeast', 1));
  for (const mode of ['noChoiceNoDup', 'noChoiceDup', 'choiceNoDup', 'choiceDup']) {
    const r = req(40, 5, 0, [D.CardEntry('A', 10)],
      [D.ConditionCombination('c', [D.DrawCondition(0, 'drawAtLeast', 1)])], D.MulliganPolicy(mode, 1));
    const p = D.ProbabilityCalculator(r);
    assert.ok(p > base, mode + ' should improve on base');
    assert.ok(p <= 1, mode + ' must be <= 1');
  }
});

test('mulligan: noChoiceDup equals 1-(1-p)^2', () => {
  const base = D.ProbabilityCalculator(oneCard(10, 'drawAtLeast', 1));
  const r = req(40, 5, 0, [D.CardEntry('A', 10)],
    [D.ConditionCombination('c', [D.DrawCondition(0, 'drawAtLeast', 1)])], D.MulliganPolicy('noChoiceDup', 1));
  approx(D.ProbabilityCalculator(r), 1 - Math.pow(1 - base, 2), 1e-9);
});

test('mulligan: noChoiceNoDup beats dup here (spec claim dup>=noDup is false)', () => {
  const mk = (mode) => req(40, 5, 0, [D.CardEntry('A', 10)],
    [D.ConditionCombination('c', [D.DrawCondition(0, 'drawAtLeast', 1)])], D.MulliganPolicy(mode, 1));
  const noDup = D.ProbabilityCalculator(mk('noChoiceNoDup'));
  const dup = D.ProbabilityCalculator(mk('noChoiceDup'));
  approx(noDup, 0.964555, 1e-4);
  assert.ok(noDup > dup, 'failed hand holds 0 targets, so the no-dup redraw pool is target-rich');
});

test('turn progression: 16 entries, turn 0 equals base, monotonic for draw conditions', () => {
  const r = req(40, 5, 0, [D.CardEntry('永続魔法', 10), D.CardEntry('ハモン', 3)],
    [D.ConditionCombination('c', [D.DrawCondition(0, 'drawAtLeast', 3), D.DrawCondition(1, 'drawAtLeast', 1)])]);
  const series = D.TurnProgressionCalculator(r);
  assert.equal(series.length, 16);
  approx(series[0].probability, D.ProbabilityCalculator(r));
  for (let t = 1; t < series.length; t++) {
    assert.ok(series[t].probability >= series[t - 1].probability - 1e-12, 'turn ' + t + ' must not decrease');
  }
  assert.ok(series[15].probability > 0.85);
});

test('distributions sum to 1', () => {
  const hd = D.handDistribution([10, 3], 40, 5);
  approx(hd.reduce((a, h) => a + h.p, 0), 1);
  const joint = D.enumerateJoint([1, 4], 40, 5, 5);
  approx(joint.reduce((a, s) => a + s.p, 0), 1);
});

test('DefaultSettings: save/load roundtrip', () => {
  const s = memStorage();
  const saved = D.saveDefaultSettings(s, { deckSize: 50, handSize: 5, outside: 2, firstCardCopies: 3, neededCount: 2 });
  assert.deepEqual(D.loadDefaultSettings(s), saved);
});

test('DefaultSettings: corrupt or out-of-range data falls back to factory', () => {
  const s = memStorage();
  s.setItem(D.DEFAULTS_STORAGE_KEY, 'not json{');
  assert.deepEqual(D.loadDefaultSettings(s), D.FACTORY_DEFAULTS);
  s.setItem(D.DEFAULTS_STORAGE_KEY, JSON.stringify({ deckSize: 0, handSize: 5, outside: 0, firstCardCopies: 4, neededCount: 1 }));
  assert.deepEqual(D.loadDefaultSettings(s), D.FACTORY_DEFAULTS);
  s.setItem(D.DEFAULTS_STORAGE_KEY, JSON.stringify({ deckSize: 40, handSize: 39, outside: 5, firstCardCopies: 4, neededCount: 1 }));
  assert.deepEqual(D.loadDefaultSettings(s), D.FACTORY_DEFAULTS);
});

test('DefaultSettings: preset wins, clearing preset restores saved values', () => {
  const saved = D.DefaultSettings({ deckSize: 50, handSize: 5, outside: 0, firstCardCopies: 4, neededCount: 1 });
  const withPreset = D.resolveDefaults({ deckSize: 30, handSize: 3 }, saved);
  assert.equal(withPreset.deckSize, 30);
  assert.equal(withPreset.handSize, 3);
  assert.equal(withPreset.firstCardCopies, 4);
  assert.deepEqual(D.resolveDefaults(null, saved), saved);
});

test('DefaultSettings: invalid save is rejected', () => {
  assert.throws(() => D.saveDefaultSettings(memStorage(), { deckSize: 40, handSize: 41, outside: 0, firstCardCopies: 4, neededCount: 1 }), /handSize/);
});

test('formatPercent: rounding and exponential display', () => {
  assert.equal(D.formatPercent(0.123456, true), '12.3456%');
  assert.equal(D.formatPercent(0.0000001, true), '0%');
  assert.equal(D.formatPercent(0.0000001, false), '1.00e-5%');
  assert.equal(D.formatPercent(0.5, false), '50.0000%');
  assert.equal(D.formatPercent(1, true), '100%');
});

test('Duel Links preset exists with deck 20, hand 4, no mulligan', () => {
  const p = D.TITLE_PRESETS.find((x) => x.id === 'duel-links');
  assert.ok(p, 'duel-links preset must exist');
  assert.equal(p.name, '遊戯王デュエルリンクス');
  assert.equal(p.mulligan, 'none');
  assert.equal(p.deckSize, 20);
  assert.equal(p.handSize, 4);
});

test('default title is Duel Links on a fresh load, not when settings are saved', () => {
  assert.equal(D.DEFAULT_TITLE_ID, 'duel-links');
  assert.equal(D.resolveDefaultTitleId(memStorage()), 'duel-links');
  const s = memStorage();
  D.saveDefaultSettings(s, { deckSize: 50, handSize: 5, outside: 0, firstCardCopies: 4, neededCount: 1 });
  assert.equal(D.resolveDefaultTitleId(s), 'none');
});

test('factory defaults are unchanged (40/5)', () => {
  assert.equal(D.FACTORY_DEFAULTS.deckSize, 40);
  assert.equal(D.FACTORY_DEFAULTS.handSize, 5);
});
