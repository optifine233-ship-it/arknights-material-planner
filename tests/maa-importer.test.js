import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMaaOperatorImport, parseMaaOperatorExport } from '../src/importers/maa.js';

const gameData = {
  OPS: {
    煌: { id: 'char_017_huang', r: 5 },
    能天使: { id: 'char_103_angel', r: 5 }
  },
  OPS_ORDER: ['煌', '能天使'],
  MAX_LV: { 5: { e0: 50, e1: 80, e2: 90 } }
};

test('识别 MAA OperBox 回调中的稳定 ID、拥有状态和当前等级', () => {
  const result = parseMaaOperatorExport({
    details: {
      done: true,
      all_opers: [
        { id: 'char_017_huang', name: '煌', rarity: 5, own: true },
        { id: 'char_103_angel', name: '能天使', rarity: 5, own: false }
      ],
      own_opers: [
        { id: 'char_017_huang', name: '名称即使变化也按ID匹配', elite: 2, level: 60, potential: 3, rarity: 5, own: true },
        { id: 'char_unknown', name: '未知干员', elite: 1, level: 40, potential: 1, rarity: 4, own: true }
      ]
    }
  }, gameData);

  assert.equal(result.format, 'maa-oper-box');
  assert.equal(result.operators.煌.owned, true);
  assert.equal(result.operators.煌.current.elite, 2);
  assert.equal(result.operators.煌.current.level, 60);
  assert.equal(result.operators.煌.potential, 3);
  assert.equal(result.operators.能天使.owned, false);
  assert.deepEqual(result.unknown.map((entry) => entry.id), ['char_unknown']);
});

test('可以直接解析粘贴的 MAA 干员识别 JSON 文本', () => {
  const pasted = JSON.stringify({
    details: {
      all_opers: [{ id: 'char_017_huang', name: '煌', own: true }],
      own_opers: [{ id: 'char_017_huang', name: '煌', elite: 2, level: 70, potential: 4, own: true }]
    }
  });

  const result = parseMaaOperatorExport(pasted, gameData);

  assert.equal(result.operators.煌.current.elite, 2);
  assert.equal(result.operators.煌.current.level, 70);
  assert.equal(result.operators.煌.potential, 4);
});

test('应用 MAA 导入时保留其无法识别的技能、专精和模组状态', () => {
  const existing = {
    schemaVersion: 2,
    operators: {
      煌: {
        owned: true,
        potential: 2,
        current: {
          elite: 1,
          level: 60,
          skillLevel: 7,
          mastery: { s1: 3, s2: 2, s3: 0 },
          modules: { 长模组: 1 }
        },
        target: {
          elite: 2,
          level: 90,
          skillLevel: 7,
          mastery: { s1: 3, s2: 3, s3: 3 },
          modules: { 长模组: 3 }
        }
      }
    },
    inventory: {},
    settings: {}
  };
  const imported = parseMaaOperatorExport({
    all_opers: [{ id: 'char_017_huang', name: '煌', own: true }],
    own_opers: [{ id: 'char_017_huang', name: '煌', elite: 2, level: 70, potential: 4, own: true }]
  }, gameData);

  const next = applyMaaOperatorImport(existing, imported, 'merge', gameData);

  assert.equal(next.operators.煌.current.elite, 2);
  assert.equal(next.operators.煌.current.level, 70);
  assert.equal(next.operators.煌.current.skillLevel, 7);
  assert.equal(next.operators.煌.current.mastery.s1, 3);
  assert.equal(next.operators.煌.current.modules.长模组, 1);
  assert.equal(next.operators.煌.target.level, 90);
  assert.equal(next.operators.煌.potential, 4);
});

test('不接受无法定位 all_opers 或 own_opers 的普通 JSON', () => {
  assert.throws(
    () => parseMaaOperatorExport({ operators: [] }, gameData),
    /MAA 干员识别/
  );
});
