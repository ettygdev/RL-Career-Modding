'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { installInventoryEngine } = require('./src/inventory.cjs');
const { installInventoryUi } = require('./src/inventory-ui.cjs');
const { createThumbnailLoader } = require('./src/thumbnails.cjs');
const { installCameraBridge } = require('./src/camera-bridge.cjs');
const { createLiquipediaCameraLookup } = require('./src/liquipedia-cameras.cjs');
const cameraProfiles = require('./src/camera-profiles.json');
const fsNative = require('node:fs');
const os = require('node:os');
const titleCatalog = require('./src/title-catalog.json');

const samples = {
  boost: [[32, '(Alpha Reward) Gold Rush'], [10, 'Standard']],
  decal: [[4382, 'Ombre', 4284]],
  goal: [[2044, 'Dueling Dragons']],
  body: [[23, 'Octane'], [4284, 'Fennec']]
};
const order = [{ key: 'boost', list: 'boost', index: 3, paint: true }, { key: 'decal', list: 'decal', index: 1, paint: true },
  { key: 'goal', list: 'goal', index: 15, paint: true }];
const codec = process.argv[2] ? require(path.resolve(process.argv[2])) : {
  PAINTS: ['None', 'Crimson', 'Lime', 'Black'],
  encode: value => Buffer.from(JSON.stringify(value)).toString('base64'),
  decode: code => JSON.parse(Buffer.from(code, 'base64')),
  normalize: value => value,
  bodyOf: id => id,
  codeFor: () => ''
};
const locker = {
  SLOTS: order,
  SLOT_BY_KEY: Object.fromEntries(order.map(value => [value.key, value])),
  itemIn: (list, id) => samples[list]?.find(row => row[0] === id),
  ...codec
};
const titles = { choices: () => [{ key: 'earned', display: 'Champion', year: 2026 }] };
const writes = new Map();
const directory = path.resolve('fixture/data/rlcareermode');
const file = path.join(directory, 'locker.txt');
let bodyId = 4284;
const fs = {
  readFileSync: candidate => candidate.endsWith('my_body.txt') ? String(bodyId) : '',
  writeFileSync: (candidate, value) => writes.set(candidate, value)
};
const rcon = { send: commands => commands };
const fixture = { id: 19, games: [{ measured: true }] };
const engine = {
  setDayNote: () => ({ native: true }),
  playerById: () => ({ id: 1 }),
  teamById: (state, id) => state.teams?.find(team => team.id === id),
  isPlayerCareer: state => state.playerCareer === true,
  fixtureById: () => fixture,
  sideLineup: () => [1, 2, 3],
  matchTitleLines: state => [state.locker?.title || 'native'],
  applyUserResult(_state, fixture) {
    if (fixture.played) return { alreadyPlayed: true };
    fixture.played = true;
    return { seriesOver: true, weWon: true };
  }
};
assert.equal(installInventoryEngine(engine, locker, titles, rcon, fs, path, null, titleCatalog), 'installed');
assert.equal(installInventoryEngine(engine, locker, titles, rcon, fs, path, null, titleCatalog), 'already-installed');
assert.deepEqual(engine.setDayNote({}, '2026-11-22', 'note'), { native: true });
assert.deepEqual(engine.matchTitleLines({ locker: null }, []), ['native']);

const state = { userPlayerId: 1, userTeamId: 7, teams: [{ id: 7, budget: 2500 }],
  currentDate: '2026-11-22', pendingMatch: null, locker: null };
const act = (type, args) => engine.setDayNote(state, 'rlc-inventory/v1', JSON.stringify({ type, ...args }));
assert.equal(act('open').ok, true);
assert.equal(state.rlcInventory.titles.length, 22);

assert.equal(act('equip', { slot: 'boost', id: 32 }).ok, false);
assert.equal(act('buy', { slot: 'boost', id: 32 }).ok, true);
assert.equal(act('buy', { slot: 'boost', id: 32 }).ok, true);
assert.equal(act('buy', { slot: 'decal', id: 4382 }).ok, false);
assert.equal(state.teams[0].budget, 100);
assert.equal(state.ledger.length, 1);
assert.equal(state.ledger[0].amount, -2400);
state.playerCareer = true;
assert.equal(act('buy', { slot: 'boost', id: 10 }).ok, false);
state.playerCareer = false;
assert.equal(act('equip', { slot: 'boost', id: 32 }).ok, true);
state.teams[0].budget += 1100;
assert.equal(act('buy', { slot: 'decal', id: 4382 }).ok, true);
assert.equal(act('buy', { slot: 'goal', id: 2044 }).ok, true);
assert.equal(act('equip', { slot: 'decal', id: 4382 }).ok, true);
assert.equal(act('equip', { slot: 'goal', id: 2044 }).ok, true);
assert.equal(act('paint', { slot: 'decal', id: 4382, paint: 1 }).ok, true);
assert.equal(act('paint', { slot: 'goal', id: 2044, paint: 3 }).ok, true);
assert.equal(act('paint', { slot: 'goal', id: 4382, paint: 1 }).ok, false);
assert.equal(act('paint', { slot: 'goal', id: 2044, paint: 99 }).ok, false);
assert.equal(act('equip', { slot: 'decal', id: 4382 }).ok, true);
assert.equal(state.rlcInventory.presets[0].items.decal.paint, 1);
assert.equal(act('title', { key: 'unearned' }).ok, false);
assert.equal(act('title', { key: 'earned' }).ok, true);
assert.equal(act('title', { key: 'id:S35_SuperSonic_Legend' }).ok, true);
assert.equal(act('colors', { side: 'blue', primary: '#123456', secondary: '#fedcba' }).ok, true);
assert.equal(act('colors', { side: 'blue', primary: 'bad', secondary: '#000000' }).ok, false);
assert.equal(act('preset', { index: 1 }).ok, true);
assert.deepEqual(state.rlcInventory.presets[1].items, {});
assert.equal(act('preset', { index: 0 }).ok, true);

engine.sideLineup(state, fixture);
assert.deepEqual(engine.matchTitleLines(state, []), ['native', '@you\tS35_SuperSonic_Legend\t']);
assert.equal(act('title', { key: 'id:AutoTour_23_SuperSonicLegend_1' }).ok, false);
state.rlcInventory.presets[1].title = 'id:AutoTour_23_SuperSonicLegend_2';
act('open');
assert.equal(state.rlcInventory.presets[1].title, null);
assert.equal(state.rlcInventory.titles.some(title => title.key.includes('AutoTour_')), false);
assert.equal(act('title', { key: 'id:S35_SuperSonic_Legend' }).ok, true);
engine.matchTitleLines(state, []);
fs.writeFileSync(file, '\n');
const deck = locker.decode(writes.get(file).trim());
assert.deepEqual(deck.blue.colors, { primary: [18, 52, 86], secondary: [254, 220, 186] });
if (process.argv[2]) {
  assert.equal(deck.blue.items[3].id, 32);
  assert.deepEqual(deck.blue.items[1], { id: 4382, paint: 1 });
  assert.deepEqual(deck.orange.items[15], { id: 2044, paint: 3 });
  bodyId = 23;
  engine.matchTitleLines(state, []);
  fs.writeFileSync(file, '\n');
  assert.equal(locker.decode(writes.get(file).trim()).blue.items[1], undefined);
  bodyId = 4284;
}
assert.equal(act('custom-colors', { enabled: false }).ok, true);
engine.matchTitleLines(state, []);
fs.writeFileSync(file, '\n');
if (process.argv[2]) assert.equal(locker.decode(writes.get(file).trim()).blue.colors, null);
assert.equal(state.rlcInventory.presets[0].colors.blue.primary, '#123456');
act('custom-colors', { enabled: true });
engine.matchTitleLines(state, []);
fs.writeFileSync(file, '\n');
assert.deepEqual(rcon.send(['rcon_refresh_allowed', 'rlcareer_arm 19']),
  ['rcon_refresh_allowed', 'rlcareer_locker', 'rlcareer_arm 19']);
assert.deepEqual(rcon.send(['rlcareer_arm 19 spectate']), ['rlcareer_arm 19 spectate']);
fixture.spectating = true;
assert.deepEqual(engine.matchTitleLines(state, []), ['native']);
fs.writeFileSync(file, '\n');
assert.equal(writes.get(file), '\n');
fixture.spectating = false;
engine.applyUserResult(state, fixture, {});
engine.applyUserResult(state, fixture, {});
assert.equal(state.teams[0].budget, 100);

async function testUi() {
  const listeners = new Map();
  let html = '';
  const ctx = vm.createContext({
    S: { career: state, saveId: 'save1', lang: 'en' },
    tab: 'inventory',
    topbarHtml: () => '<button class="" data-action="tab" data-tab="inbox">Office</button>',
    tabInnerHtml: () => '<div>Native</div>',
    window: { hub: {
      lockerItems: async () => ({ order, slots: samples, paints: locker.PAINTS }),
      setDayNote: async () => ({ ok: true, career: state, saveId: 'save1', lang: 'en' })
    } },
    document: { addEventListener: (name, listener) => listeners.set(name, listener), createElement: () => ({}),
      querySelectorAll: () => [], head: { appendChild() {} } },
    queueMicrotask,
    render() { html = vm.runInContext('tabInnerHtml()', ctx); },
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  });
  assert.equal(vm.runInContext('(' + installInventoryUi.toString() + ')()', ctx), 'installed');
  assert.match(vm.runInContext('topbarHtml()', ctx), /data-tab="inventory">Inventory.*data-tab="inbox"/);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(html, /Club budget · \$100/);
  assert.match(html, /Save colors/);
  assert.match(html, /Use Inventory colors in matches/);
  assert.match(html, /data-inv-paint="4382"/);
  assert.match(html, /data-inv-paint="2044"/);
  assert.match(html, /Required body · Fennec/);
  listeners.get('click')({ target: { closest: () => ({ dataset: { inv: 'pane', key: 'shop' } }) } });
  assert.match(html, /Alpha Boost/);
  assert.match(html, /Gold Rush/);
  assert.equal((html.match(/<article class="inv-item">/g) || []).length +
    (html.match(/class="inv-item inv-placeholder"/g) || []).length, 12);
  listeners.get('click')({ target: { closest: () => ({ dataset: { inv: 'pane', key: 'owned' } }) } });
  assert.match(html, /Gold Rush/);
  assert.doesNotMatch(html, /<strong title="Standard"/);
  listeners.get('click')({ target: { closest: () => ({ dataset: { inv: 'pane', key: 'titles' } }) } });
  assert.match(html, /Champion/);
  assert.match(html, /type="radio"/);
  assert.match(html, /S21 Supersonic Legend/);
  assert.match(html, /Ranked seasons/);
  assert.doesNotMatch(html, /Tournaments/);
  assert.match(html, /--inv-title-glow:#FF2800/);
  assert.match(html, /class="inv-title-equipped"/);
  console.log('Club budget, owned items, fixed pagination, colors, titles and match handoff passed.');
}

async function testThumbnails() {
  const calls = [];
  const sent = [];
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const load = createThumbnailLoader((id, image, paints) => sent.push([id, image, paints]), async url => {
    calls.push(url);
    if (url.endsWith('/32')) return { ok: true, json: async () => ({ id: 32, thumbnail_url: '/thumbnails/boost_alpha.png', Paints: [{ id: 99, label: 'Crimson' }] }) };
    if (url.endsWith('/35')) return { ok: true, json: async () => ({ id: 35, thumbnail_url: 'https://elsewhere.invalid/test.png' }) };
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  await load([32, 35]);
  await load([32]);
  assert.equal(calls.length, 3);
  assert.equal(sent.length, 2);
  assert.match(sent[0][1], /^data:image\/png;base64,/);
  assert.deepEqual(sent[0][2], ['Crimson']);
  console.log('Thumbnail origin, PNG, local data URI and cache verified.');
}

async function testCameraBridge() {
  const directory = fsNative.mkdtempSync(path.join(os.tmpdir(), 'career-camera-test-'));
  const data = path.join(directory, 'data', 'rlcareermode');
  const cfg = path.join(directory, 'cfg', 'plugins.cfg');
  const dll = path.join(directory, 'plugins', 'rlcareercameras.dll');
  const matchData = path.join(data, 'inventory-cameras.tsv');
  const timeoutFile = path.join(data, 'talk', 'timeout-ok.json');
  for (const folder of [data, path.dirname(cfg), path.dirname(dll), path.dirname(timeoutFile)]) fsNative.mkdirSync(folder, { recursive: true });
  fsNative.writeFileSync(cfg, 'plugin load rlcareermode\r\n');
  if (process.env.RLC_TEST_PREVIOUS_CAMERA_DLL) fsNative.copyFileSync(process.env.RLC_TEST_PREVIOUS_CAMERA_DLL,dll);
  const fs = { ...fsNative };
  const names = ['', 'zen', 'Vatira', 'Atow.', 'Unknown bot', 'Daniel', 'BeastMode', 'You'];
  const engine = {
    sideLineup: () => [1, 2, 3],
    userSideId: () => 1,
    teamById: (_, id) => ({ id }),
    lineupFor: () => [4, 5, 6],
    playerById: (_, id) => ({ name: names[id], real: id !== 7 })
  };
  const state = { userPlayerId: 7 };
  const fixture = { id: 9, stage: 'final', homeId: 1, awayId: 2, games: [], bestOf: 7, homeWins: 1, awayWins: 2, spectating: true };
  const lockerFile = path.join(data, 'locker.txt');
  const fakePlugin = Buffer.from('camera plugin');
  let finishLookup;
  const lookup = names => {
    assert.deepEqual(names, ['Unknown bot']);
    return new Promise(resolve => { finishLookup = resolve; });
  };
  assert.equal(installCameraBridge(engine, fs, path, cameraProfiles, fakePlugin.toString('base64'), lookup,
    false, {}, undefined, undefined, undefined, undefined,
    () => ['OPEN', 'NA', 'GRAND FINAL'],false,undefined,undefined,undefined,
    (_state,match)=>match.games.length===0), 'installed');
  engine.sideLineup(state, fixture);
  fs.writeFileSync(timeoutFile,JSON.stringify({matchId:'9',game:1,allow:false}));
  assert.equal(JSON.parse(fs.readFileSync(timeoutFile,'utf8')).allow,true);
  fs.writeFileSync(lockerFile, '\n');
  const first = fs.readFileSync(matchData, 'utf8');
  assert.match(first, /^\S+-9-0 \d+ 6 1 7 1 2\n/);
  assert.match(first, /\nzen\t110\t100\t-3\t270\t0\.35\t4\t1\.4\n/);
  assert.match(first, /\nAtow\.\t110\t100/);
  assert.match(first, /\nUnknown bot\n/);
  assert.match(first, /OPEN \| NA \| PLAYOFFS \| GRAND FINAL\n0\n$/);
  assert.deepEqual(fs.readFileSync(dll), fakePlugin);
  fs.writeFileSync(lockerFile, '\n');
  assert.equal(fs.readFileSync(matchData, 'utf8'), first);
  assert.equal(fs.readFileSync(cfg, 'utf8').match(/plugin load rlcareercameras/g).length, 1);
  finishLookup(new Map([['Unknown bot', [110, 100, -3, 250, 0.5, 5, 1]]]));
  await new Promise(resolve => setImmediate(resolve));
  const updated = fs.readFileSync(matchData, 'utf8');
  assert.match(updated, /^\S+-9-0\.1 \d+ 6 1 7 1 2\n/);
  assert.match(updated, /Unknown bot\t110\t100\t-3\t250\t0\.5\t5\t1/);
  fixture.games.push({});
  fs.writeFileSync(timeoutFile,JSON.stringify({matchId:'9',game:2,allow:true}));
  assert.equal(JSON.parse(fs.readFileSync(timeoutFile,'utf8')).allow,false);
  fs.writeFileSync(lockerFile, '\n');
  assert.match(fs.readFileSync(matchData, 'utf8'), /^\S+-9-1 \d+ 6 2 7 1 2\n/);
  fixture.spectating = false;
  fs.writeFileSync(lockerFile, '\n');
  assert.equal(fs.readFileSync(matchData, 'utf8'), '');
  assert.equal(cameraProfiles.profiles.length, 41);
  assert.ok(cameraProfiles.profiles.every(([, ...values]) => values.length === 7 && values.every(Number.isFinite)));
  console.log('Spectator profiles, handle matching, fallback, game rollover and normal match isolation passed.');
}

async function testLiquipedia() {
  const directory = fsNative.mkdtempSync(path.join(os.tmpdir(), 'career-camera-cache-test-'));
  const file = path.join(directory, 'camera-cache.json');
  const requests = [];
  const wikitext = '{{Camera settings table\n|date=2026-09-14\n|fov=110\n|distance=265\n|height=100\n' +
    '|angle=-3.0\n|stiffness=0.35\n|swivelspeed=4.00\n|transitionspeed=1.40\n|ref={{cite|x=y}}\n}}';
  const fetcher = async (url, options) => {
    const query = new URL(url);
    requests.push(query.searchParams.get('titles'));
    assert.equal(query.pathname, '/rocketleague/api.php');
    assert.match(options.headers['User-Agent'], /github\.com\/ettygdev/);
    return {
      ok: true,
      json: async () => ({ query: {
        redirects: [{ from: 'Sample alias', to: 'Sample' }],
        pages: [{ title: 'Sample', revisions: [{ slots: { main: { content: wikitext } } }] }, { title: 'Unlisted', missing: true }]
      } })
    };
  };
  const lookup = createLiquipediaCameraLookup(file, fsNative, fetcher);
  assert.deepEqual(await lookup(['Sample alias', 'Unlisted']), new Map([['Sample alias', [110, 100, -3, 265, 0.35, 4, 1.4]]]));
  const cached = createLiquipediaCameraLookup(file, fsNative, fetcher);
  assert.deepEqual(await cached(['Sample alias', 'Unlisted']), new Map([['Sample alias', [110, 100, -3, 265, 0.35, 4, 1.4]]]));
  assert.deepEqual(requests, ['Sample alias|Unlisted']);
  console.log('Authorized Liquipedia API lookup, redirect resolution, valid settings and cached misses passed.');
}
testUi().then(testThumbnails).then(testCameraBridge).then(testLiquipedia)
  .catch(error => { console.error(error); process.exitCode = 1; });

async function testBroadcastIntermission() {
  const assert = require('node:assert/strict');
  const { installBroadcastResult } = require('./src/broadcast.cjs');
  const fixture = { id: 42, eventId: 8, stage: 'final', homeId: 1, awayId: 2, games: [], bestOf: 5 };
  const players = Array.from({ length: 6 }, (_, index) => ({ name: 'Bot ' + index, team: index < 3 ? 0 : 1, score: index }));
  const rendered = [];
  const launches = [];
  const view = new Map();
  const hubWindow = { show: () => launches.push('hub') };
  class CardWindow {
    webContents = { executeJavaScript: async script => {
      if (script.startsWith('render(')) {
        rendered.push(JSON.parse(script.slice(7, -1)));
        return true;
      }
      assert.equal(script, 'cardTrack()');
      return { w: 400, h: 7 };
    } };
  }
  const curtain = {
    raise: () => 17, lower: () => undefined,
    renderHub: async options => new options.BrowserWindow().webContents.executeJavaScript('cardTrack()')
  };
  const injector = { prepare: async () => launches.push('prepare') };
  const rcon = { send: async () => launches.push('arm') };
  const engine = {
    userSideId: () => 2,
    teamById: (_, id) => ({ name: id === 1 ? 'Home' : 'Away', logo: id === 1 ? 'home.png' : 'away.png' }),
    applyUserResult(_, item, report) {
      if (report.abandoned) return { error: true };
      item.games.push({ homeGoals: 1, awayGoals: 2, overtime: true, reported: { players: report.players } });
      return { seriesOver: !!report.final };
    }
  };
  const install = () => installBroadcastResult(engine, curtain, injector, rcon, 'render(', 35,
    (dir, id, game) => dir === 'curtain' && id === '42' && game === 1 ? 62 : undefined,
    { write: (_, file, data) => view.set(file, data), read: (_, file) => view.get(file) },
    hubWindow, 85);
  assert.equal(install(), 'installed');
  assert.equal(install(), 'already-installed');
  const first = { dir: 'curtain', matchId: 42, game: 1, spec: {}, seat: 'watch' };
  const card = { dir: 'curtain', at: 17, kind: 'game', fxId: 42, next: 2, BrowserWindow: CardWindow };
  curtain.raise(first);
  await injector.prepare({ current: () => true });
  assert.deepEqual(launches.splice(0), ['prepare']);
  const career = { events: [{ id: 8, name: 'Open 1', regionId: 'europe' }], regions: [{ id: 'europe', short: 'EU' }] };
  assert.deepEqual(engine.applyUserResult(career, fixture, { players }), { seriesOver: false });
  curtain.raise({ ...first, spec: null });
  const starting = injector.prepare({ current: () => true });
  const arming = rcon.send(['rlcareer_arm 42 spectate']);
  await curtain.renderHub({ ...card, query: { talk: 'offer' } });
  assert.equal(rendered.length, 0);
  await curtain.renderHub(card);
  assert.deepEqual(rendered[0].sides.map(side => [side.name, side.goals]), [['Away', 2], ['Home', 1]]);
  assert.deepEqual(rendered[0].history, [0]);
  assert.equal(rendered[0].overtimeSeconds, 62);

  assert.deepEqual([rendered[0].event, rendered[0].region, rendered[0].phase, rendered[0].round],
    ['Open 1', 'EU', 'Playoffs', 'Final']);
  assert.deepEqual(rendered[0].sides.map(side => side.logo), ['away.png', 'home.png']);
  assert.equal(rendered[0].sides[0].players[2].score, 2);
  assert.deepEqual(launches, []);
  await Promise.all([starting, arming]);
  assert.deepEqual(launches.splice(0), ['prepare', 'arm']);
  fixture.stage = 'swiss round 3';
  engine.applyUserResult(career, fixture, { players: players.slice(0, 3) });
  curtain.raise({ ...first, spec: null, game: 2 });
  await curtain.renderHub({ ...card, next: 3 });
  assert.deepEqual(rendered[1].sides[1].players, [{}, {}, {}]);
  assert.deepEqual([rendered[1].phase, rendered[1].round], ['Swiss Stage', 'round 3']);
  const cancelled = injector.prepare({ current: () => true });
  curtain.lower(first.dir);
  assert.equal(await cancelled, false);
  assert.deepEqual(launches, []);
  engine.applyUserResult({}, fixture, { players, final: true });
  curtain.raise({ ...first, spec: null, game: 3, seat: null });
  assert.match(view.get('inventory-result-view.txt'), /-42-2 waiting \d+$/);
  hubWindow.show();
  const closing = rcon.send(['rcon_refresh_allowed', 'unreal_command "exit"']);
  await curtain.renderHub({ ...card, kind: 'series' });
  assert.match(view.get('inventory-result-view.txt'), /-42-2 card \d+$/);
  assert.deepEqual(launches, []);
  assert.equal(rendered.length, 3);
  assert.equal(rendered[2].seriesOver, true);
  assert.equal(rendered[2].overtimeSeconds, undefined);
  assert.deepEqual(rendered[2].history, [0, 0, 0]);
  await injector.prepare({ current: () => true });
  assert.deepEqual(launches, ['prepare']);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.match(view.get('inventory-result-view.txt'), /-42-2 card \d+$/);
  assert.deepEqual(launches, ['prepare']);
  await closing;
  assert.match(view.get('inventory-result-view.txt'), /-42-2 released \d+$/);
  assert.deepEqual(launches, ['prepare', 'arm']);
  curtain.lower(first.dir);
  assert.deepEqual(launches, ['prepare', 'arm', 'hub']);
  console.log('Broadcast: kickoff, team talks, loading bar, delayed launch, cancellation and series finish passed.');
}

testBroadcastIntermission().catch(error => { console.error(error); process.exitCode = 1; });

async function testCareerExtras() {
  const assert = require('node:assert/strict');
  const { installCareerExtras } = require('./src/career-extras.cjs');
  const players = { 1: { name: 'Coach', isUser: true }, 2: { name: 'Blue Bot', age: 23 }, 3: { name: 'Orange Bot', age: 17 } };
  const state = { currentDate: '2026-11-23', userPlayerId: 1 };
  const fixture = { homeId: 10, awayId: 20, stage: 'final', bestOf: 5, homeWins: 2, awayWins: 2, games: [] };
  const engine = {
    sideLineup: () => [1, 2], lineupFor: () => [3], playerById: (_, id) => players[id],
    userSideId: () => 10, teamById: (_, id) => ({ id }), talkBoostFor: () => 7,
    applyUserResult(_, match, report) { match.games.push({ reported: report }); return {}; }
  };
  let shortcut = '';
  let proxyArgs;
  const launch = { launchEpicToMenu: opts => opts.spawnGame('RocketLeague.exe', '-nomovie') };
  const scorebug = { capture: (_, html) => html };
  installCareerExtras(engine, launch, { render() {} }, scorebug, async () => shortcut, () => {},
    (...args) => { proxyArgs = args; }, () => 6);
  engine.sideLineup(state, fixture);
  const fresh = engine.talkBoostFor(fixture, 2);
  assert.equal(engine.talkBoostFor(fixture, 1), 7);
  assert.ok(fresh < 7);
  engine.applyUserResult(state, fixture, { overtime: true, players: [{ name: 'Blue Bot' }, { name: 'Orange Bot' }] });
  assert.equal(state.rlcMatchFatigue[2].load, 3);
  assert.equal(state.rlcMatchFatigue[3].load, 3);
  assert.ok(engine.talkBoostFor(fixture, 2) < fresh);
  state.currentDate = '2026-11-24';
  assert.equal(engine.talkBoostFor(fixture, 2), fresh);
  assert.equal(await launch.launchEpicToMenu({ current: () => true, spawnGame: () => 'native' }), 'native');
  shortcut = '12345678901234567890';
  await launch.launchEpicToMenu({ current: () => true });
  assert.deepEqual(proxyArgs.slice(0, 3), [shortcut, 'RocketLeague.exe', '-nomovie']);
  assert.match(scorebug.capture(null, '<head></head>', 1, 1, 'data/curtain/1/_render.html'), /repeating-linear-gradient/);
  assert.equal(scorebug.capture(null, '<head></head>', 1, 1, 'data/scorebug/1/_render.html'), '<head></head>');
  console.log('Career form, recovery, Steam preference and initial loading scope passed.');
}
testCareerExtras().catch(error => { console.error(error); process.exitCode = 1; });

async function testVersionNotice() {
  const assert = require('node:assert/strict');
  const { compareVersions, latestCareerRelease, modifierFileVersion, showVersionNotice } = require('./src/version-check.cjs');
  assert.equal(compareVersions('v0.4.27', '0.3.12'), 1);
  assert.equal(compareVersions('0.4.9', 'v0.4.10'), -1);
  assert.equal(compareVersions('0.8.0', 'v0.8.0'), 0);
  assert.equal(await latestCareerRelease(async () => ({ ok: false }), async () => 'v0.3.12'), '0.3.12');
  assert.equal(await latestCareerRelease(async () => { throw Error(); }), null);
  assert.equal(modifierFileVersion(Buffer.alloc(12), () => {}), null);
  const calls = [];
  const dialog = { showMessageBox: async (_, options) => calls.push(options.detail) };
  const window = () => ({ isDestroyed: () => false });
  showVersionNotice(dialog, window(), '0.4.27', '0.3.12', true, '0.8.0', compareVersions);
  assert.equal(calls.length, 0);
  showVersionNotice(dialog, window(), '0.5.8', '0.3.12', true, '0.10.0', compareVersions);
  assert.equal(calls.length, 0);
  const changed = window();
  showVersionNotice(dialog, changed, '0.4.27', '0.4.28', true, '0.7.0', compareVersions);
  showVersionNotice(dialog, changed, '0.4.27', '0.4.28', true, '0.7.0', compareVersions);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /0\.4\.28/);
  assert.match(calls[0], /0\.7\.0/);
  console.log('Release fallback, local-newer case and combined version warning passed.');
}
testVersionNotice().catch(error => { console.error(error); process.exitCode = 1; });

async function testIntermissionHandoff() {
  const assert = require('node:assert/strict');
  const { installBroadcastResult } = require('./src/broadcast.cjs');
  const files = new Map();
  const io = { read: (_, file) => files.get(file), write: (_, file, data) => files.set(file, data) };
  const fixture = { id: 9, games: [], homeId: 1, awayId: 2 };
  const engine = { userSideId: () => 1, teamById: (_, id) => ({ name: String(id) }),
    applyUserResult(_, item) { item.games.push({ homeGoals: 2, awayGoals: 1 }); return {}; } };
  let lowered = 0, captured = 0, on = true;
  const curtain = { raise: () => 22, readState: () => ({ at: 22, on }),
    lower() { if (on) { on = false; lowered++; } }, async renderHub() { captured++; } };
  const injector = { prepare: async () => 'started' };
  installBroadcastResult(engine, curtain, injector, { send() {} }, 'render(', 500, undefined, io);
  engine.applyUserResult({}, fixture, {});
  curtain.raise({ dir: 'curtain', spec: null, seat: 'play', matchId: 9, game: 1 });
  const session = process.env.RLC_INVENTORY_LAUNCH_TOKEN || String(process.pid);
  const [musicCue, expires] = files.get('inventory-intermission-music.txt').split(' ');
  assert.equal(musicCue, 'postmatch-' + session + '-9-0');
  assert.ok(Number(expires) > Date.now() + 24000);
  assert.equal(files.has('inventory-result-snapshot.tsv'), false);
  files.set('inventory-result-snapshot.tsv', session + '-9-0 ' + Date.now() + ' 2 1 0 0');
  setTimeout(() => { files.set('inventory-result-native.txt', session + '-9-0 ' + Date.now()); }, 70);
  assert.deepEqual(await curtain.renderHub({ dir: 'curtain', kind: 'game', at: 22, fxId: 9, next: 2 }),
    { ready: true, shown: false });
  assert.equal(lowered, 1);
  assert.equal(captured, 0);
  assert.match(files.get('inventory-result-view.txt'), /-9-0 native \d+$/);
  const [key, start, deadline] = files.get('inventory-intermission.txt').split(' ');
  assert.equal(key, session + '-9-0');
  assert.equal(Number(deadline) - Number(start), 500);
  let started = false;
  const launch = injector.prepare({ current: () => true }).then(result => { started = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(started, false);
  assert.equal(await launch, 'started');
  assert.ok(Date.now() < Number(deadline), 'the arena should start loading before the reveal');
  files.set('inventory-arena-ready.txt', session + '-9-1 ' + Date.now());
  curtain.lower('curtain');
  assert.match(files.get('inventory-result-view.txt'), /-9-0 native \d+$/);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(deadline) - Date.now() + 25)));
  assert.match(files.get('inventory-result-view.txt'), /-9-0 closed \d+$/);
  assert.equal(files.get('inventory-intermission.txt'), '');
  console.log('The arena can load early while the scoreboard stays through the reveal deadline.');
}
testIntermissionHandoff().catch(error => { console.error(error); process.exitCode = 1; });

async function testQuickChatPresets() {
  const assert = require('node:assert/strict');
  const { installQuickChat, quickChatCatalog } = require('./src/quick-chat.cjs');
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlc-qc-'));
  const curtain = { renderHub() {}, render() {}, lower() {} };
  const engine = { setDayNote() {} };
  const publish = await installQuickChat(engine, curtain, fs, path,
    async () => ({ enabled: true, music: false, bindings: ['demo', 'arbitrary text', 'center'] }), quickChatCatalog);
  publish(dir);
  const config = fs.readFileSync(path.join(dir, 'inventory-quick-chat.tsv'), 'utf8').trimEnd().split('\n');
  assert.equal(config.length, 9);
  assert.equal(config[1], 'demo\tBump the defender!');
  assert.equal(config[2], 'go\tGo for it!');
  fs.writeFileSync(path.join(dir, 'inventory-timeout.wav'), '');
  curtain.renderHub({ dir: path.join(dir, 'curtain'), kind: 'game', fxId: 1, next: 2 });
  assert.equal(fs.readFileSync(path.join(dir, 'inventory-music.txt'), 'utf8'), '');
  curtain.renderHub({ dir: path.join(dir, 'curtain'), kind: 'game', fxId: 1, next: 2, query: { talk: 'offer' } });
  assert.match(fs.readFileSync(path.join(dir, 'inventory-music.txt'), 'utf8'), /^timeout-.*-1-2 /);
  curtain.lower(path.join(dir, 'curtain'));
  assert.equal(fs.readFileSync(path.join(dir, 'inventory-music.txt'), 'utf8'), '');
  console.log('Quick Chat presets and timeout-only music cue passed.');
}
testQuickChatPresets().catch(error => { console.error(error); process.exitCode = 1; });

async function testEarlyPostmatchFrame(useFallback = false) {
  const assert = require('node:assert/strict');
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const { installPostmatchFrame } = require('./src/postmatch-frame.cjs');
  const { EventEmitter } = require('node:events');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlc-result-'));
  const events = [];
  let complete;
  const published = new Promise(resolve => { complete = resolve; });
  const observedFs = Object.create(fs);
  observedFs.renameSync = (from, to) => {
    fs.renameSync(from, to);
    if (to.endsWith('inventory-result-frame.txt')) complete();
  };
  const hubWindow = new EventEmitter();
  let closed = false;
  class OffscreenWindow {
    isDestroyed() { return closed; }
    destroy() { closed = true; }
    loadURL() { events.push('warm'); return Promise.resolve(); }
    setContentSize(w, h) { events.push([w, h]); }
    webContents = {
      executeJavaScript: async code => {
        if (code.startsWith('(function fallbackScoreboard')) {
          assert.equal(useFallback, true);
          return { png: 'data:image/png;base64,' + Buffer.from('fallback').toString('base64'),
            metrics: [1920, 1080, 718, 672, 483, 9] };
        }
        if (code.startsWith('render(')) {
          events.push(JSON.parse(code.slice(7, -1)));
          return true;
        }
        return [1920, 1080, 718, 672, 483, 9];
      },
      capturePage: (() => {
        let attempts = 0;
        return async () => {
          const pixels = Buffer.alloc(48 * 27 * 4, 255);
          if (++attempts > 1 && !useFallback) {
            for (let i = 0; i < pixels.length - 224; i += 4) pixels.fill(12, i, i + 3);
          }
          return { isEmpty: () => false, toBitmap: () => pixels,
            toPNG: () => Buffer.from(attempts === 1 ? 'blank' : 'frame') };
        };
      })()
    };
  }
  const injected = require('node:vm').runInNewContext('(' + installPostmatchFrame.toString() + ')',
    { Buffer, setTimeout, setInterval, clearInterval, Date });
  const prepare = injected(OffscreenWindow, observedFs, path, 'render(', {}, hubWindow);
  prepare(dir, { token: 'career-3451-1', expires: Date.now() + 2000, series: [2, 5, 0, 1],
    presentation: ['Gentle Mates\t', 'Ninjas in Pyjamas\t'], history: [1], header: 'OPEN 3 | EU | PLAYOFFS' });
  assert.deepEqual(events, ['warm']);
  const at = Date.now();
  fs.writeFileSync(path.join(dir, 'inventory-result-snapshot.tsv'),
    'career-3451-1 ' + at + ' 0 2 1 14\n0\tVatira\t121\t0\t0\t2\t3\t0\n');
  let timer;
  try {
    await Promise.race([published, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Missing frame')), 2200); })]);
    const [token, filename, ...track] = fs.readFileSync(path.join(dir, 'inventory-result-frame.txt'), 'utf8').split(' ');
    assert.equal(token, 'career-3451-1');
    assert.equal(filename, 'inventory-result-career-3451-1-' + at + '.png');
    assert.equal(fs.readFileSync(path.join(dir, filename), 'utf8'), useFallback ? 'fallback' : 'frame');
    assert.deepEqual(track.map(Number), [1920, 1080, 718, 672, 483, 9]);
    assert.deepEqual(events[2].history, [1, 1]);
    assert.equal(events[2].seriesOver, false);
    assert.equal(events[2].sides[0].players[0].name, 'Vatira');
    assert.equal(events[2].overtimeSeconds, 14);
    hubWindow.emit('closed');
    assert.equal(closed, true);
    console.log('The warm renderer publishes the original result layout from the first game snapshot.');
  } finally {
    clearTimeout(timer);
  }
}
Promise.all([testEarlyPostmatchFrame(), testEarlyPostmatchFrame(true)]).catch(error => { console.error(error); process.exitCode = 1; });

function testComposure() {
  const assert = require('node:assert/strict');
  const { installComposure } = require('./src/composure.cjs');
  const rookie = { id: 1, name: 'Rookie', age: 17, rating: 66, teamId: 10 };
  const veteran = { id: 2, name: 'Veteran', age: 28, rating: 66, teamId: 10, career: { games: 140 } };
  const favorite = { id: 3, name: 'Favorite', age: 23, rating: 98, teamId: 20 };
  const youngChampion = {
    id: 4, name: 'Champion', real: true, age: 19, rating: 90, teamId: 20,
    titles: [{ k: 'worlds_champion', y: 2025 }, { k: 'major_finalist', y: 2026 }],
    rlcComposure: { base: 62, growth: 235, cap: 76, last: 20775 }
  };
  const teams = [{ id: 10, name: 'Academy', playerIds: [1, 2] }, { id: 20, name: 'Favorites', playerIds: [3] }];
  const state = { currentDate: '2026-11-23', players: [rookie, veteran, favorite, youngChampion], teams, userTeamId: 10 };
  const talk = { boostFor: () => 2 };
  const engine = {
    playerById: (s, id) => s.players.find(p => p.id === id),
    teamById: (s, id) => s.teams.find(t => t.id === id),
    migrateState() {}, userLineup() { return [1, 2]; },
    advance(s, fixture) { return talk.boostFor(fixture, rookie.id); },
    setDayNote: () => ({ original: true })
  };
  const pressure = installComposure(engine, talk);
  engine.migrateState(state);
  const baseline = rookie.rlcComposure.base;
  const key = 'rlc-composure/v1';
  assert.ok(veteran.rlcComposure.base > baseline);
  assert.ok(youngChampion.rlcComposure.base >= 80);
  assert.equal(youngChampion.rlcComposure.growth, 235);
  assert.equal(youngChampion.rlcComposure.last, 20775);
  assert.deepEqual(engine.setDayNote(state, key, 'sync'), { ok: true });
  assert.deepEqual(engine.setDayNote(state, key, 'sync'), { ok: false });
  assert.equal(engine.setDayNote(state, key, 'train:3').ok, false);
  assert.equal(engine.setDayNote(state, key, 'train:1').ok, true);
  assert.equal(engine.setDayNote(state, key, 'train:1').rlcError, 'cooldown');
  assert.deepEqual(engine.setDayNote(state, '2026-11-23', 'schedule'), { original: true });
  const saved = JSON.parse(JSON.stringify(state));
  saved.currentDate = '2026-11-30';
  engine.migrateState(saved);
  assert.equal(saved.players[0].rlcComposure.base, baseline);
  assert.equal(saved.players[0].rlcComposure.growth, rookie.rlcComposure.growth);
  assert.equal(engine.setDayNote(saved, key, 'train:1').ok, true);
  assert.equal(saved.players[0].rating, 66);
  const match = { stage: 'final', bestOf: 5, homeWins: 2, awayWins: 2, homeId: 10, awayId: 20 };
  assert.ok(pressure(state, match, rookie) > pressure(state, match, veteran));
  assert.ok(pressure(state, match, rookie) > pressure(state, { ...match, stage: 'swiss' }, rookie));
  assert.equal(engine.advance(state, match), 2 - pressure(state, match, rookie));
  assert.equal(talk.boostFor(match, 1), 2);
  saved.players[0].rlcComposure.growth = (saved.players[0].rlcComposure.cap - baseline) * 100;
  saved.currentDate = '2026-12-07';
  assert.equal(engine.setDayNote(saved, key, 'train:1').rlcError, 'cap');
  console.log('Composure migrated and persisted, sessions respect cooldown and cap, pressure applies in simulation.');
}
testComposure();

{
  const assert = require('node:assert/strict');
  const { installModBadge } = require('./src/version-badge.cjs');
  const badge = { style: {} };
  const hubBadge = { classList: { contains: () => false }, getBoundingClientRect: () => ({ height: 18, bottom: 22 }) };
  let modifierBadge;
  const context = {
    window: { addEventListener() {} },
    document: {
      createElement: () => badge,
      querySelector: selector => selector === '.mod-version-label' ? modifierBadge : hubBadge,
      body: { appendChild(node) { node.isConnected = true; } }
    },
    MutationObserver: class { constructor(callback) { this.callback = callback; context.update = callback; } observe() {} },
    requestAnimationFrame: callback => callback()
  };
  const run = require('node:vm').runInNewContext('(' + installModBadge.toString() + ')', context);
  assert.equal(run('0.9.14'), 'installed');
  assert.equal(badge.textContent, 'Overhaul v0.9.14');
  assert.equal(badge.style.top, '26px');
  modifierBadge = { getBoundingClientRect: () => ({ height: 16, bottom: 42 }) };
  context.update();
  assert.equal(badge.style.top, '46px');
  assert.equal(badge.textContent, 'Overhaul v0.9.14');
}
