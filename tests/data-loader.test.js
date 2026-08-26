import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheVersionsToPrune, sortCachedSnapshots } from '../src/data-cache-policy.js';
import { loadGameDataWith, validateGameData } from '../src/data-loader.js';

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

function makeValidData(label = '干员', dataVersion = '') {
  return {
    dataVersion,
    generatedAt: '2026-01-01T00:00:00.000Z',
    OPS_ORDER: Array.from({ length: 100 }, (_, index) => `${label}${index}`),
    OPS: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`${label}${index}`, {}])),
    MAT_RARITY: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`材料${index}`, 2]))
  };
}

test('当前版本缓存损坏时继续请求网络数据并覆盖缓存', async () => {
  const networkData = makeValidData('联网干员', 'v2');
  const writes = [];
  const result = await loadGameDataWith({
    fetchJsonImpl: async (url) => url.includes('data-version') ? { dataVersion: 'v2' } : networkData,
    readCachedSnapshotImpl: async () => ({ OPS_ORDER: [] }),
    readCachedSnapshotsImpl: async () => [],
    writeCachedSnapshotImpl: async (...args) => writes.push(args)
  });

  assert.equal(result.source, 'network');
  assert.equal(result.data, networkData);
  assert.deepEqual(writes, [['v2', networkData]]);
});

test('离线时跳过损坏的新快照并使用上一份可用缓存', async () => {
  const olderData = makeValidData('旧缓存干员', 'v2');
  const result = await loadGameDataWith({
    fetchJsonImpl: async () => { throw new Error('offline'); },
    readCachedSnapshotImpl: async () => null,
    readCachedSnapshotsImpl: async () => [
      { version: 'v3', cachedAt: '2026-03-01T00:00:00.000Z', data: {} },
      { version: 'v2', cachedAt: '2026-02-01T00:00:00.000Z', data: olderData }
    ]
  });

  assert.equal(result.source, 'cache-offline');
  assert.equal(result.manifest.dataVersion, 'v2');
  assert.equal(result.data, olderData);
});

test('联网失败且所有缓存损坏时回退到随站点发布的数据', async () => {
  const bundledData = makeValidData('内置干员');
  const result = await loadGameDataWith({
    fetchJsonImpl: async (url) => {
      if (url.includes('data-version')) throw new Error('offline');
      return bundledData;
    },
    readCachedSnapshotsImpl: async () => [{ version: 'bad', cachedAt: '2026-03-01', data: {} }]
  });

  assert.equal(result.source, 'bundled');
  assert.equal(result.data, bundledData);
  assert.match(result.warning, /offline/);
});

test('缓存淘汰只保留按写入时间排序的当前与上一版本', () => {
  const records = [
    { version: 'old', cachedAt: '2026-01-01T00:00:00.000Z' },
    { version: 'current', cachedAt: '2026-03-01T00:00:00.000Z' },
    { version: 'previous', cachedAt: '2026-02-01T00:00:00.000Z' }
  ];

  assert.deepEqual(cacheVersionsToPrune(records), ['old']);
  assert.deepEqual(sortCachedSnapshots(records).map((record) => record.version), ['current', 'previous', 'old']);
});

test('命中当前缓存时仍会清理多余旧版本', async () => {
  const cachedData = makeValidData('当前缓存干员', 'current');
  let pruneCalls = 0;
  const result = await loadGameDataWith({
    fetchJsonImpl: async () => ({ dataVersion: 'current' }),
    readCachedSnapshotImpl: async () => cachedData,
    pruneCachedSnapshotsImpl: async () => { pruneCalls += 1; }
  });

  assert.equal(result.source, 'cache-current');
  assert.equal(pruneCalls, 1);
});

test('清单版本与当前缓存内容版本不一致时跳过缓存并重新联网', async () => {
  const networkData = makeValidData('联网修复干员', 'v2');
  const result = await loadGameDataWith({
    fetchJsonImpl: async (url) => url.includes('data-version') ? { dataVersion: 'v2' } : networkData,
    readCachedSnapshotImpl: async () => makeValidData('污染缓存干员', 'v1'),
    readCachedSnapshotsImpl: async () => [],
    writeCachedSnapshotImpl: async () => {}
  });

  assert.equal(result.source, 'network');
  assert.equal(result.data.dataVersion, 'v2');
});

test('网络响应版本与清单不一致时禁止写入新版本缓存并回退内置数据', async () => {
  const writes = [];
  const bundledData = makeValidData('内置回退干员', 'bundled-version');
  const result = await loadGameDataWith({
    fetchJsonImpl: async (url) => {
      if (url.includes('data-version')) return { dataVersion: 'v2' };
      if (url.includes('?v=')) return makeValidData('过期网络干员', 'v1');
      return bundledData;
    },
    readCachedSnapshotImpl: async () => null,
    readCachedSnapshotsImpl: async () => [],
    writeCachedSnapshotImpl: async (...args) => writes.push(args)
  });

  assert.equal(result.source, 'bundled');
  assert.deepEqual(writes, []);
  assert.match(result.warning, /版本不匹配/);
});
