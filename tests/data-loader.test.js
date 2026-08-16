import test from 'node:test';
import assert from 'node:assert/strict';

import { validateGameData } from '../src/data-loader.js';

test('只接受包含完整干员与材料索引的数据快照', () => {
  const data = {
    OPS_ORDER: Array.from({ length: 100 }, (_, index) => `干员${index}`),
    OPS: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`干员${index}`, {}])),
    MAT_RARITY: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`材料${index}`, 2]))
  };

  assert.equal(validateGameData(data), data);
  assert.throws(
    () => validateGameData({ ...data, OPS_ORDER: data.OPS_ORDER.slice(0, 20) }),
    /数量异常/
  );
});
