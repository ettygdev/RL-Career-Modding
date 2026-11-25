'use strict';

function installBroadcastResult(engine, curtain, injector, rcon, renderer, delayMs = 18000, readOvertime, io, mainWindow, finalDelayMs = 24320, officialBreak) {
  const original = engine?.applyUserResult;
  if (typeof original !== 'function' || typeof curtain?.raise !== 'function' ||
      typeof curtain.renderHub !== 'function' || typeof curtain.lower !== 'function' ||
      typeof injector?.prepare !== 'function' || typeof rcon?.send !== 'function') return 'waiting-engine';
  if (original.rlcBroadcast) return 'already-installed';
  const raise = curtain.raise;
  const lower = curtain.lower;
  const renderHub = curtain.renderHub;
  const prepare = injector.prepare;
  const send = rcon.send;
  let latest;
  let gate;
  let loadLeadMs = 2600;

  const session = process.env.RLC_INVENTORY_LAUNCH_TOKEN || String(process.pid);
  const closeSeriesCommands = ['rcon_refresh_allowed', 'unreal_command "exit"'];
  const windowActions = ['restore', 'show', 'setAlwaysOnTop', 'focus'];
  let deferFocus;
  for (const method of windowActions) {
    const action = mainWindow?.[method];
    if (typeof action !== 'function') continue;
    mainWindow[method] = function (...args) {
      if (!deferFocus) return action.apply(this, args);
      deferFocus.focus.push(() => { if (!mainWindow.isDestroyed?.()) action.apply(this, args); });
    };
  }

  function resultToken(pending) {
    return session + '-' + pending.payload.fixtureId + '-' + (pending.payload.history.length - 1);
  }

  function cueIntermission(pending) {
    try {
      io?.write(pending.dir, 'inventory-intermission-music.txt',
        'postmatch-' + resultToken(pending) + ' ' + (Date.now() + 26000));
    } catch { /* Rocket League can also start the track from its own match-end signal. */ }
  }

  function view(pending, phase) {
    try {
      io?.write(pending.dir, 'inventory-result-view.txt', [resultToken(pending), phase, Date.now()].join(' '));
    } catch { /* The game can still show its immediate scoreboard. */ }
  }

  function nativeReady(pending) {
    try {
      const [token, at] = io.read(pending.dir, 'inventory-result-native.txt').trim().split(/\s+/);
      return token === resultToken(pending) && Number(at) >= pending.raisedAt - 20000 && Number(at) <= Date.now();
    } catch { return false; }
  }

  async function waitForNativeFrame(pending) {
    if (nativeReady(pending)) return true;
    try {
      const [token, at] = io.read(pending.dir, 'inventory-result-snapshot.tsv').split(' ', 2);
      if (token !== resultToken(pending) || !(Date.now() - Number(at) < 20000)) return false;
    } catch { return false; }
    const state = curtain.readState?.(pending.dir);
    if (state?.at === pending.at && state.on) {
      try { lower.call(curtain, pending.dir); } catch {}
    }
    const deadline = Date.now() + 1500;
    while (gate === pending && !nativeReady(pending) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (gate !== pending) return false;
    if (nativeReady(pending)) return true;
    if (state?.at === pending.at && state.on) {
      try { if (curtain.readState?.(pending.dir)?.at === state.at) curtain.writeState?.(pending.dir, state); } catch {}
    }
    return false;
  }

  function startHold(pending, phase) {
    if (gate !== pending || pending.finished || pending.holding) return;
    pending.holding = true;
    clearTimeout(pending.timeout);
    view(pending, phase);
    if (pending.hadTimeout) cueIntermission(pending);
    const duration = pending.payload.seriesOver ? finalDelayMs : delayMs;
    const now = Date.now();
    let since = now;
    try {
      const [token, at] = io.read(pending.dir, 'inventory-result-snapshot.tsv').split(' ', 2);
      if (!pending.hadTimeout && token === resultToken(pending) && Number(at) <= now && now - Number(at) < 12000)
        since = Number(at);
    } catch { /* Start the clock at the confirmed card if the game snapshot is unavailable. */ }
    pending.deadline = since + duration;
    if (!pending.payload.seriesOver) {
      const lead = Math.min(loadLeadMs, Math.floor(duration * 0.6));
      pending.loadTimer = setTimeout(() => releaseLaunch(pending), Math.max(0, pending.deadline - lead - now));
      try { io?.write(pending.dir, 'inventory-intermission.txt', [resultToken(pending), since, pending.deadline].join(' ')); }
      catch { /* Game preparation still runs on its own timer. */ }
    }
    pending.timeout = setTimeout(() => finish(pending), Math.max(0, pending.deadline - now));
  }

  function releaseLaunch(pending) {
    if (pending.launchedAt || pending.cancelled) return;
    pending.launchedAt = Date.now();
    pending.release?.();
  }

  function observeArena(pending) {
    if (!pending.launchedAt || pending.payload.seriesOver) return false;
    try {
      const [token, readyAt] = io.read(pending.dir, 'inventory-arena-ready.txt').trim().split(/\s+/);
      const expected = session + '-' + pending.payload.fixtureId + '-' + pending.payload.history.length;
      const elapsed = Number(readyAt) - pending.launchedAt;
      if (token !== expected || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 20000) return false;
      if (!pending.sampledArena) {
        pending.sampledArena = true;
        loadLeadMs = Math.round(Math.min(10000, Math.max(750, loadLeadMs * .35 + (elapsed + 120) * .65)));
      }
      return true;
    } catch { return false; }
  }

  function finish(pending) {
    if (pending.finished) return;
    pending.finished = true;
    clearTimeout(pending.timeout);
    clearTimeout(pending.loadTimer);
    if (!pending.cancelled) {
      view(pending, 'released');
      releaseLaunch(pending);
    } else pending.release?.();
  }

  function clearGate() {
    if (!gate) return;
    gate.cancelled = true;
    const pending = gate;
    finish(pending);
    observeArena(pending);
    try { io?.write(pending.dir, 'inventory-intermission.txt', ''); } catch {}
    view(pending, 'closed');
    gate = undefined;
    for (const action of pending.focus) {
      try { action(); } catch { /* The window can already be closed. */ }
    }
  }

  curtain.raise = function raiseBroadcast(options) {
    clearGate();
    const payload = latest;
    const matchesResult = payload && options?.spec === null && Boolean(options.seat) !== payload.seriesOver &&
      payload.fixtureId === String(options.matchId) && payload.history.length === options.game;
    if (matchesResult && officialBreak?.(options.matchId,options.game)) {
      latest=undefined;
      return raise.call(this,{...options,prev:null});
    }
    const at = raise.call(this, matchesResult ? { ...options, prev: null } : options);
    if (matchesResult) {
      const pending = { at, dir: options.dir, payload, focus: [], raisedAt: Date.now() };
      pending.wait = new Promise(resolve => { pending.release = resolve; });
      gate = pending;
      view(pending, 'waiting');
      cueIntermission(pending);
      if (payload.seriesOver) {
        // The Hub returns focus to itself in the same call that raises the final card.
        deferFocus = pending;
        queueMicrotask(() => { if (deferFocus === pending) deferFocus = undefined; });
      }
      pending.timeout = setTimeout(() => finish(pending), (payload.seriesOver ? finalDelayMs : delayMs) + 12000);
    }
    return at;
  };

  curtain.lower = function lowerBroadcast(dir, ...args) {
    if (gate?.dir === dir) {
      const pending = gate;
      if (pending.holding && !pending.finished && observeArena(pending)) {
        setTimeout(() => { if (gate === pending) clearGate(); }, Math.max(0, pending.deadline - Date.now()));
      } else clearGate();
    }
    latest = undefined;
    return lower.call(this, dir, ...args);
  };
  curtain.renderHub = async function renderBroadcast(options) {
    const pending = gate;
    if (pending && options.query?.talk && options.at === pending.at &&
        String(options.fxId) === pending.payload.fixtureId) {
      const card = await renderHub.call(this, options);
      if (gate === pending && card?.shown && card.talk) {
        pending.hadTimeout = true;
        view(pending, 'timeout');
      }
      return card;
    }
    if (!pending || options.kind !== (pending.payload.seriesOver ? 'series' : 'game') ||
        options.query || options.at !== pending.at ||
        String(options.fxId) !== pending.payload.fixtureId) return renderHub.call(this, options);
    if (await waitForNativeFrame(pending)) {
      startHold(pending, 'native');
      try { lower.call(this, pending.dir); } catch { /* The in-game scoreboard remains active. */ }
      return { ready: true, shown: false };
    }
    const overtimeSeconds = pending.payload.overtime
      ? readOvertime?.(pending.dir, pending.payload.fixtureId, pending.payload.history.length)
      : undefined;
    const code = renderer + JSON.stringify({ ...pending.payload, overtimeSeconds, intermission: true,
      seconds: Math.ceil((pending.payload.seriesOver ? finalDelayMs : delayMs) / 1000),
      next: options.next }) + ')';
    let installed = false;
    function CardWindow(...args) {
      const window = new options.BrowserWindow(...args);
      const contents = window.webContents;
      const execute = contents.executeJavaScript.bind(contents);
      contents.executeJavaScript = async function renderCard(script, ...rest) {
        if (!installed && /\bcardTrack\b/.test(script)) {
          try { installed = await execute(code) === true; } catch { /* Native card remains available. */ }
          if (installed) {
            try { await execute('new Promise(resolve => {setTimeout(resolve,120);requestAnimationFrame(() => requestAnimationFrame(resolve));})'); } catch {}
          }
        }
        return execute(script, ...rest);
      };
      return window;
    }
    let card;
    try {
      card = await renderHub.call(this, { ...options, BrowserWindow: CardWindow });
      return card;
    } finally {
      if (gate === pending && !pending.finished) {
        if (nativeReady(pending)) {
          startHold(pending, 'native');
          try { lower.call(this, pending.dir); } catch { /* The in-game scoreboard remains active. */ }
        } else startHold(pending, installed && card?.shown !== false ? 'card' : 'fallback');
      }
    }
  };
  injector.prepare = async function prepareAfterIntermission(options, ...args) {
    const pending = gate;
    if (pending?.wait && !pending.payload.seriesOver && !options?.deferStart && typeof options?.current === 'function') {
      await pending.wait;
      if (pending.cancelled || !options.current()) return false;
    }
    return prepare.call(this, options, ...args);
  };
  rcon.send = async function armAfterIntermission(commands, ...args) {
    const pending = gate;
    if (pending?.payload.seriesOver && Array.isArray(commands) && commands.length === closeSeriesCommands.length &&
        closeSeriesCommands.every((command, index) => command === commands[index])) {
      await pending.wait;
      if (pending.cancelled) return false;
    }
    if (pending?.wait && !pending.payload.seriesOver && commands?.some?.(command => command === 'rlcareer_arm ' + pending.payload.fixtureId ||
        command === 'rlcareer_arm ' + pending.payload.fixtureId + ' spectate')) {
      await pending.wait;
      if (pending.cancelled) return false;
    }
    return send.call(this, commands, ...args);
  };

  function applyResult(state, fixture, report, ...rest) {
    const count = fixture?.games?.length ?? 0;
    const result = original.call(this, state, fixture, report, ...rest);
    try {
      const games = fixture?.games;
      if (result?.error || report?.abandoned || report?.estimated || games?.length !== count + 1) return result;
      const game = games.at(-1);

      const players = Array.isArray(game.reported?.players) ? game.reported.players : [];

      const clubIsHome = engine.userSideId(state, fixture) === fixture.homeId;
      const sides = [0, 1].map(index => {
        const home = index === (clubIsHome ? 0 : 1);
        const team = engine.teamById(state, home ? fixture.homeId : fixture.awayId);
        return { name: team?.name, tag: team?.abbrev || team?.tag || team?.abbr, logo: team?.logo, goals: home ? game.homeGoals : game.awayGoals,
          players: players.filter(player => player?.team === index).map(player => ({
            name: player.name, score: player.score, goals: player.goals, assists: player.assists,
            shots: player.shots, saves: player.saves, demos: player.demos
          })) };
      });
      if (sides.some(side => !side.name ||
          !Number.isSafeInteger(side.goals) || side.goals < 0)) return result;
      const event = state.events?.find?.(entry => entry.id === fixture.eventId);
      const regionId = event?.regionId ?? (event && !['major', 'worlds'].includes(event.kind) ? state.userRegion : null);
      const region = state.regions?.find?.(entry => entry.id === regionId)?.short ??
        event?.region ?? (typeof regionId === 'string' ? regionId : null);
      const stage = String(fixture.stage ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
      const rounds = {
        qf: 'Quarterfinal', quarterfinal: 'Quarterfinal', sf: 'Semifinal', semifinal: 'Semifinal',
        final: 'Final', gf: 'Grand Final', 'grand final': 'Grand Final',
        'upper final': 'Upper Final', 'lower final': 'Lower Final'
      };
      const phase = stage.startsWith('swiss') ? 'Swiss Stage' :
        stage === 'group' || stage === 'group stage' ? 'Group Stage' :
        rounds[stage] || /^(playoffs?|upper|lower)\b/.test(stage) ? 'Playoffs' : null;
      const round = rounds[stage] ?? (stage && !['group', 'group stage', 'playoff', 'playoffs', 'swiss', 'swiss stage']
        .includes(stage) ? stage.replace(/^swiss\s+/, '') : null);
      for (const side of sides) {
        side.players = side.players.slice(0, 3);
        while (side.players.length < 3) side.players.push({});
      }
      latest = { fixtureId: String(fixture.id), seriesOver: Boolean(result?.seriesOver),
        sides, event: event?.name, region, phase, round,
        overtime: game.overtime, bestOf: fixture.bestOf,
        history: games.map(entry => (entry.homeGoals > entry.awayGoals) === clubIsHome ? 0 : 1)
      };
    } catch { /* Keep native result handling independent of the overlay. */ }
    return result;
  }
  applyResult.rlcBroadcast = true;
  engine.applyUserResult = applyResult;
  return 'installed';
}

async function showBroadcastResult(data) {
  const fields = [
    ['score', 'Score'], ['goals', 'Goals'], ['assists', 'Assists'],
    ['shots', 'Shots'], ['saves', 'Saves'], ['demos', 'Demos']
  ];
  let dialog = document.getElementById('rlc-broadcast');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'rlc-broadcast';
    dialog.setAttribute('aria-label', 'Match results');
    document.body.prepend(dialog);
  }
  dialog.replaceChildren();
  const style = document.createElement('style');
  style.textContent = `
    #rlc-broadcast{--blue:#38b6ed;--orange:#ff6a23;box-sizing:border-box;width:min(1080px,96vw);max-width:none;max-height:95vh;overflow:auto;padding:clamp(12px,2.5vw,34px);border:1px solid #4c555d;color:#f5f6f7;background:linear-gradient(0deg,#060709ed,transparent 58%),repeating-linear-gradient(118deg,#101317 0 9%,#232a33 9.2% 15%,#08090b 15.2% 27%);box-shadow:0 22px 100px #000;font:italic 800 16px "Bahnschrift","Arial Narrow",Arial,sans-serif;text-align:center}
    html.rlc-intermission body > :not(#rlc-broadcast){display:none!important}
    html.rlc-intermission,html.rlc-intermission body{margin:0!important;background:#090b0e!important}
    html.rlc-intermission #rlc-broadcast{position:fixed;inset:0;margin:0;width:100%;height:100%;max-height:none;border:0;padding:3vh 4vw;overflow:hidden}
    #rlc-broadcast .rb-loading{font-size:clamp(11px,1.65vw,19px);letter-spacing:.08em;text-transform:uppercase}
    #rlc-broadcast .rb-loading .card-track{display:block!important;position:static!important;width:min(25.2vw,65%);height:max(4px,.83vh);margin:8px auto 0;background:#242d37;outline:1px solid #586571;color:#26c0ff}
    #rlc-broadcast::backdrop{background:#040508d9}
    #rlc-broadcast *{box-sizing:border-box}
    #rlc-broadcast .rb-context{text-transform:uppercase;letter-spacing:.13em;color:#c6cbd1;font-size:clamp(10px,1.4vw,15px);padding:8px;background:#101215cc}
    #rlc-broadcast .rb-score{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto auto auto minmax(0,1fr);align-items:stretch;border:1px solid #e0e3e8;background:#070809;margin:0 auto}
    #rlc-broadcast .rb-score>*{display:grid;place-items:center;padding:4px clamp(4px,1.1vw,15px);border-right:1px solid #a9b0b7;min-width:0}
    #rlc-broadcast .rb-score>*:last-child{border-right:0}
    #rlc-broadcast .rb-team{text-transform:uppercase;overflow-wrap:anywhere;font-size:clamp(12px,2.7vw,30px);box-shadow:inset 0 -3px var(--accent)}
    #rlc-broadcast .rb-tag{color:var(--accent);font-size:clamp(9px,1.5vw,18px)}
    #rlc-broadcast .rb-crest{width:clamp(21px,3.5vw,52px);height:clamp(21px,3.5vw,52px);object-fit:contain;filter:drop-shadow(0 0 1px #e5edf6b0)}
    #rlc-broadcast .rb-num{font-size:clamp(23px,5vw,56px);line-height:1;font-variant-numeric:tabular-nums}
    #rlc-broadcast .rb-status{background:#e7ebef;color:#0c1016;font-size:clamp(9px,1.3vw,15px);font-style:normal}
    #rlc-broadcast .rb-status.ot{padding:0;grid-template-rows:1fr 1fr}
    #rlc-broadcast .rb-status.ot>*{display:grid;place-items:center;width:100%;height:100%;padding:1px 8px}
    #rlc-broadcast .rb-ot-time{background:#a91522;color:white;font-variant-numeric:tabular-nums}
    #rlc-broadcast .rb-series{display:flex;justify-content:center;gap:5px;padding:6px}
    #rlc-broadcast .rb-segment{height:6px;width:clamp(10px,3.8vw,45px);background:var(--rb-segment-color,#666c73)}
    #rlc-broadcast .rb-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(65px,1.35fr) repeat(3,minmax(0,1fr));gap:4px;margin:clamp(12px,3vh,34px) 0 12px}
    #rlc-broadcast .rb-player,#rlc-broadcast .rb-col,#rlc-broadcast .rb-labels{display:grid;grid-template-rows:minmax(38px,auto) repeat(6,minmax(28px,1fr));min-width:0}
    #rlc-broadcast .rb-player{background:#030405c9}
    #rlc-broadcast .rb-player>* ,#rlc-broadcast .rb-labels>*{display:grid;align-content:center;min-width:0}
    #rlc-broadcast .rb-player .rb-name{border-bottom:4px solid var(--accent);background:#13171c;text-transform:uppercase;padding:3px;overflow-wrap:anywhere;font-size:clamp(9px,1.5vw,16px)}
    #rlc-broadcast .rb-stat{font-size:clamp(12px,2.1vw,24px);font-variant-numeric:tabular-nums;padding:clamp(2px,1vh,11px) 0}
    #rlc-broadcast .rb-top{color:var(--accent)}
    #rlc-broadcast .rb-player .rb-name.rb-top{display:flex;align-items:center;justify-content:center;gap:.35em;
      background:linear-gradient(110deg,color-mix(in srgb,var(--accent) 20%,#10151d),#13171c)}
    #rlc-broadcast .rb-mvp-mark{flex:none;color:inherit}
    #rlc-broadcast .rb-labels{font-size:clamp(9px,1.8vw,21px);text-transform:uppercase;background:#101317ad}
    #rlc-broadcast .rb-metric{padding:3px 6px}
    #rlc-broadcast .rb-meter{height:3px;margin-top:4px;background:linear-gradient(90deg,var(--blue) 0 var(--split),var(--orange) var(--split) 100%)}
    #rlc-broadcast button{border:1px solid #69717b;background:#0f1318;color:white;padding:7px 18px;font:inherit;cursor:pointer}
    #rlc-broadcast button:hover,#rlc-broadcast button:focus-visible{background:#263443}
  `;
  dialog.append(style);
  function add(parent, tag, className, label) {
    const element = document.createElement(tag);
    element.className = className;
    if (label != null) element.textContent = label;
    parent.append(element);
    return element;
  }
  function accent(element, side) {
    element.style.setProperty('--accent', side === 0 ? 'var(--blue)' : 'var(--orange)');
  }
  add(dialog, 'header', 'rb-context', data.header || [data.event, data.region, data.phase, data.round].filter(value => typeof value === 'string' && value)
    .join('  |  ') || 'Post-match');
  const [blue, orange] = data.sides;
  const scoreboard = add(dialog, 'div', 'rb-score');
  const logoLoads = [];
  function clubBadge(side, index) {
    const fallback = side.tag || side.name.slice(0, 3).toUpperCase();
    const cell = add(scoreboard, 'span', 'rb-tag', fallback);
    accent(cell, index);
    const embedded = typeof side.crest === 'string' && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(side.crest);
    if (!embedded && typeof side.logo !== 'string') return;
    const custom = /^custom:([a-f0-9]{20})$/.exec(side.logo);
    const asset = /^[^/\\:?#]+\.(?:png|webp|jpe?g|svg)$/i.test(side.logo);
    if (!embedded && !custom && !asset) return;
    const img = (embedded && window.__rlcPostmatchCrests?.get(side.crest)) || document.createElement('img');
    img.className = 'rb-crest';
    img.alt = side.name;
    if (!img.src) img.src = embedded ? side.crest :
      custom ? 'rlcart://art/' + custom[1] + '.png' : 'logos/' + encodeURIComponent(side.logo);
    const decoded = img.decode().then(() => true, () => false);
    const ready = embedded ? decoded : Promise.race([decoded, new Promise(resolve => setTimeout(resolve, 350, false))]);
    logoLoads.push(ready.then(ok => { if (ok) cell.replaceChildren(img); }));
  }
  accent(add(scoreboard, 'strong', 'rb-team', blue.name), 0);
  clubBadge(blue, 0);
  add(scoreboard, 'strong', 'rb-num', blue.goals);
  const status = add(scoreboard, 'span', 'rb-status' + (data.overtime ? ' ot' : ''));
  if (data.overtime) {
    add(status, 'span', '', 'OT');
    const seconds = data.overtimeSeconds;
    const duration = Number.isSafeInteger(seconds) && seconds >= 0
      ? '+' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
      : '—';
    add(status, 'span', 'rb-ot-time', duration);
  } else {
    status.textContent = 'FT';
    status.title = 'Full time';
  }
  add(scoreboard, 'strong', 'rb-num', orange.goals);
  clubBadge(orange, 1);
  accent(add(scoreboard, 'strong', 'rb-team', orange.name), 1);
  const series = add(dialog, 'div', 'rb-series');
  const seriesWins = data.sides.map((_, index) => data.history.filter(winner => winner === index).length);
  series.setAttribute('aria-label', 'Series' + ' ' + seriesWins.join('–'));
  series.title = series.getAttribute('aria-label');
  const totalGames = Math.max(data.history.length, Math.min(9, data.bestOf || 1));
  for (let game = 0; game < totalGames; game++) {
    const segment = add(series, 'span', 'rb-segment');
    if (game < seriesWins[0]) segment.style.setProperty('--rb-segment-color', 'var(--blue)');
    else if (game >= totalGames - seriesWins[1]) segment.style.setProperty('--rb-segment-color', 'var(--orange)');
  }

  const stats = add(dialog, 'div', 'rb-stats');
  const leaders = data.sides.flatMap(side => side.players);
  const winningSide = blue.goals > orange.goals ? 0 : orange.goals > blue.goals ? 1 : -1;
  const winningPlayers = data.sides[winningSide]?.players || [];
  const valid = number => Number.isSafeInteger(number) && number >= 0;
  const mvp = winningPlayers.reduce((best, player) => valid(player.score) && (!best || player.score > best.score) ? player : best, null);
  function columns(side, index) {
    for (const player of side.players) {
      const best = player === mvp;
      const col = add(stats, 'div', 'rb-player');
      accent(col, index);
      const name = add(col, 'strong', best ? 'rb-name rb-top' : 'rb-name');
      if (best) {
        add(name, 'span', 'rb-mvp-mark', '✦').setAttribute('aria-hidden', 'true');
        name.title = 'MVP';
      }
      add(name, 'span', '', player.name || '—');
      for (const [key] of fields) add(col, 'span', best ? 'rb-stat rb-top' : 'rb-stat',
        valid(player[key]) ? player[key] : '—');
    }
  }
  columns(blue, 0);
  const labels = add(stats, 'div', 'rb-labels');
  add(labels, 'span', '');
  for (const [key, label] of fields) {
    const row = add(labels, 'div', 'rb-metric', label);
    if (!leaders.every(player => valid(player[key]))) continue;
    const left = blue.players.reduce((sum, player) => sum + player[key], 0);
    const right = orange.players.reduce((sum, player) => sum + player[key], 0);
    if (left + right) add(row, 'i', 'rb-meter').style.setProperty('--split', (100 * left / (left + right)) + '%');
  }
  columns(orange, 1);
  await Promise.all(logoLoads);
  if (data.intermission) {
    const winner = seriesWins[0] > seriesWins[1] ? blue : orange;
    const footer = add(dialog, 'footer', 'rb-loading', data.seriesOver
      ? winner.name + ' · ' + 'Series winner' + ' · ' + seriesWins.join('–')
      : 'Next game' + ' ' + data.next + ' · ' +
        'Intermission' + ' ' + data.seconds + ' s');
    if (!data.seriesOver) add(footer, 'div', 'card-track');
    if (!dialog.open) dialog.show();
    document.documentElement.classList.add('rlc-intermission');
    return true;
  }
  add(dialog, 'button', '', 'Close').onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
}

module.exports = { installBroadcastResult, showBroadcastResult };
