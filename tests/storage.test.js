import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProjectExport,
  loadUserState,
  mergeImportedCurrentState,
  migrateLegacySnapshot,
  parseProjectImport,
  saveUserState,
  USER_DATA_STORAGE_KEY
} from '../src/storage.js';

const gameData = {
  OPS: {
    煌: {
      r: 5,
      md: [{ name: '过载的武器与过热的心脏', stages: [{ stage: 1 }, { stage: 2 }, { stage: 3 }] }]
    },
    能天使: { r: 5, md: [] }
  },
  OPS_ORDER: ['煌', '能天使'],
  MAX_LV: { 5: { e0: 50, e1: 80, e2: 90 } }
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    dump: () => Object.fromEntries(values)
  };
}

test('旧版三个本地键迁移为 current/target 状态且保留完整模组名', () => {
  const state = migrateLegacySnapshot({
    plan: ['煌|slv', '煌|ms-s1-3', '煌|md-0-2'],
    levels: { 煌: { fe: 1, fl: 60, te: 2, tl: 90 } },
    inventory: { 异铁组: 12 }
  }, gameData);

  assert.equal(state.operators.煌.owned, true);
  assert.deepEqual(state.operators.煌.current, {
    elite: 1,
    level: 60,
    skillLevel: 1,
    mastery: { s1: 0, s2: 0, s3: 0 },
    modules: {}
  });
  assert.equal(state.operators.煌.target.elite, 2);
  assert.equal(state.operators.煌.target.level, 90);
  assert.equal(state.operators.煌.target.skillLevel, 7);
  assert.equal(state.operators.煌.target.mastery.s1, 3);
  assert.equal(state.operators.煌.target.modules['过载的武器与过热的心脏'], 2);
  assert.equal(state.inventory.异铁组, 12);
});

test('首次读取旧数据时写入新键但不删除原键', () => {
  const storage = memoryStorage({
    ak_plan: JSON.stringify(['煌|slv']),
    ak_levels: JSON.stringify({ 煌: { fe: 0, fl: 1, te: 1, tl: 50 } }),
    ak_inv: JSON.stringify({ 异铁组: 2 })
  });

  const result = loadUserState(storage, gameData);

  assert.equal(result.migrated, true);
  assert.equal(result.state.operators.煌.target.skillLevel, 7);
  assert.ok(storage.dump()[USER_DATA_STORAGE_KEY]);
  assert.ok(storage.dump().ak_plan);
  assert.ok(storage.dump().ak_levels);
  assert.ok(storage.dump().ak_inv);
});

test('保存和读取新版用户数据', () => {
  const storage = memoryStorage();
  const original = migrateLegacySnapshot({
    plan: [],
    levels: { 能天使: { fe: 2, fl: 60, te: 2, tl: 80 } },
    inventory: { 糖组: 4 }
  }, gameData);

  saveUserState(storage, original);
  const loaded = loadUserState(storage, gameData);

  assert.equal(loaded.migrated, false);
  assert.equal(loaded.state.operators.能天使.current.level, 60);
  assert.equal(loaded.state.operators.能天使.target.level, 80);
  assert.equal(loaded.state.inventory.糖组, 4);
});

test('导入新的当前状态时保留并抬高已有目标状态', () => {
  const existing = migrateLegacySnapshot({
    plan: [],
    levels: { 煌: { fe: 1, fl: 40, te: 1, tl: 70 } },
    inventory: {}
  }, gameData);
  const incoming = {
    operators: {
      煌: {
        owned: true,
        current: {
          elite: 2,
          level: 20,
          skillLevel: 7,
          mastery: { s1: 1, s2: 0, s3: 0 },
          modules: {}
        }
      }
    }
  };

  const merged = mergeImportedCurrentState(existing, incoming, 'merge', gameData);

  assert.equal(merged.operators.煌.current.elite, 2);
  assert.equal(merged.operators.煌.current.level, 20);
  assert.equal(merged.operators.煌.target.elite, 2);
  assert.equal(merged.operators.煌.target.level, 20);
  assert.equal(merged.operators.煌.target.skillLevel, 7);
  assert.equal(merged.operators.煌.target.mastery.s1, 1);
});

test('项目扩展格式可以往返当前、目标和库存', () => {
  const state = migrateLegacySnapshot({
    plan: ['煌|ms-s1-2'],
    levels: { 煌: { fe: 1, fl: 60, te: 2, tl: 80 } },
    inventory: { 异铁: 8 }
  }, gameData);

  const exported = createProjectExport(state, { now: '2026-08-17T00:00:00.000Z' });
  const parsed = parseProjectImport(JSON.stringify(exported), gameData);

  assert.equal(exported.format, 'arknights-material-planner');
  assert.equal(parsed.operators.煌.target.mastery.s1, 2);
  assert.equal(parsed.inventory.异铁, 8);
});
