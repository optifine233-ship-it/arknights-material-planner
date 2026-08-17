import test from 'node:test';
import assert from 'node:assert/strict';

import { applySklandImport, parseSklandCultivateSnapshot } from '../src/importers/skland.js';

const gameData = {
  OPS: {
    煌: {
      id: 'char_017_huang',
      r: 5,
      skillIds: { s1: 'skill-a', s2: 'skill-b', s3: 'skill-c' },
      ms: { s1: [{ stage: 1 }], s2: [{ stage: 1 }], s3: [{ stage: 1 }] },
      md: [
        { id: 'equip-x', name: 'X 模组', stages: [{ stage: 1 }, { stage: 2 }, { stage: 3 }] },
        { id: 'equip-y', name: 'Y 模组', stages: [{ stage: 1 }, { stage: 2 }, { stage: 3 }] }
      ]
    },
    能天使: { id: 'char_103_angel', r: 5, skillIds: {}, ms: { s1: [], s2: [], s3: [] }, md: [] }
  },
  OPS_ORDER: ['煌', '能天使'],
  MAX_LV: { 5: { e0: 50, e1: 80, e2: 90 } },
  MATERIAL_META: {
    异铁: { id: '30042' },
    龙门币: { id: '4001' }
  }
};

function snapshot(overrides = {}) {
  return {
    format: 'skland-cultivate-snapshot',
    version: 1,
    completeness: { characters: 'partial', items: 'unknown' },
    characters: [{
      id: 'char_017_huang',
      evolvePhase: 2,
      level: 70,
      potentialRank: 3,
      mainSkillLevel: 7,
      skills: [{ id: 'skill-c', level: 1 }, { id: 'skill-a', level: 3 }, { id: 'skill-b', level: 2 }],
      equips: [{ id: 'equip-y', level: 1 }, { id: 'equip-x', level: 3 }]
    }],
    items: [],
    ...overrides
  };
}

test('按稳定 ID 导入基础等级、潜能、专精和模组，不依赖数组顺序', () => {
  const parsed = parseSklandCultivateSnapshot(snapshot(), gameData);

  assert.equal(parsed.operators.煌.potential, 4);
  assert.deepEqual(parsed.operators.煌.current, {
    elite: 2,
    level: 70,
    skillLevel: 7,
    mastery: { s1: 3, s2: 2, s3: 1 },
    modules: { 'equip-y': 1, 'equip-x': 3 }
  });
  assert.deepEqual(parsed.unknown, { operators: [], skills: [], modules: [], items: [] });
});

test('未知技能、模组和干员只进入预览，不会猜测写入', () => {
  const parsed = parseSklandCultivateSnapshot(snapshot({
    characters: [
      { ...snapshot().characters[0], skills: [{ id: 'unknown-skill', level: 3 }], equips: [{ id: 'unknown-equip', level: 2 }] },
      { ...snapshot().characters[0], id: 'char_unknown' }
    ]
  }), gameData);

  assert.deepEqual(parsed.operators.煌.current.mastery, {});
  assert.deepEqual(parsed.operators.煌.current.modules, {});
  assert.equal(parsed.operators.煌.detailCoverage.mastery, false);
  assert.equal(parsed.operators.煌.detailCoverage.modules, false);
  assert.equal(parsed.unknown.operators[0].id, 'char_unknown');
  assert.equal(parsed.unknown.skills[0].id, 'unknown-skill');
  assert.equal(parsed.unknown.modules[0].id, 'unknown-equip');
});

test('拒绝含账号凭据字段、旧 player/info 格式和零命中快照', () => {
  assert.throws(
    () => parseSklandCultivateSnapshot({ ...snapshot(), cred: 'secret-value' }, gameData),
    /账号凭据/
  );
  assert.throws(
    () => parseSklandCultivateSnapshot({ format: 'skland-cultivate-snapshot', version: 1, chars: [] }, gameData),
    /不支持的字段|脱敏养成快照/
  );
  assert.throws(
    () => parseSklandCultivateSnapshot(snapshot({ characters: [{ ...snapshot().characters[0], id: 'char_unknown' }] }), gameData),
    /没有匹配到本站干员/
  );
});

test('合并只更新快照提供的当前状态，保留目标并自动抬高', () => {
  const existing = {
    operators: {
      煌: {
        owned: true,
        potential: 2,
        current: {
          elite: 1, level: 60, skillLevel: 7,
          mastery: { s1: 1, s2: 0, s3: 0 },
          modules: { 'equip-x': 1 }
        },
        target: {
          elite: 2, level: 60, skillLevel: 7,
          mastery: { s1: 2, s2: 3, s3: 0 },
          modules: { 'equip-x': 2 }
        }
      }
    },
    inventory: { 异铁: 8 }
  };
  const next = applySklandImport(existing, parseSklandCultivateSnapshot(snapshot(), gameData), 'merge', gameData);

  assert.equal(next.operators.煌.current.level, 70);
  assert.equal(next.operators.煌.target.level, 70);
  assert.equal(next.operators.煌.target.mastery.s1, 3);
  assert.equal(next.operators.煌.target.mastery.s2, 3);
  assert.equal(next.inventory.异铁, 8);
});

test('森空岛首版只允许安全合并，不提供替换拥有列表', () => {
  const existing = { operators: { 能天使: { owned: true, current: { elite: 1, level: 80 } } } };
  const parsed = parseSklandCultivateSnapshot(snapshot(), gameData);
  assert.throws(() => applySklandImport(existing, parsed, 'replace', gameData), /只支持合并/);
});

test('首版明确拒绝任何库存字段，避免未预览的覆盖或清空', () => {
  assert.throws(() => parseSklandCultivateSnapshot(snapshot({
    completeness: { characters: 'partial', items: 'partial' },
    items: [{ id: '30042', count: 12 }]
  }), gameData), /暂不导入库存/);
});

test('多个干员共用同一技能 ID 时仍按所属干员映射', () => {
  const sharedData = {
    ...gameData,
    OPS: {
      煌: { ...gameData.OPS.煌, skillIds: { s1: 'shared-skill' } },
      能天使: {
        ...gameData.OPS.能天使,
        skillIds: { s1: 'shared-skill' },
        ms: { s1: [{ stage: 1 }], s2: [], s3: [] }
      }
    }
  };
  const parsed = parseSklandCultivateSnapshot(snapshot({
    characters: [{
      ...snapshot().characters[0],
      skills: [{ id: 'shared-skill', level: 3 }], equips: []
    }]
  }), sharedData);

  assert.equal(parsed.operators.煌.current.mastery.s1, 3);
  assert.equal(parsed.unknown.skills.length, 0);
});

test('拒绝同一干员或物品的冲突重复记录', () => {
  const operator = snapshot().characters[0];
  assert.throws(() => parseSklandCultivateSnapshot(snapshot({
    characters: [operator, { ...operator, level: 71 }]
  }), gameData), /冲突的干员记录/);

});

test('拒绝异常大的粘贴内容', () => {
  assert.throws(() => parseSklandCultivateSnapshot(' '.repeat(8_000_001), gameData), /文件过大/);
});

test('缺少完整养成字段的角色记录会整批拒绝，不会使用归零默认值', () => {
  assert.throws(() => parseSklandCultivateSnapshot(snapshot({
    characters: [{ id: 'char_017_huang' }]
  }), gameData), /字段不完整/);
});

test('未知技能或模组时合并会保留已有详细进度', () => {
  const existing = {
    operators: {
      煌: {
        owned: true,
        current: { elite: 2, level: 60, skillLevel: 7, mastery: { s1: 3, s2: 2, s3: 1 }, modules: { 'equip-x': 2 } },
        target: { elite: 2, level: 90, skillLevel: 7, mastery: { s1: 3, s2: 3, s3: 3 }, modules: { 'equip-x': 3 } }
      }
    }
  };
  const parsed = parseSklandCultivateSnapshot(snapshot({
    characters: [{ ...snapshot().characters[0], skills: [{ id: 'unknown', level: 3 }], equips: [{ id: 'unknown', level: 3 }] }]
  }), gameData);
  const next = applySklandImport(existing, parsed, 'merge', gameData);
  assert.deepEqual(next.operators.煌.current.mastery, { s1: 3, s2: 2, s3: 1 });
  assert.deepEqual(next.operators.煌.current.modules, { 'equip-x': 2 });
});

test('严格拒绝额外账号字段及常见 token 别名', () => {
  assert.throws(() => parseSklandCultivateSnapshot({ ...snapshot(), oauthToken: 'secret' }, gameData), /账号凭据/);
  assert.throws(() => parseSklandCultivateSnapshot({ ...snapshot(), extra: true }, gameData), /不支持的字段/);
});
