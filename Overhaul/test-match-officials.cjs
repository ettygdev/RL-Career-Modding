'use strict';
const assert = require('node:assert/strict');
const { matchOfficialsRules, installMatchOfficials } = require('./src/match-officials.cjs');

const rules = matchOfficialsRules();
assert.deepEqual([1,2,3,4,5,6].map(tier => rules.network(tier,0).reliability), [50,65,80,95,97,99]);
for (let tier=1; tier<=6; tier++) {
  assert.ok(rules.network(tier,3).reliability > rules.network(tier,2).reliability);
  if (tier>1) assert.ok(rules.network(tier,3).monthly < rules.network(tier-1,3).monthly);
}
const state = { season:1,currentDate:'2026-01-31',userTeamId:1,pendingMatch:null,events:[
  {id:1,kind:'open'}, {id:2,kind:'major'}, {id:3,kind:'lcq'}
], teams:[
  {id:1,name:'Blue',budget:5000,playerIds:[11],rlcMentalCoach:{composure:70}},
  {id:2,name:'Orange',budget:5000,playerIds:[22]}
], players:[{id:11,teamId:1,rating:75},{id:22,teamId:2,rating:75}] };
const fixture = { id:7,eventId:1,date:'2026-02-05',stage:'upper',bestOf:5,homeId:1,awayId:2,games:[] };
assert.deepEqual(rules.arena(state,fixture),{lan:false,eligible:true});
for (const stage of ['groups','swiss','gsl','double elim']) assert.equal(rules.arena(state,{...fixture,stage}).eligible,false);
assert.deepEqual(rules.arena(state,{...fixture,eventId:2}),{lan:true,eligible:true});
assert.deepEqual(rules.arena(state,{...fixture,eventId:3}),{lan:false,eligible:true});
assert.deepEqual(rules.arena(state,{...fixture,stage:'semifinal'}),{lan:false,eligible:true});
const historic={events:[{id:1,kind:'open',name:'Open 1',regionId:'eu'}]};
assert.deepEqual(rules.arena(historic,{...fixture,date:'2025-12-07',stage:'semifinal'}),{lan:true,eligible:true});
assert.deepEqual([.05,.5,.9].map(rules.technicalOutcome),['resume','kickoff','restart']);
const losses=[{homeGoals:2,awayGoals:3},{homeGoals:2,awayGoals:3}];
assert.equal(rules.timeoutChance(losses.slice(0,1),true,5),0);
assert.equal(rules.timeoutChance(losses,true,5),.30);
assert.ok(rules.timeoutChance(losses,true,7)<.30);
assert.equal(rules.timeoutChance([...losses,{homeGoals:0,awayGoals:10}],true,7),1);
assert.equal(rules.timeoutChance(losses,false,5),0);
assert.deepEqual([.005,.04,.20,.50].map(roll=>rules.benefit(75,70,70,roll)),[7,4,2,0]);

const talk={boostFor:()=>0};
const files=new Map();
const engine={
  sideLineup:()=>[11], facilityBoard:()=>({tier:4}), facilityTier:()=>4,
  teamById:(s,id)=>s.teams.find(team=>team.id===id),
  playerById:(s,id)=>s.players.find(player=>player.id===id),
  fixtureById:()=>fixture, difficultyOf:()=>({id:'beginner'}),DIFFICULTIES:[{id:'ultimate'}],
  setDayNote:()=>({ok:true}), talkBoostFor:()=>0,
  advance:s=>{s.currentDate='2026-02-01';return {ok:true};},
  simulateNextGame(s,fx) {
    fx.bonuses=[talk.boostFor(fx,11),talk.boostFor(fx,22)];
    fx.games.push({homeGoals:0,awayGoals:10});
  },
  applyUserResult(s,fx) {
    fx.games.push({homeGoals:0,awayGoals:10});
    return {seriesOver:false};
  }
};
const api=installMatchOfficials(engine,talk,matchOfficialsRules,{
  read:(_dir,name)=>files.get(name),write:(_dir,name,value)=>files.set(name,value),remove:(_dir,name)=>files.delete(name)
});
assert.equal(engine.setDayNote(state,'rlc-wifi/v1','3').ok,true);
assert.equal(engine.facilityBoard(state).rlcWifi.reliability,99.3);
engine.advance(state);
assert.equal(state.teams[0].budget,4250);
assert.equal(state.ledger.at(-1).amount,-750);
engine.advance(state);
assert.equal(state.teams[0].budget,4250);
fixture.games=[...losses,{homeGoals:0,awayGoals:10}];
engine.simulateNextGame(state,fixture);
assert.equal(fixture.rlcTimeouts[1].game,3);
assert.equal(fixture.rlcTimeouts[1].source,'ai');
assert.ok(Object.hasOwn(fixture.rlcSimOfficials,3));
const first=fixture.rlcTimeouts[1];
engine.simulateNextGame(state,fixture);
assert.equal(fixture.rlcTimeouts[1],first);
state.pendingMatch=fixture.id; fixture.spectating=true;
assert.equal(engine.difficultyOf(state).id,'ultimate');
fixture.spectating=false;
assert.equal(engine.difficultyOf(state).id,'beginner');
assert.equal(engine.setDayNote(state,'rlc-wifi/v1','1').ok,false);

(async()=>{
  const baseTime=Date.now;
  const baseTimer=global.setTimeout;
  let clock=baseTime();
  Date.now=()=>clock;
  global.setTimeout=(callback,millis)=>queueMicrotask(()=>{clock+=millis;callback();});
  try {
    fixture.games=[losses[0]];
    fixture.rlcTimeouts={};
    const session=process.env.RLC_INVENTORY_LAUNCH_TOKEN || String(process.pid);
    const token=session+'-7-1';
    const nextToken=session+'-7-2';
    const flush=()=>new Promise(resolve=>setImmediate(resolve));
    api.prepare(state,fixture,'test',{token,expires:clock+100000});
    assert.match(files.get('inventory-officials.txt'), /^\S+ \d+ \d\d 1 /);
    files.set('talk/timeout.json',JSON.stringify({matchId:fixture.id,game:2}));
    files.set('inventory-officials-skip.txt',token+' skip '+clock);
    engine.applyUserResult(state,fixture,{});
    const cp={execFile:(_file,_options,callback)=>callback(null,'running')};
    api.holdNextGame(cp);
    const nextGame=()=>new Promise(resolve=>{
      function startNextSeriesGame() {
        cp.execFile('tasklist /FI "IMAGENAME eq RocketLeague.exe" /FO CSV /NH',{},()=>resolve());
      }
      startNextSeriesGame();
    });
    const started=clock;
    await nextGame();
    assert.ok(clock-started>=18000);
    assert.ok(clock-started<20000);
    assert.equal(fixture.rlcTimeouts[1].source,'player');
    assert.equal(files.has('talk/timeout.json'),false);
    assert.equal(api.skipScoreboard(7,2),true);
    assert.equal(api.skipScoreboard(8,2),false);
    assert.match(files.get('inventory-officials-break.txt'), / loading /);
    files.set('inventory-officials-ready.txt',token+' ready '+clock);
    await Promise.resolve();
    assert.match(files.get('inventory-officials-break.txt'), / loading /);
    files.set('inventory-officials-ready.txt',nextToken+' ready '+clock);
    await flush();
    assert.equal(files.get('inventory-officials-break.txt'),'');
    files.delete('inventory-officials-skip.txt');
    files.delete('inventory-officials-ready.txt');
    for (const decline of [true,false]) {
      fixture.games=[losses[0]];
      fixture.rlcTimeouts={};
      if (decline) files.set('inventory-officials-decision.txt',token+' no '+clock);
      else files.delete('inventory-officials-decision.txt');
      engine.applyUserResult(state,fixture,{});
      assert.match(files.get('inventory-officials-break.txt'), / proposal /);
      const before=clock;
      await nextGame();
      assert.equal(fixture.rlcTimeouts[1]?.source,decline?undefined:'proposal');
      if (decline) assert.equal(files.get('inventory-officials-break.txt'),'');
      else {
        assert.ok(clock-before>=108000 && clock-before<109000);
        assert.match(files.get('inventory-officials-break.txt'), / loading /);
        files.set('inventory-officials-ready.txt',nextToken+' ready '+clock);
        await flush();
        assert.equal(files.get('inventory-officials-break.txt'),'');
      }
    }
  } finally {
    Date.now=baseTime;
    global.setTimeout=baseTimer;
  }
  console.log('Wi-Fi, simulation, and timeout handoff at expiry or skip passed. Loading clears only for the next match token.');
})().catch(error=>{console.error(error);process.exitCode=1;});
