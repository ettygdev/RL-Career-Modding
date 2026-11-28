'use strict';

const quickChatCatalog = [
  { name: 'Orders', opener: '↑', options: [
    ['got','I got it!'], ['go','Go for it!'], ['center','Go center!'], ['leave','Leave it!'], ['demo','Bump the defender!']
  ] },
  { name: 'Kick-off', opener: '↓', options: [
    ['got','I got it!'], ['go','Go for it!'], ['hold','Stay back!'], ['follow','Cheat up!'], ['boost','Grab boost!']
  ] },
  { name: 'Requests', opener: '←', options: [
    ['defend','Defend?'], ['attack','Attack?'], ['receive','Center?'], ['pass-mid','Pass mid?'], ['pass','Pass?']
  ] },
  { name: 'Support', opener: '→', options: [
    ['rotate','Rotate back?'], ['receive','Center?'], ['pass','Pass?'], ['defend','Defend?']
  ] }
];

async function installQuickChat(engine, curtain, fs, path, getPreferences, catalog) {
  if (typeof engine?.setDayNote !== 'function' || !curtain?.renderHub) return null;
  if (engine.setDayNote.rlcQuickChat) return engine.setDayNote.rlcQuickChat;
  const config = { enabled: false, botCalls: true, bindings: [] };
  let directory;
  const token = process.env.RLC_INVENTORY_LAUNCH_TOKEN || String(process.pid);
  function update(input = {}) {
    if (!input || typeof input !== 'object') return;
    config.enabled = input.enabled === true;
    config.botCalls = input.botCalls !== false;
    config.groups = catalog.map((_, index) => input.groups?.[index] ?? true);
    config.bindings = catalog.flatMap((category, group) => category.options.slice(0, 4).map((fallback, direction) =>
      category.options.find(([id]) => id === input.bindings?.[group * 4 + direction]) || fallback));
  }
  update();
  try { update(await getPreferences()); } catch {}
  function write(dir, name, value) {
    const file = path.join(dir, name);
    const temporary = file + '.' + token + '.tmp';
    fs.writeFileSync(temporary, value);
    try { fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function publish() {
    if (!directory) return;
    try {
      write(directory, 'inventory-quick-chat.tsv', [
        [token, Number(config.enabled), Number(config.botCalls), Date.now() + 7200000].join(' '),
        ...config.bindings.map((pair,index) => config.groups[Math.floor(index/4)] ? pair.join('\t') : '\t'), ''
      ].join('\n'));
    } catch { /* Optional local integration. */ }
  }
  const setNote = engine.setDayNote;
  function quickChatNote(state, day, text) {
    if (day !== 'rlc-quick-chat/v1') return setNote.apply(this, arguments);
    if (typeof text !== 'string' || text.length > 1000) return { ok: false };
    try { update(JSON.parse(text)); } catch { return { ok: false }; }
    publish();
    return { ok: true };
  }
  Object.assign(quickChatNote, setNote);
  quickChatNote.rlcQuickChat = dir => { directory = dir; publish(); };
  engine.setDayNote = quickChatNote;

  function cue(dir, key) {
    try {
      if (key && !fs.existsSync(path.join(dir, 'inventory-timeout.wav'))) return;
      write(dir, 'inventory-music.txt', key ? key + ' ' + (Date.now() + 180000) : '');
    } catch { /* A soundtrack failure must leave the match available. */ }
  }
  const renderHub = curtain.renderHub;
  const lower = curtain.lower;
  const render = curtain.render;
  curtain.renderHub = function renderWithMusic(options) {
    if (options.query?.talk && options.show !== false) {
      cue(path.dirname(options.dir), 'timeout-' + token + '-' + options.fxId + '-' + options.next);
    } else if (!options.query && (options.kind === 'game' || options.kind === 'series')) {
      cue(path.dirname(options.dir), '');
    }
    return renderHub.apply(this, arguments);
  };
  curtain.lower = function stopMusic(dir) {
    cue(path.dirname(dir), '');
    return lower.apply(this, arguments);
  };
  curtain.render = function renderInitial(...args) {
    if (args[0]?.dir) cue(path.dirname(args[0].dir), '');
    return render.apply(this, args);
  };
  return quickChatNote.rlcQuickChat;
}

function installQuickChatUi(catalog) {
  if (typeof topbarHtml !== 'function' || topbarHtml.rlcQuickChat) return;
  const key = 'rlc-quick-chat';
  const get = () => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
  const style = document.createElement('style');
  style.textContent = `
    .rlc-qc{max-width:1050px;margin-inline:auto}
    .rlc-qc-toolbar{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between}
    .rlc-qc-switches{display:flex;flex-wrap:wrap;gap:10px}
    .rlc-qc-switches label{display:flex;align-items:center;gap:8px;padding:7px 11px;background:var(--navy-2);border-radius:var(--r-sm)}
    .rlc-qc-switches input{accent-color:var(--accent)}
    .rlc-qc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;margin:18px 0}
    .rlc-qc-group{margin:0;padding:15px 17px;border:1px solid color-mix(in srgb,var(--text) 15%,transparent);border-radius:var(--r-sm);background:var(--navy-2)}
    .rlc-qc-group legend{display:flex;align-items:center;gap:8px;padding:0 6px;font-size:var(--f-label);font-weight:800}
    .rlc-qc-hint{color:var(--text-dim);font-size:var(--f-small);margin:6px 0}
    .rlc-qc-key{display:grid;place-items:center;min-width:29px;height:28px;border:1px solid color-mix(in srgb,var(--text) 25%,transparent);border-radius:6px;font:700 16px/1 sans-serif}
    .rlc-qc-group legend .rlc-qc-key{color:var(--accent)}
    .rlc-qc-slot{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px;margin-top:8px}
    .rlc-qc-slot select{width:100%;min-height:36px;padding:5px 9px;font:inherit;color:var(--text);background:var(--navy-3,var(--navy-2));border:1px solid color-mix(in srgb,var(--text) 23%,transparent);border-radius:var(--r-sm)}
    .rlc-qc-slot select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .rlc-qc-footer{display:flex;align-items:center;gap:12px}
  `;
  document.head.append(style);
  const originalTop = topbarHtml;
  const originalTab = tabInnerHtml;
  topbarHtml = function quickChatTop(...args) {
    return originalTop.apply(this, args).replace(/<button\b[^>]*data-action="tab"[^>]*data-tab="inbox"/,
      match => '<button type="button" class="' + (tab === 'rlc-quick-chat' ? 'active' : '') +
        '" data-action="tab" data-tab="rlc-quick-chat">Quick Chat</button>' + match);
  };
  topbarHtml.rlcQuickChat = true;
  tabInnerHtml = function quickChatTab(...args) {
    if (tab !== 'rlc-quick-chat') return originalTab.apply(this, args);
    const data = get();
    const arrows = ['↑', '←', '→', '↓'];
    const names = ['Up', 'Left', 'Right', 'Down'];
    const groups = catalog.map((category, group) =>
      '<fieldset class="rlc-qc-group"><legend><kbd class="rlc-qc-key">' + category.opener + '</kbd>' + category.name +
      '</legend><label><input type="checkbox" name="group'+group+'"'+
      ((data.groups?.[group] ?? true)?' checked':'')+'> Enable this category</label>'+
      '<p class="rlc-qc-hint">Press '+category.opener+' to open, then pick a direction.</p>' + arrows.map((arrow, i) => {
        const slot = group * 4 + i;
        const chosen = category.options.some(([id]) => id === data.bindings?.[slot]) ?
          data.bindings[slot] : category.options[i][0];
        return '<label class="rlc-qc-slot"><kbd class="rlc-qc-key" aria-hidden="true">' + arrow +
          '</kbd><select name="slot' + slot + '" aria-label="' + category.name + ' · ' + names[i] + '">' +
          category.options.map(([id, label]) => '<option value="' + id + '"' +
            (id === chosen ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
      }).join('') + '</fieldset>').join('');
    return '<section class="card rlc-qc"><div class="card-h">Quick Chat</div><div class="card-b">' +
      '<form id="rlc-quick-chat-form"><div class="rlc-qc-toolbar"><div class="rlc-qc-switches">' +
      '<label><input name="enabled" type="checkbox"' + (data.enabled ? ' checked' : '') + '> Enable team coordination</label>' +
      '<label><input name="botCalls" type="checkbox"' + (data.botCalls !== false ? ' checked' : '') +
      '> Bot callouts</label></div></div>' + '<div class="rlc-qc-grid">' + groups + '</div>' +
      '<p class="rlc-qc-hint">All four directions are reserved for Quick Chat. Kick-off calls are available before the first touch.</p>' +
      '<div class="rlc-qc-footer"><button class="btn primary" type="submit">Save settings</button>' +
      '<span role="status"></span></div></form></div></section>';
  };
  document.addEventListener('submit', async event => {
    if (event.target?.id !== 'rlc-quick-chat-form') return;
    event.preventDefault();
    const form = event.target, values = new FormData(form);
    const settings = { enabled: values.has('enabled'), botCalls: values.has('botCalls'),
      groups: catalog.map((_,i)=>values.has('group'+i)),
      bindings: Array.from({ length: catalog.length*4 }, (_, i) => values.get('slot' + i)) };
    localStorage.setItem(key, JSON.stringify(settings));
    try {
      await window.hub.setDayNote({ day: 'rlc-quick-chat/v1', text: JSON.stringify(settings) });
      form.querySelector('[role="status"]').textContent = 'Saved';
    } catch { form.querySelector('[role="status"]').textContent = 'Saved for next launch'; }
  });
}

module.exports = { quickChatCatalog, installQuickChat, installQuickChatUi };
