import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildOperatorUpgradeItems } from '../src/calculator.js';
import { formatModuleName, moduleTypeLabel } from '../src/modules.js';
import { parseOperatorWikitext } from '../scripts/lib/prts-parser.mjs';
import { enrichOperatorProgressIds } from '../scripts/lib/progress-id-enricher.mjs';

test('从 PRTS 模组模板读取 X、Δ 和特限类型码', () => {
  const parsed = parseOperatorWikitext(`
{{CharinfoV2|干员名=测试干员|干员id=char_test|稀有度=5|职业=术师|分支=秘术师|位置=远程位}}
{{模组|名称=X模组|类型=MSC-X|材料消耗={{材料消耗|模组数据块|4}}}}
{{模组|名称=三角模组|类型=MSC-Δ|材料消耗={{材料消耗|模组数据块|4}}}}
{{模组|名称=特限证章|类型=ISW-α|材料消耗={{材料消耗|模组数据块|1}}}}
`, '测试干员');

  assert.deepEqual(parsed.operator.md.map((module) => module.type), ['MSC-X', 'MSC-Δ', 'ISW-α']);
});

test('公开游戏数据为现有模组补齐稳定 ID 和规范类型码', () => {
  const result = enrichOperatorProgressIds({
    测试干员: {
      id: 'char_test',
      ms: {},
      md: [
        { name: 'X模组', stages: [] },
        { name: '三角模组', stages: [] },
        { name: '特限证章', stages: [] }
      ]
    }
  }, {
    characters: {},
    patchChars: {},
    equipDict: {
      equip_x: { uniEquipId: 'equip_x', uniEquipName: 'X模组', type: 'ADVANCED', typeName1: 'MSC', typeName2: 'X' },
      equip_d: { uniEquipId: 'equip_d', uniEquipName: '三角模组', type: 'ADVANCED', typeName1: 'MSC', typeName2: 'D' },
      equip_a: { uniEquipId: 'equip_a', uniEquipName: '特限证章', type: 'ADVANCED', typeName1: 'ISW', typeName2: 'A', isSpecialEquip: true }
    }
  });

  assert.deepEqual(
    result.operators.测试干员.md.map(({ id, type }) => ({ id, type })),
    [
      { id: 'equip_x', type: 'MSC-X' },
      { id: 'equip_d', type: 'MSC-Δ' },
      { id: 'equip_a', type: 'ISW-α' }
    ]
  );
});

test('模组类型使用玩家常用简称并兼容旧数据', () => {
  assert.equal(moduleTypeLabel('MAR-X'), 'X模');
  assert.equal(moduleTypeLabel('MAR-Y'), 'Y模');
  assert.equal(moduleTypeLabel('MSC-Δ'), '△模');
  assert.equal(moduleTypeLabel('MSC-D'), '△模');
  assert.equal(moduleTypeLabel('ISW-α'), '特限模');
  assert.equal(moduleTypeLabel('ISW-A'), '特限模');
  assert.equal(formatModuleName({ name: '旧日重现', type: 'MAR-X' }), 'X模 · 旧日重现');
  assert.equal(formatModuleName({ name: '旧数据模组' }), '旧数据模组');
});

test('培养计划中的模组强化项带有类型简称', () => {
  const operator = {
    id: 'char_test',
    r: 5,
    p: '术师',
    sl: [],
    ms: {},
    md: [{ id: 'equip_d', name: '朽坏传承', type: 'MSC-Δ', stages: [{ stage: 1, mats: [] }] }]
  };
  const state = (moduleLevel) => ({
    elite: 2,
    level: 90,
    skillLevel: 1,
    mastery: {},
    modules: { equip_d: moduleLevel }
  });
  const items = buildOperatorUpgradeItems('测试干员', operator, {
    current: state(0),
    target: state(1)
  }, {
    MAX_LV: { 5: { e0: 50, e1: 80, e2: 90 } },
    MODULE_LMD: { 5: [80000, 100000, 120000] }
  });

  assert.equal(items[0].label, '△模 · 朽坏传承 · 1级');
});

test('详情页模组名称统一使用类型格式化函数', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /formatModuleName\(module\)/);
});
