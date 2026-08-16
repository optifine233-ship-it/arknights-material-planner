import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(resolve(root, 'data', 'game-data.json'), 'utf8'));
const errors = [];
const referencedMaterials = new Set();

function inspectMaterials(materials, context) {
  for (const material of materials || []) {
    if (!material?.name || !Number.isInteger(material.qty) || material.qty <= 0) {
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
  if (!Number.isInteger(operator.r) || !operator.p) errors.push(`干员 ${name} 缺少星级或职业。`);
  inspectMaterials(operator.e1, `${name} E1`);
  inspectMaterials(operator.e2, `${name} E2`);
  for (const stage of operator.sl || []) inspectMaterials(stage.mats, `${name} 技能${stage.level}`);
  for (const [skill, stages] of Object.entries(operator.ms || {})) {
    for (const stage of stages || []) inspectMaterials(stage.mats, `${name} ${skill}专精${stage.stage}`);
  }
  for (const module of operator.md || []) {
    if (!module.name) errors.push(`${name} 存在无名称模组。`);
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
