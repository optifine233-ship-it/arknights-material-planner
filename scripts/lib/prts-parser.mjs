function splitTopLevel(value) {
  const parts = [];
  let current = '';
  let templateDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const pair = value.slice(index, index + 2);
    if (pair === '{{') {
      templateDepth += 1;
      current += pair;
      index += 1;
      continue;
    }
    if (pair === '}}' && templateDepth > 0) {
      templateDepth -= 1;
      current += pair;
      index += 1;
      continue;
    }
    if (pair === '[[') {
      linkDepth += 1;
      current += pair;
      index += 1;
      continue;
    }
    if (pair === ']]' && linkDepth > 0) {
      linkDepth -= 1;
      current += pair;
      index += 1;
      continue;
    }
    if (value[index] === '|' && templateDepth === 0 && linkDepth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += value[index];
  }
  parts.push(current);
  return parts;
}

export function parseTemplate(template) {
  const rawBody = template.startsWith('{{') && template.endsWith('}}')
    ? template.slice(2, -2)
    : template;
  const body = rawBody.replace(/<!--[\s\S]*?-->/g, '');
  const parts = splitTopLevel(body);
  const name = (parts.shift() || '').trim();
  const params = {};
  let positional = 1;

  for (const rawPart of parts) {
    const separator = rawPart.indexOf('=');
    if (separator >= 0) {
      const key = rawPart.slice(0, separator).trim();
      params[key] = rawPart.slice(separator + 1).trim();
    } else {
      params[positional] = rawPart.trim();
      positional += 1;
    }
  }
  return { name, params };
}

export function extractTemplates(source, requestedName) {
  const stack = [];
  const matches = [];
  for (let index = 0; index < source.length - 1; index += 1) {
    const pair = source.slice(index, index + 2);
    if (pair === '{{') {
      stack.push(index);
      index += 1;
      continue;
    }
    if (pair === '}}' && stack.length) {
      const start = stack.pop();
      const template = source.slice(start, index + 2);
      const parsed = parseTemplate(template);
      if (!requestedName || parsed.name === requestedName) matches.push(parsed);
      index += 1;
    }
  }
  return matches;
}

export function parseQuantity(rawValue) {
  const value = String(rawValue ?? '').trim().replaceAll(',', '').toLowerCase();
  if (!value) return 0;
  const multiplier = value.endsWith('w') || value.endsWith('万') ? 10000 : 1;
  const numeric = Number.parseFloat(multiplier === 1 ? value : value.slice(0, -1));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : 0;
}

export function extractMaterialCosts(value) {
  const result = [];
  for (const template of extractTemplates(String(value || ''), '材料消耗')) {
    const name = String(template.params[1] || '').trim();
    const qty = parseQuantity(template.params[2]);
    if (name && qty > 0) result.push({ name, qty });
  }
  return result;
}

function withoutLmd(materials) {
  return materials.filter((material) => material.name !== '龙门币');
}

function firstTemplate(source, name) {
  return extractTemplates(source, name)[0] || null;
}

export function parseOperatorWikitext(source, fallbackName = '') {
  const charInfo = firstTemplate(source, 'CharinfoV2');
  if (!charInfo) return null;

  const info = charInfo.params;
  const name = String(info.干员名 || fallbackName).trim();
  if (!name) return null;
  const obtain = firstTemplate(source, '干员获得方式')?.params || {};
  const elite = firstTemplate(source, '精英化材料')?.params || {};
  const skills = firstTemplate(source, '技能升级材料')?.params || {};
  const skillLevels = [];
  for (let level = 2; level <= 7; level += 1) {
    if (skills[level] === undefined) continue;
    skillLevels.push({ level, mats: withoutLmd(extractMaterialCosts(skills[level])) });
  }

  const mastery = { s1: [], s2: [], s3: [] };
  const skillNumerals = [['一', 's1'], ['二', 's2'], ['三', 's3']];
  for (const [numeral, skillKey] of skillNumerals) {
    for (let stage = 1; stage <= 3; stage += 1) {
      const raw = skills[`${numeral}${stage + 7}`];
      if (raw === undefined) continue;
      mastery[skillKey].push({ stage, mats: withoutLmd(extractMaterialCosts(raw)) });
    }
  }

  const modules = [];
  for (const moduleTemplate of extractTemplates(source, '模组')) {
    const params = moduleTemplate.params;
    if (String(params.基础证章 || '').toLowerCase() === 'yes') continue;
    const moduleName = String(params.名称 || '').trim();
    const moduleType = String(params.类型 || '').trim();
    if (!moduleName || params.材料消耗 === undefined) continue;
    const stages = [];
    for (let stage = 1; stage <= 3; stage += 1) {
      const raw = params[stage === 1 ? '材料消耗' : `材料消耗${stage}`];
      if (raw === undefined) continue;
      stages.push({ stage, mats: withoutLmd(extractMaterialCosts(raw)) });
    }
    if (stages.length) modules.push({ name: moduleName, ...(moduleType ? { type: moduleType } : {}), stages });
  }

  return {
    name,
    operator: {
      id: String(info.干员id || '').trim(),
      r: boundedInteger(info.稀有度, 0, 5),
      p: allowedEnum(info.职业, ALLOWED_PROFESSIONS),
      sp: String(info.分支 || '').trim(),
      pos: allowedEnum(info.位置, ALLOWED_POSITIONS),
      obtain: String(obtain.获得方式 || '').trim(),
      e1: withoutLmd(extractMaterialCosts(elite.精1)),
      e2: withoutLmd(extractMaterialCosts(elite.精2)),
      sl: skillLevels,
      ms: mastery,
      md: modules
    }
  };
}

export function parseMaterialWikitext(source, fallbackName = '') {
  const itemInfo = firstTemplate(source, '道具信息');
  if (!itemInfo) return null;
  const info = itemInfo.params;
  const name = String(info.名称 || fallbackName).trim();
  if (!name) return null;
  const stationRecipe = firstTemplate(source, '道具配方/加工站');
  const recipe = [];

  if (stationRecipe) {
    for (let index = 1; index <= 12; index += 1) {
      const ingredientName = String(stationRecipe.params[`原料${index}`] || '').trim();
      const qty = parseQuantity(stationRecipe.params[`原料${index}数量`]);
      if (ingredientName && qty > 0) recipe.push({ name: ingredientName, qty });
    }
  }

  return {
    name,
    id: String(info.itemId || info.id || '').trim(),
    iconId: String(info.iconId || '').trim(),
    tier: boundedInteger(info.稀有度, 0, 5),
    category: String(info.分类 || '').trim(),
    recipe
  };
}

const ALLOWED_PROFESSIONS = new Set(['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种']);
const ALLOWED_POSITIONS = new Set(['近战位', '远程位']);

function boundedInteger(rawValue, minimum, maximum, fallback = -1) {
  const normalized = String(rawValue ?? '').trim();
  if (!normalized) return fallback;
  const value = Number(normalized);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function allowedEnum(rawValue, allowed) {
  const value = String(rawValue || '').trim();
  return allowed.has(value) ? value : '';
}
