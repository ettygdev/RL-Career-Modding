'use strict';

function installComposureUi() {
  if (typeof render !== 'function' || typeof trainingHtml !== 'function' || render.rlcComposure) return;
  const key = 'rlc-composure/v1';
  const tr = (en, french) => (/^fr\b/i.test(S?.language || document.documentElement.lang) ? french : en);
  const title = () => tr('Composure', 'Sang-froid');
  const view = player => {
    if (!Number.isFinite(player?.rlcComposure?.base)) return null;
    const mental = player.rlcComposure;
    const bonus = Number(teamById(player.teamId)?.rlcMentalCoach?.bonus) || 0;
    const intrinsic = mental.base + mental.growth / 100;
    return { mental, intrinsic, bonus, score: Math.round(Math.min(100, intrinsic + bonus)) };
  };
  const visible = player => player && (player.teamId === C()?.userTeamId || typeof viewOf !== 'function' || viewOf(player.id)?.ratingKnown);
  function metric(player) {
    const item = visible(player) && view(player);
    return item ? '<span class="rlc-poise" title="' + esc(title()) + '"><b>' + item.score +
      '</b> <span>' + esc(title()) + '</span></span>' : '';
  }
  function edit(html, callback) {
    const template = document.createElement('template');
    template.innerHTML = html;
    callback(template.content);
    return template.innerHTML;
  }
  function appendMetric(html, selector, player) {
    const badge = metric(player);
    if (!badge) return html;
    return edit(html, root => root.querySelector(selector)?.insertAdjacentHTML('beforeend', badge));
  }
  if (typeof playerCardHtml === 'function') {
    const original = playerCardHtml;
    playerCardHtml = function (id, ...rest) {
      return appendMetric(original.call(this, id, ...rest), '.pc-lines', playerById(id));
    };
  }
  if (typeof playerModalHtml === 'function') {
    const original = playerModalHtml;
    playerModalHtml = function (player, ...rest) {
      return appendMetric(original.call(this, player, ...rest), '.pp-id', player);
    };
  }
  if (typeof searchResultsHtml === 'function') {
    const original = searchResultsHtml;
    searchResultsHtml = function (...args) {
      return edit(original.apply(this, args), root => {
        for (const row of root.querySelectorAll('.sr-card[data-pid]')) {
          const player = playerById(Number(row.dataset.pid));
          row.querySelector('.sr-card-text')?.insertAdjacentHTML('beforeend',metric(player));
          const subtitle = row.querySelector('.sr-card-sub');
          if (subtitle && player?.teamId >= 0) subtitle.append(' · ' + tr('Player contract','Contrat joueur'));
        }
      });
    };
  }
  if (typeof searchDetailHtml === 'function') {
    const original = searchDetailHtml;
    searchDetailHtml = function (player, ...args) {
      const person = typeof player === 'object' ? player : playerById(player);
      return edit(appendMetric(original.call(this,player,...args),'.sr-id',person),root=>{
        if (!(person?.teamId >= 0)) return;
        for (const key of root.querySelectorAll('.sr-row > span')) {
          if (key.textContent === tl('Contract')) key.textContent = tr('Player contract','Contrat joueur');
        }
      });
    };
  }
  if (typeof dealCardHtml === 'function') {
    const original = dealCardHtml;
    dealCardHtml = function (player, ...args) {
      return appendMetric(original.call(this, player, ...args), '.dl-card-stats', player);
    };
  }

  let busy = false, feedback = '', mentalMode = false, pickerCareer, pick;
  const mentalLabel = () => tr('Mental training','Préparation mentale');
  const originalTraining = trainingHtml;
  function preparation(career) {
    const mine = teamById(career.userTeamId);
    const trainer = mine?.rlcMentalCoach;
    const today = Math.floor(Date.parse(career.currentDate) / 86400000);
    const playerCareer = typeof isPlayerMode === 'function' && isPlayerMode();
    const candidates = (mine?.playerIds || []).map(id=>playerById(id)).filter(player=>
      player && !player.retired && (!playerCareer || player.id === career.userPlayerId) && view(player));
    if (!candidates.some(player=>player.id===pick)) pick = playerCareer ? candidates[0]?.id : null;
    const cards = candidates.map(player => {
      const { mental, intrinsic, score } = view(player);
      const days = Number.isFinite(mental.last) ? Math.max(0, 7 - (today - mental.last)) : 0;
      const atCap = intrinsic >= mental.cap;
      return {player, score, intrinsic, days, atCap, cap:mental.cap};
    });
    const selected = cards.find(card=>card.player.id===pick);
    const status = card => card.atCap ? tr('Limit reached','Plafond atteint') :
      card.days ? tln('Ready in {n} day','Ready in {n} days',card.days) : tl('Ready');
    const roster = cards.map(({player,score,intrinsic,days,atCap,cap})=>{
      const active = player.id === pick;
      const lower = Math.floor(intrinsic);
      const upper = Math.min(lower+1,cap);
      const progress = atCap ? 100 : Math.round((intrinsic-lower)*100);
      return '<button type="button" class="tsq' + (active?' picking':'') + ((days||atCap)?' held':'') +
        '" data-rlc-training-pick="' + player.id + '" aria-pressed="' + active + '">' +
        '<div class="tsq-face">' + faceHtml(player.name,player.id,'tsq-photo') + '</div>' +
        '<div class="tsq-name">' + esc(player.name) + '</div><div class="tsq-rate" title="' +
        esc(intrinsic.toFixed(2)+' / '+cap) + '"><span class="tr-lo">' + lower +
        '</span><span class="tr-bar"><i style="width:' + progress + '%"></i></span><span class="tr-hi">' +
        upper + '</span></div><div class="tsq-sessions">' + esc(title() + ' ' + score) + '</div>' +
        '<div class="tsq-held">' + esc(status({atCap,days})) + '</div></button>';
    }).join('');
    const canTrain = trainer && selected && !busy && !selected.days && !selected.atCap &&
      career.pendingMatch == null && !career.liveGame && Number.isFinite(today);
    const action = !trainer ? tr('Coach required','Coach requis') : !selected ? tr('Choose a player','Choisir un joueur') :
      selected.days || selected.atCap ? status(selected) : tl('Begin training');
    return '<div class="tsq-wrap rlc-mental-training"><div class="tsq-grid">' + roster +
      '</div><div class="tsq-actions"><button type="button" class="tsq-act primary" data-rlc-train="' +
      (pick ?? '') + '"' + (canTrain?'':' disabled') + '>' + esc(action) + '</button></div>' +
      (feedback?'<div class="panel-note" role="status">'+esc(feedback)+'</div>':'') + '</div>';
  }


  function individualDrills(career) {
    const names = [
      tr('Counterattacks','Contre-attaques'),tr('Goal-line saves','Arrêts sur la ligne'),
      tr('Aerial resets','Resets aériens'),tr('Passing lanes','Lignes de passe'),
      tr('Bump routes','Trajectoires de bump'),tr('Rotation reads','Lecture des rotations'),
      tr('First touches','Premières touches'),tr('Team calls','Communication du trio')
    ];
    const today = Math.floor(Date.parse(career.currentDate)/86400000);
    const cards = (teamById(career.userTeamId)?.playerIds || []).map(id=>playerById(id)).filter(p=>
      p && !p.retired && (!(typeof isPlayerMode === 'function' && isPlayerMode()) || p.id === career.userPlayerId));
    const attributes=[
      tr('Attack','Attaque'),tr('Defense','Défense'),tr('Mechanics','Mécaniques'),tr('Passing','Passes'),
      tr('Bumping','Bumps'),tr('Game sense','Lecture du jeu'),tr('Ball control','Contrôle du ballon'),tr('Communication','Communication')
    ];
    const descriptions=[
      tr('Break forward sooner and contest offensive 50/50s.', 'Transition plus rapide vers l’attaque et meilleurs 50/50 offensifs.'),
      tr('Read threats and approach saves with more precision.', 'Mieux lire les menaces et se placer pour les arrêts.'),
      tr('Execute aerial moves and resets more accurately.', 'Exécuter les mécaniques aériennes et les resets avec plus de précision.'),
      tr('Find passing lanes and aim toward the receiver.', 'Repérer les lignes de passe et mieux viser le réceptionneur.'),
      tr('Choose and line up bump attempts.', 'Mieux choisir et aligner les tentatives de bump.'),
      tr('Improve positioning and decisions during rotations.', 'Améliorer le placement et les décisions pendant les rotations.'),
      tr('Keep the ball closer on the ground or in the air.', 'Garder le ballon plus proche au sol et en l’air.'),
      tr('Announce intentions sooner with Quick Chat.', 'Annoncer plus vite ses intentions dans le Quick Chat.')
    ];
    return '<style>.rlc-drill-player{appearance:none;border:0;color:inherit;font:inherit;cursor:pointer;width:100%}.rlc-drill-player:focus-visible{outline:2px solid var(--accent)}.rlc-drill-dialog{position:fixed;inset:0;width:min(94vw,1320px);height:fit-content;max-height:84vh;margin:auto;padding:0;border:0;background:var(--navy-2,#262d38);color:var(--text,#fff);overflow:auto}.rlc-drill-dialog::backdrop{background:#0005;backdrop-filter:blur(6px)}.rlc-drill-split{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}.rlc-drill-list,.rlc-drill-side{padding:clamp(1rem,2vw,2rem)}.rlc-drill-list{background:var(--card,var(--navy-2,#262d38))}.rlc-drill-side{background:#384150;color:#f4f6fb;display:flex;flex-direction:column;min-height:24rem}.rlc-drill-title{margin:0 0 .5rem;font-size:clamp(1.35rem,2.1vw,2rem);text-transform:uppercase}.rlc-drill-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem;margin-top:1rem}.rlc-drill-option{display:flex;align-items:flex-start;gap:.7rem;min-height:5rem;padding:.85rem;background:var(--navy-3,var(--navy-2));border:1px solid color-mix(in srgb,currentColor 16%,transparent);cursor:pointer}.rlc-drill-option:focus-within{outline:2px solid var(--accent);outline-offset:-2px}.rlc-drill-option:has(input:checked){background:var(--accent,#da253d);color:var(--accent-ink,#fff)}.rlc-drill-option input{accent-color:var(--accent)}.rlc-drill-option small{display:block;margin-top:.25rem}.rlc-drill-actions{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-top:auto;padding-top:1rem}.rlc-drill-side [hidden]{display:none!important}.rlc-drill-side form{align-self:flex-end}.rlc-drill-preview meter{width:100%;height:1rem;accent-color:var(--accent)}@media(max-width:750px){.rlc-drill-split{grid-template-columns:1fr}.rlc-drill-side{min-height:13rem}}</style><div class="tsq-wrap"><div class="tsq-grid">'+cards.map(p=>{
      const used=(p.rlcDrillDays || []).filter(d=>d>today-7).length;
      const remaining=Math.max(0,3-used);
      const id=Number(p.id);
      const maximum=career.realism>=1?Math.min(99,(p.potential||p.rating)+1):99;
      const progress=index=>Math.min(99,Math.floor(100*(p.rlcDrillFraction?.[index] ??
        (p.rlcDrillProgress?.[index]||0)/3)));
      const options=names.map((name,index)=>{
        const rating=p.rlcAttributes?.values?.[index];
        return '<label class="rlc-drill-option"><input type="checkbox" value="'+index+'"'+
          (!remaining || !Number.isFinite(rating) || rating>=maximum?' disabled':'')+'><span><strong>'+esc(name)+
          '</strong><small>'+esc(attributes[index])+' · '+esc(String(rating??'—'))+'</small></span></label>';
      }).join('');
      const previews=names.map((name,index)=>'<section class="rlc-drill-preview" data-rlc-drill-preview="'+index+'"'+
        (index?' hidden':'')+'><h3 class="rlc-drill-title">'+esc(name)+'</h3><p>'+esc(descriptions[index])+
        '</p><p><strong>'+esc(attributes[index])+'</strong> · '+esc(String(p.rlcAttributes?.values?.[index]??'—'))+
        '</p><meter min="0" max="100" value="'+progress(index)+'"></meter><p>'+
        progress(index)+'% · '+esc(tr('progress toward +1','progression vers +1'))+'</p></section>').join('');
      return '<button type="button" class="tsq rlc-drill-player" data-rlc-drill-player="'+id+
        '" aria-haspopup="dialog"><span class="tsq-face">'+faceHtml(p.name,p.id,'tsq-photo')+
        '</span><span class="tsq-name">'+esc(p.name)+'</span><small>'+remaining+' · '+
        esc(tr('sessions available','séances disponibles'))+'</small></button>'+
        '<dialog class="rlc-drill-dialog" id="rlc-drill-'+id+'" data-limit="'+remaining+'" aria-labelledby="rlc-drill-title-'+id+
        '"><div class="rlc-drill-split"><section class="rlc-drill-list"><h2 class="rlc-drill-title" id="rlc-drill-title-'+id+'">'+esc(tl('Training'))+
        '</h2><p>'+esc(p.name)+' · '+remaining+' '+esc(tr('sessions available','séances disponibles'))+
        '</p><div class="rlc-drill-options">'+options+'</div></section>'+
        '<aside class="rlc-drill-side"><form method="dialog"><button class="btn ghost" aria-label="'+esc(tr('Close','Fermer'))+'">×</button></form>'+
        previews+'<p role="status"></p><div class="rlc-drill-actions"><span aria-live="polite" data-rlc-drill-count>0 / '+remaining+
        '</span><button type="button" class="btn primary" data-rlc-drill="'+id+'" disabled>'+
        esc(tr('Start selected sessions','Lancer les séances choisies'))+'</button></div></aside></div></dialog>';
    }).join('')+'</div><p role="status">'+esc(feedback)+'</p></div>';
  }
  if (typeof trainingTileHtml === 'function') {
    const trainingTile = trainingTileHtml;
    trainingTileHtml = function (...args) {
      const template = document.createElement('template');
      template.innerHTML = trainingTile.apply(this,args);
      const tile = [...template.content.querySelectorAll('.tile')].find(element =>
        element.querySelector('.tile-title')?.textContent.trim() === tl('Training'));
      const description = tile?.querySelector('.tile-desc');
      if (description) description.textContent = tr(
        'Technical and mental training', 'Entraînement technique et mental');
      return template.innerHTML;
    };
  }
  trainingHtml = function (...args) {
    const career = C();
    if (!career?.teams || !career.players) return originalTraining.apply(this,args);
    if (pickerCareer !== S?.saveId) {
      pickerCareer = S?.saveId;
      mentalMode = false;
      pick = null;
      feedback = '';
    }
    const tab = (value,text,active)=>'<button type="button" class="ptab'+(active?' active':'')+
      '" data-rlc-training-tab="'+value+'" aria-pressed="'+active+'">'+esc(text)+'</button>';
    return '<div class="ptabs rlc-training-tabs">'+tab('standard',tl('Training'),!mentalMode)+
      tab('mental',mentalLabel(),mentalMode)+'</div>' +
      (mentalMode ? preparation(career) : individualDrills(career));
  };
  if (typeof BIG_LISTS !== 'undefined' && BIG_LISTS.training) {
    BIG_LISTS.training.sub = function (...args) {
      if (!mentalMode) return esc(tr("Individual training · three sessions per player", "Entraînement individuel · trois séances par joueur"));
      const coach = teamById(C()?.userTeamId)?.rlcMentalCoach;
      return statLineHtml([
        { k:tr('Coach','Coach'),v:esc(coach?.name || tr('Unassigned','Poste vacant')) },
        { k:tr('Recovery per player','Récupération par joueur'),v:esc(tr('7 days','7 jours')) }
      ]);
    };
  }

  document.addEventListener('focusin',event=>{
    const dialog=event.target.closest?.('.rlc-drill-dialog');
    if (!dialog || event.target.type!=='checkbox') return;
    for (const panel of dialog.querySelectorAll('[data-rlc-drill-preview]')) {
      panel.hidden=panel.dataset.rlcDrillPreview!==event.target.value;
    }
  });
  document.addEventListener('change',event=>{
    const dialog=event.target.closest?.('.rlc-drill-dialog');
    if (!dialog || event.target.type!=='checkbox') return;
    const checked=[...dialog.querySelectorAll('input:checked')];
    const limit=Number(dialog.dataset.limit);
    if (checked.length>limit) event.target.checked=false;
    const count=Math.min(checked.length,limit);
    dialog.querySelector('[data-rlc-drill-count]').textContent=count+' / '+limit;
    dialog.querySelector('[data-rlc-drill]').disabled=!count;
  });
  document.addEventListener('click', async event => {
    const drillCard=event.target.closest?.('[data-rlc-drill-player]');
    if (drillCard && !busy) {
      document.getElementById("rlc-drill-"+drillCard.dataset.rlcDrillPlayer)?.showModal();
      return;
    }
    const drill = event.target.closest?.('[data-rlc-drill]');
    if (drill) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy || drill.disabled) return;
      busy=true;
      const snapshot=S;
      try {
        const dialog=drill.closest('dialog');
        const indices=[...dialog.querySelectorAll('input:checked')].map(field=>field.value);
        if (!indices.length) return;
        const result=await window.hub.setDayNote({day:key,text:'drill:'+drill.dataset.rlcDrill+':'+indices.join(',')});
        if (S===snapshot) {
          if (result?.ok && result.career) S={...S,...result};
          feedback=result?.ok?tr('Session completed.','Séance terminée.'):tr('Session unavailable.','Séance indisponible.');
          if (result?.ok) { dialog.close(); render(); }
          else dialog.querySelector('[role="status"]').textContent=feedback;
        }
      } catch {
        drill.closest('dialog')?.querySelector('[role="status"]')?.replaceChildren(tr('Session unavailable.','Séance indisponible.'));
      } finally { busy=false; }
      return;
    }
    const changeTab = event.target.closest?.('[data-rlc-training-tab]');
    const choose = event.target.closest?.('[data-rlc-training-pick]');
    if (changeTab || choose) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (changeTab) mentalMode = changeTab.dataset.rlcTrainingTab === 'mental';
      else pick = Number(choose.dataset.rlcTrainingPick);
      feedback = '';
      renderWindows();
      const control = changeTab ? '[data-rlc-training-tab="'+changeTab.dataset.rlcTrainingTab+'"]' :
        '[data-rlc-training-pick="'+pick+'"]';
      document.querySelector(control)?.focus({preventScroll:true});
      return;
    }
    const button = event.target.closest?.('[data-rlc-train]');
    if (!button || button.disabled || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const snapshot = S;
    const id = Number(button.dataset.rlcTrain);
    const before = view(playerById(id))?.intrinsic;
    busy = true;
    button.disabled = true;
    try {
      const result = await window.hub.setDayNote({ day: key, text: 'train:' + id });
      if (S !== snapshot) return;
      if (result?.ok && result.career) {
        S = { ...S, ...result };
        const after = view(playerById(id))?.intrinsic;
        feedback = Number.isFinite(after - before) ? '+' + (after - before).toFixed(2) + ' ' + title() : title();
      } else feedback = tr('Session unavailable.', 'Séance indisponible.');
    } catch {
      feedback = tr('Session could not be saved.', 'La séance n’a pas pu être sauvegardée.');
    } finally {
      busy = false;
      if (S?.saveId === snapshot?.saveId) render();
    }
  }, true);

  let synced;
  const originalRender = render;
  render = function (...args) {
    const result = originalRender.apply(this, args);
    const id = S?.saveId;
    if (!id || !S.career) synced = undefined;
    else if (synced !== id) {
      synced = id;
      queueMicrotask(async () => {
        if (S?.saveId !== id) return;
        const snapshot = S;
        const result = await window.hub.setDayNote({ day: key, text: 'sync' }).catch(() => null);
        if (S === snapshot && result?.ok && result.career) {
          S = { ...S, ...result };
          render();
        }
      });
    }
    return result;
  };
  render.rlcComposure = true;
  const style = document.createElement('style');
  style.textContent = `
    .rlc-poise{display:inline-flex;align-items:center;gap:.35em;width:max-content;max-width:100%;margin-top:4px;color:inherit;font-size:.82em}
    .rlc-poise b{font-variant-numeric:tabular-nums}
    .rlc-poise span{opacity:.78}
    .rlc-training-tabs{width:100%;max-width:1180px;margin:0 auto 14px}
    .rlc-mental-training button.tsq{border:0;color:inherit;font:inherit;min-width:0}
    .rlc-mental-training button.tsq.picking{color:var(--accent-ink,#fff)}
  `;
  document.head.append(style);
}

module.exports = { installComposureUi };
