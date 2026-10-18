// Shared browser/Node experimental lobby-placement model. No network or storage.
// Statlocker-inspired, NOT Statlocker's exact formula. Version bump when changing rules.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BreadlockPlacement=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const VERSION=1;
  const WEIGHTS={
    'Early Game Damage':.05,'Late Game Damage':.09,'Early Game Assists':110,
    'Late Game Assists':150,'Lane Creep Kills':9.12,'Damage Absorbed':.02,
    'Other Player Total Healing':.06,'Teammate Barriers Provided':.175,
    'Healing Prevented':.05,'Death Score':-135
  };
  function insist(value,label){if(!Number.isFinite(value))throw Error('Missing '+label);return value}
  function fromMetadata(info,heroes={}){
    if(!info||!Number.isFinite(info.match_id)||!(info.duration_s>0)||
       !Array.isArray(info.players)||info.players.length!==12||info.game_mode!==1)
      throw Error('Expected complete 12-player normal match metadata');
    const heroIds=new Set(info.players.map(p=>p.hero_id));
    if(heroIds.size!==12||new Set(info.players.map(p=>p.player_slot)).size!==12)throw Error('Duplicate hero/slot');
    const killSlots=new Map(info.players.map(p=>[p.player_slot,[]]));
    for(const victim of info.players)for(const death of victim.death_details||[]){
      const bucket=killSlots.get(death.killer_player_slot);
      if(bucket)bucket.push({time:insist(death.game_time_s,'kill time'),victimHeroId:victim.hero_id});
    }
    const players=info.players.map(p=>{
      if(!Array.isArray(p.stats)||!p.stats.length||!Array.isArray(p.death_details))
        throw Error('Missing full player timeline/deaths');
      const snapshots=p.stats;
      if(snapshots.some((s,i)=>i&&s.time_stamp_s<snapshots[i-1].time_stamp_s))throw Error('Unsorted snapshots');
      const early=snapshots.reduce((best,s)=>Math.abs(s.time_stamp_s-info.duration_s/2)<Math.abs(best.time_stamp_s-info.duration_s/2)?s:best);
      const last=snapshots[snapshots.length-1];
      const gold=new Map((last.gold_sources||[]).map(s=>[s.source,s]));
      if([2,3,5,12].some(id=>!gold.has(id)))throw Error('Missing farm gold sources');
      const farmSouls=[2,3,5,12].reduce((sum,id)=>{
        const source=gold.get(id);return sum+insist(source.gold,'farm gold')+(source.gold_orbs||0);
      },0);
      const killEvents=killSlots.get(p.player_slot);
      if(killEvents.length!==p.kills)throw Error('Kill event count mismatch');
      const name=heroes[p.hero_id]?.name||String(p.hero_id);
      return {hero:name,heroId:p.hero_id,team:p.team,
        'Early Game Damage':insist(early.player_damage,'early damage'),
        'Late Game Damage':insist(last.player_damage,'final damage')-early.player_damage,
        'Early Game Assists':insist(early.assists,'early assists'),
        'Late Game Assists':insist(last.assists,'final assists')-early.assists,
        'Lane Creep Kills':insist(last.creep_kills,'lane creeps'),
        'Damage Absorbed':insist(last.player_damage_taken,'damage taken')+
          insist(last.damage_mitigated,'damage mitigated')+insist(last.damage_absorbed,'barrier absorbed'),
        'Other Player Total Healing':insist(last.teammate_healing,'ally healing'),
        'Teammate Barriers Provided':insist(last.teammate_barriering,'ally barriers'),
        'Healing Prevented':insist(last.heal_prevented,'healing prevented'),
        'Death Score':p.death_details.reduce((sum,d)=>sum+Math.sqrt(insist(d.death_duration_s,'respawn')/8),0),
        farmSouls,bossDamage:insist(last.boss_damage,'objective damage'),killEvents,
        timeline:snapshots.map(s=>({time:s.time_stamp_s,netWorth:s.net_worth,
          bossDamage:s.boss_damage??0}))};
    });
    const baseObjectiveFirstHits=(info.objectives||[]).filter(o=>o.team_objective_id>=9&&o.first_damage_time_s>0)
      .map(o=>({ownerTeam:o.team,time:o.first_damage_time_s}));
    return {matchId:info.match_id,duration:info.duration_s,baseObjectiveFirstHits,players};
  }
  // The bulk endpoint exposes the same telemetry under flattened fields and
  // string enums. Normalize it before using the exact same scoring path.
  function fromBulkMetadata(row,heroes={}){
    if(!row||!Array.isArray(row.players))throw Error('Missing bulk match players');
    const team=value=>{
      if(value===0||value===1)return value;
      const match=/^Team([01])$/.exec(String(value));
      if(!match)throw Error('Unknown bulk match team');
      return Number(match[1]);
    };
    const players=row.players.map(raw=>{
      const p=typeof raw==='string'?JSON.parse(raw):raw;
      if(!Array.isArray(p.stats)||!p.stats.length)throw Error('Missing bulk player timeline');
      const last=p.stats[p.stats.length-1];
      const source=(id,name)=>({source:id,gold:last['gold_source_'+name+'_gold'],
        gold_orbs:last['gold_source_'+name+'_gold_orbs']});
      const stats=[...p.stats];
      stats[stats.length-1]={...last,gold_sources:[
        source(2,'lane_creeps'),source(3,'neutrals'),
        source(5,'treasure'),source(12,'breakable')]};
      return {hero_id:p.hero_id,player_slot:p.player_slot,team:team(p.team),
        kills:p.kills,death_details:p.death_details,stats};
    });
    const objectives=(row.objectives||[]).map(o=>({
      team_objective_id:/^(BarrackBoss|Titan|Core)/.test(o.team_objective)?9:0,
      team:team(o.team),first_damage_time_s:o.first_damage_time_s
    }));
    return fromMetadata({match_id:row.match_id,duration_s:row.duration_s,
      game_mode:row.game_mode==='Normal'?1:row.game_mode,players,objectives},heroes);
  }
  function snapshotAt(player,time){
    if(!Array.isArray(player.timeline)||!player.timeline.length)throw Error('Net-worth timeline missing');
    return [...player.timeline].reverse().find(s=>s.time<=time)||player.timeline[0];
  }
  function victimNetWorthFactor(match,event){
    const victim=match.players.find(p=>p.heroId===event.victimHeroId);
    if(!victim)throw Error('Kill victim missing');
    const mates=match.players.filter(p=>p.team===victim.team);
    if(mates.length!==6)throw Error('Incomplete team');
    const worth=snapshotAt(victim,event.time).netWorth;
    const average=mates.reduce((sum,p)=>sum+snapshotAt(p,event.time).netWorth,0)/6;
    return average>0?Math.max(.65,Math.min(1.4,1+.8*(worth/average-1))):1;
  }
  function killPoints(events,duration,victimFactor=()=>1){
    if(!Array.isArray(events)||duration<=0)throw Error('Kill events/duration missing');
    return events.reduce((sum,event)=>{
      if(!Number.isFinite(event.time)||event.time<0||event.time>duration)throw Error('Invalid kill time');
      const fraction=event.time/duration;
      return sum+300*(.5+1.5*fraction*fraction)*victimFactor(event);
    },0);
  }
  function farmAdjustment(base,farm,maxFarm){
    if(!Number.isFinite(farm)||maxFarm<=0||farm<0)throw Error('Farm telemetry missing');
    const x=Math.max(0,1-farm/maxFarm);
    return base*(.4*x-.1*x*x);
  }
  function objectivePoints(match,player,model){
    if(!Number.isFinite(player.bossDamage)||player.bossDamage<0)throw Error('Objective damage missing');
    if(model==='off')return 0;
    if(model==='timeline'){
      if(!Array.isArray(match.baseObjectiveFirstHits)||!Array.isArray(player.timeline))throw Error('Objective timeline missing');
      const hits=match.baseObjectiveFirstHits.filter(o=>o.ownerTeam!==player.team);
      if(!hits.length)return player.bossDamage*.23;
      const first=Math.min(...hits.map(o=>o.time));
      const before=[...player.timeline].reverse().find(s=>s.time<=first);
      const pre=Math.min(player.bossDamage,before?.bossDamage||0);
      return .23*pre+.11*(player.bossDamage-pre);
    }
    return player.bossDamage*({conservative:.17,midpoint:.19,prebase:.23}[model]);
  }
  function scoreMatch(match,options={}){
    const {victimModel='neutral',farmModel='off',objectiveModel='timeline'}=options;
    if(!['neutral','team-networth'].includes(victimModel)||!['off','approximate'].includes(farmModel)||
       !['off','conservative','midpoint','prebase','timeline'].includes(objectiveModel))throw Error('unknown scoring variant');
    if(!Array.isArray(match.players)||match.players.length!==12||!(match.duration>0)||
       new Set(match.players.map(p=>p.heroId)).size!==12)throw Error('Expected complete 12-player independent match');
    const peak=new Map();
    for(const p of match.players){
      if(!Number.isFinite(p.farmSouls))throw Error('Farm telemetry missing');
      peak.set(p.team,Math.max(peak.get(p.team)||0,p.farmSouls));
    }
    return match.players.map(p=>{
      const known=Object.entries(WEIGHTS).reduce((sum,[key,weight])=>sum+insist(p[key],key)*weight,0);
      const kills=killPoints(p.killEvents,match.duration,e=>victimModel==='team-networth'?victimNetWorthFactor(match,e):1);
      const objectives=objectivePoints(match,p,objectiveModel);
      const base=known+kills+objectives;
      const farm=farmModel==='approximate'?farmAdjustment(base,p.farmSouls,peak.get(p.team)):0;
      return {hero:p.hero,heroId:p.heroId,score:base+farm,knownPoints:known,
        estimatedKillPoints:kills,estimatedObjectivePoints:objectives,estimatedFarmBonus:farm};
    }).sort((a,b)=>b.score-a.score||a.heroId-b.heroId).map((p,i)=>({...p,rank:i+1}));
  }
  function placementSummary(places){
    const xs=places.filter(x=>Number.isInteger(x)&&x>=1&&x<=12);
    if(!xs.length)return {average:null,modes:[],count:0};
    const counts=new Map();for(const rank of xs)counts.set(rank,(counts.get(rank)||0)+1);
    const most=Math.max(...counts.values());
    return {average:xs.reduce((a,b)=>a+b,0)/xs.length,
      modes:[...counts].filter(([,n])=>n===most).map(([rank])=>rank).sort((a,b)=>a-b),count:xs.length};
  }
  return {VERSION,WEIGHTS,fromMetadata,fromBulkMetadata,snapshotAt,victimNetWorthFactor,
    killPoints,farmAdjustment,objectivePoints,scoreMatch,placementSummary};
});
