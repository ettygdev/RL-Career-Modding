'use strict';

function steamInputRequestFile() {
  const path = process.getBuiltinModule('path');
  return path.join(process.env.LOCALAPPDATA || process.getBuiltinModule('os').tmpdir(), 'rlc-steam-input-request.json');
}

async function requestSteamProxy(id, exe, args, openSteam, current) {
  const fs = process.getBuiltinModule('fs');
  const net = process.getBuiltinModule('net');
  const { randomBytes } = process.getBuiltinModule('crypto');
  const file = steamInputRequestFile();
  const nonce = randomBytes(24).toString('hex');
  const socketName = '\\\\.\\pipe\\rlc-steam-' + nonce;
  if (!/^\d{17,20}$/.test(id) || !current()) throw new Error('Steam Input shortcut is invalid or cancelled.');
  return new Promise((resolve, reject) => {
    let socket;
    let timer;
    let ownsFile = false;
    const server = net.createServer(client => {
      if (socket || !current()) { client.destroy(); return; }
      socket = client;
      client.setEncoding('utf8');
      client.once('error', finish);
      client.once('data', value => finish(value.trim() === 'spawned' && current() ? null :
        new Error('The Steam Input shortcut did not start Rocket League.')));
      client.write(JSON.stringify({ exe, args }) + '\n');
    });
    function finish(error) {
      clearTimeout(timer);
      if (ownsFile) {
        try {
          const request = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (request.nonce === nonce) fs.unlinkSync(file);
        } catch { /* The proxy can consume the descriptor before cleanup. */ }
      }
      socket?.destroy();
      server.close();
      if (error) reject(error);
      else resolve();
    }
    server.once('error', finish);
    server.listen(socketName, async () => {
      timer = setTimeout(() => finish(new Error('Steam Input shortcut did not respond. Check its launch options.')), 12000);
      try {
        fs.writeFileSync(file, JSON.stringify({ nonce, expires: Date.now() + 13000 }), { flag: 'w' });
        ownsFile = true;
        await openSteam('steam://rungameid/' + id);
      } catch (error) { finish(error); }
    });
  });
}

async function runSteamInputProxy() {
  const fs = process.getBuiltinModule('fs');
  const net = process.getBuiltinModule('net');
  const path = process.getBuiltinModule('path');
  const { spawn } = process.getBuiltinModule('child_process');
  let request;
  try { request = JSON.parse(fs.readFileSync(steamInputRequestFile(), 'utf8')); } catch {}
  if (!/^[a-f0-9]{48}$/.test(request?.nonce || '') || request.expires <= Date.now()) {
    throw new Error('Start a career match from RL Career Hub first.');
  }
  await new Promise((resolve, reject) => {
    const socket = net.connect('\\\\.\\pipe\\rlc-steam-' + request.nonce);
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(14000, () => socket.destroy(new Error('Steam Input request timed out.')));
    socket.once('error', reject);
    function launch(chunk) {
      data += chunk;
      if (data.length > 16384) { socket.destroy(new Error('Invalid launch request.')); return; }
      if (!data.endsWith('\n')) return;
      socket.off('data', launch);
      try {
        const { exe, args } = JSON.parse(data);
        if (typeof exe !== 'string' || !path.isAbsolute(exe) || path.basename(exe).toLowerCase() !== 'rocketleague.exe' ||
            typeof args !== 'string' || !args.length || !fs.statSync(exe).isFile()) throw new Error('Invalid Rocket League launch request.');
        const child = spawn(exe, [args], { windowsVerbatimArguments: true, argv0: '"' + exe + '"',
          cwd: path.dirname(exe), stdio: 'ignore', windowsHide: true });
        child.once('spawn', () => socket.end('spawned\n'));
        child.once('error', () => { socket.end('failed\n'); reject(new Error('Could not start Rocket League.')); });
        child.once('exit', resolve);
      } catch { socket.end('failed\n'); reject(new Error('Invalid Rocket League launch request.')); }
    }
    socket.on('data', launch);
  });
}

module.exports = { steamInputRequestFile, requestSteamProxy, runSteamInputProxy };
