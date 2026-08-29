import { createHash } from 'node:crypto';

export const ALLOWED_PROFESSIONS = new Set(['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种']);
export const ALLOWED_POSITIONS = new Set(['近战位', '远程位']);

export function containsMarkup(value) {
  return /[<>]/.test(String(value || ''));
}

function structureCounts(operator) {
  return {
    elite1: (operator.e1 || []).length,
    elite2: (operator.e2 || []).length,
    skillLevels: (operator.sl || []).length,
    masteryS1: (operator.ms?.s1 || []).length,
    masteryS2: (operator.ms?.s2 || []).length,
    masteryS3: (operator.ms?.s3 || []).length,
    ...Object.fromEntries((operator.md || []).map((module) => [
      `module:${String(module.name || '')}`, (module.stages || []).length
    ]))
  };
}

function assertMaterialRecords(operatorName, operator) {
  const groups = [
    operator.e1,
    operator.e2,
    ...(operator.sl || []).map((stage) => stage.mats),
    ...Object.values(operator.ms || {}).flatMap((stages) => (stages || []).map((stage) => stage.mats)),
    ...(operator.md || []).flatMap((module) => (module.stages || []).map((stage) => stage.mats))
  ];
  for (const material of groups.flat()) {
    if (!material?.name || containsMarkup(material.name) || !Number.isInteger(material.qty) || material.qty <= 0) {
      throw new Error(`干员 ${operatorName} 包含非法材料记录。`);
    }
  }
}

export function validateSynchronizedOperators(baseOperators = {}, candidateOperators = {}, options = {}) {
  const baseCount = Object.keys(baseOperators).length;
  const candidateEntries = Object.entries(candidateOperators);
  const candidateCount = candidateEntries.length;
  if (baseCount && candidateCount < Math.ceil(baseCount * 0.95)) {
    throw new Error(`干员数量下降过多：${baseCount} → ${candidateCount}，拒绝覆盖。`);
  }
  if (options.duplicateOperatorNames?.length) {
    throw new Error(`发现 ${options.duplicateOperatorNames.length} 个重复干员名称，拒绝覆盖。`);
  }

  const candidateById = new Map();
  for (const [name, operator] of candidateEntries) {
    if (containsMarkup(name)) throw new Error(`干员名称包含非法标记：${name}`);
    const operatorId = String(operator?.id || '');
    if (!operatorId) throw new Error(`干员 ${name} 缺少稳定 ID。`);
    if (candidateById.has(operatorId)) {
      throw new Error(`稳定 ID ${operatorId} 同时用于 ${candidateById.get(operatorId)[0]} 和 ${name}。`);
    }
    candidateById.set(operatorId, [name, operator]);

    if (!Number.isInteger(operator?.r) || operator.r < 0 || operator.r > 5) {
      throw new Error(`干员 ${name} 使用非法星级。`);
    }
    if (!ALLOWED_PROFESSIONS.has(operator.p)) throw new Error(`干员 ${name} 使用非法职业。`);
    if (!ALLOWED_POSITIONS.has(operator.pos)) throw new Error(`干员 ${name} 使用非法部署位置。`);
    for (const value of [operator.sp, operator.obtain, ...(operator.md || []).flatMap((module) => [module.name, module.type])]) {
      if (containsMarkup(value)) throw new Error(`干员 ${name} 包含非法外部文本。`);
    }
    assertMaterialRecords(name, operator);
  }

  const allowedRemovedOperatorIds = new Set(options.allowedRemovedOperatorIds || []);
  for (const [baseName, baseOperator] of Object.entries(baseOperators)) {
    const baseId = String(baseOperator.id || '');
    const match = (baseId ? candidateById.get(baseId) : null) || (
      candidateOperators[baseName] ? [baseName, candidateOperators[baseName]] : null
    );
    if (!match) {
      if (baseId && allowedRemovedOperatorIds.has(baseId)) continue;
      throw new Error(`已有干员 ${baseName}（${baseId || '无稳定 ID'}）从同步结果中消失，拒绝覆盖。`);
    }
    const [, candidate] = match;
    const previous = structureCounts(baseOperator);
    const next = structureCounts(candidate);
    for (const key of Object.keys(previous)) {
      const nextCount = next[key] || 0;
      if (nextCount < previous[key]) {
        throw new Error(`干员 ${baseName} 的培养结构退化（${key}: ${previous[key]} → ${nextCount}），拒绝覆盖。`);
      }
    }
  }

  return { baseCount, candidateCount };
}

export function createSnapshotVersion(snapshot, latestRevision = 0) {
  const { dataVersion: _dataVersion, generatedAt: _generatedAt, source: _source, syncReport: _syncReport, ...payload } = snapshot;

  const digest = createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 12);
  return `prts-${Number(latestRevision) || 0}-${digest}`;
}

function stableStringify(value) {
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    return Object.fromEntries(
      Object.keys(current).sort().map((key) => [key, current[key]])
    );
  });
}
