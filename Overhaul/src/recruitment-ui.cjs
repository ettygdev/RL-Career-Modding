'use strict';

function installRecruitmentUi(makeRules) {
  if (typeof playerModalHtml!=='function' || playerModalHtml.rlcRecruitment) return;
  const R=makeRules();
  const tr=(en,fr)=>/^fr\b/i.test(S?.lang || document.documentElement.lang)?fr:en;
  const label=row=>tr(row[1],row[2]);
  const staff=()=>S?.scouting?.staff || [];
  const manager=()=>!isPlayerMode();
  let busy=false;
  let feedback='';
  const scoutRoute='rlc-scout-market';
  let scoutQuery='', scoutStatus='all', scoutSelection, marketResults=false, staffPage=false;
  const money=value=>esc(fmtMoney(value));
  function edit(html,update) {
    const template=document.createElement('template');
    template.innerHTML=html;
    update(template.content);
    return template.innerHTML;
  }
  const button=(action,label,disabled=false,style='')=>'<button type="button" class="sf-btn '+style+
    '" data-rlc-recruit="'+esc(action)+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
  const title=text=>'<div class="tb-title">'+esc(text)+'</div>';
  const searchLabel=()=>tr('Search scouts','Rechercher un scout');
  const row=(name,value)=>'<div class="sr-row"><span>'+esc(name)+'</span><b>'+value+'</b></div>';
  function skillPanel(player) {
    if (!player) return '';
    const view=viewOf(player.id), skills=view.rlcSkills;
    const report=view.rlcReport;
    const values=R.attributes.map((attr,i)=>{
      const entry=skills?.[i];
      const format=value=>String(Math.round(value*100)/100);
      return row(label(attr),entry?entry[0]===entry[1]?format(entry[0]):entry.map(format).join('–'):'&mdash;');
    }).join('');
    const strengths=skills?.map((value,i)=>({i,score:value[0]+value[1]}))
      .sort((a,b)=>b.score-a.score).slice(0,2).map(item=>label(R.attributes[item.i]));
    const reportText=report?[
      report.scout || tr('Previous report','Rapport précédent'),
      report.date && typeof fmtDateShort==='function'?fmtDateShort(report.date):report.date,
      report.stale?tr('Outdated','À actualiser'):null
    ].filter(Boolean).join(' · '):'';
    return '<section class="rlc-recruit-block">'+title(tr('Attributes','Attributs'))+
      '<div class="sr-rows rlc-recruit-columns">'+values+'</div>'+
      (reportText?'<div class="sr-card-sub">'+esc(reportText)+'</div>':'')+
      (report && strengths?row(tr('Standout attributes','Points forts estimés'),esc(strengths.join(' · '))):'')+'</section>';
  }
  function actions(player) {
    if (!player || player.retired || player.isUser || player.teamId===C()?.userTeamId || !manager()) return '';
    const view=viewOf(player.id);
    const list=staff().filter(item=>!item.out);
    const buttons=view.scouting?'':list.map(scout=>button(
      (view.rlcReport?'refresh:':'scout:')+player.id+':'+scout.id,scout.name+' · '+scout.level)).join('');
    const pick=buttons?'<details class="rlc-recruit-choice"><summary>'+esc(view.rlcReport?
      tr('Request a new report','Actualiser le rapport'):view.paused?tr('Resume scouting','Reprendre le suivi'):
        tr('Assign a scout','Affecter un scout'))+'</summary><div class="sf-actions inline">'+buttons+'</div></details>':
      view.scouting?'':'<div class="sr-card-sub">'+esc(tr('No scout available','Aucun scout disponible'))+'</div>';
    return '<section class="rlc-recruit-block" data-rlc-person="'+player.id+'"><div class="sf-actions inline">'+
      button('shortlist:'+player.id,view.rlcShortlisted?tr('Remove from shortlist','Retirer de la sélection'):
        tr('Add to shortlist','Ajouter à la sélection'))+'</div>'+pick+'</section>';
  }
  const nativeRating=ratingCell;
  ratingCell=function(player,...args) {
    const view=viewOf(player.id);
    if (!view.ratingKnown && !view.rlcReport) return '<span class="rating-badge unknown">??</span>';
    return nativeRating.call(this,player,...args);
  };
  const nativeModal=playerModalHtml;
  playerModalHtml=Object.assign(function(player,...args) {
    return edit(nativeModal.call(this,player,...args),root=>{
      root.querySelector('.pp-head')?.insertAdjacentHTML('afterend',skillPanel(player)+actions(player));
      if (viewOf(player.id).rlcReport) for (const element of root.querySelectorAll('.chip .k')) {
        if (element.textContent===tl('Scouting')) element.textContent=tr('Estimated overall','Note estimée');
      }
    });
  },nativeModal,{rlcRecruitment:true});
  if (typeof playerCardHtml==='function') {
    const original=playerCardHtml;
    playerCardHtml=function(id,...args) {
      const player=playerById(id);
      const html=original.call(this,id,...args);
      if (!player || player.isUser || player.teamId===C()?.userTeamId) return html;
      const view=viewOf(id);
      return edit(html,root=>{
        const badge=root.querySelector('.pc-rating');
        if (!badge) return;
        badge.className='pc-rating';
        badge.textContent=view.ratingKnown?String(view.rating):view.rlcReport?
          view.est.ratingLo+'–'+view.est.ratingHi:'??';
      });
    };
  }
  if (typeof searchDetailHtml==='function') {
    const original=searchDetailHtml;
    searchDetailHtml=function(player,...args) {
      return edit(original.call(this,player,...args),root=>{
        if (!player) return;
        root.querySelector('.sr-acts')?.insertAdjacentHTML('beforebegin',skillPanel(player)+actions(player));
      });
    };
  }
  if (typeof scoutedPlayers==='function') {
    const original=scoutedPlayers;
    scoutedPlayers=function(...args) {
      const existing=original.apply(this,args);
      const ids=new Set(existing.map(player=>player.id));
      return existing.concat(alivePlayers().filter(player=>player.teamId!==C()?.userTeamId &&
        !ids.has(player.id) && viewOf(player.id).rlcShortlisted));
    };
    const status=scoutStatusOf;
    scoutStatusOf=function(view,...args) {
      if (view.rlcShortlisted && !view.scouting && !view.paused && !view.potKnown) return tr('Shortlisted','En sélection');
      if (view.rlcReport?.stale && !view.scouting) return tr('Report needs updating','Rapport à actualiser');
      return status.call(this,view,...args);
    };
  }
  if (typeof scoutDetailExtraHtml==='function') {
    const original=scoutDetailExtraHtml;
    scoutDetailExtraHtml=function(player,...args) {
      return edit(original.call(this,player,...args),root=>{
        root.querySelector('.scout-extra-est')?.remove();
        const view=player && viewOf(player.id);
        if (view && !view.rlcReport && !view.scouting && !view.paused)
          root.querySelector('.scout-extra-k')?.remove();
      });
    };
  }
  if (typeof scoutWindowHtml==='function') {
    const original=scoutWindowHtml;
    scoutWindowHtml=function(...args) {
      return edit(original.apply(this,args),root=>{
        const roster=staff();
        const layout=(name,level,speed,youth,description,controls)=>
          '<div class="sr-card"><div class="sr-card-text"><div class="sr-card-name">'+esc(name)+
          '</div><div class="sr-card-sub">'+esc(description)+'</div><div class="sr-rows">'+
          row(tr('Accuracy','Précision'),level)+row(tr('Speed','Rapidité'),speed)+
          row(tr('Potential assessment','Évaluation du potentiel'),youth)+'</div>'+controls+'</div></div>';
        const current=roster.map(scout=>layout(scout.name,scout.level,scout.speed,scout.youth,
          scout.out?(scout.watching || tr('On assignment','En mission')):tr('Available','Disponible'),
          manager()?button('release:'+scout.id,tr('Release','Libérer'),scout.out):'')).join('');
        const screen=root.querySelector('.search-screen'), header=screen?.querySelector('.tb-light .tb-col');
        if (!header) return;
        screen.classList.add('rlc-scout-board');
        const tab=(action,name,active)=>'<button type="button" class="ptab'+(active?' active':'')+
          '" data-rlc-recruit="'+action+'" aria-pressed="'+active+'">'+esc(name)+'</button>';
        header.querySelector('.tb-title')?.insertAdjacentHTML('afterend','<div class="ptabs">'+
          tab('reports',tl('Scouting'),!staffPage)+tab('manage',tr('Staff','Personnel'),staffPage)+'</div>');
        if (!staffPage) return;
        const results=screen.querySelector('.sr-cards');
        if (!results) return;
        results.outerHTML='<div class="rlc-scout-roster"><div class="rlc-recruit-staff">'+current+'</div>'+
          (manager()?'<div class="sf-actions inline">'+button('market',searchLabel())+'</div>':'')+
          '<div class="panel-note" role="status">'+esc(feedback)+'</div></div>';
        const detail=screen.querySelector('.tb-scroll');
        if (detail) detail.innerHTML=title(tr('Scout department','Cellule de recrutement'))+
          '<div class="sr-card-sub">'+roster.length+' / '+(S?.scouting?.slots||3)+'</div>';
      });
    };
  }
  function marketHtml() {
    const roster=staff().map(row=>row.id);
    const clubs=C()?.rlcScouting?.marketClubs || {};
    const selectedLabel=tr('Scout','Scout');
    const close=cls=>'<button type="button" class="ow-close '+cls+'" data-action="big-close" aria-label="'+
      esc(tl('Close'))+'">&times;</button>';
    const statusOptions=[
      ['all',tr('All','Tous')],['free',tr('Free agents','Agents libres')],['signed',tr('Under contract','Sous contrat')]
    ];
    if (!marketResults) {
      const options=statusOptions.map(([key,name])=>'<option value="'+key+'"'+
        (scoutStatus===key?' selected':'')+'>'+esc(name)+'</option>').join('');
      const input='<input class="sf-text" type="search" name="scoutName" aria-label="'+esc(tl('Name'))+
        '" value="'+esc(scoutQuery)+'">';
      const select='<select class="sf-select" name="scoutStatus" aria-label="'+esc(tl('Contract'))+'">'+options+'</select>';
      return '<div class="sf-screen">'+close('sf-close')+'<div class="tb-title sf-title">'+esc(searchLabel())+
        '</div>'+searchBudgetHtml()+'<form data-rlc-scout-search><div class="sf-grid">'+
        sfCardHtml(tl('Name'),input,esc(scoutQuery || tl('Any')))+
        sfCardHtml(tl('Contract'),select,esc(statusOptions.find(([key])=>key===scoutStatus)[1]))+
        '</div><div class="sf-actions"><button class="sf-btn go" type="submit">'+tl('Submit search')+
        '</button>'+button('manage',tr('My scouts','Mes scouts'))+'</div></form></div>';
    }
    const list=R.market
      .filter(row=>R.normalize(row[1]).includes(R.normalize(scoutQuery)) &&
        (scoutStatus==='all' || (scoutStatus==='signed'?clubs[row[0]]!=null:clubs[row[0]]==null)))
      .sort((a,b)=>b[2]-a[2]);
    const selected=list.find(([id])=>id===scoutSelection) || list[0];
    scoutSelection=selected?.[0];
    const teamFor=id=>clubs[id]!=null?teamById(clubs[id]):null;
    const statusFor=id=>teamFor(id)?.name || tl('Free agent');
    const face=name=>'<span class="chat-face sr-face">'+esc(name.split(/\s+/).map(part=>part[0]).slice(0,2).join(''))+'</span>';
    const rating=level=>'<span class="rating-badge '+ratingTier(level)+'" data-rlc-scout-rating="'+level+'">'+level+'</span>';
    const market=list.map(([id,name,level])=>{
      const team=teamFor(id), active=id===scoutSelection;
      return '<div class="sr-card'+(active?' on':'')+'" data-rlc-recruit="pick:'+esc(id)+
        '" role="button" tabindex="0" aria-pressed="'+active+'"><div class="sr-card-text"><div class="sr-card-name">'+
        esc(name)+'</div><div class="sr-card-sub">'+esc(statusFor(id))+'</div><div class="sr-card-rating">'+
        rating(level)+'</div></div><div class="sr-card-art">'+face(name)+
        (team?'<div class="sr-card-crest">'+crest(team,'small')+'</div>':'')+'</div></div>';
    }).join('');
    const empty='<div class="sr-none">'+esc(tr('No scout matches','Aucun scout trouvé'))+'</div>';
    let detail=empty;
    if (selected) {
      const [id,name,level,speed,youth,fee,wage]=selected;
      const own=roster.includes(id), club=teamById(C()?.userTeamId);
      const disabled=!manager() || own || roster.length>=(S?.scouting?.slots||3) || fee+wage>(club?.budget??0);
      detail='<div class="sr-top"><div class="sr-rating">'+rating(level)+'</div><div class="sr-id"><div class="sr-bigname">'+esc(name)+
        '</div><div class="sr-pot">'+esc(selectedLabel+' · '+statusFor(id))+'</div></div></div><div class="sr-rows">'+
        row(tr('Speed','Rapidité'),speed)+
        row(tr('Potential assessment','Évaluation du potentiel'),youth)+
        row(tr('Fee and salary','Prime et salaire'),money(fee)+' · '+esc(fmtMoney(wage)+tr('/week','/semaine')))+
        '</div><div class="sr-acts">'+button('hire:'+id,own?tr('Employed','Sous contrat'):tr('Hire','Recruter'),disabled,'go')+
        '</div><div class="panel-note" role="status">'+esc(feedback)+'</div>';
    }
    return '<div class="two-blocks search-screen rlc-scout-board">'+close('tb-close')+
      '<div class="tb-light"><div class="tb-col">'+title(tl('Search results'))+'<div class="sf-actions inline">'+
      button('change-search',tl('Change search'))+button('reset-search',tl('Reset'))+
      searchBudgetHtml()+'<span class="sr-count">'+tl('{n} found',{n:list.length})+'</span></div></div>'+
      '<div class="sr-cards">'+(market||empty)+'</div></div><div class="tb-dark"><div class="tb-scroll">'+detail+'</div></div></div>';
  }
  if (typeof BIG_LISTS!=='undefined' && BIG_LISTS.search) {
    BIG_LISTS[scoutRoute]={...BIG_LISTS.search,title:searchLabel,render:marketHtml};
    const originalWindow=bigListHtml;
    bigListHtml=function(...args) {
      const html=originalWindow.apply(this,args);
      return bigList===scoutRoute?html.replace('ow-rlc-scout-market','ow-search ow-rlc-scout-market'):html;
    };
    const transfer=transfersHtml;
    transfersHtml=function(...args) {
      return edit(transfer.apply(this,args),root=>{
        const search=root.querySelector('.search-panel[data-key="search"]');
        if (!search || !manager()) return;
        const copy=search.cloneNode(true);
        copy.removeAttribute('data-action');
        copy.removeAttribute('data-key');
        copy.dataset.rlcRecruit='market';
        for (const selector of ['.panel-title','.search-cta-title']) {
          const node=copy.querySelector(selector);
          if (node) node.textContent=searchLabel();
        }
        const sub=copy.querySelector('.search-cta-sub');
        if (sub) sub.textContent=tr('Find and hire your scouting staff','Trouver et recruter des scouts');
        search.parentElement.append(copy);
      });
    };
  }
  document.addEventListener('submit',event=>{
    if (!event.target.matches?.('[data-rlc-scout-search]')) return;
    event.preventDefault();
    const form=new FormData(event.target);
    scoutQuery=String(form.get('scoutName')||'').trim().slice(0,50);
    scoutStatus=String(form.get('scoutStatus')||'all');
    marketResults=true;
    render();
  },true);
  document.addEventListener('keydown',event=>{
    if (!['Enter',' '].includes(event.key)) return;
    const card=event.target.closest?.('[data-rlc-recruit^="pick:"]');
    if (!card) return;
    event.preventDefault();
    card.click();
  },true);
  document.addEventListener('click',async event=>{
    const control=event.target.closest?.('[data-rlc-recruit]');
    if (!control || busy || control.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action=control.dataset.rlcRecruit;
    if (['market','manage','reports','change-search','reset-search'].includes(action)) {
      if (action==='market') { bigList=scoutRoute; marketResults=false; }
      if (action==='manage' || action==='reports') { bigList='scouting'; staffPage=action==='manage'; }
      if (action==='change-search' || action==='reset-search') marketResults=false;
      if (action==='reset-search') { scoutQuery=''; scoutStatus='all'; scoutSelection=undefined; }
      feedback='';
      render();
      return;
    }
    if (action.startsWith('pick:')) {
      const results=control.closest('.sr-cards'), scroll=results?.scrollTop;
      scoutSelection=Number(action.slice(5));
      feedback='';
      render();
      const updated=document.querySelector('.rlc-scout-board .sr-cards');
      if (updated) updated.scrollTop=scroll||0;
      updated?.querySelector('.sr-card.on')?.focus({preventScroll:true});
      return;
    }
    busy=true;
    control.disabled=true;
    const id=S.saveId;
    const modal=control.closest('.modal') && control.closest('[data-rlc-person]');
    try {
      const result=await window.hub.setDayNote({day:'rlc-recruitment/v1',text:control.dataset.rlcRecruit});
      if (S.saveId!==id) return;
      if (result?.ok && result.career) { S={...S,...result}; feedback=''; }
      else feedback=result?.error || tr('Action unavailable','Action indisponible');
    } catch { feedback=tr('Could not save','Enregistrement impossible'); }
    finally {
      busy=false;
      if (S.saveId===id) {
        render();
        if (modal) {
          const player=playerById(Number(modal.dataset.rlcPerson));
          if (player) showModal(playerModalHtml(player));
        }
        if (feedback && typeof toast==='function') toast(feedback);
      }
    }
  },true);
  const css=document.createElement('style');
  css.textContent=`
    .rlc-recruit-block{margin-block:12px}
    .rlc-recruit-block>summary,.rlc-recruit-choice>summary{cursor:pointer;font-weight:700;padding-block:5px}
    .rlc-recruit-columns,.rlc-recruit-staff{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:0 12px}
    .rlc-recruit-staff{gap:8px}
    .rlc-recruit-staff .sr-card{grid-template-columns:minmax(0,1fr);cursor:default}
    .rlc-recruit-staff .sr-card-text{width:100%;min-width:0}
    .rlc-recruit-block .sf-actions{justify-content:flex-start;flex-wrap:wrap;margin-block:6px}
    .rlc-recruit-block .fac-row{margin-block:6px}
    .rlc-scout-board .sr-cards{align-content:start;grid-auto-rows:minmax(144px,auto)}
    .rlc-scout-board .sf-actions.inline{flex-wrap:wrap}
    .rlc-scout-roster{min-height:0;overflow:auto}
    .rlc-scout-roster .sf-actions{margin-top:10px}
  `;
  document.head.append(css);
}

module.exports={installRecruitmentUi};
