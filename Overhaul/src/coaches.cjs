'use strict';

function installCoaches(engine, catalog) {
  if (typeof engine?.transferWindow !== 'function' || typeof engine.setDayNote !== 'function') return null;
  if (engine.setDayNote.rlcStaff) return engine.setDayNote.rlcStaff;
  const normalize = name => String(name || '').normalize('NFKD').toLowerCase().replace(/\p{M}|[^a-z0-9]/gu, '');
  const profiles = new Map(catalog.profiles.map(profile => [profile.id, profile]));
  const defaults = new Map(catalog.assignments.map(([club, id]) => [normalize(club), id]));
  const identities = new Map();
  for (const profile of profiles.values()) {
    for (const name of [profile.name, ...(profile.playerAliases || [])]) {
      const handle = normalize(name);
      if (!handle) continue;
      const matches = identities.get(handle) || [];
      if (!matches.includes(profile)) matches.push(profile);
      identities.set(handle, matches);
    }
  }
  const dirty = new WeakSet();
  const indexed = new WeakMap();
  const own = (object, key) => Object.hasOwn(object, key);
  const profileFor = (state,id) => profiles.get(id) || state?.rlcCoaches?.customProfiles?.find(profile=>profile.id===id);

  function identity(player) {
    if (!player?.real || player.isUser) return null;
    const names = identities.get(normalize(player.name)) || [];
    const country = normalize(player.nation);
    const matches = names.filter(profile => !country || !profile.nation || normalize(profile.nation) === country);
    return matches.length === 1 ? matches[0].id : null;
  }

  function activePlayers(state) {
    const contracts = {};
    for (const player of state.players || []) {
      if (player?.retired || !(player?.teamId >= 0)) continue;
      const id = identity(player);
      if (id) contracts[id] = player.id;
    }
    return contracts;
  }

  function refresh(state, team, profile) {
    const shortfall = team.tier === 'B' || (Number.isFinite(team.budget) && team.budget < 30000);
    const bonus = profile ? (profile.mental >= 85 ? 3 : profile.mental >= 72 ? 2 : profile.mental >= 60 ? 1 : 0)
      - (shortfall && profile.mental < 66 ? 1 : 0) : 0;
    if (!profile) {
      if (team.rlcMentalCoach != null) { team.rlcMentalCoach = null; dirty.add(state); }
      return null;
    }
    if (team.rlcMentalCoach?.id !== profile.id || team.rlcMentalCoach.bonus !== bonus) {
      team.rlcMentalCoach = { id: profile.id, name: profile.name, composure: profile.mental, bonus, training: profile.training,
        style: profile.mental >= 78 ? 'calm' : profile.mental >= 65 ? 'measured' : 'intense' };
      dirty.add(state);
    }
    return team.rlcMentalCoach;
  }

  function ensure(state) {
    if (!Array.isArray(state?.teams)) return null;
    const staff = state.rlcCoaches ||= { clubs: {}, moves: [] };
    const assignmentVersion = catalog.assignmentVersion || 1;
    const updateDefaults = staff.assignmentVersion !== assignmentVersion;
    const movedClubs = updateDefaults ? new Set(staff.moves.flatMap(move => [move.from, move.to])) : null;
    const occupied = new Map();
    const players = activePlayers(state);
    if (JSON.stringify(staff.playerContracts) !== JSON.stringify(players)) {
      staff.playerContracts = players;
      dirty.add(state);
    }
    for (const team of state.teams) {
      if (team && !team.national && own(staff.clubs, team.id) && profileFor(state,staff.clubs[team.id])) {
        const id = staff.clubs[team.id];
        if (own(players, id) || occupied.has(id)) {
          staff.clubs[team.id] = null;
          staff.moves.push({date:state.currentDate,id,from:team.id,to:null,fee:0,
            reason:own(players,id) ? 'player-contract' : 'duplicate'});
          movedClubs?.add(team.id);
          dirty.add(state);
        } else occupied.set(id, team);
      }
    }
    for (const team of state.teams) {
      if (!team || team.national) continue;
      if (!own(staff.clubs, team.id) || (updateDefaults && !staff.clubs[team.id] && !movedClubs.has(team.id))) {
        const candidate = defaults.get(normalize(team.name));
        const id = profiles.has(candidate) && !occupied.has(candidate) && !own(players,candidate) ? candidate : null;
        staff.clubs[team.id] = id;
        if (id) occupied.set(id, team);
        dirty.add(state);
      }
      refresh(state, team, profileFor(state,staff.clubs[team.id]));
    }
    if (updateDefaults) {
      staff.assignmentVersion = assignmentVersion;
      dirty.add(state);
    }
    syncPlayerAvailability(state,staff);
    indexed.set(state, staff);
    return staff;
  }

  function coachFor(state, team) {
    if (!team || team.national) return null;
    const staff = indexed.get(state) || ensure(state);
    return staff ? refresh(state, team, profileFor(state,staff.clubs[team.id])) : null;
  }

  function contracted(state, player) {
    const id = identity(player);
    return !!id && Object.values(state?.rlcCoaches?.clubs || {}).includes(id);
  }

  function syncPlayerAvailability(state,staff) {
    const ids = (state.players || []).filter(player => !player?.retired && contracted(state,player)).map(player=>player.id);
    if (JSON.stringify(staff.coachingPlayerIds) !== JSON.stringify(ids)) {
      staff.coachingPlayerIds = ids;
      dirty.add(state);
    }
  }

  function withoutCoachingPlayers(original, context, state, args) {
    const hidden = [];
    for (const player of state.players || []) {
      if (!player || player.retired || !contracted(state, player)) continue;
      hidden.push([player, player.retired, player.freeAgent]);
      player.retired = true;
      if (player.freeAgent) player.freeAgent = false;
    }
    try { return original.call(context, state, ...args); }
    finally {
      for (const [player, retired, freeAgent] of hidden) {
        if (retired === undefined) delete player.retired;
        else player.retired = retired;
        if (freeAgent !== undefined) player.freeAgent = freeAgent;
      }
    }
  }

  for (const name of ['migrateState', 'generateLeague', 'startNextSeason', 'advance', 'bestFreeAgent']) {
    const original = engine[name];
    if (typeof original !== 'function') continue;
    engine[name] = Object.assign(function (...args) {
      const simulate = name === 'advance' || name === 'startNextSeason' || name === 'bestFreeAgent';
      if (simulate) ensure(args[0]);
      const result = simulate ? withoutCoachingPlayers(original, this, args[0], args.slice(1)) : original.apply(this,args);
      ensure(name === 'generateLeague' ? result : args[0]);
      return result;
    }, original);
  }

  for (const name of ['makeOffer', 'contractInfo', 'attemptContract', 'completeTransfer', 'signComeback']) {
    const original = engine[name];
    if (typeof original !== 'function') continue;
    engine[name] = Object.assign(function (state, ...args) {
      let player;
      if (name === 'completeTransfer') player = args[0];
      else if (name === 'signComeback') player = { real:true, name:args[0]?.handle, nation:args[0]?.nation };
      else {
        const pid = name === 'makeOffer' ? args[0] : args[0] === 'buy'
          ? state?.offersOut?.find(offer => offer.id === args[1])?.playerId : args[1];
        if (pid != null) player = engine.playerById(state,pid);
      }
      if (contracted(state,player)) {
        if (name === 'completeTransfer' || name === 'signComeback') return null;
        return { ok:false, error:'This player is under contract as a coach.' };
      }
      const result = original.call(this,state,...args);
      if (name !== 'contractInfo') ensure(state);
      return result;
    }, original);
  }

  if (typeof engine.runTraining === 'function' && typeof engine.trainingPlan === 'function') {
    const original = engine.runTraining;
    engine.runTraining = Object.assign(function (state, ...args) {
      const team = engine.teamById(state, state.userTeamId);
      const coach = coachFor(state, team);
      if (!coach) return original.call(this, state, ...args);
      const ids = new Set(engine.trainingPlan(state).map(slot => slot.pid).filter(id => id != null));
      const before = [...ids].map(id => engine.playerById(state, id)).filter(player => player?.teamId === team.id)
        .map(player => [player, player.ratingExact ?? player.rating, player.rating]);
      const result = original.call(this, state, ...args);
      if (result?.ok) for (const [player, start, rating] of before) {
        const gain = player.ratingExact - start;
        if (!(gain > 0)) continue;
        const cap = state.realism >= 1 ? Math.min(99, (player.potential || rating) + 1) : 99;
        const extra = Math.max(0, Math.min(cap - player.ratingExact, gain * coach.training / 100));
        player.ratingExact += extra;
        player.rating = Math.floor(player.ratingExact);
      }
      return result;
    }, original);
  }

  const originalNote = engine.setDayNote;
  const api = { ensure, coachFor, needsSave: state => dirty.delete(state) };
  engine.setDayNote = Object.assign(function (state, day, text) {
    if (day !== 'rlc-coaches/v1') return originalNote.apply(this, arguments);
    const staff = ensure(state);
    if (text === 'sync') return { ok: !!staff && dirty.delete(state) };
    const reject = error => ({ ok: false, error });
    const follow = typeof text === 'string' && /^follow:([a-z0-9]{1,40})$/.exec(text);
    if (staff && follow && profileFor(state,follow[1])) {
      const current = staff.followed || [];
      staff.followed = current.includes(follow[1]) ? current.filter(id=>id!==follow[1]) : [...current,follow[1]];
      return {ok:true};
    }
    if (!staff || state.pendingMatch != null || state.liveGame || engine.isPlayerCareer?.(state)) {
      return reject('Coach recruitment is unavailable right now.');
    }
    if (!engine.transferWindow(state).open) return reject('The transfer window is closed.');
    const team = engine.teamById(state, state.userTeamId);
    if (!team || team.national) return reject('Coach recruitment is unavailable right now.');
    const current = staff.clubs[team.id];
    const target = typeof text === 'string' && /^hire:([a-z0-9]{1,40})$/.exec(text);
    const profile = target && profileFor(state,target[1]);
    if (text === 'release' && current) {
      staff.clubs[team.id] = null;
      staff.moves.push({ date: state.currentDate, id: current, from: team.id, to: null, fee: 0 });
      refresh(state, team, null);
      syncPlayerAvailability(state,staff);
      return { ok: true };
    }
    if (!profile || profile.legacyOnly || profile.id === current) return reject('Choose a different coach.');
    if (own(staff.playerContracts, profile.id)) return reject('This person is under contract as a player.');
    const seller = state.teams.find(club => club && !club.national && staff.clubs[club.id] === profile.id);
    if (!seller && profile.external && !Object.values(staff.clubs).includes(profile.id) &&
      !staff.moves.some(move => move.id === profile.id)) return reject('This coach is employed outside this career.');
    const fee = profile.fee * (seller ? 3 : 1);
    if (!Number.isFinite(team.budget) || team.budget < fee) return reject('The club budget cannot cover the fee.');
    team.budget -= fee;
    if (seller) {
      if (Number.isFinite(seller.budget)) seller.budget += fee;
      staff.clubs[seller.id] = null;
      refresh(state, seller, null);
    }
    if (current) staff.moves.push({ date: state.currentDate, id: current, from: team.id, to: null, fee: 0 });
    staff.clubs[team.id] = profile.id;
    staff.moves.push({ date: state.currentDate, id: profile.id, from: seller?.id ?? null, to: team.id, fee });
    refresh(state, team, profile);
    syncPlayerAvailability(state,staff);
    return { ok: true };
  }, originalNote, { rlcStaff: api });
  return api;
}

module.exports = { installCoaches };
