'use strict';

function matchOfficialsRules() {
  const base = [50, 65, 80, 95, 97, 99];
  const monthly = [1800, 1450, 1100, 750, 450, 250];
  const plans = [0, .36, .65, .88];
  const fit = (n,min,max)=>Math.min(max,Math.max(min,n));
  const roll = seed => {
    let hash=2166136261;
    for (const c of String(seed)) hash=Math.imul(hash^c.charCodeAt(0),16777619);
    hash=Math.imul(hash^(hash>>>16),2246822519);
    return ((hash^(hash>>>13))>>>0)/4294967296;
  };
  function network(tier,plan) {
    tier=fit(Math.trunc(tier)||1,1,6);
    plan=fit(Math.trunc(plan)||0,0,3);
    const defaultWifi=base[tier-1];
    return {tier,plan,base:defaultWifi,reliability:Math.round(10*(defaultWifi+(99.9-defaultWifi)*plans[plan]))/10,
      monthly:Math.round(monthly[tier-1]*[0,.4,.7,1][plan]/10)*10};
  }
  function arena(state,fixture) {
    const event=state?.events?.find(entry=>entry.id===fixture?.eventId);
    const kind=String(event?.kind || fixture?.eventKind || '').toLowerCase();
    const stage=String(fixture?.stage || '').toLowerCase().replace(/[_-]/g,' ');
    const name=String(event?.name || '');
    const region=String(event?.regionId || '').toLowerCase();
    const kickoffFinalDay=kind==='open' && /^open\s+1\b/i.test(name) &&
      /^2025-12-07\b/.test(fixture?.date || '') && /^(eu|na)$/.test(region) &&
      /^(sf|semi(?:final)?|final|gf|grand final)$/.test(stage);
    const lan=Boolean(fixture?.lan ?? event?.lan ??
      (kickoffFinalDay || fixture?.wcId!=null || /^(major|worlds|club.?finale|kickoff|kick.off tournament)$/.test(kind) ||
        /\b(club finale|world championship|world cup|[a-z]+ major)\b/i.test(name) && !/open|qualif/i.test(name)));
    const qualifier=kind==='lcq' || /qualif.*spot|last chance/.test(kind+' '+name.toLowerCase());
    const open=/open/.test(kind) || /\bopen\b/i.test(name);
    const playoff=/hybrid|playoff|^(?:upper|lower|grand final|final|gf|sf|qf|semi|quarter)/.test(stage);
    const excluded=/swiss|(?:^| )gsl|group|double elim|closed qual|open qual/.test(stage);
    const eligible=Boolean(fixture && fixture.wcId==null && (fixture.bestOf||5)>=3 && (qualifier ||
      /^(major|worlds|club.?finale|kickoff|kick.off tournament)$/.test(kind) ||
      /club.?league|league play/.test(kind+' '+name.toLowerCase()) && !open ||
      (!excluded && playoff)));
    return {lan,eligible};
  }
  function timeoutChance(games,home,bestOf) {
    if (games.length<2) return 0;
    const gap=game=>home ? game.awayGoals-game.homeGoals : game.homeGoals-game.awayGoals;
    if (gap(games.at(-2))<=0 || gap(games.at(-1))<=0) return 0;
    const last=gap(games.at(-1));
    if (last>=10) return 1;
    const baseChance=last===1?.30:Math.min(.93,.30+.085*(last-1));
    return fit(baseChance+(bestOf>=7 && games.length===2?-.10:0),0,.96);
  }
  function benefit(value,coach,composure,random) {
    const quality=fit(1+((value-75)*.009+(coach-70)*.008+(composure-70)*.004),.43,1.55);
    return random<.01*quality?7 : random<.06*quality?4 : random<.36*quality?2 : 0;
  }
  function technicalOutcome(random) {
    return random < 1/3 ? 'resume' : random < 2/3 ? 'kickoff' : 'restart';
  }
  return {network,arena,timeoutChance,benefit,roll,fit,technicalOutcome};
}

function installMatchOfficials(engine, talk, createRules, io) {
  if (!engine?.setDayNote || !engine.sideLineup) return null;
  if (engine.setDayNote.rlcOfficials) return engine.setDayNote.rlcOfficials;
  const rules=createRules();
  const matchPaths=new WeakMap();
  const tokenSession=process.env.RLC_INVENTORY_LAUNCH_TOKEN || String(process.pid);
  const team=(state,id)=>engine.teamById(state,id);
  const gameIndex=fixture=>fixture.games?.length || 0;
  const timeoutState=fixture=>fixture.rlcTimeouts ||= {};
  let liveBreak;
  let simState;
  const localSeed=(state,fixture,game,tag)=>[state.season,fixture.date,fixture.id,game,tag].join(':');

  function clubPlan(state,club) {
    if (!club) return rules.network(1,0);
    const isManaged=club.id===state.userTeamId && !engine.isPlayerCareer?.(state);
    if (isManaged) return rules.network(engine.facilityTier?.(state),club.rlcWifi?.plan);
    const ratio=club.rlcWifi?.tier ?? (club.budget>=3500000?6:club.budget>=1600000?5:
      club.budget>=700000?4:club.budget>=220000?3:club.budget>=65000?2:1);
    return rules.network(ratio,club.rlcWifi?.plan ?? (ratio>=3?2:ratio===2?1:0));
  }
  function monthlyBilling(state, priorDate) {
    if (typeof state?.currentDate!=='string' || typeof priorDate!=='string') return;
    const month=date=>Number(date.slice(0,4))*12+Number(date.slice(5,7))-1;
    const elapsed=month(state.currentDate)-month(priorDate);
    if (!Number.isInteger(elapsed) || elapsed<=0) return;
    for (const club of state.teams || []) {
      if (!club || club.national || !Number.isFinite(club.budget)) continue;
      const plan=clubPlan(state,club);
      let cost=plan.monthly*elapsed;
      if (!cost) continue;
      if (club.budget<cost) {
        cost=plan.monthly*Math.max(0,Math.floor(club.budget/plan.monthly));
        club.rlcWifi={...club.rlcWifi,plan:0};
      }
      club.budget-=cost;
      if (club.id===state.userTeamId && cost) {
        const ledger=state.ledger ||= [];
        ledger.push({date:state.currentDate,kind:'facility',amount:-cost,note:'Internet subscription'});
        if (ledger.length>600) ledger.splice(0,ledger.length-600);
      }
    }
  }
  function incident(state,fixture,game) {
    if (rules.arena(state,fixture).lan) return null;
    const affected=[fixture.homeId,fixture.awayId].filter(id=>
      rules.roll(localSeed(state,fixture,game,'network:'+id))>=clubPlan(state,team(state,id)).reliability/100);
    if (!affected.length) return null;
    const value=tag=>rules.roll(localSeed(state,fixture,game,tag));
    return {teamId:affected[Math.floor(value('network-side')*affected.length)],
      fraction:.16+value('network-time')*.68, seconds:5+Math.floor(value('network-length')*11),
      outcome:rules.technicalOutcome(value('network-restart'))};
  }
  function teamStats(state,fixture,club) {
    const ids=engine.lineupFor?.(state,club,fixture) || club.playerIds?.slice(0,3) || [];
    const players=ids.map(id=>engine.playerById(state,id)).filter(Boolean);
    const avg=fn=>players.length?players.reduce((sum,p)=>sum+fn(p),0)/players.length:70;
    return {overall:avg(p=>p.rating||70),mental:avg(p=>
      (p.rlcComposure?.base ?? 70)+(p.rlcComposure?.growth || 0)/100),coach:club.rlcMentalCoach?.composure ?? 55};
  }
  function choose(state,fixture,managed,manual) {
    const games=fixture.games || [];
    if (!games.length || fixture.played || !rules.arena(state,fixture).eligible) return [];
    const called=timeoutState(fixture);
    return [fixture.homeId,fixture.awayId].flatMap(id=>{
      if (called[id]) return [];
      const club=team(state,id);
      if (!club) return [];
      if (id===managed && manual) return [{id,source:'player'}];
      if (!club.rlcMentalCoach && id===managed) return [];
      const chance=rules.timeoutChance(games,id===fixture.homeId,fixture.bestOf || 5);
      if (rules.roll(localSeed(state,fixture,games.length,'timeout-call:'+id))>=chance) return [];
      return [{id,source:id===managed?'proposal':'ai'}];
    });
  }
  function commit(state,fixture,call) {
    const record=timeoutState(fixture);
    if (record[call.id]) return;
    const club=team(state,call.id);
    const {overall,mental,coach}=teamStats(state,fixture,club);
    record[call.id]={game:gameIndex(fixture),source:call.source,
      boost:rules.benefit(overall,coach,call.id===state.userTeamId?70:mental,
        rules.roll(localSeed(state,fixture,gameIndex(fixture),'timeout-boost:'+call.id)))};
  }
  function bonus(fixture,id) {
    const value=fixture?.rlcTimeouts?.[id];
    return value?.game===gameIndex(fixture)?value.boost:0;
  }
  function allowsRequest(state,fixture) {
    const managed=state.userTeamId;
    return !fixture.played && gameIndex(fixture)+1<(fixture.bestOf||5) &&
      !engine.seriesOver?.(fixture) && rules.arena(state,fixture).eligible &&
      !fixture.rlcTimeouts?.[managed] && [fixture.homeId,fixture.awayId].includes(managed);
  }

  const note=engine.setDayNote;
  engine.setDayNote=Object.assign(function(state,key,text) {
    if (key!=='rlc-wifi/v1') return note.apply(this,arguments);
    if (!/^[0-3]$/.test(text) || !state || state.pendingMatch!=null || engine.isPlayerCareer?.(state))
      return {ok:false,error:'This subscription cannot be changed right now.'};
    const club=team(state,state.userTeamId);
    if (!club) return {ok:false};
    const plan=rules.network(engine.facilityTier?.(state),Number(text));
    if (plan.monthly>club.budget) return {ok:false,error:'The club cannot afford this monthly plan.'};
    club.rlcWifi={...club.rlcWifi,plan:plan.plan};
    return {ok:true};
  },note);
  const board=engine.facilityBoard;
  if (board) engine.facilityBoard=function(state,...args) {
    const result=board.call(this,state,...args);
    const club=state && team(state,state.userTeamId);
    return {...result,rlcWifi:{...clubPlan(state,club),editable:!!club && !engine.isPlayerCareer?.(state)}};
  };

  for (const method of ['advance','simulateFixture','simulateNextGame','progressEvents','processDueFixtures',
    'processDailyEvents','settleToday','nextUserSeries','startNextSeason']) {
    const original=engine[method];
    if (!original) continue;
    engine[method]=Object.assign(function(state,...args) {
      const old=simState, prior=state?.currentDate;
      simState=state;
      try {
        const result=original.call(this,state,...args);
        if ((method==='advance' || method==='startNextSeason') && !old) monthlyBilling(state,prior);
        return result;
      } finally { simState=old; }
    },original);
  }
  if (talk?.boostFor) {
    const native=talk.boostFor;
    talk.boostFor=Object.assign(function(fixture,pid,...args) {
      const original=native.call(this,fixture,pid,...args);
      if (!simState || !fixture || fixture.played) return original;
      const game=gameIndex(fixture), rec=fixture.rlcSimOfficials ||= {};
      if (!Object.hasOwn(rec,game)) {
        const pause=incident(simState,fixture,game);
        rec[game]=pause||null;
        choose(simState,fixture,null,false).forEach(call=>commit(simState,fixture,call));
      }
      const player=engine.playerById(simState,pid);
      if (!player) return original;
      const affected=rec[game]?.teamId===player.teamId ? 1 : 0;
      return (Number(original)||0)+bonus(fixture,player.teamId)-affected;
    },native);
  }
  const originalBoost=engine.talkBoostFor;
  if (originalBoost) engine.talkBoostFor=Object.assign(function(fixture,pid,...args) {
    const result=originalBoost.call(this,fixture,pid,...args);
    const context=matchPaths.get(fixture);
    if (!context) return result;
    const side=[fixture.homeId,fixture.awayId].find(id=>team(context.state,id)?.playerIds?.includes(pid));
    return (Number(result)||0)+bonus(fixture,side);
  },originalBoost);
  const nativeDifficulty=engine.difficultyOf;
  if (nativeDifficulty) engine.difficultyOf=Object.assign(function(state,...args) {
    const fixture=state?.pendingMatch!=null && engine.fixtureById?.(state,state.pendingMatch);
    return fixture?.spectating ? (engine.DIFFICULTIES?.find(entry=>entry.id==='ultimate') || nativeDifficulty.call(this,state,...args)) :
      nativeDifficulty.call(this,state,...args);
  },nativeDifficulty);

  function prepare(state,fixture,dir,entry) {
    matchPaths.set(fixture,{state,dir});
    const no=gameIndex(fixture);
    const pause=incident(state,fixture,no);
    const allowed=allowsRequest(state,fixture);
    const referee=10+Math.floor(90*rules.roll(localSeed(state,fixture,0,'referee')));
    io.write(dir,'inventory-officials.txt',[entry.token,entry.expires,referee,allowed?1:0,
      pause?Math.round(pause.fraction*1000):0,pause?.seconds||0,
      pause?.outcome==='restart'?2:pause?.outcome==='kickoff'?1:0].join(' '));
  }
  function readChoice(dir,token,action) {
    try {
      const [record,choice,time]=io.read(dir,'inventory-officials-' + action + '.txt').trim().split(/\s+/);
      if (record===token && /^\d+$/.test(time)) return {choice,time:Number(time)};
    } catch {}
    return null;
  }
  function takePauseMenuRequest(context,fixture,game) {
    if (!io.remove) return false;
    const file='talk/timeout.json';
    try {
      const request=JSON.parse(io.read(context.dir,file));
      if (String(request.matchId)!==String(fixture.id)) return false;
      io.remove(context.dir,file);
      return request.game==null || Number(request.game)===game;
    } catch { return false; }
  }
  async function showBreak(context,state,fixture,calls,token) {
    const dir=context.dir;
    const abort=()=>state.pendingMatch==null || String(state.pendingMatch)!==String(fixture.id) || fixture.played;
    const proposed=calls.find(call=>call.source==='proposal');
    const start=Date.now(), decisionAt=start+8000, scoreUntil=start+18000;
    io.write(dir,'inventory-intermission.txt',[token,start,scoreUntil].join(' '));
    io.write(dir,'inventory-result-view.txt',[token,'holding',start].join(' '));
    if (proposed) io.write(dir,'inventory-officials-break.txt',[token,'proposal',decisionAt,scoreUntil].join(' '));
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    while (!abort() && Date.now()<scoreUntil) await wait(100);
    if (abort()) return;
    const decision=readChoice(dir,token,'decision');
    const accepted=calls.filter(call=>call!==proposed || decision?.choice!=='no' || decision.time>decisionAt);
    if (!accepted.length) return;
    accepted.forEach(call=>commit(state,fixture,call));
    const until=Date.now()+90000;
    const names=accepted.map(call=>team(state,call.id)?.name).filter(Boolean).join(' / ').replace(/[\r\n\t]/g,' ').slice(0,125);
    io.write(dir,'inventory-result-view.txt',[token,'timeout',Date.now()].join(' '));
    io.write(dir,'inventory-officials-break.txt',[token,'timeout',until,0].join(' ')+'\n'+names);
    while (!abort() && Date.now()<until && readChoice(dir,token,'skip')?.choice!=='skip') await wait(100);
    if (abort()) return;
    const next=tokenSession+'-'+fixture.id+'-'+gameIndex(fixture);
    const released=Date.now(), deadline=released+45000;
    io.write(dir,'inventory-officials-break.txt',[token,'loading',deadline,released].join(' ')+'\n'+names+'\n'+next);
    return {next,released,deadline};
  }
  async function clearBreak(context,state,fixture,token,loading) {
    const dir=context.dir;
    try {
      io.write(dir,'inventory-result-view.txt',[token,'closed',Date.now()].join(' '));
      io.write(dir,'inventory-intermission.txt','');
      if (loading) {
        while (Date.now()<loading.deadline && String(state.pendingMatch)===String(fixture.id) && !fixture.played) {
          const ready=readChoice(dir,loading.next,'ready');
          if (ready?.choice==='ready' && ready.time>=loading.released) break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
      }
      if (liveBreak?.token===token) io.write(dir,'inventory-officials-break.txt','');
    } catch {}
  }
  const result=engine.applyUserResult;
  if (result) engine.applyUserResult=Object.assign(function(state,fixture,report,...args) {
    const before=gameIndex(fixture);
    const outcome=result.call(this,state,fixture,report,...args);
    const context=matchPaths.get(fixture);
    if (!context || outcome?.error || report?.abandoned || gameIndex(fixture)!==before+1) return outcome;
    const token=tokenSession+'-'+fixture.id+'-'+before;
    const technical=readChoice(context.dir,token,'incident');
    if (technical) (fixture.rlcActualIssues ||= {})[before]=technical.choice;
    const manual=takePauseMenuRequest(context,fixture,before+1);
    if (outcome?.seriesOver) return outcome;
    const request=readChoice(context.dir,token,'request');
    const calls=choose(state,fixture,state.userTeamId,manual || request?.choice==='call');
    if (!calls.length) return outcome;
    const pending={fixtureId:String(fixture.id),game:gameIndex(fixture),token};
    liveBreak=pending;
    pending.wait=showBreak(context,state,fixture,calls,token).catch(()=>{}).then(loading=>{
      void clearBreak(context,state,fixture,token,loading);
    });
    return outcome;
  },result);
  function holdNextGame(childProcess) {
    const original=childProcess.execFile;
    if (original.rlcOfficialsHold) return;
    const execFile=function(file,args,...rest) {
      const pending=liveBreak;
      const callback=rest.at(-1);
      const tasklist=typeof file==='string' && /^tasklist \/FI "IMAGENAME eq RocketLeague\.exe" \/FO CSV \/NH$/i.test(file);
      const powershell=file==='powershell.exe' && Array.isArray(args) && args.at(-1)?.includes("GetProcessesByName('RocketLeague')");
      if (!pending || typeof callback!=='function' || !(tasklist || powershell) ||
        !/\bat startNextSeriesGame\b/.test(new Error().stack || '')) return original.call(this,file,args,...rest);
      rest[rest.length-1]=(...result)=>{void pending.wait.then(()=>callback(...result));};
      return original.call(this,file,args,...rest);
    };
    execFile.rlcOfficialsHold=true;
    childProcess.execFile=execFile;
  }
  const api={prepare,allowsRequest,holdNextGame,skipScoreboard:(id,game)=>liveBreak?.fixtureId===String(id)&&liveBreak.game===game};
  engine.setDayNote.rlcOfficials=api;
  return api;
}

module.exports={matchOfficialsRules,installMatchOfficials};
