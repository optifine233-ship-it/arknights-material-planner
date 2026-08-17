import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOperatorUpgradeItems,
  computeMaterialSummary,
  decomposeMaterial,
  sumDirectMaterials
} from '../src/calculator.js';

const fixture = {
  MAT_RARITY: {
    金材料: 4,
    紫材料: 3,
    蓝材料: 2,
    异铁块: 3,
    异铁组: 2,
    异铁: 1,
    全新装置: 2,
    聚酸酯组: 2,
    近卫双芯片: 4,
    近卫芯片组: 3,
    芯片助剂: 3,
    低阶共享料: 1,
    蓝甲: 2,
    蓝乙: 2
  },
  RECIPES: {
    金材料: [{ name: '紫材料', qty: 2 }],
    紫材料: [{ name: '蓝材料', qty: 3 }],
    异铁块: [
      { name: '异铁组', qty: 2 },
      { name: '全新装置', qty: 1 },
      { name: '聚酸酯组', qty: 1 }
    ],
    异铁组: [{ name: '异铁', qty: 4 }],
    近卫双芯片: [
      { name: '近卫芯片组', qty: 2 },
      { name: '芯片助剂', qty: 1 }
    ],
    蓝甲: [{ name: '低阶共享料', qty: 2 }],
    蓝乙: [{ name: '低阶共享料', qty: 2 }]
  },
  MAX_LV: {
    5: { e0: 2, e1: 2, e2: 3 }
  },
  LEVEL_COSTS: {
    e0: [{ lv: 1, exp: 10, lmd: 1 }],
    e1: [{ lv: 1, exp: 20, lmd: 2 }],
    e2: [
      { lv: 1, exp: 30, lmd: 3 },
      { lv: 2, exp: 40, lmd: 4 }
    ]
  },
  ELITE_LMD: {
    5: { e1: 100, e2: 200 }
  }
};

test('逐项生成升级、精英化、技能、专精和完整模组名称', () => {
  const operator = {
    r: 5,
    p: '近卫',
    e1: [{ name: '蓝材料', qty: 1 }],
    e2: [{ name: '紫材料', qty: 2 }],
    sl: [
      { level: 2, mats: [{ name: '蓝材料', qty: 1 }] },
      { level: 3, mats: [{ name: '蓝材料', qty: 2 }] }
    ],
    ms: {
      s1: [
        { stage: 1, mats: [{ name: '紫材料', qty: 1 }] },
        { stage: 2, mats: [{ name: '金材料', qty: 1 }] }
      ],
      s2: [],
      s3: []
    },
    md: [{
      name: '过载的武器与过热的心脏',
      stages: [
        { stage: 1, mats: [{ name: '蓝材料', qty: 4 }] },
        { stage: 2, mats: [{ name: '紫材料', qty: 3 }] }
      ]
    }]
  };
  const progress = {
    current: {
      elite: 0,
      level: 1,
      skillLevel: 1,
      mastery: { s1: 0, s2: 0, s3: 0 },
      modules: { '过载的武器与过热的心脏': 0 }
    },
    target: {
      elite: 2,
      level: 2,
      skillLevel: 3,
      mastery: { s1: 2, s2: 0, s3: 0 },
      modules: { '过载的武器与过热的心脏': 2 }
    }
  };

  const items = buildOperatorUpgradeItems('煌', operator, progress, fixture);

  assert.ok(items.some((item) => item.kind === 'promotion' && item.stage === 1));
  assert.ok(items.some((item) => item.kind === 'promotion' && item.stage === 2));
  assert.deepEqual(
    items.filter((item) => item.kind === 'skill').map((item) => ({
      key: item.key,
      label: item.label,
      stage: item.stage,
      materials: item.materials
    })),
    [{
      key: 'skill:1-3',
      label: '技能等级 1→3',
      stage: 3,
      materials: [{ name: '蓝材料', qty: 3 }]
    }]
  );
  assert.deepEqual(
    items.filter((item) => item.kind === 'mastery').map((item) => item.stage),
    [1, 2]
  );
  assert.deepEqual(
    items.filter((item) => item.kind === 'module').map((item) => item.label),
    ['过载的武器与过热的心脏 · 1级', '过载的武器与过热的心脏 · 2级']
  );
  assert.equal(items.reduce((sum, item) => sum + item.exp, 0), 60);
  assert.equal(items.reduce((sum, item) => sum + item.lmd, 0), 300 + 6 + 80000 + 100000);
});

test('从任意当前技能等级到目标等级合并为一项', () => {
  const operator = {
    id: 'char_skill_range',
    r: 5,
    sl: [2, 3, 4, 5, 6, 7].map((level) => ({
      level,
      mats: [{ name: '蓝材料', qty: level }]
    }))
  };
  const items = buildOperatorUpgradeItems('测试干员', operator, {
    current: { elite: 0, level: 1, skillLevel: 3 },
    target: { elite: 0, level: 1, skillLevel: 7 }
  }, fixture);

  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'skill:3-7');
  assert.equal(items[0].label, '技能等级 3→7');
  assert.deepEqual(items[0].materials, [{ name: '蓝材料', qty: 22 }]);
});

test('电弧和机械师不生成任何养成资源需求', () => {
  for (const id of ['char_4195_radian', 'char_4230_mcnist']) {
    const items = buildOperatorUpgradeItems('特殊干员', { id, r: 5, e1: [], e2: [], sl: [], ms: {}, md: [] }, {
      current: { elite: 0, level: 1, skillLevel: 1 },
      target: { elite: 2, level: 90, skillLevel: 7 }
    }, fixture);
    assert.deepEqual(items, []);
  }
});

test('特殊干员名称不会误伤同名材料汇总', () => {
  assert.deepEqual(sumDirectMaterials([{
    materials: [
      { name: '电弧', qty: 2 },
      { name: '机械师', qty: 3 }
    ]
  }]), { 电弧: 2, 机械师: 3 });
});

test('材料递归分解默认停在 T3 展示基准层', () => {
  assert.deepEqual(decomposeMaterial('金材料', 2, fixture), { 蓝材料: 12 });
  assert.deepEqual(decomposeMaterial('异铁块', 1, fixture), {
    异铁组: 2,
    全新装置: 1,
    聚酸酯组: 1
  });
});

test('双芯片分解为芯片组和芯片助剂', () => {
  assert.deepEqual(decomposeMaterial('近卫双芯片', 2, fixture), {
    近卫芯片组: 4,
    芯片助剂: 2
  });
});

test('T2 库存按整数配方抵扣 T3 缺口', () => {
  const items = [{ materials: [{ name: '异铁组', qty: 3 }], exp: 0, lmd: 0 }];
  const result = computeMaterialSummary(items, { 异铁组: 1, 异铁: 7 }, fixture);
  const row = result.rows.find((item) => item.name === '异铁组');

  assert.equal(row.required, 3);
  assert.equal(row.directInventoryUsed, 1);
  assert.equal(row.craftedFromLower, 1);
  assert.equal(row.shortage, 1);
  assert.deepEqual(row.lowerInventoryUsed, { 异铁: 4 });
  assert.equal(result.remainingInventory.异铁, 3);
});

test('多个目标共享同一份 T2 库存且不会重复抵扣', () => {
  const items = [{
    materials: [
      { name: '蓝甲', qty: 2 },
      { name: '蓝乙', qty: 2 }
    ],
    exp: 0,
    lmd: 0
  }];
  const result = computeMaterialSummary(items, { 低阶共享料: 6 }, fixture);
  const rows = Object.fromEntries(result.rows.map((row) => [row.name, row]));

  assert.equal(rows.蓝甲.craftedFromLower, 2);
  assert.equal(rows.蓝甲.shortage, 0);
  assert.equal(rows.蓝乙.craftedFromLower, 1);
  assert.equal(rows.蓝乙.shortage, 1);
  assert.equal(result.remainingInventory.低阶共享料, 0);
});

test('直接材料汇总与逐项记录可对账', () => {
  const items = [
    { materials: [{ name: '蓝材料', qty: 2 }], exp: 10, lmd: 20 },
    { materials: [{ name: '蓝材料', qty: 3 }, { name: '紫材料', qty: 1 }], exp: 5, lmd: 7 }
  ];

  assert.deepEqual(sumDirectMaterials(items), { 蓝材料: 5, 紫材料: 1 });
});
