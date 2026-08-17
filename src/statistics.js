import {
  buildOperatorUpgradeItems,
  buildPlanUpgradeItems,
  sumDirectMaterials
} from './calculator.js';
import { createCultivationState } from './storage.js';

function summarizeItems(items) {
  const materials = sumDirectMaterials(items);
  return {
    items,
    totalExp: items.reduce((sum, item) => sum + (item.exp || 0), 0),
    totalLmd: items.reduce((sum, item) => sum + (item.lmd || 0), 0),
    materials,
    materialRanking: Object.entries(materials)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'zh-CN')),
    operatorCount: new Set(items.map((item) => item.operatorName)).size,
    byKind: items.reduce((groups, item) => {
      groups[item.kind] = (groups[item.kind] || 0) + 1;
      return groups;
    }, {})
  };
}

function blankDistribution() {
  return { owned: 0, elite2: 0, planned: 0 };
}

function addDistribution(target, key, values) {
  if (!target[key]) target[key] = blankDistribution();
  target[key].owned += values.owned;
  target[key].elite2 += values.elite2;
  target[key].planned += values.planned;
}

export function calculateStatistics(gameData, userState, scopedPlanItems = null) {
  const allPlanItems = buildPlanUpgradeItems(gameData, userState);
  const planItems = Array.isArray(scopedPlanItems) ? scopedPlanItems : allPlanItems;
  const plannedOperators = new Set(allPlanItems.map((item) => item.operatorName));
  const investedItems = [];
  const operatorInvestments = [];
  const profession = {};
  const subprofession = {};
  const rarity = {};

  let owned = 0;
  let elite2 = 0;
  let masteryStages = 0;
  let unlockedModules = 0;
  let level3Modules = 0;
  let skill7 = 0;
  let maxPotential = 0;
  const eliteStages = { e0: 0, e1: 0, e2: 0 };
  const masterySkills = { m0: 0, m1: 0, m2: 0, m3: 0 };
  const moduleStages = { m0: 0, m1: 0, m2: 0, m3: 0 };

  for (const operatorName of gameData.OPS_ORDER || Object.keys(gameData.OPS || {})) {
    const operator = gameData.OPS?.[operatorName];
    const progress = userState?.operators?.[operatorName];
    if (!operator || !progress?.owned) continue;

    owned += 1;
    const current = progress.current || createCultivationState();
    const isElite2 = current.elite >= 2;
    if (isElite2) elite2 += 1;
    eliteStages[`e${Math.min(2, current.elite || 0)}`] += 1;
    if (current.skillLevel >= 7) skill7 += 1;
    if ((progress.potential || 0) >= 6) maxPotential += 1;
    masteryStages += Object.values(current.mastery || {}).reduce((sum, stage) => sum + stage, 0);
    for (const stage of Object.values(current.mastery || {})) {
      masterySkills[`m${Math.min(3, stage || 0)}`] += 1;
    }
    const currentModuleStages = Object.values(current.modules || {});
    unlockedModules += currentModuleStages.filter((stage) => stage > 0).length;
    level3Modules += currentModuleStages.filter((stage) => stage >= 3).length;
    for (const stage of currentModuleStages) {
      moduleStages[`m${Math.min(3, stage || 0)}`] += 1;
    }

    const distributionValues = {
      owned: 1,
      elite2: isElite2 ? 1 : 0,
      planned: plannedOperators.has(operatorName) ? 1 : 0
    };
    addDistribution(profession, operator.p || '未知职业', distributionValues);
    addDistribution(subprofession, operator.sp || '未知分支', distributionValues);
    addDistribution(rarity, `${(operator.r || 0) + 1}星`, distributionValues);

    const operatorItems = buildOperatorUpgradeItems(operatorName, operator, {
      current: createCultivationState(),
      target: current
    }, gameData);
    investedItems.push(...operatorItems);
    const operatorSummary = summarizeItems(operatorItems);
    operatorInvestments.push({
      name: operatorName,
      profession: operator.p,
      rarity: (operator.r || 0) + 1,
      exp: operatorSummary.totalExp,
      lmd: operatorSummary.totalLmd,
      materialKinds: Object.keys(operatorSummary.materials).length,
      upgradeItems: operatorItems.length
    });
  }

  operatorInvestments.sort((a, b) => b.lmd - a.lmd || b.exp - a.exp || a.name.localeCompare(b.name, 'zh-CN'));

  return {
    overview: {
      owned,
      elite2,
      elite2Ratio: owned ? elite2 / owned : 0,
      masteryStages,
      unlockedModules,
      level3Modules,
      skill7,
      maxPotential
    },
    progress: {
      eliteStages,
      masterySkills,
      moduleStages,
      plannedOperators: plannedOperators.size
    },
    invested: summarizeItems(investedItems),
    plan: summarizeItems(planItems),
    distributions: { profession, subprofession, rarity },
    operatorInvestments
  };
}
