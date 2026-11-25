'use strict';

function compareVersions(a, b) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || '')?.slice(1).map(Number);
  const left = parse(a), right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

async function latestCareerRelease(fetcher = fetch, readPrivateRelease) {
  const endpoint = 'https://api.github.com/repos/ettygdev/RL-Career-Modding/releases/latest';
  try {
    const response = await fetcher(endpoint, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RLCareer-Overhaul' },
      signal: AbortSignal.timeout(3500)
    });
    if (response.ok) {
      const tag = (await response.json()).tag_name;
      if (/^v?\d+\.\d+\.\d+$/.test(tag)) return tag.replace(/^v/, '');
    }
  } catch { /* A private repository or unavailable network may require GitHub CLI. */ }
  try {
    const tag = await readPrivateRelease?.();
    if (/^v?\d+\.\d+\.\d+$/.test(tag)) return tag.replace(/^v/, '');
  } catch { /* Offline launch remains available. */ }
  return null;
}

function modifierFileVersion(bytes, inflate) {
  const end = bytes.lastIndexOf(Buffer.from([80, 75, 5, 6]));
  if (end < 0 || end + 22 > bytes.length) return null;
  const central = end - bytes.readUInt32LE(end + 12);
  const base = central - bytes.readUInt32LE(end + 16);
  if (central < 0 || base < 0) return null;
  for (let entry = central; entry + 46 <= end && bytes.readUInt32LE(entry) === 0x02014b50;) {
    const length = bytes.readUInt16LE(entry + 28);
    const name = bytes.toString('utf8', entry + 46, entry + 46 + length);
    if (name === 'version.json') {
      const offset = base + bytes.readUInt32LE(entry + 42);
      const size = bytes.readUInt32LE(entry + 20);
      const lengthAfterInflation = bytes.readUInt32LE(entry + 24);
      if (size > 4096 || lengthAfterInflation > 4096 || offset + 30 > central ||
          bytes.readUInt32LE(offset) !== 0x04034b50) return null;
      const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      if (start + size > central) return null;
      const buffer = bytes.subarray(start, start + size);
      try {
        const format = bytes.readUInt16LE(entry + 10);
        const json = format === 8 ? inflate(buffer, { maxOutputLength: 4096 }) : format === 0 ? buffer : null;
        const version = json && JSON.parse(json.toString('utf8')).version;
        return /^\d+\.\d+\.\d+$/.test(version || '') ? version : null;
      } catch { return null; }
    }
    entry += 46 + length + bytes.readUInt16LE(entry + 30) + bytes.readUInt16LE(entry + 32);
  }
  return null;
}

function showVersionNotice(dialog, window, version, remote, hasModifier, modifier, comparison) {
  if (window.isDestroyed() || window.__rlcVersionNoticeShown) return;
  const supported = '0.10.0';
  const lines = [];
  if (remote && comparison(version, remote) === -1) {
    lines.push('RLCareer Overhaul : v' + version + ' installée, v' + remote + ' publiée sur GitHub.');
  }
  if (hasModifier && ![supported, '0.8.0'].includes(modifier)) {
    lines.push(modifier
      ? 'Modifier FilstaNet : v' + modifier + ' installée, v' + supported + ' attendue pour ce lanceur.'
      : 'La version du Modifier FilstaNet installé est inconnue. Version attendue : v' + supported + '.');
  }
  if (!lines.length) return;
  window.__rlcVersionNoticeShown = true;
  if (hasModifier) lines.push('Les deux mods peuvent rencontrer des problèmes si leurs versions ne correspondent pas.');
  void dialog.showMessageBox(window, {
    type: 'warning', title: 'RLCareer Overhaul', message: 'Vérification des versions',
    detail: lines.join('\n\n'), buttons: ['Continuer'], noLink: true
  }).catch(() => {});
}

module.exports = { compareVersions, latestCareerRelease, modifierFileVersion, showVersionNotice };
