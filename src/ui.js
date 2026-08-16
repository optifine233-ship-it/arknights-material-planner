import { getMaterialCategory, getMaterialIconText } from './materials.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function materialIcon(name, gameData, options = {}) {
  const meta = gameData.MATERIAL_META?.[name] || {};
  const size = options.size || 'md';
  const category = getMaterialCategory(name);
  const image = meta.icon
    ? `<img src="${escapeHtml(meta.icon)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  return `<span class="material-icon material-icon--${category} material-icon--${size}" aria-hidden="true">${image}<span>${escapeHtml(getMaterialIconText(name))}</span></span>`;
}

export function operatorPortrait(name, operator) {
  const image = operator.portrait
    ? `<img src="${escapeHtml(operator.portrait)}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.remove();this.parentElement.classList.add('portrait--fallback')">`
    : '';
  return `<div class="operator-portrait ${image ? '' : 'portrait--fallback'}">${image}<span>${escapeHtml(operator.p || '?')}</span></div>`;
}

export function emptyState(title, body, action = '') {
  return `<div class="empty-state"><div class="empty-state__mark">//</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${action}</div>`;
}

export function selectOptions(values, selected, labeler = (value) => value) {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(labeler(value))}</option>`).join('');
}
