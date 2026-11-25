'use strict';
const assert=require('node:assert/strict');
const {recruitmentRules,installRecruitment}=require('./src/recruitment.cjs');
const data=require('./src/player-attributes.json');
const {setupGearCatalog,installSetupGear}=require('./src/setup-gear.cjs');
const {installWorldAttributes}=require('./src/world-attributes.cjs');
const R=recruitmentRules();
for (let overall=0;overall<=100;overall++) for (const profile of Object.values(data.weights)) {
  const skills=R.stats(overall,profile);
  assert.equal(skills.reduce((sum,value)=>sum+value,0),overall*8);
  assert.ok(skills.every(value=>Number.isInteger(value)&&value>=0&&value<=100));
}
assert.deepEqual(R.range(92,55),[88,96]);
assert.deepEqual(R.range(92,91),[92,92]);
for (const overall of [0.125,79.3,92.5,99.9,99.999]) {
  assert.ok(Math.abs(R.stats(overall,data.weights.zen).reduce((sum,value)=>sum+value,0)/8-overall)<1e-10);
}

const state={userTeamId:1,currentDate:'2026-11-29',nextId:20,
  players:[{id:1,name:'Zen',real:true,teamId:1,rating:96},{id:2,name:'Vatira',real:true,teamId:2,rating:92}],
  teams:[{id:1,budget:25000,playerIds:[1]},{id:2,budget:35000,playerIds:[2]}],
  staff:[{id:3,name:'Existing scout',role:'scout',wage:180,rlcScout:{level:55,speed:59,youth:66}}],
  scouts:{jobs:[],reports:{},partial:{}},inbox:[]};
const e={
  setDayNote:()=>({ok:true,native:true}), migrateState:()=>{}, SCOUT_SLOTS:3,
  playerView:(s,p)=>({rating:p.rating,ratingKnown:true,reach:99,wage:100,scouting:s.scouts.jobs.length>0}),
  facilityBoard:()=>({tier:1}), teamById:(s,id)=>s.teams.find(club=>club.id===id),
  sideLineup:()=>[1], talkBoostFor:()=>0,
  playerById:(s,id)=>s.players.find(p=>p.id===id),makeRand:()=>()=>.5,
  addDays:(date,days)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10),
  startScouting:(s,id)=>{
    s.scouts.jobs.push({id:s.nextId++,playerId:id,startDate:s.currentDate});
    return {ok:true,days:8};
  },
  stopScouting:()=>({ok:true}),
  advance(s,now) {
    s.currentDate=now;
    for (const job of s.scouts.jobs.filter(item=>item.endDate<=now)) {
      const player=s.players.find(item=>item.id===job.playerId);
      s.scouts.reports[player.id]={rating:player.rating,date:now};
      s.inbox.push({id:s.nextId++,type:'scout_report',title:'Scout report: '+player.name,body:'Rated '+player.rating});
    }
    s.scouts.jobs=s.scouts.jobs.filter(item=>item.endDate>now);
  },
  scoutRoster:s=>s.staff.map(person=>({id:person.id,name:person.name})),
  pushLedger(s,kind,amount,note) { (s.ledger ||= []).push({kind,amount,note}); }
};
installRecruitment(e,recruitmentRules,data);
installSetupGear(e,setupGearCatalog());
e.migrateState(state);
const [zen,vatira]=state.players;
assert.equal(e.playerView(state,zen).rlcSkills.flat().reduce((sum,value)=>sum+value,0),96*16);
assert.equal(e.playerView(state,vatira).rating,undefined);
assert.equal(e.playerView(state,vatira).rlcSkills,undefined);
const note=text=>e.setDayNote(state,'rlc-recruitment/v1',text);
const buy=text=>e.setDayNote(state,'rlc-equipment/v2',text);
const fx={homeId:1,awayId:2};
e.sideLineup(state,fx);
assert.ok(e.talkBoostFor(fx,1)<0);
assert.ok(buy('1:pc:2').ok);
assert.ok(buy('1:controller:3').ok);
assert.equal(e.facilityBoard(state).rlcSetup.players[0].choices.pc,2);
assert.equal(state.teams[0].budget,22850);
assert.equal(state.ledger[0].amount,-1950);
assert.ok(buy('1:controller:0').ok);
assert.ok(buy('1:controller:3').ok);
assert.equal(state.teams[0].budget,22850);
assert.equal(buy('2:pc:1').ok,false);
assert.equal(buy('1:pc:99').ok,false);
assert.equal(e.facilityBoard(state).rlcSetup.players[0].choices.controller,3);
assert.ok(note('shortlist:2').ok);
assert.ok(e.playerView(state,vatira).rlcShortlisted);
assert.ok(note('scout:2:3').ok);
assert.equal(note('release:3').ok,false);
assert.equal(e.playerView(state,vatira).rlcSkills,undefined);
e.advance(state,state.scouts.jobs[0].endDate);
assert.ok(state.teams[1].budget<35000);
assert.ok(Object.keys(state.teams[1].rlcLoadouts[2]).length);
assert.deepEqual(state.scouts.reports[2].rlc.rating,[88,96]);
assert.equal(e.playerView(state,vatira).ratingKnown,false);
assert.match(state.inbox[0].body,/88–96/);
assert.ok(note('hire:105').ok);
assert.ok(note('refresh:2:105').ok);
e.advance(state,state.scouts.jobs[0].endDate);
assert.equal(e.playerView(state,vatira).rating,92);
assert.equal(e.playerView(state,vatira).rlcReport.scout,'Sofia Bennett');
assert.ok(note('release:3').ok);
zen.rating=99;
assert.equal(e.playerView(state,zen).rlcSkills.flat().reduce((sum,value)=>sum+value,0),99*16);
assert.ok(e.setDayNote(state,'native','note').native);
const worldRules={nameKey:name=>name.toLowerCase(), checkWorld:input=>({world:structuredClone(input),errors:[]}),
  applyWorld:()=>({})};
const worldEngine={generateLeague:()=>({players:[{name:'Test',rating:75}]})};
installWorldAttributes(worldRules,worldEngine);
const world=worldRules.checkWorld({players:[{id:'c1',name:'Test',rating:40,rlcAttributes:[90,80,81,70,66,85,87,80]}]});
assert.equal(world.world.players[0].rating,79.875);
const started=worldEngine.generateLeague({real:worldRules.applyWorld({},world.world)});
assert.equal(started.players[0].rating,79.875);
assert.equal(started.players[0].rlcAttributes.values[0],90);
console.log('Attribute normalization, old-save migration, spending, AI purchases, hidden ratings, range reports and expert reassignment passed.');
