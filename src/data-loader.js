import { cacheVersionsToPrune, findValidCachedSnapshot, sortCachedSnapshots } from './data-cache-policy.js';

const CACHE_DATABASE = 'arknights-material-planner:data-cache';
const CACHE_STORE = 'snapshots';

function validateGameData(data, expectedVersion = '') {
  if (!data || !Array.isArray(data.OPS_ORDER) || !data.OPS || !data.MAT_RARITY) {
    throw new Error('游戏数据结构不完整。');
  }
  if (data.OPS_ORDER.length < 100 || Object.keys(data.MAT_RARITY).length < 50) {
    throw new Error('游戏数据数量异常，已拒绝使用。');
  }
  if (expectedVersion && String(data.dataVersion || '') !== String(expectedVersion)) {
    throw new Error(`游戏数据版本不匹配：期望 ${expectedVersion}，实际 ${data.dataVersion || '未声明'}。`);
  }
  return data;
}

function openCache() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(CACHE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
        request.result.createObjectStore(CACHE_STORE, { keyPath: 'version' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readCachedSnapshot(version) {
  const database = await openCache();
  if (!database) return null;
  return new Promise((resolve) => {
    const request = database.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(version);
    request.onsuccess = () => resolve(request.result?.data || null);
    request.onerror = () => resolve(null);
  });
}

async function readCachedSnapshots() {
  const database = await openCache();
  if (!database) return [];
  return new Promise((resolve) => {
    const request = database.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).getAll();
    request.onsuccess = () => resolve(sortCachedSnapshots(request.result || []));
    request.onerror = () => resolve([]);
  });
}

async function pruneCachedSnapshots() {
  const records = await readCachedSnapshots();
  const versions = cacheVersionsToPrune(records);
  if (!versions.length) return;
  const database = await openCache();
  if (!database) return;
  await new Promise((resolve) => {
    const transaction = database.transaction(CACHE_STORE, 'readwrite');
    for (const version of versions) transaction.objectStore(CACHE_STORE).delete(version);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
  });
}

async function writeCachedSnapshot(version, data) {
  const database = await openCache();
  if (!database) return;
  await new Promise((resolve) => {
    const transaction = database.transaction(CACHE_STORE, 'readwrite');
    transaction.objectStore(CACHE_STORE).put({ version, cachedAt: new Date().toISOString(), data });
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
  });
  await pruneCachedSnapshots();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`数据请求失败：${response.status}`);
  return response.json();
}

export async function loadGameDataWith(dependencies = {}) {
  const {
    fetchJsonImpl = fetchJson,
    readCachedSnapshotImpl = readCachedSnapshot,
    readCachedSnapshotsImpl = readCachedSnapshots,
    writeCachedSnapshotImpl = writeCachedSnapshot,
    pruneCachedSnapshotsImpl = pruneCachedSnapshots
  } = dependencies;
  let onlineError;

  try {
    const manifest = await fetchJsonImpl('./data/data-version.json', { cache: 'no-store' });
    const version = String(manifest.dataVersion || manifest.generatedAt || 'current');
    const cached = await readCachedSnapshotImpl(version);
    if (cached) {
      try {
        const data = validateGameData(cached, version);
        await pruneCachedSnapshotsImpl();
        return { data, manifest, source: 'cache-current' };
      } catch (error) {
        onlineError = error;
      }
    }

    try {
      const data = validateGameData(await fetchJsonImpl(`./data/game-data.json?v=${encodeURIComponent(version)}`, { cache: 'no-cache' }), version);
      await writeCachedSnapshotImpl(version, data);
      return { data, manifest, source: 'network' };
    } catch (error) {
      onlineError = error;
    }
  } catch (error) {
    onlineError = error;
  }

  const cached = findValidCachedSnapshot(
    await readCachedSnapshotsImpl(),
    (data, record) => validateGameData(data, record.version)
  );
  if (cached) {
    return {
      data: cached.data,
      manifest: { dataVersion: cached.version, generatedAt: cached.data.generatedAt },
      source: 'cache-offline',
      warning: onlineError?.message
    };
  }

  const data = validateGameData(await fetchJsonImpl('./data/game-data.json', { cache: 'no-cache' }));
  return {
    data,
    manifest: { dataVersion: 'bundled', generatedAt: data.generatedAt },
    source: 'bundled',
    warning: onlineError?.message
  };
}

export async function loadGameData() {
  return loadGameDataWith();
}

export { validateGameData };
