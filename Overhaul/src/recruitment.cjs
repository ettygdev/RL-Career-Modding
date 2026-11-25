'use strict';

function recruitmentRules() {
  const attributes = [
    ['attack','Attack','Attaque'], ['defense','Defense','Défense'],
    ['mechanics','Mechanics','Mécaniques'], ['passing','Passing','Passes'],
    ['bumps','Bumps','Bumps'], ['gameSense','Game Sense','Lecture du jeu'],
    ['ballControl','Ball Control','Contrôle de balle'], ['communication','Communication','Communication']
  ];
  const market = [
    [101,'Nina Laurent',56,72,64,0,180], [102,'Mateo Fischer',64,86,53,650,240],
    [103,'Leila Mansour',75,73,88,1200,325], [104,'Gabriel Reed',82,83,72,2200,430],
    [105,'Sofia Bennett',91,77,92,3600,560], [106,'Alex Morgan',96,91,85,5200,720],
    [107,'Jules Moreau',73,81,78,1300,330], [108,'Camila Duarte',67,77,88,900,290],
    [109,'Idris Haddad',85,70,93,2800,470], [110,'Eleanor Hughes',80,88,70,2000,400],
    [111,'Hana Sato',89,76,86,3100,520], [112,'Luca Bellini',92,84,78,4000,590],
    [113,'Omar Nasser',60,76,66,600,210], [114,'Maya Brooks',76,91,80,1750,360],
    [115,'Nils Bergström',84,79,83,2450,440], [116,'Zoé Mercier',94,82,96,4600,630]
  ];
  const normalize = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
  const cap = (value,lo,hi) => Math.min(hi,Math.max(lo,value));
  const hash = value => Array.from(String(value)).reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619),2166136261)>>>0;
  function stats(rating,offsets) {
    const target=cap(rating,0,100)*attributes.length;
    const values=offsets.map(offset=>cap(Math.round(rating+offset),0,100));
    let total=values.reduce((sum,value)=>sum+value,0);
    const whole=Math.trunc(target), step=Math.sign(whole-total);
    const order=offsets.map((_,i)=>i).sort((a,b)=>step*(offsets[b]-offsets[a]));
    while (total!==whole) for (const i of order) {
      if (total===whole) break;
      const next=values[i]+step;
      if (next<0 || next>100) continue;
      values[i]=next;
      total+=step;
    }
    if (target>whole) values[order.find(i=>values[i]<100)]+=target-whole;
    return values;
  }
  function range(value,level) {
    if (level>=90) return [value,value];
    const width=level>=80?2:level>=70?4:level>=60?6:8;
    const low=cap(Math.floor(value-width/2),0,100-width);
    return [low,low+width];
  }
  return {attributes,market,normalize,cap,hash,stats,range};
}

function installRecruitment(engine,makeRules,research,botStyles) {
  if (!engine?.setDayNote || !engine.playerView || engine.setDayNote.rlcRecruitment) return;
  const R=makeRules();
  function attributes(player) {
    const rating=Number(player.rating);
    if (!Number.isFinite(rating)) return null;
    const stored=player.rlcAttributes;
    if (stored?.rating===rating && stored.values?.length===8) return stored.values;
    const style=String(botStyles?.playstyleFor?.(player) || '').toLowerCase();
    const key=R.normalize(player.name);
    const researched=player.real && Object.hasOwn(research.weights,key) ? research.weights[key] : null;
    const profile=/defen|guard/.test(style)?[-2,4,0,0,-1,3,0,1]:
      /attack|strik|offen/.test(style)?[4,-2,2,0,1,0,2,0]:[0,0,0,0,0,0,0,0];
    const seed=player.real ? key : (player.id+':'+key);
    const offsets=stored?.offsets?.length===8?stored.offsets:researched ||
      profile.map((bias,i)=>bias+(R.hash(seed+':'+i)%11)-5);
    const values=R.stats(rating,offsets);
    player.rlcAttributes={rating,offsets,values};
    return values;
  }
  const own = (state,player) => player.isUser || (player.teamId>=0 && player.teamId===state.userTeamId);
  const scouts = state => (state.staff ||= []).filter(person=>person.role==='scout');
  const jobs = state => (state.scouts ||= {jobs:[],reports:{},partial:{}}).jobs;
  function department(state) {
    const section=state.rlcScouting ||= {shortlist:[]};
    if (!section.marketClubs) {
      const teams=(state.teams||[]).filter(t=>!t.national&&t.id!==state.userTeamId);
      section.marketClubs=Object.fromEntries(R.market.map(([id])=>
        [id,id>=107 && id%3!==1 ? teams[R.hash(id+':scout')%teams.length]?.id??null : null]));
    }
    return section;
  }
  function staffStats(scout) {
    return scout.rlcScout ||= {level:55+R.hash(scout.name)%11,speed:55+R.hash('speed:'+scout.name)%21,
      youth:52+R.hash('youth:'+scout.name)%22};
  }
  function initialize(state) {
    if (!Array.isArray(state?.players)) return;
    for (const player of state.players) attributes(player);
    for (const scout of scouts(state)) staffStats(scout);
    department(state);
  }
  function makeReport(state,player,report,scout) {
    const values=attributes(player);
    if (!values) return;
    const level=scout?.level || 62, overall=report.rating ?? player.rating;
    const snapshot=R.stats(overall,player.rlcAttributes.offsets);
    const potential=engine.reachableCeiling?.(player) ?? overall;
    const radius=Math.max(2, Math.round((105-(scout?.youth||58))/10));
    const known=R.range(overall,level);
    report.potLo=R.cap(potential-radius,overall,100);
    report.potHi=R.cap(potential+radius,report.potLo,100);
    report.rlc={rating:known, skills:snapshot.map(value=>R.range(value,level)), level,
      scout:scout?.name || null, date:report.date || state.currentDate};
  }
  function complete(state,pending,previous,firstNewId) {
    for (const job of pending) {
      const native=state.scouts?.reports?.[job.playerId], player=engine.playerById(state,job.playerId);
      if (!native || native===previous.get(job.playerId) || !player) continue;
      const person=scouts(state).find(item=>item.id===job.scoutId);
      makeReport(state,player,native,job.rlcScout || (person && {...staffStats(person),name:person.name}));
      if (!native.rlc) continue;
      const [lo,hi]=native.rlc.rating;
      const item=state.inbox?.findLast(entry=>entry.type==='scout_report' && entry.id>=firstNewId &&
        entry.title?.endsWith(player.name));
      if (item && lo!==hi) {
        const fr=/^fr\b/i.test(state.lang || state.language || '');
        item.body=fr ? `${player.name} · Note estimée ${lo}–${hi}. Consulte le rapport dans Scouting.` :
          `${player.name} · Estimated overall ${lo}–${hi}. See the report in Scouting.`;
      }
    }
  }
  for (const method of ['generateLeague','migrateState','advance','processScouting','runTraining','startNextSeason']) {
    const original=engine[method];
    if (typeof original!=='function') continue;
    engine[method]=Object.assign(function (state,...args) {
      const pending=state?.scouts?.jobs?.slice() || [];
      const previous=new Map(pending.map(job=>[job.playerId,state.scouts?.reports?.[job.playerId]]));
      const firstNewId=state?.nextId;
      const result=original.call(this,state,...args);
      const current=method==='generateLeague'?result:state;
      initialize(current);
      if (method==='advance' || method==='processScouting' || method==='startNextSeason')
        complete(current,pending,previous,firstNewId);
      return result;
    },original);
  }

  const nativeView=engine.playerView;
  engine.playerView=function(state,player,...args) {
    const view=nativeView.call(this,state,player,...args);
    if (own(state,player)) return {...view,ratingKnown:true,rating:player.rating,
      rlcSkills:attributes(player)?.map(value=>[value,value])};
    const report=state.scouts?.reports?.[player.id];
    if (report && !report.rlc) makeReport(state,player,report,null);
    const intel=report?.rlc;
    const active=intel && engine.activeScoutJob?.(state,player.id);
    const duration=active ? Math.max(1,engine.daysBetween(active.startDate,active.endDate)) : 0;
    const daysLeft=active ? Math.max(0,engine.daysBetween(state.currentDate,active.endDate)) : 0;
    const estimate=active ? {daysLeft,progress:R.cap(1-daysLeft/duration,0,1)} :
      view.est ? {...view.est,ratingLo:'?',ratingHi:'?',potLo:'?',potHi:'?'} : undefined;
    const exact=intel && intel.rating[0]===intel.rating[1];
    return {...view,ratingKnown:!!exact,rating:exact?intel.rating[0]:undefined,
      wage:exact?view.wage:undefined,value:exact?view.value:undefined,mediaIncome:undefined,reach:undefined,
      potKnown:!!intel,potLo:intel?report.potLo:undefined,potHi:intel?report.potHi:undefined,
      est:intel?{...estimate,ratingLo:intel.rating[0],ratingHi:intel.rating[1],potLo:report.potLo,potHi:report.potHi}:estimate,
      rlcSkills:intel?.skills,rlcReport:intel?{date:intel.date,scout:intel.scout,level:intel.level,
        stale:(engine.daysBetween?.(intel.date,state.currentDate) || 0)>=60}:null,
      rlcShortlisted:state.rlcScouting?.shortlist?.includes(player.id) || false};
  };

  const nativeStart=engine.startScouting;
  const nativeStop=engine.stopScouting;
  function dispatch(state,id,rand,selected,repeat=false) {
    const player=engine.playerById(state,id);
    if (!player || player.retired || own(state,player)) return {ok:false,error:'Choose a player outside your club.'};
    const active=jobs(state);
    const available=scouts(state).filter(scout=>!active.some(job=>job.scoutId===scout.id))
      .sort((a,b)=>staffStats(b).level-staffStats(a).level || a.id-b.id);
    const scout=selected==null?available[0]:available.find(item=>item.id===selected);
    if (!scout || active.length>=engine.SCOUT_SLOTS)
      return {ok:false,error:'No scout is available.'};
    const reports=state.scouts.reports, previous=reports[id];
    if (repeat && previous) delete reports[id];
    let result;
    try { result=nativeStart.call(engine,state,id,rand); }
    finally { if (repeat && previous) reports[id]=previous; }
    if (!result?.ok) return result;
    const job=active.find(entry=>entry.playerId===id);
    const skill=staffStats(scout);
    job.scoutId=scout.id;
    job.rlcScout={...skill,name:scout.name};
    if (result.resumed) return result;
    const days=Math.max(3,Math.round(12-(skill.speed-45)/6));
    job.endDate=engine.addDays(state.currentDate,days);
    return {...result,days};
  }
  engine.startScouting=function(state,id,rand) {
    return dispatch(state,id,rand);
  };
  const roster=engine.scoutRoster;
  engine.scoutRoster=function(state) {
    const people=scouts(state);
    return roster.call(this,state).map(row=>{
      const scout=people.find(item=>item.id===row.id);
      return {...row,...staffStats(scout),wage:scout.wage};
    });
  };

  const error=message=>({ok:false,error:message});
  const note=engine.setDayNote;
  engine.setDayNote=Object.assign(function(state,key,text) {
    if (key!=='rlc-recruitment/v1') return note.apply(this,arguments);
    if (!state || state.pendingMatch!=null || engine.isPlayerCareer?.(state))
      return error('Available from a club career outside matches.');
    const [action,subject,param]=String(text).split(':');
    const id=Number(subject), raw=Number(param), club=engine.teamById(state,state.userTeamId);
    if (!club) return error('Club unavailable.');
    if (action==='hire') {
      const item=R.market.find(row=>row[0]===id);
      if (!item || scouts(state).length>=engine.SCOUT_SLOTS || scouts(state).some(scout=>scout.id===id) ||
          club.budget<item[5]+item[6]) return error('No slot or insufficient budget.');
      const [,name,level,speed,youth,fee,wage]=item;
      const market=department(state).marketClubs;
      const seller=market[id]!=null?engine.teamById(state,market[id]):null;
      state.staff.push({id,name,role:'scout',wage,rlcScout:{level,speed,youth}});
      market[id]=club.id;
      club.budget-=fee;
      if (seller && seller.id!==club.id) seller.budget+=fee;
      if (fee) engine.pushLedger?.(state,'wages',-fee,name);
      return {ok:true};
    }
    if (action==='release') {
      const scout=scouts(state).find(person=>person.id===id);
      if (!scout || jobs(state).some(job=>job.scoutId===id)) return error('Recall this scout before releasing them.');
      state.staff=state.staff.filter(person=>person!==scout);
      department(state).marketClubs[id]=null;
      return {ok:true};
    }
    const player=engine.playerById(state,id);
    if (!player || own(state,player) || player.retired) return error('Choose a player outside your club.');
    if (action==='shortlist') {
      const data=department(state);
      if (data.shortlist.includes(id)) data.shortlist=data.shortlist.filter(pid=>pid!==id);
      else data.shortlist.push(id);
      return {ok:true};
    }
    if (action==='recall') return nativeStop.call(engine,state,id);
    if (action==='scout' || action==='refresh') {
      const rand=engine.makeRand(R.hash(state.currentDate+':'+id+':'+state.nextId));
      return dispatch(state,id,rand,Number.isInteger(raw)&&raw>0?raw:null,action==='refresh');
    }
    return error('Unknown career action.');
  },note,{rlcRecruitment:true});
}

module.exports={recruitmentRules,installRecruitment};
