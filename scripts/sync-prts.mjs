import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMaterialWikitext, parseOperatorWikitext } from './lib/prts-parser.mjs';
import { enrichOperatorProgressIds } from './lib/progress-id-enricher.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = resolve(root, 'data', 'game-data.json');
const versionPath = resolve(root, 'data', 'data-version.json');
const apiEndpoint = 'https://prts.wiki/api.php';
const userAgent = 'ArknightsMaterialPlanner/0.1 (data sync; https://github.com/)';
const professionOrder = ['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'];
const progressDataUrls = {
  characters: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/character_table.json',
  patches: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/char_patch_table.json',
  modules: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/uniequip_table.json'
};

const baseData = JSON.parse(await readFile(dataPath, 'utf8'));

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function api(parameters, attempt = 1) {
  const url = new URL(apiEndpoint);
  const merged = { action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...parameters };
  for (const [key, value] of Object.entries(merged)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'application/json' } });
  if (!response.ok) throw new Error(`PRTS API ${response.status}: ${response.statusText}`);
  const body = await response.json();
  if (body.error) {
    if (attempt < 4 && ['maxlag', 'ratelimited'].includes(body.error.code)) {
      await wait(800 * attempt);
      return api(parameters, attempt + 1);
    }
    throw new Error(`PRTS API ${body.error.code}: ${body.error.info}`);
  }
  return body;
}

async function publicJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'application/json' } });
  if (!response.ok) throw new Error(`公开游戏数据 ${response.status}: ${response.statusText}`);
  return response.json();
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function categoryMembers(category) {
  const result = [];
  let continuation = '';
  do {
    const body = await api({
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmnamespace: '0',
      cmlimit: '500',
      ...(continuation ? { cmcontinue: continuation } : {})
    });
    result.push(...(body.query?.categorymembers || []).map((page) => page.title));
    continuation = body.continue?.cmcontinue || '';
    if (continuation) await wait(150);
  } while (continuation);
  return result;
}

async function pageContents(titles, batchSize = 12) {
  const pages = new Map();
  let completed = 0;
  for (const batch of chunks(titles, batchSize)) {
    const body = await api({
      prop: 'revisions',
      rvprop: 'ids|timestamp|content',
      rvslots: 'main',
      titles: batch.join('|')
    });
    for (const page of body.query?.pages || []) {
      const revision = page.revisions?.[0];
      const content = revision?.slots?.main?.content;
      if (typeof content !== 'string') continue;
      pages.set(page.title, {
        content,
        revisionId: revision.revid || 0,
        timestamp: revision.timestamp || ''
      });
    }
    completed += batch.length;
    console.log(`页面数据 ${completed}/${titles.length}`);
    await wait(160);
  }
  return pages;
}

async function imageUrls(names, prefix, width) {
  const result = new Map();
  let completed = 0;
  const titles = names.map((name) => `File:${prefix} ${name}.png`);
  for (const batch of chunks(titles, 45)) {
    const body = await api({
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: String(width),
      titles: batch.join('|')
    });
    for (const page of body.query?.pages || []) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const normalizedTitle = page.title.replace(/^文件:/, '').replace(/^File:/, '');
      const expectedPrefix = `${prefix} `;
      const name = normalizedTitle.startsWith(expectedPrefix)
        ? normalizedTitle.slice(expectedPrefix.length).replace(/\.png$/i, '')
        : '';
      if (name) result.set(name, info.thumburl || info.url);
    }
    completed += batch.length;
    console.log(`图片地址 ${completed}/${titles.length}`);
    await wait(120);
  }
  return result;
}

function collectReferencedMaterials(operators) {
  const names = new Set();
  const collect = (materials) => (materials || []).forEach((material) => names.add(material.name));
  for (const operator of Object.values(operators)) {
    collect(operator.e1);
    collect(operator.e2);
    for (const stage of operator.sl || []) collect(stage.mats);
    for (const stages of Object.values(operator.ms || {})) for (const stage of stages) collect(stage.mats);
    for (const module of operator.md || []) for (const stage of module.stages || []) collect(stage.mats);
  }
  return names;
}

function compareOperators([nameA, operatorA], [nameB, operatorB]) {
  return operatorB.r - operatorA.r
    || professionOrder.indexOf(operatorA.p) - professionOrder.indexOf(operatorB.p)
    || nameA.localeCompare(nameB, 'zh-CN');
}

console.log('读取 PRTS 干员分类…');
const operatorPageTitles = await categoryMembers('干员');
console.log(`发现 ${operatorPageTitles.length} 个候选页面。`);
const operatorPages = await pageContents(operatorPageTitles);
const parsedOperators = {};
const operatorRevisions = {};
const skippedOperators = [];
const duplicateOperatorNames = [];

for (const [pageTitle, page] of operatorPages) {
  const parsed = parseOperatorWikitext(page.content, pageTitle);
  if (!parsed?.operator?.id || !parsed.operator.p || parsed.operator.r < 0) {
    skippedOperators.push(pageTitle);
    continue;
  }
  if (parsed.operator.obtain === '无') {
    skippedOperators.push(pageTitle);
    continue;
  }
  if (parsedOperators[parsed.name]) duplicateOperatorNames.push({ name: parsed.name, pageTitle });
  parsedOperators[parsed.name] = parsed.operator;
  operatorRevisions[parsed.name] = page.revisionId;
}

if (Object.keys(parsedOperators).length < 200) {
  throw new Error(`解析出的正式干员只有 ${Object.keys(parsedOperators).length} 名，低于安全阈值，拒绝覆盖现有数据。`);
}

console.log(`成功解析 ${Object.keys(parsedOperators).length} 名干员，跳过 ${skippedOperators.length} 个页面。`);
console.log('补充技能与模组稳定 ID…');
const [characterTable, patchTable, uniequipTable] = await Promise.all([
  publicJson(progressDataUrls.characters),
  publicJson(progressDataUrls.patches),
  publicJson(progressDataUrls.modules)
]);
const enriched = enrichOperatorProgressIds(parsedOperators, {
  characters: characterTable,
  patchChars: patchTable.patchChars,
  equipDict: uniequipTable.equipDict
});
if (enriched.report.missingSkills.length || enriched.report.ambiguousModules.length || enriched.report.missingModules.length) {
  throw new Error(`有 ${enriched.report.missingSkills.length} 名干员缺少技能 ID，${enriched.report.ambiguousModules.length + enriched.report.missingModules.length} 个模组缺少唯一稳定 ID，拒绝覆盖现有数据。`);
}
const operatorsWithProgressIds = enriched.operators;
const referencedMaterials = collectReferencedMaterials(operatorsWithProgressIds);
for (const name of Object.keys(baseData.MAT_RARITY || {})) referencedMaterials.add(name);
for (const name of baseData.SPECIAL_RESOURCES || []) referencedMaterials.add(name);

console.log(`读取 ${referencedMaterials.size} 个材料页面…`);
const materialPages = await pageContents([...referencedMaterials], 30);
const materialInfo = {};
const materialRevisions = {};
for (const [pageTitle, page] of materialPages) {
  const parsed = parseMaterialWikitext(page.content, pageTitle);
  if (!parsed) continue;
  materialInfo[parsed.name] = parsed;
  materialRevisions[parsed.name] = page.revisionId;
}

const operatorPortraits = await imageUrls(Object.keys(parsedOperators), '头像', 256);
const materialIcons = await imageUrls([...referencedMaterials], '道具', 96);

const rarity = { ...(baseData.MAT_RARITY || {}) };
const recipes = { ...(baseData.RECIPES || {}) };
const materialMeta = { ...(baseData.MATERIAL_META || {}) };
const unresolvedMaterials = [];

for (const name of referencedMaterials) {
  const info = materialInfo[name];
  const iconId = info?.iconId || materialMeta[name]?.iconId || '';
  const wikiIcon = materialIcons.get(name) || materialMeta[name]?.iconFallback || materialMeta[name]?.icon || '';
  const stableIcon = iconId ? `https://torappu.prts.wiki/assets/item_icon/${encodeURIComponent(iconId)}.png` : '';
  if (info && Number.isInteger(info.tier)) rarity[name] = info.tier;
  if (name.includes('芯片') && !name.includes('双芯片')) {
    // PRTS also describes profession-to-profession chip conversion as a recipe.
    // It is probabilistic exchange, not a downward crafting path, and would
    // introduce cycles into the material decomposition graph.
    delete recipes[name];
  } else if (info?.recipe?.length) {
    recipes[name] = info.recipe;
  }
  if (rarity[name] === undefined) {
    rarity[name] = 2;
    unresolvedMaterials.push(name);
  }
  materialMeta[name] = {
    ...(materialMeta[name] || {}),
    id: info?.id || materialMeta[name]?.id || '',
    iconId,
    category: info?.category || materialMeta[name]?.category || '',
    icon: stableIcon || wikiIcon,
    iconFallback: stableIcon && wikiIcon && wikiIcon !== stableIcon ? wikiIcon : '',
    source: `https://prts.wiki/w/${encodeURIComponent(name)}`
  };
}

for (const [name, operator] of Object.entries(operatorsWithProgressIds)) {
  operator.portrait = operatorPortraits.get(name) || '';
  operator.source = `https://prts.wiki/w/${encodeURIComponent(name)}`;
}

const sortedOperators = Object.entries(operatorsWithProgressIds).sort(compareOperators);
const latestRevision = Math.max(
  0,
  ...Object.values(operatorRevisions),
  ...Object.values(materialRevisions)
);
const dataVersion = `prts-${latestRevision}-progress-1`;
const generatedAt = baseData.dataVersion === dataVersion && baseData.generatedAt
  ? baseData.generatedAt
  : new Date().toISOString();
const ordinaryMaterials = Object.keys(rarity).filter((name) => (materialInfo[name]?.category || materialMeta[name]?.category) === '材料');

const output = {
  ...baseData,
  schemaVersion: 2,
  dataVersion,
  generatedAt,
  source: {
    kind: 'prts-mediawiki-api',
    url: apiEndpoint,
    operatorCategory: 'Category:干员',
    latestRevision,
    progressIdSources: progressDataUrls
  },
  OPS: Object.fromEntries(sortedOperators),
  OPS_ORDER: sortedOperators.map(([name]) => name),
  MAT_RARITY: rarity,
  RECIPES: recipes,
  MATERIAL_META: materialMeta,
  MATS_T2: ordinaryMaterials.filter((name) => rarity[name] === 1),
  MATS_BLUE: Object.keys(rarity).filter((name) => rarity[name] === 2),
  MATS_PURPLE: Object.keys(rarity).filter((name) => rarity[name] === 3),
  MATS_GOLD: Object.keys(rarity).filter((name) => rarity[name] === 4),
  MAX_LV: {
    0: { e0: 30 },
    1: { e0: 30 },
    ...baseData.MAX_LV
  },
  syncReport: {
    operatorCandidates: operatorPageTitles.length,
    operators: sortedOperators.length,
    materials: referencedMaterials.size,
    skippedOperators,
    duplicateOperatorNames,
    unresolvedMaterials,
    unresolvedProgressIds: enriched.report
  }
};

const version = {
  schemaVersion: 1,
  dataVersion,
  generatedAt,
  operatorCount: output.OPS_ORDER.length,
  materialCount: Object.keys(output.MAT_RARITY).length,
  source: output.source
};

await writeFile(dataPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await writeFile(versionPath, `${JSON.stringify(version, null, 2)}\n`, 'utf8');
console.log(`同步完成：${version.operatorCount} 名干员，${version.materialCount} 种资源，版本 ${dataVersion}。`);
if (unresolvedMaterials.length) console.warn(`未能从材料页确认层级：${unresolvedMaterials.join('、')}`);
