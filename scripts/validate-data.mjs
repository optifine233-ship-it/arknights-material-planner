import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOWED_POSITIONS, ALLOWED_PROFESSIONS, containsMarkup } from './lib/data-quality.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(resolve(root, 'data', 'game-data.json'), 'utf8'));
const errors = [];
const operatorIds = new Map();
const referencedMaterials = new Set();
const moduleIds = new Map();

function inspectMaterials(materials, context) {
  for (const material of materials || []) {
    if (!material?.name || containsMarkup(material.name) || !Number.isInteger(material.qty) || material.qty <= 0) {
      errors.push(`${context} 存在无效材料记录：${JSON.stringify(material)}`);
      continue;
    }
    referencedMaterials.add(material.name);
  }
}

const orderSet = new Set(data.OPS_ORDER || []);
if (orderSet.size !== (data.OPS_ORDER || []).length) errors.push('OPS_ORDER 中存在重复干员。');
if (orderSet.size !== Object.keys(data.OPS || {}).length) errors.push('OPS_ORDER 与 OPS 数量不一致。');

for (const [name, operator] of Object.entries(data.OPS || {})) {
  if (!orderSet.has(name)) errors.push(`干员 ${name} 未出现在 OPS_ORDER。`);
  if (containsMarkup(name)) errors.push(`干员名称包含非法标记：${name}`);
  if (!operator.id) errors.push(`干员 ${name} 缺少稳定 ID。`);
  else if (operatorIds.has(operator.id)) errors.push(`干员 ID ${operator.id} 同时用于 ${operatorIds.get(operator.id)} 和 ${name}。`);
  else operatorIds.set(operator.id, name);

  if (!Number.isInteger(operator.r) || operator.r < 0 || operator.r > 5) errors.push(`干员 ${name} 使用非法星级。`);
  if (!ALLOWED_PROFESSIONS.has(operator.p)) errors.push(`干员 ${name} 使用非法职业。`);
  if (!ALLOWED_POSITIONS.has(operator.pos)) errors.push(`干员 ${name} 使用非法部署位置。`);
  if ([operator.sp, operator.obtain].some(containsMarkup)) errors.push(`干员 ${name} 包含非法外部文本。`);
  inspectMaterials(operator.e1, `${name} E1`);
  inspectMaterials(operator.e2, `${name} E2`);
  for (const stage of operator.sl || []) inspectMaterials(stage.mats, `${name} 技能${stage.level}`);
  for (const [skill, stages] of Object.entries(operator.ms || {})) {
    if ((stages || []).length && !operator.skillIds?.[skill]) errors.push(`${name} ${skill} 缺少稳定技能 ID。`);
    for (const stage of stages || []) inspectMaterials(stage.mats, `${name} ${skill}专精${stage.stage}`);
  }
  for (const module of operator.md || []) {
    if (!module.name || containsMarkup(module.name)) errors.push(`${name} 存在非法模组名称。`);
    if (!module.id) errors.push(`${name} 的模组 ${module.name} 缺少稳定 ID。`);
    else if (moduleIds.has(module.id)) errors.push(`模组 ID ${module.id} 同时用于 ${moduleIds.get(module.id)} 和 ${name}。`);
    else moduleIds.set(module.id, name);
    for (const stage of module.stages || []) inspectMaterials(stage.mats, `${name} ${module.name} ${stage.stage}级`);
  }
}

for (const [product, ingredients] of Object.entries(data.RECIPES || {})) {
  referencedMaterials.add(product);
  inspectMaterials(ingredients, `${product} 配方`);
}

for (const material of referencedMaterials) {
  if (!Object.hasOwn(data.MAT_RARITY || {}, material)) {
    errors.push(`材料 ${material} 缺少层级定义。`);
  }
  if (!data.MATERIAL_META?.[material]?.iconId) {
    errors.push(`材料 ${material} 缺少可生成稳定图标地址的 iconId。`);
  }
}

function detectCycle(material, trail = []) {
  if (trail.includes(material)) {
    errors.push(`配方循环：${[...trail, material].join(' → ')}`);
    return;
  }
  for (const ingredient of data.RECIPES?.[material] || []) {
    detectCycle(ingredient.name, [...trail, material]);
  }
}

for (const material of Object.keys(data.RECIPES || {})) detectCycle(material);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`数据校验通过：${Object.keys(data.OPS).length} 名干员，${referencedMaterials.size} 种已引用资源。`);
}
