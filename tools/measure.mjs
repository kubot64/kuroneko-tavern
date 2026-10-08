// 迷宮と坑道が何日目に、どちらの店の、どのくらいのレベルの一行に踏破されるかを、乱数の種ごとに測る。釣り合いを調べるための道具
//
//   node tools/measure.mjs                          種8個、それぞれ1200日まで。支援なしと支援ありの両方を測る
//   node tools/measure.mjs --seeds 16 --days 1400
//   node tools/measure.mjs --mode none              支援なしだけ（店主は何もしない。借金は毎月の返済だけで返す）
//   node tools/measure.mjs --mode support           支援ありだけ（下の supportOwner の店主）
//   node tools/measure.mjs --detail                 種ごとの経過（50日ごとの坑道の最深と上位のレベル）も出す
// 種ごとに別のスレッドで回す。大きな変更をしたら、支援なしと支援ありの両方で測り、PR に結果を書く
import {readFileSync} from 'node:fs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';

const args=process.argv.slice(2);
const opt=(k,d)=>{const i=args.indexOf(k);return i>=0?args[i+1]:d;};
const DAYS=Number(opt('--days',1200)),SEEDS=Array.from({length:Number(opt('--seeds',8))},(_,i)=>1000+i*7919),JOBS=Math.max(1,Number(opt('--jobs',availableParallelism())));
const MODES=opt('--mode','both')==='both'?['none','support']:[opt('--mode')];
const DETAIL=args.includes('--detail');
const MODE_N={none:'支援なし',support:'支援あり'};
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ENGINE=html.match(/\/\*ENGINE START\*\/([\s\S]*?)\/\*ENGINE END\*\//)[1];
const EXPORTS=['newState','tick','rivalTemple','TICKS_PER_DAY','MINE_N','repay','nextSeats','policy','giftOffer','giveGift','donate','donatePrice',
  'FACILITIES','nextFac','buildFac','customOffer','orderCustom'];

// 支援ありの店主。毎日1度、帳場と武具屋でできる支援を、手元に蓄えを残しながら使う。
// 引き抜き・裏通りの酒場・持ち込まれる話・見込みは使わない（常連を支える支援だけを測る）
function supportOwner(E,S,day){
  const T0=S.taverns.ours,pol=E.policy(S);
  Object.assign(pol,{potion:3,mapPay:true,revive:true,rookie:true});
  const keep=T0.debt>0?6000:3000;const spare=()=>T0.gold-keep;
  if(T0.debt>0){E.repay(S,Math.max(0,spare()));return;}
  const ns=E.nextSeats(S);if(ns&&spare()>=ns[2]){T0.gold-=ns[2];T0.seats=ns[1];}
  for(const [k] of E.FACILITIES){const t=E.nextFac(S,k);if(t&&spare()>=t[1])E.buildFac(S,k);}
  if((S.blessUntil||0)<=S.tick&&spare()>=E.donatePrice(S)*2)E.donate(S);
  // 贈り物と特注は、強い順に1日3人まで
  const idle=Object.values(S.adv).filter(a=>a.tav==='ours'&&a.status==='idle').sort((x,y)=>y.lvl-x.lvl);let n=0;
  for(const a of idle){if(n>=3)break;const c=E.customOffer(S,a);if(c&&spare()>=c.price){E.orderCustom(S,a,c);n++;continue;}
    const o=E.giftOffer(S,a);if(o&&spare()>=o.price){E.giveGift(S,a,o,'店主から');n++;}}
}

function run(seed,mode){
  let s=seed>>>0;const M=Object.create(Math);M.random=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const E=new Function('Math',`${ENGINE};return {${EXPORTS.join(',')}};`)(M);
  const S=E.newState();const D=E.TICKS_PER_DAY;for(let i=0;i<6;i++)E.tick(S);
  const lv=names=>names.map(n=>(Object.values(S.adv).find(a=>a.name===n)||{}).lvl).join(',');
  const r={seed,mode,fights:0,pre:{},fac:{}};const marks=[];
  for(let d=1;d<=DAYS;d++){
    if(mode==='support')supportOwner(E,S,d);
    for(let i=0;i<D;i++){E.tick(S);E.rivalTemple(S);
      // 坑道王との戦いを数え、戦いが始まったときの一行のレベルを残す（坑道王はレベルを吸うので、勝ったあとのレベルは下がっている）
      for(const p of Object.values(S.parties))if(p.enemies&&p.etype&&p.etype.mboss){if(!p.bossKey){p.bossKey=S.tick;r.fights++;r.pre[p.name]=p.members.map(id=>S.adv[id].lvl).join(',');}}else if(p.bossKey)p.bossKey=0;}
    const md=S.mineDeep||{ours:0,rival:0};
    for(const [k,ts] of E.FACILITIES)ts.forEach((t,i)=>{if(((S.fac||{})[k]||0)>i&&r.fac[t[0]]==null)r.fac[t[0]]=d;});
    if(S.conquered&&!r.conq)r.conq={d:Math.floor(S.conquered.tk/D),tav:S.conquered.tav,lv:lv(S.conquered.names)};
    if(S.mine&&S.mine.open!=null&&r.open==null)r.open=Math.floor(S.mine.open/D);
    if(r.open!=null&&r.bottom==null&&Math.max(md.ours,md.rival)>=E.MINE_N)r.bottom=d-r.open;
    if(S.taverns.ours.debtFree!=null&&r.debtFree==null)r.debtFree=Math.floor(S.taverns.ours.debtFree/D);
    if(S.mineConq&&!r.mconq){r.mconq={d:Math.floor(S.mineConq.tk/D),tav:S.mineConq.tav,lv:r.pre[S.mineConq.party]||lv(S.mineConq.names)};break;}
    if(DETAIL&&r.open!=null&&d%50===0){const top=Object.values(S.adv).filter(a=>a.status!=='lost'&&a.status!=='retired').map(a=>a.lvl).sort((x,y)=>y-x).slice(0,6);
      marks.push(`  ${d}日目 坑道最深 黒${md.ours}/銀${md.rival} 上位Lv${top.join(',')}`);}}
  r.deep={maze:{...S.deepest},mine:{...(S.mineDeep||{ours:0,rival:0})}};r.rep={ours:S.taverns.ours.rep,rival:S.taverns.rival.rep};r.support=S.taverns.ours.support||0;
  r.marks=marks;return r;
}

const TN=t=>t==='ours'?'黒猫亭':'銀の杯亭';
function line(r){
  const c=r.conq?`${r.conq.d}日目 ${TN(r.conq.tav)} Lv${r.conq.lv}`:'なし';
  const m=r.mconq?`${r.mconq.d}日目（開いてから${r.mconq.d-r.open}日） ${TN(r.mconq.tav)} 戦う前のLv${r.mconq.lv}`:'なし';
  return `種${r.seed}：借金完済 ${r.debtFree!=null?r.debtFree+'日目':'なし'}／迷宮踏破 ${c}／坑道が開く ${r.open!=null?r.open+'日目':'なし'}／底に着く ${r.bottom!=null?'開いてから'+r.bottom+'日':'なし'}・坑道王と${r.fights}戦／坑道踏破 ${m}`;
}
function summary(rs){
  const n=rs.length,cnt=(f)=>rs.filter(f).length,med=a=>{if(!a.length)return '-';a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)/2)];};
  const mz=rs.filter(r=>r.conq),mn=rs.filter(r=>r.mconq),fs=[...new Set(rs.flatMap(r=>Object.keys(r.fac)))];
  return [
    `迷宮を踏破した店：黒猫亭 ${cnt(r=>r.conq&&r.conq.tav==='ours')}／銀の杯亭 ${cnt(r=>r.conq&&r.conq.tav==='rival')}／なし ${n-mz.length}（${n}種）。踏破日の中央値 ${med(mz.map(r=>r.conq.d))}日目`,
    `坑道を踏破した店：黒猫亭 ${cnt(r=>r.mconq&&r.mconq.tav==='ours')}／銀の杯亭 ${cnt(r=>r.mconq&&r.mconq.tav==='rival')}／なし ${n-mn.length}。開いてから踏破までの中央値 ${med(mn.map(r=>r.mconq.d-r.open))}日`,
    ...(fs.length?[`設備を建てた日の中央値：${fs.map(n=>{const ds=rs.filter(r=>r.fac[n]!=null).map(r=>r.fac[n]);return `${n} ${med(ds)}日目（${ds.length}種）`;}).join('／')}`]:[]),
    `借金完済の中央値 ${med(rs.filter(r=>r.debtFree!=null).map(r=>r.debtFree))}日目（完済なし ${cnt(r=>r.debtFree==null)}種）。最後の評判の中央値 黒猫亭${med(rs.map(r=>r.rep.ours))}／銀の杯亭${med(rs.map(r=>r.rep.rival))}`,
  ].join('\n');
}

if(!isMainThread)parentPort.postMessage(run(workerData.seed,workerData.mode));
else{
  const jobs=MODES.flatMap(mode=>SEEDS.map(seed=>({seed,mode})));const out=[];let next=0;
  const one=()=>{if(next>=jobs.length)return Promise.resolve();const k=next++;return new Promise(ok=>{const w=new Worker(new URL(import.meta.url),{workerData:jobs[k],argv:args});
    w.once('message',m=>{out[k]=m;});w.once('error',e=>{out[k]={err:`種${jobs[k].seed}（${MODE_N[jobs[k].mode]}）：エラー ${e.stack}`};});w.once('exit',ok);}).then(one);};
  await Promise.all(Array.from({length:Math.min(JOBS,jobs.length)},one));
  let bad=false;
  for(const mode of MODES){const rs=out.filter((r,k)=>jobs[k].mode===mode);console.log(`\n== ${MODE_N[mode]} ==`);
    for(const r of rs){if(r.err){bad=true;console.log(r.err);continue;}console.log(line(r));if(DETAIL)r.marks.forEach(m=>console.log(m));}
    const ok=rs.filter(r=>!r.err);if(ok.length)console.log('--\n'+summary(ok));}
  process.exit(bad?1:0);
}
