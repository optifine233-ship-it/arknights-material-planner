import test from 'node:test';
import assert from 'node:assert/strict';

import { compareMaterials } from '../src/materials.js';
import { materialIcon } from '../src/ui.js';

test('芯片助剂在芯片分类中固定排在最前', () => {
  const gameData = {
    MAT_RARITY: { 芯片助剂: 3, 先锋双芯片: 4, 近卫芯片: 2 }
  };
  const sorted = ['先锋双芯片', '近卫芯片', '芯片助剂']
    .sort((a, b) => compareMaterials(a, b, gameData));

  assert.equal(sorted[0], '芯片助剂');
});

test('材料图标优先使用 iconId 对应的稳定资源地址并保留回退', () => {
  const html = materialIcon('凝胶', {
    MAT_RARITY: { 凝胶: 2 },
    MATERIAL_META: {
      凝胶: {
        iconId: 'MTL_SL_PGEL3',
        icon: 'https://media.prts.wiki/legacy-gel.png'
      }
    }
  });

  assert.match(html, /torappu\.prts\.wiki\/assets\/item_icon\/MTL_SL_PGEL3\.png/);
  assert.match(html, /data-fallback="https:\/\/media\.prts\.wiki\/legacy-gel\.png"/);
  assert.match(html, /material-icon--tier-2/);
});
