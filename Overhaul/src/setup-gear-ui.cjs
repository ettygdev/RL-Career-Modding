'use strict';

function installSetupGearUi(catalog,logos={}) {
  if (typeof tabInnerHtml!=='function' || tabInnerHtml.rlcSetupGear) return;
  const target='rlc-equipment';
  const tr=(en,fr)=>/^fr\b/i.test(S?.lang || document.documentElement.lang)?fr:en;
  const label=()=>tr('Equipment','Équipement');
  let playerId=null, category=catalog[0][0], busy=false, error='';
  const oldHeader=topbarHtml;
  topbarHtml=function(...args) {
    return oldHeader.apply(this,args).replace(/<button\b[^>]*data-action="tab"[^>]*data-tab="inbox"/,match=>
      '<button type="button" class="'+(tab===target?'active':'')+'" data-action="tab" data-tab="'+target+'">'+esc(label())+'</button>'+match);
  };
  const original=tabInnerHtml;
  tabInnerHtml=Object.assign(function(...args) {
    if (tab!==target) return original.apply(this,args);
    const setup=S?.facilities?.rlcSetup;
    if (!setup) return '<div class="panel"><div class="panel-body">'+esc(tr('Club equipment is available in manager careers.',
      'Le matériel du club est disponible en carrière manager.'))+'</div></div>';
    const player=setup.players.find(p=>p.id===playerId) || setup.players[0];
    if (!player) return '';
    playerId=player.id;
    const button=(key,value,name,on)=>'<button type="button" class="ptab'+(on?' active':'')+'" data-rlc-gear="'+key+
      '" data-value="'+esc(String(value))+'">'+esc(name)+'</button>';
    const players=setup.players.map(p=>button('player',p.id,p.name,p===player)).join('');
    const tabs=catalog.map(row=>button('category',row[0],tr(row[1],row[2]),row[0]===category)).join('');
    const options=catalog.find(row=>row[0]===category)[3];
    const cards=options.map(([brand,model,quality,price],index)=>{
      const current=player.choices[category]===index;
      const purchased=player.owned?.[category]?.includes(index);
      const cost=purchased?0:price;
      const icon=logos[brand];
      const mark=typeof icon==='string' && /^[A-Za-z0-9+/=]+$/.test(icon) ?
        '<img alt="" src="data:image/svg+xml;base64,'+icon+'">' : '<span aria-hidden="true"></span>';
      return '<div class="sr-card rlc-gear-product"><div class="sr-card-sub rlc-gear-brand">'+mark+esc(brand)+
        '</div><div class="sr-card-name rlc-gear-model">'+esc(model)+'</div><div class="sr-row"><span>'+esc(tr('Equipment rating','Note du matériel'))+
        '</span><b>'+quality+'</b></div><div class="sr-row"><span>'+esc(tr('Price per player','Prix par joueur'))+
        '</span><b>'+esc(purchased?tr('Owned','Possédé'):fmtMoney(price))+'</b></div><div class="sf-actions inline rlc-gear-action">'+
        (current?'<span class="sr-pending">'+esc(tr('Equipped','Équipé'))+'</span>':
          '<button type="button" class="sf-btn go" data-rlc-gear="buy" data-value="'+index+'"'+
          (busy||!setup.editable||cost>setup.budget?' disabled':'')+'>'+esc(cost?tr('Buy and equip','Acheter et équiper'):
            tr('Equip','Équiper'))+'</button>')+'</div></div>';
    }).join('');
    const impact=(player.impact>0?'+':'')+player.impact;
    return '<div class="panel"><div class="panel-head"><div class="panel-titles"><div class="panel-title">'+esc(label())+
      '</div></div><span class="sr-budget">'+esc(fmtMoney(setup.budget))+'</span></div><div class="panel-body">'+
      '<div class="ptabs rlc-gear-tabs">'+players+'</div><div class="sr-row"><span>'+esc(tr('Setup impact in matches',
        'Effet du setup en match'))+'</span><b>'+impact+'</b></div><div class="ptabs rlc-gear-tabs">'+tabs+
      '</div><div class="rlc-gear-grid">'+cards+'</div>'+(error?'<div class="sr-card-sub" role="status">'+esc(error)+'</div>':'')+'</div></div>';
  },original,{rlcSetupGear:true});
  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-rlc-gear]');
    if (!button || busy) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action=button.dataset.rlcGear,value=button.dataset.value;
    if (action==='player') playerId=Number(value);
    if (action==='category') category=value;
    if (action!=='buy') {error='';render();return;}
    const save=S.saveId;
    busy=true;
    button.disabled=true;
    try {
      const result=await window.hub.setDayNote({day:'rlc-equipment/v2',text:[playerId,category,value].join(':')});
      if (S.saveId!==save) return;
      if (result?.ok && result.career) { S={...S,...result};error=''; }
      else error=result?.error || tr('Equipment unavailable','Matériel indisponible');
    } catch {error=tr('Purchase unavailable','Achat indisponible');}
    finally {busy=false;if (S.saveId===save && tab===target) render();}
  },true);
  const style=document.createElement('style');
  style.textContent=`
    .rlc-gear-tabs{flex-wrap:wrap;margin-block:12px}
    .rlc-gear-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,225px),1fr));column-gap:12px}
    .rlc-gear-grid .rlc-gear-product{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;
      padding:14px 16px;margin-bottom:12px;cursor:default}
    .rlc-gear-brand{display:flex;align-items:center;gap:7px;margin:0}
    .rlc-gear-brand>img,.rlc-gear-brand>span{width:16px;height:16px;flex:none}
    .rlc-gear-brand>img{object-fit:contain;filter:invert(.85)}
    .rlc-gear-grid .rlc-gear-model{display:block;margin:3px 0 6px}
    .rlc-gear-grid .rlc-gear-action{display:flex;align-items:center;justify-content:flex-end;
      min-height:42px;margin:3px 0 0}
    @supports (grid-template-rows:subgrid) {
      .rlc-gear-grid .rlc-gear-product{grid-row:span 5;grid-template-rows:subgrid}
    }
  `;
  document.head.append(style);
}

module.exports={installSetupGearUi};
