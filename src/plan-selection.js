const VALID_PRESETS = new Set(['all', 'owned', 'custom']);

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))];
}

function operatorSelectionId(operatorName, gameData) {
  return String(gameData?.OPS?.[operatorName]?.id || operatorName || '');
}

function itemSelectionId(item, gameData) {
  return `${operatorSelectionId(item?.operatorName, gameData)}::${String(item?.selectionKey || item?.key || '')}`;
}

function operatorItems(operatorName, items) {
  return (items || []).filter((item) => item.operatorName === operatorName);
}

export function normalizePlanSelection(raw = {}) {
  const preset = typeof raw?.preset === 'string'
    && (VALID_PRESETS.has(raw.preset) || /^rarity:[1-6]$/.test(raw.preset))
    ? raw.preset
    : 'all';
  return {
    preset,
    excludedOperators: uniqueStrings(raw?.excludedOperators),
    excludedItems: uniqueStrings(raw?.excludedItems)
  };
}

function presetAllows(item, preset, gameData, userState) {
  if (preset === 'owned') return Boolean(userState?.operators?.[item?.operatorName]?.owned);
  if (preset.startsWith('rarity:')) {
    return (gameData?.OPS?.[item?.operatorName]?.r || 0) + 1 === Number(preset.slice(7));
  }
  return true;
}

function materializeCustomSelection(selection, items, gameData, userState) {
  const normalized = normalizePlanSelection(selection);
  if (normalized.preset === 'custom') return normalized;

  const excludedOperators = [];
  const excludedItems = [];
  const names = [...new Set((items || []).map((item) => item.operatorName))];
  for (const operatorName of names) {
    const relevant = operatorItems(operatorName, items);
    const selected = relevant.filter((item) => isPlanItemSelected(item, normalized, gameData, userState));
    if (!selected.length) excludedOperators.push(operatorSelectionId(operatorName, gameData));
    else if (selected.length < relevant.length) {
      for (const item of relevant) {
        if (!selected.includes(item)) excludedItems.push(itemSelectionId(item, gameData));
      }
    }
  }
  return { preset: 'custom', excludedOperators, excludedItems };
}

export function isPlanItemSelected(item, selection, gameData, userState) {
  const normalized = normalizePlanSelection(selection);
  return presetAllows(item, normalized.preset, gameData, userState)
    && !normalized.excludedOperators.includes(operatorSelectionId(item?.operatorName, gameData))
    && !normalized.excludedItems.includes(itemSelectionId(item, gameData));
}

export function filterSelectedPlanItems(items, selection, gameData, userState) {
  return (items || []).filter((item) => isPlanItemSelected(item, selection, gameData, userState));
}

export function operatorPlanSelectionState(operatorName, items, selection, gameData, userState) {
  const relevant = operatorItems(operatorName, items);
  const selectedCount = relevant.filter((item) => isPlanItemSelected(item, selection, gameData, userState)).length;
  return {
    checked: relevant.length > 0 && selectedCount === relevant.length,
    indeterminate: selectedCount > 0 && selectedCount < relevant.length,
    selectedCount,
    totalCount: relevant.length
  };
}

export function setPlanOperatorSelected(selection, operatorName, items, selected, gameData, userState) {
  const normalized = materializeCustomSelection(selection, items, gameData, userState);
  const operatorId = operatorSelectionId(operatorName, gameData);
  const relevantIds = new Set(operatorItems(operatorName, items).map((item) => itemSelectionId(item, gameData)));
  return {
    preset: 'custom',
    excludedOperators: selected
      ? normalized.excludedOperators.filter((id) => id !== operatorId)
      : [...normalized.excludedOperators.filter((id) => id !== operatorId), operatorId],
    excludedItems: normalized.excludedItems.filter((id) => !relevantIds.has(id))
  };
}

export function setPlanItemSelected(selection, item, items, selected, gameData, userState) {
  const normalized = materializeCustomSelection(selection, items, gameData, userState);
  const operatorName = item?.operatorName;
  const operatorId = operatorSelectionId(operatorName, gameData);
  const relevant = operatorItems(operatorName, items);
  const selectedIds = new Set(
    relevant
      .filter((entry) => isPlanItemSelected(entry, normalized, gameData, userState))
      .map((entry) => itemSelectionId(entry, gameData))
  );
  const targetId = itemSelectionId(item, gameData);
  if (selected) selectedIds.add(targetId);
  else selectedIds.delete(targetId);

  const relevantIds = new Set(relevant.map((entry) => itemSelectionId(entry, gameData)));
  const excludedItems = normalized.excludedItems.filter((id) => !relevantIds.has(id));
  const excludedOperators = normalized.excludedOperators.filter((id) => id !== operatorId);

  if (selectedIds.size === 0) excludedOperators.push(operatorId);
  else if (selectedIds.size < relevant.length) {
    for (const entry of relevant) {
      const id = itemSelectionId(entry, gameData);
      if (!selectedIds.has(id)) excludedItems.push(id);
    }
  }

  return {
    preset: 'custom',
    excludedOperators,
    excludedItems
  };
}

export function applyPlanSelectionPreset(selection, preset, items, gameData, userState) {
  const normalizedPreset = VALID_PRESETS.has(preset) || /^rarity:[1-6]$/.test(preset) ? preset : 'all';
  return {
    preset: normalizedPreset,
    excludedOperators: [],
    excludedItems: []
  };
}
