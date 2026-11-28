const assert=require('node:assert/strict');
const vm=require('node:vm');
const {installComposureUi}=require('./src/composure-ui.cjs');
const player={id:9,name:'Test Bot',rlcAttributes:{values:Array(8).fill(80)}};
const globals={render(){},trainingHtml(){},S:{saveId:1},C:()=>({teams:[],players:[player],userTeamId:2,currentDate:'2026-11-26'}),
teamById:()=>({playerIds:[9]}),playerById:()=>player,tl:x=>x,esc:x=>String(x),faceHtml:()=>'',document:{
documentElement:{lang:'en'},addEventListener(){},createElement:()=>({}),head:{append(){}}}};
vm.runInNewContext('('+installComposureUi.toString()+')()',globals);
const html=globals.trainingHtml();
assert.equal((html.match(/type="checkbox"/g)||[]).length,8);
assert.match(html,/rlc-drill-split/);
assert.match(html,/First touches/);
console.log('Training renderer opened with eight exercises and a detail panel.');
