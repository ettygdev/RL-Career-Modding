'use strict';
async function rasterizeHudLogo(name) {
  const image = new Image();
  image.src = name.startsWith('custom:') ? 'rlcart://art/' + name.slice(7) + '.png' :
    'logos/' + encodeURIComponent(name);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const scale = 128 / Math.max(image.naturalWidth, image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  canvas.getContext('2d').drawImage(image, (128 - width) / 2, (128 - height) / 2, width, height);
  return canvas.toDataURL('image/png').split(',')[1];
}
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID, randomInt } = require('node:crypto');
const { getAsset } = require('node:sea');

const version = '0.10.2';
/* INVENTORY_HOOKS */
const supportedVersions = ['0.2.0-beta.33', '0.2.0-beta.34'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function installBundledBots(directory, restore = false) {
  const rlbot = path.join(directory, 'resources', 'rlbot');
  const python = path.join(directory, 'resources', 'python', 'python.exe');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'rlcoverhaul-bots-'));
  try {
    fs.mkdirSync(path.join(staging, 'src'));
    for (const [key, file] of [
      ['botStyleInstaller', 'install-bot-style.py'],
      ['quickChatInstaller', 'install-quick-chat.py'],
      ['botStyle', 'src/rlc_bot_style.py'],
      ['advancedMoves', 'src/rlc_advanced_moves.py'],
      ['quickChat', 'src/rlc_quick_chat.py']
    ]) fs.writeFileSync(path.join(staging, file), Buffer.from(getAsset(key)));
    const { spawnSync } = require('node:child_process');
    let ok = true;
    for (const script of ['install-bot-style.py', 'install-quick-chat.py']) {
      const result = spawnSync(python, [path.join(staging, script), rlbot, ...(restore ? ['--restore'] : [])],
        { windowsHide: true, encoding: 'utf8', timeout: 10000 });
      if (result.status !== 0) {
        ok = false;
        const detail = (result.stderr || result.error?.message || result.stdout || 'Unknown error').trim();
        console.warn('RLCareer Overhaul bot integration: ' + detail);
        fs.appendFileSync(path.join(os.tmpdir(), 'RLCareer-Overhaul.log'),
          new Date().toISOString() + ' ' + script + ': ' + detail + '\n');
      }
    }
    return ok;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--steam-input-proxy')) return runSteamInputProxy();
  if (args.includes('--version')) {
    console.log('RLCareer Overhaul ' + version + ' · détection automatique');
    return;
  }
  const directory = path.dirname(process.execPath);
  if (args.includes('--install-bot-hooks') || args.includes('--restore-bot-hooks')) {
    const restore = args.includes('--restore-bot-hooks');
    if (!installBundledBots(directory, restore)) process.exitCode = 1;
    else console.log('RLCareer Overhaul RLBot hooks ' + (restore ? 'restored.' : 'installed.'));
    return;
  }
  const hub = path.join(directory, 'RL Career Hub.exe');
  const modifier = path.join(directory, 'RL.Career.Hub.-.Modifier.exe');
  const compatible = fs.statSync(modifier, { throwIfNoEntry: false })?.isFile() ?? false;
  const executable = compatible ? modifier : hub;
  let modifierVersion = null;
  if (compatible) {
    try {
      if (fs.statSync(modifier).size <= 128 * 1024 * 1024) {
        modifierVersion = modifierFileVersion(fs.readFileSync(modifier), require('node:zlib').inflateRawSync);
      }
    } catch { /* The compatibility dialog handles an unknown version. */ }
  }
  const port = randomInt(30000, 60000);
  if (!fs.statSync(hub, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Introuvable : ' + hub + '. Place ce lanceur à côté de RL Career Hub.exe.');
  }
  try { installBundledBots(directory); }
  catch (error) { console.warn('RLCareer Overhaul bot integration: ' + error.message); }
  const nonce = randomUUID();
  if (process.env.APPDATA) {
    const data = path.join(process.env.APPDATA, 'bakkesmod', 'bakkesmod', 'data');
    const tracks = [['timeoutMusic', 'inventory-timeout.wav']];
    if (process.env.RLC_DISABLE_BROADCAST !== '1') tracks.push(['intermissionMusic','inventory-rl-music.wav']);
    if (fs.existsSync(data)) for (const [asset,file] of tracks) {
      const target = path.join(data, 'rlcareermode', file);
      const temporary = target + '.' + nonce + '.tmp';
      try {
        const track = Buffer.from(getAsset(asset));
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(track)) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(temporary, track);
          fs.renameSync(temporary, target);
        }
      } catch (error) {
        console.warn('Piste indisponible (' + file + ') : ' + error.message);
      } finally {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      }
    }
  }
  const badge = JSON.stringify('(' + installModBadge.toString() + ')(' + JSON.stringify(version) + ',' + JSON.stringify(compatible) + ',' + JSON.stringify(modifierVersion) + ')');
  const renderer = JSON.stringify('(' + installInventoryUi.toString() + ')()');
  const inventory = '(' + installInventoryEngine.toString() + ')';
  const titleCatalog = getAsset('inventoryTitles', 'utf8');
  const cameraBridge = '(' + installCameraBridge.toString() + ')';
  const cameraLookup = '(' + createLiquipediaCameraLookup.toString() + ')';
  const cameraProfiles = getAsset('cameraProfiles', 'utf8');
  const hudArt = getAsset('hudArt', 'utf8');
  const hudGlyphs = getAsset('hudGlyphs', 'utf8');
  const cameraPlugin = Buffer.from(getAsset('cameraPlugin')).toString('base64');
  const thumbnails = '(' + createThumbnailLoader.toString() + ')';
  const intermissionEnabled = process.env.RLC_DISABLE_BROADCAST !== '1';
  const careerExtras = '(' + installCareerExtras.toString() + ')';
  const officialsRules = '(' + matchOfficialsRules.toString() + ')';
  const officialsEngine = '(' + installMatchOfficials.toString() + ')';
  const officialsUi = JSON.stringify('(' + installMatchOfficialsUi.toString() + ')(' + officialsRules + ')');
  const recruitmentRulesSource = '(' + recruitmentRules.toString() + ')';
  const recruitment = '(' + installRecruitment.toString() + ')';
  const recruitmentUi = JSON.stringify('(' + installRecruitmentUi.toString() + ')(' + recruitmentRulesSource + ')');
  const gearCatalog = JSON.stringify(setupGearCatalog());
  const setupGear = '(' + installSetupGear.toString() + ')';
  const setupGearUi = JSON.stringify('(' + installSetupGearUi.toString() + ')(' + gearCatalog + ',' +
    getAsset('gearBrandLogos', 'utf8') + ')');
  const ratingDials = JSON.stringify('(' + installRatingDials.toString() + ')()');
  const worldAttributes = '(' + installWorldAttributes.toString() + ')';
  const worldAttributeUi = JSON.stringify('(' + installWorldAttributeUi.toString() + ')(' + recruitmentRulesSource + ')');
  const attributeResearch = getAsset('playerAttributes', 'utf8');
  const composure = '(' + installComposure.toString() + ')';
  const coachCatalog = getAsset('coachCatalog', 'utf8');
  const coaches = '(' + installCoaches.toString() + ')';
  const coachesUi = JSON.stringify('(' + installCoachesUi.toString() + ')(');
  const worldStaff = '(' + installWorldStaff.toString() + ')';
  const worldStaffUi = JSON.stringify('(' + installWorldStaffUi.toString() + ')()');
  const coachSocial = '(' + installCoachSocial.toString() + ')';
  const socialHelpers = '(' + coachAudience.toString() + '),(' + coachArchiveKey.toString() + ')';
  const coachUiHelpers = JSON.stringify(',' + socialHelpers + ')');
  const composureUi = JSON.stringify('(' + installComposureUi.toString() + ')()');
  const steamRequest = '(' + steamInputRequestFile.toString() + ')';
  const steamProxy = '(' + requestSteamProxy.toString() + ')';
  const releaseCheck = '(' + latestCareerRelease.toString() + ')';
  const notice = '(' + showVersionNotice.toString() + ')';
  const update = '(' + installCareerUpdate.toString() + ')';
  const compare = '(' + compareVersions.toString() + ')';
  const careerSetup = JSON.stringify('(' + installCareerSetup.toString() + ')(' +
    JSON.stringify(process.execPath) + ',' + JSON.stringify(version) + ')');
  const broadcast = '(' + installBroadcastResult.toString() + ')';
  const postmatchFrame = '(' + installPostmatchFrame.toString() + ')';
  const hudLogoRenderer = JSON.stringify('(' + rasterizeHudLogo.toString() + ')(');
  const broadcastRenderer = JSON.stringify('(' + showBroadcastResult.toString() + ')(');
  const quickChat = '(' + installQuickChat.toString() + ')';
  const quickChatUi = JSON.stringify('(' + installQuickChatUi.toString() + ')(' + JSON.stringify(quickChatCatalog) + ')');
  const readyStates = ['installed', 'already-installed'];
  const identity = '({pid: process.pid, exe: process.execPath, token: process.env.RLC_INVENTORY_LAUNCH_TOKEN})';
  const injection = '(async () => {' +
    'const electron = process.mainModule?.require("electron");' +
    'if (!electron?.BrowserWindow) return "waiting-electron";' +
    'if (!' + JSON.stringify(supportedVersions) + '.includes(electron.app.getVersion())) return "wrong-version:" + electron.app.getVersion();' +
    'const window = electron.BrowserWindow.getAllWindows().find(w => ' +
      '/^file:.*\\/resources\\/app\\.asar\\/renderer\\/index\\.html(?:[?#]|$)/i.test(w.webContents.getURL()));' +
    'if (!window) return "waiting-window";' +
    'if (!window.__rlcVersionLookup) {' +
      'window.__rlcVersionLookup = true;' +
      'void ' + releaseCheck + '(fetch,()=>new Promise((resolve,reject)=>{' +
        'process.getBuiltinModule("child_process").execFile("gh",["release","view","--repo","ettygdev/RL-Career-Modding","--json","tagName"],' +
        '{windowsHide:true,timeout:4500,maxBuffer:32768},(error,output)=>{' +
          'if(error){reject(error);return;}try{resolve(JSON.parse(output).tagName);}catch(e){reject(e);}' +
        '});' +
      '})).then(remote=>{' +
        'if(remote && ' + compare + '(' + JSON.stringify(version) + ',remote)===-1) void ' +
          update + '(remote,' + JSON.stringify(version) + ',electron,window);' +
        notice + '(electron.dialog,window,' + JSON.stringify(version) + ',null,' +
        compatible + ',' + JSON.stringify(modifierVersion) + ',' + compare + ');}).catch(()=>{});' +
    '}' +
    (compatible ? 'if (!(await window.webContents.executeJavaScript("Boolean(window.__btierUI || document.querySelector(\'.mod-version-label\'))"))) return "waiting-filsta";' : '') +
    'await window.webContents.executeJavaScript(' + badge + ');' +
    'const modules = process.getBuiltinModule("module")._cache;' +
    'const find = file => Object.values(modules).find(module => module.filename?.split(String.fromCharCode(92)).join("/").endsWith("/app.asar/" + file))?.exports;' +
    'const loadThumbnails = ' + thumbnails + '((id,image,paints) => window.webContents.executeJavaScript("window.__rlcInventoryThumbnail?.(" + JSON.stringify(id) + "," + JSON.stringify(image) + "," + JSON.stringify(paints) + ")"));' +
    'const engine = ' + inventory + '(find("engine/league.js"),find("setup/locker.js"),find("engine/titles.js"),find("setup/rcon.js"),process.getBuiltinModule("fs"),process.getBuiltinModule("path"),loadThumbnails,' + titleCatalog + ');' +
    'if (engine === "waiting-engine") return engine;' +
    'const fs = process.getBuiltinModule("fs"); const path = process.getBuiltinModule("path");' +
    'let officials; const league=find("engine/league.js"); const talk=find("engine/team-talk.js");' +
    'const lookup = ' + cameraLookup + '(path.join(electron.app.getPath("userData"),"rlc-camera-cache.json"),fs);' +
    'const rasterizeLogo = name => window.webContents.executeJavaScript(' +
      hudLogoRenderer + ' + JSON.stringify(name) + ")");' +
    'const postmatchFrame = ' + (intermissionEnabled ?
      postmatchFrame + '(electron.BrowserWindow,fs,path,' + broadcastRenderer + ',find("setup/curtain.js"),window);' : 'null;') +
    'const cameras = ' + cameraBridge + '(find("engine/league.js"),fs,path,' +
      cameraProfiles + ',' + JSON.stringify(cameraPlugin) + ',lookup,' + intermissionEnabled + ',find("setup/rcon.js"),path.join(electron.app.getAppPath(),"renderer","logos"),rasterizeLogo,' + hudGlyphs + ',' + hudArt + ',find("setup/scorebug.js")?.headerOf,true,dir=>league.setDayNote.rlcQuickChat?.(dir),postmatchFrame,(state,fixture,dir,entry)=>league.setDayNote.rlcOfficials?.prepare(state,fixture,dir,entry),(state,fixture)=>league.setDayNote.rlcOfficials?.allowsRequest(state,fixture));' +
    'if (cameras === "waiting-engine") return cameras;' +
    (!intermissionEnabled ? '' :
      'const intermission = ' + broadcast + '(find("engine/league.js"),find("setup/curtain.js"),' +
        'find("setup/injector.js"),find("setup/rcon.js"),' + broadcastRenderer + ',18000,(dir,id,game)=>{' +
          'try {const token=(process.env.RLC_INVENTORY_LAUNCH_TOKEN||String(process.pid))+"-"+id+"-"+game;' +
          'const [record,seconds]=fs.readFileSync(path.join(dir,"..","inventory-overtime-result.txt"),"utf8").trim().split(/\\s+/);' +
          'const value=Number(seconds);if(record===token&&Number.isSafeInteger(value)&&value>=0&&value<7200)return value;}catch{}' +
        '},{write:(dir,file,value)=>fs.writeFileSync(path.join(path.dirname(dir),file),value),read:(dir,file)=>fs.readFileSync(path.join(path.dirname(dir),file),"utf8")},window,24320,(id,game)=>league.setDayNote.rlcOfficials?.skipScoreboard(id,game));' +
      'if (intermission === "waiting-engine") return intermission;') +
    'const steamInputRequestFile = ' + steamRequest + ';' +
    'const staffCatalog = ' + coachCatalog + ';' +
    worldStaff + '(find("engine/world.js"),find("engine/league.js"),staffCatalog);' +
    worldAttributes + '(find("engine/world.js"),league);' +
    'const staff = ' + coaches + '(find("engine/league.js"),staffCatalog);' +
    'const composure = ' + composure + '(find("engine/league.js"),find("engine/team-talk.js"),staff);' +
    coachSocial + '(find("engine/league.js"),staffCatalog,' + socialHelpers + ');' +
    'const careerExtras = ' + careerExtras + '(find("engine/league.js"),find("setup/game-launch.js"),find("setup/curtain.js"),find("setup/scorebug.js"),' +
      '()=>window.webContents.executeJavaScript("localStorage.getItem(\u0027rlc-epic-steam-shortcut\u0027)||\u0027\u0027"),uri=>electron.shell.openExternal(uri),' + steamProxy + ',composure);' +
    'if (careerExtras === "waiting-engine") return careerExtras;' +
    'officials=' + officialsEngine + '(league,talk,' + officialsRules + ',{read:(dir,file)=>fs.readFileSync(path.join(dir,file),"utf8"),write:(dir,file,value)=>fs.writeFileSync(path.join(dir,file),value),remove:(dir,file)=>fs.rmSync(path.join(dir,file),{force:true})});' +
    'const cp=process.getBuiltinModule("child_process");' +
    'if(!cp.ChildProcess.prototype.spawn.rlcSilent){const spawn=cp.ChildProcess.prototype.spawn;function quiet(options){' +
      'const name=process.getBuiltinModule("path").win32.basename(String(options?.file||"")).toLowerCase();' +
      'if(["cmd","cmd.exe","python","python.exe","rlbotserver.exe","powershell.exe"].includes(name))options={...options,windowsHide:true};' +
      'return spawn.call(this,options);}quiet.rlcSilent=true;cp.ChildProcess.prototype.spawn=quiet;}' +
    'officials?.holdNextGame(cp);' +
    recruitment + '(league,' + recruitmentRulesSource + ',' + attributeResearch + ',find("setup/player-bots.js"));' +
    setupGear + '(league,' + gearCatalog + ');' +
    'await window.webContents.executeJavaScript(' + careerSetup + ');' +
    'const status = await window.webContents.executeJavaScript(' + renderer + ');' +
    'await ' + quickChat + '(find("engine/league.js"),find("setup/curtain.js"),fs,path,' +
        '()=>window.webContents.executeJavaScript("JSON.parse(localStorage.getItem(\u0027rlc-quick-chat\u0027)||\u0027{}\u0027)"),' + JSON.stringify(quickChatCatalog) + ');' +
    'await window.webContents.executeJavaScript(' + quickChatUi + ');' +
    'await window.webContents.executeJavaScript(' + composureUi + ');' +
    'if (staff) await window.webContents.executeJavaScript(' + coachesUi + '+JSON.stringify(staffCatalog)+' + coachUiHelpers + ');' +
    'await window.webContents.executeJavaScript(' + worldStaffUi + ');' +
    'await window.webContents.executeJavaScript(' + officialsUi + ');' +
    'await window.webContents.executeJavaScript(' + recruitmentUi + ');' +
    'await window.webContents.executeJavaScript(' + setupGearUi + ');' +
    'await window.webContents.executeJavaScript(' + ratingDials + ');' +
    'await window.webContents.executeJavaScript(' + worldAttributeUi + ');' +
    'return status;' +
    '})()';
  const deadline = Date.now() + 120000;
  const statusDir = compatible ? fs.mkdtempSync(path.join(os.tmpdir(), 'rlc-inventory-')) : null;
  const statusFile = statusDir ? path.join(statusDir, 'result.json') : null;
  const scheduled = '(() => {' +
    'const fs = process.getBuiltinModule("fs");' +
    'const until = ' + deadline + ';' +
    'const file = ' + JSON.stringify(statusFile) + ';' +
    'const check = async () => {' +
      'let result; try { result = await ' + injection + '; } catch(error) { result = "integration-error:" + String(error?.message || error).slice(0, 240); }' +
      'if ((' + JSON.stringify(readyStates) + '.includes(result) || result.startsWith("wrong-version:")) || Date.now() >= until) {' +
        'try { fs.writeFileSync(file, JSON.stringify(result), { flag: "wx" }); } catch {}' +
      '} else setTimeout(check, 250).unref();' +
    '}; setTimeout(check, 0).unref(); return "armed";' +
    '})()';
  const child = spawn(executable, compatible ? [hub] : ['--inspect=127.0.0.1:' + port], {
    cwd: path.dirname(executable), env: { ...process.env, RLC_INVENTORY_LAUNCH_TOKEN: nonce, ...(compatible ? { BTIER_PORT: String(port) } : {}) },
    stdio: 'ignore', detached: true, windowsHide: true
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  console.log(compatible ? 'FilstaNet lancé. Attente du Hub et du signal FilstaNet.' : 'Hub lancé. Attente de sa fenêtre.');
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
      if (readyStates.includes(status)) {
        console.log('RLCareer Overhaul chargé. Le badge de version est affiché dans le Hub.');
        return;
      }
    } catch (error) {
      status = error.message;
    } finally {
      socket?.close();
    }
    await sleep(compatible ? 35 : 350);
  }
  throw new Error('Chargement d’Inventory non confirmé. Dernier état : ' + status);
  } finally {
    if (statusFile && fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
    if (statusDir) fs.rmdirSync(statusDir);
  }
}

main().catch(error => {
  const log = path.join(os.tmpdir(), 'RLCareer-Overhaul.log');
  const message = new Date().toISOString() + ' RLCareer Overhaul ' + version + ' — ' + error.message;
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
