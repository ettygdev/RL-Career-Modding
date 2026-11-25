'use strict';

function coachAudience(profile, club) {
  const known = {
    apparentlyjack:220000, fairypeak:145000, violentpanda:115000, jknaps:105000, kuxir97:78000,
    extra:65000, gregan:48000, ferra:46000, fireburner:42500, virge:33500, kassio:27500,
    chrome:25000, eversax:23000, snaski:21000, satthew:20500, rolldizz:19200, mew:16500,
    freakii:13500, yukeo:12500, stake:11000, d7oom24:9800, eekso:8700, pekitas:7900,
    sadjunior:7600, memory:7100, andythemandy:5900, lbp:5300
  };
  if (Object.hasOwn(known,profile.id)) return known[profile.id];
  const seed = [...profile.id].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,0);
  const years = profile.since ? Math.max(1,(profile.last || 2026)-profile.since+1) : 1;
  return Math.round(120 + seed%420 + Math.min(8,years-1)*245 +
    Math.min(4500,Math.sqrt(Math.max(0,club?.followers || 0))*2.4));
}

function coachArchiveKey(id) {
  return 'k0'+[...id].map(c=>String(c.charCodeAt(0)).padStart(3,'0')).join('');
}

function installCoachSocial(engine, catalog, audience, archiveKey) {
  if (!engine?.socialTimeline || engine.socialTimeline.rlcCoachSocial) return;
  const profiles = new Map(catalog.profiles.map(profile=>[profile.id,profile]));
  const day = date => Date.parse(date) / 86400000;
  const variants = {
    win: [
      ['Good series against {opponent}. Proud of how the group closed it out ({score}).','Belle série contre {opponent}. Fier de la façon dont le groupe l’a conclue ({score}).'],
      ['We stayed composed when it got close. Glad to take that one {score} against {opponent}.','On est restés calmes quand ça s’est resserré. Content de prendre cette série {score} contre {opponent}.'],
      ['A lot to like from the team today. GG {opponent}, {score}.','Beaucoup de bonnes choses de la part de l’équipe aujourd’hui. GG {opponent}, {score}.']
    ],
    loss: [
      ['GG {opponent}. A {score} loss gives us plenty to review before the next one.','GG {opponent}. Après cette défaite {score}, on a de quoi travailler avant le prochain match.'],
      ['Tough one against {opponent} ({score}). We’ll watch it back and get to work.','Série difficile contre {opponent} ({score}). On va revoir le match et se remettre au travail.'],
      ['We had chances against {opponent}. Credit to them for taking it {score}.','On a eu nos chances contre {opponent}. Bravo à eux pour cette série remportée sur le score de {score}.']
    ],
    training: [
      ['Good session with {club} today. We found a few things to take into the next series.','Bonne séance avec {club} aujourd’hui. On a trouvé quelques pistes pour la prochaine série.'],
      ['Productive day with {club}. The group has a clear focus for the next block.','Journée productive avec {club}. Le groupe sait sur quoi se concentrer pour la suite.']
    ],
    hire: [
      ['Happy to be joining {club}. Looking forward to getting to work with the team.','Content de rejoindre {club}. J’ai hâte de commencer à travailler avec l’équipe.'],
      ['I’m joining {club} as head coach. Thanks for the welcome. Time to get started.','Je rejoins {club} comme coach principal. Merci pour l’accueil, on se met au travail.']
    ]
  };
  const fill = (text,fields)=>text.replace(/\{(opponent|score|club)\}/g,(_,field)=>fields[field]);
  function publish(state, club, type, fields={}, marker) {
    const staff=state?.rlcCoaches;
    const id=club?.rlcMentalCoach?.id;
    const profile=profiles.get(id) || staff?.customProfiles?.find(profile=>profile.id===id);
    if (!staff || !profile || !Array.isArray(state.social?.posts) || !Number.isSafeInteger(state.nextId)) return false;
    const today=day(state.currentDate);
    if (!Number.isFinite(today)) return false;
    const last=staff.lastCoachPost ||= {};
    if (last[id] && (last[id].marker===marker || today-day(last[id].date)<3)) return false;
    const texts=variants[type];
    const postId=state.nextId++;
    const [english,french]=texts[postId%texts.length];
    const followers=audience(profile,club);
    const views=Math.round(followers*(.31+postId%21/100));
    const likes=Math.round(views*(.025+postId%8/1000));
    state.social.posts.unshift({
      id:postId, date:state.currentDate, kind:'coach', authorId:id, clubId:club.id, rlcCoachId:id,
      name:profile.name, handle:engine.handleFor(profile.name), text:fill(english,{...fields,club:club.name}),
      rlcCoachTextFr:fill(french,{...fields,club:club.name}), followers, verified:followers>=50000,
      views, likes, reposts:Math.round(likes*.09), replies:Math.round(likes*.06)
    });
    if (state.social.posts.length>220) (state.social.archive ||= []).unshift(...state.social.posts.splice(220));
    last[id]={date:state.currentDate,marker};
    return true;
  }
  function seriesPost(state, fixture) {
    if (!fixture?.played || !Number.isInteger(fixture.homeWins) || !Number.isInteger(fixture.awayWins) ||
      fixture.homeWins===fixture.awayWins) return;
    const home=engine.teamById(state,fixture.homeId), away=engine.teamById(state,fixture.awayId);
    const sides=fixture.awayId===state.userTeamId ? [[away,home,false],[home,away,true]] : [[home,away,true],[away,home,false]];
    for (const [team,opponent,isHome] of sides) {
      if (!team || !opponent) continue;
      const won=isHome?fixture.homeWins:fixture.awayWins;
      const lost=isHome?fixture.awayWins:fixture.homeWins;
      const victory=won>lost;
      if (publish(state,team,victory?'win':'loss',{opponent:opponent.name,
        score:(victory?won:lost)+'–'+(victory?lost:won)},'series:'+state.season+':'+fixture.id)) return;
    }
  }
  const timeline=engine.socialTimeline;
  engine.socialTimeline=Object.assign(function(state,key,...args) {
    if (!/^k0\d+$/.test(key)) return timeline.call(this,state,key,...args);
    return [...(state.social?.posts || []),...(state.social?.archive || [])].filter(post=>
      post.rlcCoachId && archiveKey(post.rlcCoachId)===key);
  },timeline,{rlcCoachSocial:true});
  for (const name of ['applyUserResult','advance','runTraining','setDayNote']) {
    const original=engine[name];
    if (typeof original!=='function') continue;
    engine[name]=Object.assign(function(state,...args) {
      const watched=name==='advance' ? new Set((state?.fixtures || []).filter(fixture=>fixture.played).map(fixture=>fixture.id)) : null;
      const result=original.call(this,state,...args);
      if (name==='applyUserResult' && result?.seriesOver && !result.alreadyPlayed && !result.error && !args[1]?.abandoned) {
        seriesPost(state,args[0]);
      } else if (name==='advance') {
        const played=(state?.fixtures || []).filter(fixture=>fixture.played && !watched.has(fixture.id) &&
          (fixture.homeId===state.userTeamId || fixture.awayId===state.userTeamId ||
            engine.teamById(state,fixture.homeId)?.rlcMentalCoach || engine.teamById(state,fixture.awayId)?.rlcMentalCoach));
        played.sort((a,b)=>Number(b.homeId===state.userTeamId || b.awayId===state.userTeamId)-
          Number(a.homeId===state.userTeamId || a.awayId===state.userTeamId) || String(b.date).localeCompare(String(a.date)));
        if (played.length) seriesPost(state,played[0]);
      } else if (result?.ok) {
        const team=engine.teamById(state,state.userTeamId);
        if (name==='runTraining' || (args[0]==='rlc-composure/v1' && /^train:/.test(args[1]))) {
          publish(state,team,'training',{},'training:'+state.currentDate);
        } else if (args[0]==='rlc-coaches/v1' && /^hire:/.test(args[1])) {
          publish(state,team,'hire',{},'hire:'+state.currentDate);
        }
      }
      return result;
    },original);
  }
}

module.exports={coachAudience,coachArchiveKey,installCoachSocial};
