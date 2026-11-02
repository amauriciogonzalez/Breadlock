const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const vm=require('node:vm');
const model=require('../backend/statlocker_placement_core.js');

test('snapshot builder scores valid rows and leaves invalid rows for API fallback',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'breadlock-derived-'));
  try{
    const row={match_id:42,duration_s:1800,game_mode:'Normal',objectives:[],players:[]};
    const fields=['time_stamp_s','net_worth','player_damage','assists','creep_kills',
      'player_damage_taken','damage_mitigated','damage_absorbed','teammate_healing',
      'teammate_barriering','heal_prevented','boss_damage',
      ...['lane_creeps','neutrals','treasure','breakable'].flatMap(name=>
        ['gold','gold_orbs'].map(suffix=>'gold_source_'+name+'_'+suffix))];
    for(let i=0;i<12;i++)row.players.push({hero_id:i+1,player_slot:i,
      team:'Team'+(i<6?0:1),kills:0,death_details:[],stats:[180,1800].map(t=>
        Object.fromEntries(fields.map(f=>[f,f==='time_stamp_s'?t:10+i])))});
    fs.writeFileSync(path.join(dir,'chunk.json'),JSON.stringify([row,{match_id:43,players:[]} ]));
    fs.writeFileSync(path.join(dir,'mapping.json'),JSON.stringify({matches:{42:'chunk.json',43:'chunk.json'}}));
    const output=path.join(dir,'derived.json');
    execFileSync(process.execPath,[path.join(__dirname,'../backend/build_placements.cjs'),
      dir,path.join(dir,'mapping.json'),output]);
    const derived=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(derived.modelVersion,model.VERSION);
    assert.equal(Object.keys(derived.ranks).length,1);
    assert.deepEqual(Object.values(derived.ranks['42']).filter(Number.isInteger).sort((a,b)=>a-b),
      Array.from({length:12},(_,i)=>i+1));
    assert.equal(Object.values(derived.ranks['42']._teams).filter(x=>x===0).length,6);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('published average is used only when the selected history matches',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const code=html.slice(html.indexOf('function placementForPlayer('),html.indexOf('function placementModes('));
  const p={id:'1',matches:[{match_id:42,hero_id:1},{match_id:43,hero_id:1}]};
  const context=vm.createContext({scopeUnit:'matches',scopeCount:0,scopeMode:'normal',
    savedPlacementSummaries:{'1':{'normal:0:matches':{ids:['42','43'],average:3.5,
      modes:[3,4],count:2,selected:2}}},steamAccountId:id=>id,visibleMatches:p=>p.matches,
    placementForMatches:()=>({average:9,modes:[9],count:1,selected:2})});
  vm.runInContext(code,context);
  assert.equal(context.placementForPlayer(p).average,3.5);
  p.matches=[{match_id:44,hero_id:1},{match_id:43,hero_id:1}];
  assert.equal(context.placementForPlayer(p).average,9);
  context.scopeUnit='days';
  assert.equal(context.placementForPlayer(p).average,9);
});
