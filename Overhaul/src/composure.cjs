'use strict';

function installComposure(engine, talk, staff) {
  if (typeof engine?.migrateState !== 'function' || typeof engine.setDayNote !== 'function') return null;
  if (engine.setDayNote.rlcComposure) return engine.setDayNote.rlcComposure;
  const key = 'rlc-composure/v1';
  const bound = (value, min, max) => Math.max(min, Math.min(max, value));
  const day = state => Math.floor(Date.parse(state.currentDate) / 86400000);
  const hash = value => [...String(value)].reduce((result, char) => Math.imul(result ^ char.codePointAt(0), 16777619) >>> 0, 2166136261);
  const needsSave = new WeakSet();
  const composureVersion = 2;
  const titleWeight = {
    regional_finalist: 8, regional_champion: 12, season_elite: 11, season_finalist: 15,
    season_champion: 18, major_contender: 8, major_elite: 12, major_finalist: 17, major_champion: 21,
    worlds_contender: 11, worlds_elite: 15, worlds_finalist: 21, worlds_champion: 26
  };

  function coach(team, state) {
    if (staff) return staff.coachFor(state, team);
    if (!team) return null;
    if (Number.isFinite(team.rlcMentalCoach?.composure)) return team.rlcMentalCoach;
    const seed = hash(team.id + ':' + team.name);
    const composure = 42 + (seed >>> 4) % 49;
    return team.rlcMentalCoach = {
      composure,
      style: composure >= 74 ? 'calm' : composure >= 56 ? 'measured' : 'intense',
      bonus: bound(Math.round((composure - 44) / 8), 0, 6)
    };
  }

  function competitionExperience(titles) {
    const seasons = new Set(), wins = new Set();
    let best = 0;
    for (const title of titles) {
      const weight = titleWeight[title?.k];
      if (!Number.isFinite(weight)) continue;
      best = Math.max(best, weight);
      if (Number.isInteger(title.y)) seasons.add(title.y);
      if (title.k.endsWith('_champion')) wins.add(title.id || (title.k + ':' + title.y));
    }
    return Math.round(.82 * (best + bound((seasons.size - 1) * 2, 0, 6) + bound(wins.size - 1, 0, 4)));
  }

  function playerComposure(player) {
    const previous = player.rlcComposure;
    const titles = Array.isArray(player.titles) ? player.titles : [];
    const current = previous?.version === composureVersion && Number.isFinite(previous.base);
    if (current && previous.titlesSeen === titles.length) return previous;
    const honours = competitionExperience(titles);
    const earned = Number.isFinite(previous?.growth) ? bound(previous.growth, 0, 1400) : 0;
    const age = Number(player.age) || 19;
    const ageEffect = bound((age - 17) * 1.1, -3, 11);
    const matches = (Number(player.season?.games) || 0) + (Number(player.career?.games) || 0);
    const seasons = Array.isArray(player.careerHistory) ? player.careerHistory.length : 0;
    const experience = bound(Math.log2(1 + Math.max(0, matches) / 5) * 3.5 + seasons * 1.2, 0, 16) *
      (1 - Math.min(.58, honours / 48));
    const overall = bound(((Number(player.rating) || 62) - 65) * .24, -5, 8);
    const variation = player.real ? 3 : 8;
    const identity = player.real ? String(player.name).trim().toLowerCase() : player.id + ':' + player.name;
    const temperament = hash(identity) % (variation * 2 + 1) - variation;
    const planned = current ? previous.base + Math.max(0, honours - (previous.honours || 0)) :
      Math.round(51 + ageEffect + experience + overall + honours + temperament);
    const custom = Number.isInteger(player.rlcWorldComposure) && player.rlcWorldComposure >= 0 && player.rlcWorldComposure <= 100;
    const base = custom ? bound(player.rlcWorldComposure,0,Math.floor(100-earned/100)) :
      bound(planned, 26, Math.min(94, Math.floor(100 - earned / 100)));
    return player.rlcComposure = {
      version: composureVersion, base, growth: earned,
      cap: Math.max(Math.ceil(base + earned / 100), Math.min(95, base + 14)),
      honours: current ? Math.max(previous.honours || 0, honours) : honours,
      titlesSeen: titles.length,
      ...(Number.isFinite(previous?.last) ? { last: previous.last } : {})
    };
  }

  function ensure(state) {
    if (!Array.isArray(state?.players)) return;
    for (const player of state.players) {
      if (!player) continue;
      const prior = player.rlcComposure;
      if (playerComposure(player) !== prior) needsSave.add(state);
    }
    if (staff) staff.ensure(state);
    else for (const team of state.teams || []) {
      if (team && !Number.isFinite(team.rlcMentalCoach?.composure)) {
        coach(team);
        needsSave.add(state);
      }
    }
  }

  function wrapState(name) {
    const original = engine[name];
    if (typeof original !== 'function') return;
    engine[name] = Object.assign(function (state, ...args) {
      const result = original.call(this, state, ...args);
      ensure(state);
      return result;
    }, original);
  }
  ['migrateState', 'userLineup'].forEach(wrapState);
  if (typeof engine.generateLeague === 'function') {
    const original = engine.generateLeague;
    engine.generateLeague = Object.assign(function (...args) {
      const state = original.apply(this, args);
      ensure(state);
      return state;
    }, original);
  }

  function teamRating(state, team) {
    const ratings = (team?.playerIds || []).map(id => engine.playerById(state, id)?.rating)
      .filter(Number.isFinite).sort((a, b) => b - a).slice(0, 3);
    return ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 66;
  }
  function penalty(state, fixture, player) {
    if (!state || !fixture || !player || player.isUser || state.userPlayerId === player.id) return 0;
    const home = engine.teamById(state, fixture.homeId), away = engine.teamById(state, fixture.awayId);
    const isHome = home?.playerIds?.includes(player.id);
    const isAway = away?.playerIds?.includes(player.id);
    if (!isHome && !isAway) return 0;
    const own = isHome ? home : away, opponent = isHome ? away : home;
    const stage = String(fixture.stage || '').toLowerCase();
    const event = state.events?.find(entry => entry.id === fixture.eventId);
    const stakes = /final|elim/.test(stage) ? .72 : /playoff|upper|lower/.test(stage) ? .49 : .2;
    const matchPoint = Math.floor((fixture.bestOf || 5) / 2);
    const decider = fixture.homeWins === matchPoint && fixture.awayWins === matchPoint;
    const elimination = !decider && Math.max(fixture.homeWins || 0, fixture.awayWins || 0) >= matchPoint;
    const prestige = /major|world|international/i.test(String(event?.kind || '')) ? .18 : 0;
    const underdog = bound((teamRating(state, opponent) - teamRating(state, own) - 3) / 42, 0, .36);
    const budgetGap = own?.budget > 0 && opponent?.budget > 0
      ? bound(Math.log2(opponent.budget / own.budget) * .035, 0, .12) : 0;
    const structureGap = Math.max(budgetGap, own?.tier === 'B' && opponent?.tier === 'A' ? .14 : 0);
    const pressure = bound(stakes + prestige + underdog + structureGap + (decider ? .32 : elimination ? .17 : 0), 0, 1.42);
    const mental = playerComposure(player);
    const effective = bound(mental.base + mental.growth / 100 + (coach(own, state)?.bonus || 0), 0, 100);
    return Math.round(17 * pressure * ((100 - effective) / 100) ** 1.35);
  }

  let simulation;
  if (typeof talk?.boostFor === 'function') {
    const originalBoost = talk.boostFor;
    talk.boostFor = Object.assign(function (fixture, id, ...args) {
      const base = originalBoost.call(this, fixture, id, ...args);
      if (!simulation || !fixture) return base;
      return (Number(base) || 0) - penalty(simulation, fixture, engine.playerById(simulation, id));
    }, originalBoost);
    for (const name of ['advance', 'simulateFixture', 'simulateNextGame', 'nextUserSeries', 'progressEvents', 'startNextSeason']) {
      const original = engine[name];
      if (typeof original !== 'function') continue;
      engine[name] = Object.assign(function (state, ...args) {
        const previous = simulation;
        simulation = state;
        try {
          const result = original.call(this, state, ...args);
          ensure(state);
          return result;
        }
        finally { simulation = previous; }
      }, original);
    }
  }

  const originalNote = engine.setDayNote;
  engine.setDayNote = Object.assign(function (state, noteDay, text) {
    if (noteDay !== key) return originalNote.apply(this, arguments);
    if (!state || typeof text !== 'string' || text.length > 120) return { ok: false, rlcError: 'unavailable' };
    ensure(state);
    if (text === 'sync') {
      const playerChanged = needsSave.delete(state);
      const staffChanged = staff?.needsSave(state);
      return { ok: playerChanged || !!staffChanged };
    }
    const drill = /^drill:(\d+):([0-7](?:,[0-7]){0,2})$/.exec(text);
    if (drill) {
      const player = engine.playerById(state, Number(drill[1]));
      const indices = drill[2].split(',').map(Number);
      const today = day(state);
      if (!player || player.retired || player.teamId !== state.userTeamId || state.liveGame ||
          state.pendingMatch != null || !Number.isFinite(today) ||
          (engine.isPlayerCareer?.(state) && player.id !== state.userPlayerId)) return {ok:false};
      const stats = player.rlcAttributes;
      if (!stats || stats.values?.length !== 8) return {ok:false};
      const maximum = state.realism >= 1 ? Math.min(99,(player.potential || player.rating)+1) : 99;
      const recent = (player.rlcDrillDays || []).filter(d => d > today - 7);
      if (recent.length + indices.length > 3) return {ok:false};
      const fraction = stats.values.map((_,index)=>player.rlcDrillFraction?.[index] ??
        (player.rlcDrillProgress?.[index] || 0)/3);
      const values = [...stats.values];
      for (const index of indices) {
        const current = values[index] + fraction[index];
        if (current >= maximum) return {ok:false};
        const next = Math.min(maximum, current + .08 * Math.exp(-(current - 60)/16));
        values[index] = Math.floor(next);
        fraction[index] = next - values[index];
      }
      player.rlcDrillFraction = fraction;
      stats.values = values;
      const mean = values.reduce((sum,v)=>sum+v,0)/8;
      const overall = Math.round(mean);
      stats.offsets = values.map(v=>v-mean);
      if (player.rating !== overall) player.ratingExact = overall;
      stats.rating = player.rating = overall;
      player.rlcDrillDays = [...recent,...indices.map(()=>today)];
      return {ok:true};
    }
    const target = /^train:([0-9]+)$/.exec(text);
    const player = target && engine.playerById(state, Number(target[1]));
    const own = player && !player.retired && player.teamId === state.userTeamId;
    if (!own || (engine.isPlayerCareer?.(state) && player.id !== state.userPlayerId) ||
        state.liveGame || state.pendingMatch != null || !Number.isFinite(day(state))) return { ok: false, rlcError: 'unavailable' };
    const mental = playerComposure(player);
    if (Number.isFinite(mental.last) && day(state) - mental.last < 7) return { ok: false, rlcError: 'cooldown' };
    const room = (mental.cap - mental.base) * 100 - mental.growth;
    if (room <= 0) return { ok: false, rlcError: 'cap' };
    const trainer = coach(engine.teamById(state, player.teamId), state);
    if (staff && !trainer) return { ok: false, rlcError: 'coach-required' };
    const gain = Math.min(room, staff ? 25 + Math.round(trainer.composure / 4) : 40 + 3 * (trainer?.bonus || 0));
    mental.growth += gain;
    mental.last = day(state);
    return { ok: true, rlcGain: gain };
  }, originalNote, { rlcComposure: penalty });
  return penalty;
}

module.exports = { installComposure };
