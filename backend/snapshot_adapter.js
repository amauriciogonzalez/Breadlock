/* Read saved snapshot data first; missing rows use the paced browser API cache. */
(function(root){
'use strict';
function install(coordinator,{fetchImpl=root.fetch.bind(root),base='./snapshot/',status=()=>{}}={}){
  const originalRequest=coordinator.request.bind(coordinator);
  const originalMetadata=coordinator.metadata.bind(coordinator);
  const files=new Map();
  let manifest=null;
  const ready=(async()=>{
    try{
      const response=await fetchImpl(base+'manifest.json',{cache:'no-store'});
      if(!response.ok)throw Error('Snapshot HTTP '+response.status);
      const data=await response.json();
      if(data.version!==1||!data.accounts||!data.matches)throw Error('Invalid snapshot manifest');
      manifest=data;
      status('Saved '+data.savedMatches+'/'+data.uniqueHistoryMatches+
        ' matches · updated '+new Date(data.generatedAt).toLocaleString());
    }catch(e){status('No saved snapshot; using live API ('+e.message+')');}
  })();
  function file(name){
    if(!files.has(name))files.set(name,fetchImpl(base+name+'?v='+encodeURIComponent(manifest.generatedAt))
      .then(response=>{if(!response.ok)throw Error('Snapshot '+name+' HTTP '+response.status);return response.json();})
      .catch(e=>{files.delete(name);throw e;}));
    return files.get(name);
  }
  async function placements(modelVersion){
    await ready;
    const record=manifest?.placements;
    if(!record||record.modelVersion!==modelVersion)return null;
    try{
      const data=await file(record.file);
      return data.modelVersion===modelVersion&&data.ranks&&data.summaries?data:null;
    }catch(e){status('Saved placements unavailable; calculating from metadata: '+e.message);return null;}
  }
  coordinator.request=async function(path,options){
    await ready;
    const history=/^\/players\/(\d+)\/match-history\?only_stored_history=true$/.exec(path);
    if(history){
      const id=String(BigInt(history[1])>=76561197960265728n?
        BigInt(history[1])-76561197960265728n:BigInt(history[1]));
      const record=manifest?.accounts[id];
      if(record?.checkedAt){
        try{return await file(record.file);}
        catch(e){status('Saved history unavailable; trying API: '+e.message);}
      }
    }
    return originalRequest(path,options);
  };
  coordinator.metadata=async function(ids,options,controls){
    await ready;
    if(!manifest)return originalMetadata(ids,options,controls);
    const unique=[...new Set(ids.map(String))];
    const names=[...new Set(unique.map(id=>manifest.matches[id]).filter(Boolean))];
    const settled=await Promise.allSettled(names.map(file));
    const available=new Map();
    settled.forEach((result,i)=>{
      if(result.status==='fulfilled')for(const row of result.value)available.set(String(row.match_id),row);
      else status('Snapshot chunk unavailable: '+names[i]+'; saved coverage incomplete');
    });
    // Full-roster scoring projection is safe to reuse for placement,
    // match info, and account-ID-only roster requests. Filtered detail/stage
    // projections are different shapes.
    const scoring=options?.only_filtered_players==='false'&&options?.include_player_death_details==='true';
    const infoOnly=options?.include_player_info==='false'&&options?.include_info==='true';
    const rosterOnly=options?.only_filtered_players==='false'&&options?.include_player_info==='true'&&options?.include_info==='false';
    const saved=(scoring||infoOnly||rosterOnly)?unique.map(id=>available.get(id)).filter(Boolean):[];
    const savedIds=new Set(saved.map(row=>String(row.match_id)));
    const missing=unique.filter(id=>!savedIds.has(id));
    if(!missing.length)return saved;
    // Browser requests reuse the coordinator's pacing and IndexedDB cache.
    // The scheduled updater, not the static site, writes shared SQLite.
    return saved.concat(await originalMetadata(missing,options,controls));
  };
  return {ready,placements,get manifest(){return manifest;}};
}
root.BreadlockSnapshot={install};
if(typeof module==='object'&&module.exports)module.exports={install};
})(typeof window!=='undefined'?window:globalThis);
