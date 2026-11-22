'use strict';

function createDmRelationships(engine) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = value => Math.round(value * 10) / 10;

  function teammateOf(state, peer) {
    return peer.id !== state.userPlayerId && peer.teamId >= 0 && peer.teamId === state.userTeamId;
  }

  function current(state, peer) {
    const teammate = teammateOf(state, peer);
    const saved = state.social?.yRelationships?.[peer.id];
    const trust = Number.isFinite(saved?.trust) ? clamp(saved.trust, 0, 100) : 50;
    const morale = Number.isFinite(peer.morale) ? clamp(peer.morale, 0, 100) : 72;
    return { teammate, trust, morale: teammate ? morale : null };
  }

  const signals = {
    greeting: [
      [7, /^(?:hey|hi|hello|salut|bonjour|yo|hola|ola|hallo|مرحبا|اهلا)[!.\s]*$/u],
      [3, /^(?:hey|hi|hello|salut|bonjour|hola|ola|hallo)\b/u]
    ],
    checkin: [
      [8, /(?:how (?:are you|are things)|how(?:'s| is) it going|comment (?:ca va|vas-tu)|tu vas bien|como (?:estas|vais)|wie geht|كيف حالك)/u],
      [6, /^(?:ca va|all good|tout va bien|tudo bem|alles gut)[?؟!.\s]*$/u],
      [8, /(?:you doing ok|are you all right|you good|tu tiens le coup|est-ce que ca va|como te sientes|alles okay bei dir)/u]
    ],
    apology: [
      [8, /^(?:desolee?|je m'excuse|pardon|sorry|i apologi[sz]e|my bad|lo siento|desculpa|tut mir leid|اسف|اعتذر)(?:[.! ,]|$)/u],
      [6, /(?:j'ai eu tort|je regrette|i was wrong|i owe you an apology|fue mi error|foi erro meu|mein fehler|كان خطاي)/u],
      [8, /(?:i take it back|i shouldn't have (?:said|blamed)|i should not have (?:said|blamed)|that was on me|c'etait ma faute|je n'aurais pas du te parler comme ca|j'ai ete trop dur|je retire ce que j'ai dit|perdon|foi culpa minha)/u]
    ],
    conflict: [
      [8, /(?:^|\b)(?:tu nous as fait perdre|c'est ta faute|you cost us|you made (?:us|use) (?:lose|loose)|it's your fault|perdimos por tu culpa|perdemos por tua culpa|du bist schuld)(?:\b|$)/u],
      [8, /(?:^|\b)(?:t'es nul(?:le)?|tu es nul(?:le)?|you(?:'re| are) (?:useless|trash)|du bist nutzlos|eres inutil|voce e inutil)(?:\b|$)|انت عديم الفائدة|انت السبب/u],
      [5, /(?:stop ball ?chasing|arrete de (?:chase|ballchase)|tu ne rotates jamais|you never rotate|deja de perseguir)/u],
      [9, /\b(?:you (?:suck|played (?:like trash|awfully)|(?:threw|ruined|sold) (?:it|the game|the match|the series))|tu (?:pues|as tout gache|as sabote le match)|tu joues comme un pied|juegas fatal|jogas mal|du spielst mies)\b/u],
      [9, /\b(?:it (?:was|is) (?:all )?on you|it(?:'s| is| was) (?:all )?because of you|it(?:'s| is| was) (?:all )?your fault|tout est de ta faute|c'est (?:entierement )?a cause de toi|on a perdu a cause de toi|la derrota fue por tu culpa|war deine schuld)\b/u],
      [3, /\b(?:because of you|a cause de toi|por tu culpa|wegen dir)\b/u],
      [3, /\b(?:useless|trash|nul|faute|blame|culpa|schuld|choke|throw)\b/u]
    ],
    thanks: [
      [7, /^(?:merci|thanks|thank you|gracias|obrigad[oa]|danke|شكرا)(?:[!. ,]|$)/u],
      [6, /(?:j'apprecie|je te remercie|appreciate it|thanks for having my back|te lo agradezco|agradeco|ich schatze)/u],
      [7, /(?:you saved us|you bailed me out|we couldn't have done it without you|tu nous as sauves|merci de m'avoir couvert)/u]
    ],
    respect: [
      [7, /(?:je respecte|i respect|respect for|bien joue|well played|nice play|bien jugado|bem jogado|gut gespielt|احسنت|لعب جيد)/u],
      [7, /^(?:bravo|gg|good game|ggs)[!.\s]*$/u],
      [7, /(?:good job|great work|nice save|nice shot|you played well|tu as bien joue|bel arret|beau tir|beau boulot)/u]
    ],
    hype: [
      [7, /(?:on prend la prochaine|on se reprend ensemble|on va rebondir|we(?:'ll| will) bounce back|we got (?:this|the next one)|we've got the next|let's go|vamos a por|vamos ganhar|das nachste holen|سنفوز)/u],
      [6, /^(?:allez|vamos|lets go|come on)[!\s]+$/u],
      [7, /(?:keep your head up|you've got this|we'll get them next time|on lache rien|on aura la prochaine|garde la tete haute)/u]
    ],
    joke: [
      [8, /(?:je rigole|c'est une blague|just kidding|i'm kidding|only joking|es broma|estou a brincar|nur ein scherz|امزح)/u],
      [4, /\b(?:lol|mdr|lmao|jajaja|kkkk|haha+)\b|[😂🤣]/u]
    ],
    cocky: [
      [7, /(?:i carried|i'm carrying|i am the best|i'm built different|j'ai carry|j'ai porte l'equipe|je suis le meilleur|yo cargue|ich habe euch getragen)/u]
    ],
    gameplay: [
      [6, /\b(?:flip reset|reset|rotation|overcommit|replay|double commit|clip|boost|save|arret|aerial|passe)\b/u]
    ],
    roster: [
      [6, /\b(?:transfert|transfer|roster|recrue|recruit|signing|lineup|effectif|plantel)\b/u]
    ],
    win: [[5, /\b(?:victoire|win|won|gagne|victoria|vitoria|sieg)\b|فوز/u]],
    loss: [[5, /\b(?:defaite|perdu|loss|lose|loose|lost|defeat|derrota|niederlage)\b|خسار/u]],
    question: [[4, /[?؟]/u]]
  };

  const effectOf = { respect:'support', thanks:'support', hype:'support', conflict:'conflict', apology:'apology' };
  const chosen = { support:'respect', respect:'respect', thanks:'thanks', hype:'hype', joke:'joke', cocky:'cocky',
    apology:'apology', conflict:'conflict' };

  function interpret(text, intent = 'auto') {
    if (Object.hasOwn(chosen, intent)) {
      const topic = chosen[intent];
      return { topic, effect: effectOf[topic] || null, probability: 1 };
    }
    const raw = String(text ?? '');
    const clean = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
    const scores = Object.entries(signals).map(([topic, rules]) => ({
      topic, score: rules.reduce((value, [weight, pattern]) => value + (pattern.test(clean) ? weight : 0), 0)
    }));
    const score = key => scores.find(entry => entry.topic === key);
    // Quoted speech and explicit denial should not penalize the addressee.
    const quoted = /["“«][^"”»]+["”»]/u.test(raw);
    const negatesBlame = /\b(?:not your fault|not blaming you|wasn'?t (?:all )?on you|was not (?:all )?on you|don't blame you|no te culpo|nicht deine schuld|nao foi tua culpa|pas ta faute|pas a cause de toi|je ne te blame pas)\b/u.test(clean);
    const causal = /\b(?:because of you|a cause de toi|por ti|por tu culpa|wegen dir)\b/u.test(clean);
    if (causal && score('loss').score >= 5) score('conflict').score += 6;
    if (causal && score('win').score >= 5 && score('loss').score === 0 &&
        !/\b(?:your fault|ta faute|culpa|schuld)\b/u.test(clean)) {
      score('thanks').score += 8;
      score('conflict').score = 0;
    }
    if (quoted || negatesBlame) score('conflict').score = 0;
    const caveat = /\b(?:mais|but|pero|aber|mas)\b/u.test(clean);
    const conflictingTones = score('conflict').score >= 5 && ['apology','thanks','respect','hype','joke']
      .some(topic => score(topic).score >= 5);

    scores.push({topic:'plain', score:4});
    scores.sort((a, b) => b.score - a.score);
    const [top] = scores;

    // A defeat describes the subject; it does not contradict a clear accusation about that defeat.
    const stances = scores.filter(entry => Object.hasOwn(effectOf, entry.topic) || entry.topic === 'plain' ||
      entry.topic === 'joke' || entry.topic === 'cocky');
    const [stance, runner] = stances;
    const probability = 1 / stances.reduce((sum, entry) => sum + Math.exp((entry.score - stance.score) / 1.65), 0);
    const clearStance = stance.score >= 6 && stance.score - runner.score >= 2 && probability >= 0.53;
    const effect = clearStance && !conflictingTones && !quoted && !caveat ? effectOf[stance.topic] || null : null;
    const topic = conflictingTones ? 'mixed' : effect ? stance.topic : top.topic;
    return { topic, effect, probability };
  }

  function entryFor(state, peer) {
    state.social.yRelationships ||= {};
    return state.social.yRelationships[peer.id] ||= { trust: 50, day: null, used: 0, kinds: [] };
  }

  function apply(state, peer, text, intent = 'auto', interpretation = interpret(text, intent)) {
    const kind = interpretation.effect;
    const date = state.currentDate;
    if (!kind || typeof date !== 'string') return { effect: null };
    const before = current(state, peer);
    if (kind === 'apology' && before.trust >= 50) return { effect: null, reason: 'no-tension' };
    const entry = entryFor(state, peer);
    if (entry.day !== date) {
      entry.day = date;
      entry.used = 0;
      entry.kinds = [];
    }
    if (entry.kinds.includes(kind)) return { effect: null, reason: 'repeated' };
    const base = kind === 'conflict' ? -12 : kind === 'apology' ? 8 : 4;
    const delta = Math.sign(base) * Math.min(Math.abs(base), Math.max(0, 16 - entry.used));
    if (!delta) return { effect: null, reason: 'daily-limit' };
    const after = clamp(before.trust + delta, 0, 100);
    const trustDelta = after - before.trust;
    if (!trustDelta) return { effect: null, reason: 'scale-limit' };
    entry.trust = after;
    entry.used += Math.abs(trustDelta);
    entry.kinds.push(kind);
    let moraleDelta = 0;
    if (before.teammate && typeof engine.adjustMorale === 'function') {
      const impact = kind === 'conflict' ? -7 : kind === 'apology' ? 3 : 2;
      engine.adjustMorale(peer, impact * Math.abs(trustDelta / base), false);
      moraleDelta = round(current(state, peer).morale - before.morale);
    }
    return { effect: { kind, trustDelta, moraleDelta } };
  }

  function recoverAfterSeries(state, fixture, side, won) {
    if (!won || fixture.spectating || !state.social?.yRelationships || typeof state.currentDate !== 'string') return;
    const field = side === fixture.homeId ? 'homeLines' : 'awayLines';
    const squad = new Set();
    for (const game of fixture.games || []) {
      if (!game.measured || game.left) continue;
      const ids = (game[field] || []).map(player => player.id);
      if (ids.includes(state.userPlayerId)) for (const id of ids) squad.add(id);
    }
    for (const peer of state.players || []) {
      if (!squad.has(peer.id) || !teammateOf(state, peer)) continue;
      const entry = state.social.yRelationships[peer.id];
      if (!Number.isFinite(entry?.trust) || entry.trust >= 50 || entry.lastRecovery === state.currentDate) continue;
      entry.trust = Math.min(50, entry.trust + 1);
      entry.lastRecovery = state.currentDate;
    }
  }

  function squadSummary(state) {
    const team = state.teams?.find(team => team.id === state.userTeamId);
    if (!team || !Array.isArray(state.players)) return { active: false, peers: [] };
    const core = [...new Set([...(team.lineup || []), ...(team.playerIds || [])])]
      .map(id => state.players.find(player => player.id === id && player.teamId === team.id))
      .filter(Boolean).slice(0, 3);
    if (!core.some(player => player.id === state.userPlayerId)) return { active: false, peers: [] };
    const peers = core.filter(player => teammateOf(state, player)).map(player => ({
      id: player.id, name: player.name, trust: current(state, player).trust
    }));
    const score = peers.length ? Math.round(peers.reduce((sum, peer) => sum + peer.trust, 0) / peers.length) : null;
    const penalty = Math.min(30, Math.round(peers.reduce((sum, peer) => sum + Math.max(0, 40 - peer.trust) * 0.45, 0)));
    const chemistry = filstaChemistry(state, team);
    return { active: true, peers, score, penalty, chemistry };
  }

  function filstaChemistry(state, team) {
    const club = engine.uxClub;
    if (!team || team.id !== state.userTeamId || typeof club?.chemOf !== 'function' ||
        !state.uxClub?.chem?.[team.id]) return null;
    const core = (team.playerIds || []).map(id => state.players.find(player => player.id === id))
      .filter(Boolean).sort((a, b) => b.rating - a.rating || a.id - b.id).slice(0, 3);
    if (!core.some(player => player.id === state.userPlayerId)) return null;
    const penalty = round(Math.min(3, core.reduce((sum, player) =>
      sum + (teammateOf(state, player) ? Math.max(0, 40 - current(state, player).trust) * 0.045 : 0), 0)));
    const base = club.chemOf(state, team)?.mod;
    return Number.isFinite(base) ? { penalty, value: round(base - penalty), ids: core.map(player => player.id) } : null;
  }

  const club = engine.uxClub;
  if (typeof club?.applyChem === 'function' && !club.applyChem.rlcYTrust) {
    const applyChem = club.applyChem;
    club.applyChem = function (state, ...args) {
      const team = state.teams?.find(team => team.id === state.userTeamId);
      const chemistry = filstaChemistry(state, team);
      const revert = applyChem.call(this, state, ...args);
      if (!chemistry?.penalty) return revert;
      const applied = [];
      for (const id of chemistry.ids) {
        const player = state.players.find(player => player.id === id);
        if (!Number.isFinite(player?.rating)) continue;
        player.rating -= chemistry.penalty;
        if (Number.isFinite(player.ratingExact)) player.ratingExact -= chemistry.penalty;
        applied.push({ player, rating: player.rating });
      }
      return () => {
        const restore = value => Math.round((value + chemistry.penalty) * 1e6) / 1e6;
        for (const { player, rating } of applied) {
          if (Number.isFinite(player.ratingExact)) player.ratingExact = restore(player.ratingExact);
          player.rating = player.rating === rating || !Number.isFinite(player.ratingExact)
            ? restore(player.rating) : Math.floor(player.ratingExact + 1e-9);
        }
        if (typeof revert === 'function') revert();
      };
    };
    club.applyChem.rlcYTrust = true;
  }

  return { current, apply, interpret, recoverAfterSeries, squadSummary };
}

module.exports = { createDmRelationships };
