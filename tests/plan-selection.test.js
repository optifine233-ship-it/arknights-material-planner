import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlanSelectionPreset,
  filterSelectedPlanItems,
  normalizePlanSelection,
  operatorPlanSelectionState,
  setPlanItemSelected,
  setPlanOperatorSelected
} from '../src/plan-selection.js';

const gameData = {
  OPS: {
    煌: { id: 'char_huang', r: 5 },
    能天使: { id: 'char_angel', r: 5 },
    桃金娘: { id: 'char_myrtle', r: 3 }
  }
};

const items = [
  { operatorName: '煌', key: 'promotion:e2' },
  { operatorName: '煌', key: 'skill:1-7' },
  { operatorName: '能天使', key: 'skill:4-7' },
  { operatorName: '桃金娘', key: 'promotion:e2' }
];

test('旧用户没有选择记录时默认统计全部计划', () => {
  const selection = normalizePlanSelection();
  assert.equal(selection.preset, 'all');
  assert.deepEqual(filterSelectedPlanItems(items, selection, gameData), items);
});

test('取消干员会取消其全部强化项', () => {
  const selection = setPlanOperatorSelected(normalizePlanSelection(), '煌', items, false, gameData);
  assert.deepEqual(filterSelectedPlanItems(items, selection, gameData), items.slice(2));
  assert.deepEqual(operatorPlanSelectionState('煌', items, selection, gameData), {
    checked: false,
    indeterminate: false,
    selectedCount: 0,
    totalCount: 2
  });
});

test('在已取消的干员中重新勾选一项会得到半选状态', () => {
  let selection = setPlanOperatorSelected(normalizePlanSelection(), '煌', items, false, gameData);
  selection = setPlanItemSelected(selection, items[1], items, true, gameData);

  assert.deepEqual(filterSelectedPlanItems(items, selection, gameData), [items[1], ...items.slice(2)]);
  assert.deepEqual(operatorPlanSelectionState('煌', items, selection, gameData), {
    checked: false,
    indeterminate: true,
    selectedCount: 1,
    totalCount: 2
  });
});

test('预设可以选择仅已拥有或仅指定星级', () => {
  const userState = {
    operators: {
      煌: { owned: true },
      能天使: { owned: false },
      桃金娘: { owned: true }
    }
  };
  const owned = applyPlanSelectionPreset(normalizePlanSelection(), 'owned', items, gameData, userState);
  assert.deepEqual(filterSelectedPlanItems(items, owned, gameData, userState), [items[0], items[1], items[3]]);

  const sixStar = applyPlanSelectionPreset(owned, 'rarity:6', items, gameData, userState);
  assert.deepEqual(filterSelectedPlanItems(items, sixStar, gameData, userState), items.slice(0, 3));

  const all = applyPlanSelectionPreset(sixStar, 'all', items, gameData, userState);
  assert.deepEqual(filterSelectedPlanItems(items, all, gameData, userState), items);
});

test('仅已拥有预设会随拥有状态和新增计划动态更新', () => {
  const userState = { operators: { 煌: { owned: true }, 能天使: { owned: false } } };
  const selection = applyPlanSelectionPreset(normalizePlanSelection(), 'owned', items, gameData, userState);
  assert.deepEqual(filterSelectedPlanItems(items, selection, gameData, userState), [items[0], items[1]]);

  userState.operators.煌.owned = false;
  userState.operators.能天使.owned = true;
  const updatedItems = [...items, { operatorName: '能天使', key: 'promotion:e2' }];
  assert.deepEqual(filterSelectedPlanItems(updatedItems, selection, gameData, userState), [items[2], updatedItems[4]]);
});

test('进度变化后仍使用稳定强化项键保留排除状态', () => {
  const before = [
    { operatorName: '煌', key: 'skill:1-7', selectionKey: 'skill:levels' },
    { operatorName: '煌', key: 'promotion:e2', selectionKey: 'promotion:e2' }
  ];
  const selection = setPlanItemSelected(normalizePlanSelection(), before[0], before, false, gameData);
  const after = [
    { operatorName: '煌', key: 'skill:3-7', selectionKey: 'skill:levels' },
    before[1]
  ];

  assert.deepEqual(filterSelectedPlanItems(after, selection, gameData), [after[1]]);
});

test('模组顺序变化不会把排除状态转移到其他模组', () => {
  const moduleA = { operatorName: '煌', key: 'module:A:1', selectionKey: 'module:A:1' };
  const moduleB = { operatorName: '煌', key: 'module:B:1', selectionKey: 'module:B:1' };
  const selection = setPlanItemSelected(normalizePlanSelection(), moduleA, [moduleA, moduleB], false, gameData);

  assert.deepEqual(filterSelectedPlanItems([moduleB, moduleA], selection, gameData), [moduleB]);
});

test('选择状态对重复值和非字符串记录做安全归一化', () => {
  assert.deepEqual(normalizePlanSelection({
    preset: 'rarity:6',
    excludedOperators: ['char_huang', 'char_huang', null],
    excludedItems: ['char_huang::skill:1-7', 3]
  }), {
    preset: 'rarity:6',
    excludedOperators: ['char_huang'],
    excludedItems: ['char_huang::skill:1-7']
  });
});
