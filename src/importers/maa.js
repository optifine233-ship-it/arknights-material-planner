import { normalizeOperatorProgress, normalizeUserState } from '../storage.js';

function parsedJson(input) {
  return typeof input === 'string' ? JSON.parse(input) : input;
}

function findOperBoxPayload(root) {
  const queue = [{ value: root, depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value.own_opers) || Array.isArray(value.all_opers)) return value;
    if (depth >= 5) continue;
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function directOperatorListPayload(root) {
  if (!Array.isArray(root) || !root.length) return null;
  const looksLikeOperators = root.every((entry) => (
    entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && (typeof entry.id === 'string' || typeof entry.name === 'string')
    && ['own', 'elite', 'level', 'potential', 'rarity'].some((field) => field in entry)
  ));
  if (!looksLikeOperators) return null;
  return root.some((entry) => entry.own === false)
    ? { all_opers: root }
    : { own_opers: root };
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function gameDataIndexes(gameData) {
  const byId = new Map();
  const byName = new Map();
  for (const [name, operator] of Object.entries(gameData.OPS || {})) {
    if (operator.id) byId.set(operator.id, name);
    byName.set(name, name);
  }
  return { byId, byName };
}

function resolveName(raw, indexes) {
  return indexes.byId.get(String(raw.id || '')) || indexes.byName.get(String(raw.name || '')) || '';
}

export function parseMaaOperatorExport(input, gameData) {
  const root = parsedJson(input);
  const payload = findOperBoxPayload(root) || directOperatorListPayload(root);
  if (!payload || (!Array.isArray(payload.all_opers) && !Array.isArray(payload.own_opers))) {
    throw new Error('未找到 MAA 干员识别数组，也未找到 all_opers 或 own_opers。');
  }

  const indexes = gameDataIndexes(gameData);
  const operators = {};
  const unknown = [];
  const allOperators = Array.isArray(payload.all_opers) ? payload.all_opers : [];
  const ownedOperators = Array.isArray(payload.own_opers) ? payload.own_opers : [];

  for (const raw of allOperators) {
    const name = resolveName(raw, indexes);
    if (!name) {
      if (raw.own) unknown.push({ id: String(raw.id || ''), name: String(raw.name || '') });
      continue;
    }
    operators[name] = {
      id: String(raw.id || gameData.OPS[name].id || ''),
      owned: Boolean(raw.own),
      potential: integer(raw.potential),
      current: raw.own ? { elite: integer(raw.elite), level: Math.max(1, integer(raw.level, 1)) } : null
    };
  }

  for (const raw of ownedOperators) {
    const name = resolveName(raw, indexes);
    if (!name) {
      unknown.push({ id: String(raw.id || ''), name: String(raw.name || '') });
      continue;
    }
    operators[name] = {
      id: String(raw.id || gameData.OPS[name].id || ''),
      owned: raw.own !== false,
      potential: integer(raw.potential),
      current: {
        elite: integer(raw.elite),
        level: Math.max(1, integer(raw.level, 1))
      }
    };
  }

  return {
    format: 'maa-oper-box',
    supportedFields: ['id', 'owned', 'elite', 'level', 'potential', 'rarity'],
    unsupportedFields: ['skillLevel', 'mastery', 'modules'],
    operators,
    unknown,
    sourceCounts: {
      all: allOperators.length,
      owned: ownedOperators.length
    }
  };
}

export function applyMaaOperatorImport(existingState, imported, mode, gameData) {
  const next = normalizeUserState(existingState, gameData);

  if (mode === 'replace') {
    for (const progress of Object.values(next.operators)) progress.owned = false;
  }

  for (const [operatorName, importedProgress] of Object.entries(imported.operators || {})) {
    const operator = gameData.OPS?.[operatorName];
    if (!operator) continue;
    const existing = normalizeOperatorProgress(next.operators[operatorName] || {}, operator, gameData);
    const current = {
      ...existing.current,
      ...(importedProgress.current || {}),
      mastery: existing.current.mastery,
      modules: existing.current.modules,
      skillLevel: existing.current.skillLevel
    };
    next.operators[operatorName] = normalizeOperatorProgress({
      owned: importedProgress.owned,
      potential: importedProgress.potential || existing.potential,
      current,
      target: existing.target
    }, operator, gameData);
  }

  next.migration = {
    ...next.migration,
    lastMaaImportAt: new Date().toISOString(),
    lastMaaImportUnknown: imported.unknown?.length || 0
  };
  return next;
}
