import { normalizeOperatorProgress, normalizeUserState } from '../storage.js';

const FORMAT = 'skland-cultivate-snapshot';
const FORBIDDEN_KEYS = /(?:cred(?:ential)?|token|authorization|cookie|account|phone|password|sign(?:ature)?|session|oauth|uid|nickname)/i;
const ROOT_KEYS = new Set(['format', 'version', 'generatedAt', 'completeness', 'characters', 'items']);
const COMPLETENESS_KEYS = new Set(['characters', 'items']);
const CHARACTER_KEYS = new Set(['id', 'evolvePhase', 'level', 'potentialRank', 'mainSkillLevel', 'skills', 'equips']);
const DETAIL_KEYS = new Set(['id', 'level']);

function parsedJson(input) {
  if (typeof input === 'string' && input.length > 8_000_000) {
    throw new Error('森空岛养成快照文件过大，已停止解析。');
  }
  try {
    return typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    throw new Error('森空岛养成快照不是有效的 JSON。');
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNoSecretFields(value) {
  const queue = [value];
  const visited = new Set();
  let inspected = 0;
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    inspected += 1;
    if (inspected > 50_000) throw new Error('森空岛快照结构过于复杂，已停止解析。');
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_KEYS.test(key)) {
        throw new Error('检测到账号凭据或个人账号字段。本站只接受脱敏养成快照，请勿粘贴森空岛凭据。');
      }
      if (child && typeof child === 'object') queue.push(child);
    }
  }
}

function assertAllowedKeys(record, allowed, context) {
  if (!isRecord(record)) throw new Error(`${context}字段不完整或格式错误。`);
  const unsupported = Object.keys(record).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`${context}包含不支持的字段（${unsupported}）。`);
}

function assertInteger(value, minimum, maximum, context) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${context}字段不完整或超出范围。`);
  }
}

function assertDetailList(values, context) {
  if (!Array.isArray(values)) throw new Error(`${context}字段不完整或格式错误。`);
  for (const value of values) {
    assertAllowedKeys(value, DETAIL_KEYS, context);
    if (typeof value.id !== 'string' || !value.id) throw new Error(`${context}字段不完整或格式错误。`);
    assertInteger(value.level, 0, 3, context);
  }
}

function assertCharacter(raw) {
  assertAllowedKeys(raw, CHARACTER_KEYS, '干员记录');
  if (typeof raw.id !== 'string' || !raw.id) throw new Error('干员记录字段不完整或格式错误。');
  assertInteger(raw.evolvePhase, 0, 2, '干员精英阶段');
  assertInteger(raw.level, 1, 100, '干员等级');
  assertInteger(raw.potentialRank, 0, 5, '干员潜能');
  assertInteger(raw.mainSkillLevel, 1, 7, '干员技能等级');
  assertDetailList(raw.skills, '技能记录');
  assertDetailList(raw.equips, '模组记录');
}

function indexes(gameData) {
  const operatorById = new Map();
  const skillsByOperator = new Map();
  const modulesByOperator = new Map();
  const expectedSkillsByOperator = new Map();
  const expectedModulesByOperator = new Map();

  for (const [name, operator] of Object.entries(gameData?.OPS || {})) {
    if (operator.id) operatorById.set(String(operator.id), name);
    const skillById = new Map();
    const expectedSkills = new Map();
    for (const [skillKey, skillId] of Object.entries(operator.skillIds || {})) {
      if (!skillId) continue;
      skillById.set(String(skillId), skillKey);
      if (operator.ms?.[skillKey]?.length) expectedSkills.set(String(skillId), skillKey);
    }
    skillsByOperator.set(name, skillById);
    expectedSkillsByOperator.set(name, expectedSkills);

    const moduleById = new Map();
    for (const module of operator.md || []) {
      if (module.id) moduleById.set(String(module.id), String(module.id));
    }
    modulesByOperator.set(name, moduleById);
    expectedModulesByOperator.set(name, new Set(moduleById.keys()));
  }
  return { operatorById, skillsByOperator, modulesByOperator, expectedSkillsByOperator, expectedModulesByOperator };
}

function assertSnapshot(root) {
  if (!isRecord(root)) throw new Error('这不是森空岛脱敏养成快照。');
  assertNoSecretFields(root);
  assertAllowedKeys(root, ROOT_KEYS, '快照');
  assertAllowedKeys(root.completeness, COMPLETENESS_KEYS, '完整性说明');
  if (root.format !== FORMAT || root.version !== 1 || !Array.isArray(root.characters)) {
    throw new Error('这不是受支持的森空岛脱敏养成快照。');
  }
  if (root.completeness.characters !== 'partial') {
    throw new Error('森空岛快照首版只接受安全合并格式。');
  }
  if (root.completeness.items !== 'unknown' || !Array.isArray(root.items) || root.items.length) {
    throw new Error('森空岛快照首版暂不导入库存。');
  }
  if (root.generatedAt !== undefined && typeof root.generatedAt !== 'string') {
    throw new Error('快照生成时间格式错误。');
  }
  if (root.characters.length > 1_000) throw new Error('森空岛快照中的干员数量异常。');
}

export function parseSklandCultivateSnapshot(input, gameData) {
  const root = parsedJson(input);
  assertSnapshot(root);
  const maps = indexes(gameData);
  const unknown = { operators: [], skills: [], modules: [], items: [] };
  const operators = {};
  const seenOperators = new Map();

  for (const raw of root.characters) {
    assertCharacter(raw);
    const operatorId = raw.id;
    const operatorSignature = JSON.stringify(raw);
    if (seenOperators.has(operatorId)) {
      if (seenOperators.get(operatorId) !== operatorSignature) {
        throw new Error(`森空岛快照中存在冲突的干员记录（${operatorId}）。`);
      }
      continue;
    }
    seenOperators.set(operatorId, operatorSignature);
    const name = maps.operatorById.get(operatorId);
    if (!name) {
      unknown.operators.push({ id: operatorId });
      continue;
    }

    const mastery = {};
    const modules = {};
    const seenSkills = new Map();
    const seenModules = new Map();
    let unknownSkill = false;
    let unknownModule = false;

    for (const skill of raw.skills) {
      if (seenSkills.has(skill.id) && seenSkills.get(skill.id) !== skill.level) {
        throw new Error(`森空岛快照中存在冲突的技能记录（${skill.id}）。`);
      }
      seenSkills.set(skill.id, skill.level);
      const skillKey = maps.skillsByOperator.get(name)?.get(skill.id);
      if (!skillKey) {
        unknownSkill = true;
        unknown.skills.push({ id: skill.id, operatorId });
      } else if (maps.expectedSkillsByOperator.get(name)?.has(skill.id)) {
        mastery[skillKey] = skill.level;
      }
    }

    for (const equip of raw.equips) {
      if (seenModules.has(equip.id) && seenModules.get(equip.id) !== equip.level) {
        throw new Error(`森空岛快照中存在冲突的模组记录（${equip.id}）。`);
      }
      seenModules.set(equip.id, equip.level);
      const moduleKey = maps.modulesByOperator.get(name)?.get(equip.id);
      if (!moduleKey) {
        unknownModule = true;
        unknown.modules.push({ id: equip.id, operatorId });
      } else {
        modules[moduleKey] = equip.level;
      }
    }

    const expectedSkills = maps.expectedSkillsByOperator.get(name) || new Map();
    const expectedModules = maps.expectedModulesByOperator.get(name) || new Set();
    const masteryComplete = !unknownSkill && [...expectedSkills.keys()].every((id) => seenSkills.has(id));
    const modulesComplete = !unknownModule && [...expectedModules].every((id) => seenModules.has(id));
    if (masteryComplete) {
      for (const [id, skillKey] of expectedSkills) mastery[skillKey] = seenSkills.get(id) || 0;
    }
    if (modulesComplete) {
      for (const id of expectedModules) modules[id] = seenModules.get(id) || 0;
    }

    operators[name] = {
      id: operatorId,
      owned: true,
      potential: raw.potentialRank + 1,
      current: {
        elite: raw.evolvePhase,
        level: raw.level,
        skillLevel: raw.mainSkillLevel,
        mastery,
        modules
      },
      detailCoverage: { mastery: masteryComplete, modules: modulesComplete }
    };
  }

  if (!Object.keys(operators).length) {
    throw new Error('森空岛快照中没有匹配到本站干员，未进行导入。');
  }

  return {
    format: FORMAT,
    version: 1,
    completeness: { characters: 'partial', items: 'unknown' },
    operators,
    inventory: {},
    unknown
  };
}

export function applySklandImport(existingState, imported, mode, gameData) {
  if (mode !== 'merge') throw new Error('森空岛快照首版只支持合并。');
  const next = normalizeUserState(existingState, gameData);

  for (const [operatorName, importedProgress] of Object.entries(imported.operators || {})) {
    const operator = gameData?.OPS?.[operatorName];
    if (!operator) continue;
    const existing = normalizeOperatorProgress(next.operators[operatorName] || {}, operator, gameData);
    const current = {
      ...importedProgress.current,
      mastery: importedProgress.detailCoverage?.mastery
        ? importedProgress.current.mastery
        : existing.current.mastery,
      modules: importedProgress.detailCoverage?.modules
        ? importedProgress.current.modules
        : existing.current.modules
    };
    next.operators[operatorName] = normalizeOperatorProgress({
      id: importedProgress.id,
      owned: true,
      potential: importedProgress.potential,
      current,
      target: existing.target
    }, operator, gameData);
  }

  next.migration = {
    ...next.migration,
    lastSklandImportAt: new Date().toISOString(),
    lastSklandImportUnknown: Object.values(imported.unknown || {}).reduce((sum, values) => sum + values.length, 0)
  };
  return normalizeUserState(next, gameData);
}
