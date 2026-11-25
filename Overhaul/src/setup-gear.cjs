'use strict';

function setupGearCatalog() {
  return [
    ['pc','Gaming PCs','PC gaming',[
      ['Dell','G5 5000',61,0],['Lenovo','Legion Tower 5',77,1050],['HP','OMEN 45L',90,1950],['CORSAIR','ONE i500',98,3100]]],
    ['monitor','Monitors','Écrans',[
      ['BenQ','ZOWIE XL2411K',62,0],['Dell','Alienware AW2523HF',80,330],['ASUS ROG','Swift PG27AQN',94,690],['BenQ','ZOWIE XL2586X',99,970]]],
    ['controller','Controllers','Manettes',[
      ['Microsoft','Xbox Wireless Controller',64,0],['Sony','DualSense',77,75],['GameSir','G7 SE',85,90],['Sony','DualSense Edge',98,200]]],
    ['headset','Headsets','Casques',[
      ['HyperX','Cloud Stinger 2',60,0],['HyperX','Cloud III',75,90],['SteelSeries','Arctis Nova 7',89,180],['Logitech G','PRO X 2 LIGHTSPEED',96,250]]],
    ['peripherals','Keyboard and mouse','Clavier et souris',[
      ['Logitech','MK120',60,0],['Razer','Cynosa V2 + DeathAdder Essential',76,90],
      ['SteelSeries','Apex Pro TKL + Aerox 3',88,220],['Logitech G','PRO X TKL + PRO X SUPERLIGHT 2',96,345]]]
  ];
}

function installSetupGear(engine,catalog) {
  if (!engine?.setDayNote || engine.setDayNote.rlcSetupGear) return;
  const owned = (club,id,category) => club?.rlcLoadouts?.[id]?.[category] ?? club?.rlcEquipment?.[category] ?? 0;
  const models = (club,id,key) => [...new Set([0,club?.rlcEquipment?.[key]??0,...(club?.rlcPurchasedGear?.[id]?.[key]||[])])];
  const quality = (club,id) => catalog.reduce((sum,row)=>sum+row[3][owned(club,id,row[0])]?.[2],0)/catalog.length;
  function modifier(club,player) {
    const q=quality(club,player.id);
    const requirement=Math.max(60,player.rating-9);
    const gap=q-requirement;
    return gap<0 ? -Math.min(7,Math.round(-gap/4)) : Math.min(3,Math.floor(gap/5));
  }
  const board=engine.facilityBoard;
  engine.facilityBoard=function(state,...args) {
    const output=board.call(this,state,...args);
    if (!state) return output;
    const club=engine.teamById(state,state.userTeamId);
    const members=(club?.playerIds||[]).map(id=>engine.playerById(state,id)).filter(Boolean);
    return {...output,rlcSetup:{editable:!!club && !engine.isPlayerCareer?.(state),budget:club?.budget||0,
      players:members.map(p=>({id:p.id,name:p.name,impact:modifier(club,p),
        choices:Object.fromEntries(catalog.map(row=>[row[0],owned(club,p.id,row[0])])),
        owned:Object.fromEntries(catalog.map(row=>[row[0],models(club,p.id,row[0])]))}))}};
  };
  function buy(club,id,key,index,cost) {
    const all=club.rlcLoadouts ||= {};
    const profile=all[id] ||= {};
    profile[key]=index;
    const purchases=(club.rlcPurchasedGear ||= {});
    (purchases[id] ||= {})[key]=[...new Set([...models(club,id,key),index])];
    club.budget-=cost;
  }
  const advance=engine.advance;
  engine.advance=Object.assign(function(state,...args) {
    const before=state?.currentDate?.slice(0,7);
    const result=advance.call(this,state,...args);
    const month=state?.currentDate?.slice(0,7);
    if (!before || !month || before===month) return result;
    for (const club of state.teams || []) {
      if ((club.id===state.userTeamId && !engine.isPlayerCareer?.(state)) || club.national ||
          club.rlcSetupMonth===month || !Number.isFinite(club.budget)) continue;
      club.rlcSetupMonth=month;
      const options=(club.playerIds||[]).flatMap(id=>catalog.flatMap(row=>{
        const next=owned(club,id,row[0])+1, model=row[3][next];
        return model && model[3]<=club.budget*.07 ? [{id,key:row[0],next,cost:model[3]}] : [];
      })).sort((a,b)=>a.next-b.next || a.cost-b.cost);
      const picked=options[0];
      if (picked) buy(club,picked.id,picked.key,picked.next,picked.cost);
    }
    return result;
  },advance);
  const contexts=new WeakMap(), lineup=engine.sideLineup, boost=engine.talkBoostFor;
  engine.sideLineup=Object.assign(function(state,fixture,...args) {
    const result=lineup.call(this,state,fixture,...args);
    if (fixture && Array.isArray(result)) contexts.set(fixture,state);
    return result;
  },lineup);
  engine.talkBoostFor=Object.assign(function(fixture,id,...args) {
    const result=boost.call(this,fixture,id,...args);
    const state=contexts.get(fixture), player=state && engine.playerById(state,id);
    if (!player || player.isUser || player.id===state.userPlayerId || ![fixture.homeId,fixture.awayId].includes(player.teamId))
      return result;
    return (Number(result)||0)+modifier(engine.teamById(state,player.teamId),player);
  },boost);
  const note=engine.setDayNote;
  engine.setDayNote=Object.assign(function(state,key,text) {
    if (key!=='rlc-equipment/v2') return note.apply(this,arguments);
    if (!state || state.pendingMatch!=null || engine.isPlayerCareer?.(state)) return {ok:false,error:'Club setup unavailable.'};
    const [id,keyName,indexValue]=String(text).split(':'), pid=Number(id), index=Number(indexValue);
    const club=engine.teamById(state,state.userTeamId);
    const row=catalog.find(item=>item[0]===keyName), model=row?.[3][index];
    const cost=models(club,pid,keyName).includes(index) ? 0 : model?.[3];
    if (!club?.playerIds?.includes(pid) || !model || index===owned(club,pid,keyName) || club.budget<cost)
      return {ok:false,error:'Equipment or budget unavailable.'};
    buy(club,pid,keyName,index,cost);
    if (cost) engine.pushLedger?.(state,'facility',-cost,model[0]+' '+model[1]);
    return {ok:true};
  },note,{rlcSetupGear:true});
}

module.exports={setupGearCatalog,installSetupGear};
