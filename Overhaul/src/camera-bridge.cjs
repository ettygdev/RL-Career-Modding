'use strict';

function installCameraBridge(engine, fs, path, profileData, pluginBase64, lookup, recordOvertime = false, rcon = {}, logoDirectory, rasterizeLogo, hudGlyphs, hudArt, formatHeader, compactHud = false, publishQuickChat, preparePostmatch, officials, allowTimeout) {
  if (!engine?.sideLineup || !engine.userSideId || !engine.lineupFor) return 'waiting-engine';
  if (engine.sideLineup.rlcCameraBridge) return 'already-installed';
  const normalize = name => String(name).normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const wireName = name => String(name).replace(/[;"\r\n\t]/g, ' ').trim();
  const profiles = new Map(profileData.profiles.map(([name, ...settings]) => [normalize(name), settings]));
  const dll = Buffer.from(pluginBase64, 'base64');
  const processNonce = process.env.RLC_INVENTORY_LAUNCH_TOKEN || String(process.pid);
  const previousPluginHashes = new Set([
    '8cd9463f4ade7bc95304af310472dd94773a40f32afbe5b93dd61743a3a279cf',
    'b781c9e3534d403a6b36910ab3846cb370c1b6b3f8eeae8e2b3bd8bfb255ca1a',
    'eaecce2e50fc157597fed6ba31702bf79e80430813ddbff3a027acf1bb1a8d64',
    '4a9f9cd544586a48f9e4b844a50f9c2eb42a95d59d8dcce461ca71086a5af9a6',
    '0b8d183b81ede5689c6d0a5507a06f7db05f2ca1285cb97c01ae71ce2ce221df',
    '4b19cde70d542fa0fa8ed2b9a034eb6c4f451c3731a5163f9d0287f8dcc37f76',
    'e182cf3403fad96ad72e2fd004b15340d8ffdaaadb00ddeb47f3e9adf71a8651',
    '93676bc1d000f973289223c7eebb4c7b0744ab2f1cb7c35ffba093e415fd2b5e',
    '465a1571e75d4c2cbc712d249e752501300ed0b65b52aa736c6f7fc63eab91a3',
    '6ff43447009785fbf8f10582d7f4b723160f134a21d031e09a8dc143a2d12927',
    '4a7ae65bc0fa8116b10882f895b1c7e43fa2d4a22e2a25936bf6dc311197f381',
    '4df753241a42dcdb9f1891939339008687beb8b828df9ad39ea0ea3115ac3231',
    '61d054bceb49b68955de7ab1350cbd602ba97d5f3717f04e74b105c7f2ff087b',
    '8a2d65cf579d478be75c9ae7a3e7afd2a6b6bdfe098aba08bd7d1a8732b41adb',
    '6a0369630a8bd0f0914ee409ede850f8edaa2b7503d80b0dd51f75b13d8286f1',
    '1bc552fdad366c62023d37a8342a8df03c07380760f1e049519a21b057ddd18e',
    '3591a81360a2da081bd9fff1b2b90416da97b12328c0f1a9bc24d30b73383772',
    '1ccf7dda36e61e992cc7d575e36917748e7e98cd90c3a2f1f0fb2602faaa5a3b',
    'b0b992c2441d1a2b9adafdfe520d60ccb554a5e3c55d8c823f38c64d3a4af5e0',
    '83172c9c864d01bd27543e19602c63fc545c9f3294103d2845cfbd64f6348446',
    'e12bb29d8f1d1767898d3cdcd0c759d047bd1f71e7ce6a171b67daa13ad28ee0',
    '49a849dda4d3d6bcdcbb8fc85574e8efa68c44e1a21f19bc3a34b85ec7b62db8',
    'dee22992d0c0ba1aa0f26722f4fd4345bb56e7a92c5891894258638297e90944',
    '045305528e6757739193f4d626c1bcb3146b9b3c965942491988b473d53a8390',
    'b76f4b53909eba6572dd852d8991eac703471327e7e3a9e888954c514702ad67',
    'dfe72bc05e34de3e4e5014c1e3ff180c67f2a40742d58bded7cf5d53be3a449f',
    'e6cbbf1ff275ace4204d0d3d54b3f95ef6993e0ac2cdd55e5d1b5099df04e560',
    '1f0efc9d099a46abd85f0eb2fd26cd77daf0d56fd35745d25a235645a21e7d57',
    'ed77b2be59036af0e01b449e771ba540ce3b04b879f95a9dc4abe41feae5d5b4',
    '9fd1e775ab0fcc38553bf4d426d2f8799da2f9532338f971253a5983c8b29958',
    '1765b6166a8e5791837461b9403f3f2501825ac7eb0a4ad053c8562ab46f5192',
    '942cf08ef6dd4ce27a8709502d39fab89f6ed44e662207d7453c5e222bcea9ef'
  ]);
  let current;
  let matchDirectory;
  let last;
  let warned = false;
  function atomicWrite(file, data) {
    const temporary = file + '.' + processNonce + '.tmp';
    fs.writeFileSync(temporary, data);
    try { fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  function installHudFont(dataDirectory) {
    if (!hudGlyphs?.length) return;
    const folder = path.join(dataDirectory, 'inventory-font-bahnschrift-v1');
    const metrics = path.join(folder, 'metrics.txt');
    if (fs.existsSync(metrics)) return;
    fs.mkdirSync(folder, { recursive: true });
    for (const [code, , png] of hudGlyphs) {
      if (png) atomicWrite(path.join(folder, code + '.png'), Buffer.from(png, 'base64'));
    }
    atomicWrite(metrics, hudGlyphs.map(([code, width]) => code + ' ' + width).join('\n') + '\n');
  }

  function installPlugin(dataDirectory) {
    installHudFont(dataDirectory);
    if (hudArt) {
      const folder = path.join(dataDirectory, 'inventory-hud-art-v1');
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      for (const [name, png] of Object.entries(hudArt)) {
        const file = path.join(folder, name + '.png');
        if (!fs.existsSync(file)) atomicWrite(file, Buffer.from(png, 'base64'));
      }
    }
    const root = path.resolve(dataDirectory, '..', '..');
    const plugin = path.join(root, 'plugins', 'rlcareercameras.dll');
    const config = path.join(root, 'cfg', 'plugins.cfg');
    const contents = fs.readFileSync(config);
    if (contents.length > 131072) throw new Error('Unexpected size of plugins.cfg.');
    if (!fs.existsSync(plugin)) atomicWrite(plugin, dll);
    else {
      const existing = fs.readFileSync(plugin);
      if (!existing.equals(dll)) {
        const hash = process.getBuiltinModule('crypto').createHash('sha256').update(existing).digest('hex');
        if (!previousPluginHashes.has(hash)) throw new Error('A different version of rlcareercameras.dll is installed.');
        try {
          atomicWrite(plugin, dll);
        } catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
          warn(new Error('Restart Rocket League to load the updated camera plugin.'));
        }
      }
    }
    if (!/^\s*plugin\s+load\s+rlcareercameras\s*$/im.test(contents.toString('utf8'))) {
      const eol = contents.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
      fs.appendFileSync(config, eol + 'plugin load rlcareercameras' + eol);
    }
  }

  function rosterFor(state, fixture, own) {
    const ourSide = engine.userSideId(state, fixture);
    if (ourSide == null) return [];
    const away = engine.teamById(state, fixture.homeId === ourSide ? fixture.awayId : fixture.homeId);
    if (!away) return [];
    const ids = [...own, ...engine.lineupFor(state, away, fixture)].filter(id => fixture.spectating || id !== state.userPlayerId);
    const size = fixture.spectating ? 6 : 5;
    const roster = ids.map(id => {
      const player = engine.playerById(state, id);
      return { name: wireName(player?.name || ''), isPublic: player?.real === true && !player.custom && !player.isUser,
        mechanics: player?.rlcAttributes?.values?.[2] ?? player?.rating ?? 70,
        gameSense: player?.rlcAttributes?.values?.[5] ?? player?.rating ?? 70,
        ballControl: player?.rlcAttributes?.values?.[6] ?? player?.rating ?? 70 };
    });
    return ids.includes(state.userPlayerId) || roster.some(({ name }) => !name || name.length > 90) ||
      roster.length !== size || new Set(roster.map(({ name }) => name.toLowerCase())).size !== size ? [] : roster;
  }

  function publish(entry) {
    const rows = entry.roster.map(({ name }) => {
      const settings = profiles.get(normalize(name));
      return settings ? name + '\t' + settings.join('\t') : name;
    });
    const token = entry.revision ? entry.token + '.' + entry.revision : entry.token;
    atomicWrite(entry.target, token + ' ' + entry.expires + ' ' + rows.length + ' ' + entry.series.join(' ') + '\n' + rows.join('\n') + '\n' + entry.presentation.join('\n') + '\n' + entry.header + '\n' + Number(recordOvertime) + '\n');
  }

  function warn(error) {
    if (!warned) {
      warned = true;
      console.warn('[RL Career Cameras] ' + error.message);
    }
  }

  const originalLineup = engine.sideLineup;
  const lineup = function cameraLineup(state, fixture, ...args) {
    const ids = originalLineup.call(this, state, fixture, ...args);
    if (fixture && Array.isArray(ids)) current = { state, fixture, ids };
    return ids;
  };
  lineup.rlcCameraBridge = true;
  engine.sideLineup = lineup;

  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function cameraMatchWrite(file, data, ...args) {
    if (allowTimeout && current && typeof file==='string' && /[\\/]rlcareermode[\\/]talk[\\/]timeout-ok\.json$/i.test(file)) {
      try {
        const request=JSON.parse(data.toString());
        const fixture=engine.fixtureById?.(current.state,request.matchId) || current.fixture;
        if (String(fixture?.id)===String(request.matchId)) {
          const allow=allowTimeout(current.state,fixture);
          if (typeof allow==='boolean') data=JSON.stringify({...request,allow});
        }
      } catch { /* Retain the Hub button if the match cannot be identified. */ }
    }
    const output = originalWrite.call(this, file, data, ...args);
    if (typeof file !== 'string' || !/[\\/]data[\\/]rlcareermode[\\/]locker\.txt$/i.test(file)) return output;
    const dir = path.dirname(file);
    matchDirectory = dir;
    publishQuickChat?.(dir);
    const target = path.join(dir, 'inventory-cameras.tsv');
    try {
      if (recordOvertime) { try { installPlugin(dir); } catch (error) { warn(error); } }
      if (!current?.fixture || current.fixture.played || (!current.fixture.spectating && !compactHud)) {
        if (fs.existsSync(target)) atomicWrite(target, '');
        last = null;
        return output;
      }
      const { state, fixture, ids } = current;
      const token = processNonce + '-' + fixture.id + '-' + (fixture.games?.length || 0);
      const roster = rosterFor(state, fixture, ids);
      const missing = fixture.spectating && typeof lookup === 'function' ? roster.filter(({ name, isPublic }) =>
        isPublic && !profiles.has(normalize(name))).map(({ name }) => name) : [];
      if (!roster.length) {
        if (fs.existsSync(target)) atomicWrite(target, '');
        last = null;
        return output;
      }
      if (last?.token === token && last.target === target && Date.now() < last.expires - 60000) return output;
      if (!recordOvertime) { try { installPlugin(dir); } catch (error) { warn(error); } }
      const { homeWins = 0, awayWins = 0, bestOf = 0 } = fixture;
      const clubIsHome = engine.userSideId(state, fixture) === fixture.homeId;
      const series = [fixture.games?.length + 1 || 1, bestOf, ...(clubIsHome ? [homeWins, awayWins] : [awayWins, homeWins])]
        .map(value => Number.isSafeInteger(value) && value >= 0 && value <= 9 ? value : 0);
      function cacheCrest(sprite) {
        if (sprite.length <= 8 || sprite.length > 2 * 1024 * 1024 ||
            sprite.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return '';
        const hash = process.getBuiltinModule('crypto').createHash('sha256').update(sprite).digest('hex').slice(0, 16);
        const name = 'inventory-crest-' + hash + '.png';
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) atomicWrite(file, sprite);
        return name;
      }
      const deferredCrests = [];
      const presentation = (clubIsHome ? [fixture.homeId, fixture.awayId] : [fixture.awayId, fixture.homeId])
        .map((id, index) => {
          const team = engine.teamById(state, id);
          const name = typeof team?.name === 'string' ? wireName(team.name).slice(0, 64) : '';
          let asset = '';
          if (logoDirectory && typeof team?.logo === 'string' &&
              /^[^/\\:?#]+\.png$/i.test(team.logo)) {
            try {
              asset = cacheCrest(fs.readFileSync(path.join(logoDirectory, team.logo)));
            } catch { /* Keep the team name when an asset is unavailable. */ }
          }
          if (!asset && rasterizeLogo && typeof team?.logo === 'string' &&
              (/^[^/\\:?#]+\.svg$/i.test(team.logo) || /^custom:[a-f0-9]{20}$/.test(team.logo))) {
            deferredCrests.push({ index, name, logo: team.logo });
          }
          return name + '\t' + asset;
        });
      const event = state.events?.find(entry => entry.id === fixture.eventId);
      const regionId = event?.regionId ?? state.userRegion;
      const region = state.regions?.find(entry => entry.id === regionId)?.short;
      let header = '';
      try {
        let parts = formatHeader?.(event, fixture, region);
        if (Array.isArray(parts)) {
          if (fixture.stage === 'final' && parts.includes('GRAND FINAL') && !parts.includes('PLAYOFFS')) {
            parts = parts.flatMap(part => part === 'GRAND FINAL' ? ['PLAYOFFS', part] : [part]);
          }
          header = wireName(parts.filter(Boolean).join(' | ')).slice(0, 120);
        }
      } catch { /* Match metadata is optional. */ }
      const entry = { token, target, expires: Date.now() + 30 * 60 * 1000, revision: 0, roster, series, presentation, header };
      publish(entry);
      last = entry;
      try {
        atomicWrite(path.join(dir, 'rlc-bot-styles.json'), JSON.stringify({
          token, expires: entry.expires,
          players: roster.map(({name,isPublic,mechanics,gameSense,ballControl})=>({name,isPublic,mechanics,gameSense,ballControl}))
        }));
      } catch (error) { warn(error); }
      officials?.(state,fixture,dir,entry);
      if (recordOvertime && preparePostmatch) {
        const history = (fixture.games || []).map(game => (game.homeGoals > game.awayGoals) === clubIsHome ? 0 : 1);
        preparePostmatch(dir, { ...entry, history });
      }
      for (const { index, name, logo } of deferredCrests) {
        void Promise.resolve(rasterizeLogo(logo)).then(encoded => {
          if (last !== entry || !encoded || encoded.length > 300000) return;
          const cached = cacheCrest(Buffer.from(encoded, 'base64'));
          if (!cached) return;
          entry.presentation[index] = name + '\t' + cached;
          publish(entry);
        }).catch(warn);
      }
      if (missing.length) {
        void lookup(missing).then(found => {
          if (last !== entry || !fixture.spectating || fixture.played || Date.now() >= entry.expires ||
              state.pendingMatch != null && state.pendingMatch !== fixture.id || !found.size) return;
          for (const [name, settings] of found) profiles.set(normalize(name), settings);
          entry.revision++;
          publish(entry);
        }).catch(warn);
      }
    } catch (error) {
      warn(error);
    }
    return output;
  };
  if (recordOvertime) {
    const send = rcon.send;
    rcon.send = function overtimeRequest(commands, ...args) {
      const arm = commands?.find?.(command => typeof command === 'string' &&
        /^rlcareer_arm \d+(?: spectate)?$/.test(command));
      const fixture = current?.fixture;
      if (arm && matchDirectory && fixture && String(fixture.id) === arm.split(' ')[1]) {
        try {
          const token = processNonce + '-' + fixture.id + '-' + ((fixture.games?.length ?? 0) + 1);
          const file = path.join(matchDirectory, 'inventory-overtime-request.txt');
          if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').startsWith(token + ' ')) {
            atomicWrite(file, token + ' ' + (Date.now() + 2 * 60 * 60 * 1000) + '\n');
          }
        } catch (error) { warn(error); }
      }
      return send.call(this, commands, ...args);
    };
  }
  return 'installed';
}

module.exports = { installCameraBridge };
