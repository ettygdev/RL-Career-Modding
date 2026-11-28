'use strict';

function installModBadge(version, modifierExpected, modifierVersion) {
  const badgeId = 'rlc-modding-version-label';
  if (window.__rlcModBadgeVersion === version) return 'already-installed';
  const badge = document.createElement('div');
  badge.id = badgeId;
  const hubLabel = '.version-label:not(.mod-version-label):not(#' + badgeId + ')';
  const style = document.createElement('style');
  style.textContent = 'html.rlc-combined-version .mod-version-label{display:none!important}';
  document.head.appendChild(style);
  let queued = false;
  function updateBadge() {
    queued = false;
    const hub = document.querySelector(hubLabel);
    const modifier = document.querySelector('.mod-version-label');
    const combined = Boolean(modifierExpected && (window.__btierUI || modifier));
    const loaded = modifier?.textContent?.match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1] || modifierVersion;
    document.documentElement.classList.toggle('rlc-combined-version', combined);
    const text = 'Overhaul v' + version + (combined ? ' + Modifier v' + (loaded || '?') : '');
    if (badge.textContent !== text) badge.textContent = text;
    const classes = 'version-label' + (hub?.classList.contains('version-label-frameless') ? ' version-label-frameless' : '');
    if (badge.className !== classes) badge.className = classes;
    const boxes = [hub, combined ? null : modifier].map(label => label?.getBoundingClientRect()).filter(box => box?.height);
    const bottom = Math.max(0, ...boxes.map(box => box.bottom));
    const top = bottom ? Math.ceil(bottom) + 4 + 'px' : badge.style.top || '34px';
    if (badge.style.top !== top) badge.style.top = top;
    if (!badge.isConnected) document.body.appendChild(badge);
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(updateBadge);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class']
  });
  window.addEventListener('resize', schedule);
  window.__rlcModBadgeVersion = version;
  updateBadge();
  return 'installed';
}

module.exports = { installModBadge };
