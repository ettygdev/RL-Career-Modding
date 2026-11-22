const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
process.chdir(__dirname);

function buildFixture(directory, name, code) {
  const main = path.resolve(directory, name + '.cjs');
  const output = path.resolve(directory, name + '.exe');
  const config = path.resolve(directory, name + '.json');
  fs.writeFileSync(main, code);
  fs.writeFileSync(config, JSON.stringify({ main, output, disableExperimentalSEAWarning: true }));
  execFileSync(process.execPath, ['--build-sea=' + config]);
  return output;
}

function testEngagement() {
  const { installPostEngagement } = require('./src/social.cjs');
  const engine = {
    handleFor: name => name.toLowerCase(),
    postTweet(state, text) {
      if (!text) return {ok: false};
      const id = state.nextId++;
      const post = {id, own: true, text, authorId: 1, handle: 'user', date: state.currentDate,
        target: {views: 100, likes: 12, reposts: 4, replies: 2}};
      state.social.posts.unshift(post);
      return {ok: true, id};
    }
  };
  const state = {nextId: 1, currentDate: '2026-11-22',
    players: [{id: 1, name: 'User'}, {id: 2, name: 'Duo', teamId: 4}], userTeamId: 4, social: {posts: []}};
  assert.equal(installPostEngagement(engine), 'installed');
  assert.equal(installPostEngagement(engine), 'already-installed');
  assert.equal(engine.postTweet(state, '').ok, false);
  const result = engine.postTweet(state, 'GG @duo');
  const post = state.social.posts.find(post => post.id === result.id);
  assert.equal(post.likes, 5);
  assert.equal(state.social.posts[0].replyTo, post.id);
  engine.postTweet(state, 'Again @duo');
  assert.equal(state.social.posts.filter(post => post.ySocialReply).length, 1);
  console.log('Portée initiale, réaction à une mention et limite journalière vérifiées.');
}

function testReposts() {
  const { installReposts } = require('./src/social.cjs');
  const engine = { TIMELINE_MAX: 1, toggleLike: (_, id) => ({liked: id}) };
  const original = {id: 1, kind: 'player', name: 'Duo', text: 'GG', reposts: 4};
  const state = {nextId: 2, currentDate: '2026-11-22', social: {posts: [original]}};
  assert.equal(installReposts(engine), 'installed');
  assert.equal(installReposts(engine), 'already-installed');
  assert.deepEqual(engine.toggleLike(state, 1), {liked: 1});
  assert.equal(engine.toggleLike(state, {ySocial: 'repost', id: 99}).ok, false);
  assert.equal(engine.toggleLike(state, {ySocial: 'repost', id: 1}).ySocialReposted, true);
  assert.equal(state.social.posts[0].yRepostOf, 1);
  assert.equal(state.social.posts[0].text, original.text);
  assert.equal(state.social.archive[0].id, 1);
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(engine.toggleLike(reloaded, {ySocial: 'repost', id: 1}).ySocialReposted, false);
  assert.equal(reloaded.social.posts.length, 0);
  assert.equal(reloaded.social.archive[0].yRepostId, undefined);
  assert.equal(reloaded.social.archive[0].reposts, 4);
  console.log('Republication, sauvegarde simulée, annulation et likes natifs vérifiés.');
}

function testConversations() {
  const { installReposts } = require('./src/social.cjs');
  const engine = { toggleLike: () => ({ok:true}), handleFor: name => name.toLowerCase() };
  installReposts(engine);
  const teammate = {id: 2, name: 'Duo', teamId: 7, morale: 35};
  const state = {nextId: 3, userPlayerId: 1, userTeamId: 7, currentDate: '2026-11-22',
    players: [{id:1,name:'User',teamId:7}, teammate],
    social:{posts:[{id:2,kind:'player',authorId:2,text:'GG'}]}};
  const invoke = (ySocial, id, text) => engine.toggleLike(state, {ySocial, id, text, lang:'fr'});
  assert.equal(invoke('reply', 2, 'GG !').ok, true);
  const comment = state.social.posts.find(post => post.replyTo === 2 && post.mine && post.text === 'GG !');
  const answer = state.social.posts.find(post => post.replyTo === comment?.id && post.authorId === 2);
  assert.ok(answer, 'The automatic reply must be linked to the user comment');
  assert.equal(invoke('reply', answer.id, 'Merci.').ok, false);
  assert.equal(invoke('comments', 2).yReplies.length, 2);
  assert.equal(state.social.posts.find(post => post.id === 2).yReplyDelta, 2);
  assert.equal(comment.yReplyDelta, 1);
  assert.match(invoke('dm-send', 2, 'Tu joues ?').yMessages.at(-1).text, /^(On verra|Aucune idée|Pas maintenant|Je ne sais pas)\.$/);
  teammate.morale = 80;
  assert.match(invoke('dm-send', 2, 'Bravo pour la victoire').yMessages.at(-1).text, /Bien joué|travail de la semaine|moments chauds|ce rythme/);
  state.social.yDms[3] = [{mine: true, text: 'Legacy message'}];
  state.players.push({id:3,name:'Old'});
  const contacts = invoke('dm-list', 0).yContacts;
  assert.equal(contacts.find(peer => peer.id === 2).date, '2026-11-22');
  assert.equal(contacts.find(peer => peer.id === 3).date, undefined);
  assert.equal(contacts.find(peer => peer.id === 2).id, 2);
  assert.equal(invoke('dm-read', 2).yMessages.length, 4);
  const english = engine.toggleLike(state, {ySocial:'dm-send', id:2, text:'Great win!', lang:'en'});
  assert.equal(english.yMessages.at(-1).text, 'Great result!');
  invoke('comments', 2);
  const count = state.social.posts.length;
  invoke('comments', 2);
  assert.equal(state.social.posts.length, count);
  console.log('Commentaires persistants et réponses privées selon le moral vérifiés.');
}

function testMatchPosts() {
  const { installMatchPosts } = require('./src/social.cjs');
  const teams = {1:{id:1,name:'Home'}, 2:{id:2,name:'Away'}};
  const players = {4:{id:4,name:'Striker'}, 5:{id:5,name:'Fan',teamId:3}};
  const engine = {
    userSideId: () => 1, teamById: (_, id) => teams[id], playerById: (_, id) => players[id],
    handleFor: name => name.toLowerCase(), advance(state) {
      state.social.posts.unshift({id:state.nextId++,date:'2026-11-22',kind:'player',authorId:4,text:'Same post'});
      return {advanced:true};
    },
    applyUserResult(_, fixture, report) {
      if (fixture.played) return {alreadyPlayed:true, seriesOver:true};
      if (report.error) return {error:'rejected'};
      fixture.played = report.seriesOver;
      return report;
    }
  };
  assert.equal(installMatchPosts(engine, () => 'en'), 'installed');
  assert.equal(installMatchPosts(engine), 'already-installed');
  const state = { nextId:10, currentDate:'2026-11-22', userPlayerId:4, players:Object.values(players),
    social:{posts:[{id:1,date:'2026-11-21',kind:'player',authorId:4,text:'Same post'}],followedBy:[{key:'p5'}]} };
  assert.equal(engine.advance(state).advanced,true);
  assert.equal(state.social.posts.length,1);
  const fixture = {id:8,homeId:1,awayId:2,games:[
    {homeGoals:0,awayGoals:2},{homeGoals:1,awayGoals:2},{homeGoals:2,awayGoals:1},{homeGoals:3,awayGoals:0},
    {homeGoals:3,awayGoals:2,overtime:true,measured:true,homeLines:[{id:4,goals:3,saves:1}]}]};
  engine.applyUserResult(state, fixture, {seriesOver:false});
  assert.equal(state.social.posts.length,1);
  engine.applyUserResult(state, fixture, {seriesOver:true,weWon:true,homeWins:3,awayWins:2,bestOf:5});
  const post = state.social.posts.find(post => post.yMatch?.fixtureId === 8);
  assert.match(post.text, /What a comeback.*Home 3–2 Away.*in overtime.*@striker/);
  assert.ok(state.social.posts.some(reply => reply.replyTo === post.id && reply.authorId === 5));
  engine.applyUserResult(state, fixture, {seriesOver:true});
  assert.equal(state.social.posts.filter(post => post.yMatch?.fixtureId === 8).length,1);
  console.log('Réactions de série, statistiques mesurées et anti-répétition vérifiés.');
}

function testRelationships() {
  const { createDmRelationships } = require('./src/dm-relationships.cjs');
  const { installReposts } = require('./src/social.cjs');
  const engine = { toggleLike: () => ({ok:true}), handleFor: name => name.toLowerCase(),
    adjustMorale: (peer, delta) => { peer.morale += delta; } };
  const relationships = createDmRelationships(engine);
  installReposts(engine, relationships);
  const teammate = {id:2,name:'Mate',rating:82,teamId:7,morale:72};
  const opponent = {id:3,name:'Opponent',teamId:8,morale:72};
  const captain = {id:1,name:'User',rating:86,teamId:7};
  const starter = {id:4,name:'Starter',rating:81,teamId:7,morale:72};
  const reserve = {id:5,name:'Reserve',rating:70,teamId:7,morale:72};
  const state = {userPlayerId:1,userTeamId:7,currentDate:'2026-11-22',
    teams:[{id:7,playerIds:[1,2,4,5]}],players:[teammate,opponent,captain,starter,reserve],social:{posts:[]}};
  const send = (id, text, intent) => engine.toggleLike(state, {ySocial:'dm-send',id,text,intent,lang:'en'});
  const read = id => engine.toggleLike(state, {ySocial:'dm-read',id});
  assert.equal(read(2).yRelationship.trust, 50);
  assert.equal(state.social.yRelationships, undefined);
  assert.equal(send(2, 'Where are you playing?').yRelationship.trust, 50);
  const hello = send(2, 'How are you doing?');
  assert.match(hello.yMessages.at(-1).text, /Doing well|Pretty good/);
  const dispute = send(2, 'You made use loose today');
  assert.match(dispute.yMessages.at(-1).text, /loss|play bothered|Blaming me|conversation right now/);
  assert.equal(dispute.yRelationship.trust, 38);
  assert.equal(dispute.yRelationship.morale, 65);
  assert.deepEqual(dispute.yMessages.at(-2).effect, {kind:'conflict',trustDelta:-12,moraleDelta:-7});
  const repeat = send(2, 'You suck');
  assert.equal(repeat.yRelationship.trust, 38);
  assert.equal(repeat.yMessages.at(-2).relationReason, 'repeated');
  assert.match(repeat.yMessages.at(-1).text, /already talked|heard you the first time|Repeating the blame/);
  assert.equal(send(2, "T’es nul !").yRelationship.trust, 38);
  assert.equal(send(2, 'Désolé, mais non.').yRelationship.trust, 38);
  const apology = send(2, 'Sorry');
  assert.equal(apology.yRelationship.trust, 42);
  assert.match(apology.yMessages.at(-1).text, /Thanks|I hear|I heard|not ready|appreciate/);
  const capped = send(2, 'Bien joué.');
  assert.equal(capped.yRelationship.trust, 42);
  assert.equal(capped.yMessages.at(-2).relationReason, 'daily-limit');
  assert.equal(send(3, "You're useless.").yRelationship.trust, 38);
  assert.equal(opponent.morale, 72);
  assert.equal(send(5, 'ただの文章', 'conflict').yRelationship.trust, 38);
  assert.equal(send(4, 'هذا مجرد نص', 'support').yRelationship.trust, 54);
  const squad = engine.toggleLike(state, {ySocial:'squad-relations',id:0}).ySquad;
  assert.deepEqual(squad.peers.map(peer => peer.id), [2,4]);
  assert.equal(squad.score, 48);
  state.currentDate = '2026-11-23';
  const fixture = {homeId:7,games:[{measured:true,homeLines:[{id:1},{id:2}]}]};
  relationships.recoverAfterSeries(state, fixture, 7, false);
  assert.equal(read(2).yRelationship.trust, 42);
  relationships.recoverAfterSeries(state, {...fixture,spectating:true}, 7, true);
  assert.equal(read(2).yRelationship.trust, 42);
  relationships.recoverAfterSeries(state, fixture, 7, true);
  relationships.recoverAfterSeries(state, fixture, 7, true);
  assert.equal(read(2).yRelationship.trust, 43);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(relationships.current(restored, restored.players[0]).trust, 43);
  state.nextId = 100;
  assert.equal(state.social.posts.length, 0);
  for (let index = 0; index < 45; index++) send(2, 'You suck again ' + index, 'conflict');
  assert.equal(state.social.posts.length, 1);
  assert.equal(state.social.posts[0].authorId, 2);
  assert.doesNotMatch(state.social.posts[0].text, /You suck again/);
  assert.equal(engine.toggleLike(state, {ySocial:'squad-relations',id:0}).ySquad.penalty, 4);
  engine.uxClub = {
    chemOf: () => ({ mod: 1.4 }),
    applyChem: current => {
      const player = current.players[0];
      player.rating += 1;
      player.ratingExact += 1;
      return () => { player.rating -= 1; player.ratingExact -= 1; };
    }
  };
  state.uxClub = { chem:{7:{ since:'2026-01-01' }} };
  teammate.ratingExact = teammate.rating;
  const integrated = createDmRelationships(engine);
  assert.equal(integrated.squadSummary(state).chemistry.penalty, 0.4);
  assert.equal(integrated.squadSummary(state).chemistry.value, 1);
  const revert = engine.uxClub.applyChem(state);
  assert.equal(teammate.rating, 82.6);
  assert.equal(captain.rating, 85.6);
  revert();
  assert.equal(teammate.rating, 82);
  assert.equal(teammate.ratingExact, 82);
  assert.equal(captain.rating, 86);
  console.log('Confiance, moral du coéquipier, limites et réparation après une victoire vérifiés.');
}

function testIntentBank() {
  const { createDmRelationships } = require('./src/dm-relationships.cjs');
  const { interpret } = createDmRelationships({});
  assert.equal(interpret('Salut !').topic, 'greeting');
  assert.equal(interpret('How are you doing?').topic, 'checkin');
  assert.equal(interpret('You made us loose today').effect, 'conflict');
  for (const text of ["It was your fault we lost that series", "It was all on you",
    "Our defeat... It's because of you", "You suck", "We lost because of you"]) {
    assert.equal(interpret(text).effect, 'conflict', text);
  }
  assert.equal(interpret('We won because of you').effect, 'support');
  assert.equal(interpret('It was not all on you').effect, null);

  assert.equal(interpret('Merci de m’avoir couvert.').effect, 'support');
  assert.equal(interpret('Lo siento mucho.').effect, 'apology');
  assert.equal(interpret('Gut gespielt!').topic, 'respect');
  assert.equal(interpret('Just kidding, lol').topic, 'joke');
  assert.equal(interpret('Let’s go!').topic, 'hype');
  assert.equal(interpret('I carried').topic, 'cocky');
  assert.equal(interpret('Sorry but you cost us that game').effect, null);
  assert.equal(interpret('It is not your fault').effect, null);
  assert.equal(interpret('She wrote “you are useless”').effect, null);
  assert.equal(interpret('普通の文章', 'conflict').effect, 'conflict');
  assert.equal(interpret('普通の文章').effect, null);
  assert.ok(interpret('You cost us that game').probability > interpret('ordinary statement').probability);
  console.log('Banque pondérée, langage mixte, négation et choix explicite vérifiés.');
}

async function testChatRows() {
  const vm = require('node:vm');
  const { installInteractions } = require('./src/social.cjs');
  const listeners = new Map();
  const snapshot = {ok:true,ySocialAction:true,lang:'en',career:{moodUpdated:true},yPeer:'Selected',yMessages:[],yRelationship:{trust:38,teammate:true,morale:65}};
  const contacts = [{id:2,name:'Selected',date:'2026-11-22'}, {id:3,name:'Old'}];
  const context = vm.createContext({
    xView:'home', S:{lang:'en'}, esc:String, fmtDateShort:date => 'DATE ' + date,
    xPeople:() => [], xClubs:() => [], xCreators:() => [], xWall:() => [],
    linkifyPost:String, postHtml:String, xRailHtml:() => '<nav></nav>', xMidHtml:() => '',
    xChatHtml:() => '<div class="xc-rows"></div>', xThreadHtml:() => '',
    render() {},
    document:{
      addEventListener:(type, callback) => listeners.set(type, callback),
      createElement:() => ({}), head:{appendChild() {}}, querySelector:() => null
    },
    window:{hub:{toggleLike:async request => request.ySocial === 'dm-list' ?
      {ok:true,ySocialAction:true,yContacts:contacts} : request.ySocial === 'dm-send' ? snapshot : {ok:true,ySocialAction:true,yPeer:'Selected',yMessages:[]}}}
  });
  assert.equal(vm.runInContext('(' + installInteractions.toString() + ')()', context), 'installed');
  const row = {dataset:{yId:'2'}, classList:{contains:name => name === 'rlc-y-dm'}};
  await listeners.get('click')({target:{closest:selector => selector === '.rlc-y-action,.rlc-y-dm,.rlc-y-match' ? row : null}});
  const html = context.xChatHtml();
  assert.match(html, /<div class="xc-row rlc-y-dm on"[^>]*aria-pressed="true"[^>]*data-y-id="2"/);
  assert.match(html, /xc-row-when">DATE 2026-11-22</);
  assert.match(html, /xc-row-when">—</);
  assert.match(context.xThreadHtml(), /data-y-tone="6"/);
  let animated = false;
  const field = { value:'', focus() {}, animate() { animated = true; } };
  const intent = { value:'auto' };
  const form = {dataset:{yId:'2'}, matches: selector => selector === '.rlc-y-dm-form',
    querySelector:selector => selector.includes('message') ? field : intent, querySelectorAll:() => []};
  const chip = {dataset:{yTone:'6'},closest:() => form};
  await listeners.get('click')({target:{closest:selector => selector === '.rlc-y-dm-tone' ? chip : null}});
  assert.match(field.value, /cost us that game/);
  assert.equal(intent.value, 'conflict');
  assert.equal(animated, true);
  await listeners.get('submit')({target:form,preventDefault() {}});
  assert.equal(context.S.career.moodUpdated, true);
  assert.match(context.xThreadHtml(), /aria-label="Trust"[^>]*aria-valuenow="38"/);
  const chat = context.xThreadHtml();
  assert.match(chat, /aria-label="Morale"[^>]*aria-valuenow="65"/);
  assert.ok(chat.indexOf('rlc-y-relationship') < chat.indexOf('rlc-y-chat-history'), 'gauges must stay outside the message scroller');
  console.log('Brouillon modifiable et rafraîchissement de la carrière après un DM vérifiés.');
}

async function test() {
  const directory = fs.mkdtempSync(path.resolve('.build', 'auto-'));
  const hub = buildFixture(directory, 'RL Career Hub', [
    'const vm = require("node:vm");',
    'const inspector = require("node:inspector");',
    'const args = process.argv.join(" ");',
    'const port = Number(args.match(/127[.]0[.]0[.]1:(\\d+)/)?.[1] || process.env.BTIER_PORT);',
    'if (!inspector.url()) inspector.open(port, "127.0.0.1");',
    'let ready = false;',
    'setTimeout(() => { ready = true; context.window.__btierUI = true; }, 1800);',
    'if (!args.includes("--inspect=")) setTimeout(() => inspector.close(), 900);',
    'let badge, updateBadge;',
    'const feed = {};',
    'const label = bottom => ({ className: "version-label", getClientRects: () => [1], getBoundingClientRect: () => ({bottom}) });',
    'const document = { documentElement: {}, addEventListener() {}, head: { appendChild() {} }, body: { appendChild: item => { badge = item; } }, getElementById: () => badge,',
    'querySelector: sel => sel.includes(":not") ? label(30) : sel === ".mod-version-label" ? (ready && process.env.BTIER_PORT ? label(54) : null) : feed,',
    'createElement: tag => ({ tag, style: {}, append() {}, setAttribute() {}, remove() { badge = undefined; } }) };',
    'const driver = { sideLineup() {return [];}, applyUserResult() {}, advance() {}, toggleLike() {return {ok:true};}, postTweet() { return {ok:false}; }, handleFor: name => name.toLowerCase() };',
    'process.getBuiltinModule("module")._cache["fake-league"] = {filename:"C:/Mock/resources/app.asar/engine/league.js",exports:driver};',
    'const context = vm.createContext({ window: {addEventListener() {}}, S: {lang:"fr",career:null}, document, MutationObserver: class { constructor(update) { updateBadge = update; } observe() {} },',
    'threadPosts: posts => posts, xPeople: () => [{id:2,handle:"duo"}], xClubs: () => [], xCreators: () => [], xWall: () => [{id:2,replyTo:1}],',
    'xMeKey: () => "p1", xProfTab: "y-reposts", xTabsHtml: items => items.map(item => item[1]).join(","),',
    'xView: "y-chat", xMidHtml: () => "native mid", xRailHtml: () => "<nav></nav>", xThreadHtml: () => "native thread",',
    'xChatHtml: function() {return "<div class=\\"xc-rows\\"></div>" + this.xThreadHtml();},',
    'xProfileHtml: function(key) {return "<div class=\\"xs-prof-btns\\"></div>" + this.xTabsHtml([], "y-reposts", "x-prof-tab") + "<div class=\\"xs-feed\\">base</div>";},',
    'linkifyPost: text => \'<span class="x-mention">\' + text + \'</span>\',',
    'postHtml: post => \'<article><div><div class="x-actions"><span title="Replies">&#128172; 3</span></div></div></article>\' });',
    'const webContents = { getURL: () => "file:///Mock/resources/app.asar/renderer/index.html",',
    'executeJavaScript(code) { const result = vm.runInContext(code, context);',
    'if (process.env.BTIER_PORT && code !== "window.__btierUI === true" && !code.includes("function installModBadge")) throw Error("Y attempted to inject alongside FilstaNet");',
    'if (process.env.BTIER_PORT && result && process.env.RLC_Y_COORDINATION !== "off") throw Error("Y tactics are not disabled");',
    'if (code.includes("function installModBadge")) {',
    'if (process.env.BTIER_PORT) {',
    'if (driver.sideLineup.rlcYCoordination || driver.applyUserResult.rlcYMatchPosts || driver.toggleLike.rlcYReposts || driver.postTweet.rlcYEngagement) throw Error("Y hooks active");',
    '} else {',
    'if (!driver.sideLineup.rlcYCoordination || !driver.applyUserResult.rlcYMatchPosts || !driver.toggleLike.rlcYReposts || !driver.postTweet.rlcYEngagement || !context.linkifyPost("@duo").includes("p2")) throw Error("missing hooks");',
    'if (!context.postHtml({id:1}).includes("Commentaires (1)")) throw Error("missing reply pane"); if (context.postHtml({id:3,yRepostOf:1}) !== "") throw Error("duplicate repost in feed"); if (context.threadPosts([{id:1},{id:2,replyTo:1}]).length !== 1) throw Error("duplicate comment in feed"); if (!context.xProfileHtml("p1").includes("Republications")) throw Error("missing profile tab"); if (!context.xRailHtml().includes("rlc-y-open-chat") || !context.xChatHtml().includes("xc-empty")) throw Error("missing integrated chat");',
    '}',
    'if (!badge || !badge.textContent.includes("RL Career Modding") || badge.style.top !== (ready && process.env.BTIER_PORT ? "58px" : "34px")) throw Error("incorrect badge name or placement"); context.S.career = {}; updateBadge(); if (badge) throw Error("badge visible outside home"); }',
    'return result; } };',
    'process.mainModule = { require: () => ({ app: { getVersion: () => "0.2.0-beta.33" },',
    'BrowserWindow: { getAllWindows: () => [{ webContents }] } }) };',
    'setTimeout(() => process.exit(), 7500);'
  ].join('\n'));
  const launcher = path.join(directory, 'RL-Career-Modding.exe');
  fs.copyFileSync(path.resolve('bin/RL-Career-Modding.exe'), launcher);
  function launch() {
    return execFileSync(launcher, [], { encoding: 'utf8', timeout: 15000, env: { ...process.env, TEMP: directory, TMP: directory } });
  }

  const standalone = launch();
  assert.match(standalone, /Hub lancé/);
  assert.match(standalone, /Y chargé/);
  console.log('Sans Modifier : le Hub, Y et le badge RL Career Modding sont chargés.');

  buildFixture(directory, 'RL.Career.Hub.-.Modifier', [
    'const { spawn } = require("node:child_process");',
    'const child = spawn(' + JSON.stringify(hub) + ', [], {',
    'env: process.env,',
    'windowsHide: true, stdio: "ignore", detached: true }); child.unref();'
  ].join('\n'));
  const started = Date.now();
  const compatible = launch();
  assert.match(compatible, /FilstaNet lancé/);
  assert.match(compatible, /FilstaNet chargé.*badge RL Career Modding.*Y Social est désactivé/);
  assert.doesNotMatch(compatible, /Y chargé/);
  assert.ok(Date.now() - started >= 1800, 'must wait for FilstaNet');
  console.log('Avec Modifier : le badge RL Career Modding est affiché et Y reste désactivé.');
}

function testCoordinationBridge() {
  const directory = fs.mkdtempSync(path.resolve('.build', 'coordination-'));
  const modulePath = path.resolve('src/coordination.cjs');
  const source = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const os = require("node:os");',
    'const assert = require("node:assert/strict");',
    'const { installCoordination } = require(' + JSON.stringify(modulePath) + ');',
    'const engine = { sideLineup: () => [1,2], playerById: () => ({teamId:7,name:"Mate"}), handleFor: name => name.toLowerCase(), applyUserResult: () => ({seriesOver:true}) };',
    'const state = {userTeamId:7,userPlayerId:1,pendingMatch:5,social:{posts:[{yMatch:{fixtureId:5}}],yRelationships:{2:{trust:33}}}};',
    'const file = path.join(os.tmpdir(), "rlcareer-y-coordination.json");',
    'const read = () => JSON.parse(fs.readFileSync(file, "utf8"));',
    'assert.equal(installCoordination(engine, () => "fr"), "installed");',
    'assert.equal(read().active, false);',
    'engine.sideLineup(state, {id:5,spectating:true});',
    'assert.equal(read().active, false);',
    'engine.sideLineup(state, {id:5});',
    'assert.equal(read().active, true);',
    'const mode = process.env.RLC_Y_COORDINATION === "0" ? "neutral" : "active";',
    'assert.equal(read().mode, mode);',
    'assert.deepEqual(read().teammates, [{name:"Mate",trust:33}]);',
    'const log = path.join(os.tmpdir(), "rlcareer-y-coordination.log");',
    'const record = {nonce:"test",fixture:5};',
    'const events = [{...record,event:"coverage",status:"matched"},{...record,event:"opportunity",override:mode === "active"},',
    '  {...record,fixture:9,event:"opportunity",override:true}];',
    'const goal = {...record,game:1,event:"highlight",action:"goal",player:"Mate",index:1,count:1,second:64,reset:true};',
    'events.push(goal, goal, {...goal,action:"save",reset:false}, {...goal,player:"Stale",index:2,game:2});',
    'fs.writeFileSync(log, events.map(JSON.stringify).join("\\n"));',
    'state.social.posts[0].text = "Victoire.";',
    'engine.applyUserResult(state, {id:5,games:[{measured:true,homeLines:[{id:2,goals:1,saves:1}]},{measured:false}]}, {});',
    'assert.equal(state.social.posts[0].text, "Victoire. Manche 1 · @mate marque après un flip reset probable. Manche 1 · @mate réalise un arrêt.");',
    'assert.deepEqual(state.social.posts[0].yMatch.coordination, {mode,coverage:1,matched:true,opportunities:1,overrides:mode === "active" ? 1 : 0});',
    'assert.equal(read().active, false);'
  ].join('\n');
  for (const mode of ['0','1']) {
    execFileSync(process.execPath, ['-e', source], { env: { ...process.env, TEMP: directory, TMP: directory,
      RLC_Y_LAUNCH_TOKEN:'test', RLC_Y_COORDINATION:mode } });
  }
  console.log('Transmission de la confiance, garde spectateur, désactivation et contrôle neutre vérifiés.');
}

testCoordinationBridge();
testEngagement();
testReposts();
testConversations();
testMatchPosts();
testRelationships();
testIntentBank();
async function testFeatureGroups() {
  const { loadFeatureGroups } = require('./src/feature-policy.cjs');
  const loaded = [];
  const install = name => () => { loaded.push(name); return 'installed'; };
  const groups = [
    { conflictsWithModifier: true, install: install('Y') },
    { install: install('standalone') },
    { requiresModifier: true, isAvailable: () => true, install: install('compatible') },
    { requiresModifier: true, isAvailable: () => false, install: install('missing API') }
  ];
  assert.equal(await loadFeatureGroups(groups, false), 'installed');
  assert.deepEqual(loaded.splice(0), ['Y', 'standalone']);
  assert.equal(await loadFeatureGroups(groups, true), 'ready-with-modifier');
  assert.deepEqual(loaded, ['standalone', 'compatible']);
  console.log('FilstaNet désactive Y seul. Les fonctions indépendantes restent chargées et les dépendances sont vérifiées.');
}

testChatRows().then(testFeatureGroups).then(test).catch(error => { console.error(error); process.exitCode = 1; });
