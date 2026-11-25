'use strict';

function installCareerExtras(engine, launch, curtain, scorebug, steamShortcut, openSteam, launchProxy, composurePressure) {
  if (!engine?.sideLineup || !engine.talkBoostFor || !engine.applyUserResult) return 'waiting-engine';
  if (engine.talkBoostFor.rlcForm) return 'already-installed';
  const contexts = new WeakMap();
  const originalLineup = engine.sideLineup;
  const originalResult = engine.applyUserResult;
  const originalBoost = engine.talkBoostFor;
  const day = state => Math.floor(Date.parse(state.currentDate) / 86400000);
  const workload = (state, id) => {
    const entry = state.rlcMatchFatigue?.[id];
    if (!Number.isFinite(entry?.load) || !Number.isFinite(day(state))) return 0;
    return Math.max(0, entry.load - Math.max(0, day(state) - entry.day) * 3);
  };

  engine.sideLineup = function formLineup(state, fixture, ...args) {
    const result = originalLineup.call(this, state, fixture, ...args);
    if (fixture && Array.isArray(result)) contexts.set(fixture, { state, own: result });
    return result;
  };

  Object.assign(engine.sideLineup, originalLineup);

  function formBoost(fixture, id, ...args) {
    const baseline = originalBoost.call(this, fixture, id, ...args);
    const state = contexts.get(fixture)?.state;
    const player = state && engine.playerById(state, id);
    if (!player || player.isUser || state.userPlayerId === id) return baseline;
    return (Number(baseline) || 0) - Math.round(workload(state, id) * 0.7) -
      (composurePressure?.(state, fixture, player) || 0);
  }
  formBoost.rlcForm = true;
  engine.talkBoostFor = formBoost;

  engine.applyUserResult = function recordWorkload(state, fixture, report, ...args) {
    const previous = fixture?.games?.length ?? 0;
    const result = originalResult.call(this, state, fixture, report, ...args);
    if (!result?.error && fixture?.games?.length === previous + 1 && !report?.abandoned &&
        Number.isFinite(day(state))) {
      const own = contexts.get(fixture)?.own ?? [];
      const club = engine.userSideId(state, fixture);
      const opponent = engine.teamById(state, fixture.homeId === club ? fixture.awayId : fixture.homeId);
      const away = opponent && engine.lineupFor(state, opponent, fixture);
      const lines = fixture.games.at(-1).reported?.players;
      if (Array.isArray(lines)) {
        const names = new Set(lines.map(line => String(line?.name || '').toLowerCase().trim()));
        const fatigue = state.rlcMatchFatigue ||= {};
        for (const id of new Set([...own, ...(away || [])])) {
          if (id === state.userPlayerId) continue;
          const player = engine.playerById(state, id);
          if (!player || !names.has(String(player.name).toLowerCase().trim())) continue;
          fatigue[id] = { load: Math.min(18, workload(state, id) + (report.overtime ? 3 : 2)), day: day(state) };
        }
      }
    }
    return result;
  };

  Object.assign(engine.applyUserResult, originalResult);

  if (typeof launch?.launchEpicToMenu === 'function') {
    const start = launch.launchEpicToMenu;
    launch.launchEpicToMenu = async function launchEpicWithInput(options) {
      const id = await steamShortcut().catch(() => '');
      if (!/^\d{17,20}$/.test(id)) return start.call(this, options);
      return start.call(this, {
        ...options,
        spawnGame: (exe, args) => launchProxy(id, exe, args, openSteam, options.current)
      });
    };
  }

  if (typeof curtain?.render === 'function' && typeof scorebug?.capture === 'function') {
    const capture = scorebug.capture;
    scorebug.capture = function renderStyledLoading(window, html, width, height, file) {
      if (typeof html === 'string' && /[\\/]curtain[\\/].*[\\/]_render\.html$/i.test(file)) {
        const style = `<style>
          html body{font-family:Bahnschrift,"Arial Narrow",Arial,sans-serif}
          body .bg{background:radial-gradient(ellipse at 50% 43%,#263444 0,transparent 66%),repeating-linear-gradient(118deg,#101317 0 9%,#1a222c 9.2% 15%,#090b10 15.2% 27%)}
          body .headwrap,body .tile,body .box{background-color:#101722;box-shadow:0 12px 40px #0007}
          body .tile,body .box{border-color:#546372}
          body .title,body .club,body .label{font-family:Bahnschrift,"Arial Narrow",Arial,sans-serif;font-style:italic;font-weight:800}
          body .track{background:#293340;box-shadow:0 0 0 1px #5c6b78}
        </style>`;
        html = html.replace('</head>', style + '</head>');
      }
      return capture.call(this, window, html, width, height, file);
    };
  }
  return 'installed';
}

function installCareerSetup(launcherPath, modVersion) {
  if (typeof doctorHtml !== 'function' || doctorHtml.rlcSteamInput) return;
  if (typeof setStatus === 'function' && !setStatus.rlcMatchStatus) {
    const nativeStatus = setStatus;
    // The click handler sets its fallback after IPC, which can arrive after
    // a synchronous preflight error. Keep the error visible until retry.
    setStatus = Object.assign(function (phase, message, ...args) {
      if (phase === 'launching' && statusPhase === 'error' &&
          message === tl('Getting your match ready...')) return;
      return nativeStatus.call(this, phase, message, ...args);
    }, nativeStatus, { rlcMatchStatus: true });
  }
  const original = doctorHtml;
  const key = 'rlc-epic-steam-shortcut';
  const fr = () => document.documentElement.lang.toLowerCase().startsWith('fr') ||
    (typeof S !== 'undefined' && String(S?.language || S?.lang || '').toLowerCase().startsWith('fr'));
  const tr = (en, french) => fr() ? french : en;
  const parse = value => /^(?:steam:\/\/rungameid\/)?(\d{17,20})\/?$/i.exec(value.trim())?.[1] || '';
  const style = document.createElement('style');
  style.textContent = `
    #rlc-steam-setup .rlc-steam-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem}
    #rlc-steam-setup .rlc-steam-steps{padding-inline-start:1.35rem;display:grid;gap:.6rem}
    #rlc-steam-setup .rlc-steam-fields{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
    #rlc-steam-setup .rlc-steam-field{flex:1 1 19rem;min-width:0}
    #rlc-steam-setup .rlc-steam-field label{display:block;margin-bottom:.35rem;font-weight:700;color:var(--text-dim);font-size:var(--f-small)}
    #rlc-steam-setup .rlc-steam-url{display:block;box-sizing:border-box;width:100%;min-height:36px;
      padding:.48rem .7rem;border:1px solid var(--line,rgba(128,142,160,.45));border-radius:var(--r-sm);
      background:var(--navy-3,var(--navy-2));color:var(--text);font:inherit;font-size:var(--f-small)}
    #rlc-steam-setup .rlc-steam-url::placeholder{color:var(--text-dim);opacity:.8}
    #rlc-steam-setup .rlc-steam-url:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
    #rlc-steam-setup .rlc-steam-fields{align-items:flex-end}
    #rlc-steam-setup .rlc-steam-status{min-height:1.3em;margin-top:.45rem}
    #rlc-steam-setup code{overflow-wrap:anywhere}
    #rlc-steam-setup details{margin:.65rem 0}
    #rlc-steam-setup summary{cursor:pointer}
    .rlc-setup-signature{margin:1.15rem 0 .2rem;text-align:end;color:var(--text-dim);
      font-size:var(--f-small,.8rem);letter-spacing:.035em}
    .rlc-setup-signature span{margin-inline-start:.45em;font-variant-numeric:tabular-nums}
  `;
  document.head.append(style);

  function renderSetup(...args) {
    const id = parse(localStorage.getItem(key) || '');
    const configured = id
      ? tr('Shortcut stored', 'Raccourci enregistré') : tr('Off', 'Désactivé');
    const content = `<section class="doc-platform" id="rlc-steam-setup">
      <div class="rlc-steam-top"><div class="doc-platform-k">Steam Input · Epic Games</div>
        <span class="doc-platform-v" data-rlc-steam-state>${configured}</span></div>
      <p class="doc-intro">${tr('Use your Steam controller profile in career matches with the Epic edition.',
        'Utilise ton profil manette Steam en match de carrière avec la version Epic.')}</p>
      <details ${id ? '' : 'open'}><summary>${tr('Set up the Steam shortcut', 'Configurer le raccourci Steam')}</summary>
        <ol class="rlc-steam-steps">
          <li>${tr('In Steam, add RLCareer-Overhaul.exe as a non-Steam game.',
            'Dans Steam, ajoute RLCareer-Overhaul.exe comme jeu non-Steam.')}
            <button type="button" class="btn sm ghost" data-rlc-steam="path">${tr('Copy launcher path', 'Copier le chemin du lanceur')}</button></li>
          <li>${tr('In its properties, enable Steam Input and paste this into Launch Options:',
            'Dans ses propriétés, active Steam Input et colle ceci dans les options de lancement :')}
            <code>--steam-input-proxy</code>
            <button type="button" class="btn sm ghost" data-rlc-steam="options">${tr('Copy option', 'Copier l’option')}</button></li>
          <li>${tr('Create a desktop shortcut from that Steam library entry and import the .url file below.',
            'Crée le raccourci bureau depuis cette entrée Steam, puis importe le fichier .url ci-dessous.')}</li>
        </ol>
      </details>
      <form class="rlc-steam-fields" id="rlc-steam-form">
        <button type="button" class="btn sm primary" data-rlc-steam="pick">${tr('Import shortcut', 'Importer le raccourci')}</button>
        <input type="file" id="rlc-steam-file" accept=".url" hidden>
        <div class="rlc-steam-field">
        <label for="rlc-epic-steam-shortcut">${tr('Shortcut URL', 'URL du raccourci')}</label>
        <input class="rlc-steam-url" id="rlc-epic-steam-shortcut" type="text" spellcheck="false" autocomplete="off" maxlength="64"
          aria-label="${tr('Steam shortcut URL', 'URL du raccourci Steam')}" placeholder="steam://rungameid/…" value="${id ? 'steam://rungameid/' + id : ''}">
        </div>
        <button type="submit" class="btn sm ghost">${tr('Save URL', 'Enregistrer l’URL')}</button>
        <button type="button" class="btn sm ghost" data-rlc-steam="clear">${tr('Disable', 'Désactiver')}</button>
      </form>
      <div class="doc-platform-v rlc-steam-status" role="status"></div>
    </section>`;
    const template = document.createElement('template');
    template.innerHTML = original.apply(this,args);
    const page = template.content.querySelector('.doc-page');
    if (page) {
      const location = page.querySelector('[data-action="pick-rl-exe"]')?.closest('.doc-platform');
      if (location) location.insertAdjacentHTML('beforebegin',content);
      else page.insertAdjacentHTML('beforeend',content);
      const signature = document.createElement('footer');
      signature.className = 'rlc-setup-signature';
      signature.textContent = 'RLCareer Overhaul · Ettyg99';
      if (modVersion) {
        const version = document.createElement('span');
        version.textContent = ' v' + modVersion;
        signature.append(version);
      }
      page.append(signature);
    }
    return template.innerHTML;
  }
  renderSetup.rlcSteamInput = true;
  doctorHtml = renderSetup;

  function status(panel, message) {
    panel.querySelector('[role="status"]').textContent = message;
  }
  function save(panel, raw) {
    const id = parse(raw);
    if (!id) {
      status(panel, tr('Select the .url file Steam created for the mod launcher.',
        'Sélectionne le fichier .url que Steam a créé pour le lanceur du mod.'));
      return false;
    }
    localStorage.setItem(key, id);
    panel.querySelector('#rlc-epic-steam-shortcut').value = 'steam://rungameid/' + id;
    panel.querySelector('[data-rlc-steam-state]').textContent = tr('Shortcut stored', 'Raccourci enregistré');
    status(panel, tr('Saved. Start the next career match from the Hub.',
      'Enregistré. Lance ton prochain match de carrière depuis le Hub.'));
    return true;
  }

  document.addEventListener('submit', event => {
    if (event.target?.id !== 'rlc-steam-form') return;
    event.preventDefault();
    const panel = event.target.closest('#rlc-steam-setup');
    save(panel, panel.querySelector('#rlc-epic-steam-shortcut').value);
  });
  document.addEventListener('change', async event => {
    if (event.target?.id !== 'rlc-steam-file') return;
    const panel = event.target.closest('#rlc-steam-setup');
    const file = event.target.files?.[0];
    if (!file || file.size > 8192) return;
    try {
      const content = await file.text();
      const url = /^URL\s*=\s*(.+)$/im.exec(content)?.[1] || '';
      save(panel, url);
    } catch {
      status(panel, tr('Could not read the shortcut.', 'Impossible de lire le raccourci.'));
    } finally {
      event.target.value = '';
    }
  });
  document.addEventListener('click', async event => {
    const button = event.target?.closest?.('[data-rlc-steam]');
    if (!button) return;
    const panel = button.closest('#rlc-steam-setup');
    const action = button.dataset.rlcSteam;
    if (action === 'pick') { panel.querySelector('#rlc-steam-file').click(); return; }
    if (action === 'clear') {
      localStorage.removeItem(key);
      panel.querySelector('#rlc-epic-steam-shortcut').value = '';
      panel.querySelector('[data-rlc-steam-state]').textContent = tr('Off', 'Désactivé');
      status(panel, tr('The Hub will use its standard Epic launch.', 'Le Hub utilisera le lancement Epic habituel.'));
      return;
    }
    const value = action === 'path' ? launcherPath : '--steam-input-proxy';
    try {
      await navigator.clipboard.writeText(value);
      status(panel, tr('Copied.', 'Copié.'));
    } catch {
      status(panel, value);
    }
  });
  if (document.querySelector('.doc-page') && typeof render === 'function') render();
}

module.exports = { installCareerExtras, installCareerSetup };
