'use strict';

async function loadFeatureGroups(groups, modifierLoaded) {
  for (const group of groups) {
    if (modifierLoaded && group.conflictsWithModifier) continue;
    if (group.requiresModifier && (!modifierLoaded || !group.isAvailable?.())) continue;
    const status = await group.install();
    if (status !== 'installed' && status !== 'already-installed') return status;
  }
  return modifierLoaded ? 'ready-with-modifier' : 'installed';
}

module.exports = { loadFeatureGroups };
