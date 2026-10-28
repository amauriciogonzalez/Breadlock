/* Shared browser-side API scheduler and cache. No framework or build step required. */
(function(root){
'use strict';
const API='https://api.deadlock-api.com/v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class DataCoordinator{
  constructor({fetchImpl=root.fetch?.bind(root),now=Date.now,delay=sleep,spacingMs=2500}={}){
    this.fetchImpl=fetchImpl;this.now=now;this.delay=delay;this.spacingMs=spacingMs;
    // Separate lanes keep slow bulk responses from blocking player histories.
    // Keep a margin below the documented 30/minute metadata IP limit.
    this.queues={metadata:[],other:[]};this.active={metadata:0,other:0};
    this.wake={metadata:null,other:null};this.nextStart={metadata:0,other:0};
    this.blockedUntil={metadata:0,other:0};
    this.pending=new Map();this.memory=new Map();this.database=null;this.writes=0;
    this.onStatus=()=>{};
  }
  async db(){
    if(!root.indexedDB)return null;
    if(!this.database)this.database=new Promise(resolve=>{
      try{
        const open=root.indexedDB.open('breadlock-data-v1',1);
        open.onupgradeneeded=()=>open.result.createObjectStore('responses');
        open.onsuccess=()=>resolve(open.result);
        open.onerror=()=>resolve(null);
      }catch(e){resolve(null);}
    });
    return this.database;
  }
  async get(key){
    if(this.memory.has(key))return this.memory.get(key);
    const db=await this.db();if(!db)return null;
    return new Promise(resolve=>{
      try{
        const request=db.transaction('responses').objectStore('responses').get(key);
        request.onsuccess=()=>{const value=request.result||null;if(value){this.memory.set(key,value);if(this.memory.size>700)this.memory.delete(this.memory.keys().next().value);}resolve(value);};
        request.onerror=()=>resolve(null);
      }catch(e){resolve(null);}
    });
  }
  async getMany(keys){
    const results=new Map(),uncached=keys.filter(key=>{
      if(!this.memory.has(key))return true;
      results.set(key,this.memory.get(key));return false;
    });
    if(!uncached.length)return results;
    const db=await this.db();if(!db)return results;
    await new Promise(resolve=>{
      try{
        const store=db.transaction('responses').objectStore('responses');
        let remaining=uncached.length;
        for(const key of uncached){
          const request=store.get(key);
          request.onsuccess=()=>{
            if(request.result){results.set(key,request.result);this.memory.set(key,request.result);}
            if(!--remaining)resolve();
          };
          request.onerror=()=>{if(!--remaining)resolve();};
        }
      }catch(e){resolve();}
    });
    while(this.memory.size>700)this.memory.delete(this.memory.keys().next().value);
    return results;
  }
  async put(key,value){
    try{
      // Large time-series rows are useful in flight, but should not exhaust
      // browser memory or storage for visitors with many match histories.
      if(JSON.stringify(value.data).length>180000)return;
      this.memory.delete(key);this.memory.set(key,value);
      if(this.memory.size>700)this.memory.delete(this.memory.keys().next().value);
      const db=await this.db();if(!db)return;
      const tx=db.transaction('responses','readwrite');tx.objectStore('responses').put(value,key);
      if(++this.writes%50===0)this.prune(db);
    }catch(e){} // Cache failure must never break a successful network request.
  }
  prune(db){
    try{
      const tx=db.transaction('responses','readwrite'),store=tx.objectStore('responses');
      const entries=[];store.openCursor().onsuccess=e=>{
        const cursor=e.target.result;
        if(cursor){entries.push({key:cursor.key,time:cursor.value.time});cursor.continue();}
        else{
          const compact=[],other=[];
          for(const x of entries)(String(x.key).startsWith('match:')&&
            String(x.key).includes('only_filtered_players=true')&&
            String(x.key).includes('extra_player_columns=')?compact:other).push(x);
          for(const [group,limit] of [[compact,2500],[other,700]])if(group.length>limit){
            group.sort((a,b)=>a.time-b.time);
            group.slice(0,group.length-limit).forEach(x=>store.delete(x.key));
          }
        }
      };
    }catch(e){}
  }
  async cached(key,ttl,request,{staleOnError=false}={}){
    const old=await this.get(key);
    if(old&&this.now()-old.time<ttl)return old.data;
    if(this.pending.has(key))return this.pending.get(key);
    const promise=(async()=>{
      try{const data=await request();await this.put(key,{data,time:this.now()});return data;}
      catch(e){
        if(old&&staleOnError){this.onStatus('Using saved data from '+new Date(old.time).toLocaleString()+' after '+e.message);return old.data;}
        throw e;
      }
    })();
    this.pending.set(key,promise);
    try{return await promise;}finally{this.pending.delete(key);}
  }
  schedule(path,{priority=1,signal}={}){
    return new Promise((resolve,reject)=>{
      const lane=path.startsWith('/matches/metadata?')?'metadata':'other';
      this.enqueue(lane,{path,priority,signal,resolve,reject,attempt:0});
    });
  }
  enqueue(lane,job){
    this.queues[lane].push(job);
    this.queues[lane].sort((a,b)=>a.priority-b.priority);
    this.pump(lane);
  }
  pump(lane){
    const limit=lane==='metadata'?2:3;
    while(this.active[lane]<limit&&this.queues[lane].length){
      const wait=Math.max(0,this.blockedUntil[lane]-this.now(),this.nextStart[lane]-this.now());
      if(wait){
        if(!this.wake[lane])this.wake[lane]=this.delay(wait).then(()=>{
          this.wake[lane]=null;this.pump(lane);
        });
        return;
      }
      const job=this.queues[lane].shift();
      if(job.signal?.aborted){job.reject(new DOMException('Aborted','AbortError'));continue;}
      this.nextStart[lane]=this.now()+(lane==='metadata'?this.spacingMs:350);
      this.active[lane]++;
      this.execute(lane,job).finally(()=>{
        this.active[lane]--;this.pump(lane);this.pump(lane==='metadata'?'other':'metadata');
      });
    }
  }
  async execute(lane,job){
    try{
      const response=await this.fetchImpl(API+job.path,{headers:{Accept:'application/json'},signal:job.signal});
      if(!response.ok){
        const error=new Error('HTTP '+response.status);error.status=response.status;
        const retry=response.headers?.get('Retry-After');
        const seconds=Number(retry);
        error.retryMs=retry&&Number.isFinite(seconds)?Math.max(0,seconds*1000):
          retry?Math.max(0,Date.parse(retry)-this.now())||0:0;
        throw error;
      }
      const data=await response.json();
      this.onStatus('',true);job.resolve(data);
    }catch(e){
      if(!job.signal?.aborted&&e.name!=='AbortError'&&job.attempt<2&&
        (e.status===429||e.status>=500||e instanceof TypeError)){
        const backoff=Math.max(e.retryMs||0,(e.status===429?15000:5000)*2**job.attempt++);
        if(e.status===429||e.status>=500)
          this.blockedUntil[lane]=Math.max(this.blockedUntil[lane],this.now()+backoff);
        const endpoint=job.path.split('?')[0];
        const reason=e.status===429?'rate-limited':e.status?'HTTP '+e.status:'network/response error';
        this.onStatus('API '+reason+' at '+endpoint+'; retrying in '+Math.ceil(backoff/1000)+'s',true);
        // Do not occupy a network slot while waiting; visible work may pass it.
        this.delay(backoff).then(()=>this.enqueue(lane,job));
      }else job.reject(e);
    }
  }
  request(path,{ttl=0,priority=1,staleOnError=false,signal}={}){
    const run=()=>this.schedule(path,{priority,signal});
    return ttl?this.cached('request:'+path,ttl,run,{staleOnError}):run();
  }
  async metadata(ids,options,{priority=1,signal}={}){
    const unique=[...new Set(ids.map(String))];if(!unique.length)return [];
    // Serialize only planning; network requests continue concurrently in the queue.
    const previous=this.metadataLock||Promise.resolve();
    let release;this.metadataLock=new Promise(resolve=>{release=resolve;});
    await previous;
    let rows;
    try{
    // Cache by match and response shape, not by batch URL or player. Identical
    // in-flight matches are fetched only once, even for overlapping players.
    const params=new URLSearchParams(options);params.delete('match_ids');params.delete('limit');params.sort();
    const shape=params.toString(),ttl=24*60*60*1000;
    rows=new Map();const missing=[],stale=new Map();
    const keys=unique.map(id=>'match:'+shape+':'+id);
    const saved=await this.getMany(keys);
    for(const id of unique){
      const key='match:'+shape+':'+id,old=saved.get(key);
      if(old&&this.now()-old.time<ttl)rows.set(id,old.data);
      else if(this.pending.has(key))rows.set(id,this.pending.get(key));
      else {missing.push(id);if(old)stale.set(id,old);}
    }
    // Register all promises before the first network request: other callers can
    // attach to individual matches regardless of how their batches overlap.
    if(missing.length){
      const q=new URLSearchParams(options);q.set('match_ids',missing.join(','));q.set('limit',String(missing.length));
      const batch=this.schedule('/matches/metadata?'+q,{priority,signal});
      const parsed=batch.then(data=>{
        if(!Array.isArray(data))throw Error('Invalid bulk match response');
        return new Map(data.map(row=>[String(row.match_id),row]));
      });
      for(const id of missing){
        const key='match:'+shape+':'+id;
        const item=parsed.then(async found=>{
          const row=found.get(id);
          if(row)void this.put(key,{data:row,time:this.now()});
          return row||null;
        }).catch(e=>{
          if(!stale.has(id))throw e;
          this.onStatus('Using saved match data from '+new Date(stale.get(id).time).toLocaleString()+' after '+e.message);
          return stale.get(id).data;
        });
        this.pending.set(key,item);
        item.finally(()=>{if(this.pending.get(key)===item)this.pending.delete(key);}).catch(()=>{});
        rows.set(id,item);
      }
    }
    }finally{release();}
    const result=await Promise.all(unique.map(id=>rows.get(id)));
    return result.filter(Boolean);
  }
}
root.BreadlockData=new DataCoordinator();
if(typeof module!=='undefined'&&module.exports)module.exports=DataCoordinator;
})(typeof window!=='undefined'?window:globalThis);
