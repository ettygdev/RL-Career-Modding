'use strict';

function installInventoryUi() {
  if (window.__rlcInventoryUi) return 'already-installed';
  if (typeof topbarHtml !== 'function' || typeof tabInnerHtml !== 'function' ||
      typeof window.hub?.setDayNote !== 'function' || typeof window.hub?.lockerItems !== 'function') return 'waiting-renderer';
  let catalog;
  let saveKey;
  let loadedKey;
  let loading = false;
  let pending = false;
  let pane = 'garage';
  let side = 'blue';
  let slot = 'boost';
  let search = '';
  let titleSearch = '';
  let page = 0;
  let error = '';
  const number = value => Number(value || 0).toLocaleString(S?.lang || 'en');
  const money = value => '$' + number(value);
  const french = () => S?.lang?.split('-')[0] === 'fr';
  const t = (en, fr) => french() ? fr : en;
  const names = {
    boost: ['Boost', 'Boost'], decal: ['Decal', 'Sticker'], wheels: ['Wheels', 'Roues'], trail: ['Trail', 'Traînée'],
    goal: ['Goal explosion', 'Explosion de but'], topper: ['Topper', 'Chapeau'], antenna: ['Antenna', 'Antenne'],
    finish: ['Paint finish', 'Finition'], accent: ['Accent finish', 'Finition secondaire'], engine: ['Engine audio', 'Son moteur'],
    anthem: ['Anthem', 'Hymne']
  };
  const slotLabel = key => t(...names[key]);
  const current = () => S?.career?.rlcInventory;
  const profileKey = () => S?.saveId ?? S?.career?.userPlayerId;
  const preset = () => current()?.presets?.[current().active];
  const clubBudget = () => typeof isPlayerMode === 'function' && isPlayerMode() ? null :
    S?.career?.teams?.find(team => team.id === S.career.userTeamId)?.budget ?? null;
  const bucket = key => catalog?.slots?.[catalog.order?.find(item => item.key === key)?.list] || [];
  const itemName = (key, id) => bucket(key).find(row => row[0] === id)?.[1] || '';
  const carName = id => catalog?.slots?.body?.find(row => row[0] === id)?.[1] || '';
  const label = (en, fr) => esc(t(en, fr));
  const thumbs = new Map();
  const itemPaints = new Map();
  const requested = new Map();
  const paintFrench = ['Sans peinture', 'Carmin', 'Citron vert', 'Noir', 'Bleu ciel', 'Cobalt', 'Terre de Sienne',
    'Vert forêt', 'Violet', 'Rose', 'Orange', 'Gris', 'Blanc titane', 'Safran', 'Or', 'Or rose', 'Or blanc', 'Onyx', 'Platine'];
  const paintName = (name, index) => index === 0 ? t('Unpainted', 'Sans peinture') :
    french() ? paintFrench[index] || name : name;
  function paintOptions(id, currentPaint) {
    const variants = itemPaints.get(id);
    return (catalog.paints || []).map((name, index) => {
      if (index !== 0 && index !== currentPaint && variants && !variants.has(name.toLowerCase())) return '';
      return '<option value="' + index + '"' + (index === currentPaint ? ' selected' : '') + '>' +
        esc(paintName(name, index)) + '</option>';
    }).join('');
  }
  function applyThumbnail(img, image) {
    img.src = image;
    img.hidden = false;
  }
  window.__rlcInventoryThumbnail = (id, image, paints) => {
    if (image) {
      if (thumbs.size >= 128 && !thumbs.has(id)) thumbs.delete(thumbs.keys().next().value);
      thumbs.set(id, image);
      for (const img of document.querySelectorAll('.inv [data-inv-thumb]')) {
        if (Number(img.dataset.invThumb) === id) applyThumbnail(img, image);
      }
    }
    if (Array.isArray(paints)) {
      if (itemPaints.size >= 256 && !itemPaints.has(id)) itemPaints.delete(itemPaints.keys().next().value);
      itemPaints.set(id, new Set(paints.map(name => name.toLowerCase())));
      for (const select of document.querySelectorAll('.inv [data-inv-paint]')) {
        if (Number(select.dataset.invPaint) === id) select.innerHTML = paintOptions(id, Number(select.value));
      }
    }
  };
  function refreshThumbnails() {
    const needed = new Set();
    for (const select of document.querySelectorAll('.inv [data-inv-paint]')) {
      const id = Number(select.dataset.invPaint);
      if (!itemPaints.has(id)) needed.add(id);
    }
    const now = Date.now();
    for (const img of document.querySelectorAll('.inv [data-inv-thumb]')) {
      const id = Number(img.dataset.invThumb);
      const cached = thumbs.get(id);
      if (cached) applyThumbnail(img, cached);
      else needed.add(id);
    }
    const ids = [...needed].filter(id => !requested.has(id) || now - requested.get(id) > 60000).slice(0, 12);
    if (ids.length) {
      for (const id of ids) {
        if (requested.size >= 256) requested.delete(requested.keys().next().value);
        requested.set(id, now);
      }
      void window.hub.setDayNote({ day: 'rlc-inventory/v1', text: JSON.stringify({ type: 'thumbnails', ids }) }).catch(() => {});
    }
  }

  async function request(payload) {
    if (pending) return false;
    pending = true;
    const key = profileKey();
    error = '';
    try {
      const result = await window.hub.setDayNote({ day: 'rlc-inventory/v1', text: JSON.stringify(payload) });
      if (key !== profileKey()) return false;
      if (!result?.ok) {
        error = (french() && result?.inventoryFrench) || result?.error || t('Inventory unavailable.', 'Inventaire indisponible.');
        return false;
      }
      S = result;
      return true;
    } catch {
      error = t('Inventory unavailable.', 'Inventaire indisponible.');
      return false;
    } finally {
      pending = false;
      if (tab === 'inventory' && key === profileKey()) render();
    }
  }

  async function fetchInventory(key) {
    if (loading) return;
    loading = true;
    try {
      catalog ||= await window.hub.lockerItems();
      if (key === profileKey() && await request({ type: 'open' })) loadedKey = key;
    } catch {
      error = t('The item catalogue could not be loaded.', 'Le catalogue n’a pas pu être chargé.');
    } finally {
      loading = false;
      if (tab === 'inventory') render();
    }
  }

  function controls() {
    const data = current();
    return '<div class="inv-presets"><label>' + label('Active preset', 'Preset actif') +
      '<select data-inv-control="preset">' + data.presets.map((entry, index) =>
        '<option value="' + index + '"' + (index === data.active ? ' selected' : '') + '>' + esc(entry.name) + '</option>').join('') +
      '</select></label><form data-inv-form="rename"><label>' + label('Preset name', 'Nom du preset') +
      '<input name="name" maxlength="32" required value="' + esc(preset().name) + '"></label>' +
      '<button class="btn ghost sm inv-btn" type="submit">' + label('Rename', 'Renommer') + '</button></form></div>';
  }

  function garage() {
    const defaults = side === 'blue' ? { primary: '#3479dc', secondary: '#dbeaff' } : { primary: '#df601f', secondary: '#ffe1bc' };
    const custom = preset().colors?.[side];
    const enabled = preset().customColors !== false;
    const colors = enabled && custom || defaults;
    const fields = custom || defaults;
    const safe = value => /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
    return '<div class="inv-garage"><section class="inv-box"><div class="inv-color-card" style="--inv-main:' + safe(colors.primary) +
      ';--inv-accent:' + safe(colors.secondary) + '"><div class="inv-color-sides">' +
      ['blue', 'orange'].map(key => '<button type="button" class="btn ghost sm inv-btn ' + (key === side ? 'active' : '') +
        '" data-inv="side" data-key="' + key + '">' + (key === 'blue' ? label('Blue team', 'Équipe bleue') : label('Orange team', 'Équipe orange')) +
        '</button>').join('') + '</div></div><label class="inv-check"><input type="checkbox" data-inv-control="custom-colors"' +
      (enabled ? ' checked' : '') + '> ' + label('Use Inventory colors in matches', 'Appliquer les couleurs Inventory en match') +
      '</label><form class="inv-colors" data-inv-form="colors"><label>' +
      label('Primary color', 'Couleur principale') + '<input name="primary" type="color" value="' + safe(fields.primary) +
      '"></label><label>' + label('Accent color', 'Couleur secondaire') + '<input name="secondary" type="color" value="' +
      safe(fields.secondary) + '"></label><button class="btn primary sm" type="submit">' +
      label('Save colors', 'Enregistrer') + '</button>' + (custom ? '<button type="button" class="btn ghost sm inv-btn" data-inv="reset-colors">' +
      label('Use game colors', 'Couleurs du jeu') + '</button>' : '') + '</form></section><section class="inv-box inv-loadout"><h3>' +
      label('Equipped cosmetics', 'Cosmétiques équipés') + '</h3>' + Object.keys(names).map(key => {
        const item = preset().items[key];
        const decalBody = key === 'decal' && item ? bucket(key).find(row => row[0] === item.id)?.[2] : null;
        const paintable = item && catalog.order?.some(slot => slot.key === key && slot.paint);
        const paint = paintable ? '<label class="inv-paint">' + label('Item paint', 'Peinture de l’objet') +
          '<select data-inv-control="paint" data-inv-slot="' + key + '" data-inv-paint="' + item.id + '">' +
          paintOptions(item.id, item.paint || 0) + '</select></label>' : '';
        return '<div class="inv-load-row"><span>' + esc(slotLabel(key)) + '</span><b>' +
          (item ? esc(itemName(key, item.id)) : label('Game default', 'Par défaut')) + '</b><div class="inv-item-actions">' +
          paint + (item ? '<button type="button" class="btn ghost sm inv-btn" data-inv="clear" data-key="' + key + '">' +
          label('Remove', 'Retirer') + '</button>' : '') + '</div>' +
          (decalBody ? '<small class="inv-body-required">' + label('Required body', 'Carrosserie requise') +
            ' · ' + esc(carName(decalBody)) + '</small>' : '') + '</div>';
      }).join('') + '</section></div>';
  }

  function shop() {
    const data = current();
    const ownedView = pane === 'owned';
    const term = search.trim().toLowerCase();
    const slots = slot === 'all' ? Object.keys(names) : [slot];
    const matching = slots.flatMap(key => bucket(key).filter(([id, name]) => (!ownedView || data.owned[key + ':' + id]) &&
      (!term || name.toLowerCase().includes(term) || (key === 'boost' && id === 32 && 'alpha boost gold rush'.includes(term))))
      .map(item => [key, ...item]));
    const pageSize = 12;
    const lastPage = Math.max(0, Math.ceil(matching.length / pageSize) - 1);
    page = Math.min(page, lastPage);
    const rows = matching.slice(page * pageSize, page * pageSize + pageSize);
    const balance = clubBudget();
    return '<form class="inv-shop-controls" data-inv-form="search"><label>' + label('Slot', 'Emplacement') +
      '<select data-inv-control="slot">' + (ownedView ? '<option value="all">' + label('All slots', 'Tous les emplacements') + '</option>' : '') +
      Object.keys(names).map(key => '<option value="' + key + '"' +
        (key === slot ? ' selected' : '') + '>' + esc(slotLabel(key)) + '</option>').join('') +
      '</select></label><label>' + label('Search cosmetics', 'Chercher un cosmétique') +
      '<input name="search" type="search" maxlength="64" value="' + esc(search) + '"></label>' +
      '<button class="btn ghost sm inv-btn" type="submit">' + label('Search', 'Rechercher') + '</button>' +
      '</form><div class="inv-grid">' +
      rows.map(([key, id, name, restrictedBody]) => {
        const owned = data.owned[key + ':' + id];
        const equipped = preset().items[key]?.id === id;
        const cost = data.prices?.[key + ':' + id] ?? data.prices?.[key];
        const caption = key === 'boost' && id === 32 ? 'Alpha Boost' :
          restrictedBody ? carName(restrictedBody) || t('Specific car body', 'Carrosserie spécifique') : slotLabel(key);
        return '<article class="inv-item"><div class="inv-thumb"><img data-inv-thumb="' + id +
          '" width="62" height="54" alt="" hidden></div><small>' + esc(caption) + '</small><strong title="' + esc(name) + '">' + esc(name) +
          '</strong><button type="button" class="btn ghost sm inv-btn" data-inv="' + (owned ? 'equip' : 'buy') +
          '" data-key="' + key + '" data-id="' + id + '"' + (equipped || !owned && (balance === null || balance < cost) ? ' disabled' : '') + '>' +
          (equipped ? label('Equipped', 'Équipé') : owned ? label('Equip', 'Équiper') :
            label('Buy', 'Acheter') + ' · ' + money(cost)) +
          '</button></article>';
      }).join('') + '<div class="inv-item inv-placeholder" aria-hidden="true"></div>'.repeat(pageSize - rows.length) +
      (rows.length ? '' : '<p class="inv-empty">' + label('No matching cosmetics.', 'Aucun cosmétique trouvé.') + '</p>') +
      '</div><div class="inv-pager"><button type="button" class="btn ghost sm inv-btn" data-inv="prev"' + (page === 0 ? ' disabled' : '') +
      '>' + label('Previous', 'Précédent') + '</button><span>' + (page + 1) + ' / ' + (lastPage + 1) +
      '</span><button type="button" class="btn ghost sm inv-btn" data-inv="next"' + (page === lastPage ? ' disabled' : '') +
      '>' + label('Next', 'Suivant') + '</button></div>';
  }

  function titlesHtml() {
    const unlocked = current().titles || [];
    const defaultTitle = { key: null, display: t('Use game title', 'Titre du jeu') };
    const selected = unlocked.find(title => title.key === preset().title) || defaultTitle;
    const display = title => french() && title.french || title.display;
    const cssColor = value => /^[\da-f]{6}$/i.test(value || '') ? '#' + value : '';
    const nameplate = title => {
      const color = cssColor(title.color);
      const glow = cssColor(title.glow);
      return '<span class="inv-title-name' + (glow ? ' glowing' : '') + '" style="--inv-title-ink:' + (color || '#f0f0f0') +
        ';--inv-title-glow:' + (glow || 'transparent') + '">' + esc(display(title)) + '</span>';
    };
    const row = title => {
      const equipped = title.key === selected.key;
      return '<label class="inv-title-row' + (equipped ? ' selected' : '') + '">' +
        '<input name="inv-title" type="radio" data-inv-control="title" value="' + esc(title.key || '') + '"' +
        (equipped ? ' checked' : '') + '>' + nameplate(title) + (equipped ?
          '<span class="inv-title-equipped" aria-hidden="true">' + label('Equipped', 'Équipé') + '</span>' : '') + '</label>';
    };
    const term = titleSearch.trim().toLocaleLowerCase();
    const matching = unlocked.filter(title => !term || display(title).toLocaleLowerCase().includes(term) ||
      title.display.toLocaleLowerCase().includes(term));
    const groups = [
      ['earned', 'Earned in career', 'Gagnés en carrière'], ['ranked', 'Ranked seasons', 'Saisons classées'],
      ['extra', 'Extra modes', 'Modes supplémentaires'], ['level', 'Experience', 'Expérience']
    ];
    return '<section class="inv-box inv-titles"><div class="inv-title-top"><div><h3>' +
      label('Equipped title', 'Titre équipé') + '</h3>' + nameplate(selected) + '</div>' +
      '<form class="inv-title-search" data-inv-form="title-search"><label>' + label('Find a title', 'Chercher un titre') +
      '<input name="title" type="search" maxlength="64" value="' + esc(titleSearch) + '"></label>' +
      '<button class="btn ghost sm" type="submit">' + label('Search', 'Rechercher') + '</button></form></div>' +
      '<div class="inv-title-list">' + row(defaultTitle) + groups.map(([key, en, fr]) => {
        const entries = matching.filter(title => title.group === key);
        return entries.length ? '<div class="inv-title-group"><h4>' + label(en, fr) +
          '</h4>' + entries.map(row).join('') + '</div>' : '';
      }).join('') + (matching.length ? '' : '<p>' + label('No matching titles.', 'Aucun titre trouvé.') + '</p>') +
      '</div></section>';
  }

  const originalTop = topbarHtml;
  topbarHtml = function inventoryTopbar(...args) {
    const html = originalTop.apply(this, args);
    return html.replace(/<button\b[^>]*data-action="tab"[^>]*data-tab="inbox"/, match =>
      '<button type="button" class="' + (tab === 'inventory' ? 'active' : '') + '" data-action="tab" data-tab="inventory">' +
      'Inventory</button>' + match);
  };
  const originalInner = tabInnerHtml;
  tabInnerHtml = function inventoryInner(...args) {
    if (tab !== 'inventory' || !S?.career) return originalInner.apply(this, args);
    const key = profileKey();
    if (saveKey !== key) {
      saveKey = key;
      loadedKey = undefined;
      pane = 'garage';
      search = '';
      titleSearch = '';
      page = 0;
      error = '';
    }
    if (loadedKey !== key && !loading && !error) void fetchInventory(key);
    const ready = current() && catalog;
    const nav = [['garage', 'Garage', 'Garage'], ['shop', 'Shop', 'Boutique'], ['owned', 'Owned items', 'Objets possédés'], ['titles', 'Titles', 'Titres']]
      .map(([key, en, fr]) => '<button type="button" class="ptab ' + (pane === key ? 'active' : '') +
        '" data-inv="pane" data-key="' + key + '">' + label(en, fr) + '</button>').join('');
    const balance = clubBudget();
    if (ready && pane !== 'titles') queueMicrotask(refreshThumbnails);
    return '<div class="card inv"><div class="card-h inv-head"><span>Inventory</span>' +
      (ready && balance !== null ? '<span class="inv-wallet">' + label('Club budget', 'Budget du club') + ' · ' + money(balance) + '</span>' : '') +
      '</div><div class="card-b">' + (error ? '<p role="alert" class="inv-error">' + esc(error) + '</p>' : '') +
      (ready ? '<div class="ptabs inv-nav">' + nav + '</div>' + controls() +
        (pane === 'shop' || pane === 'owned' ? shop() : pane === 'titles' ? titlesHtml() : garage()) :
        '<p>' + (error ? '<button type="button" class="btn ghost sm inv-btn" data-inv="retry">' + label('Retry', 'Réessayer') + '</button>' :
          label('Loading inventory…', 'Chargement de l’inventaire…')) + '</p>') + '</div></div>';
  };

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.inv [data-inv]');
    if (!button) return;
    const action = button.dataset.inv;
    const key = button.dataset.key;
    if (action === 'pane') {
      pane = key; page = 0; search = ''; error = '';
      if (pane === 'owned') slot = 'all';
      if (pane === 'shop' && slot === 'all') slot = 'boost';
      render();
    }
    else if (action === 'side') { side = key; render(); }
    else if (action === 'prev' || action === 'next') { page += action === 'next' ? 1 : -1; render(); }
    else if (action === 'retry') { error = ''; render(); }
    else if (action === 'clear') void request({ type: action, slot: key });
    else if (action === 'reset-colors') void request({ type: action, side });
    else if (action === 'buy' || action === 'equip') void request({ type: action, slot: key, id: Number(button.dataset.id) });
  });
  document.addEventListener('change', event => {
    const target = event.target.closest?.('.inv [data-inv-control]');
    if (!target) return;
    const action = target.dataset.invControl;
    if (action === 'slot') { slot = target.value; page = 0; render(); }
    else if (action === 'custom-colors') void request({ type: action, enabled: target.checked });
    else if (action === 'paint') void request({ type: action, slot: target.dataset.invSlot,
      id: Number(target.dataset.invPaint), paint: Number(target.value) });
    else if (action === 'preset') void request({ type: action, index: Number(target.value) });
    else if (action === 'title') void request({ type: action, key: target.value || null });
  });
  document.addEventListener('submit', event => {
    const type = event.target.dataset.invForm;
    if (!type) return;
    event.preventDefault();
    const data = new FormData(event.target);
    if (type === 'search') { search = String(data.get('search') || ''); page = 0; render(); }
    else if (type === 'title-search') { titleSearch = String(data.get('title') || ''); render(); }
    else if (type === 'rename') void request({ type, name: data.get('name') });
    else if (type === 'colors') void request({ type, side, primary: data.get('primary'), secondary: data.get('secondary') });
  });
  const style = document.createElement('style');
  style.textContent = `
    .inv{min-height:0;overflow:auto}
    .inv-head,.inv-presets,.inv-presets form,.inv-shop-controls,.inv-colors,.inv-pager,.inv-color-sides{display:flex;align-items:end;flex-wrap:wrap;gap:var(--s-2,8px)}
    .inv-head{justify-content:space-between;align-items:center}.inv h3{color:var(--head);font-size:var(--f-sub);margin:0 0 var(--s-2,8px)}
    .inv-wallet{color:var(--text-dim);font-size:var(--f-small);text-transform:none}
    .inv-nav,.inv-presets,.inv-shop-controls{margin-bottom:var(--s-3,12px)}
    .inv label{display:grid;gap:5px;font-size:var(--f-small);font-weight:700;color:var(--text-dim)}
    .inv label.inv-check{display:flex;align-items:center;padding:var(--s-2,8px) 0}
    .inv input:not([type=checkbox]):not([type=radio]),.inv select{font:inherit;color:var(--text);background:var(--raise);border:1px solid var(--line,transparent);border-radius:var(--r-sm);padding:8px 10px}
    .inv select option{color:var(--text);background:var(--raise)}
    .inv-garage{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:var(--s-3,12px)}
    .inv-box,.inv-item{background:var(--raise);padding:var(--s-3,12px);border-radius:var(--r-sm)}
    .inv-color-card{min-height:135px;border-radius:var(--r-sm);padding:var(--s-2,8px);background:linear-gradient(110deg,var(--card) 0 23%,var(--inv-main) 23% 62%,var(--inv-accent) 62% 100%)}
    .inv-color-card .btn{background:var(--card);color:var(--text)}.inv-color-card .btn.active{outline:1px solid var(--head)}
    .inv input[type=color]{height:34px;width:58px;padding:2px!important}
    .inv-load-row{display:grid;grid-template-columns:1fr 1.4fr auto;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line,transparent)}
    .inv-item-actions{display:flex;align-items:end;justify-content:end;flex-wrap:wrap;gap:6px}
    .inv-body-required{grid-column:2/-1;color:var(--text-dim)}
    .inv-grid{position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:148px;gap:var(--s-2,8px)}
    .inv-item{min-width:0;display:grid;grid-template-rows:54px auto 1fr auto;gap:3px;padding:8px}
    .inv-item small,.inv-item strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .inv-item small{color:var(--text-dim);font-size:var(--f-tiny)}.inv-item .btn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    .inv-thumb{display:grid;place-items:center}.inv-thumb img{object-fit:contain}.inv-thumb img[hidden]{display:none}
    .inv-placeholder{visibility:hidden}.inv-empty{position:absolute;inset:0;display:grid;place-items:center;align-content:start;margin:24px 0 0;pointer-events:none}
    .inv-pager{justify-content:center;align-items:center;margin-top:var(--s-3,12px)}.inv-error{color:var(--red)}
    @font-face{font-family:InventoryTitle;src:local("Arial Narrow Bold"),local("ArialNarrow-Bold");font-weight:700}
    .inv-title-top{display:flex;justify-content:space-between;align-items:end;gap:var(--s-3,12px);flex-wrap:wrap;margin-bottom:var(--s-3,12px)}
    .inv-title-search{display:flex;gap:var(--s-2,8px);align-items:end}
    .inv-title-list{max-height:390px;overflow:auto;display:grid;gap:3px;padding:2px 6px 2px 2px}
    .inv-title-group h4{margin:12px 0 4px;color:var(--text-dim);font-size:var(--f-tiny);text-transform:uppercase}
    .inv label.inv-title-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:10px;
      color:var(--text);padding:6px 9px;border-radius:var(--r-sm);border:1px solid transparent;cursor:pointer}
    .inv-title-row.selected,.inv-title-row:hover{background:var(--card)}.inv-title-row.selected{border-color:var(--accent-deep)}
    .inv-title-row input{appearance:none;margin:0;width:17px;height:17px;display:grid;place-content:center;cursor:pointer;
      border:1px solid var(--text-dim);border-radius:50%;background:var(--card)}
    .inv-title-row input:checked{border-color:var(--head);color:var(--head)}
    .inv-title-row input:checked::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
    .inv-title-row input:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
    .inv-title-name{display:block;width:max-content;max-width:100%;padding:4px 8px;border-radius:3px;
      color:var(--inv-title-ink);background:#171b23;font:700 15px/1.15 InventoryTitle,"Arial Narrow",Arial,sans-serif;
      letter-spacing:.035em;text-transform:uppercase;overflow-wrap:anywhere}
    .inv-title-top .inv-title-name{font-size:18px}
    .inv-title-name.glowing{text-shadow:0 0 2px var(--inv-title-glow),0 0 6px var(--inv-title-glow)}
    .inv-title-equipped{color:var(--head);font-size:var(--f-tiny)}
    @media(max-width:850px){.inv-garage{grid-template-columns:1fr}.inv-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:540px){.inv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
  window.__rlcInventoryUi = true;
  if (typeof S !== 'undefined' && S?.career) render();
  return 'installed';
}

module.exports = { installInventoryUi };
