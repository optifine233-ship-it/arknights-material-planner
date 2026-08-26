import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProjectExport,
  createBackup,
  loadBackup,
  loadUserState,
  mergeImportedCurrentState,
  mergeProjectImport,
  migrateLegacySnapshot,
  normalizeUserState,
  parseProjectImport,
  saveUserState,
  UserDataConflictError,
  USER_DATA_STORAGE_KEY
} from '../src/storage.js';

const gameData = {
  OPS: {
    煌: {
      id: 'char_017_huang',
      r: 5,
      md: [{ name: '过载的武器与过热的心脏', stages: [{ stage: 1 }, { stage: 2 }, { stage: 3 }] }]
    },
    能天使: { id: 'char_103_angel', r: 5, md: [] }
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
test('保存前若另一标签页已经更新数据则拒绝静默覆盖', () => {
  const storage = memoryStorage();
  saveUserState(storage, { operators: {}, inventory: {}, settings: {} });
  const baselineRaw = storage.getItem(USER_DATA_STORAGE_KEY);
  const externalRaw = JSON.stringify({
    schemaVersion: 2,
    updatedAt: 'external',
    operators: { 煌: { owned: true } },
    inventory: {},
    settings: {}
  });
  storage.setItem(USER_DATA_STORAGE_KEY, externalRaw);

  assert.throws(
    () => saveUserState(storage, { operators: {}, inventory: {}, settings: {} }, { expectedRaw: baselineRaw }),
    UserDataConflictError
  );
  assert.equal(storage.getItem(USER_DATA_STORAGE_KEY), externalRaw);
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
  state.settings.planSelection = {
    preset: 'custom',
    excludedOperators: ['char_103_angel'],
    excludedItems: ['char_017_huang::skill:levels']
  };

  const exported = createProjectExport(state, { now: '2026-08-17T00:00:00.000Z' });
  const parsed = parseProjectImport(JSON.stringify(exported), gameData);

  assert.equal(exported.format, 'arknights-material-planner');
  assert.equal(parsed.operators.煌.target.mastery.s1, 2);
  assert.equal(parsed.inventory.异铁, 8);
  assert.deepEqual(parsed.settings.planSelection, state.settings.planSelection);
});

test('旧数据没有材料统计选择时默认包含全部计划', () => {
  const state = migrateLegacySnapshot({}, gameData);

  assert.deepEqual(state.settings.planSelection, {
    preset: 'all',
    excludedOperators: [],
    excludedItems: []
  });
});

test('合并旧项目备份时保留本机材料统计范围', () => {
  const local = migrateLegacySnapshot({}, gameData);
  local.settings.planSelection = {
    preset: 'custom',
    excludedOperators: ['char_103_angel'],
    excludedItems: ['char_017_huang::skill:levels']
  };
  const oldBackup = parseProjectImport({
    format: 'arknights-material-planner',
    version: 1,
    userData: { operators: {}, inventory: { 异铁: 5 } }
  }, gameData);

  const merged = mergeProjectImport(local, oldBackup, gameData);

  assert.equal(merged.inventory.异铁, 5);
  assert.deepEqual(merged.settings.planSelection, local.settings.planSelection);
});

test('自动备份可以恢复为已校验的用户状态', () => {
  const storage = memoryStorage();
  createBackup(storage, {
    operators: { 煌: { id: 'char_017_huang', owned: true, current: { elite: 1, level: 50 } } },
    inventory: { 异铁: 6 }
  });

  const backup = loadBackup(storage, gameData);

  assert.equal(backup.state.operators.煌.current.level, 50);
  assert.equal(backup.state.inventory.异铁, 6);
});

test('干员改名后通过稳定 ID 迁移本地状态', () => {
  const renamedData = {
    ...gameData,
    OPS: { 新名称: { ...gameData.OPS.煌 } },
    OPS_ORDER: ['新名称']
  };
  const state = {
    operators: {
      旧名称: {
        id: 'char_017_huang',
        owned: true,
        current: { elite: 1, level: 55 },
        target: { elite: 2, level: 80 }
      }
    }
  };

  const normalized = parseProjectImport({
    format: 'arknights-material-planner',
    version: 1,
    userData: state
  }, renamedData);

  assert.equal(normalized.operators.新名称.id, 'char_017_huang');
  assert.equal(normalized.operators.新名称.current.level, 55);
  assert.equal(normalized.operators.旧名称, undefined);
});

test('每日资源积累量会作为非负整数保存', () => {
  const normalized = normalizeUserState({
    settings: {
      statisticsDailyExp: '1234.9',
      statisticsDailyLmd: -20
    }
  }, gameData);

  assert.equal(normalized.settings.statisticsDailyExp, 1234);
  assert.equal(normalized.settings.statisticsDailyLmd, 0);
});

test('补充模组稳定 ID 后迁移旧名称状态和材料统计排除项', () => {
  const idData = {
    ...gameData,
    OPS: {
      煌: {
        ...gameData.OPS.煌,
        md: [{ id: 'uniequip_002_huang', name: '过载的武器与过热的心脏', stages: [{ stage: 1 }, { stage: 2 }, { stage: 3 }] }]
      }
    },
    OPS_ORDER: ['煌']
  };
  const normalized = normalizeUserState({
    operators: {
      煌: {
        id: 'char_017_huang',
        owned: true,
        current: { modules: { '过载的武器与过热的心脏': 2, uniequip_002_huang: 1 } },
        target: { modules: { '过载的武器与过热的心脏': 3 } }
      }
    },
    settings: {
      planSelection: {
        preset: 'custom',
        excludedItems: ['char_017_huang::module:过载的武器与过热的心脏:2']
      }
    }
  }, idData);

  assert.deepEqual(normalized.operators.煌.current.modules, { uniequip_002_huang: 2 });
  assert.deepEqual(normalized.operators.煌.target.modules, { uniequip_002_huang: 3 });
  assert.deepEqual(normalized.settings.planSelection.excludedItems, ['char_017_huang::module:uniequip_002_huang:2']);
});
