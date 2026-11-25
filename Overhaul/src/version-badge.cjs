'use strict';

function installModBadge(version) {
  const badgeId = 'rlc-modding-version-label';
  if (window.__rlcModBadgeVersion === version) return 'already-installed';
  const badge = document.createElement('div');
  badge.id = badgeId;
  const hubLabel = '.version-label:not(.mod-version-label):not(#' + badgeId + ')';
  let queued = false;
  function updateBadge() {
    queued = false;
    const hub = document.querySelector(hubLabel);
    const modifier = document.querySelector('.mod-version-label');
    const text = 'Overhaul v' + version;
    if (badge.textContent !== text) badge.textContent = text;
    const classes = 'version-label' + (hub?.classList.contains('version-label-frameless') ? ' version-label-frameless' : '');
    if (badge.className !== classes) badge.className = classes;
    const boxes = [hub, modifier].map(label => label?.getBoundingClientRect()).filter(box => box?.height);
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
