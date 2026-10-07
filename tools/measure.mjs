// 迷宮と坑道が何日目に、どのくらいのレベルの一行に踏破されるかを、乱数の種ごとに測る。釣り合いを調べるための道具
//
//   node tools/measure.mjs                 種8個、それぞれ1200日まで回す
//   node tools/measure.mjs --seeds 4 --days 1500
// 店主は何もしない（借金は毎月の返済だけで返す）。種ごとに別のスレッドで回す
import {readFileSync} from 'node:fs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';

const args=process.argv.slice(2);
const opt=(k,d)=>{const i=args.indexOf(k);return i>=0?Number(args[i+1]):d;};
const DAYS=opt('--days',1200),SEEDS=Array.from({length:opt('--seeds',8)},(_,i)=>1000+i*7919),JOBS=Math.max(1,opt('--jobs',availableParallelism()));
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ENGINE=html.match(/\/\*ENGINE START\*\/([\s\S]*?)\/\*ENGINE END\*\//)[1];

function run(seed){
  let s=seed>>>0;const M=Object.create(Math);M.random=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const E=new Function('Math',`${ENGINE};return {newState,tick,rivalTemple,TICKS_PER_DAY,MINE_N};`)(M);
  const S=E.newState();const D=E.TICKS_PER_DAY;for(let i=0;i<6;i++)E.tick(S);
  const lv=names=>names.map(n=>(Object.values(S.adv).find(a=>a.name===n)||{}).lvl).join(',');
  const out={seed,fights:0};const marks=[];const fought=new Set();
  for(let d=1;d<=DAYS;d++){for(let i=0;i<D;i++){E.tick(S);E.rivalTemple(S);
      // 坑道王との戦いを数え、戦いが始まったときの一行のレベルを残す（坑道王はレベルを吸うので、勝ったあとのレベルは下がっている）
      for(const p of Object.values(S.parties))if(p.enemies&&p.etype&&p.etype.mboss){if(!p.bossKey){p.bossKey=S.tick;out.fights++;out.pre=out.pre||{};out.pre[p.name]=p.members.map(id=>S.adv[id].lvl).join(',');}}else if(p.bossKey)p.bossKey=0;}
    const md=S.mineDeep||{ours:0,rival:0};if(out.open&&!out.bottom&&Math.max(md.ours,md.rival)>=E.MINE_N)out.bottom=d-out.open;
    if(S.conquered&&!out.conq)out.conq=`${Math.floor(S.conquered.tk/D)}日目 ${S.conquered.tav==='ours'?'黒猫亭':'銀の杯亭'} Lv${lv(S.conquered.names)}`;
    if(S.mine&&S.mine.open!=null&&!out.open)out.open=Math.floor(S.mine.open/D);
    if(S.mineConq&&!out.mconq){out.mconq=`${Math.floor(S.mineConq.tk/D)}日目（開いてから${Math.floor(S.mineConq.tk/D)-out.open}日） ${S.mineConq.tav==='ours'?'黒猫亭':'銀の杯亭'} 戦う前のLv${(out.pre||{})[S.mineConq.party]||lv(S.mineConq.names)}`;break;}
    if(out.open&&d%50===0){const md=S.mineDeep||{ours:0,rival:0};const top=Object.values(S.adv).filter(a=>a.status!=='lost'&&a.status!=='retired').map(a=>a.lvl).sort((x,y)=>y-x).slice(0,6);
      marks.push(`${d}日目 坑道最深 黒${md.ours}/銀${md.rival} 上位Lv${top.join(',')}`);}}
  return [`種${seed}：迷宮踏破 ${out.conq||'なし'}／坑道が開く ${out.open!=null?out.open+'日目':'なし'}／底に着く ${out.bottom!=null?'開いてから'+out.bottom+'日':'なし'}・坑道王と${out.fights}戦／坑道踏破 ${out.mconq||'なし'}`,...marks.map(m=>'  '+m)].join('\n');
}
if(!isMainThread)parentPort.postMessage(run(workerData.seed));
else{const out=[];let next=0;
  const one=()=>{if(next>=SEEDS.length)return Promise.resolve();const k=next++;return new Promise(ok=>{const w=new Worker(new URL(import.meta.url),{workerData:{seed:SEEDS[k]},argv:args});
    w.once('message',m=>{out[k]=m;});w.once('error',e=>{out[k]=`種${SEEDS[k]}：エラー ${e.stack}`;});w.once('exit',ok);}).then(one);};
  await Promise.all(Array.from({length:Math.min(JOBS,SEEDS.length)},one));console.log(out.join('\n'));}
