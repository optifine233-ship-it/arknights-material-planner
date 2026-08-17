export const MATERIAL_CATEGORIES = {
  currency: { code: 'LMD', label: '龙门币', order: 0, tone: 'gold' },
  exp: { code: 'EXP', label: '作战记录', order: 1, tone: 'green' },
  skill: { code: 'SKILL', label: '技巧概要', order: 2, tone: 'blue' },
  chip: { code: 'CHIP', label: '精英化芯片', order: 3, tone: 'cyan' },
  module: { code: 'MODULE', label: '模组资源', order: 4, tone: 'violet' },
  material: { code: 'MATERIAL', label: '普通养成材料', order: 5, tone: 'slate' },
  special: { code: 'SPECIAL', label: '其他资源', order: 6, tone: 'red' }
};

export function getMaterialCategory(name) {
  if (name === '龙门币') return 'currency';
  if (name.includes('作战记录')) return 'exp';
  if (name.includes('技巧概要')) return 'skill';
  if (name.includes('芯片') || name === '芯片助剂') return 'chip';
  if (name.includes('模组数据') || name.includes('数据增补')) return 'module';
  if (name.includes('家具') || name.includes('采购凭证')) return 'special';
  return 'material';
}

export function getMaterialIconText(name) {
  const category = getMaterialCategory(name);
  if (category === 'currency') return '₤';
  if (category === 'exp') return 'EXP';
  if (category === 'skill') return name.slice(-2).replace('卷', 'S');
  if (category === 'chip') return name.includes('双') ? 'CH+' : 'CH';
  if (category === 'module') return name.includes('增补') ? 'UP' : 'MOD';
  return Array.from(name).slice(0, 1).join('');
}

export function getAllInventoryMaterials(gameData) {
  const special = gameData.SPECIAL_RESOURCES || [];
  const known = Object.keys(gameData.MAT_RARITY || {});
  return [...new Set([...special, ...known])];
}

export function compareMaterials(a, b, gameData, sortMode = 'default') {
  if (sortMode === 'name') return a.localeCompare(b, 'zh-CN');
  const tierA = gameData.MAT_RARITY?.[a] ?? 0;
  const tierB = gameData.MAT_RARITY?.[b] ?? 0;
  if (sortMode === 'tier') return tierB - tierA || a.localeCompare(b, 'zh-CN');
  const categoryA = MATERIAL_CATEGORIES[getMaterialCategory(a)];
  const categoryB = MATERIAL_CATEGORIES[getMaterialCategory(b)];
  if (categoryA === MATERIAL_CATEGORIES.chip && categoryB === MATERIAL_CATEGORIES.chip) {
    if (a === '芯片助剂') return -1;
    if (b === '芯片助剂') return 1;
  }
  return categoryA.order - categoryB.order || tierB - tierA || a.localeCompare(b, 'zh-CN');
}

export function groupMaterialNames(names, gameData, grouping = 'purpose') {
  const sorted = [...names];
  if (grouping === 'tier') {
    sorted.sort((a, b) => compareMaterials(a, b, gameData, 'tier'));
    const groups = new Map();
    for (const name of sorted) {
      const tier = gameData.MAT_RARITY?.[name] ?? 0;
      const key = `tier-${tier}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          code: tier ? `T${tier + 1}` : 'SPECIAL',
          label: tier ? `材料层级 T${tier + 1}` : '特殊资源',
          tone: tier >= 4 ? 'gold' : tier === 3 ? 'violet' : tier === 2 ? 'blue' : 'green',
          names: []
        });
      }
      groups.get(key).names.push(name);
    }
    return [...groups.values()];
  }

  sorted.sort((a, b) => compareMaterials(a, b, gameData));
  const groups = new Map();
  for (const name of sorted) {
    const key = getMaterialCategory(name);
    if (!groups.has(key)) groups.set(key, { key, ...MATERIAL_CATEGORIES[key], names: [] });
    groups.get(key).names.push(name);
  }
  return [...groups.values()];
}

export function formatNumber(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('zh-CN').format(number);
}
