function normalizedSuffix(type) {
  const value = String(type || '').trim();
  if (!value) return '';
  return value.split('-').at(-1).trim().toUpperCase();
}

export function moduleTypeLabel(type) {
  const suffix = normalizedSuffix(type);
  if (suffix === 'X') return 'X模';
  if (suffix === 'Y') return 'Y模';
  if (suffix === 'D' || suffix === 'Δ') return '△模';
  if (suffix === 'A' || suffix === 'Α') return '特限模';
  return '';
}

export function formatModuleName(module) {
  const name = String(module?.name || '').trim();
  const typeLabel = moduleTypeLabel(module?.type);
  return [typeLabel, name].filter(Boolean).join(' · ');
}
