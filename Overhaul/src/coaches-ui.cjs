'use strict';

function installCoachesUi(catalog,audience,archiveKey) {
  if (typeof BIG_LISTS === 'undefined' || !BIG_LISTS.search || BIG_LISTS['rlc-coaches']) return;
  const profiles = () => [...catalog.profiles,...(staff()?.customProfiles || [])];
  const key = 'rlc-coaches/v1';
  const t = (english, french) => /^fr\b/i.test(S?.language || document.documentElement.lang) ? french : english;
  const staff = () => C()?.rlcCoaches;
  const club = () => C() && teamById(C().userTeamId);
  const get = id => profiles().find(profile => profile.id === id);
  const occupied = id => C()?.teams?.find(team => team && !team.national && staff()?.clubs?.[team.id] === id);
  const current = () => get(staff()?.clubs?.[club()?.id]);
  const manager = () => !(typeof isPlayerMode === 'function' && isPlayerMode());
  const windowOpen = () => S?.econ?.window?.open ?? S?.window?.open ?? false;
  const signed = value => value > 0 ? '+' + value : String(value);
  const findLabel = () => t('Search coaches', 'Rechercher un coach');
  const closeLabel = () => t('Close', 'Fermer');
  const unavailable = () => t('No coach assigned', 'Aucun coach en poste');
  const route = 'rlc-coaches';
  const socialPrefix = 'rlcCoach:';
  const socialKey = profile => socialPrefix + profile.id;
  const blank = () => ({name:'', status:'all', nation:'', club:'', mental:''});
  let selected, fields = blank(), searched = false, previousList, busy = false, feedback = '';
  const player = id => {
    const pid = staff()?.playerContracts?.[id];
    return pid == null ? null : playerById(pid);
  };

  function button(action, label, className = 'btn sm', extra = '') {
    return '<button type="button" class="' + className + '" data-rlc-staff="' + action + '" ' + extra + '>' + label + '</button>';
  }

  function photo(profile, type = '') {
    const initial = esc(profile.name.slice(0,2).toUpperCase());
    const src = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(profile.portrait || '') ? profile.portrait :
      profile.hubPhoto && /^[\w.-]+$/.test(profile.hubPhoto) ? 'players/' + encodeURIComponent(profile.hubPhoto) : '';
    return '<span class="chat-face rlc-staff-face ' + type + (src ? ' has-photo' : '') + '"><span>' + initial + '</span>' +
      (src ? '<img src="' + esc(src) + '" alt="" onerror="this.remove()">' : '') + '</span>';
  }

  function outside(profile) {
    return profile.external && !staff()?.moves?.some(move => move.id === profile.id);
  }

  function employer(profile) {
    const signedPlayer = player(profile.id);
    if (signedPlayer) return [teamById(signedPlayer.teamId)?.name,t('Player contract','Contrat joueur')].filter(Boolean).join(' · ');
    const coachingClub = occupied(profile.id)?.name || (outside(profile) ? profile.club : '');
    return coachingClub ? coachingClub + ' · ' + t('Coach contract','Contrat coach') :
      (profile.status === 'former' ? t('Former coach', 'Ancien coach') : t('Free agent', 'Libre'));
  }

  function detail(profile) {
    if (!profile) return '<p class="sr-none">' + t('No matching coaches.', 'Aucun coach correspondant.') + '</p>';
    const owner = occupied(profile.id), mine = owner?.id === club()?.id && !!owner;
    const fee = profile.fee * (owner ? 3 : 1);
    const locked = busy || !windowOpen() || C()?.pendingMatch != null;
    const canHire = manager() && (mine || (!player(profile.id) && !profile.legacyOnly && !outside(profile)));
    const money = typeof fmtMoney === 'function' ? fmtMoney(fee) : String(fee);
    const years = profile.since ? profile.since + '–' + (profile.status === 'former' ? profile.last : t('present', 'aujourd’hui')) : '';
    const rows = [
      [tl('Club'),employer(profile)], [tl('Nation'),profile.nation ? nationText(profile.nation) : ''],
      [t('Years coaching','Années comme coach'),years],
      [t('Training gain', 'Gain d’entraînement'),'+' + profile.training + '%'],
      [t('Mental coaching', 'Préparation mentale'),profile.mental + '/100'],
      [t('Composure', 'Sang-froid'),mine ? signed(club()?.rlcMentalCoach?.bonus || 0) : ''],
      [t('Recruitment fee', 'Indemnité'),canHire && !mine ? money : '']
    ].filter(([,value])=>value !== '').map(([label,value]) =>
      '<div class="sr-row"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>').join('');
    return '<div class="sr-top"><div class="sr-rating rlc-rating-pair">' + photo(profile,'large') +
      '<span data-rlc-coach-rating="' + profile.mental + '">' + profile.mental + '</span>' +
      '</div><div class="sr-id"><div class="sr-bigname">' + esc(profile.name) + '</div><div class="sr-pot">@' +
      esc(profile.id) + (profile.realName ? ' · ' + esc(profile.realName) : '') + '</div></div><div class="sr-badge">' +
      (owner ? crest(owner,'big') : '') + '</div></div><div class="sr-rows">' + rows +
      '</div><div class="sr-acts">' + (canHire ? button(mine ? 'release' : 'hire',
        mine ? t('Release coach', 'Libérer le coach') : (owner ? t('Transfer', 'Transférer') : t('Hire', 'Engager')) + ' · ' + esc(money),
        'sf-btn go', locked ? 'disabled' : '') : '') +
      '<button type="button" class="sf-btn" data-action="x-profile" data-key="' + socialKey(profile) + '">Y · ' +
      esc(tl('Profile')) + '</button>' +
      (profile.url ? '<a class="sf-btn" href="' + esc(profile.url) + '" target="_blank" rel="noopener noreferrer">Liquipedia ↗</a>' : '') +
      '</div>' + (canHire && !windowOpen() ? '<p>' + t('Transfer window closed.', 'Mercato fermé.') + '</p>' : '') +
      (player(profile.id) ? '<p>' + t('Under contract as a player.', 'Sous contrat comme joueur.') + '</p>' : '') +
      (canHire && !mine && current() ? '<p>' + t('Signing a coach releases your current coach.', 'Engager un coach libère le coach actuel.') + '</p>' : '') +
      (feedback ? '<p role="status">' + esc(feedback) + '</p>' : '');
  }

  const close = cls => button('close','&times;', 'ow-close ' + cls, 'aria-label="' + esc(closeLabel()) + '"');
  const options = () => [
    ['all',t('Any', 'Tous')], ['free',t('Active free agents', 'Actifs sans club')],
    ['employed',t('Coaching under contract', 'Sous contrat comme coach')], ['former',t('Retired by 2024', 'Retraités en 2024 ou avant')],
    ['player',t('Playing under contract', 'Sous contrat comme joueur')]
  ];
  const validProfiles = () => profiles().filter(profile => !profile.legacyOnly || occupied(profile.id));
  const clubName = profile => {
    const signedPlayer = player(profile.id);
    return (signedPlayer ? teamById(signedPlayer.teamId)?.name : occupied(profile.id)?.name ||
      (outside(profile) ? profile.club : '')) || '';
  };
  function results() {
    const needle = fields.name.trim().toLocaleLowerCase();
    const list = validProfiles().filter(profile => {
      const playing = !!player(profile.id);
      const employed = !!occupied(profile.id) || outside(profile);
      const status = playing ? 'player' : employed ? 'employed' : profile.status === 'former' ? 'former' : 'free';
      return (fields.status === 'all' || fields.status === status) &&
        (!fields.nation || fields.nation === profile.nation) && (!fields.club || fields.club === clubName(profile)) &&
        (!fields.mental || profile.mental >= Number(fields.mental)) &&
        [profile.name, profile.realName].some(value => value?.toLocaleLowerCase().includes(needle));
    }).sort((a,b)=>b.mental-a.mental || a.name.localeCompare(b.name));
    if (!list.some(profile => profile.id === selected)) selected = list[0]?.id;
    const cards = list.map(profile => {
      const team = occupied(profile.id) || (player(profile.id) && teamById(player(profile.id).teamId));
      const pressed = profile.id === selected;
      return '<div class="sr-card' + (pressed ? ' on' : '') + '" data-rlc-staff="pick" data-id="' + profile.id +
        '" role="button" tabindex="0" aria-pressed="' + pressed + '"><div class="sr-card-text"><div class="sr-card-name">' +
        esc(profile.name) + '</div><div class="sr-card-sub">' + esc(employer(profile)) + '</div><div class="sr-card-rating">' +
        '<span data-rlc-coach-rating="' + profile.mental + '">' + profile.mental + '</span></div></div>' +
        '<div class="sr-card-art">' + photo(profile,'sr-face') + (team ? '<div class="sr-card-crest">' + crest(team,'small') + '</div>' : '') +
        '</div></div>';
    }).join('') || '<div class="sr-none">' + tl('Nothing matched. Widen the search.') + '</div>';
    return '<div class="two-blocks search-screen">' + close('tb-close') + '<div class="tb-light"><div class="tb-col">' +
      '<div class="tb-title">' + tl('Search results') + '</div><div class="sf-actions inline">' +
      button('back',tl('Change search'),'sf-btn') + button('reset',tl('Reset'),'sf-btn') + searchBudgetHtml() +
      '<span class="sr-count">' + tl('{n} found',{n:list.length}) + '</span></div></div><div class="sr-cards">' +
      cards + '</div></div><div class="tb-dark"><div class="tb-scroll">' + detail(get(selected)) + '</div></div></div>';
  }

  function form() {
    const any = tl('Any');
    const choices = values => [['',any], ...[...new Set(values.filter(Boolean))]
      .sort((a,b) => a.localeCompare(b)).map(v => [v,v])];
    const select = (field,label,items) => sfCardHtml(label,'<select class="sf-select" data-rlc-staff-field="' + field +
      '" aria-label="' + esc(label) + '">' + items.map(([value,text]) => '<option value="' + esc(value) + '"' +
        (fields[field] === value ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select>',
      esc(items.find(([value])=>value===fields[field])?.[1] || any));
    return '<div class="sf-screen">' + close('sf-close') + '<div class="tb-title sf-title">' +
      esc(findLabel()) + '</div>' + searchBudgetHtml() +
      '<div class="sf-grid">' + sfCardHtml(t('Coach name','Nom du coach'),
        '<input class="sf-text" type="search" data-rlc-staff-field="name" value="' + esc(fields.name) +
        '" placeholder="' + esc(any) + '" spellcheck="false">',esc(fields.name || any)) +
      sfCardHtml(t('Mental coaching','Préparation mentale'),
        '<div class="sf-range"><label><span>' + tl('MIN') +
        '</span><input class="sf-num" type="number" min="0" max="100" data-rlc-staff-field="mental" value="' +
        esc(fields.mental) + '" placeholder="0"></label></div>',esc(fields.mental || any)) +
      select('nation',tl('Nation'),choices(validProfiles().map(p=>p.nation))) +
      select('status',tl('Transfer status'),options()) + select('club',tl('Club'),choices(validProfiles().map(clubName))) +
      '</div><div class="sf-actions">' + button('reset',tl('Reset'),'sf-btn') +
      button('run',tl('Submit search'),'sf-btn go') + '</div></div>';
  }

  BIG_LISTS[route] = { ...BIG_LISTS.search, title:findLabel, render:() => searched ? results() : form() };
  const nativeWindow = bigListHtml;
  bigListHtml = function (...args) {
    const html = nativeWindow.apply(this,args);
    return bigList === route ? html.replace('ow-rlc-coaches','ow-search ow-rlc-coaches') : html;
  };

  function open(id) {
    previousList = bigList;
    bigList = route;
    selected = id;
    fields = blank();
    searched = !!id;
    feedback = '';
    windowJustOpened = true;
    render();
  }

  if (typeof searchPool === 'function') {
    const original = searchPool;
    searchPool = function (...args) {
      const coaching = new Set(staff()?.coachingPlayerIds || []);
      return original.apply(this,args).filter(player => !coaching.has(player.id));
    };
  }

  const origSquad = squadHtml;
  const origTrainingTile = trainingTileHtml;
  let squad = false;
  squadHtml = function (...args) {
    squad = typeof squadSide === 'undefined' || squadSide !== 'nation';
    try { return origSquad.apply(this, args); }
    finally { squad = false; }
  };
  trainingTileHtml = function (...args) {
    const base = origTrainingTile.apply(this, args);
    const profile = current();
    return (squad && staff() ? button('squad', '<span class="tile-text"><span class="tile-title">' +
      t('Head coach', 'Coach principal') + '</span><span class="tile-desc">' + esc(profile?.name || unavailable()) +
      '</span></span>' + (profile ? photo(profile) : ''), 'tile rlc-staff-tile clickable') : '') + base;
  };

  if (typeof transfersHtml === 'function') {
    const original = transfersHtml;
    transfersHtml = function (...args) {
      const base = original.apply(this, args);
      if (!staff()) return base;
      const template = document.createElement('template');
      template.innerHTML = base;
      const originalButton = template.content.querySelector('.search-panel[data-key="search"]');
      if (!originalButton) return base;
      const copy = originalButton.cloneNode(true);
      copy.removeAttribute('data-action');
      copy.removeAttribute('data-key');
      copy.dataset.rlcStaff = 'market';
      for (const label of copy.querySelectorAll('.panel-title,.search-cta-title')) label.textContent = findLabel();
      copy.querySelector('.search-cta-sub').textContent = t('Name, mental coaching, nation, club or transfer status · ',
        'Nom, préparation mentale, nationalité, club ou statut · ') + tl('{n} found',{n:validProfiles().length});
      const grid = document.createElement('div');
      grid.className = 'rlc-market-grid';
      originalButton.before(grid);
      grid.append(originalButton,copy);
      return template.innerHTML;
    };
  }
  if (typeof xAccountOf === 'function') {
    const nativeAccount=xAccountOf, nativeAvatar=xAvatarHtml, nativeWall=xProfileWall;
    const nativeResults=xSearchResults, nativeFollows=xFollows, nativeFollow=xFollowBtnHtml;
    const nativePost=postHtml, nativePostKey=xKeyOfPost, nativeHasFace=xHasFace;
    const coachId = accountKey => typeof accountKey === 'string' && accountKey.startsWith(socialPrefix)
      ? accountKey.slice(socialPrefix.length) : '';
    const clean = value => String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const usedHandles=()=>new Set(xPeople().map(person=>person.handle?.toLowerCase()));
    function account(profile, used=usedHandles()) {
      const employer = occupied(profile.id);
      const athlete = player(profile.id);
      const namedClub = employer?.name || (!athlete && outside(profile) ? profile.club : '');
      const team = employer || (athlete && teamById(athlete.teamId)) || null;
      const clubHandle = team && xClubs().find(club=>club.id===team.id)?.handle;
      const role = namedClub ? t('Rocket League coach for ', 'Coach Rocket League pour ') + (clubHandle?'@'+clubHandle:namedClub) :
        athlete ? t('Professional Rocket League player', 'Joueur professionnel de Rocket League') :
          profile.status==='former' ? t('Former Rocket League coach', 'Ancien coach Rocket League') :
            t('Rocket League coach | Free agent', 'Coach Rocket League | Libre');
      const clubLabel = !namedClub && athlete && team ? (clubHandle?'@'+clubHandle:team.name) : '';
      const bio = [role,clubLabel,profile.bio || (profile.nation ? nationText(profile.nation) : '')].filter(Boolean).join(' | ');
      const alias=clean(profile.name).slice(0,15) || profile.id.slice(0,15);
      const full=clean(profile.realName).slice(0,15);
      const tag=used.has(alias) && full && !used.has(full) ? full : alias;
      const followers=audience(profile,team) + ((staff()?.followed || []).includes(profile.id)?1:0);
      const displayedWall=S?.social?.profileWall;
      const loadedPosts=displayedWall?.key===archiveKey(profile.id) ? displayedWall.posts :
        (S?.social?.wall || []).filter(post=>post.rlcCoachId===profile.id);
      return { kind:'coach', id:profile.id, key:socialKey(profile), name:profile.name,
        handle:tag, clubId:employer?.id ?? null, club:namedClub || team?.name || '', sub:namedClub,
        bio, followers, posts:loadedPosts?.length || 0, verified:followers>=50000 };
    }
    xAccountOf=function (accountKey,...args) {
      const id=coachId(accountKey);
      return id ? (get(id) ? account(get(id)) : null) : nativeAccount.call(this,accountKey,...args);
    };
    xAvatarHtml=function (person,classes,...args) {
      const profile=person?.kind==='coach' && get(person.id);
      return profile ? photo(profile,classes) : nativeAvatar.call(this,person,classes,...args);
    };
    xProfileWall=function (accountKey,...args) {
      const id=coachId(accountKey);
      return nativeWall.call(this,id?archiveKey(id):accountKey,...args);
    };
    xKeyOfPost=function (post,...args) {
      return post.rlcCoachId ? socialPrefix+post.rlcCoachId : nativePostKey.call(this,post,...args);
    };
    xHasFace=function (post,...args) {
      const profile=post.rlcCoachId && get(post.rlcCoachId);
      return profile ? !!(profile.portrait || profile.hubPhoto) : nativeHasFace.call(this,post,...args);
    };
    postHtml=function (post,...args) {
      const profile=post.rlcCoachId && get(post.rlcCoachId);
      if (!profile) return nativePost.call(this,post,...args);
      const person=account(profile);
      const text=t(post.text,post.rlcCoachTextFr || post.text);
      const template=document.createElement('template');
      template.innerHTML=nativePost.call(this,{...post,text,handle:person.handle},...args);
      const name=template.content.querySelector('.x-head .x-name');
      if (name) {
        name.dataset.action='x-profile';
        name.dataset.key=person.key;
        name.classList.add('pname');
      }
      const avatar=template.content.querySelector('.x-face');
      if (avatar) {
        avatar.insertAdjacentHTML('beforebegin',photo(profile,'x-face'));
        avatar.remove();
      }
      return template.innerHTML;
    };
    xFollows=function (...args) {
      return [...nativeFollows.apply(this,args),...(staff()?.followed || []).map(id=>socialPrefix+id)];
    };
    xFollowBtnHtml=function (accountKey,...args) {
      const html=nativeFollow.call(this,accountKey,...args);
      return coachId(accountKey) ? html.replace('data-action="x-follow"','data-rlc-staff="follow"') : html;
    };
    xSearchResults=function (...args) {
      const base=nativeResults.apply(this,args);
      const needle=xQuery.trim().toLocaleLowerCase().replace(/^@/,'');
      if (!needle || !staff()) return base;
      const used=usedHandles();
      const matches=validProfiles().map(profile=>account(profile,used)).filter(person=>
        [person.name,person.handle,person.club].some(value=>value?.toLocaleLowerCase().includes(needle)));
      return [...base,...matches].sort((a,b)=>Number(b.handle===needle)-Number(a.handle===needle) ||
        (b.followers || 0)-(a.followers || 0)).slice(0,40);
    };
  }

  function captureFields(event) {
    const name = event.target.dataset?.rlcStaffField;
    if (name && Object.hasOwn(fields,name)) fields[name] = event.target.value;
  }
  document.addEventListener('input',captureFields);
  document.addEventListener('change',captureFields);
  document.addEventListener('keydown',event => {
    const control = event.target.closest?.('[data-rlc-staff][role="button"]');
    if (control && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      control.click();
    } else if (event.key === 'Enter' && event.target.dataset?.rlcStaffField) {
      event.preventDefault();
      searched = true;
      renderWindows();
    }
  },true);
  document.addEventListener('click', async event => {
    const control = event.target.closest?.('[data-rlc-staff]');
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = control.dataset.rlcStaff;
    if (action === 'close') { bigList = previousList; render(); return; }
    if (action === 'follow') {
      const id=control.dataset.key?.slice(socialPrefix.length);
      if (!id || control.disabled) return;
      const saveId=S.saveId;
      control.disabled=true;
      try {
        const result=await window.hub.setDayNote({day:key,text:'follow:'+id});
        if (result?.ok && result.career && S.saveId===saveId) { S={...S,...result}; render(); }
      } catch {
        if (S.saveId===saveId && typeof showToast==='function') showToast(t('Could not save.','Enregistrement impossible.'),'error');
      } finally { control.disabled=false; }
      return;
    }
    if (action === 'market' || action === 'squad') {
      open(action === 'squad' ? current()?.id : undefined);
      return;
    }
    if (action === 'back' || action === 'reset' || action === 'run') {
      if (action === 'reset') fields = blank();
      searched = action === 'run';
      feedback = '';
      renderWindows();
      return;
    }
    if (action === 'pick') {
      const scroller = control.closest('.sr-cards');
      const scroll = scroller?.scrollTop || 0;
      selected = control.dataset.id; feedback = ''; renderWindows();
      const next = document.querySelector('.ow-rlc-coaches .sr-cards');
      if (next) next.scrollTop = scroll;
      document.querySelector('[data-rlc-staff="pick"][data-id="' + selected + '"]')?.focus({ preventScroll:true });
      return;
    }
    if (busy || !selected || (action !== 'hire' && action !== 'release')) return;
    busy = true;
    control.disabled = true;
    const saveId = S.saveId;
    try {
      const result = await window.hub.setDayNote({day:key,text: action === 'hire' ? 'hire:' + selected : 'release'});
      if (S.saveId !== saveId) return;
      if (result?.ok && result.career) {
        S = { ...S, ...result };
        feedback = action === 'hire' ? t('Coach signed.', 'Coach engagé.') : t('Coach released.', 'Coach libéré.');
      } else feedback = result?.error || t('Transfer unavailable.', 'Transfert indisponible.');
    } catch {
      feedback = t('Transfer unavailable.', 'Transfert indisponible.');
    } finally {
      busy = false;
      if (S?.saveId === saveId) render();
    }
  }, true);

  const style = document.createElement('style');
  style.id = 'rlc-staff-style';
  style.textContent = `
    .rlc-market-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:stretch}
    .rlc-market-grid .search-panel{min-width:0;display:flex;flex-direction:column}
    .rlc-market-grid .panel-head{padding-block:10px}
    .rlc-market-grid .panel-body{flex:1}
    .rlc-market-grid .search-cta{display:grid;grid-template-columns:34px minmax(0,1fr);
      column-gap:15px;row-gap:4px;justify-content:stretch;align-content:center;padding:13px 15px;text-align:start}
    .rlc-market-grid .search-glass{grid-row:1 / span 2;width:26px;height:26px;border-width:3px;margin:0}
    .rlc-market-grid .search-glass::after{height:4px;width:13px;right:-9px;bottom:-2px}
    .rlc-market-grid .search-cta-title,.rlc-market-grid .search-cta-sub{grid-column:2}
    .rlc-market-grid .search-cta-title{font-size:var(--f-sub,1rem);line-height:1.15}
    .rlc-market-grid .search-cta-sub{line-height:1.3;font-size:var(--f-small,.8rem)}
    @media(max-width:760px){.rlc-market-grid{grid-template-columns:minmax(0,1fr)}}
    .rlc-staff-tile{width:100%;text-align:start;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .rlc-staff-tile .tile-title,.rlc-staff-tile .tile-desc{display:block}
    .rlc-staff-face{position:relative;overflow:hidden;display:inline-grid;place-items:center;min-width:36px;width:36px;height:36px;flex:none}
    .rlc-staff-face.sr-face{width:var(--sr-face-size,74px);height:var(--sr-face-size,74px)}
    .rlc-staff-face.xs-face-big{width:76px;height:76px}
    .rlc-staff-face.large{width:74px;height:74px;font-size:22px}
    .rlc-staff-face img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  `;
  document.head.appendChild(style);
}

module.exports = { installCoachesUi };
