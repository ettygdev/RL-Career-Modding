'use strict';

function installWorldStaffUi() {
  if (typeof worldEdHtml !== 'function' || worldEdHtml.rlcStaff) return;
  const key = 'rlcStaff';
  const route = 'rlc-coaches';
  const tr = (en,fr) => /^fr\b/i.test(S?.language || document.documentElement.lang) ? fr : en;
  const coachLabel = () => tr('Coaches','Coachs');
  const composure = () => tr('Composure','Sang-froid');
  const data = () => wEd.world[key] ||= {composure:{},coaches:[]};
  const emptyData = () => wEd?.world?.[key];
  let selected;
  const button = (action,label,classes='btn ghost sm',extra='') =>
    '<button type="button" class="'+classes+'" data-rlc-w-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
  function edit(html,callback) {
    const template = document.createElement('template');
    template.innerHTML = html;
    callback(template.content);
    return template.innerHTML;
  }
  function composureField(ref,compact) {
    const value = emptyData()?.composure?.[ref] ?? '';
    return '<label class="wed-field'+(compact?' rlc-world-poise':'')+'"><span>'+esc(composure())+
      '</span><input type="number" min="0" max="100" step="1" data-rlc-w-composure="'+esc(ref)+'" value="'+
      value+'" placeholder="'+esc(tr('Auto','Auto'))+'"></label>';
  }
  const nativePanel = wTeamPanelHtml;
  wTeamPanelHtml = function (...args) {
    const html = nativePanel.apply(this,args);
    if (!wEd || !wTeam) return html;
    const refs = wRoster(wTeam);
    return edit(html,root=>{
      [...root.querySelectorAll('.wed-squad > .wed-man')].forEach((row,i)=>{
        if (refs[i]) row.querySelector('[data-action="w-slot"]')?.insertAdjacentHTML('beforebegin',composureField(refs[i],true));
      });
    });
  };
  const nativePlayer = wPlayerFormHtml;
  wPlayerFormHtml = function (...args) {
    const html = nativePlayer.apply(this,args);
    return wPlayer ? edit(html,root=>root.querySelector('.wed-row3')?.insertAdjacentHTML('beforeend',
      composureField('c:'+wPlayer,false))) : html;
  };

  function coachList() {
    const list = emptyData()?.coaches || [];
    return '<div class="wed-acts">'+button('new',tr('Make a new coach','Créer un coach'),
      'btn primary sm',list.length>=150?'disabled':'')+'</div><div class="wed-list">'+list.map(profile=>button(
      'pick',profile.name || tr('New coach','Nouveau coach'),'wed-team'+(profile.id===selected?' on':''),
      'data-id="'+esc(profile.id)+'"')).join('')+(list.length?'':'<div class="wed-empty">'+
      esc(tr('No custom coaches yet.','Aucun coach personnalisé.'))+'</div>')+'</div>';
  }
  function coachForm() {
    const profile = emptyData()?.coaches?.find(item=>item.id===selected);
    if (!profile) return '<div class="wed-empty">'+esc(tr('Create a coach or select one.','Crée un coach ou sélectionne-le.'))+'</div>';
    const entries = wEd.base.flatMap(region=>region.teams).map(team=>[team.name,wTeamName(team.name)]);
    const nations = Object.keys(preFlags || {}).sort().map(nation=>[nation,nationText(nation)]);
    const option = ([value,label],selectedValue)=>'<option value="'+esc(value)+'"'+(value===selectedValue?' selected':'')+'>'+esc(label)+'</option>';
    const field = (name,label,type,attrs='')=>'<label class="wed-field"><span>'+esc(label)+'</span>'+
      '<input data-rlc-w-field="'+name+'" type="'+type+'" '+attrs+' value="'+esc(String(profile[name]??''))+'"></label>';
    const select = (name,label,values)=>'<label class="wed-field"><span>'+esc(label)+'</span><select class="pre-select wed-select" data-rlc-w-field="'+name+'">'+
      values.map(item=>option(item,profile[name])).join('')+'</select></label>';
    return '<div class="wed-panel"><div class="wed-club-name">'+esc(profile.name||tr('New coach','Nouveau coach'))+
      '</div><div class="wed-form"><div class="wed-row2">'+field('name',tl('Name'),'text','maxlength="24"')+
      select('nation',tl('Country'),[['',tl('No country')],...nations])+'</div><div class="wed-row2">'+
      field('mental',tr('Mental coaching','Préparation mentale'),'number','min="0" max="100" step="1"')+
      field('training',tr('Training bonus (%)','Bonus d’entraînement (%)'),'number','min="0" max="25" step="1"')+
      '</div>'+select('team',tl('Club'),[['',tl('Free agent')],...entries])+
      field('bio',tr('Y bio','Bio Y'),'text','maxlength="160"')+'</div>'+
      '<div class="wed-acts">'+button('delete',tr('Delete coach','Supprimer le coach'))+'</div></div>';
  }
  const nativeLeft = wLeftHtml, nativeRight = wRightHtml, nativeEditor = worldEdHtml;
  wLeftHtml = function (...args) { return wTab===route ? coachList() : nativeLeft.apply(this,args); };
  wRightHtml = function (...args) { return wTab===route ? coachForm() : nativeRight.apply(this,args); };
  worldEdHtml = Object.assign(function (...args) {
    const html = nativeEditor.apply(this,args);
    return wEd ? edit(html,root=>root.querySelector('.wed-tabs')?.insertAdjacentHTML('beforeend',
      button('tab',coachLabel(),'wed-tab'+(wTab===route?' on':'')))) : html;
  },nativeEditor,{rlcStaff:true});

  document.addEventListener('click',event=>{
    const target = event.target.closest?.('[data-rlc-w-action]');
    if (!target || !wEd) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = target.dataset.rlcWAction;
    if (action==='tab') {
      wTab=route;
      wPick=null;
      if (!emptyData()?.coaches?.some(profile=>profile.id===selected)) selected=emptyData()?.coaches?.[0]?.id;
    } else if (action==='new') {
      if (data().coaches.length >= 150) return;
      selected='custom'+crypto.randomUUID().replaceAll('-','');
      data().coaches.push({id:selected,name:'',nation:'',team:'',mental:70,training:10,bio:''});
      wSaveSoon();
    } else if (action==='pick') selected=target.dataset.id;
    else if (action==='delete') {
      data().coaches=data().coaches.filter(profile=>profile.id!==selected);
      selected=data().coaches[0]?.id;
      wSaveSoon();
    }
    render();
    if (action==='new') document.querySelector('[data-rlc-w-field="name"]')?.focus();
  },true);

  document.addEventListener('change',event=>{
    const input = event.target;
    if (!wEd || !input.dataset) return;
    if (input.dataset.rlcWComposure) {
      const ref=input.dataset.rlcWComposure;
      if (input.value==='') delete data().composure[ref];
      else if (input.validity.valid) data().composure[ref]=Number(input.value);
      else { input.reportValidity(); return; }
      wSaveSoon();
    } else if (input.dataset.rlcWField) {
      const profile=data().coaches.find(item=>item.id===selected);
      if (!profile) return;
      const field=input.dataset.rlcWField;
      if (input.type==='number' && (input.value==='' || !input.validity.valid)) {
        input.value=profile[field]; return;
      }
      profile[field]=input.type==='number'?Number(input.value):input.value;
      wSaveSoon();
      if (field==='name') {
        const title=document.querySelector('#w-right .wed-club-name');
        if (title) title.textContent=profile.name || tr('New coach','Nouveau coach');
        wRefresh();
      }
    }
  },true);
  const css=document.createElement('style');
  css.textContent='.rlc-world-poise{flex:0 0 78px;min-width:0}.rlc-world-poise input{width:100%}.wed-row3:has([data-rlc-w-composure]){grid-template-columns:repeat(4,minmax(0,1fr))}';
  document.head.append(css);
}

module.exports = { installWorldStaffUi };
