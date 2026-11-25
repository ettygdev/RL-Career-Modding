'use strict';

function installRatingDials() {
  if (typeof ratingCell!=='function' || ratingCell.rlcDial) return;
  const tr=(en,fr)=>/^fr\b/i.test(S?.language || S?.lang || document.documentElement.lang)?fr:en;
  const stops=[[0,8],[50,33],[75,53],[100,118]];
  const ink=hue=>'hsl('+hue+' 86% 62%)';
  function dial(value,label,small,name=label) {
    const score=Math.min(100,Math.max(0,value));
    const end=stops.findIndex(([limit],i)=>i>0 && score<=limit);
    const [low,lowHue]=stops[end-1], [high,highHue]=stops[end];
    const color=ink(lowHue+(highHue-lowHue)*(score-low)/(high-low));
    const colors=stops.slice(0,end).filter(([limit])=>limit<score)
      .map(([limit,hue])=>ink(hue)+' '+limit+'%');
    if (score>0) colors.push(color+' '+score+'%');
    colors.push('#ffffff25 '+score+'%','#ffffff25 100%');
    const ring='conic-gradient(from 0deg,'+colors.join(',')+')';
    return '<span class="rlc-rating-dial'+(small?' compact':'')+'" style="--rating:'+score+
      '%;--rating-ink:'+color+';--rating-ring:'+ring+'" title="'+esc(name)+'" aria-label="'+esc(name+' '+value)+'"><span>'+
      esc(label)+'</span><b>'+esc(String(Math.round(value*100)/100))+'</b></span>';
  }
  function edit(html,visit) {
    const doc=document.createElement('template');doc.innerHTML=html;visit(doc.content);return doc.innerHTML;
  }
  function composure(root,target) {
    for (const item of root.querySelectorAll('.rlc-poise')) {
      const value=Number(item.querySelector('b')?.textContent || NaN);
      if (!Number.isFinite(value)) continue;
      const html=dial(value,tr('CMP','S-F'),true,tr('Composure','Sang-froid'));
      if (!target) { item.outerHTML=html; continue; }
      target.insertAdjacentHTML('beforeend',html);
      item.remove();
    }
  }
  const cell=ratingCell;
  ratingCell=Object.assign(function(player,...args) {
    const view=viewOf(player.id);
    return view.ratingKnown && Number.isFinite(view.rating)?dial(view.rating,'OVR',true):cell.call(this,player,...args);
  },cell,{rlcDial:true});
  const card=playerCardHtml;
  playerCardHtml=function(id,...args) {
    return edit(card.call(this,id,...args),root=>{
      const badge=root.querySelector('.pc-rating'), view=viewOf(id);
      const poise=root.querySelector('.pc-lines .rlc-poise');
      if (badge && view.ratingKnown && Number.isFinite(view.rating) && !badge.classList.contains('you')) {
        const html=dial(view.rating,'OVR',true);
        if (poise) { poise.outerHTML='<span class="rlc-rating-pair">'+html+poise.outerHTML+'</span>'; badge.remove(); }
        else badge.outerHTML=html;
      }
      composure(root);
    });
  };
  const modal=playerModalHtml;
  playerModalHtml=Object.assign(function(player,...args) {
    return edit(modal.call(this,player,...args),root=>{
      const view=viewOf(player.id);
      const identity=root.querySelector('.pp-id');
      if (identity && view.ratingKnown && Number.isFinite(view.rating)) {
        const oldRating=Array.from(root.querySelectorAll('.statchips .chip'))
          .find(chip=>chip.querySelector('.k')?.textContent===tl('Rating'));
        oldRating?.remove();
        identity.insertAdjacentHTML('beforeend','<div class="rlc-rating-pair">'+dial(view.rating,'OVR',true)+'</div>');
        composure(identity,identity.lastElementChild);
      }
    });
  },modal);
  if (typeof searchDetailHtml==='function') {
    const detail=searchDetailHtml;
    searchDetailHtml=function(...args) {
      return edit(detail.apply(this,args),root=>{
        const group=root.querySelector('.sr-rating');
        if (!group) return;
        group.classList.add('rlc-rating-pair');
        composure(root,group);
      });
    };
  }
  if (typeof searchResultsHtml==='function') {
    const results=searchResultsHtml;
    searchResultsHtml=function(...args) {
      return edit(results.apply(this,args),root=>{
        root.querySelector('.search-screen')?.classList.add('rlc-player-results');
        for (const row of root.querySelectorAll('.sr-card[data-pid]')) {
          const group=row.querySelector('.sr-card-rating');
          if (!group) continue;
          group.classList.add('rlc-rating-pair');
          composure(row,group);
        }
      });
    };
  }
  if (typeof BIG_LISTS!=='undefined') {
    const staffDials=[
      ['rlc-coaches','data-rlc-coach-rating','COACH',tr('Mental coaching','Préparation mentale')],
      ['rlc-scout-market','data-rlc-scout-rating','SCOUT',tr('Scout rating','Note du scout')]
    ];
    for (const [route,attribute,label,name] of staffDials) {
      const list=BIG_LISTS[route];
      if (!list) continue;
      const renderList=list.render;
      list.render=function(...args) {
        return edit(renderList.apply(this,args),root=>{
          for (const badge of root.querySelectorAll('['+attribute+']')) {
            const value=Number(badge.getAttribute(attribute));
            if (Number.isFinite(value)) badge.outerHTML=dial(value,label,true,name);
          }
        });
      };
    }
  }
  const style=document.createElement('style');
  style.textContent=`
    .rlc-rating-dial{display:inline-grid;place-content:center;justify-items:center;position:relative;isolation:isolate;
      width:64px;height:64px;border-radius:50%;box-sizing:border-box;vertical-align:middle;line-height:1;
      background:radial-gradient(circle at 42% 37%,#555961 0,#25272c 48%,#090a0c 79%);
      box-shadow:0 1px 4px #0009,inset 0 0 0 1px #ffffff21;color:var(--rating-ink);font-variant-numeric:tabular-nums}
    .rlc-rating-dial::before{content:"";position:absolute;inset:3px;border-radius:inherit;
      background:var(--rating-ring);
      -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2px));pointer-events:none}
    .rlc-rating-dial>span{color:#ebedf0;font-size:10px;font-weight:700;letter-spacing:.06em}
    .rlc-rating-dial>b{font-size:24px;font-weight:800}
    .rlc-rating-dial.compact{width:40px;height:40px;flex:none}
    .rlc-rating-dial.compact>span{font-size:7px}
    .rlc-rating-dial.compact>b{font-size:13px}
    .rlc-rating-dial.compact::before{inset:2px}
    .rlc-rating-pair{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
    .pc-lines>.rlc-rating-pair{justify-content:center;width:100%}
    .pp-id>.rlc-rating-pair{margin-top:8px}
    .rlc-player-results .sr-cards{align-content:start;grid-auto-rows:minmax(146px,auto)}
  `;
  document.head.append(style);
}

module.exports={installRatingDials};
