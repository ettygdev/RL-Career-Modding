'use strict';

function installWorldAttributes(worldRules,engine) {
  if (!worldRules?.checkWorld || worldRules.checkWorld.rlcAttributes) return;
  const valid=values=>Array.isArray(values) && values.length===8 &&
    values.every(value=>Number.isInteger(value)&&value>=0&&value<=100);
  const average=values=>values.reduce((sum,value)=>sum+value,0)/8;
  const checked=worldRules.checkWorld;
  worldRules.checkWorld=Object.assign(function(input,...args) {
    const result=checked.call(this,input,...args);
    for (const player of result.world?.players||[]) {
      const values=input?.players?.find(source=>source.id===player.id)?.rlcAttributes;
      if (!valid(values)) continue;
      const overall=average(values);
      if (overall<40 || overall>99) {
        result.errors.push(player.name+' — Overall must be between 40 and 99.');
        continue;
      }
      player.rating=overall;
      player.rlcAttributes=[...values];
    }
    return result;
  },checked,{rlcAttributes:true});
  const applied=worldRules.applyWorld;
  worldRules.applyWorld=function(base,world,...args) {
    const result=applied.call(this,base,world,...args);
    result.rlcWorldAttributes=Object.fromEntries((world?.players||[]).filter(p=>valid(p.rlcAttributes))
      .map(p=>[worldRules.nameKey(p.name),p.rlcAttributes]));
    return result;
  };
  const generate=engine.generateLeague;
  engine.generateLeague=Object.assign(function(options,...args) {
    const state=generate.call(this,options,...args);
    const traits=options?.real?.rlcWorldAttributes;
    if (!traits) return state;
    for (const player of state.players||[]) {
      if (player.isUser) continue;
      const values=traits[worldRules.nameKey(player.name)];
      if (!valid(values)) continue;
      const rating=average(values);
      player.rating=rating;
      player.ratingExact=rating;
      player.rlcAttributes={rating,values:[...values],offsets:values.map(value=>value-rating)};
    }
    return state;
  },generate);
}

function installWorldAttributeUi(makeRules) {
  if (typeof wPlayerFormHtml!=='function' || wPlayerFormHtml.rlcAttributes) return;
  const R=makeRules();
  const tr=(en,fr)=>/^fr\b/i.test(S?.lang || document.documentElement.lang)?fr:en;
  const form=wPlayerFormHtml;
  wPlayerFormHtml=Object.assign(function(...args) {
    const html=form.apply(this,args), player=wPlayer && wMade(wPlayer);
    if (!player) return html;
    const fragment=document.createElement('template');
    fragment.innerHTML=html;
    const fields=fragment.content.querySelector('#w-p-rating')?.closest('.wed-field');
    if (!fields) return html;
    const values=player.rlcAttributes || R.stats(player.rating,Array(8).fill(0));
    fields.innerHTML='<span>'+tr('Overall','Note générale')+'</span><output data-rlc-world-overall>'+player.rating+'</output>';
    const label=R.attributes.map((attr,i)=>'<label class="wed-field"><span>'+esc(tr(attr[1],attr[2]))+
      '</span><input type="number" min="0" max="100" step="1" data-rlc-world-attr="'+i+'" value="'+
      Math.round(values[i])+'"></label>').join('');
    fields.closest('.wed-row3')?.insertAdjacentHTML('afterend','<div class="wed-row3 rlc-world-attributes">'+label+'</div>');
    return fragment.innerHTML;
  },form,{rlcAttributes:true});
  document.addEventListener('input',event=>{
    const control=event.target.closest?.('[data-rlc-world-attr]');
    if (!control || !wPlayer || control.value==='') return;
    const item=wMade(wPlayer);
    if (!item) return;
    const values=item.rlcAttributes ||= R.stats(item.rating,Array(8).fill(0)).map(Math.round);
    values[Number(control.dataset.rlcWorldAttr)]=R.cap(Math.round(Number(control.value)),0,100);
    item.rating=values.reduce((sum,value)=>sum+value,0)/8;
    const output=document.querySelector('[data-rlc-world-overall]');
    if (output) output.textContent=String(item.rating);
    wSaveSoon();
  },true);
}

module.exports={installWorldAttributes,installWorldAttributeUi};
