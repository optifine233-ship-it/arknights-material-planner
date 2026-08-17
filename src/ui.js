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
  const tier = gameData.MAT_RARITY?.[name] ?? 0;
  const stableIcon = meta.iconId
    ? `https://torappu.prts.wiki/assets/item_icon/${encodeURIComponent(meta.iconId)}.png`
    : '';
  const primaryIcon = stableIcon || meta.icon || '';
  const fallbackCandidate = meta.iconFallback || meta.icon || '';
  const fallbackIcon = stableIcon && fallbackCandidate && fallbackCandidate !== stableIcon ? fallbackCandidate : '';
  const image = primaryIcon
    ? `<img src="${escapeHtml(primaryIcon)}"${fallbackIcon ? ` data-fallback="${escapeHtml(fallbackIcon)}"` : ''} alt="" loading="lazy" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback=''}else{this.remove()}">`
    : '';
  return `<span class="material-icon material-icon--${category} material-icon--tier-${tier} material-icon--${size}" aria-hidden="true">${image}<span>${escapeHtml(getMaterialIconText(name))}</span></span>`;
}

export function operatorPortrait(name, operator) {
  const image = operator.portrait
    ? `<img src="${escapeHtml(operator.portrait)}" alt="${escapeHtml(name)}" loading="lazy" onerror="const frame=this.parentElement;this.remove();frame?.classList.add('portrait--fallback')">`
    : '';
  return `<div class="operator-portrait ${image ? '' : 'portrait--fallback'}">${image}<span>${escapeHtml(operator.p || '?')}</span></div>`;
}

export function emptyState(title, body, action = '') {
  return `<div class="empty-state"><div class="empty-state__mark">//</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${action}</div>`;
}

export function selectOptions(values, selected, labeler = (value) => value) {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(labeler(value))}</option>`).join('');
}
