'use strict';

function installInventoryEngine(engine, locker, titles, rcon, fs, path, loadThumbnails, titleCatalog) {
  if (!engine?.setDayNote || !engine.matchTitleLines || !engine.sideLineup || !engine.teamById ||
      !locker?.encode || !titles?.choices || !rcon?.send) return 'waiting-engine';
  if (engine.setDayNote.rlcInventory) return 'already-installed';

  const prices = { decal: 350, wheels: 450, boost: 500, antenna: 100, topper: 180,
    finish: 140, accent: 140, engine: 180, trail: 250, goal: 750, anthem: 200 };
  const price = (slot, id) => slot === 'boost' && id === 32 ? 2400 : prices[slot];
  const record = state => state.rlcInventory ||= {
    owned: {}, active: 0,
    presets: Array.from({ length: 3 }, (_, i) => ({ name: 'Preset ' + (i + 1), items: {}, colors: {}, title: null }))
  };
  const tournamentTitle = value => typeof value === 'string' && /^(?:id:)?AutoTour_/i.test(value);
  function clearTournamentTitles(inventory) {
    for (const preset of inventory?.presets || []) {
      if (tournamentTitle(preset.title)) preset.title = null;
    }
  }
  const nativeChoices = titles.choices;
  titles.choices = function careerTitleChoices(player) {
    const standard = nativeChoices.apply(this, arguments) || [];
    const wins = new Set(standard.filter(title=>title.kind==='worlds_champion' && title.year).map(title=>title.year));
    const awards = [2,3].filter(count=>wins.size>=count).map(count=>({
      key:'rlc:worlds:'+count,
      id:'RLCS_2026_World_Champion',
      display:count===2?'Two-Time RLCS World Champion':'Three-Time RLCS World Champion',
      french:count===2?'Double champion du monde RLCS':'Triple champion du monde RLCS'
    }));
    return [...awards,...standard];
  };
  const starters = titleCatalog.starters.map(title => ({ ...title, key: 'id:' + title.id }));
  const earned = state => (titles.choices(engine.playerById(state, state.userPlayerId)) || []).filter(title => !tournamentTitle(title.id));
  const choices = state => [...new Map([
    ...starters, ...earned(state).map(title => ({ ...title, group: 'earned' }))
  ].map(title => [title.key, title])).values()];
  const clubOf = state => engine.isPlayerCareer?.(state) ? null : engine.teamById(state, state.userTeamId);
  const fail = (en, fr) => ({ ok: false, error: en, inventoryFrench: fr });
  const isColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const originalNote = engine.setDayNote;
  let body = 0;
  engine.setDayNote = function inventoryNote(state, day, text) {
    if (day !== 'rlc-inventory/v1') return originalNote.apply(this, arguments);
    if (typeof text !== 'string' || text.length > 500) return fail('Invalid request.', 'Action non valide.');
    let action;
    try { action = JSON.parse(text); } catch { return fail('Invalid request.', 'Action non valide.'); }
    if (!action || typeof action !== 'object' || !engine.playerById(state, state.userPlayerId)) {
      return fail('No career player.', 'Aucun joueur de carrière.');
    }
    if (action.type === 'thumbnails') {
      if (typeof loadThumbnails === 'function' && Array.isArray(action.ids)) {
        const ids = [...new Set(action.ids.slice(0, 12))].filter(id =>
          Number.isSafeInteger(id) && id > 0 && locker.SLOTS.some(slot => locker.itemIn(slot.list, id)));
        void loadThumbnails(ids);
      }
      return { ok: false, inventoryThumbnailsRequested: true };
    }
    if (action.type !== 'open' && state.pendingMatch != null) {
      return fail('Finish the current match first.', 'Termine le match en cours.');
    }
    const inventory = record(state);
    clearTournamentTitles(inventory);
    const preset = inventory.presets[inventory.active];
    const slot = Object.hasOwn(prices, action.slot) ? locker.SLOT_BY_KEY[action.slot] : null;
    const item = slot && Number.isSafeInteger(action.id) ? locker.itemIn(slot.list, action.id) : null;
    switch (action.type) {
      case 'open':
        inventory.titles = choices(state).map(({ key, id, display, french, group }) => {
          const [color, glow] = titleCatalog.styles[id] || [];
          return { key, display, french, group, color, glow };
        });
        inventory.body = body;
        inventory.prices = { ...prices, 'boost:32': price('boost', 32) };
        break;
      case 'buy': {
        if (!item) return fail('Item unavailable.', 'Objet indisponible.');
        const key = slot.key + ':' + item[0];
        if (inventory.owned[key]) break;
        const cost = price(slot.key, item[0]);
        const club = clubOf(state);
        if (!club) return fail('Club purchases are only available in manager careers.', 'Les achats du club sont réservés aux carrières manager.');
        if (!Number.isFinite(club.budget) || club.budget < cost) return fail('Insufficient club budget.', 'Budget du club insuffisant.');
        club.budget -= cost;
        if (!Array.isArray(state.ledger)) state.ledger = [];
        state.ledger.push({ date: state.currentDate, kind: 'cosmetic', amount: -cost, note: item[1] });
        if (state.ledger.length > 600) state.ledger.splice(0, state.ledger.length - 600);
        inventory.owned[key] = true;
        break;
      }
      case 'equip':
        if (!item || !inventory.owned[slot.key + ':' + item[0]]) return fail('Item not owned.', 'Objet non possédé.');
        if (preset.items[slot.key]?.id !== item[0]) preset.items[slot.key] = { id: item[0], paint: 0 };
        break;
      case 'paint': {
        const equipped = slot && preset.items[slot.key];
        if (!slot?.paint || !equipped || equipped.id !== action.id ||
            !Number.isInteger(action.paint) || action.paint < 0 || action.paint >= locker.PAINTS.length) {
          return fail('This paint cannot be applied.', 'Cette peinture ne peut pas être appliquée.');
        }
        equipped.paint = action.paint;
        break;
      }
      case 'clear':
        if (!slot) return fail('Unknown slot.', 'Emplacement inconnu.');
        delete preset.items[slot.key];
        break;
      case 'preset':
        if (!Number.isInteger(action.index) || !inventory.presets[action.index]) return fail('Unknown preset.', 'Preset inconnu.');
        inventory.active = action.index;
        break;
      case 'rename':
        if (typeof action.name !== 'string' || !action.name.trim()) return fail('Enter a preset name.', 'Saisis un nom.');
        preset.name = action.name.trim().slice(0, 32);
        break;
      case 'colors':
        if (!['blue', 'orange'].includes(action.side) || !isColor(action.primary) || !isColor(action.secondary)) {
          return fail('Invalid colors.', 'Couleurs non valides.');
        }
        preset.colors[action.side] = { primary: action.primary, secondary: action.secondary };
        break;
      case 'custom-colors':
        if (typeof action.enabled !== 'boolean') return fail('Invalid setting.', 'Réglage non valide.');
        preset.customColors = action.enabled;
        break;
      case 'reset-colors':
        if (!['blue', 'orange'].includes(action.side)) return fail('Unknown team color.', 'Équipe inconnue.');
        delete preset.colors[action.side];
        break;
      case 'title':
        if (action.key !== null && !choices(state).some(title => title.key === action.key)) {
          return fail('Title not unlocked.', 'Titre non débloqué.');
        }
        preset.title = action.key;
        break;
      default: return fail('Unknown action.', 'Action inconnue.');
    }
    return { ok: true };
  };
  engine.setDayNote.rlcInventory = true;

  let lineup;
  let ticket;
  let prepared;
  const originalLineup = engine.sideLineup;
  engine.sideLineup = function inventoryLineup(state, fixture, ...args) {
    const ids = originalLineup.call(this, state, fixture, ...args);
    if (fixture && !fixture.played && Array.isArray(ids)) lineup = { state, fixture, playing: ids.includes(state.userPlayerId) };
    return ids;
  };

  const originalTitles = engine.matchTitleLines;
  engine.matchTitleLines = function inventoryTitleLines(state, ids, ...args) {
    const fixture = state.pendingMatch != null ? engine.fixtureById(state, state.pendingMatch) :
      lineup && lineup.state.rlcInventory === state.rlcInventory && lineup.state.userPlayerId === state.userPlayerId ? lineup.fixture : null;
    const mayPlay = lineup?.fixture === fixture ? lineup.playing : fixture && !fixture.spectating;
    clearTournamentTitles(state.rlcInventory);
    const preset = state.rlcInventory?.presets?.[state.rlcInventory.active];
    ticket = state.locker === null && fixture && !fixture.played && !fixture.spectating && mayPlay && preset
      ? { fixture: fixture.id, preset } : null;
    prepared = null;
    const starter = ticket && starters.find(title => title.key === preset.title);
    const title = ticket && earned(state).find(title => title.key === preset.title);
    const lines = originalTitles.call(this, title ? { ...state, locker: { title: title.key } } : state, ids, ...args);
    if (title?.key.startsWith('rlc:worlds:')) {
      return [...lines.filter(line => !line.startsWith('@you\t')), '@you\t' + title.id + '\t' + title.display];
    }
    if (!starter || title) return lines;
    return [...lines.filter(line => !line.startsWith('@you\t')), '@you\t' + starter.id + '\t'];
  };

  const read = file => {
    try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
  };
  const rgb = hex => [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16));
  function costume(file, preset) {
    const directory = path.dirname(file);
    body = locker.bodyOf(Number.parseInt(read(path.join(directory, 'my_body.txt')), 10));
    const remembered = read(path.join(directory, 'locker_restore.txt')).trim();
    const config = remembered ? '' : read(path.resolve(directory, '../../cfg/config.cfg'));
    const enabled = remembered ? remembered.split('\t')[0] === '1' : /^\s*cl_itemmod_enabled\s+"1"/m.test(config);
    const code = remembered ? remembered.split('\t')[1] : config.match(/^\s*cl_itemmod_code\s+"([^"]*)"/m)?.[1];
    const base = enabled && code ? locker.decode(code) : null;
    const selection = locker.normalize({ on: true, presets: [preset], active: 0 });
    const itemsCode = locker.codeFor(selection, base, null, body);
    const colors = Object.entries(preset.customColors === false ? {} : preset.colors || {}).filter(([side, value]) =>
      ['blue', 'orange'].includes(side) && isColor(value?.primary) && isColor(value?.secondary));
    if (!colors.length) return itemsCode;
    const decoded = itemsCode ? locker.decode(itemsCode) : base;
    const deck = Object.fromEntries(['blue', 'orange'].map(side => [
      side, { items: {}, wheelTeam: 0, ...decoded?.[side] }
    ]));
    for (const [side, value] of colors) {
      deck[side].colors = { primary: rgb(value.primary), secondary: rgb(value.secondary) };
    }
    return locker.encode(deck);
  }

  const write = fs.writeFileSync;
  fs.writeFileSync = function inventoryWrite(file, contents, ...args) {
    if (ticket && typeof file === 'string' && typeof contents === 'string' &&
        /[\\/]data[\\/]rlcareermode[\\/]locker\.txt$/i.test(file)) {
      const current = ticket;
      ticket = null;
      try {
        const code = costume(file, current.preset);
        if (code || Object.keys(current.preset.items || {}).length) {
          const result = write.call(this, file, code + '\n', ...args);
          prepared = { ...current, file };
          return result;
        }
      } catch { /* Leave the Hub's native appearance in place. */ }
    }
    return write.call(this, file, contents, ...args);
  };

  const send = rcon.send;
  rcon.send = function inventoryRcon(commands, ...args) {
    const arm = prepared && Array.isArray(commands) && commands.indexOf('rlcareer_arm ' + prepared.fixture);
    if (Number.isInteger(arm) && arm >= 0 && !commands.includes('rlcareer_locker')) {
      try {
        const code = costume(prepared.file, prepared.preset);
        write.call(fs, prepared.file, code + '\n', 'utf8');
        if (code) {
          commands = [...commands.slice(0, arm), 'rlcareer_locker', ...commands.slice(arm)];
        }
      } catch { /* Match launch remains available with the native appearance. */ }
    }
    return send.call(this, commands, ...args);
  };
  return 'installed';
}

module.exports = { installInventoryEngine };
