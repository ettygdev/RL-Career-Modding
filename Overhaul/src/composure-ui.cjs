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
      (mentalMode ? preparation(career) : originalTraining.apply(this,args));
  };
  if (typeof BIG_LISTS !== 'undefined' && BIG_LISTS.training) {
    const originalSub = BIG_LISTS.training.sub;
    BIG_LISTS.training.sub = function (...args) {
      if (!mentalMode) return originalSub.apply(this,args);
      const coach = teamById(C()?.userTeamId)?.rlcMentalCoach;
      return statLineHtml([
        { k:tr('Coach','Coach'),v:esc(coach?.name || tr('Unassigned','Poste vacant')) },
        { k:tr('Recovery per player','Récupération par joueur'),v:esc(tr('7 days','7 jours')) }
      ]);
    };
  }

  document.addEventListener('click', async event => {
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
