const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('const STEAM64_BASE='), html.indexOf('function addPlayersTogether('));

function setup(players, fetch){
  let renders = 0;
  const context = {players,loadGeneration:0,URLSearchParams,
    apiFetch:fetch,renderChips:()=>{renders++;},renderMain:()=>{renders++;},dbg:()=>{}};
  vm.createContext(context);
  vm.runInContext(source,context);
  return {context,get renders(){return renders;}};
}

test('adding a player uses one ID field, not a custom label',()=>{
  assert.doesNotMatch(html,/id="inp-nm"/);
  assert.match(html,/loadHeroMeta\(\);addPlayer\(id\);syncDashboardUrl\(\)/);
  assert.match(html,/if\(resolveName\)void loadSteamPlayerNames\(\[p\]\)/);
  assert.match(html,/void loadSteamPlayerNames\(players\.filter\(p=>missing\.some\(d=>d\.id===p\.id\)\)\)/);
});

test('Steam32 and Steam64 IDs resolve to the same account and display persona',async()=>{
  const players=[{id:'882793342',label:'882793342'},
    {id:'76561198843059070',label:'Numbn'}];
  const paths=[];
  const fixture=setup(players,async(path,options)=>{
    paths.push(path);
    assert.equal(options.priority,1);
    return [{account_id:882793342,personaname:'<Numbn & friends>'}];
  });
  assert.equal(fixture.context.steamAccountId(players[1].id),'882793342');
  assert.equal(fixture.context.steamAccountId('not-a-number'),null);
  await fixture.context.loadSteamPlayerNames(players);
  assert.deepEqual(paths,['/players/steam?account_ids=882793342']);
  assert.deepEqual(players.map(p=>p.label),['<Numbn & friends>','<Numbn & friends>']);
  assert.equal(fixture.renders,2);
  assert.match(html,/chemText\(p\.label\)/);
});

test('missing profiles, failures, and removed players retain fallback names',async()=>{
  const p={id:'76561198843059070',label:'Numbn'};
  const missing=setup([p],async()=>[]);
  await missing.context.loadSteamPlayerNames([p]);
  assert.equal(p.label,'Numbn');
  const failed=setup([p],async()=>{throw new Error('offline');});
  await failed.context.loadSteamPlayerNames([p]);
  assert.equal(p.label,'Numbn');
  const removed=setup([p],async()=>{removed.context.players=[];return [{account_id:882793342,personaname:'Other'}];});
  await removed.context.loadSteamPlayerNames([p]);
  assert.equal(p.label,'Numbn');
});
