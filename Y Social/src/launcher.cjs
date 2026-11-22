'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID, randomInt } = require('node:crypto');

const compatible = __COMPATIBLE__;
const version = '0.1.0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function installPreview(version) {
  const id = 'rlc-y-test-preview';
  if (window.__rlcYPreview === version) return 'already-installed';
  function update() {
    const feed = document.querySelector('.xs .xs-mid, .fifa-main [data-action="see-all"][data-key="x"]');
    if (!feed || feed.querySelector('#' + id)) return;
    const preview = document.createElement('article');
    preview.id = id;
    preview.style.cssText = 'margin:8px;padding:12px;border:1px solid #6987a8;border-radius:8px';
    const title = document.createElement('strong');
    title.textContent = 'Y · Publication de test épinglée';
    const message = document.createElement('p');
    message.textContent = 'Le mod Y v' + version + ' est chargé dans cette fenêtre.';
    preview.append(title, message);
    feed.prepend(preview);
  }
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__rlcYPreview = version;
  update();
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
    console.log('Y ' + version + (compatible ? ' · FilstaNet' : ' · autonome'));
    return;
  }
  const configPath = args[0] || path.join(path.dirname(process.execPath), 'Y-config.json');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const hub = path.resolve(config.hubExe || path.join(process.env.LOCALAPPDATA,
    'Programs', 'RL Career Hub', 'RL Career Hub.exe'));
  const executable = compatible && config.filstaExe ? path.resolve(config.filstaExe) : hub;
  const port = randomInt(30000, 60000);
  if (compatible && !config.filstaExe) throw new Error('Renseigner filstaExe dans Y-config.json.');
  if (!fs.existsSync(hub) || !fs.existsSync(executable)) throw new Error('Exécutable introuvable.');
  const nonce = randomUUID();
  const child = spawn(executable, compatible ? [hub] : ['--inspect=127.0.0.1:' + port], {
    cwd: path.dirname(executable), env: { ...process.env, RLC_Y_LAUNCH_TOKEN: nonce, ...(compatible ? { BTIER_PORT: String(port) } : {}) },
    stdio: 'ignore', detached: true
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  console.log(compatible ? 'FilstaNet lancé. Attente du Hub et du signal FilstaNet.' : 'Hub lancé. Attente de sa fenêtre.');
  const payload = JSON.stringify('(' + installPreview.toString() + ')(' + JSON.stringify(version) + ')');
  const identity = '({pid: process.pid, exe: process.execPath, token: process.env.RLC_Y_LAUNCH_TOKEN})';
  const injection = '(async () => {' +
    'const electron = process.mainModule?.require("electron");' +
    'if (!electron?.BrowserWindow) return "waiting-electron";' +
    'if (electron.app.getVersion() !== "0.2.0-beta.31") return "wrong-version";' +
    'const window = electron.BrowserWindow.getAllWindows().find(w => ' +
      '/^file:.*\\/resources\\/app\\.asar\\/renderer\\/index\\.html(?:[?#]|$)/i.test(w.webContents.getURL()));' +
    'if (!window) return "waiting-window";' +
    (compatible ? 'if (!(await window.webContents.executeJavaScript("window.__btierUI === true"))) return "waiting-filsta";' : '') +
    'return window.webContents.executeJavaScript(' + payload + ');' +
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
      'if (["installed", "already-installed", "wrong-version"].includes(result) || Date.now() >= until) {' +
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
        if (!['installed', 'already-installed'].includes(status)) break;
      }
      if (status === 'wrong-version') throw new Error('Ce test cible RL Career Hub 0.2.0-beta.31.');
      if (['installed', 'already-installed'].includes(status)) {
        console.log('Y chargé. Ouvre le réseau social pour voir la publication de test.');
        return;
      }
    } catch (error) {
      status = error.message;
    } finally {
      socket?.close();
    }
    await sleep(compatible ? 150 : 750);
  }
  throw new Error('Chargement de Y non confirmé. Dernier état : ' + status);
  } finally {
    if (statusFile && fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
    if (statusDir) fs.rmdirSync(statusDir);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

