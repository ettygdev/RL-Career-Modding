'use strict';

const assert = require('node:assert/strict');
const { installCoaches } = require('./src/coaches.cjs');
const { installComposure } = require('./src/composure.cjs');
const { coachAudience, coachArchiveKey, installCoachSocial } = require('./src/coach-social.cjs');
const catalog = require('./src/coach-catalog.json');
const state = {
  currentDate:'2027-01-06', userTeamId:1, realism:1,
  teams:[
    { id:1, name:'Gentle Mates', budget:100000, rlcMentalCoach:{ composure:90, bonus:6 } },
    { id:2, name:'Team Vitality', budget:120000 },
    { id:3, name:'Test Club', budget:10000 }
  ],
  players:[
    { id:10, name:'Player', teamId:1, rating:61, ratingExact:61, potential:61 },
    { id:11, name:'ApparentlyJack', real:true, nation:'England', teamId:-1, freeAgent:true },
    { id:12, name:'Kassio', real:true, nation:'France', teamId:1 },
    { id:13, name:'Kassio', real:false, teamId:-1 },
    { id:14, name:'Kassio', real:true, nation:'Germany', teamId:1 }
  ],
  open:true
};
const engine = {
  migrateState:() => {},
  setDayNote:() => 'native',
  transferWindow:state => ({open:state.open}),
  teamById:(state,id) => state.teams.find(team => team.id === id),
  playerById:(state,id) => state.players.find(player => player.id === id),
  trainingPlan:() => [{pid:10},{pid:10}],
  bestFreeAgent:state=>state.players.find(player=>!player.retired&&player.teamId===-1),
  attemptContract(state,kind,pid) {
    const player=state.players.find(player=>player.id===pid);
    player.teamId=state.userTeamId;
    return {ok:true};
  },
  runTraining(state) {
    state.players[0].ratingExact += .9;
    return { ok:true };
  }
};
const staff = installCoaches(engine, catalog);
installComposure(engine, null, staff);
const send = (text, value = state) => engine.setDayNote(value, 'rlc-coaches/v1', text);
engine.migrateState(state);
assert.equal(state.teams[0].rlcMentalCoach.id, 'snaski');
assert.equal(state.teams[2].rlcMentalCoach, undefined);
assert.equal(engine.setDayNote(state, 'native', 'text'), 'native');
assert.ok(engine.setDayNote(state, 'rlc-composure/v1', 'sync').ok);
assert.ok(!engine.setDayNote(state, 'rlc-composure/v1', 'sync').ok);
assert.ok(engine.setDayNote(state, 'rlc-composure/v1', 'train:10').ok);
assert.ok(!engine.setDayNote(state, 'rlc-composure/v1', 'train:10').ok);
assert.ok(engine.runTraining(state).ok);
assert.equal(state.players[0].ratingExact, 62);
state.open = false;
assert.ok(!send('hire:eversax').ok);
state.open = true;
assert.ok(send('hire:eversax').ok);
assert.equal(state.teams[0].rlcMentalCoach.id, 'eversax');
assert.equal(state.teams[1].rlcMentalCoach, null);
assert.equal(state.teams[0].budget + state.teams[1].budget, 220000);
const loaded = JSON.parse(JSON.stringify(state));
engine.migrateState(loaded);
assert.equal(loaded.teams[0].rlcMentalCoach.id, 'eversax');
assert.equal(loaded.teams[1].rlcMentalCoach, null);
assert.ok(send('release', loaded).ok);
assert.equal(loaded.teams[0].rlcMentalCoach, null);
assert.equal(new Set(catalog.profiles.map(profile=>profile.id)).size, catalog.profiles.length);
assert.ok(catalog.profiles.some(profile => profile.id === 'azuha' && profile.status === 'active' && !profile.club));
assert.ok(catalog.profiles.some(profile => profile.id === 'gregan' && profile.status === 'former' && profile.last === 2024));
assert.ok(catalog.profiles.some(profile => profile.id === 'astra' && profile.status === 'former' && profile.last === 2020));
assert.ok(catalog.profiles.filter(profile => profile.status === 'former' && !profile.legacyOnly)
  .every(profile => profile.last <= 2024));
assert.ok(!send('hire:ferra', loaded).ok);
loaded.rlcCoaches.clubs[1] = 'ferra';
loaded.rlcCoaches.assignmentVersion = 1;
loaded.teams.push({ id:4, name:'Team BSK', budget:100000 });
loaded.rlcCoaches.clubs[4] = null;
engine.migrateState(loaded);
assert.equal(loaded.teams[0].rlcMentalCoach.id,'ferra');
assert.equal(loaded.teams[1].rlcMentalCoach,null);
assert.equal(loaded.teams[3].rlcMentalCoach.id,'batou');
assert.ok(send('release',loaded).ok);
assert.ok(!send('hire:ferra',loaded).ok);
assert.equal(loaded.rlcCoaches.playerContracts.kassio,12);
assert.ok(!send('hire:kassio',loaded).ok);
assert.ok(send('hire:apparentlyjack',loaded).ok);
assert.deepEqual(loaded.rlcCoaches.coachingPlayerIds,[11]);
assert.equal(engine.bestFreeAgent(loaded).id,13);
assert.equal(loaded.players[1].freeAgent,true);
assert.equal(loaded.players[1].retired,undefined);
assert.ok(!engine.attemptContract(loaded,'free',11).ok);
assert.ok(send('release',loaded).ok);
assert.equal(engine.bestFreeAgent(loaded).id,11);
assert.ok(engine.attemptContract(loaded,'free',11).ok);
assert.ok(!send('hire:apparentlyjack',loaded).ok);
const coachProfile=id=>catalog.profiles.find(coach=>coach.id===id);
assert.ok(coachAudience(coachProfile('apparentlyjack')) > coachAudience(coachProfile('snaski')));
assert.ok(coachAudience(coachProfile('gregan')) > coachAudience(coachProfile('azuha')));
const live = {
  currentDate:'2027-01-06', userTeamId:1, nextId:10, season:1,
  teams:[{id:1,name:'Gentle Mates',rlcMentalCoach:{id:'snaski'}},{id:2,name:'Team Vitality'}],
  rlcCoaches:{clubs:{1:'snaski'},moves:[]}, social:{posts:[],archive:[]},
  fixtures:[{id:1,homeId:1,awayId:2,homeWins:3,awayWins:1,played:false}]
};
const socialEngine={
  teamById:(state,id)=>state.teams.find(team=>team.id===id),
  handleFor:name=>name.toLowerCase(),
  socialTimeline:()=>['native'],
  applyUserResult(state,fixture,result) {
    fixture.played=result.done;
    return {seriesOver:result.done};
  },
  runTraining:()=>({ok:true}),
  advance(state) { state.fixtures.at(-1).played=true; }
};
installCoachSocial(socialEngine,catalog,coachAudience,coachArchiveKey);
socialEngine.applyUserResult(live,live.fixtures[0],{done:false});
assert.equal(live.social.posts.length,0);
socialEngine.applyUserResult(live,live.fixtures[0],{done:true});
socialEngine.runTraining(live);
assert.equal(live.social.posts.length,1);
assert.match(live.social.posts[0].text,/Team Vitality/);
assert.match(live.social.posts[0].text,/3–1/);
live.currentDate='2027-01-10';
socialEngine.runTraining(live);
assert.equal(live.social.posts.length,2);
live.currentDate='2027-01-14';
live.fixtures.push({id:2,homeId:2,awayId:1,homeWins:3,awayWins:2,played:false});
socialEngine.advance(live);
socialEngine.advance(live);
assert.equal(live.social.posts.length,3);
assert.match(live.social.posts[0].text,/Team Vitality/);
live.social.archive.push(live.social.posts.pop());
assert.equal(socialEngine.socialTimeline(live,coachArchiveKey('snaski')).length,3);
assert.deepEqual(socialEngine.socialTimeline(live,'k12'),['native']);
console.log('Coach migration, native passthrough, training cap, cooldown, transfer window and saved vacancies passed.');
