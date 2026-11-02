// Derive compact 1–12 placements using exactly the browser's versioned model.
const fs=require('node:fs');
const placement=require('./statlocker_placement_core.js');
const [directory,manifestPath,outputPath]=process.argv.slice(2);
if(!directory||!manifestPath||!outputPath)throw Error('Expected snapshot directory, manifest, output');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const ranks={};
for(const name of new Set(Object.values(manifest.matches))){
  const rows=JSON.parse(fs.readFileSync(require('node:path').join(directory,name),'utf8'));
  for(const row of rows){
    try{
      const match=placement.fromBulkMetadata(row);
      const scored=placement.scoreMatch(match);
      const values=Object.fromEntries(scored.map(p=>[String(p.heroId),p.rank]));
      const teams=Object.fromEntries(match.players.map(p=>[String(p.heroId),p.team]));
      if(Object.keys(values).length!==12||Object.keys(teams).length!==12)continue;
      values._teams=teams;
      ranks[String(row.match_id)]=values;
    }catch(e){ /* Invalid/incomplete metadata has no estimated placement. */ }
  }
}
fs.writeFileSync(outputPath,JSON.stringify({modelVersion:placement.VERSION,ranks}));
