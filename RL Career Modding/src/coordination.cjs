'use strict';

function installCoordination(engine, getLanguage) {
  if (typeof engine?.sideLineup !== 'function') return 'waiting-engine';
  if (engine.sideLineup.rlcYCoordination) return 'already-installed';
  const fs = process.getBuiltinModule('fs');
  const os = process.getBuiltinModule('os');
  const path = process.getBuiltinModule('path');
  const file = path.join(os.tmpdir(), 'rlcareer-y-coordination.json');
  const staged = file + '.' + process.pid + '.tmp';
  const nonce = process.env.RLC_Y_LAUNCH_TOKEN;
  const mode = process.env.RLC_Y_COORDINATION === '0' ? 'neutral' : 'active';
  const log = path.join(os.tmpdir(), 'rlcareer-y-coordination.log');
  const original = engine.sideLineup;
  let published;

  function fatigueAt(player, date) {
    const recorded = player?.yMatchLoad;
    if (!Number.isFinite(recorded?.value)) return 0;
    const days = Math.max(0, (Date.parse(date) - Date.parse(recorded.date)) / 86400000);
    return Number.isFinite(days) ? Math.max(0, recorded.value - 4 * days) : 0;
  }

  function publish(data) {
    const key = JSON.stringify(data);
    if (published === key) return;
    const now = Date.now();
    try {
      fs.writeFileSync(staged, JSON.stringify({ ...data, nonce, expires: now + 15 * 60 * 1000 }), 'utf8');
      fs.renameSync(staged, file);
      published = key;
    } catch {
      try { fs.unlinkSync(staged); } catch { /* no staged file */ }
    }
  }

  function sideLineup(state, fixture, ...args) {
    const lineup = original.call(this, state, fixture, ...args);
    if (typeof nonce !== 'string' || !fixture || state.pendingMatch !== fixture.id ||
        fixture.played || fixture.spectating || !Array.isArray(lineup) || !lineup.includes(state.userPlayerId)) return lineup;

    const teammates = lineup.filter(id => id !== state.userPlayerId).map(id => {
      const player = engine.playerById?.(state, id);
      if (!player || player.teamId !== state.userTeamId || !player.name) return null;
      return { name: player.name.replace(/[;"]/g, ' ').trim(), trust: state.social?.yRelationships?.[id]?.trust ?? 50 };
    }).filter(Boolean);
    if (teammates.length !== lineup.length - 1) return lineup;
    const performance = teammates.map((peer, index) => {
      const id = lineup.filter(id => id !== state.userPlayerId)[index];
      const player = engine.playerById?.(state, id);
      const temperament = ((id * 37) % 13) / 12;
      const games = player?.yMatchLoad?.teamId === player?.teamId ? player?.yMatchLoad?.games || 0 : 0;
      return { name: peer.name, fatigue: fatigueAt(player, state.currentDate), temperament, familiarity: Math.min(1, games / 15) };
    });
    const synergy = Math.min(30, Math.round(teammates.reduce((sum, peer) => sum + Math.max(0, 40 - peer.trust) * 0.45, 0)));
    const game = (fixture.games?.length || 0) + 1;
    const bestOf = fixture.bestOf || 0;
    const decider = bestOf > 1 && game === bestOf;
    const stage = String(fixture.stage || '').toLowerCase();
    const stakes = /final|playoff|elimination|knockout/.test(stage) ? 0.65 : fixture.eventId != null ? 0.35 : 0.15;
    publish({ active: true, mode, fixture: fixture.id, game, teammates, performance, synergy,
      pressure: Math.min(1, stakes + (decider ? 0.45 : 0)) });
    return lineup;
  }

  function reportFor(fixtureId, games, stateForReport) {
    const summary = { mode, coverage: 0, matched: false, opportunities: 0, overrides: 0 };
    const highlights = new Map();
    const form = { pressure: 0, fatigue: 0, cohesion: 0 };
    const maxBytes = 256 * 1024;
    let handle;
    try {
      handle = fs.openSync(log, 'r');
      const size = fs.fstatSync(handle).size;
      const start = Math.max(0, size - maxBytes);
      const buffer = Buffer.alloc(size - start);
      const count = fs.readSync(handle, buffer, 0, buffer.length, start);
      for (const line of buffer.toString('utf8', 0, count).split('\n')) {
        if (!line.startsWith('{')) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.nonce !== nonce || event.fixture !== fixtureId) continue;
        if (event.event === 'coverage') {
          summary.coverage++;
          if (event.status === 'matched') summary.matched = true;
        } else if (event.event === 'opportunity') {
          summary.opportunities++;
          if (event.override === true) summary.overrides++;
        } else if (event.event === 'form' && games[event.game - 1]?.measured &&
            Number.isFinite(event.pressure) && Number.isFinite(event.fatigue) && Number.isFinite(event.synergy)) {
          form.pressure = Math.max(form.pressure, event.pressure);
          form.fatigue = Math.max(form.fatigue, event.fatigue);
          form.cohesion = Math.max(form.cohesion, event.synergy);
        } else if (['match-observed', 'convergence'].includes(event.event) &&
            games[event.game - 1]?.measured && !games[event.game - 1].left) {
          summary.convergences = (summary.convergences || 0) + (event.event === 'convergence' ? 1 : 0);
        } else if (event.event === 'highlight' && Number.isSafeInteger(event.game) &&
            games[event.game - 1]?.measured && !games[event.game - 1].left &&
            ['goal', 'save', 'reset'].includes(event.action) && typeof event.player === 'string' &&
            Number.isSafeInteger(event.index) && Number.isSafeInteger(event.count) && Number.isFinite(event.second)) {
          const game = games[event.game - 1];
          const key = name => name.normalize('NFKC').trim().toLowerCase();
          const lines = [...(game.homeLines || []), ...(game.awayLines || [])];
          const matching = lines.filter(line => {
            const name = engine.playerById?.(stateForReport, line.id)?.name;
            return typeof name === 'string' && key(name) === key(event.player);
          });
          if (matching.length === 1 && (event.action === 'reset' || matching[0][event.action + 's'] >= event.count)) {
            highlights.set([event.game, event.index, event.action, event.count].join(':'), event);
          }
        }
      }
    } catch { /* A match may never have loaded the keeper adapter. */ }
    finally {
      if (handle !== undefined) fs.closeSync(handle);
    }
    return { summary, highlights: [...highlights.values()], form };
  }

  function highlightText(events) {
    const language = typeof getLanguage === 'function' ? getLanguage() : 'en';
    const copy = {
      en: ['Game', 'scores', 'makes a save', 'scores after a probable flip reset', 'in overtime', 'looks to pull off a flip reset'],
      fr: ['Manche', 'marque', 'réalise un arrêt', 'marque après un flip reset probable', 'en prolongation', 'semble réussir un flip reset'],
      es: ['Partida', 'marca', 'hace una parada', 'marca tras un posible flip reset', 'en la prórroga', 'parece conseguir un flip reset'],
      pt: ['Jogo', 'marca', 'faz uma defesa', 'marca após um provável flip reset', 'no prolongamento', 'parece conseguir um flip reset'],
      de: ['Spiel', 'trifft', 'pariert', 'trifft nach einem wahrscheinlichen Flip Reset', 'in der Verlängerung', 'gelingt wohl ein Flip Reset'],
      ar: ['المباراة', 'يسجل', 'يتصدى', 'يسجل بعد فليب ريسيت محتمل', 'في الوقت الإضافي', 'يبدو أنه نفذ فليب ريسيت']
    };
    const words = copy[language] || copy.en;
    const resetGoals = events.filter(event => event.action === 'goal' && event.reset);
    const independent = events.filter(event => event.action !== 'reset' || !resetGoals.some(goal =>
      goal.game === event.game && goal.index === event.index && goal.second >= event.second && goal.second - event.second <= 4));
    const priority = event => {
      if (event.action === 'goal') return event.reset ? 4 : event.overtime ? 3 : 1;
      return event.action === 'reset' ? 2 : 0;
    };
    const ordered = independent.sort((a, b) => priority(b) - priority(a) || b.game - a.game || b.second - a.second);
    const first = ordered[0];
    if (!first) return '';
    const second = ordered.find(event => event.action !== first.action || event.game !== first.game) || ordered[1];
    return [first, second].filter(Boolean).map(event => {
      const handle = engine.handleFor(event.player);
      const action = words[event.action === 'reset' ? 5 : event.action === 'save' ? 2 : event.reset ? 3 : 1];
      const overtime = event.action === 'goal' && event.overtime === true ? ' ' + words[4] : '';
      return words[0] + ' ' + event.game + ' · @' + handle + ' ' + action + overtime + '.';
    }).join(' ');
  }

  function clear(state, fixture, report, ...args) {
    const gameWasAlreadyPlayed = fixture?.played;
    const priorGames = fixture?.games?.length || 0;
    try {
      const outcome = result.call(this, state, fixture, report, ...args);
      if (!gameWasAlreadyPlayed && !fixture?.spectating && !outcome?.error && !outcome?.alreadyPlayed &&
          fixture?.games?.length === priorGames + 1 && typeof state.currentDate === 'string') {
        const game = fixture.games.at(-1);
        const side = engine.userSideId?.(state, fixture);
        const lines = side === fixture.homeId ? game.homeLines : side === fixture.awayId ? game.awayLines : [];
        if (game.measured && !game.left && lines?.some(line => line.id === state.userPlayerId)) {
          for (const id of new Set(lines.map(line => line.id))) {
            const player = engine.playerById?.(state, id);
            if (player?.teamId !== state.userTeamId || id === state.userPlayerId) continue;
            const load = player.yMatchLoad;
            player.yMatchLoad = { date: state.currentDate, teamId: player.teamId,
              games: Math.min(15, (load?.teamId === player.teamId ? load.games || 0 : 0) + 1),
              value: Math.min(18, fatigueAt(player, state.currentDate) + (game.overtime ? 3 : 2)) };
          }
        }
      }
      if (!gameWasAlreadyPlayed && !fixture?.spectating && outcome?.seriesOver && !outcome.error && !outcome.alreadyPlayed) {
        const posts = [...(state.social?.posts || []), ...(state.social?.archive || [])];
        const post = posts.find(entry => entry.yMatch?.fixtureId === fixture.id);
        if (post) {
          const games = fixture.games || [];
          const { summary, highlights, form } = reportFor(fixture.id, games, state);
          post.yMatch.coordination = summary;
          if (Object.values(form).some(value => value > 0)) post.yMatch.form = form;
          if (highlights.length && typeof engine.handleFor === 'function') post.text += ' ' + highlightText(highlights);
        }
      }
      return outcome;
    } finally {
      if (published) publish({ active: false });
    }
  }

  const result = engine.applyUserResult;
  if (typeof nonce === 'string') publish({ active: false });
  sideLineup.rlcYCoordination = true;
  engine.sideLineup = sideLineup;
  if (typeof result === 'function') {
    clear.rlcYMatchPosts = result.rlcYMatchPosts;
    engine.applyUserResult = clear;
  }
  process.once('exit', () => {
    try {
      if (JSON.parse(fs.readFileSync(file, 'utf8')).nonce === nonce) fs.unlinkSync(file);
    } catch { /* no owned file */ }
  });
  return 'installed';
}

module.exports = { installCoordination };
