const CONTROL_IDENTITY_KEYS = ['action', 'operator', 'scope', 'field', 'key'];

function controlIdentity(control) {
  if (!control?.dataset?.action) return null;
  return Object.fromEntries(
    CONTROL_IDENTITY_KEYS
      .filter((key) => control.dataset[key] !== undefined)
      .map((key) => [key, control.dataset[key]])
  );
}

function findMatchingControl(drawer, identity) {
  if (!identity) return null;
  return [...drawer.querySelectorAll('[data-action]')].find((control) => (
    Object.entries(identity).every(([key, value]) => control.dataset?.[key] === value)
  )) || null;
}

export function replaceDrawerBody(drawer, html, activeControl = null) {
  const body = drawer?.querySelector('.drawer__body');
  if (!body) return false;

  const scrollTop = drawer.scrollTop;
  const identity = controlIdentity(activeControl);
  body.innerHTML = html;
  drawer.scrollTop = scrollTop;
  findMatchingControl(drawer, identity)?.focus({ preventScroll: true });
  return true;
}
