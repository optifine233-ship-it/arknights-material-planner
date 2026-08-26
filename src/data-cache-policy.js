export function sortCachedSnapshots(records = []) {
  return [...records].sort((left, right) => {
    const byTime = String(right?.cachedAt || '').localeCompare(String(left?.cachedAt || ''));
    return byTime || String(right?.version || '').localeCompare(String(left?.version || ''));
  });
}

export function findValidCachedSnapshot(records, validate) {
  for (const record of sortCachedSnapshots(records)) {
    if (!record?.data) continue;
    try {
      return { ...record, data: validate(record.data, record) };
    } catch {
      // A corrupt snapshot must not prevent an older known-good snapshot from loading.
    }
  }
  return null;
}

export function cacheVersionsToPrune(records, keepCount = 2) {
  return sortCachedSnapshots(records)
    .slice(Math.max(0, keepCount))
    .map((record) => record?.version)
    .filter(Boolean);
}
