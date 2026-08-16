export const USER_DATA_SCHEMA_VERSION = 2;
export const USER_DATA_STORAGE_KEY = 'arknights-material-planner:user-data:v2';
export const USER_DATA_BACKUP_KEY = 'arknights-material-planner:backup';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.max(0, Math.floor(number(value, fallback)));
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeParse(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createCultivationState(overrides = {}) {
  return {
    elite: integer(overrides.elite),
    level: Math.max(1, integer(overrides.level, 1)),
    skillLevel: Math.max(1, integer(overrides.skillLevel, 1)),
    mastery: {
      s1: integer(overrides.mastery?.s1),
      s2: integer(overrides.mastery?.s2),
      s3: integer(overrides.mastery?.s3)
    },
    modules: Object.fromEntries(
      Object.entries(overrides.modules || {}).map(([name, stage]) => [name, integer(stage)])
    )
  };
}

function maxEliteFor(operator, gameData) {
  const levels = gameData?.MAX_LV?.[operator?.r] || {};
  if (levels.e2) return 2;
  if (levels.e1) return 1;
  return 0;
}

function clampCultivationState(rawState, operator, gameData) {
  const state = createCultivationState(rawState);
  const maxElite = maxEliteFor(operator, gameData);
  state.elite = Math.min(state.elite, maxElite);
  const maxLevel = gameData?.MAX_LV?.[operator?.r]?.[`e${state.elite}`];
  if (maxLevel) state.level = Math.min(state.level, maxLevel);
  state.skillLevel = Math.min(7, state.skillLevel);
  for (const skill of ['s1', 's2', 's3']) state.mastery[skill] = Math.min(3, state.mastery[skill]);
  for (const moduleName of Object.keys(state.modules)) {
    state.modules[moduleName] = Math.min(3, state.modules[moduleName]);
  }
  return state;
}

function targetAtLeastCurrent(current, target) {
  const next = createCultivationState(target);
  if (next.elite < current.elite) {
    next.elite = current.elite;
    next.level = current.level;
  } else if (next.elite === current.elite) {
    next.level = Math.max(next.level, current.level);
  }
  next.skillLevel = Math.max(next.skillLevel, current.skillLevel);
  for (const skill of ['s1', 's2', 's3']) {
    next.mastery[skill] = Math.max(next.mastery[skill], current.mastery[skill]);
  }
  for (const [moduleName, currentStage] of Object.entries(current.modules)) {
    next.modules[moduleName] = Math.max(next.modules[moduleName] || 0, currentStage);
  }
  return next;
}

export function normalizeOperatorProgress(rawProgress = {}, operator, gameData) {
  const current = clampCultivationState(rawProgress.current, operator, gameData);
  const rawTarget = rawProgress.target || current;
  const target = clampCultivationState(rawTarget, operator, gameData);
  return {
    owned: Boolean(rawProgress.owned),
    current,
    target: targetAtLeastCurrent(current, target)
  };
}

export function createEmptyUserState() {
  return {
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    operators: {},
    inventory: {},
    settings: {
      activeView: 'operators',
      operatorScope: 'all',
      materialDisplay: 'shortage',
      materialGrouping: 'purpose'
    },
    migration: {}
  };
}

export function normalizeUserState(rawState = {}, gameData) {
  const state = createEmptyUserState();
  state.updatedAt = typeof rawState.updatedAt === 'string' ? rawState.updatedAt : state.updatedAt;
  state.settings = { ...state.settings, ...(rawState.settings || {}) };
  state.migration = { ...(rawState.migration || {}) };
  state.inventory = Object.fromEntries(
    Object.entries(rawState.inventory || {}).map(([name, qty]) => [name, integer(qty)])
  );

  for (const [operatorName, rawProgress] of Object.entries(rawState.operators || {})) {
    state.operators[operatorName] = normalizeOperatorProgress(
      rawProgress,
      gameData?.OPS?.[operatorName],
      gameData
    );
  }
  return state;
}

function ensureOperator(state, operatorName, gameData) {
  if (!state.operators[operatorName]) {
    state.operators[operatorName] = normalizeOperatorProgress(
      { owned: true },
      gameData?.OPS?.[operatorName],
      gameData
    );
  }
  state.operators[operatorName].owned = true;
  return state.operators[operatorName];
}

export function migrateLegacySnapshot(snapshot = {}, gameData) {
  const state = createEmptyUserState();
  state.inventory = Object.fromEntries(
    Object.entries(snapshot.inventory || {}).map(([name, qty]) => [name, integer(qty)])
  );

  for (const [operatorName, levels] of Object.entries(snapshot.levels || {})) {
    const progress = ensureOperator(state, operatorName, gameData);
    progress.current = clampCultivationState({
      elite: levels.fe,
      level: levels.fl,
      skillLevel: progress.current.skillLevel,
      mastery: progress.current.mastery,
      modules: progress.current.modules
    }, gameData?.OPS?.[operatorName], gameData);
    progress.target = clampCultivationState({
      elite: levels.te,
      level: levels.tl,
      skillLevel: progress.target.skillLevel,
      mastery: progress.target.mastery,
      modules: progress.target.modules
    }, gameData?.OPS?.[operatorName], gameData);
  }

  for (const value of snapshot.plan || []) {
    if (typeof value !== 'string' || !value.includes('|')) continue;
    const separator = value.indexOf('|');
    const operatorName = value.slice(0, separator);
    const type = value.slice(separator + 1);
    const operator = gameData?.OPS?.[operatorName];
    const progress = ensureOperator(state, operatorName, gameData);

    if (type === 'slv') {
      progress.target.skillLevel = 7;
      continue;
    }
    if (type.startsWith('ms-')) {
      const [, skill, stage] = type.split('-');
      if (['s1', 's2', 's3'].includes(skill)) {
        progress.target.mastery[skill] = Math.max(progress.target.mastery[skill], integer(stage));
      }
      continue;
    }
    if (type.startsWith('md-')) {
      const [, moduleIndex, stage] = type.split('-');
      const module = operator?.md?.[integer(moduleIndex)];
      const moduleKey = String(module?.id || module?.name || moduleIndex);
      progress.target.modules[moduleKey] = Math.max(progress.target.modules[moduleKey] || 0, integer(stage));
    }
  }

  for (const [operatorName, progress] of Object.entries(state.operators)) {
    state.operators[operatorName] = normalizeOperatorProgress(
      progress,
      gameData?.OPS?.[operatorName],
      gameData
    );
  }
  state.migration = {
    legacyImportedAt: new Date().toISOString(),
    legacyKeysPreserved: true
  };
  return state;
}

export function saveUserState(storage, state) {
  const value = {
    ...state,
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    updatedAt: new Date().toISOString()
  };
  storage.setItem(USER_DATA_STORAGE_KEY, JSON.stringify(value));
  return value;
}

export function loadUserState(storage, gameData) {
  const stored = safeParse(storage.getItem(USER_DATA_STORAGE_KEY), null);
  if (stored) {
    return { state: normalizeUserState(stored, gameData), migrated: false };
  }

  const legacy = {
    plan: safeParse(storage.getItem('ak_plan'), []),
    levels: safeParse(storage.getItem('ak_levels'), {}),
    inventory: safeParse(storage.getItem('ak_inv'), {})
  };
  const hasLegacy = legacy.plan.length
    || Object.keys(legacy.levels).length
    || Object.keys(legacy.inventory).length;

  if (!hasLegacy) return { state: createEmptyUserState(), migrated: false };

  const state = migrateLegacySnapshot(legacy, gameData);
  saveUserState(storage, state);
  return { state, migrated: true };
}

export function createBackup(storage, state) {
  const backup = {
    createdAt: new Date().toISOString(),
    state: jsonClone(state)
  };
  storage.setItem(USER_DATA_BACKUP_KEY, JSON.stringify(backup));
  return backup;
}

export function mergeImportedCurrentState(existingState, importedState, mode, gameData) {
  const next = normalizeUserState(existingState, gameData);
  const incoming = normalizeUserState(importedState, gameData);

  if (mode === 'replace') {
    for (const [operatorName, progress] of Object.entries(next.operators)) {
      progress.owned = false;
      progress.current = createCultivationState();
      next.operators[operatorName] = normalizeOperatorProgress(
        progress,
        gameData?.OPS?.[operatorName],
        gameData
      );
    }
  }

  for (const [operatorName, importedProgress] of Object.entries(incoming.operators)) {
    const existing = next.operators[operatorName] || normalizeOperatorProgress(
      {},
      gameData?.OPS?.[operatorName],
      gameData
    );
    next.operators[operatorName] = normalizeOperatorProgress({
      owned: importedProgress.owned,
      current: importedProgress.current,
      target: existing.target
    }, gameData?.OPS?.[operatorName], gameData);
  }

  return next;
}

export function createProjectExport(state, options = {}) {
  return {
    format: 'arknights-material-planner',
    version: 1,
    exportedAt: options.now || new Date().toISOString(),
    userData: jsonClone(state)
  };
}

export function parseProjectImport(input, gameData) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  if (!parsed || parsed.format !== 'arknights-material-planner') {
    throw new Error('这不是明日方舟养成材料统计的项目备份文件。');
  }
  if (parsed.version !== 1 || !parsed.userData) {
    throw new Error('暂不支持这个备份文件版本。');
  }
  return normalizeUserState(parsed.userData, gameData);
}
