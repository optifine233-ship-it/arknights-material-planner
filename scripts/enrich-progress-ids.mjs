import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { enrichOperatorProgressIds } from './lib/progress-id-enricher.mjs';

const [characterPath, patchPath, modulePath, dataPath = 'data/game-data.json'] = process.argv.slice(2);
const progressIdSources = {
  characters: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/character_table.json',
  patches: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/char_patch_table.json',
  modules: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/uniequip_table.json'
};
if (!characterPath || !patchPath || !modulePath) {
  throw new Error('用法：node scripts/enrich-progress-ids.mjs <character_table> <char_patch_table> <uniequip_table> [game-data]');
}

const [characters, patches, modules, gameData] = await Promise.all([
  readFile(resolve(characterPath), 'utf8').then(JSON.parse),
  readFile(resolve(patchPath), 'utf8').then(JSON.parse),
  readFile(resolve(modulePath), 'utf8').then(JSON.parse),
  readFile(resolve(dataPath), 'utf8').then(JSON.parse)
]);
const enriched = enrichOperatorProgressIds(gameData.OPS, {
  characters,
  patchChars: patches.patchChars,
  equipDict: modules.equipDict
});
if (enriched.report.missingSkills.length || enriched.report.ambiguousModules.length || enriched.report.missingModules.length) {
  throw new Error(`养成项目稳定 ID 不完整：${JSON.stringify(enriched.report)}`);
}
gameData.OPS = enriched.operators;
gameData.syncReport = { ...(gameData.syncReport || {}), unresolvedProgressIds: enriched.report };
gameData.source = { ...(gameData.source || {}), progressIdSources };
gameData.dataVersion = `${String(gameData.dataVersion || 'local').replace(/-progress-1$/, '')}-progress-1`;
gameData.generatedAt = new Date().toISOString();
const resolvedDataPath = resolve(dataPath);
await writeFile(resolvedDataPath, `${JSON.stringify(gameData, null, 2)}\n`, 'utf8');
const versionPath = resolve(dirname(resolvedDataPath), 'data-version.json');
const version = JSON.parse(await readFile(versionPath, 'utf8'));
version.dataVersion = gameData.dataVersion;
version.generatedAt = gameData.generatedAt;
version.source = gameData.source;
await writeFile(versionPath, `${JSON.stringify(version, null, 2)}\n`, 'utf8');
console.log(`已扩充 ${Object.keys(gameData.OPS).length} 名干员；缺失技能 ${enriched.report.missingSkills.length}，缺失模组 ${enriched.report.missingModules.length}。`);
