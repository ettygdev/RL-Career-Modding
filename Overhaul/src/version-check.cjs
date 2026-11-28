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

async function installCareerUpdate(remote, installed, electron, window) {
  const repo = 'ettygdev/RL-Career-Modding';
  const name = 'RLCareer-Overhaul.exe';
  const fs = process.getBuiltinModule('fs');
  const path = process.getBuiltinModule('path');
  const destination = path.join(path.dirname(process.execPath), name);
  const crypto = process.getBuiltinModule('crypto');
  let temporary;
  try {
    const response = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': name },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error('GitHub release unavailable.');
    const release = await response.json();
    const tag = release.tag_name;
    if (!/^v?\d+\.\d+\.\d+$/.test(tag) || tag.replace(/^v/, '') !== remote ||
        release.draft || release.prerelease || !fs.existsSync(destination) || window.isDestroyed()) return;
    const asset = release.assets?.find(item => item.name === name);
    const url = 'https://github.com/' + repo + '/releases/download/' + tag + '/' + name;
    if (asset?.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 300 * 1024 * 1024) {
      throw new Error('The release is missing a verifiable Windows executable.');
    }
    const choice = await electron.dialog.showMessageBox(window, {
      title: 'RLCareer Overhaul', message: 'Update to v' + remote + '?',
      detail: 'Installed version v' + installed + '. The Hub will restart after installation.',
      buttons: ['Download and install', 'Later'], defaultId: 1, cancelId: 1, noLink: true
    });
    if (choice.response !== 0 || window.isDestroyed()) return;
    const download = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!download.ok || !download.body) throw new Error('Download unavailable.');
    const hash = crypto.createHash('sha256');
    temporary = destination + '.' + crypto.randomUUID() + '.download';
    const file = await fs.promises.open(temporary, 'wx');
    let bytes = 0;
    try {
      for await (const chunk of download.body) {
        bytes += chunk.length;
        if (bytes > asset.size) throw new Error('Unexpected download size.');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
    } finally { await file.close(); }
    if (bytes !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest.toLowerCase()) {
      throw new Error('Download checksum mismatch.');
    }
    if (window.isDestroyed()) return;
    const data = Buffer.from(JSON.stringify({ temporary, destination, pid: process.pid })).toString('base64');
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$u = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + data + "')) | ConvertFrom-Json",
      "Wait-Process -Id $u.pid -Timeout 90 -ErrorAction SilentlyContinue",
      "if (Get-Process -Id $u.pid -ErrorAction SilentlyContinue) { exit 1 }",
      "$backup = $u.temporary + '.bak'",
      "for ($i = 0; $i -lt 30; $i++) {",
      "  try { [IO.File]::Replace($u.temporary, $u.destination, $backup); break }",
      "  catch { if ($i -eq 29) { Start-Process -FilePath $u.destination -WindowStyle Hidden; throw }; Start-Sleep -Milliseconds 500 }",
      "}",
      "Start-Process -FilePath $u.destination -WorkingDirectory ([IO.Path]::GetDirectoryName($u.destination)) -WindowStyle Hidden",
      "Remove-Item -LiteralPath $backup -ErrorAction SilentlyContinue"
    ].join('\n');
    const worker = process.getBuiltinModule('child_process').spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { detached: true, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      worker.once('spawn', resolve);
      worker.once('error', reject);
    });
    worker.unref();
    temporary = undefined;
    electron.app.quit();
  } catch (error) {
    if (!window.isDestroyed()) await electron.dialog.showMessageBox(window, {
      type: 'warning', title: 'RLCareer Overhaul', message: 'Update could not be installed',
      detail: error.message, buttons: ['OK']
    });
  } finally {
    if (temporary) await fs.promises.unlink(temporary).catch(() => {});
  }
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
  const supported = '0.11.5';
  const lines = [];
  if (remote && comparison(version, remote) === -1) {
    lines.push('RLCareer Overhaul : v' + version + ' installée, v' + remote + ' publiée sur GitHub.');
  }
  if (hasModifier && ![supported, '0.11.4', '0.10.0', '0.8.0'].includes(modifier)) {
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

module.exports = { installCareerUpdate, compareVersions, latestCareerRelease, modifierFileVersion, showVersionNotice };
