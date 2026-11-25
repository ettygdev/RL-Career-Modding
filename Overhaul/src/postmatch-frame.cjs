'use strict';

function installPostmatchFrame(BrowserWindow, fs, path, renderer, curtain, mainWindow) {
  function validFrame(image) {
    if (image.isEmpty()) return false;
    const pixels = image.toBitmap();
    let dark = 0, contrast = 0, samples = 0;
    for (let i = 0; i + 3 < pixels.length; i += 28) {
      samples++;
      if (pixels[i + 3] < 200) continue;
      const brightness = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (brightness < 92) dark++;
      if (brightness > 145) contrast++;
    }
    return dark > samples * .4 && contrast >= 5;
  }

  // Same match payload as the broadcast renderer. Canvas serialization does
  // not depend on an offscreen BrowserWindow paint reaching the compositor.
  function fallbackScoreboard(data, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const w = width / 1600, h = height / 900;
    ctx.scale(w, h);
    function fill(color, x, y, width, height) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
    }
    function label(value, x, y, size, color = '#f6f8fa', maxWidth = 430) {
      ctx.fillStyle = color;
      ctx.font = 'italic bold ' + size + 'px Bahnschrift, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(value), x, y, maxWidth);
    }
    fill('#0b0e12', 0, 0, 1600, 900);
    const shade = ctx.createLinearGradient(0, 0, 1600, 720);
    shade.addColorStop(0, '#1a2632');
    shade.addColorStop(.48, '#11171e');
    shade.addColorStop(1, '#080a0d');
    fill(shade, 48, 40, 1504, 565);
    fill('#111820', 48, 40, 1504, 43);
    label(data.header || 'MATCH RESULT', 800, 63, 21, '#becbd5', 1470);
    const accents = ['#38b6ed', '#ff6a23'];
    const metrics = ['SCORE', 'GOALS', 'ASSISTS', 'SHOTS', 'SAVES', 'DEMOS'];
    const keys = ['score', 'goals', 'assists', 'shots', 'saves', 'demos'];
    data.sides.forEach((side, team) => {
      const x = team ? 942 : 54;
      fill('#11151b', x, 87, 604, 73);
      fill(accents[team], x, 157, 604, 4);
      label(side.name, x + 302, 123, 31, '#f6f8fa', 570);
      label(side.goals, team ? 900 : 700, 123, 52, accents[team]);
      side.players.forEach((player, i) => {
        const left = x + 202 * i;
        fill('#1b2530', left, 215, 196, 37);
        fill('#0b1016', left, 252, 196, 300);
        fill(accents[team], left, 250, 196, 3);
        label(player.name || '–', left + 98, 234, 20, '#f6f8fa', 182);
        keys.forEach((key, row) => label(player[key] ?? '–', left + 98, 274 + 47 * row, 24));
      });
    });
    fill(data.overtime ? '#a91522' : '#e7ebef', 744, 87, 112, 73);
    label(data.overtime ? 'OT' : 'FT', 800, 113, 27, data.overtime ? '#ffffff' : '#111820');
    if (data.overtime && data.overtimeSeconds > 0) {
      const seconds = Math.round(data.overtimeSeconds);
      label('+' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'), 800, 140, 18);
    }
    data.history.forEach((side, i) => fill(accents[side] || '#536473',
      800 + (i - data.history.length / 2) * 42, 171, 38, 5));
    metrics.forEach((metric, i) => label(metric, 800, 274 + 47 * i, 18, '#becbd5'));
    label(data.seriesOver ? 'SERIES COMPLETE' : 'NEXT GAME ' + data.next, 800, 620, 22);
    fill('#263340', 562, 651, 476, 8);
    return { png: canvas.toDataURL('image/png'), metrics: [width, height, 562 * w, 651 * h, 476 * w, 8 * h] };
  }

  let window, loaded, previousFrame, lastFrameAt = 0;
  const pending = new Map();
  let disposed = false;
  mainWindow?.once('closed', () => {
    disposed = true;
    for (const watch of pending.values()) clearInterval(watch.poll);
    pending.clear();
    if (window && !window.isDestroyed()) window.destroy();
  });
  let writes = Promise.resolve();
  function warm() {
    if (window && !window.isDestroyed()) return loaded;
    window = new BrowserWindow({
      width: 1280, height: 720, useContentSize: true, show: false, frame: false, backgroundColor: '#090b0e',
      webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true }
    });
    const created = window;
    loaded = created.loadURL('data:text/html;charset=utf-8,' +
      encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Post-match</title><style>html,body{background:#090b0e;margin:0}</style><body></body>'));
    loaded.catch(() => { if (!created.isDestroyed()) created.destroy(); });
    return loaded;
  }

  function atomicWrite(file, value) {
    const temp = file + '.tmp';
    fs.writeFileSync(temp, value);
    fs.renameSync(temp, file);
  }

  function crest(dir, asset) {
    if (!/^inventory-crest-[a-f0-9]{16}\.png$/.test(asset)) return undefined;
    try { return 'data:image/png;base64,' + fs.readFileSync(path.join(dir, asset)).toString('base64'); }
    catch { return undefined; }
  }

  async function render(entry, snapshot) {
    const { dir, token, series, presentation, header, history } = entry;
    const [first, ...rows] = snapshot.trimEnd().split('\n');
    const [received, stamped, blue, orange, overtime, overtimeSeconds] = first.trim().split(/\s+/);
    const [blueGoals, orangeGoals] = [Number(blue), Number(orange)];
    if (received !== token || !/^\d{13}$/.test(stamped) || Number(stamped) <= lastFrameAt ||
        ![blueGoals, orangeGoals].every(n => Number.isSafeInteger(n) && n >= 0) || blueGoals === orangeGoals) return;
    const winner = blueGoals > orangeGoals ? 0 : 1;
    const sides = presentation.map((line, team) => {
      const [name, asset] = line.split('\t');
      const players = rows.map(row => row.trimEnd().split('\t')).filter(row => Number(row[0]) === team && row.length === 8)
        .slice(0, 3).map(([, name, ...stats]) => {
          const [score, goals, assists, shots, saves, demos] = stats.map(Number);
          return { name, score, goals, assists, shots, saves, demos };
        });
      while (players.length < 3) players.push({});
      return { name: name || (team ? 'Orange' : 'Blue'), crest: crest(dir, asset),
        goals: team ? orangeGoals : blueGoals, players };
    });
    const [game, bestOf] = series;
    const payload = { sides, history: [...history, winner], bestOf, header,
      overtime: overtime === '1', overtimeSeconds: Number(overtimeSeconds), intermission: true,
      seriesOver: bestOf > 0 && series[2 + winner] + 1 > bestOf / 2,
      seconds: 18, next: game + 1 };
    if (disposed) return;
    await warm();
    if (disposed) return;
    const size = curtain.readSize?.(path.join(dir, 'curtain')) ?? { w: 1920, h: 1080 };
    const height = Math.min(1080, size.h), width = Math.round(height * size.w / size.h);
    window.setContentSize(width, height);
    const contents = window.webContents;
    let rendered = false, metrics;
    try {
      rendered = await contents.executeJavaScript(renderer + JSON.stringify(payload) + ')');
      if (rendered) metrics = await contents.executeJavaScript(`new Promise(resolve => {
      const measure = () => {
        const bar = document.querySelector('#rlc-broadcast .card-track')?.getBoundingClientRect();
        resolve([innerWidth, innerHeight, bar?.x || 0, bar?.y || 0, bar?.width || 0, bar?.height || 0]);
      };
      setTimeout(measure, 120);
      requestAnimationFrame(() => requestAnimationFrame(measure));
    })`);
    } catch { /* Try the independent scoreboard if the renderer fails. */ }
    let bitmap;
    for (let attempt = 0; metrics && attempt < 6; attempt++) {
      if (disposed || contents.isDestroyed?.()) return;
      try {
        contents.invalidate?.();
        const candidate = await contents.capturePage();
        if (validFrame(candidate)) {
          bitmap = candidate;
          break;
        }
      } catch { /* An offscreen refresh can race capture during a resize. */ }
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 75));
    }
    if (disposed) return;
    let png = bitmap?.toPNG();
    if (!png) {
      const fallback = await contents.executeJavaScript(
        '(' + fallbackScoreboard.toString() + ')(' + JSON.stringify(payload) + ',' + width + ',' + height + ')');
      if (disposed || !fallback?.png?.startsWith('data:image/png;base64,')) return;
      png = Buffer.from(fallback.png.slice('data:image/png;base64,'.length), 'base64');
      metrics = fallback.metrics;
    }
    const filename = 'inventory-result-' + token + '-' + stamped + '.png';
    const frame = path.join(dir, filename);
    atomicWrite(frame, png);
    atomicWrite(path.join(dir, 'inventory-result-frame.txt'), [token, filename, ...metrics].join(' '));
    lastFrameAt = Number(stamped);
    if (previousFrame && previousFrame !== frame) {
      try { fs.unlinkSync(previousFrame); } catch { /* A previous picture may still be decoding. */ }
    }
    previousFrame = frame;
  }

  return function prepare(dir, info) {
    if (disposed || !/^[a-zA-Z0-9-]{1,100}$/.test(info.token)) return;
    if (pending.has(info.token)) return;
    for (const watch of pending.values()) watch.until = Math.min(watch.until, Date.now() + 5000);
    const entry = { ...info, dir };
    try { void warm(); } catch { return; }
    const watch = { until: info.expires };
    let crestFiles;
    function preloadCrests() {
      const files = entry.presentation.map(line => line.split('\t')[1]);
      const signature = files.join(' ');
      if (crestFiles === signature) return;
      crestFiles = signature;
      const sources = files.map(file => crest(dir, file)).filter(Boolean);
      if (!sources.length) return;
      void warm().then(() => window.webContents.executeJavaScript(`(() => {
        const previous = window.__rlcPostmatchCrests;
        window.__rlcPostmatchCrests = new Map(${JSON.stringify(sources)}.map(source => {
          const img = previous?.get(source) || new Image();
          if (!img.src) img.src = source;
          void img.decode().catch(() => {});
          return [source, img];
        }));
      })()`)).catch(() => {});
    }
    function stop() { clearInterval(watch.poll); pending.delete(entry.token); }
    preloadCrests();
    watch.poll = setInterval(() => {
      if (Date.now() >= watch.until) return stop();
      preloadCrests();
      try {
        const snapshot = fs.readFileSync(path.join(dir, 'inventory-result-snapshot.tsv'), 'utf8');
        const prefix = snapshot.split('\n', 1)[0].split(' ');
        if (prefix[0] !== entry.token || !(Date.now() - Number(prefix[1]) < 20000)) return;
        stop();
        writes = writes.then(() => render(entry, snapshot)).catch(() => {});
      } catch { /* The game has not published the result yet. */ }
    }, 50);
    watch.poll.unref();
    pending.set(entry.token, watch);
  };
}

module.exports = { installPostmatchFrame };
