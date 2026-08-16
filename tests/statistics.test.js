import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateStatistics } from '../src/statistics.js';

const gameData = {
  OPS_ORDER: ['甲', '乙'],
  OPS: {
    甲: {
      r: 5,
      p: '近卫',
      e1: [{ name: '近卫芯片', qty: 5 }],
      e2: [{ name: '近卫双芯片', qty: 4 }],
      sl: [{ level: 2, mats: [{ name: '技巧概要·卷1', qty: 5 }] }],
      ms: { s1: [{ stage: 1, mats: [{ name: '异铁组', qty: 2 }] }], s2: [], s3: [] },
      md: [{ name: '长模组名称', stages: [{ stage: 1, mats: [{ name: '模组数据块', qty: 4 }] }] }]
    },
    乙: {
      r: 4,
      p: '狙击',
      e1: [{ name: '狙击芯片', qty: 4 }],
      e2: [{ name: '狙击双芯片', qty: 3 }],
      sl: [],
      ms: { s1: [], s2: [], s3: [] },
      md: []
    }
  },
  MAX_LV: {
    5: { e0: 2, e1: 2, e2: 3 },
    4: { e0: 2, e1: 2, e2: 3 }
  },
  LEVEL_COSTS: {
    e0: [{ lv: 1, exp: 10, lmd: 1 }],
    e1: [{ lv: 1, exp: 20, lmd: 2 }],
    e2: [{ lv: 1, exp: 30, lmd: 3 }, { lv: 2, exp: 40, lmd: 4 }]
  },
  ELITE_LMD: {
    5: { e1: 100, e2: 200 },
    4: { e1: 80, e2: 150 }
  }
};

const state = {
  operators: {
    甲: {
      owned: true,
      current: {
        elite: 2,
        level: 2,
        skillLevel: 2,
        mastery: { s1: 1, s2: 0, s3: 0 },
        modules: { 长模组名称: 3 }
      },
      target: {
        elite: 2,
        level: 3,
        skillLevel: 2,
        mastery: { s1: 1, s2: 0, s3: 0 },
        modules: { 长模组名称: 3 }
      }
    },
    乙: {
      owned: true,
      current: {
        elite: 1,
        level: 1,
        skillLevel: 1,
        mastery: { s1: 0, s2: 0, s3: 0 },
        modules: {}
      },
      target: {
        elite: 2,
        level: 1,
        skillLevel: 1,
        mastery: { s1: 0, s2: 0, s3: 0 },
        modules: {}
      }
    }
  },
  inventory: {}
};

test('账号概况、职业分布和计划数量来自同一份状态', () => {
  const stats = calculateStatistics(gameData, state);

  assert.equal(stats.overview.owned, 2);
  assert.equal(stats.overview.elite2, 1);
  assert.equal(stats.overview.elite2Ratio, 0.5);
  assert.equal(stats.overview.masteryStages, 1);
  assert.equal(stats.overview.unlockedModules, 1);
  assert.equal(stats.overview.level3Modules, 1);
  assert.equal(stats.plan.operatorCount, 2);
  assert.equal(stats.distributions.profession.近卫.owned, 1);
  assert.equal(stats.distributions.profession.近卫.elite2, 1);
  assert.equal(stats.distributions.profession.狙击.planned, 1);
});

test('理论已投入和未来计划分别计算且不混在一起', () => {
  const stats = calculateStatistics(gameData, state);

  assert.ok(stats.invested.items.length > stats.plan.items.length);
  assert.ok(stats.invested.totalLmd > stats.plan.totalLmd);
  assert.equal(stats.plan.items.length, 3);
  assert.deepEqual(stats.plan.items.map((item) => item.kind), ['level', 'level', 'promotion']);
  assert.equal(stats.operatorInvestments[0].name, '甲');
  assert.ok(stats.operatorInvestments[0].lmd > 0);
});
