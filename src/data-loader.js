const CACHE_DATABASE = 'arknights-material-planner:data-cache';
const CACHE_STORE = 'snapshots';

function validateGameData(data) {
  if (!data || !Array.isArray(data.OPS_ORDER) || !data.OPS || !data.MAT_RARITY) {
    throw new Error('游戏数据结构不完整。');
  }
  if (data.OPS_ORDER.length < 100 || Object.keys(data.MAT_RARITY).length < 50) {
    throw new Error('游戏数据数量异常，已拒绝使用。');
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

async function readLatestSnapshot() {
  const database = await openCache();
  if (!database) return null;
  return new Promise((resolve) => {
    const request = database.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).openCursor(null, 'prev');
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => resolve(null);
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
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`数据请求失败：${response.status}`);
  return response.json();
}

export async function loadGameData() {
  try {
    const manifest = await fetchJson('./data/data-version.json', { cache: 'no-store' });
    const version = String(manifest.dataVersion || manifest.generatedAt || 'current');
    const cached = await readCachedSnapshot(version);
    if (cached) return { data: validateGameData(cached), manifest, source: 'cache-current' };

    const data = validateGameData(await fetchJson(`./data/game-data.json?v=${encodeURIComponent(version)}`, { cache: 'no-cache' }));
    await writeCachedSnapshot(version, data);
    return { data, manifest, source: 'network' };
  } catch (onlineError) {
    const latest = await readLatestSnapshot();
    if (latest?.data) {
      return {
        data: validateGameData(latest.data),
        manifest: { dataVersion: latest.version, generatedAt: latest.data.generatedAt },
        source: 'cache-offline',
        warning: onlineError.message
      };
    }

    const data = validateGameData(await fetchJson('./data/game-data.json', { cache: 'no-cache' }));
    return {
      data,
      manifest: { dataVersion: 'bundled', generatedAt: data.generatedAt },
      source: 'bundled',
      warning: onlineError.message
    };
  }
}

export { validateGameData };
