'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID, randomInt } = require('node:crypto');

const version = '0.3.12';
/* SOCIAL_HOOKS */
const supportedVersions = ['0.2.0-beta.33'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function installModBadge(version) {
  if (window.__rlcModBadgeVersion === version) return 'already-installed';
  const badgeId = 'rlc-modding-version-label';
  function updateBadge() {
    const hub = document.querySelector('.version-label:not(.mod-version-label):not(#' + badgeId + ')');
    const outsideCareer = typeof S === 'undefined' || !S?.career;
    const existing = document.getElementById(badgeId);
    if (!hub || !outsideCareer) {
      existing?.remove();
      return;
    }
    const modifier = document.querySelector('.mod-version-label');
    let badge = existing;
    const needsBadge = !badge;
    if (needsBadge) {
      badge = document.createElement('div');
      badge.id = badgeId;
      badge.textContent = 'v' + version + ' RL Career Modding';
      badge.setAttribute('aria-label', 'RL Career Modding v' + version + ' chargé');
    }
    const labelClass = hub.className;
    if (badge.className !== labelClass) badge.className = labelClass;
    const visibleLabels = [hub, modifier].filter(label => label && label.getClientRects().length > 0);
    if (visibleLabels.length === 0) return;
    const bottom = Math.max(...visibleLabels.map(label => label.getBoundingClientRect().bottom));
    const top = Math.ceil(bottom) + 4 + 'px';
    if (badge.style.top !== top) badge.style.top = top;
    if (needsBadge) document.body.appendChild(badge);
  }
  const observer = new MutationObserver(updateBadge);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', updateBadge);
  window.__rlcModBadgeVersion = version;
  updateBadge();
  return 'installed';
}

function evaluate(socket, expression) {
  return new Promise((resolve, reject) => {
    const id = randomInt(1, 1000000000);
    const timer = setTimeout(() => finish(new Error('Délai de réponse Inspector dépassé.')), 5000);
    function finish(error, result) {
      clearTimeout(timer);
      socket.removeEventListener('message', receive);
      if (error) reject(error); else resolve(result);
    }
    function receive(event) {
      const reply = JSON.parse(event.data);
      if (reply.id !== id) return;
      if (reply.error || reply.result.exceptionDetails) {
        finish(new Error('Évaluation refusée ou échouée dans le Hub.'));
      } else finish(null, reply.result.result.value);
    }
    socket.addEventListener('message', receive);
    try {
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression, awaitPromise: true, returnByValue: true
      }}));
    } catch (error) { finish(error); }
  });
}

async function connect(port) {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list', {
    signal: AbortSignal.timeout(1000), redirect: 'error'
  });
  if (!response.ok) throw new Error('Inspector indisponible.');
  const targets = await response.json();
  if (!Array.isArray(targets) || targets.length !== 1) throw new Error('Cible Inspector ambiguë.');
  const url = new URL(targets[0].webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port ||
      url.username || url.password) throw new Error('Adresse Inspector inattendue.');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Connexion Inspector expirée.'));
    }, 1500);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Connexion Inspector refusée.'));
    }, { once: true });
  });
  return socket;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--version')) {
    console.log('RL Career Modding ' + version + ' · détection automatique');
    return;
  }
  const directory = path.dirname(process.execPath);
  const hub = path.join(directory, 'RL Career Hub.exe');
  const modifier = path.join(directory, 'RL.Career.Hub.-.Modifier.exe');
  const compatible = fs.statSync(modifier, { throwIfNoEntry: false })?.isFile() ?? false;
  const executable = compatible ? modifier : hub;
  const port = randomInt(30000, 60000);
  if (!fs.statSync(hub, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Introuvable : ' + hub + '. Place ce lanceur à côté de RL Career Hub.exe.');
  }
  const nonce = randomUUID();
  const coordinationMode = compatible ? 'off' : args.includes('--neutral') ? '0' : '1';
  const child = spawn(executable, compatible ? [hub] : ['--inspect=127.0.0.1:' + port], {
    cwd: path.dirname(executable), env: { ...process.env, RLC_Y_LAUNCH_TOKEN: nonce, RLC_Y_COORDINATION: coordinationMode, ...(compatible ? { BTIER_PORT: String(port) } : {}) },
    stdio: 'ignore', detached: true
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  console.log(compatible ? 'FilstaNet lancé. Attente du Hub et du signal FilstaNet.' : 'Hub lancé. Attente de sa fenêtre.');
  const badge = JSON.stringify('(' + installModBadge.toString() + ')(' + JSON.stringify(version) + ')');
  const interactions = JSON.stringify('(' + installInteractions.toString() + ')()');
  const engagement = '(' + installPostEngagement.toString() + ')';
  const reposts = '(' + installReposts.toString() + ')';
  const matchPosts = '(' + installMatchPosts.toString() + ')';
  const relationships = '(' + createDmRelationships.toString() + ')';
  const coordination = '(' + installCoordination.toString() + ')';
  const readyStates = ['installed', 'ready-with-modifier'];
  const identity = '({pid: process.pid, exe: process.execPath, token: process.env.RLC_Y_LAUNCH_TOKEN})';
  const injection = '(async () => {' +
    'const electron = process.mainModule?.require("electron");' +
    'if (!electron?.BrowserWindow) return "waiting-electron";' +
    'if (!' + JSON.stringify(supportedVersions) + '.includes(electron.app.getVersion())) return "wrong-version:" + electron.app.getVersion();' +
    'const window = electron.BrowserWindow.getAllWindows().find(w => ' +
      '/^file:.*\\/resources\\/app\\.asar\\/renderer\\/index\\.html(?:[?#]|$)/i.test(w.webContents.getURL()));' +
    'if (!window) return "waiting-window";' +
    'const modifierLoaded = await window.webContents.executeJavaScript("window.__btierUI === true");' +
    (compatible ? 'if (!modifierLoaded) return "waiting-filsta";' : '') +
    'const featureGroups = [{ conflictsWithModifier: true, install: async () => {' +
    'const modules = process.getBuiltinModule("module")._cache;' +
    'const league = Object.values(modules).find(module => module.filename?.split(String.fromCharCode(92)).join("/").endsWith("/app.asar/engine/league.js"));' +
    'const renderer = await window.webContents.executeJavaScript(' + interactions + ');' +
    'if (renderer === "waiting-renderer") return renderer;' +
    'const i18n = Object.values(modules).find(module => module.filename?.split(String.fromCharCode(92)).join("/").endsWith("/app.asar/renderer/i18n.js"));' +
    'const engine = ' + engagement + '(league?.exports, i18n?.exports?.getLanguage);' +
    'if (engine === "waiting-engine") return engine;' +
    'const relationships = ' + relationships + '(league?.exports);' +
    'const reposts = ' + reposts + '(league?.exports, relationships);' +
    'if (reposts === "waiting-engine") return reposts;' +
    'const matches = ' + matchPosts + '(league?.exports, i18n?.exports?.getLanguage, relationships);' +
    'if (matches === "waiting-engine") return matches;' +
    'const coordination = ' + coordination + '(league?.exports, i18n?.exports?.getLanguage);' +
    'if (coordination === "waiting-engine") return coordination;' +
    'return "installed";' +
    '} }];' +
    'const status = await (' + loadFeatureGroups.toString() + ')(featureGroups, modifierLoaded);' +
    'if (' + JSON.stringify(readyStates) + '.includes(status)) await window.webContents.executeJavaScript(' + badge + ');' +
    'return status;' +
    '})()';
  const deadline = Date.now() + 120000;
  const statusDir = compatible ? fs.mkdtempSync(path.join(os.tmpdir(), 'rlc-y-')) : null;
  const statusFile = statusDir ? path.join(statusDir, 'result.json') : null;
  const scheduled = '(() => {' +
    'const fs = process.getBuiltinModule("fs");' +
    'const until = ' + deadline + ';' +
    'const file = ' + JSON.stringify(statusFile) + ';' +
    'const check = async () => {' +
      'let result; try { result = await ' + injection + '; } catch { result = "waiting-window"; }' +
      'if ((' + JSON.stringify(readyStates) + '.includes(result) || result.startsWith("wrong-version:")) || Date.now() >= until) {' +
        'try { fs.writeFileSync(file, JSON.stringify(result), { flag: "wx" }); } catch {}' +
      '} else setTimeout(check, 250).unref();' +
    '}; setTimeout(check, 0).unref(); return "armed";' +
    '})()';
  let status = 'Inspector inaccessible';
  try {
  while (Date.now() < deadline) {
    let socket;
    try {
      socket = await connect(port);
      const target = await evaluate(socket, identity);
      if (target?.token !== nonce || path.resolve(target.exe).toLowerCase() !== hub.toLowerCase() ||
          (!compatible && target.pid !== child.pid)) {
        throw new Error('Cette instance du Hub ne provient pas de ce lancement.');
      }
      status = await evaluate(socket, compatible ? scheduled : injection);
      if (status === 'armed') {
        socket.close();
        socket = undefined;
        while (Date.now() <= deadline + 1000) {
          if (fs.existsSync(statusFile)) {
            status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
            break;
          }
          await sleep(250);
        }
        if (status.startsWith('wrong-version:')) break;
        if (!readyStates.includes(status)) break;
      }
      if (status.startsWith('wrong-version:')) break;
      if (status === 'ready-with-modifier') {
        console.log('FilstaNet chargé. Le badge RL Career Modding est affiché au menu principal. Y Social est désactivé.');
        return;
      }
      if (['installed', 'already-installed'].includes(status)) {
        console.log('Y chargé. Le badge RL Career Modding est affiché au menu principal.');
        return;
      }
    } catch (error) {
      status = error.message;
    } finally {
      socket?.close();
    }
    await sleep(compatible ? 150 : 750);
  }
  const component = compatible ? 'FilstaNet' : 'Y Social';
  throw new Error('Chargement de ' + component + ' non confirmé. Dernier état : ' + status);
  } finally {
    if (statusFile && fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
    if (statusDir) fs.rmdirSync(statusDir);
  }
}

main().catch(error => {
  const log = path.join(os.tmpdir(), 'RL-Career-Modding.log');
  const message = new Date().toISOString() + ' RL Career Modding ' + version + ' — ' + error.message;
  console.error(message);
  try { fs.appendFileSync(log, message + '\\n'); } catch {}
  console.error('Journal : ' + log);
  process.exitCode = 1;
  if (process.stdin.isTTY) {
    console.error('Appuie sur Entrée pour fermer.');
    process.stdin.resume();
    process.stdin.once('data', () => process.stdin.pause());
  }
});
