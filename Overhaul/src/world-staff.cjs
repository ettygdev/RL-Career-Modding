'use strict';

function installWorldStaff(rules, engine, catalog) {
  if (!rules?.checkWorld || !rules.applyWorld || !engine?.generateLeague || rules.checkWorld.rlcWorldStaff) return;
  const key = 'rlcStaff';
  const nameKey = rules.nameKey;
  const reserved = new Set(catalog.profiles.map(coach => nameKey(coach.name)));
  const text = (value, length) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,length) : '';
  const rating = (value,min,max) => Number.isInteger(value) && value >= min && value <= max;
  function refs(world, index) {
    const out = new Map(world.players.map(player=>['c:'+player.id,{name:player.name,custom:true}]));
    for (const [id,entry] of index.players) out.set('r:'+id,{name:entry.rp.name});
    for (const [id,player] of index.freeAgents) out.set('f:'+id,{name:player.handle||id});
    return out;
  }
  const nativeCheck = rules.checkWorld;
  rules.checkWorld = Object.assign(function (input,context) {
    const result = nativeCheck.apply(this,arguments);
    const draft = input?.[key];
    if (!draft || typeof draft !== 'object') return result;
    const world = result.world;
    const index = rules.baseIndex(context.bases?.[world.rosterYear] || context.base,context.market);
    const known = refs(world,index);
    const composure = Object.fromEntries(Object.entries(draft.composure || {}).filter(([ref,value])=>
      known.has(ref) && rating(value,0,100)));
    const coaches = [];
    const names = new Set(world.players.map(player=>nameKey(player.name)));
    const ids = new Set();
    const clubs = new Set();
    for (const source of (Array.isArray(draft.coaches)?draft.coaches:[]).slice(0,150)) {
      if (!source || !/^custom[a-z0-9]{6,32}$/.test(source.id) || ids.has(source.id)) continue;
      const name = text(source.name,24);
      const normal = nameKey(name);
      if (!normal || reserved.has(normal) || names.has(normal) || context.reserved?.has(normal)) {
        result.errors.push('Give every custom coach a unique name.');
      }
      const team = typeof source.team === 'string' && index.teams.has(source.team) ? source.team : '';
      if (team && clubs.has(team)) result.errors.push('A club can have one custom head coach.');
      names.add(normal);
      ids.add(source.id);
      if (team) clubs.add(team);
      coaches.push({id:source.id,name,team,nation:context.nations?.has(source.nation)?source.nation:'',
        mental:rating(source.mental,0,100)?source.mental:70,
        training:rating(source.training,0,25)?source.training:10,bio:text(source.bio,160)});
    }
    if (Object.keys(composure).length || coaches.length) world[key] = {composure,coaches};
    return result;
  }, nativeCheck,{rlcWorldStaff:true});

  const nativeApply = rules.applyWorld;
  rules.applyWorld = Object.assign(function (base,world,market) {
    const output = nativeApply.apply(this,arguments);
    if (!world?.[key]) return output;
    const known = refs(world,rules.baseIndex(base,market));
    output[key] = {
      composure:Object.entries(world[key].composure).flatMap(([ref,value])=>
        known.has(ref) ? [{...known.get(ref),value}] : []),
      coaches:world[key].coaches.map(profile=>{
        const team = world.teams[profile.team]?.name || profile.team;
        return { id:profile.id,name:profile.name,team,custom:true,
          nation:profile.nation,mental:profile.mental,training:profile.training,bio:profile.bio,
          fee:(profile.training+Math.floor(profile.mental/8))*250 };
      })
    };
    return output;
  },nativeApply);

  const nativeGenerate = engine.generateLeague;
  engine.generateLeague = Object.assign(function (options,...rest) {
    const state = nativeGenerate.call(this,options,...rest);
    const world = options?.real?.[key];
    if (!state || !world) return state;
    for (const item of world.composure) {
      const normalized = nameKey(item.name);
      const matches = state.players.filter(player=>nameKey(player.name) === normalized &&
        (item.custom ? !player.isUser || player.custom : player.real && !player.isUser));
      if (matches.length === 1) matches[0].rlcWorldComposure = item.value;
    }
    if (world.coaches.length) {
      const profiles = world.coaches;
      const clubs = {};
      for (const coach of profiles) {
        const team = state.teams.find(team=>!team.national && team.name===coach.team);
        if (team) clubs[team.id] = coach.id;
      }
      state.rlcCoaches = {clubs,moves:[],customProfiles:profiles};
    }
    return state;
  },nativeGenerate);
}

module.exports = { installWorldStaff };
