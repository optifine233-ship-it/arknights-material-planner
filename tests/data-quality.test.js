import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSnapshotVersion,
  validateSynchronizedOperators
} from '../scripts/lib/data-quality.mjs';

function operator(overrides = {}) {
  return {
    id: 'char_base',
    r: 5,
    p: '近卫',
    pos: '近战位',
    e1: [{ name: '近卫芯片', qty: 5 }],
    e2: [{ name: '近卫双芯片', qty: 4 }],
    sl: [{ level: 2, mats: [{ name: '技巧概要·卷1', qty: 5 }] }],
    ms: { s1: [{ stage: 1, mats: [{ name: '技巧概要·卷3', qty: 8 }] }], s2: [], s3: [] },
    md: [],
    ...overrides
  };
}

test('同步候选相对上一快照大幅减少时拒绝覆盖', () => {
  const base = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [
    `干员${index}`,
    operator({ id: `char_${index}` })
  ]));
  const candidate = Object.fromEntries(Object.entries(base).slice(0, 94));

  assert.throws(
    () => validateSynchronizedOperators(base, candidate),
    /数量下降/
  );
});

test('同步候选丢失已有培养结构或包含重复名称时拒绝覆盖', () => {
  const base = { 煌: operator() };

  assert.throws(
    () => validateSynchronizedOperators(base, { 煌: operator({ e2: [] }) }),
    /培养结构退化/
  );
  assert.throws(
    () => validateSynchronizedOperators(base, {
      煌: operator({ ms: { s1: [], s2: [{ stage: 1, mats: [{ name: '技巧概要·卷3', qty: 8 }] }], s3: [] } })
    }),
    /培养结构退化/
  );
  assert.throws(
    () => validateSynchronizedOperators(
      { 煌: operator({ md: [{ name: '原模组', stages: [{ stage: 1, mats: [] }, { stage: 2, mats: [] }] }] }) },
      { 煌: operator({ md: [{ name: '另一个模组', stages: [{ stage: 1, mats: [] }, { stage: 2, mats: [] }] }] }) }
    ),
    /培养结构退化/
  );
  assert.throws(
    () => validateSynchronizedOperators(base, base, { duplicateOperatorNames: [{ name: '煌' }] }),
    /重复干员名称/
  );
});

test('同步候选只接受合法星级、职业和部署位置', () => {
  assert.throws(
    () => validateSynchronizedOperators({}, { 危险: operator({ p: '<img>', pos: '<script>' }) }),
    /非法职业|非法部署位置/
  );
  assert.throws(
    () => validateSynchronizedOperators({}, { 危险: operator({ r: -1 }) }),
    /非法星级/
  );
});

test('数据版本由实际快照内容决定并忽略时间字段', () => {
  const snapshot = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    dataVersion: 'old',
    OPS: { 煌: operator({ skillIds: { s1: 'skill-a' } }) },
    OPS_ORDER: ['煌'],
    MAT_RARITY: { 异铁: 2, 糖: 2 },
    RECIPES: {},
    MATERIAL_META: {}
  };
  const first = createSnapshotVersion(snapshot, 420259);
  const same = createSnapshotVersion({ ...snapshot, generatedAt: '2026-02-01T00:00:00.000Z' }, 420259);
  const changed = createSnapshotVersion({
    ...snapshot,
    OPS: { 煌: operator({ skillIds: { s1: 'skill-b' } }) }
  }, 420259);
  const reordered = createSnapshotVersion({
    ...snapshot,
    MAT_RARITY: { 糖: 2, 异铁: 2 }
  }, 420259);

  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.equal(first, reordered);
  assert.match(first, /^prts-420259-[a-f0-9]{12}$/);
});

test('同步拒绝已有稳定 ID 消失或候选稳定 ID 重复', () => {
  const base = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [
    `干员${index}`, operator({ id: `char_${index}` })
  ]));
  const candidate = { ...base };
  delete candidate.干员0;
  candidate.新干员 = operator({ id: 'char_new' });

  assert.throws(() => validateSynchronizedOperators(base, candidate), /已有干员.*消失/);
  assert.throws(() => validateSynchronizedOperators({}, {
    甲: operator({ id: 'char_duplicate' }),
    乙: operator({ id: 'char_duplicate' })
  }), /稳定 ID.*同时用于/);
});

test('升级成本等计算输入变化会改变数据版本', () => {
  const snapshot = {
    OPS: { 煌: operator() },
    OPS_ORDER: ['煌'],
    LEVEL_COSTS: { e0: [{ lv: 1, exp: 1, lmd: 1 }] },
    ELITE_LMD: { 5: { e1: 100, e2: 200 } }
  };
  const changed = structuredClone(snapshot);
  changed.LEVEL_COSTS.e0[0].exp = 999;

  assert.notEqual(createSnapshotVersion(snapshot, 1), createSnapshotVersion(changed, 1));
});
