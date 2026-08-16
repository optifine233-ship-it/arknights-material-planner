const DEFAULT_MODULE_LMD = {
  3: [20000, 25000, 30000],
  4: [40000, 50000, 60000],
  5: [80000, 100000, 120000]
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(safeNumber(value)));
}

function addMaterial(target, name, quantity) {
  const qty = nonNegativeInteger(quantity);
  if (!name || qty === 0) return;
  target[name] = (target[name] || 0) + qty;
}

function cloneMaterials(materials = []) {
  return materials
    .map((material) => ({
      name: String(material?.name || ''),
      qty: nonNegativeInteger(material?.qty)
    }))
    .filter((material) => material.name && material.qty > 0);
}

function stateValue(state, key, fallback) {
  return state && state[key] !== undefined ? state[key] : fallback;
}

function normalizeCultivationState(state = {}) {
  return {
    elite: nonNegativeInteger(stateValue(state, 'elite', 0)),
    level: Math.max(1, nonNegativeInteger(stateValue(state, 'level', 1))),
    skillLevel: Math.max(1, nonNegativeInteger(stateValue(state, 'skillLevel', 1))),
    mastery: {
      s1: nonNegativeInteger(state?.mastery?.s1),
      s2: nonNegativeInteger(state?.mastery?.s2),
      s3: nonNegativeInteger(state?.mastery?.s3)
    },
    modules: Object.fromEntries(
      Object.entries(state?.modules || {}).map(([key, value]) => [key, nonNegativeInteger(value)])
    )
  };
}

function levelCostForRange(elite, fromLevel, toLevel, gameData) {
  const costs = gameData.LEVEL_COSTS?.[`e${elite}`] || [];
  let exp = 0;
  let lmd = 0;

  for (let level = fromLevel; level < toLevel; level += 1) {
    const entry = costs[level - 1];
    if (!entry) continue;
    exp += nonNegativeInteger(entry.exp);
    lmd += nonNegativeInteger(entry.lmd);
  }

  return { exp, lmd };
}

function makeUpgradeItem(operatorName, fields) {
  return {
    operatorName,
    kind: fields.kind,
    key: fields.key,
    label: fields.label,
    stage: fields.stage ?? null,
    materials: cloneMaterials(fields.materials),
    exp: nonNegativeInteger(fields.exp),
    lmd: nonNegativeInteger(fields.lmd),
    meta: fields.meta || {}
  };
}

export function buildOperatorUpgradeItems(operatorName, operator, progress, gameData) {
  if (!operator || !gameData) return [];

  const current = normalizeCultivationState(progress?.current);
  const target = normalizeCultivationState(progress?.target);
  const maxLevels = gameData.MAX_LV?.[operator.r] || {};
  const moduleLmd = gameData.MODULE_LMD || DEFAULT_MODULE_LMD;
  const items = [];

  if (target.elite > current.elite || (target.elite === current.elite && target.level > current.level)) {
    for (let elite = current.elite; elite <= target.elite; elite += 1) {
      const fromLevel = elite === current.elite ? current.level : 1;
      const toLevel = elite === target.elite ? target.level : nonNegativeInteger(maxLevels[`e${elite}`]);
      const boundedToLevel = Math.max(fromLevel, toLevel);
      const cost = levelCostForRange(elite, fromLevel, boundedToLevel, gameData);

      if (boundedToLevel > fromLevel && (cost.exp > 0 || cost.lmd > 0)) {
        items.push(makeUpgradeItem(operatorName, {
          kind: 'level',
          key: `level:e${elite}:${fromLevel}-${boundedToLevel}`,
          label: `精英${elite} · ${fromLevel}→${boundedToLevel}级`,
          stage: elite,
          exp: cost.exp,
          lmd: cost.lmd,
          meta: { elite, fromLevel, toLevel: boundedToLevel }
        }));
      }

      if (elite < target.elite) {
        const promotionStage = elite + 1;
        items.push(makeUpgradeItem(operatorName, {
          kind: 'promotion',
          key: `promotion:e${promotionStage}`,
          label: `晋升精英${promotionStage}`,
          stage: promotionStage,
          materials: operator[`e${promotionStage}`] || [],
          lmd: gameData.ELITE_LMD?.[operator.r]?.[`e${promotionStage}`] || 0
        }));
      }
    }
  }

  const maxSkillLevel = Math.max(current.skillLevel, target.skillLevel);
  for (let level = current.skillLevel + 1; level <= maxSkillLevel; level += 1) {
    const skillStage = (operator.sl || []).find((entry) => nonNegativeInteger(entry.level) === level);
    if (!skillStage) continue;
    items.push(makeUpgradeItem(operatorName, {
      kind: 'skill',
      key: `skill:${level}`,
      label: `技能等级 ${level}`,
      stage: level,
      materials: skillStage.mats
    }));
  }

  for (const [skillKey, skillLabel] of [['s1', '技能一'], ['s2', '技能二'], ['s3', '技能三']]) {
    const fromStage = current.mastery[skillKey] || 0;
    const toStage = Math.max(fromStage, target.mastery[skillKey] || 0);
    for (let stage = fromStage + 1; stage <= toStage; stage += 1) {
      const masteryStage = (operator.ms?.[skillKey] || []).find(
        (entry) => nonNegativeInteger(entry.stage) === stage
      );
      if (!masteryStage) continue;
      items.push(makeUpgradeItem(operatorName, {
        kind: 'mastery',
        key: `mastery:${skillKey}:${stage}`,
        label: `${skillLabel} · 专精${stage}`,
        stage,
        materials: masteryStage.mats,
        meta: { skill: skillKey }
      }));
    }
  }

  for (const [moduleIndex, module] of (operator.md || []).entries()) {
    const moduleKey = String(module.id || module.name || moduleIndex);
    const fromStage = current.modules[moduleKey] || 0;
    const toStage = Math.max(fromStage, target.modules[moduleKey] || 0);
    for (let stage = fromStage + 1; stage <= toStage; stage += 1) {
      const moduleStage = (module.stages || []).find(
        (entry) => nonNegativeInteger(entry.stage) === stage
      );
      if (!moduleStage) continue;
      items.push(makeUpgradeItem(operatorName, {
        kind: 'module',
        key: `module:${moduleKey}:${stage}`,
        label: `${module.name} · ${stage}级`,
        stage,
        materials: moduleStage.mats,
        lmd: moduleLmd[operator.r]?.[stage - 1] || 0,
        meta: { moduleKey, moduleIndex, moduleName: module.name }
      }));
    }
  }

  return items;
}

export function buildPlanUpgradeItems(gameData, userState) {
  const items = [];
  for (const operatorName of gameData.OPS_ORDER || Object.keys(gameData.OPS || {})) {
    const progress = userState?.operators?.[operatorName];
    if (!progress?.owned && !progress?.target) continue;
    items.push(...buildOperatorUpgradeItems(
      operatorName,
      gameData.OPS?.[operatorName],
      progress,
      gameData
    ));
  }
  return items;
}

export function sumDirectMaterials(items = []) {
  const result = {};
  for (const item of items) {
    for (const material of item.materials || []) {
      addMaterial(result, material.name, material.qty);
    }
  }
  return result;
}

function canDecompose(name, gameData, stopTier) {
  const recipe = gameData.RECIPES?.[name];
  if (!recipe?.length) return false;

  if (name.includes('双芯片')) return true;
  if (name.includes('芯片')) return false;

  const tier = gameData.MAT_RARITY?.[name] ?? 0;
  return tier > stopTier;
}

export function decomposeMaterial(name, quantity, gameData, options = {}) {
  const stopTier = options.stopTier ?? 2;
  const maxDepth = options.maxDepth ?? 12;
  const result = {};

  function visit(materialName, qty, depth, trail) {
    if (depth > maxDepth || trail.has(materialName) || !canDecompose(materialName, gameData, stopTier)) {
      addMaterial(result, materialName, qty);
      return;
    }

    const nextTrail = new Set(trail);
    nextTrail.add(materialName);
    for (const ingredient of gameData.RECIPES[materialName]) {
      visit(ingredient.name, qty * nonNegativeInteger(ingredient.qty), depth + 1, nextTrail);
    }
  }

  visit(name, nonNegativeInteger(quantity), 0, new Set());
  return result;
}

function lowerTierRecipe(name, gameData, baseTier) {
  const recipe = gameData.RECIPES?.[name];
  if (!recipe?.length || (gameData.MAT_RARITY?.[name] ?? 0) !== baseTier) return null;
  if (!recipe.every((ingredient) => (gameData.MAT_RARITY?.[ingredient.name] ?? baseTier) < baseTier)) {
    return null;
  }
  return recipe;
}

export function computeMaterialSummary(items = [], inventory = {}, gameData, options = {}) {
  const stopTier = options.stopTier ?? 2;
  const directNeeds = sumDirectMaterials(items);
  const remainingInventory = Object.fromEntries(
    Object.entries(inventory || {}).map(([name, qty]) => [name, nonNegativeInteger(qty)])
  );
  const consumedFinishedInventory = {};
  const baseRequired = {};

  for (const [name, required] of Object.entries(directNeeds)) {
    if (canDecompose(name, gameData, stopTier)) {
      const used = Math.min(required, remainingInventory[name] || 0);
      if (used > 0) {
        remainingInventory[name] -= used;
        consumedFinishedInventory[name] = used;
      }
      const decomposed = decomposeMaterial(name, required - used, gameData, { stopTier });
      for (const [baseName, qty] of Object.entries(decomposed)) addMaterial(baseRequired, baseName, qty);
      continue;
    }
    addMaterial(baseRequired, name, required);
  }

  const rows = [];
  for (const [name, required] of Object.entries(baseRequired)) {
    const directInventoryUsed = Math.min(required, remainingInventory[name] || 0);
    remainingInventory[name] = (remainingInventory[name] || 0) - directInventoryUsed;
    let shortage = required - directInventoryUsed;
    let craftedFromLower = 0;
    const lowerInventoryUsed = {};
    const recipe = lowerTierRecipe(name, gameData, stopTier);

    if (shortage > 0 && recipe) {
      const possibleCrafts = Math.min(
        ...recipe.map((ingredient) => Math.floor(
          (remainingInventory[ingredient.name] || 0) / nonNegativeInteger(ingredient.qty)
        ))
      );
      craftedFromLower = Math.min(shortage, Math.max(0, possibleCrafts));

      if (craftedFromLower > 0) {
        for (const ingredient of recipe) {
          const used = nonNegativeInteger(ingredient.qty) * craftedFromLower;
          remainingInventory[ingredient.name] = (remainingInventory[ingredient.name] || 0) - used;
          lowerInventoryUsed[ingredient.name] = used;
        }
        shortage -= craftedFromLower;
      }
    }

    rows.push({
      name,
      tier: gameData.MAT_RARITY?.[name] ?? 0,
      required,
      directInventoryUsed,
      craftedFromLower,
      lowerInventoryUsed,
      shortage,
      procurementCertificates: name === '芯片助剂' ? shortage * 90 : 0
    });
  }

  return {
    directNeeds,
    baseRequired,
    rows,
    consumedFinishedInventory,
    remainingInventory,
    totalExp: items.reduce((sum, item) => sum + nonNegativeInteger(item.exp), 0),
    totalLmd: items.reduce((sum, item) => sum + nonNegativeInteger(item.lmd), 0)
  };
}
