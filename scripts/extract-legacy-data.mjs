import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'arknights_tool.html');
const outputPath = resolve(root, 'data', 'game-data.json');
const source = await readFile(sourcePath, 'utf8');

const startMarker = 'const DATA = ';
const start = source.indexOf(startMarker);
const nextDeclaration = source.indexOf('const {OPS', start);
const end = source.lastIndexOf(';', nextDeclaration);

if (start < 0 || nextDeclaration < 0 || end < 0) {
  throw new Error('无法在旧页面中定位 DATA 数据块。');
}

const legacyData = JSON.parse(source.slice(start + startMarker.length, end));

// The legacy UI stopped at its blue baseline. These lower-tier materials and
// recipes make stored T2 resources available to the new shared allocator.
const t2Materials = ['固源岩', '装置', '聚酸酯', '糖', '异铁', '酮凝集'];
const t3Recipes = {
  固源岩组: [{ name: '固源岩', qty: 5 }],
  全新装置: [{ name: '装置', qty: 4 }],
  聚酸酯组: [{ name: '聚酸酯', qty: 4 }],
  糖组: [{ name: '糖', qty: 4 }],
  异铁组: [{ name: '异铁', qty: 4 }],
  酮凝集组: [{ name: '酮凝集', qty: 4 }]
};

for (const name of t2Materials) {
  legacyData.MAT_RARITY[name] = 1;
}
legacyData.MAT_RARITY.芯片助剂 = 3;
legacyData.MAT_RARITY.液化高能气体 = 2;
legacyData.MATS_T2 = t2Materials;
if (!legacyData.MATS_BLUE.includes('液化高能气体')) {
  legacyData.MATS_BLUE.push('液化高能气体');
}
Object.assign(legacyData.RECIPES, t3Recipes);

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    kind: 'legacy-extraction',
    file: 'arknights_tool.html'
  },
  ...legacyData
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`已迁移 ${Object.keys(output.OPS).length} 名干员和 ${Object.keys(output.MAT_RARITY).length} 种资源。`);
