const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
process.chdir(__dirname);

function buildFixture(name, code) {
  const main = path.resolve('.build', name + '.cjs');
  const output = path.resolve('.build', name + '.exe');
  const config = path.resolve('.build', name + '.json');
  fs.writeFileSync(main, code);
  fs.writeFileSync(config, JSON.stringify({ main, output, disableExperimentalSEAWarning: true }));
  execFileSync(process.execPath, ['--build-sea=' + config]);
  return output;
}

async function test() {
  const hub = buildFixture('Mock-Hub', [
    'const vm = require("node:vm");',
    'const inspector = require("node:inspector");',
    'const args = process.argv.join(" ");',
    'const port = Number(args.match(/127[.]0[.]0[.]1:(\\d+)/)?.[1] || process.env.BTIER_PORT);',
    'if (!inspector.url()) inspector.open(port, "127.0.0.1");',
    'let ready = false;',
    'setTimeout(() => { ready = true; context.window.__btierUI = true; }, 1800);',
    'if (!args.includes("--inspect=")) setTimeout(() => inspector.close(), 900);',
    'let article;',
    'const feed = { querySelector: () => article, prepend: item => { article = item; } };',
    'const document = { documentElement: {}, querySelector: sel => sel === "#filsta-ready" ? ready : feed,',
    'createElement: tag => ({ tag, style: {}, append() {} }) };',
    'const context = vm.createContext({ window: {}, document, MutationObserver: class { observe() {} } });',
    'const webContents = { getURL: () => "file:///Mock/resources/app.asar/renderer/index.html",',
    'executeJavaScript(code) { const result = vm.runInContext(code, context);',
    'if (result === "installed" && article?.id !== "rlc-y-test-preview") throw Error("missing preview");',
    'return result; } };',
    'process.mainModule = { require: () => ({ app: { getVersion: () => "0.2.0-beta.31" },',
    'BrowserWindow: { getAllWindows: () => [{ webContents }] } }) };',
    'setTimeout(() => process.exit(), 7500);'
  ].join('\n'));
  const filsta = buildFixture('Mock-FilstaNet', [
    'const { spawn } = require("node:child_process");',
    'const child = spawn(' + JSON.stringify(hub) + ', [], {',
    'env: process.env,',
    'windowsHide: true, stdio: "ignore", detached: true }); child.unref();'
  ].join('\n'));
  const config = path.resolve('.build/test-config.json');
  fs.writeFileSync(config, JSON.stringify({ hubExe: hub, filstaExe: filsta,
     }));
  for (const name of ['Y-Autonome', 'Y-FilstaNet']) {
    const started = Date.now();
    const result = execFileSync(path.resolve('bin', name + '.exe'), [config], { encoding: 'utf8', timeout: 15000 });
    assert.match(result, /Y chargé/);
    if (name === 'Y-FilstaNet') assert.ok(Date.now() - started >= 1800, 'must wait for FilstaNet');
    console.log(name + ': injection et affichage simulés validés');
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
