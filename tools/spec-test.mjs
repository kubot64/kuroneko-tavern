// docs/spec.md に書かれた決まりを「いつでも成り立つはずの性質」として、ゲームの中身を回しながら確かめる。
// ブラウザは使わない。index.html の /*ENGINE START*/〜/*ENGINE END*/ を取り出して node で動かす。
//
//   node tools/spec-test.mjs                 乱数の種を48個、それぞれ30000刻（600日）回す
//   node tools/spec-test.mjs --seeds 40 --ticks 10000
//   node tools/spec-test.mjs --seed 12345    その種だけを回す（不合格の再現に使う）
//   node tools/spec-test.mjs --jobs 2        同時に回す数（ふだんは CPU のコア数）
// 種ごとに別のスレッドで回すので、コアが多いほど早く終わる。
import {readFileSync} from 'node:fs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';

const args=process.argv.slice(2);
const opt=(k,d)=>{const i=args.indexOf(k);return i>=0?Number(args[i+1]):d;};
const TICKS=opt('--ticks',30000);
const SEEDS=args.includes('--seed')?[opt('--seed',1)]:Array.from({length:opt('--seeds',48)},(_,i)=>1000+i*7919);
const JOBS=Math.max(1,opt('--jobs',availableParallelism()));

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ENGINE=html.match(/\/\*ENGINE START\*\/([\s\S]*?)\/\*ENGINE END\*\//)[1];
const EXPORTS=['newState','tick','rivalTemple','seatCap','seatsUsed','nextSeats','newcomerLvl','buyPrice','investPrice','FACILITIES',
  'RARES','MAXF','DRAGON_F','TICKS_PER_DAY','smallOf','debtTick','DEBT0','encounter','rareSlain','rareMonOf'];

// 乱数の種を固定したゲームの中身を1つ作る。中身の Math.random だけを差し替える
function load(seed,fixed){
  let s=seed>>>0;const rnd=fixed?()=>fixed:()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const M=Object.create(Math);M.random=rnd;
  return new Function('Math',`${ENGINE};return {${EXPORTS.join(',')}};`)(M);
}

const results=new Map();// 性質の名前 → 最初の反例（なければ null）
const fail=(name,where,detail)=>{if(!results.get(name))results.set(name,`${where}：${detail}`);};
const pass=name=>{if(!results.has(name))results.set(name,null);};
const check=(name,ok,where,detail)=>{pass(name);if(!ok)fail(name,where,typeof detail==='function'?detail():detail);};

const live=a=>a.status!=='lost'&&a.status!=='retired';
const num=x=>typeof x==='number'&&Number.isFinite(x);

// ---- 決まった値の表（仕様の表と、コードの値が一致すること） ----
function checkTables(){
  const E=load(1),S=E.newState();
  // 「席と拡張」の表
  const steps=[];S.taverns.ours.seats=12;for(let ns;(ns=E.nextSeats(S));){steps.push(ns.join('→'));S.taverns.ours.seats=ns[1];}
  check('席と拡張：拡張の段と費用が表のとおり',steps.join(' ')==='12→18→5000 18→24→15000 24→30→40000 30→36→100000','表',steps.join(' '));
  // 「名のある魔物」：B1〜B30Fに1体ずつ、どれにも説明がある
  const fl=E.RARES.map(r=>r.f).sort((a,b)=>a-b).join(',');
  check('名のある魔物：B1〜30Fに1体ずつ',fl===Array.from({length:E.MAXF},(_,i)=>i+1).join(','),'RARES',fl);
  for(const r of E.RARES)check('名のある魔物：どれにも説明がある',typeof r.lore==='string'&&r.lore.length>0,`B${r.f}F`,r.n);
  // 「大きな使い道」：店の設備の費用
  check('大きな使い道：設備の費用が表のとおり',E.FACILITIES.map(f=>f[1]+f[2]).join(' ')==='修練場300000 情報屋500000 療養所800000','表',E.FACILITIES.map(f=>f[1]+f[2]).join(' '));
  // 「借金と返済」：最初の借金と所持金
  check('借金と返済：80000Gの借金と400Gで始まる',S.taverns.ours.debt===80000&&S.taverns.ours.gold===400,'開店',`借金${S.taverns.ours.debt} 所持金${S.taverns.ours.gold}`);
  // 「借金と返済」：返済日には利息2%を足し、4000G＋利息を払う。足りれば借金は4000G減る
  {const T0=S.taverns.ours;T0.gold=999999;T0.debt=50000;T0.nextPay=S.tick;const d0=T0.debt,g0=T0.gold;E.debtTick(S);
    check('借金と返済：返済日に4000G＋利息2%を払う',T0.debt===d0-4000&&g0-T0.gold===4000+Math.round(d0*.02),'返済日',`借金${d0}→${T0.debt} 支払い${g0-T0.gold}`);}
  // 「借金と返済」：足りないと、不足の25%が罰金として足され、評判が3下がる（0未満にはならない）
  {const T0=S.taverns.ours;T0.gold=1000;T0.debt=50000;T0.rep=2;T0.nextPay=S.tick;const due=4000+Math.round(50000*.02);E.debtTick(S);
    check('借金と返済：足りないと罰金25%、評判は0未満にならない',T0.debt===50000+Math.round(50000*.02)-1000+Math.round((due-1000)*.25)&&T0.rep===0,'返済日',`借金${T0.debt} 評判${T0.rep}`);}
  // 「裏通りの酒場」：買収の値段は景気で0.5〜2倍、支店を持つたびに1.3倍。出資は同じ店に重ねるたびに1.5倍
  {const t={score:0};const base=E.buyPrice(S,t);const mul=sc=>E.buyPrice(S,{score:sc})/base;
    check('裏通りの酒場：買収の値段は景気で0.5〜2倍',[-3,-1,0,1,3].map(mul).join(',')==='0.5,0.8,1,1.5,2','景気ごと',[-3,-1,0,1,3].map(mul).join(','));
    check('裏通りの酒場：買収の基準は30万G',base===300000,'支店なし',base);
    // 浅い階では額が小さく、100G単位の丸めで比がずれるので、B30Fまで届いたときの額で比べる
    const d0=S.deepest.ours;S.deepest.ours=30;const i0=E.investPrice(S,{invest:0}),i1=E.investPrice(S,{invest:1});S.deepest.ours=d0;
    check('裏通りの酒場：出資は重ねるたびに1.5倍',Math.abs(i1/i0-1.5)<.01,'出資',`${i0}→${i1}`);}
}

// ---- わざと作った場面で確かめる性質 ----
function checkScenes(){
  // 「名のある魔物」：各階に1体きり。ある一行が戦っているあいだは、同じ階の別の一行の前には現れない
  // 乱数をいつも0にして、出会えるときは必ず出会うようにする
  const meet=fighting=>{const E=load(1,1e-9),S=E.newState();const [p,q]=Object.values(S.parties);
    p.floor=q.floor=23;p.enemies=q.enemies=null;p.etype=q.etype=null;
    if(fighting){q.etype=E.rareMonOf(23);q.enemies=[{hp:q.etype.hp,sleep:0}];}
    E.encounter(S,p);return !!(p.etype&&p.etype.rare);};
  check('名のある魔物：誰も戦っていなければ、出会える（下の確かめが空振りでない）',meet(false),'B23F・ほかの一行は戦っていない','出会えなかった');
  check('名のある魔物：ほかの一行が戦っているあいだは、別の一行の前に現れない',!meet(true),'B23F・ほかの一行が戦っている','別の一行の前にも現れた');
  // 「名のある魔物」「伝説の品」：2つの一行が続けて討っても、褒美と記録は最初の一行の1回きり
  {const E=load(1),S=E.newState();const [p,q]=Object.values(S.parties);const t=E.rareMonOf(23);const it=E.RARES.find(r=>r.f===23).item.n;
    E.rareSlain(S,p,t);E.rareSlain(S,q,t);
    const n=Object.values(S.adv).filter(a=>Object.values(a.eq||{}).some(x=>x&&x.n===it)).length;
    check('名のある魔物：続けて2回討たれても、褒美と記録は最初の1回きり',n<=1&&S.rares[23].killed.party===p.name,'B23F・2つの一行が続けて討つ',`${it}を持つ者${n}人・記録は${S.rares[23].killed.party}`);}
}

// ---- 何百日も回しながら、毎刻成り立つはずの性質 ----
function runSeed(seed){
  const E=load(seed),S=E.newState();
  for(let i=0;i<6;i++)E.tick(S);// 画面側の開店と同じ
  const prevState={},killed={},lore={};let conquered=null;
  for(let i=0;i<TICKS;i++){
    E.tick(S);E.rivalTemple(S);// 画面側の step と同じく、銀の杯亭の蘇生も毎刻呼ぶ
    const at=`種${seed}・${S.tick}刻（${Math.floor(S.tick/E.TICKS_PER_DAY)+1}日目）`;
    const advs=Object.values(S.adv),parties=Object.values(S.parties),T0=S.taverns.ours;

    // 「席と拡張」：寺院や行方不明の者も含め、常連の数は席の数を超えない
    check('席と拡張：常連の数は席の数を超えない',E.seatsUsed(S,'ours')<=E.seatCap(S,'ours'),at,()=>`${E.seatsUsed(S,'ours')}人 / ${E.seatCap(S,'ours')}席`);
    // 「身内探し」：身内の遺体を担いでいる一行は、すぐ帰路につく
    for(const p of parties)if((p.rescue||[]).length)check('身内探し：身内の遺体を担いだ一行は帰路にある',p.state==='return',at,()=>`${p.name} ${p.state}`);
    // 「新顔の来店」：名前はほかの冒険者と重ならない
    {const seen=new Map();let dup=null;for(const a of advs){if(seen.has(a.name))dup=a.name;seen.set(a.name,1);}check('新顔の来店：冒険者の名前は重ならない',!dup,at,dup);}
    // 「一行の結成」：一行の名前は重ならない
    {const ns=parties.map(p=>p.name);check('一行の結成：一行の名前は重ならない',new Set(ns).size===ns.length,at,ns.join('、'));}
    for(const p of parties){
      // 「一行の結成」：人数は基本6人、最大6人
      if(p.state!=='wiped')check('一行の結成：潜っている一行は6人まで',p.members.length<=6,at,()=>`${p.name} ${p.members.length}人`);
      // 「一行の結成」「街での休みと再出発」：潜りはじめる一行は3人以上
      if(prevState[p.id]!==p.state&&(prevState[p.id]==null||prevState[p.id]==='town')&&p.state==='explore')
        check('一行の結成：潜りはじめる一行は3人以上',p.members.length>=3,at,()=>`${p.name} ${p.members.length}人`);
      // 「全滅」：遺体が街に着くまで、行方不明の仲間を残して別の仲間で潜らない
      if(p.state==='explore'||p.state==='return')
        check('全滅：行方不明の仲間を残して潜らない',!advs.some(a=>a.party===p.id&&a.status==='missing'),at,()=>p.name);
      // 「全滅」：20日（1000刻）誰にも見つけられなければロストする。運ばれている途中は数えない
      if(p.state==='wiped'&&!p.retrieved)check('全滅：見つからない一行は1000刻でロストする',S.tick-p.wipedAt<=1001,at,()=>`${p.name} 全滅から${S.tick-p.wipedAt}刻`);
      // 「黒竜」：黒竜を一度も倒していなければ、B29Fより下には降りられない
      if(p.state!=='wiped'&&p.state!=='town')check('黒竜：倒すまではB29Fより下に降りられない',p.floor<=E.DRAGON_F||(S.dragon&&S.dragon.kills>0),at,()=>`${p.name} B${p.floor}F`);
      prevState[p.id]=p.state;
    }
    // 数値が壊れていない（NaN や無限大にならない）
    check('お金と体力が数として壊れない',num(T0.gold)&&num(T0.rep)&&num(T0.debt)&&advs.every(a=>num(a.gold)&&num(a.hp)&&num(a.xp)&&Number.isInteger(a.lvl)&&a.lvl>=1),at,
      ()=>`所持金${T0.gold} 評判${T0.rep} 借金${T0.debt} ${(advs.find(a=>!(num(a.gold)&&num(a.hp)&&num(a.xp)))||{}).name||''}`);
    // 「借金と返済」：借金は負にならず、評判は0より下にならない
    check('借金と返済：借金は負にならない',T0.debt>=0,at,T0.debt);
    check('評判：0より下にならない',T0.rep>=0,at,T0.rep);
    // 「沈んだ王」：踏破は一度きりで、記録が書き換わらない
    if(S.conquered){if(!conquered)conquered=JSON.stringify({tk:S.conquered.tk,tav:S.conquered.tav,party:S.conquered.party});
      check('沈んだ王：踏破は一度きり',conquered===JSON.stringify({tk:S.conquered.tk,tav:S.conquered.tav,party:S.conquered.party}),at,S.conquered.party);}
    // 「名のある魔物」：一度討たれた魔物の記録は書き換わらない（再び討たれない）
    for(const [f,r] of Object.entries(S.rares||{}))if(r.killed){const k=JSON.stringify(r.killed);if(!killed[f])killed[f]=k;check('名のある魔物：一度討たれたら再び討たれない',killed[f]===k,at,`B${f}F`);}
    // 「記録の断片」：それぞれ見つかるのは一度きり
    for(const [i,r] of Object.entries(S.loreFound||{})){const k=JSON.stringify(r);if(!lore[i])lore[i]=k;check('記録の断片：見つかるのは一度きり',lore[i]===k,at,`断片${i}`);}
    // 「名のある魔物」「アイテムと装備」：伝説の品は世界にひとつずつ（いま生きている冒険者の装備の中で重ならない）
    {const own=new Map();let dup=null;for(const a of advs)if(live(a))for(const it of Object.values(a.eq||{}))if(it&&(it.rare||it.named)){if(own.has(it.n))dup=`${it.n}（${own.get(it.n)}と${a.name}）`;own.set(it.n,a.name);}
      check('伝説の品：世界にひとつずつ',!dup,at,dup);}
    // 「夢」：一度叶えた種類の夢は二度と持たない
    for(const a of advs){const ks=(a.pastDreams||[]).map(d=>d.k);
      check('夢：同じ種類の夢を二度叶えない',new Set(ks).size===ks.length,at,()=>`${a.name}：${ks.join(',')}`);
      if(a.dream)check('夢：叶えた種類の夢を再び持たない',!ks.includes(a.dream.k),at,()=>`${a.name}：${a.dream.k}`);}
    // 「お触れ」：同じ種類は重ならない。蘇生代の値上げと半額も重ならない
    {const act=(S.edicts||[]).filter(e=>e.until>S.tick).map(e=>e.k);
      check('お触れ：同じ種類は重ならない',new Set(act).size===act.length,at,act.join(','));
      check('お触れ：蘇生代の値上げと半額は重ならない',!(act.includes('templeUp')&&act.includes('templeDown')),at,act.join(','));}
    // 「裏通りの酒場」：多くて6軒
    check('裏通りの酒場：多くて6軒',E.smallOf(S).length<=6,at,E.smallOf(S).length);
  }
  // 「新顔の来店」：評判を聞いて来る新顔は、常連の平均レベルの前後3以内（0は、これまでどおりの散らばりで来る印）
  {const rs=Object.values(S.adv).filter(a=>a.tav==='ours'&&live(a));const avg=Math.round(rs.reduce((s,a)=>s+a.lvl,0)/rs.length);
    for(let k=0;k<500;k++){const l=E.newcomerLvl(S,'ours');check('新顔の来店：評判を聞いて来る者は平均レベル±3',l===0||(l>=Math.max(1,avg-3)&&l<=avg+3),`種${seed}・終わり`,`平均${avg}に対して${l}`);}}
  return `種${seed}：${TICKS}刻を回した（最深 黒猫亭B${S.deepest.ours}F・銀の杯亭B${S.deepest.rival}F）`;
}

if(!isMainThread){const line=runSeed(workerData.seed);parentPort.postMessage({line,res:[...results]});}
else{
  checkTables();checkScenes();
  // 種ごとの結果は、種の順に重ねる。反例は、いちばん若い種の最初のものを残す
  const out=new Array(SEEDS.length);let next=0;
  const runOne=()=>{if(next>=SEEDS.length)return Promise.resolve();const k=next++;
    return new Promise((ok,ng)=>{const w=new Worker(new URL(import.meta.url),{workerData:{seed:SEEDS[k]},argv:args});
      w.once('message',m=>{out[k]=m;console.log(m.line);});
      // ゲームの中身が例外を投げたら、その種は「エラーで止まった」として不合格にする
      w.once('error',e=>{out[k]={res:[['ゲームがエラーで止まらない',`種${SEEDS[k]}：${e&&e.stack?e.stack.split('\n').slice(0,3).join(' / '):e}`]]};console.log(`種${SEEDS[k]}：エラーで止まった`);});
      w.once('exit',()=>ok());}).then(runOne);};
  await Promise.all(Array.from({length:Math.min(JOBS,SEEDS.length)},runOne));
  pass('ゲームがエラーで止まらない');
  for(const m of out)for(const [name,f] of m.res){pass(name);if(f&&!results.get(name))results.set(name,f);}
  report();
}
function report(){
let bad=0;
for(const [name,f] of results){if(f){bad++;console.log(`× ${name}\n    反例 ${f}`);}else console.log(`○ ${name}`);}
console.log(`\n種${SEEDS.length}個×${TICKS}刻。${results.size}件のうち、合格${results.size-bad}件・不合格${bad}件`);
process.exit(bad?1:0);
}
