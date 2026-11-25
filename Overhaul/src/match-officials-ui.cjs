'use strict';

function installMatchOfficialsUi(createRules) {
  if (typeof facilityDetailHtml!=='function' || facilityDetailHtml.rlcWifi) return;
  const native=facilityDetailHtml;
  const rules=createRules();
  const t=(en,fr)=>/^fr\b/i.test(S?.language || document.documentElement.lang)?fr:en;
  let busy=false,error='';
  facilityDetailHtml=Object.assign(function(book,entry,...args) {
    const html=native.call(this,book,entry,...args);
    const current=book?.rlcWifi;
    if (!current || !entry) return html;
    const template=document.createElement('template');
    template.innerHTML=html;
    const menu=template.content.querySelector('.fac-row')?.parentElement || template.content.firstElementChild;
    if (!menu) return html;
    const pct=value=>new Intl.NumberFormat(/^fr\b/i.test(S?.language || document.documentElement.lang)?'fr':'en',
      {maximumFractionDigits:1}).format(value)+'%';
    const selected=rules.network(entry.tier,current.plan);
    const labels=[t('Standard','Standard'),t('Plus','Plus'),t('Pro','Pro'),t('Dedicated','Dédié')];
    const isCurrent=entry.tier===current.tier;
    const canChange=current.editable && isCurrent;
    const choices=labels.map((name,index)=>{
      const plan=rules.network(entry.tier,index);
      const active=canChange && current.plan===index;
      const disabled=busy || (plan.monthly>book.budget && !active);
      const card='<strong>'+esc(name)+'</strong><b>'+pct(plan.reliability)+'</b><span>'+
        esc(plan.monthly?fmtMoney(plan.monthly)+t('/mo','/mois'):t('Included','Inclus'))+'</span>';
      if (!canChange) return '<div class="rlc-wifi-tile">'+card+'</div>';
      return '<button type="button" class="rlc-wifi-tile'+(active?' is-current':'')+'" data-rlc-wifi="'+index+
        '" aria-pressed="'+active+'"'+(disabled?' disabled':'')+'>'+card+'</button>';
    }).join('');
    menu.insertAdjacentHTML('beforeend','<div class="fac-row rlc-fac-wifi"><div class="fac-row-top"><span class="fac-row-k">'+
      esc(t('Wi-Fi reliability','Fiabilité Wi-Fi'))+'</span><span class="fac-row-v"><i>'+pct(selected.base)+
      '</i><span class="fac-arrow">&rarr;</span><b>'+pct(selected.reliability)+'</b></span></div>'+
      '<div class="fac-bar"><i style="width:'+selected.reliability+'%"></i></div>'+
      '<div class="rlc-wifi-plans">'+choices+'</div>'+
      '<div class="rlc-wifi-note">'+esc(canChange
        ?t('Paid plans are billed monthly. Only online matches are affected.','Facturation mensuelle. Seuls les matchs en ligne sont concernés.')
        :t('Plans for this facility. Manage your subscription at the club’s current headquarters.',
           'Forfaits de cette installation. Gère ton abonnement depuis le siège actuel du club.'))+
      '</div>'+(error?'<div class="fac-sub" role="status">'+esc(error)+'</div>':'')+'</div>');
    return template.innerHTML;
  },native,{rlcWifi:true});
  document.addEventListener('click',async event=>{
    const control=event.target.closest?.('[data-rlc-wifi]');
    if (!control || busy) return;
    event.preventDefault(); event.stopImmediatePropagation();
    busy=true; control.disabled=true;
    const id=S.saveId;
    try {
      const result=await window.hub.setDayNote({day:'rlc-wifi/v1',text:control.dataset.rlcWifi});
      if (S.saveId!==id) return;
      if (result?.ok && result.career) {S={...S,...result};error='';}
      else error=result?.error || t('Plan unavailable.','Forfait indisponible.');
    } catch {
      if (S.saveId===id) error=t('Could not save.','Enregistrement impossible.');
    } finally {
      busy=false;
      if (S.saveId===id) render();
    }
  },true);
  const css=document.createElement('style');
  css.textContent=`
    .rlc-fac-wifi {container-type:inline-size}
    .rlc-fac-wifi .fac-bar i{display:block;height:100%;background:var(--accent)}
    .rlc-wifi-plans{margin-block:12px 9px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .rlc-wifi-tile{box-sizing:border-box;min-width:0;display:grid;gap:3px;padding:8px 10px;text-align:start;
      font:inherit;line-height:1.2;color:var(--text);background:var(--navy-3);border:1px solid var(--line);border-radius:var(--r-sm,6px)}
    .rlc-wifi-tile strong,.rlc-wifi-tile span{font-size:var(--f-small,.76rem);overflow-wrap:anywhere}
    .rlc-wifi-tile b{font-size:1rem;font-variant-numeric:tabular-nums}
    .rlc-wifi-tile span,.rlc-wifi-note{color:var(--text-dim);font-size:var(--f-small,.76rem)}
    button.rlc-wifi-tile:not(:disabled){cursor:pointer}
    button.rlc-wifi-tile:not(:disabled):hover,button.rlc-wifi-tile:focus-visible,.rlc-wifi-tile.is-current{border-color:var(--accent)}
    .rlc-wifi-tile.is-current b{color:var(--accent)}
    .rlc-wifi-tile:disabled{opacity:.55}
    @container (max-width:420px){.rlc-wifi-plans{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.append(css);
}

module.exports={installMatchOfficialsUi};
