const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
process.chdir(__dirname);
const source = fs.readFileSync('src/launcher.cjs', 'utf8');
fs.mkdirSync('bin', { recursive: true });
fs.mkdirSync('.build', { recursive: true });
for (const [name, compatible] of [['Y-Autonome', false], ['Y-FilstaNet', true]]) {
  const main = path.resolve('.build', name + '.cjs');
  const output = path.resolve('bin', name + '.exe');
  const config = path.resolve('.build', name + '.json');
  fs.writeFileSync(main, source.replace('__COMPATIBLE__', String(compatible)));
  fs.writeFileSync(config, JSON.stringify({ main, output, disableExperimentalSEAWarning: true }));
  execFileSync(process.execPath, ['--build-sea=' + config], { stdio: 'inherit' });
  execFileSync(output, ['--version'], { stdio: 'inherit' });
}
