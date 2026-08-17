import {
  buildOperatorUpgradeItems,
  buildPlanUpgradeItems,
  computeMaterialSummary,
  decomposeMaterial,
  isResourceFreeCultivationOperator
} from './calculator.js';
import {
  createBackup,
  createCultivationState,
  createProjectExport,
  loadBackup,
  loadUserState,
  mergeProjectImport,
  normalizeOperatorProgress,
  normalizeUserState,
  parseProjectImport,
  saveUserState
} from './storage.js';
import { calculateStatistics } from './statistics.js';
import {
  applyPlanSelectionPreset,
  filterSelectedPlanItems,
  isPlanItemSelected,
  operatorPlanSelectionState,
  setPlanItemSelected,
  setPlanOperatorSelected
} from './plan-selection.js';
import { applyMaaOperatorImport, parseMaaOperatorExport } from './importers/maa.js';
import { loadGameData } from './data-loader.js';
import {
  formatNumber,
  getAllInventoryMaterials,
  getMaterialCategory,
  groupMaterialNames,
  MATERIAL_CATEGORIES
} from './materials.js';
import {
  emptyState,
  escapeHtml,
  materialIcon,
  operatorPortrait,
  selectOptions
} from './ui.js';

const VIEW_META = {
  operators: { code: 'OPS / OPERATOR INDEX', title: '干员档案' },
  plan: { code: 'PLAN / CULTIVATION QUEUE', title: '培养计划' },
  inventory: { code: 'STOCK / RESOURCE LEDGER', title: '材料库存' },
  gaps: { code: 'GAP / SUPPLY SHORTAGE', title: '缺口统计' },
  statistics: { code: 'STATS / ACCOUNT REVIEW', title: '养成统计' }
};

const KIND_LABELS = {
  level: 'LEVEL',
  promotion: 'ELITE',
  skill: 'SKILL',
  mastery: 'MASTERY',
  module: 'MODULE'
};

const PROFESSIONS = ['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let gameData;
let userState;
let currentView = 'operators';
let selectedOperator = null;
let pendingImport = null;
let pendingImportKind = null;
let toastTimer = null;
const openPlanOperators = new Set();
let filters = {
  operatorSearch: '',
  professions: [],
  subprofessions: [],
  positions: [],
  rarities: [],
  operatorScope: 'all',
  inventorySearch: ''
};

function encoded(value) {
  return encodeURIComponent(String(value));
}

function decoded(value) {
  return decodeURIComponent(String(value));
}

function filterValues(key) {
  return Array.isArray(filters[key]) ? filters[key] : [];
}

function renderFilterButtons(key, values, labeler = (value) => value) {
  const selected = filterValues(key);
  return `
    <button type="button" class="matrix-filter ${selected.length ? '' : 'is-active'}" data-action="clear-operator-filter" data-filter="${key}">不限</button>
    ${values.map((value) => `<button type="button" class="matrix-filter ${selected.includes(String(value)) ? 'is-active' : ''}" data-action="toggle-operator-filter" data-filter="${key}" data-value="${encoded(value)}">${escapeHtml(labeler(value))}</button>`).join('')}
  `;
}

function getProgress(operatorName) {
  const operator = gameData.OPS[operatorName];
  return normalizeOperatorProgress(
    userState.operators[operatorName] || {},
    operator,
    gameData
  );
}

function persist(message = '') {
  userState = normalizeUserState(userState, gameData);
  userState = saveUserState(localStorage, userState);
  const saveState = $('#save-state');
  if (saveState) {
    saveState.innerHTML = '<i></i>已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  if (message) showToast(message);
}

function showToast(message, error = false) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('is-error', error);
  toast.classList.add('is-visible');
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function allPlanItems() {
  return buildPlanUpgradeItems(gameData, userState);
}

function selectedPlanItems(items = allPlanItems()) {
  return filterSelectedPlanItems(items, userState.settings.planSelection, gameData, userState);
}

function itemsByOperator(items = allPlanItems()) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.operatorName)) groups.set(item.operatorName, []);
    groups.get(item.operatorName).push(item);
  }
  return groups;
}

function renderShellCounts(allItems, scopedItems = selectedPlanItems(allItems)) {
  const owned = Object.values(userState.operators).filter((progress) => progress.owned).length;
  const planned = new Set(allItems.map((item) => item.operatorName)).size;
  const stocked = Object.values(userState.inventory).filter((qty) => Number(qty) > 0).length;
  const summary = computeMaterialSummary(scopedItems, userState.inventory, gameData);
  const gaps = summary.rows.filter((row) => row.shortage > 0).length;
  $('#nav-operators-count').textContent = owned;
  $('#nav-plan-count').textContent = planned;
  $('#nav-stock-count').textContent = stocked;
  $('#nav-gap-count').textContent = gaps;
}

function render() {
  const meta = VIEW_META[currentView];
  $('#view-code').textContent = meta.code;
  $('#view-title').textContent = meta.title;
  $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === currentView));

  const items = allPlanItems();
  const scopedItems = selectedPlanItems(items);
  renderShellCounts(items, scopedItems);
  const workspace = $('#workspace');

  if (currentView === 'operators') workspace.innerHTML = renderOperators(items);
  if (currentView === 'plan') workspace.innerHTML = renderPlan(items, scopedItems);
  if (currentView === 'inventory') workspace.innerHTML = renderInventory();
  if (currentView === 'gaps') workspace.innerHTML = renderGaps(scopedItems, items);
  if (currentView === 'statistics') workspace.innerHTML = renderStatistics(items, scopedItems);
  syncPlanCheckboxStates();
}

function renderOperators(items) {
  const planned = itemsByOperator(items);
  const subprofessions = [...new Set(gameData.OPS_ORDER.map((name) => gameData.OPS[name].sp).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const positions = [...new Set(gameData.OPS_ORDER.map((name) => gameData.OPS[name].pos).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const names = gameData.OPS_ORDER.filter((name) => {
    const operator = gameData.OPS[name];
    const progress = getProgress(name);
    if (filters.operatorSearch && !name.toLowerCase().includes(filters.operatorSearch.toLowerCase())) return false;
    if (filterValues('professions').length && !filterValues('professions').includes(operator.p)) return false;
    if (filterValues('subprofessions').length && !filterValues('subprofessions').includes(operator.sp)) return false;
    if (filterValues('positions').length && !filterValues('positions').includes(operator.pos)) return false;
    if (filterValues('rarities').length && !filterValues('rarities').includes(String(operator.r + 1))) return false;
    if (filters.operatorScope === 'owned' && !progress.owned) return false;
    if (filters.operatorScope === 'planned' && !planned.has(name)) return false;
    return true;
  });
  const ownedCount = Object.values(userState.operators).filter((progress) => progress.owned).length;

  return `
    <section class="view-intro">
      <div><h2>干员档案</h2><p>记录持有干员的当前状态，并为需要培养的干员设置目标。</p></div>
      <div class="view-intro__stat"><strong>${ownedCount}</strong><small>OWNED OPERATORS</small></div>
    </section>
    ${renderOnboarding()}
    <section class="operator-filter-panel" aria-label="干员筛选">
      <header class="operator-filter-panel__header">
        <label class="field operator-search"><span>搜索干员</span><input id="operator-search" type="search" value="${escapeHtml(filters.operatorSearch)}" placeholder="输入干员名称"></label>
        <div class="scope-switch" aria-label="显示范围">${['all', 'owned', 'planned'].map((scope) => `<button type="button" class="${filters.operatorScope === scope ? 'is-active' : ''}" data-action="set-operator-scope" data-scope="${scope}">${({ all: '全部干员', owned: '我的干员', planned: '计划中' })[scope]}</button>`).join('')}</div>
        <div class="filter-result"><strong>${names.length}</strong><span>名干员</span></div>
        <button class="button button--quiet" type="button" data-action="reset-operator-filters">重置筛选</button>
      </header>
      <div class="filter-matrix">
        <div class="filter-matrix__row"><span class="filter-matrix__label">职业</span><div class="filter-matrix__options filter-matrix__options--profession">${renderFilterButtons('professions', PROFESSIONS)}</div></div>
        <div class="filter-matrix__row filter-matrix__row--branches"><span class="filter-matrix__label">分支</span><details open><summary>分支职业 <small>${filterValues('subprofessions').length ? `已选 ${filterValues('subprofessions').length} 项` : '不限'}</small></summary><div class="filter-matrix__options">${renderFilterButtons('subprofessions', subprofessions)}</div></details></div>
        <div class="filter-matrix__row"><span class="filter-matrix__label">星级</span><div class="filter-matrix__options filter-matrix__options--compact">${renderFilterButtons('rarities', ['6','5','4','3','2','1'], (value) => `${value}★`)}</div></div>
        <div class="filter-matrix__row"><span class="filter-matrix__label">位置</span><div class="filter-matrix__options filter-matrix__options--compact">${renderFilterButtons('positions', positions)}</div></div>
      </div>
    </section>
    ${names.length ? `<div class="operator-grid">${names.map((name) => renderOperatorCard(name, planned.get(name) || [])).join('')}</div>` : emptyState('没有符合条件的干员', '请调整筛选条件。')}
  `;
}

function renderOnboarding() {
  const hasStarted = Object.values(userState.operators).some((progress) => progress.owned)
    || Object.values(userState.inventory).some((quantity) => quantity > 0);
  if (hasStarted || userState.settings.onboardingDismissed) return '';
  return `<section class="onboarding-panel">
    <header><div><small>QUICK START</small><h2>三步建立你的后勤计划</h2></div><button class="icon-button icon-button--dark" type="button" data-action="dismiss-onboarding" aria-label="关闭新手引导">×</button></header>
    <div class="onboarding-steps"><div><b>01</b><span><strong>选择干员</strong><small>填写目前状态与目标状态</small></span></div><div><b>02</b><span><strong>登记库存</strong><small>T2 材料也会自动参与抵扣</small></span></div><div><b>03</b><span><strong>查看缺口</strong><small>按资源或培养项核对需求</small></span></div></div>
  </section>`;
}

function renderOperatorCard(name, items) {
  const operator = gameData.OPS[name];
  const progress = getProgress(name);
  const current = progress.current;
  const resourceFree = isResourceFreeCultivationOperator(operator);
  const currentText = progress.owned
    ? [`精${current.elite}`, `${current.level}级`, current.skillLevel > 1 ? `技${current.skillLevel}` : ''].filter(Boolean).join(' · ')
    : '尚未标记拥有';
  return `
    <button type="button" class="operator-card ${progress.owned ? 'is-owned' : ''}" data-action="open-operator" data-operator="${encoded(name)}">
      ${operatorPortrait(name, operator)}
      <span class="operator-card__body">
        <span class="operator-card__rarity operator-card__rarity--${operator.r + 1}">${operator.r + 1}★</span>
        <span class="operator-card__meta">${escapeHtml(operator.p)} · ${escapeHtml(operator.sp || '未分类')}</span>
        <h3>${escapeHtml(name)}</h3>
        <span class="operator-card__profession">${escapeHtml(operator.pos || '')}${operator.pos ? ' · ' : ''}${currentText}</span>
        <span class="operator-card__status"><span>${resourceFree ? '不计养成材料' : items.length ? `${items.length} 项待培养` : '无培养计划'}</span><b>${resourceFree ? '特殊养成' : items.length ? '计划中' : '设置'}</b></span>
      </span>
    </button>
  `;
}

function renderPlan(items, scopedItems) {
  const groups = itemsByOperator(items);
  const totalExp = scopedItems.reduce((sum, item) => sum + item.exp, 0);
  const totalLmd = scopedItems.reduce((sum, item) => sum + item.lmd, 0);
  if (!items.length) {
    return `${renderViewIntro('培养计划', '这里会列出当前状态到目标状态之间的全部强化项。', '0', 'ACTIVE OPERATORS')}${emptyState('还没有培养计划', '请先为干员设置目标状态。', '<button class="button button--signal" type="button" data-action="go-view" data-view="operators">前往干员档案</button>')}`;
  }
  return `
    ${renderViewIntro('培养计划', '按干员查看升级、精英化、技能、专精和模组需求。', String(groups.size), 'ACTIVE OPERATORS')}
    ${renderPlanSelectionPanel(items, scopedItems)}
    <div class="summary-strip">
      ${summaryCell('SELECTED ITEMS', scopedItems.length, `全部 ${items.length} 项`)}
      ${summaryCell('OPERATORS', new Set(scopedItems.map((item) => item.operatorName)).size, '本次统计')}
      ${summaryCell('EXP REQUIRED', formatNumber(totalExp), '升级经验')}
      ${summaryCell('LMD REQUIRED', formatNumber(totalLmd), '含精英化与模组')}
    </div>
    <div>${[...groups.entries()].map(([name, operatorItems]) => renderPlanOperator(name, operatorItems)).join('')}</div>
  `;
}

function renderPlanSelectionPanel(items, scopedItems) {
  const preset = userState.settings.planSelection?.preset || 'all';
  const presets = [
    ['all', '全部干员'],
    ['owned', '仅已拥有'],
    ...[6, 5, 4, 3, 2, 1].map((rarity) => [`rarity:${rarity}`, `${rarity}★`])
  ];
  return `<section class="plan-scope-panel">
    <header><div><small>MATERIAL SCOPE</small><h2>本次材料统计</h2><p>取消勾选只会改变材料统计，不会删除培养目标。</p></div><strong>${scopedItems.length}<span> / ${items.length} 项</span></strong></header>
    <div class="plan-scope-presets" aria-label="统计范围预设">${presets.map(([value, label]) => `<button type="button" class="${preset === value ? 'is-active' : ''}" aria-pressed="${preset === value}" data-action="apply-plan-preset" data-preset="${value}">${label}</button>`).join('')}</div>
  </section>`;
}

function renderPlanOperator(name, items) {
  const selection = operatorPlanSelectionState(name, items, userState.settings.planSelection, gameData, userState);
  const selectedItems = items.filter((item) => isPlanItemSelected(item, userState.settings.planSelection, gameData, userState));
  const exp = selectedItems.reduce((sum, item) => sum + item.exp, 0);
  const lmd = selectedItems.reduce((sum, item) => sum + item.lmd, 0);
  return `
    <details class="plan-operator ${selection.selectedCount ? '' : 'is-excluded'}" data-operator="${encoded(name)}" ${openPlanOperators.has(name) ? 'open' : ''}>
      <summary class="plan-operator__header">
        <input class="plan-checkbox" type="checkbox" ${selection.checked ? 'checked' : ''} data-indeterminate="${selection.indeterminate}" data-action="plan-operator-selection" data-operator="${encoded(name)}" aria-label="将${escapeHtml(name)}纳入本次材料统计">
        <div><h3>${escapeHtml(name)}</h3><p>已选 ${selection.selectedCount}/${items.length} 项 · EXP ${formatNumber(exp)} · LMD ${formatNumber(lmd)}</p></div>
        <b>${escapeHtml(gameData.OPS[name]?.p || '')} / ${gameData.OPS[name]?.r + 1}★</b>
        <span class="plan-operator__toggle" aria-hidden="true"></span>
      </summary>
      <div class="plan-operator__tools"><button class="button button--small" type="button" data-action="open-operator" data-operator="${encoded(name)}">编辑目标</button></div>
      <div class="upgrade-list">${renderUpgradeItems(items, { selectable: true })}</div>
    </details>
  `;
}

function renderUpgradeItems(items, options = {}) {
  return items.map((item) => {
    const base = {};
    for (const material of item.materials) {
      const decomposed = decomposeMaterial(material.name, material.qty, gameData);
      for (const [name, qty] of Object.entries(decomposed)) base[name] = (base[name] || 0) + qty;
    }
    const cost = [item.exp ? `EXP ${formatNumber(item.exp)}` : '', item.lmd ? `LMD ${formatNumber(item.lmd)}` : ''].filter(Boolean).join(' · ');
    const selected = !options.selectable || isPlanItemSelected(item, userState.settings.planSelection, gameData, userState);
    return `
      <details class="upgrade-item ${options.selectable ? 'upgrade-item--selectable' : ''} ${selected ? '' : 'is-excluded'}">
        <summary>${options.selectable ? `<input class="plan-checkbox plan-checkbox--item" type="checkbox" ${selected ? 'checked' : ''} data-action="plan-item-selection" data-operator="${encoded(item.operatorName)}" data-key="${encoded(item.key)}" aria-label="将${escapeHtml(item.operatorName)}的${escapeHtml(item.label)}纳入本次材料统计">` : ''}<span class="upgrade-kind">${KIND_LABELS[item.kind] || item.kind}</span><span class="upgrade-label">${escapeHtml(item.label)}</span>${cost ? `<span class="upgrade-cost-inline">${cost}</span>` : ''}</summary>
        <div class="upgrade-item__body">
          <span class="breakdown-label">DIRECT / 直接材料</span>
          ${renderMaterialChips(item.materials)}
          <span class="breakdown-label">BASELINE / 折算材料</span>
          ${renderMaterialChips(Object.entries(base).map(([name, qty]) => ({ name, qty })))}
        </div>
      </details>
    `;
  }).join('');
}

function syncPlanCheckboxStates() {
  $$('[data-indeterminate="true"]').forEach((checkbox) => { checkbox.indeterminate = true; });
}

function restorePlanSelectionFocus(operatorName, key = '') {
  const selector = key
    ? `[data-action="plan-item-selection"][data-operator="${encoded(operatorName)}"][data-key="${encoded(key)}"]`
    : `[data-action="plan-operator-selection"][data-operator="${encoded(operatorName)}"]`;
  $(selector)?.focus();
}

function renderMaterialChips(materials) {
  if (!materials?.length) return '<span class="no-materials">无材料</span>';
  return `<div class="material-chip-list">${materials.map((material) => `<span class="material-chip" title="${escapeHtml(material.name)}">${materialIcon(material.name, gameData, { size: 'sm' })}<span>${escapeHtml(material.name)}</span><b>×${formatNumber(material.qty)}</b></span>`).join('')}</div>`;
}

function renderInventory() {
  const allNames = getAllInventoryMaterials(gameData);
  const names = allNames.filter((name) => !filters.inventorySearch || name.includes(filters.inventorySearch));
  const grouping = userState.settings.materialGrouping || 'purpose';
  const groups = groupMaterialNames(names, gameData, grouping);
  const stocked = Object.values(userState.inventory).filter((qty) => qty > 0).length;
  return `
    ${renderViewIntro('材料库存', '填写现有材料数量，缺口统计会自动扣除库存。', stocked, 'STOCKED TYPES')}
    <section class="toolbar-panel">
      <label class="field field--grow"><span>搜索资源</span><input id="inventory-search" type="search" value="${escapeHtml(filters.inventorySearch)}" placeholder="输入材料名称"></label>
      <label class="field"><span>分组方式</span><select id="material-grouping">${selectOptions(['purpose', 'tier'], grouping, (value) => value === 'purpose' ? '按用途分类' : '按品质分类')}</select></label>
      <button class="button button--danger" type="button" data-action="confirm-clear-inventory">清空库存</button>
    </section>
    ${groups.map((group) => `
      <section class="section-block">
        ${sectionIndex(group.code, group.label, group.names.length, group.tone)}
        ${renderInventoryGroup(group, grouping)}
      </section>
    `).join('')}
  `;
}

function renderInventoryGroup(group, grouping) {
  if (group.key !== 'material' || grouping !== 'purpose') {
    return `<div class="inventory-grid">${group.names.map((name) => renderInventoryItem(name)).join('')}</div>`;
  }
  const tierLabels = { 4: 'T5 / 金色材料', 3: 'T4 / 紫色材料', 2: 'T3 / 蓝色材料', 1: 'T2 / 绿色材料', 0: 'T1 / 基础材料' };
  const tiers = [...new Set(group.names.map((name) => gameData.MAT_RARITY[name] ?? 0))].sort((a, b) => b - a);
  return `<div class="material-tier-groups">${tiers.map((tier) => {
    const tierNames = group.names.filter((name) => (gameData.MAT_RARITY[name] ?? 0) === tier);
    return `<section class="material-tier-group material-tier-group--${tier}"><header><b>${tierLabels[tier] || `T${tier + 1}`}</b><span>${tierNames.length} 种</span></header><div class="inventory-grid">${tierNames.map((name) => renderInventoryItem(name)).join('')}</div></section>`;
  }).join('')}</div>`;
}

function renderInventoryItem(name) {
  const tier = gameData.MAT_RARITY[name] ?? 0;
  const category = getMaterialCategory(name);
  const tierLabel = category === 'material' ? `T${tier + 1}` : (tier ? `T${tier + 1}` : MATERIAL_CATEGORIES[category].code);
  return `
    <label class="inventory-item inventory-item--tier-${tier}">
      ${materialIcon(name, gameData)}
      <span class="inventory-item__name"><b title="${escapeHtml(name)}">${escapeHtml(name)}</b><small>${tierLabel}</small></span>
      <input class="inventory-input" type="number" inputmode="numeric" min="0" value="${userState.inventory[name] || 0}" data-action="inventory-change" data-material="${encoded(name)}" aria-label="${escapeHtml(name)}库存">
    </label>
  `;
}

function renderGaps(items, allItems = items) {
  const summary = computeMaterialSummary(items, userState.inventory, gameData);
  const display = userState.settings.materialDisplay || 'shortage';
  const rowsByName = new Map(summary.rows.map((row) => [row.name, row]));
  if (display === 'all') {
    for (const name of getAllInventoryMaterials(gameData)) {
      const tier = gameData.MAT_RARITY[name] ?? 0;
      if (tier === 1 || getMaterialCategory(name) === 'exp' || name === '龙门币') continue;
      if (!rowsByName.has(name)) {
        rowsByName.set(name, {
          name,
          tier,
          required: 0,
          directInventoryUsed: 0,
          craftedFromLower: 0,
          lowerInventoryUsed: {},
          shortage: 0,
          procurementCertificates: 0
        });
      }
    }
  }
  let rows = [...rowsByName.values()];
  if (display === 'shortage') rows = rows.filter((row) => row.shortage > 0);
  if (display === 'plan') rows = rows.filter((row) => row.required > 0);
  const lowDirectRows = rows.filter((row) => row.tier < 2 && getMaterialCategory(row.name) === 'material');
  const baselineRows = rows.filter((row) => !lowDirectRows.includes(row));
  const groups = groupResultRows(baselineRows, userState.settings.gapGrouping || 'purpose');
  if (lowDirectRows.length) {
    groups.unshift({
      code: 'DIRECT',
      label: '低阶材料直接需求',
      tone: 'green',
      rows: lowDirectRows.sort((a, b) => b.shortage - a.shortage || a.name.localeCompare(b.name, 'zh-CN')),
      exactOnly: true
    });
  }
  const shortageKinds = summary.rows.filter((row) => row.shortage > 0).length;
  const expStock = Object.entries(gameData.EXP_ITEMS || {}).reduce((sum, [name, value]) => sum + (userState.inventory[name] || 0) * value, 0);
  const expShortage = Math.max(0, summary.totalExp - expStock);
  const lmdStock = userState.inventory.龙门币 || 0;
  const lmdShortage = Math.max(0, summary.totalLmd - lmdStock);

  return `
    ${renderViewIntro('材料缺口', '汇总培养计划扣除库存后的剩余需求。', shortageKinds, 'SHORTAGE TYPES')}
    <div class="summary-strip">
      ${summaryCell('OPERATORS', new Set(items.map((item) => item.operatorName)).size, '培养计划中')}
      ${summaryCell('MATERIAL GAPS', shortageKinds, '有缺口的资源', shortageKinds ? 'danger' : '')}
      ${summaryCell('EXP GAP', formatNumber(expShortage), `库存等效 ${formatNumber(expStock)}`, expShortage ? 'danger' : '')}
      ${summaryCell('LMD GAP', formatNumber(lmdShortage), `库存 ${formatNumber(lmdStock)}`, lmdShortage ? 'danger' : '')}
    </div>
    <section class="toolbar-panel">
      <label class="field"><span>显示范围</span><select id="material-display">${selectOptions(['shortage', 'plan', 'all'], display, (value) => ({ shortage: '仅显示缺口', plan: '显示计划所需', all: '显示全部材料' })[value])}</select></label>
      <label class="field"><span>分组方式</span><select id="gap-grouping">${selectOptions(['purpose', 'tier', 'shortage'], userState.settings.gapGrouping || 'purpose', (value) => ({ purpose: '按用途分类', tier: '按品质分类', shortage: '按缺口从大到小' })[value])}</select></label>
    </section>
    ${items.length ? renderResourceGap(summary, expStock, lmdStock) : ''}
    ${groups.length ? groups.map((group) => renderGapGroup(group, items)).join('') : emptyState(
      items.length ? '当前范围内没有材料' : allItems.length ? '本次未选择强化项' : '还没有培养计划',
      items.length ? '可以切换显示范围查看其他材料。' : allItems.length ? '请在培养计划中勾选本次要统计的干员或强化项。' : '请先为干员设置目标状态。'
    )}
  `;
}

function renderResourceGap(summary, expStock, lmdStock) {
  const rows = [
    { name: '作战记录（经验等效）', required: summary.totalExp, inventory: expStock, shortage: Math.max(0, summary.totalExp - expStock), note: '四种作战记录统一折算为经验' },
    { name: '龙门币', required: summary.totalLmd, inventory: lmdStock, shortage: Math.max(0, summary.totalLmd - lmdStock), note: '包含升级、精英化与模组费用' }
  ];
  return `
    <section class="section-block">
      ${sectionIndex('EXP / LMD', '经验与龙门币', 2, 'gold')}
      <div class="table-scroll"><table class="material-table"><thead><tr><th>资源</th><th>计划需要</th><th>库存等效</th><th>缺口</th></tr></thead><tbody>
        ${rows.map((row) => `<tr><td><div class="material-name-cell">${materialIcon(row.name.startsWith('作战') ? '高级作战记录' : '龙门币', gameData)}<span><b>${row.name}</b><small>${row.note}</small></span></div></td><td>${formatNumber(row.required)}</td><td>${formatNumber(row.inventory)}</td><td class="${row.shortage ? 'shortage' : 'covered'}">${row.shortage ? formatNumber(row.shortage) : '已覆盖'}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
  `;
}

function groupResultRows(rows, grouping) {
  if (grouping === 'shortage') {
    return [{
      code: 'GAP',
      label: '材料缺口排序',
      tone: 'red',
      rows: [...rows].sort((a, b) => b.shortage - a.shortage || b.required - a.required || a.name.localeCompare(b.name, 'zh-CN'))
    }];
  }
  const groupedNames = groupMaterialNames(rows.map((row) => row.name), gameData, grouping);
  const byName = new Map(rows.map((row) => [row.name, row]));
  return groupedNames.map((group) => ({ ...group, rows: group.names.map((name) => byName.get(name)).filter(Boolean) }));
}

function renderGapGroup(group, items) {
  const fourthColumn = group.exactOnly ? '折算说明' : 'T2 合成抵扣';
  return `
    <section class="section-block">
      ${sectionIndex(group.code, group.label, group.rows.length, group.tone)}
      <div class="table-scroll"><table class="material-table"><thead><tr><th>材料</th><th>${group.exactOnly ? '直接需要' : '折算需求'}</th><th>同名库存</th><th>${fourthColumn}</th><th>最终缺口</th></tr></thead><tbody>
        ${group.rows.map((row) => {
          const sources = materialSources(row.name, items);
          const lowerText = group.exactOnly
            ? '早期培养的直接消耗，不并入 T3 基准表'
            : row.craftedFromLower
            ? `${row.craftedFromLower}（${Object.entries(row.lowerInventoryUsed).map(([name, qty]) => `${name}×${qty}`).join('、')}）`
            : '—';
          return `<tr>
            <td><div class="material-name-cell">${materialIcon(row.name, gameData)}<span><b>${escapeHtml(row.name)}</b><small><button class="link-button" type="button" data-action="show-material-sources" data-material="${encoded(row.name)}">查看 ${sources.length} 个来源</button>${row.procurementCertificates ? ` · 等效 ${formatNumber(row.procurementCertificates)} 采购凭证` : ''}</small></span></div></td>
            <td>${formatNumber(row.required)}</td><td>${formatNumber(row.directInventoryUsed)}</td><td class="${row.craftedFromLower ? 'lower-offset' : ''}">${lowerText}</td><td class="${row.shortage ? 'shortage' : 'covered'}">${row.shortage ? formatNumber(row.shortage) : '已覆盖'}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div>
    </section>
  `;
}

function materialSources(materialName, items) {
  const sources = [];
  for (const item of items) {
    let direct = 0;
    let baseline = 0;
    const via = [];
    for (const material of item.materials) {
      if (material.name === materialName) direct += material.qty;
      const decomposed = decomposeMaterial(material.name, material.qty, gameData);
      if (decomposed[materialName]) {
        baseline += decomposed[materialName];
        if (material.name !== materialName) via.push(material.name);
      }
    }
    if (direct || baseline) sources.push({ item, direct, baseline, via: [...new Set(via)] });
  }
  return sources;
}

function renderStatistics(allItems, scopedItems) {
  const stats = calculateStatistics(gameData, userState, scopedItems);
  const overview = stats.overview;
  const distributionMode = userState.settings.statisticsGrouping || 'profession';
  const distributionRows = Object.entries(stats.distributions[distributionMode] || {});
  const maxOwned = Math.max(1, ...distributionRows.map(([, value]) => value.owned));
  const distributionTitle = ({ profession: '职业', subprofession: '分支职业', rarity: '星级' })[distributionMode];
  const materialSummary = computeMaterialSummary(stats.plan.items, userState.inventory, gameData);
  const materialPlanRows = materialSummary.rows.filter((row) => row.required > 0);
  const coveredMaterialTypes = materialPlanRows.filter((row) => row.shortage === 0).length;
  const expStock = Object.entries(gameData.EXP_ITEMS || {}).reduce((sum, [name, value]) => sum + (userState.inventory[name] || 0) * value, 0);
  const lmdStock = userState.inventory.龙门币 || 0;
  const hasScopedPlan = stats.plan.items.length > 0;
  const expCoverage = stats.plan.totalExp ? Math.min(1, expStock / stats.plan.totalExp) : 0;
  const lmdCoverage = stats.plan.totalLmd ? Math.min(1, lmdStock / stats.plan.totalLmd) : 0;
  const materialCoverage = materialPlanRows.length ? coveredMaterialTypes / materialPlanRows.length : 0;
  const emptyScopeText = '本次未选择强化项';
  const expRanking = [...stats.operatorInvestments].sort((a, b) => b.exp - a.exp || b.lmd - a.lmd).slice(0, 6);
  return `
    ${renderViewIntro('账号养成统计', '汇总当前养成状态、培养分布、理论投入与计划覆盖情况。', overview.owned, 'OWNED OPERATORS')}
    <div class="statistics-note">理论投入根据当前养成状态反推，不代表游戏内的实际消费记录。</div>
    <div class="stat-card-grid">
      ${statCard('OWNED', overview.owned, '已拥有干员')}
      ${statCard('ELITE 2', overview.elite2, `${Math.round(overview.elite2Ratio * 100)}% 精二率`)}
      ${statCard('SKILL 7', overview.skill7, '技能等级 7')}
      ${statCard('POTENTIAL 6', overview.maxPotential, '满潜干员')}
      ${statCard('MASTERY', overview.masteryStages, '累计专精阶段')}
      ${statCard('MODULE', overview.unlockedModules, `${overview.level3Modules} 个三级模组`)}
      ${statCard('INVESTED LMD', formatNumber(stats.invested.totalLmd), '理论已投入')}
      ${statCard('PLAN LMD', formatNumber(stats.plan.totalLmd), '当前目标仍需')}
    </div>
    <div class="stats-columns">
      <section class="panel-card"><div class="panel-heading"><h2>${distributionTitle}养成分布</h2><label class="field"><span>观察维度</span><select id="statistics-grouping">${selectOptions(['profession', 'subprofession', 'rarity'], distributionMode, (value) => ({ profession: '按职业', subprofession: '按分支职业', rarity: '按星级' })[value])}</select></label></div><div class="distribution-list">
        ${distributionRows.length ? distributionRows.map(([name, value]) => `<div class="distribution-row"><b>${escapeHtml(name)}</b><div class="bar-track"><i style="width:${Math.max(4, value.owned / maxOwned * 100)}%"></i></div><span>${value.elite2}/${value.owned} 精二 · ${value.planned} 计划中</span></div>`).join('') : '<p>还没有已拥有干员。</p>'}
      </div></section>
      <section class="panel-card"><h2>养成阶段</h2>
        <div class="progress-stat-group"><h3>精英阶段</h3><div class="progress-stat-grid">${[['e0','未精英'],['e1','精英一'],['e2','精英二']].map(([key, label]) => `<div><b>${stats.progress.eliteStages[key]}</b><span>${label}</span></div>`).join('')}</div></div>
        <div class="progress-stat-group"><h3>专精技能</h3><div class="progress-stat-grid progress-stat-grid--four">${[['m0','未专精'],['m1','专精一'],['m2','专精二'],['m3','专精三']].map(([key, label]) => `<div><b>${stats.progress.masterySkills[key]}</b><span>${label}</span></div>`).join('')}</div></div>
        <div class="plan-operator-count"><b>${stats.progress.plannedOperators}</b><span>名干员有培养计划</span></div>
      </section>
    </div>
    <section class="panel-card stats-section"><h2>计划覆盖情况</h2><div class="coverage-grid">
      ${renderCoverageRow('普通与特殊材料', materialCoverage, hasScopedPlan ? `${coveredMaterialTypes}/${materialPlanRows.length} 种已足量` : emptyScopeText)}
      ${renderCoverageRow('作战记录', expCoverage, hasScopedPlan ? `库存 ${formatNumber(expStock)} / 需要 ${formatNumber(stats.plan.totalExp)} EXP` : emptyScopeText)}
      ${renderCoverageRow('龙门币', lmdCoverage, hasScopedPlan ? `库存 ${formatNumber(lmdStock)} / 需要 ${formatNumber(stats.plan.totalLmd)}` : emptyScopeText)}
    </div></section>
    <div class="stats-columns stats-section">
      <section class="panel-card"><h2>理论投入 · 龙门币</h2><div class="ranking-list">
        ${stats.operatorInvestments.slice(0, 10).map((row, index) => `<div class="ranking-row"><span>${String(index + 1).padStart(2, '0')}</span><span><b>${escapeHtml(row.name)}</b><small>${escapeHtml(row.profession)} · ${row.rarity}★ · ${row.upgradeItems} 项</small></span><strong>LMD ${formatNumber(row.lmd)}</strong></div>`).join('') || '<p>还没有可统计的养成状态。</p>'}
      </div></section>
      <section class="panel-card"><h2>理论投入 · 经验</h2><div class="ranking-list">
        ${expRanking.map((row, index) => `<div class="ranking-row"><span>${String(index + 1).padStart(2, '0')}</span><span><b>${escapeHtml(row.name)}</b><small>${escapeHtml(row.profession)} · ${row.rarity}★</small></span><strong>EXP ${formatNumber(row.exp)}</strong></div>`).join('') || '<p>还没有可统计的养成状态。</p>'}
      </div></section>
    </div>
    <section class="panel-card stats-section"><h2>理论投入与未来计划</h2>
      <div class="summary-strip" style="margin:0">
        ${summaryCell('INVESTED EXP', formatNumber(stats.invested.totalExp), '根据当前状态反推')}
        ${summaryCell('INVESTED ITEMS', stats.invested.items.length, '已完成强化项')}
        ${summaryCell('PLAN EXP', formatNumber(stats.plan.totalExp), '从当前到目标')}
        ${summaryCell('PLAN ITEMS', stats.plan.items.length, '未来强化项')}
      </div>
    </section>
    <div class="stats-columns stats-section">
      ${renderMaterialRanking('理论投入最多的材料', stats.invested.materialRanking)}
      ${renderMaterialRanking('培养计划需求最多的材料', stats.plan.materialRanking)}
    </div>
  `;
}

function renderCoverageRow(label, ratio, detail) {
  const percentage = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return `<div class="coverage-row"><div><b>${escapeHtml(label)}</b><strong>${percentage}%</strong></div><div class="coverage-track"><i style="width:${percentage}%"></i></div><span>${escapeHtml(detail)}</span></div>`;
}

function renderMaterialRanking(title, rows) {
  return `<section class="panel-card"><h2>${escapeHtml(title)}</h2><div class="material-ranking">${rows.slice(0, 10).map((row, index) => `<div><span>${String(index + 1).padStart(2, '0')}</span>${materialIcon(row.name, gameData, { size: 'sm' })}<b>${escapeHtml(row.name)}</b><strong>×${formatNumber(row.qty)}</strong></div>`).join('') || '<p>暂无材料记录。</p>'}</div></section>`;
}

function renderViewIntro(title, body, value, label) {
  return `<section class="view-intro"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div><div class="view-intro__stat"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div></section>`;
}

function sectionIndex(code, label, count, tone = 'slate') {
  return `<header class="section-index section-index--${tone}"><span class="section-index__code">${escapeHtml(code)}</span><h2>${escapeHtml(label)}</h2><small>${count} ITEMS</small></header>`;
}

function summaryCell(label, value, note, state = '') {
  return `<div class="summary-cell"><small>${escapeHtml(label)}</small><strong class="${state === 'danger' ? 'is-danger' : ''}">${escapeHtml(value)}</strong><p>${escapeHtml(note)}</p></div>`;
}

function statCard(label, value, note) {
  return `<div class="stat-card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><p>${escapeHtml(note)}</p></div>`;
}

function renderOperatorDrawer(operatorName) {
  const operator = gameData.OPS[operatorName];
  if (!operator) return '';
  const progress = getProgress(operatorName);
  const items = buildOperatorUpgradeItems(operatorName, operator, progress, gameData);
  const resourceFree = isResourceFreeCultivationOperator(operator);
  const maxLevels = gameData.MAX_LV[operator.r] || {};
  const eliteValues = [0, 1, 2].filter((elite) => maxLevels[`e${elite}`]);
  const currentMax = maxLevels[`e${progress.current.elite}`] || 1;
  const targetMax = maxLevels[`e${progress.target.elite}`] || 1;

  return `
    <div class="drawer-backdrop" data-action="close-drawer">
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" data-drawer-panel>
        <header class="drawer__header"><div><p>${operator.p} / ${operator.r + 1} STAR OPERATOR</p><h2 id="drawer-title">${escapeHtml(operatorName)}</h2></div><button class="icon-button" type="button" data-action="close-drawer" aria-label="关闭">×</button></header>
        <div class="drawer__body">
          <div class="owned-toggle"><div><b>我拥有这名干员</b><small>未拥有的干员仍可浏览，但不会进入账号统计。</small></div><label class="field potential-field"><span>潜能</span><select data-action="potential-change" data-operator="${encoded(operatorName)}">${selectOptions([0,1,2,3,4,5,6], progress.potential, (value) => value ? `潜能 ${value}` : '未记录')}</select></label><label class="switch"><input type="checkbox" ${progress.owned ? 'checked' : ''} data-action="toggle-owned" data-operator="${encoded(operatorName)}"><span></span></label></div>
          <div class="progress-grid">
            ${renderProgressPanel('current', '目前状态', progress.current, eliteValues, currentMax, operatorName)}
            ${renderProgressPanel('target', '目标状态', progress.target, eliteValues, targetMax, operatorName)}
          </div>
          ${(operator.md || []).length ? `<div class="module-progress"><span class="progress-subtitle">MODULE / 模组状态</span>${operator.md.map((module) => renderModuleProgress(operatorName, module, progress)).join('')}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end"><button class="button button--quiet" type="button" data-action="target-current" data-operator="${encoded(operatorName)}">目标设为当前</button><button class="button button--signal" type="button" data-action="target-max" data-operator="${encoded(operatorName)}">目标设为全满</button></div>
          <section class="drawer-plan"><h3>从当前到目标 · ${items.length} 项</h3>${items.length ? `<div class="plan-operator"><div class="upgrade-list">${renderUpgradeItems(items)}</div></div>` : resourceFree ? emptyState('特殊养成', '该干员可以记录养成状态，但不会产生材料、经验或龙门币需求。') : emptyState('当前状态已达到目标', '调整目标后，这里会显示新增的强化项。')}</section>
        </div>
      </aside>
    </div>
  `;
}

function renderProgressPanel(scope, title, state, eliteValues, maxLevel, operatorName) {
  const encodedName = encoded(operatorName);
  return `
    <section class="progress-panel">
      <h3>${title}<small>${scope.toUpperCase()}</small></h3>
      <div class="form-grid">
        <label class="field"><span>精英阶段</span><select data-action="progress-change" data-operator="${encodedName}" data-scope="${scope}" data-field="elite">${selectOptions(eliteValues, state.elite, (value) => `精英 ${value}`)}</select></label>
        <label class="field"><span>等级 / ${maxLevel}</span><input type="number" min="1" max="${maxLevel}" value="${state.level}" data-action="progress-change" data-operator="${encodedName}" data-scope="${scope}" data-field="level"></label>
        <label class="field" style="grid-column:1/-1"><span>技能等级</span><select data-action="progress-change" data-operator="${encodedName}" data-scope="${scope}" data-field="skillLevel">${selectOptions([1,2,3,4,5,6,7], state.skillLevel, (value) => `技能 ${value}`)}</select></label>
      </div>
      <p class="progress-subtitle">MASTERY / 专精阶段</p>
      <div class="triple-select">${['s1','s2','s3'].map((skill, index) => `<label class="field"><span>S${index + 1}</span><select data-action="progress-change" data-operator="${encodedName}" data-scope="${scope}" data-field="mastery" data-key="${skill}">${selectOptions([0,1,2,3], state.mastery[skill], (value) => value ? `专 ${value}` : '未专精')}</select></label>`).join('')}</div>
    </section>
  `;
}

function renderModuleProgress(operatorName, module, progress) {
  const key = String(module.id || module.name);
  const current = progress.current.modules[key] || 0;
  const target = progress.target.modules[key] || 0;
  const stages = [0, ...(module.stages || []).map((stage) => stage.stage)];
  return `<div class="module-row"><b>${escapeHtml(module.name)}</b><select aria-label="${escapeHtml(module.name)}当前等级" data-action="progress-change" data-operator="${encoded(operatorName)}" data-scope="current" data-field="module" data-key="${encoded(key)}">${selectOptions(stages, current, (value) => value ? `${value}级` : '未解锁')}</select><span>→</span><select aria-label="${escapeHtml(module.name)}目标等级" data-action="progress-change" data-operator="${encoded(operatorName)}" data-scope="target" data-field="module" data-key="${encoded(key)}">${selectOptions(stages, target, (value) => value ? `${value}级` : '未解锁')}</select></div>`;
}

function openOperator(operatorName) {
  selectedOperator = operatorName;
  $('#drawer-root').innerHTML = renderOperatorDrawer(operatorName);
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  selectedOperator = null;
  $('#drawer-root').innerHTML = '';
  document.body.style.overflow = '';
}

function rerenderAfterProgressChange() {
  persist();
  render();
  if (selectedOperator) $('#drawer-root').innerHTML = renderOperatorDrawer(selectedOperator);
}

function updateProgress(control) {
  const operatorName = decoded(control.dataset.operator);
  const operator = gameData.OPS[operatorName];
  const progress = getProgress(operatorName);
  const scope = control.dataset.scope;
  const field = control.dataset.field;
  const value = Math.max(0, Number(control.value) || 0);
  progress.owned = true;

  if (field === 'mastery') progress[scope].mastery[control.dataset.key] = value;
  else if (field === 'module') progress[scope].modules[decoded(control.dataset.key)] = value;
  else progress[scope][field] = value;

  userState.operators[operatorName] = normalizeOperatorProgress(progress, operator, gameData);
  rerenderAfterProgressChange();
}

function setTarget(operatorName, mode) {
  const operator = gameData.OPS[operatorName];
  const progress = getProgress(operatorName);
  progress.owned = true;
  if (mode === 'current') {
    progress.target = JSON.parse(JSON.stringify(progress.current));
  } else {
    const maxLevels = gameData.MAX_LV[operator.r] || {};
    const maxElite = maxLevels.e2 ? 2 : maxLevels.e1 ? 1 : 0;
    progress.target = {
      elite: maxElite,
      level: maxLevels[`e${maxElite}`] || 1,
      skillLevel: (operator.sl || []).length ? 7 : progress.current.skillLevel,
      mastery: Object.fromEntries(['s1','s2','s3'].map((skill) => [skill, (operator.ms?.[skill] || []).length ? Math.max(...operator.ms[skill].map((stage) => stage.stage)) : 0])),
      modules: Object.fromEntries((operator.md || []).map((module) => [String(module.id || module.name), Math.max(...module.stages.map((stage) => stage.stage))]))
    };
  }
  userState.operators[operatorName] = normalizeOperatorProgress(progress, operator, gameData);
  rerenderAfterProgressChange();
}

function openMaterialSources(name) {
  const sources = materialSources(name, selectedPlanItems());
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true">
      <header class="modal__header"><h2>${escapeHtml(name)} · 材料来源</h2><button class="icon-button" type="button" data-action="close-modal">×</button></header>
      <div class="modal__body">${sources.length ? `<div class="ranking-list">${sources.map((source, index) => `<div class="ranking-row"><span>${String(index + 1).padStart(2,'0')}</span><span><b>${escapeHtml(source.item.operatorName)} · ${escapeHtml(source.item.label)}</b><small>${source.direct ? `直接 ×${source.direct}` : `经 ${source.via.join('、')} 分解`}</small></span><strong>×${source.baseline || source.direct}</strong></div>`).join('')}</div>` : '<p>当前计划中没有这个材料的直接或间接来源。</p>'}</div>
      <footer class="modal__actions"><button class="button button--dark" type="button" data-action="close-modal">关闭</button></footer>
    </section></div>`;
}

function confirmClearInventory() {
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true">
      <header class="modal__header"><h2>清空全部库存？</h2><button class="icon-button" type="button" data-action="close-modal">×</button></header>
      <div class="modal__body"><p>所有材料数量会归零。执行前会自动保存一份本机备份，可以通过之后的恢复功能取回。</p></div>
      <footer class="modal__actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button button--danger" type="button" data-action="clear-inventory">确认清空</button></footer>
    </section></div>`;
}

function openImportMenu() {
  const backup = loadBackup(localStorage, gameData);
  const createdAt = backup?.createdAt ? new Date(backup.createdAt).toLocaleString('zh-CN') : '时间未知';
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="close-modal"><section class="modal modal--import" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
      <header class="modal__header"><h2 id="import-dialog-title">导入数据</h2><button class="icon-button" type="button" data-action="close-modal" aria-label="关闭">×</button></header>
      <div class="modal__body">
        <p>粘贴 MAA 干员识别结果，即可检查并导入。也支持本工具导出的备份 JSON。</p>
        <label class="import-json-field" for="import-json">
          <span>MAA 识别结果 / JSON</span>
          <textarea id="import-json" spellcheck="false" autocomplete="off" placeholder="在此粘贴包含 all_opers 或 own_opers 的 MAA 识别结果…"></textarea>
          <small>粘贴后点击“预览导入”，或按 Ctrl + Enter。</small>
        </label>
        ${backup ? `<div class="restore-card"><span><b>最近自动备份</b><small>${escapeHtml(createdAt)}</small></span><button class="button button--quiet" type="button" data-action="preview-last-backup">预览恢复</button></div>` : ''}
      </div>
      <footer class="modal__actions modal__actions--split">
        <button class="button" type="button" data-action="select-import-file">选择 JSON 文件</button>
        <span><button class="button" type="button" data-action="close-modal">取消</button><button class="button button--dark" type="button" data-action="preview-pasted-import">预览导入</button></span>
      </footer>
    </section></div>`;
  requestAnimationFrame(() => $('#import-json')?.focus());
}

function previewPastedImport() {
  const input = $('#import-json');
  const text = input?.value.trim() || '';
  if (!text) {
    showToast('请先粘贴 MAA 干员识别结果。', true);
    input?.focus();
    return;
  }
  try {
    previewImportText(text);
  } catch (error) {
    showToast(error.message || '无法识别粘贴的数据。', true);
    input?.focus();
  }
}

function previewLastBackup() {
  const backup = loadBackup(localStorage, gameData);
  if (!backup) {
    closeModal();
    showToast('没有可恢复的自动备份。', true);
    return;
  }
  previewProjectImport(backup.state);
}

function exportBackup() {
  const backup = createProjectExport(userState);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `arknights-material-plan-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('备份已导出，包含当前状态、目标状态和库存。');
}

function previewProjectImport(state) {
  pendingImport = state;
  pendingImportKind = 'project';
  const owned = Object.values(state.operators).filter((progress) => progress.owned).length;
  const planned = buildPlanUpgradeItems(gameData, state).length;
  const stocked = Object.values(state.inventory).filter((qty) => qty > 0).length;
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true">
      <header class="modal__header"><h2>导入预览</h2><button class="icon-button" type="button" data-action="close-modal">×</button></header>
      <div class="modal__body"><p>数据格式与版本校验通过。合并会用导入数据中的同名记录覆盖本机记录；替换会先自动备份，再完整恢复这份数据。</p>
        <div class="import-summary"><div><b>${owned}</b><small>拥有干员</small></div><div><b>${planned}</b><small>培养项目</small></div><div><b>${stocked}</b><small>有库存资源</small></div></div>
      </div>
      <footer class="modal__actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button" type="button" data-action="apply-import" data-mode="merge">合并</button><button class="button button--dark" type="button" data-action="apply-import" data-mode="replace">替换全部</button></footer>
    </section></div>`;
}

function previewMaaImport(imported) {
  pendingImport = imported;
  pendingImportKind = 'maa';
  const entries = Object.values(imported.operators || {});
  const owned = entries.filter((progress) => progress.owned).length;
  const unknown = imported.unknown || [];
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true">
      <header class="modal__header"><h2>MAA 干员识别导入</h2><button class="icon-button" type="button" data-action="close-modal">×</button></header>
      <div class="modal__body">
        <p>已识别 MAA 的干员列表。将导入拥有状态、精英阶段、等级和潜能；MAA 当前不提供技能等级、专精和模组信息，因此这些字段以及本工具中的目标状态都会保留。</p>
        <div class="import-summary"><div><b>${entries.length}</b><small>匹配干员</small></div><div><b>${owned}</b><small>拥有干员</small></div><div><b>${unknown.length}</b><small>未匹配记录</small></div></div>
        ${unknown.length ? `<div class="import-warning"><b>未匹配：</b>${unknown.slice(0, 8).map((item) => escapeHtml(item.name || item.id || '未知')).join('、')}${unknown.length > 8 ? ` 等 ${unknown.length} 项` : ''}</div>` : ''}
        <p class="modal-note">“合并”只更新文件中出现的干员；“替换拥有列表”会把未出现在 MAA 拥有列表中的本机干员标记为未拥有，但不会删除培养目标。</p>
      </div>
      <footer class="modal__actions"><button class="button" type="button" data-action="close-modal">取消</button><button class="button" type="button" data-action="apply-import" data-mode="merge">合并</button><button class="button button--dark" type="button" data-action="apply-import" data-mode="replace">替换拥有列表</button></footer>
    </section></div>`;
}

function previewImportText(text) {
  try {
    previewProjectImport(parseProjectImport(text, gameData));
    return;
  } catch (projectError) {
    try {
      previewMaaImport(parseMaaOperatorExport(text, gameData));
      return;
    } catch (maaError) {
      throw new Error(`无法识别导入内容。项目备份：${projectError.message}；MAA：${maaError.message}`);
    }
  }
}

function applyImport(mode) {
  if (!pendingImport) return;
  createBackup(localStorage, userState);
  if (pendingImportKind === 'maa') {
    userState = applyMaaOperatorImport(userState, pendingImport, mode, gameData);
  } else if (mode === 'replace') {
    userState = normalizeUserState(pendingImport, gameData);
  } else {
    userState = mergeProjectImport(userState, pendingImport, gameData);
  }
  pendingImport = null;
  pendingImportKind = null;
  $('#modal-root').innerHTML = '';
  persist('数据已导入，替换前的状态已自动备份。');
  render();
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  pendingImport = null;
  pendingImportKind = null;
}

function handleClick(event) {
  const button = event.target.closest('[data-action], [data-view]');
  if (!button) return;

  if (button.dataset.view && !button.dataset.action) {
    currentView = button.dataset.view;
    userState.settings.activeView = currentView;
    persist();
    render();
    window.scrollTo(0, 0);
    $('#workspace').focus();
    return;
  }

  const action = button.dataset.action;
  if (action === 'go-view') {
    currentView = button.dataset.view;
    render();
    window.scrollTo(0, 0);
  }
  if (action === 'dismiss-onboarding') {
    userState.settings.onboardingDismissed = true;
    persist();
    render();
  }
  if (action === 'toggle-operator-filter') {
    const key = button.dataset.filter;
    const value = decoded(button.dataset.value);
    const selected = filterValues(key);
    filters[key] = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    render();
  }
  if (action === 'clear-operator-filter') {
    filters[button.dataset.filter] = [];
    render();
  }
  if (action === 'set-operator-scope') {
    filters.operatorScope = button.dataset.scope;
    render();
  }
  if (action === 'reset-operator-filters') {
    filters.operatorSearch = '';
    filters.professions = [];
    filters.subprofessions = [];
    filters.positions = [];
    filters.rarities = [];
    filters.operatorScope = 'all';
    render();
  }
  if (action === 'apply-plan-preset') {
    const items = allPlanItems();
    userState.settings.planSelection = applyPlanSelectionPreset(
      userState.settings.planSelection,
      button.dataset.preset,
      items,
      gameData,
      userState
    );
    persist();
    render();
    $(`[data-action="apply-plan-preset"][data-preset="${button.dataset.preset}"]`)?.focus();
  }
  if (action === 'open-operator') openOperator(decoded(button.dataset.operator));
  if (action === 'close-drawer' && (event.target === button || button.matches('.icon-button'))) closeDrawer();
  if (action === 'target-current') setTarget(decoded(button.dataset.operator), 'current');
  if (action === 'target-max') setTarget(decoded(button.dataset.operator), 'max');
  if (action === 'show-material-sources') openMaterialSources(decoded(button.dataset.material));
  if (action === 'confirm-clear-inventory') confirmClearInventory();
  if (action === 'clear-inventory') {
    createBackup(localStorage, userState);
    userState.inventory = {};
    closeModal();
    persist('库存已清空，原数据已自动备份。');
    render();
  }
  if (action === 'close-modal' && (event.target === button || button.matches('.button, .icon-button'))) closeModal();
  if (action === 'apply-import') applyImport(button.dataset.mode);
  if (action === 'preview-pasted-import') previewPastedImport();
  if (action === 'select-import-file') {
    closeModal();
    $('#import-file').click();
  }
  if (action === 'preview-last-backup') previewLastBackup();
}

function handleInput(event) {
  const control = event.target;
  if (control.id === 'operator-search') {
    filters.operatorSearch = control.value.trim();
    render();
    const replacement = $('#operator-search');
    replacement?.focus();
    replacement?.setSelectionRange(replacement.value.length, replacement.value.length);
  }
  if (control.id === 'inventory-search') {
    filters.inventorySearch = control.value.trim();
    render();
    const replacement = $('#inventory-search');
    replacement?.focus();
    replacement?.setSelectionRange(replacement.value.length, replacement.value.length);
  }
  if (control.dataset.action === 'inventory-change') {
    const material = decoded(control.dataset.material);
    userState.inventory[material] = Math.max(0, Math.floor(Number(control.value) || 0));
    persist();
    const items = allPlanItems();
    renderShellCounts(items, selectedPlanItems(items));
  }
}

function handleChange(event) {
  const control = event.target;
  if (control.id === 'operator-scope') {
    filters.operatorScope = control.value;
    render();
  }
  if (control.id === 'operator-rarity') {
    filters.rarity = control.value;
    render();
  }
  if (control.id === 'operator-subprofession') {
    filters.subprofession = control.value;
    render();
  }
  if (control.id === 'operator-position') {
    filters.position = control.value;
    render();
  }
  if (control.id === 'material-grouping') {
    userState.settings.materialGrouping = control.value;
    persist();
    render();
  }
  if (control.id === 'gap-grouping') {
    userState.settings.gapGrouping = control.value;
    persist();
    render();
  }
  if (control.id === 'material-display') {
    userState.settings.materialDisplay = control.value;
    persist();
    render();
  }
  if (control.id === 'statistics-grouping') {
    userState.settings.statisticsGrouping = control.value;
    persist();
    render();
  }
  if (control.dataset.action === 'plan-operator-selection') {
    const items = allPlanItems();
    userState.settings.planSelection = setPlanOperatorSelected(
      userState.settings.planSelection,
      decoded(control.dataset.operator),
      items,
      control.checked,
      gameData,
      userState
    );
    persist();
    render();
    restorePlanSelectionFocus(decoded(control.dataset.operator));
  }
  if (control.dataset.action === 'plan-item-selection') {
    const items = allPlanItems();
    const operatorName = decoded(control.dataset.operator);
    const key = decoded(control.dataset.key);
    const item = items.find((entry) => entry.operatorName === operatorName && entry.key === key);
    if (item) {
      userState.settings.planSelection = setPlanItemSelected(
        userState.settings.planSelection,
        item,
        items,
        control.checked,
        gameData,
        userState
      );
      persist();
      render();
      restorePlanSelectionFocus(operatorName, key);
    }
  }
  if (control.dataset.action === 'progress-change') updateProgress(control);
  if (control.dataset.action === 'toggle-owned') {
    const operatorName = decoded(control.dataset.operator);
    const progress = getProgress(operatorName);
    progress.owned = control.checked;
    userState.operators[operatorName] = progress;
    rerenderAfterProgressChange();
  }
  if (control.dataset.action === 'potential-change') {
    const operatorName = decoded(control.dataset.operator);
    const progress = getProgress(operatorName);
    progress.potential = Math.max(0, Math.min(6, Number(control.value) || 0));
    progress.owned = true;
    userState.operators[operatorName] = progress;
    rerenderAfterProgressChange();
  }
  if (control.id === 'import-file' && control.files?.[0]) {
    const file = control.files[0];
    file.text().then(previewImportText).catch((error) => showToast(error.message || '导入文件无法读取。', true));
    control.value = '';
  }
}

function handleToggle(event) {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.matches('.plan-operator[data-operator]')) return;
  const operatorName = decoded(details.dataset.operator);
  if (details.open) openPlanOperators.add(operatorName);
  else openPlanOperators.delete(operatorName);
}

async function init() {
  try {
    const loadedData = await loadGameData();
    gameData = loadedData.data;
    const loaded = loadUserState(localStorage, gameData);
    userState = loaded.state;
    currentView = VIEW_META[userState.settings.activeView] ? userState.settings.activeView : 'operators';

    const dataVersion = loadedData.manifest?.dataVersion || String(gameData.generatedAt || '').slice(0, 10) || 'LOCAL';
    $('#data-version').textContent = `DATA ${dataVersion}`;
    $('#data-count').textContent = `${gameData.OPS_ORDER.length} 名干员 / ${Object.keys(gameData.MAT_RARITY).length} 种资源`;
    $('#data-status-dot').title = loadedData.source === 'cache-offline' ? '离线使用最近一次缓存数据' : '已检查并载入最新发布数据';
    $('#boot-screen').hidden = true;
    $('#app-shell').hidden = false;

    document.addEventListener('click', handleClick);
    document.addEventListener('input', handleInput);
    document.addEventListener('change', handleChange);
    document.addEventListener('toggle', handleToggle, true);
    $('#import-button').addEventListener('click', openImportMenu);
    $('#export-button').addEventListener('click', exportBackup);
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.id === 'import-json') {
        event.preventDefault();
        previewPastedImport();
        return;
      }
      if (event.key === 'Escape') {
        if ($('#modal-root').children.length) closeModal();
        else if (selectedOperator) closeDrawer();
      }
    });

    render();
    if (loaded.migrated) showToast('已从旧版页面迁移培养计划和库存，原数据仍保留。');
    else if (loadedData.source === 'cache-offline') showToast('网络不可用，正在使用最近一次缓存的数据。');
  } catch (error) {
    $('#boot-screen').innerHTML = `<div class="empty-state"><div class="empty-state__mark">!</div><h2>数据无法载入</h2><p>${escapeHtml(error.message)}</p><p>请通过本地服务器或 GitHub Pages 打开新版入口。</p></div>`;
  }
}

init();
