// 迷宮と坑道が何日目に、どちらの店の、どのくらいのレベルの一行に踏破されるかを、乱数の種ごとに測る。釣り合いを調べるための道具
//
//   node tools/measure.mjs                          種8個、それぞれ1200日まで。支援なしと支援ありの両方を測る
//   node tools/measure.mjs --seeds 16 --days 1400
//   node tools/measure.mjs --mode none              支援なしだけ（店主は何もしない。借金は毎月の返済だけで返す）
//   node tools/measure.mjs --mode support           支援ありだけ（下の supportOwner の店主）
//   node tools/measure.mjs --detail                 種ごとの経過（50日ごとの坑道の最深と上位のレベル）も出す
//   node tools/measure.mjs --base origin/main       変更前（origin/main の index.html）も同じ種で測り、変更後と並べる
//   node tools/measure.mjs --fresh                  残してある結果を使わずに測り直す
// 種ごとに別のスレッドで回す。大きな変更をしたら、支援なしと支援ありの両方で測り、PR に結果を書く。最後に PR に貼れる表を出す
// 結果は種ごとに .cache/measure/ に残す。エンジン・この道具・種・日数・Node の版がどれも同じなら、測り直さずにそれを使う
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {engineOf,loadEngine} from './engine.mjs';

const args=process.argv.slice(2);
const opt=(k,d)=>{const i=args.indexOf(k);return i>=0?args[i+1]:d;};
const DAYS=Number(opt('--days',1200)),SEEDS=Array.from({length:Number(opt('--seeds',8))},(_,i)=>1000+i*7919),JOBS=Math.max(1,Number(opt('--jobs',availableParallelism())));
const MODES=opt('--mode','both')==='both'?['none','support']:[opt('--mode')];
const DETAIL=args.includes('--detail'),BASE=opt('--base',null),FRESH=args.includes('--fresh');
const MODE_N={none:'支援なし',support:'支援あり'};
const ROOT=fileURLToPath(new URL('..',import.meta.url)),CACHE=ROOT+'.cache/measure/';

// 次の返済額に足す余裕。返済日の直前に新人へ支度の品を渡しても、返済額を割らないための分
const PAY_MARGIN=2000;
// 返済日の何日前から、蘇生・地図・薬の店負担を止めるか。
// 3日（帳場に「返済」が付く頃）では、店負担で減った所持金が返済額まで戻らない。
// 16種では22日前から止めると、初回の返済に足りる。24日前から止めると、店の売り上げが育たず、また足りない種が出る。
const PAY_PAUSE_DAYS=22;

// 支援ありの店主。毎日1度、帳場と武具屋でできる支援を、手元に蓄えを残しながら使う。
// 引き抜き・裏通りの酒場・持ち込まれる話・見込みは使わない（常連を支える支援だけを測る）
// 借金が残っているあいだは、次の返済額に余裕を足した分を残す。返済日が近づけば、蘇生・地図・薬の店負担を止める。
function supportOwner(E,S,day){
  const T0=S.taverns.ours,pol=E.policy(S);
  const due=E.nextDue?E.nextDue(S):null;
  const pause=!!(due&&due.days<=PAY_PAUSE_DAYS);
  Object.assign(pol,{potion:pause?0:3,mapPay:!pause,revive:!pause,rookie:true});
  const keep=T0.debt>0?(due?due.due+PAY_MARGIN:6000):3000;const spare=()=>T0.gold-keep;
  if(T0.debt>0){E.repay(S,Math.max(0,spare()));return;}
  const ns=E.nextSeats(S);if(ns&&spare()>=ns[2]){T0.gold-=ns[2];T0.seats=ns[1];}
  for(const [k] of E.FACILITIES){const t=E.nextFac(S,k);if(t&&spare()>=t[1])E.buildFac(S,k);}
  if((S.blessUntil||0)<=S.tick&&spare()>=E.donatePrice(S)*2)E.donate(S);
  // 贈り物と特注は、強い順に1日3人まで
  const idle=Object.values(S.adv).filter(a=>a.tav==='ours'&&a.status==='idle').sort((x,y)=>y.lvl-x.lvl);let n=0;
  for(const a of idle){if(n>=3)break;const c=E.customOffer(S,a);if(c&&spare()>=c.price){E.orderCustom(S,a,c);n++;continue;}
    const o=E.giftOffer(S,a);if(o&&spare()>=o.price){E.giveGift(S,a,o,'店主から');n++;}}
}

// 死因を数えるためだけに、倒れた瞬間を受け取る。乱数は引かない。手帳は90件で消えるので、終わってから数えると足りない
function instrument(engine){
  const from='function dieInDungeon(S,p,a,by){';
  if(!engine.includes(from))throw new Error('計測：dieInDungeon が見つからない');
  let e=engine.replace(from,'function dieInDungeon(S,p,a,by){if(__meas)__meas(p.floor,by);');
  // 看板を継ぐかどうかも、決まった瞬間に受け取る。この仕組みのない古いエンジンでは数えない
  const iw='function inheritWill(S,a,old,p){';
  if(e.includes(iw))e=e.replace(iw,'function inheritWill(S,a,old,p){const __r=__iw0(S,a,old,p);if(__heir)__heir(p&&p.tav,a.pers,__r);return __r;}\nfunction __iw0(S,a,old,p){');
  return e;
}
const BANDS=[['坑道B8〜15F',f=>f>=38&&f<=45],['迷宮B11〜15F',f=>f>=11&&f<=15],['迷宮B16〜22F',f=>f>=16&&f<=22]];
const VPRE=['澱にまみれた','群れの長の','手負いの','年老いた','飢えた','凶暴な','巨大な','若い'];
function monBase(n){let s=String(n||'');for(const p of VPRE)if(s.startsWith(p))return s.slice(p.length);return s;}
function emptyBands(){return Object.fromEntries(BANDS.map(([k])=>[k,{fights:{},deaths:{},fightN:0,deathN:0}]));}
function bandOf(f){for(const [k,ok] of BANDS)if(ok(f))return k;return null;}
function noteBandFights(S,fighting,bands){
  for(const p of Object.values(S.parties)){
    const on=!!(p.enemies&&p.etype);
    if(on&&!fighting.get(p)){const b=bandOf(p.floor);if(b){const n=monBase(p.etype.base||p.etype.n);const o=bands[b];o.fightN++;o.fights[n]=(o.fights[n]||0)+1;}}
    fighting.set(p,on);
  }
}
// 一行が全滅した回数を、店と探索先（迷宮か坑道か）ごとに数える。一行の様子が全滅に変わった刻を見る（乱数は引かない）
function noteWipes(S,wst,w,maxf){
  for(const p of Object.values(S.parties)){
    const on=p.state==='wiped';
    if(on&&!wst.get(p)){const k=(p.tav==='rival'?'rival':'ours')+(p.floor>maxf?'Mine':'Maze');w[k]=(w[k]||0)+1;}
    wst.set(p,on);
  }
}
// 倒れた相手を、階を問わず数える（変異の肩書きは外す）
function deathCauses(deaths){const c={};for(const [,by] of deaths){const n=monBase(by);c[n]=(c[n]||0)+1;}return c;}
function noteBandDeaths(deaths,bands){
  for(const [floor,by] of deaths){const b=bandOf(floor);if(!b)continue;const o=bands[b];o.deathN++;const n=monBase(by);o.deaths[n]=(o.deaths[n]||0)+1;}
}

function run(seed,mode,engine){
  let s=seed>>>0;const M=Object.create(Math);M.random=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const deaths=[],heirs={};
  // --base で測る前のエンジンには、まだない関数もある。ないものは undefined になる
  const E=loadEngine(instrument(engine),{Math:M,__meas:(floor,by)=>deaths.push([floor,by]),__heir:(tav,pers,ok)=>{const k=pers||'?';const o=heirs[k]||(heirs[k]={ok:0,no:0,ours:0,oursNo:0});if(ok)o.ok++;else o.no++;if(tav==='ours'){o.ours++;if(!ok)o.oursNo++;}}});
  // 水晶のログは測るのに使わないので残さない（乱数の引き方は変わらない）
  if(E.setQuietLog)E.setQuietLog(true);
  const S=E.newState();const D=E.TICKS_PER_DAY;for(let i=0;i<6;i++)E.tick(S);
  const lv=names=>names.map(n=>(Object.values(S.adv).find(a=>a.name===n)||{}).lvl).join(',');
  const r={seed,mode,fights:0,pre:{},fac:{},payN:0,payPen:0};const marks=[];
  const seen=new Set(),visit=emptyVisit(),fighting=new WeakMap(),bands=emptyBands(),wst=new WeakMap();r.wipes={};noteArrivals(S,seen,visit);
  for(let d=1;d<=DAYS;d++){
    if(mode==='support')supportOwner(E,S,d);
    for(let i=0;i<D;i++){E.tick(S);E.rivalTemple(S);
      // 坑道王との戦いを数え、戦いが始まったときの一行のレベルを残す（坑道王はレベルを吸うので、勝ったあとのレベルは下がっている）
      for(const p of Object.values(S.parties))if(p.enemies&&p.etype&&p.etype.mboss){if(!p.bossKey){p.bossKey=S.tick;r.fights++;r.pre[p.name]=p.members.map(id=>S.adv[id].lvl).join(',');}}else if(p.bossKey)p.bossKey=0;
      noteBandFights(S,fighting,bands);noteWipes(S,wst,r.wipes,E.MAXF);}
    notePays(S,r,d);
    const md=S.mineDeep||{ours:0,rival:0};
    for(const [k,ts] of E.FACILITIES)ts.forEach((t,i)=>{if(((S.fac||{})[k]||0)>i&&r.fac[t[0]]==null)r.fac[t[0]]=d;});
    if(S.conquered&&!r.conq)r.conq={d:Math.floor(S.conquered.tk/D),tav:S.conquered.tav,lv:lv(S.conquered.names)};
    if(S.mine&&S.mine.open!=null&&r.open==null)r.open=Math.floor(S.mine.open/D);
    if(r.open!=null&&r.bottom==null&&Math.max(md.ours,md.rival)>=E.MINE_N)r.bottom=d-r.open;
    if(S.taverns.ours.debtFree!=null&&r.debtFree==null)r.debtFree=Math.floor(S.taverns.ours.debtFree/D);
    if(S.mineConq&&!r.mconq){r.mconq={d:Math.floor(S.mineConq.tk/D),tav:S.mineConq.tav,lv:r.pre[S.mineConq.party]||lv(S.mineConq.names)};break;}
    if(r.open!=null&&d%50===0){const top=Object.values(S.adv).filter(a=>a.status!=='lost'&&a.status!=='retired').map(a=>a.lvl).sort((x,y)=>y-x).slice(0,6);
      marks.push(`  ${d}日目 坑道最深 黒${md.ours}/銀${md.rival} 上位Lv${top.join(',')}`);}
    noteArrivals(S,seen,visit);}
  r.deep={maze:{...S.deepest},mine:{...(S.mineDeep||{ours:0,rival:0})}};r.rep={ours:S.taverns.ours.rep,rival:S.taverns.rival.rep};r.support=S.taverns.ours.support||0;
  noteArrivals(S,seen,visit);r.visit=visit;
  const aged=(S.farewells||[]).filter(f=>f.why&&f.why.includes('老いを感じ'));
  r.ageRet={ours:aged.filter(f=>f.tav==='ours').length,rival:aged.filter(f=>f.tav==='rival').length};
  r.dreams=dreamCounts(S);
  noteBandDeaths(deaths,bands);r.bands=bands;r.deathN=deaths.length;r.causes=deathCauses(deaths);
  r.earned=S.taverns.ours.earned||0;
  r.deaths=noteDeaths(S);
  r.heirs=heirs;
  r.marks=marks;return r;
}
// 手帳の「に倒れる」を数える。羽根で持ちこたえた行（「倒れるが」）は死んでいないので数えない
function noteDeaths(S){
  const d={ours:{n:0,chest:0},rival:{n:0,chest:0}};
  for(const a of Object.values(S.adv)){
    const tav=a.tav==='rival'?'rival':'ours';
    for(const c of a.chron||[]){
      const t=c&&c.t||'';
      if(!t.includes('に倒れる')||t.includes('に倒れるが'))continue;
      d[tav].n++;if(t.includes('宝箱'))d[tav].chest++;
    }
  }
  return d;
}

// 来店時の年齢。手帳の最初の一文に残っている年齢を読む（年を越して歳をとったあとも、来たときの年齢が分かる）
const AGE_OLD={'人間':31,'ホビット':41,'ドワーフ':91,'エルフ':181};
const AGE_BUCKETS=['〜19','20〜24','25〜30','31〜39','40〜49','50〜54','55〜'];
const AGE_LVLS=['1〜10','11〜16','17〜'];
const DREAM_AGE=[['sendhome','仕送り'],['prove','見返す（20歳未満）'],['letters','手紙（26歳未満）'],['marry','所帯'],['mentor','育てる（33歳以上）'],['pension','余生（40歳以上）'],['lastdive','老いた体（42歳以上）']];
function ageBucket(h){return h<=19?'〜19':h<=24?'20〜24':h<=30?'25〜30':h<=39?'31〜39':h<=49?'40〜49':h<=54?'50〜54':'55〜';}
function emptyVisit(){return {n:0,old:0,miss:0,bucket:Object.fromEntries(AGE_BUCKETS.map(k=>[k,0])),lvl:Object.fromEntries(AGE_LVLS.map(k=>[k,{n:0,old:0}]))};}
function noteArrivals(S,seen,visit){
  for(const a of Object.values(S.adv)){
    if(seen.has(a.id))continue;
    const t=(a.chron||[]).map(c=>c&&c.t).find(x=>x&&x.includes('扉をくぐる'));
    if(!t)continue;
    seen.add(a.id);
    if(t.includes('救い出された'))continue;
    const m=t.match(/(?:人間でいえば(\d+)歳ほど（実年齢(\d+)歳）|(\d+)歳)、(?:女の)?(人間|ホビット|ドワーフ|エルフ)の[^（]*（レベル(\d+)）として/);
    if(!m){visit.miss++;continue;}
    const hage=m[1]?+m[1]:+m[3],age=m[2]?+m[2]:+m[3],race=m[4],lvl=+m[5];
    const old=age>=(AGE_OLD[race]||31);
    visit.n++;if(old)visit.old++;
    visit.bucket[ageBucket(hage)]++;
    const lb=lvl<=10?'1〜10':lvl<=16?'11〜16':'17〜';
    visit.lvl[lb].n++;if(old)visit.lvl[lb].old++;
  }
}
function dreamCounts(S){
  const c=Object.fromEntries(DREAM_AGE.map(([k])=>[k,0]));
  for(const a of Object.values(S.adv)){
    const held=new Set((a.pastDreams||[]).map(d=>d&&d.k).filter(Boolean));
    if(a.dream&&a.dream.k)held.add(a.dream.k);
    for(const k of held)if(c[k]!=null)c[k]++;
  }
  return c;
}
const TN=t=>t==='ours'?'黒猫亭':'銀の杯亭';
function line(r){
  const c=r.conq?`${r.conq.d}日目 ${TN(r.conq.tav)} Lv${r.conq.lv}`:'なし';
  const m=r.mconq?`${r.mconq.d}日目（開いてから${r.mconq.d-r.open}日） ${TN(r.mconq.tav)} 戦う前のLv${r.mconq.lv}`:'なし';
  const fp=!r.firstPay?'なし':r.firstPay.ok?'無事':`罰金（${r.firstPay.short}G不足）`;
  return `種${r.seed}：借金完済 ${r.debtFree!=null?r.debtFree+'日目':'なし'}／初回返済 ${fp}／迷宮踏破 ${c}／坑道が開く ${r.open!=null?r.open+'日目':'なし'}／底に着く ${r.bottom!=null?'開いてから'+r.bottom+'日':'なし'}・坑道王と${r.fights}戦／坑道踏破 ${m}`;
}
// その日までの知らせから、返済が足りたか足りなかったかを数える。知らせは300件で消えるので、日ごとに見る
function notePays(S,r,d){
  for(const n of S.news||[]){
    if(!n||n.payNoted)continue;
    const t=n.t||'';
    const late=t.startsWith('今月の返済に'),ok=t.startsWith('セーレの両替商に、今月の返済');
    if(!late&&!ok)continue;
    n.payNoted=1;r.payN++;
    if(late){r.payPen++;
      const short=+(t.match(/(\d+)G足りなかった/)||[0,0])[1],pen=+(t.match(/罰金(\d+)G/)||[0,0])[1];
      if(!r.firstPay)r.firstPay={ok:false,short,pen,d};}
    else if(!r.firstPay)r.firstPay={ok:true,d};
  }
}
function firstPen(rs){
  const bad=rs.filter(r=>r.firstPay&&!r.firstPay.ok);
  return {bad:bad.length,n:rs.length,max:bad.reduce((m,r)=>Math.max(m,r.firstPay.short||0),0),later:rs.reduce((s,r)=>s+(r.payPen||0),0)-bad.length};
}
function summary(rs){
  const n=rs.length,cnt=(f)=>rs.filter(f).length,med=a=>{if(!a.length)return '-';a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)/2)];};
  const mz=rs.filter(r=>r.conq),mn=rs.filter(r=>r.mconq),fs=[...new Set(rs.flatMap(r=>Object.keys(r.fac)))];
  return [
    `迷宮を踏破した店：黒猫亭 ${cnt(r=>r.conq&&r.conq.tav==='ours')}／銀の杯亭 ${cnt(r=>r.conq&&r.conq.tav==='rival')}／なし ${n-mz.length}（${n}種）。踏破日の中央値 ${med(mz.map(r=>r.conq.d))}日目`,
    `坑道を踏破した店：黒猫亭 ${cnt(r=>r.mconq&&r.mconq.tav==='ours')}／銀の杯亭 ${cnt(r=>r.mconq&&r.mconq.tav==='rival')}／なし ${n-mn.length}。開いてから踏破までの中央値 ${med(mn.map(r=>r.mconq.d-r.open))}日`,
    ...(fs.length?[`設備を建てた日の中央値：${fs.map(n=>{const ds=rs.filter(r=>r.fac[n]!=null).map(r=>r.fac[n]);return `${n} ${med(ds)}日目（${ds.length}種）`;}).join('／')}`]:[]),
    `借金完済の中央値 ${med(rs.filter(r=>r.debtFree!=null).map(r=>r.debtFree))}日目（完済なし ${cnt(r=>r.debtFree==null)}種）。最後の評判の中央値 黒猫亭${med(rs.map(r=>r.rep.ours))}／銀の杯亭${med(rs.map(r=>r.rep.rival))}`,
    `初回の返済で罰金 ${((p)=>`${p.bad}/${p.n}${p.bad?`（最大で${p.max}G足りない）`:''}。そのあとの返済で罰金 ${p.later}回`)(firstPen(rs))}`,
    deathLine(rs),
  ].join('\n');
}
function deathLine(rs){
  const med=a=>{if(!a.length)return '-';a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)/2)];};
  const sum=(tav,k)=>rs.reduce((s,r)=>s+(((r.deaths||{})[tav]||{})[k]||0),0);
  return `倒れた回数：黒猫亭 ${sum('ours','n')}（宝箱 ${sum('ours','chest')}）／銀の杯亭 ${sum('rival','n')}（宝箱 ${sum('rival','chest')}）。黒猫亭の売上の中央値 ${med(rs.map(r=>r.earned||0))}G`;
}
function deathMarkdown(rows){
  const med=a=>{if(!a.length)return '-';a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)/2)];};
  const sum=(rs,tav,k)=>rs.reduce((s,r)=>s+(((r.deaths||{})[tav]||{})[k]||0),0);
  const head='| | '+rows.map(([n])=>n).join(' | ')+' |';
  const sep='|---|'+rows.map(()=>'---:|').join('');
  const row=(label,fn)=>'| '+label+' | '+rows.map(([,rs])=>fn(rs)).join(' | ')+' |';
  return ['倒れた回数（手帳。羽根で持ちこたえた分は除く）と、黒猫亭の売上',head,sep,
    row('黒猫亭が倒れた回数',rs=>String(sum(rs,'ours','n'))),
    row('うち宝箱',rs=>String(sum(rs,'ours','chest'))),
    row('銀の杯亭が倒れた回数',rs=>String(sum(rs,'rival','n'))),
    row('うち宝箱',rs=>String(sum(rs,'rival','chest'))),
    row('黒猫亭の売上の中央値',rs=>med(rs.map(r=>r.earned||0))+'G')].join('\n');
}

// PR に貼る表。行は、支援なし・支援ありと、--base のときは変更前・変更後
function table(rows){
  const med=a=>{if(!a.length)return '-';a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)/2)];};
  const won=(rs,f)=>{const o=rs.filter(r=>f(r)&&f(r).tav==='ours').length,v=rs.filter(r=>f(r)&&f(r).tav==='rival').length,no=rs.length-o-v;return `${o}／${v}${no?`（なし${no}）`:''}`;};
  return ['| | 迷宮を踏破した店（黒猫亭／銀の杯亭） | 迷宮の踏破日の中央値 | 坑道を踏破した店（黒猫亭／銀の杯亭） | 坑道が開いてから踏破までの中央値 | 借金完済の中央値 | 初回返済の罰金 |','|---|---|---|---|---|---|---|',
    ...rows.map(([name,rs])=>{const nd=rs.filter(r=>r.debtFree==null).length,p=firstPen(rs);
      return `| ${name} | ${won(rs,r=>r.conq)} | ${med(rs.filter(r=>r.conq).map(r=>r.conq.d))}日目 | ${won(rs,r=>r.mconq)} | ${med(rs.filter(r=>r.mconq).map(r=>r.mconq.d-r.open))}日 | ${med(rs.filter(r=>r.debtFree!=null).map(r=>r.debtFree))}日目${nd?`（完済なし${nd}種）`:''} | ${p.bad}/${p.n}${p.bad?`（最大${p.max}G不足）`:''} |`;})].join('\n');
}
function sumAge(rs){
  const a={n:0,old:0,miss:0,bucket:Object.fromEntries(AGE_BUCKETS.map(k=>[k,0])),lvl:Object.fromEntries(AGE_LVLS.map(k=>[k,{n:0,old:0}])),ret:{ours:0,rival:0},dreams:Object.fromEntries(DREAM_AGE.map(([k])=>[k,0]))};
  for(const r of rs){if(!r.visit)continue;
    a.n+=r.visit.n;a.old+=r.visit.old;a.miss+=r.visit.miss||0;
    for(const k of AGE_BUCKETS)a.bucket[k]+=r.visit.bucket[k]||0;
    for(const k of AGE_LVLS){a.lvl[k].n+=r.visit.lvl[k].n;a.lvl[k].old+=r.visit.lvl[k].old;}
    a.ret.ours+=(r.ageRet&&r.ageRet.ours)||0;a.ret.rival+=(r.ageRet&&r.ageRet.rival)||0;
    for(const [k] of DREAM_AGE)a.dreams[k]+=(r.dreams&&r.dreams[k])||0;}
  return a;
}
function ageMarkdown(rows){
  const ag=rows.map(([name,rs])=>[name,sumAge(rs)]);
  if(!ag.some(([,a])=>a.n))return '';
  const pct=(n,d)=>d?`${(100*n/d).toFixed(1)}%`:'-';
  const head='| | '+ag.map(([n])=>n).join(' | ')+' |';
  const sep='|---|'+ag.map(()=>'---:|').join('');
  const row=(label,fn)=>'| '+label+' | '+ag.map(([,a])=>fn(a)).join(' | ')+' |';
  const lines=['来店した冒険者の年齢（人間換算・来店時。救い出された身内は除く。坑道を踏破した種は、その日まで）',head,sep,
    row('来店人数',a=>String(a.n)),
    row('年長枠',a=>`${a.old}（${pct(a.old,a.n)}）`),
    ...AGE_BUCKETS.map(k=>row(k,a=>`${a.bucket[k]}（${pct(a.bucket[k],a.n)}）`)),
    '','来店時レベルごとの年長枠',head,sep,
    ...AGE_LVLS.map(k=>row(k,a=>`${a.lvl[k].old}／${a.lvl[k].n}（${pct(a.lvl[k].old,a.lvl[k].n)}）`)),
    '','老いによる引退（合計）',head,sep,
    row('黒猫亭',a=>String(a.ret.ours)),row('銀の杯亭',a=>String(a.ret.rival)),
    '','年齢で選ばれる夢を持った人数（合計。叶えた分も含む）',head,sep,
    ...DREAM_AGE.map(([k,label])=>row(label,a=>String(a.dreams[k])))];
  if(ag.some(([,a])=>a.miss))lines.push('',`年齢を読めなかった来店：${ag.map(([n,a])=>`${n} ${a.miss}`).join('、')}`);
  return lines.join('\n');
}

// 看板を継いだか継がなかったかを、継ぐ者の性格ごとに数える（黒猫亭と銀の杯亭の合計）
const HEIR_PERS=['無謀','普通','慎重','強欲','臆病'];
function heirMarkdown(rows){
  if(!rows.some(([,rs])=>rs.some(r=>r.heirs&&Object.keys(r.heirs).length)))return '';
  const ag=rows.map(([name,rs])=>{const t={};for(const r of rs)for(const [k,v] of Object.entries(r.heirs||{})){const o=t[k]||(t[k]={ok:0,no:0,ours:0,oursNo:0});o.ok+=v.ok;o.no+=v.no;o.ours+=v.ours||0;o.oursNo+=v.oursNo||0;}return [name,t];});
  const head='| 継ぐ者の性格 | '+ag.map(([n])=>n).join(' | ')+' |',sep='|---|'+ag.map(()=>'---:|').join('');
  const cell=o=>o&&(o.ok+o.no)?`継いだ${o.ok}／継がない${o.no}（${pct(o.no,o.ok+o.no)}）`:'-';
  const tot=t=>Object.values(t).reduce((a,o)=>({ok:a.ok+o.ok,no:a.no+o.no,ours:a.ours+o.ours,oursNo:a.oursNo+o.oursNo}),{ok:0,no:0,ours:0,oursNo:0});
  const pers=[...HEIR_PERS,...new Set(ag.flatMap(([,t])=>Object.keys(t)).filter(k=>!HEIR_PERS.includes(k)))];
  return ['看板を継いだか（跡継ぎの性格ごと。黒猫亭と銀の杯亭の合計。括弧は継がなかった割合）',head,sep,
    ...pers.map(k=>'| '+k+' | '+ag.map(([,t])=>cell(t[k])).join(' | ')+' |'),
    '| 合計 | '+ag.map(([,t])=>cell(tot(t))).join(' | ')+' |',
    '| うち黒猫亭 | '+ag.map(([,t])=>{const o=tot(t);return o.ours?`${o.ours}件のうち継がない${o.oursNo}（${pct(o.oursNo,o.ours)}）`:'-';}).join(' | ')+' |'].join('\n');
}

function sumBands(rs){
  const out={};
  for(const [name] of BANDS){
    const fights={},deaths={};let fightN=0,deathN=0;
    for(const r of rs){const b=(r.bands||{})[name];if(!b)continue;fightN+=b.fightN;deathN+=b.deathN;
      for(const [k,v] of Object.entries(b.fights))fights[k]=(fights[k]||0)+v;
      for(const [k,v] of Object.entries(b.deaths))deaths[k]=(deaths[k]||0)+v;}
    out[name]={fights,deaths,fightN,deathN};
  }
  return out;
}
function pct(n,d){return d?`${Math.round(100*n/d)}%`:'-';}
function bandMarkdown(rows){
  if(!rows.some(([,rs])=>rs.some(r=>r.bands)))return '';
  const ag=rows.map(([name,rs])=>[name,sumBands(rs),rs.reduce((s,r)=>s+(r.deathN||0),0)]);
  const top=(b,k)=>Object.entries(b.deaths).sort((a,c)=>c[1]-a[1]||(b.fights[c[0]]||0)-(b.fights[a[0]]||0)).slice(0,k);
  const lines=['死因の顔ぶれ（変異の肩書きは外す。その帯で倒れた人数に占める割合）','',
    '| | '+BANDS.map(([n])=>n+'の1位').join(' | ')+' | '+BANDS.map(([n])=>n+'の2位').join(' | ')+' | 全体の死 |',
    '|---|'+BANDS.map(()=>'---|').join('')+BANDS.map(()=>'---|').join('')+'---|'];
  for(const [name,b,deathN] of ag){
    const cell=(band,i)=>{const t=top(b[band],2)[i];return t?`${t[0]} ${pct(t[1],b[band].deathN)}`:'-';};
    lines.push('| '+name+' | '+BANDS.map(([n])=>cell(n,0)).join(' | ')+' | '+BANDS.map(([n])=>cell(n,1)).join(' | ')+` | ${deathN} |`);
  }
  for(const [band] of BANDS){
    const mons=[...new Set(ag.flatMap(([,b])=>Object.keys(b[band].deaths)))];
    mons.sort((a,c)=>(ag[0][1][band].deaths[c]||0)-(ag[0][1][band].deaths[a]||0));
    const show=mons.filter(n=>ag.some(([,b])=>(b[band].deaths[n]||0)>=b[band].deathN*.02)).slice(0,10);
    lines.push('',`#### ${band}`,`| 魔物 | `+ag.map(([n])=>`${n} 戦`).join(' | ')+' | '+ag.map(([n])=>`${n} 死`).join(' | ')+' |',
      '|---|'+ag.map(()=>'---:|').join('')+ag.map(()=>'---:|').join(''));
    for(const n of show){
      const fight=ag.map(([,b])=>b[band].fightN?`${pct(b[band].fights[n]||0,b[band].fightN)}`:'-');
      const dead=ag.map(([,b])=>b[band].deathN?`${pct(b[band].deaths[n]||0,b[band].deathN)}（${b[band].fights[n]?((b[band].deaths[n]||0)/(b[band].fights[n])*100).toFixed(1):'-'}/100戦）`:'-');
      lines.push(`| ${n} | ${fight.join(' | ')} | ${dead.join(' | ')} |`);
    }
    lines.push(`| 合計 | `+ag.map(([,b])=>String(b[band].fightN)).join(' | ')+' | '+ag.map(([,b])=>String(b[band].deathN)).join(' | ')+' |');
  }
  return lines.join('\n');
}

if(!isMainThread)parentPort.postMessage(run(workerData.seed,workerData.mode,workerData.engine));
else{
  // 測り方が変われば測り直す。エンジンを読み込む tools/engine.mjs も含める
  const TOOL=readFileSync(fileURLToPath(import.meta.url),'utf8')+readFileSync(new URL('./engine.mjs',import.meta.url),'utf8');
  const vars=[];
  if(BASE){const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',maxBuffer:1<<26,stdio:['ignore','pipe','pipe']});let html,id;
    try{id=git('rev-parse','--short',`${BASE}^{commit}`).trim();html=git('show',`${id}:index.html`);}
    catch(e){console.error(`--base ${BASE}：index.html を取り出せない（${String(e.stderr||e.message).trim()}）`);process.exit(1);}
    vars.push({name:`変更前（${BASE} ${id}）`,row:'変更前',engine:engineOf(html)});}
  vars.push({name:BASE?'変更後':'',row:BASE?'変更後':'',engine:engineOf(readFileSync(ROOT+'index.html','utf8'))});
  const jobs=vars.flatMap(v=>MODES.flatMap(mode=>SEEDS.map(seed=>({v,seed,mode,key:createHash('sha1').update(JSON.stringify([process.version,TOOL,v.engine,seed,mode,DAYS])).digest('hex')}))));
  const out=jobs.map(j=>{if(FRESH)return null;try{return JSON.parse(readFileSync(CACHE+j.key+'.json','utf8'));}catch{return null;}});
  const todo=jobs.map((j,k)=>k).filter(k=>!out[k]);let next=0;
  const one=()=>{if(next>=todo.length)return Promise.resolve();const k=todo[next++],j=jobs[k];return new Promise(ok=>{const w=new Worker(new URL(import.meta.url),{workerData:{seed:j.seed,mode:j.mode,engine:j.v.engine},argv:args});
    w.once('message',m=>{out[k]=m;try{mkdirSync(CACHE,{recursive:true});writeFileSync(CACHE+j.key+'.json',JSON.stringify(m));}catch{}});
    w.once('error',e=>{out[k]={err:`種${j.seed}（${MODE_N[j.mode]}）：エラー ${e.stack}`};});w.once('exit',ok);}).then(one);};
  await Promise.all(Array.from({length:Math.min(JOBS,todo.length)},one));
  let bad=false;const rows=[];
  for(const mode of MODES)for(const v of vars){const rs=out.filter((r,k)=>jobs[k].mode===mode&&jobs[k].v===v);console.log(`\n== ${MODE_N[mode]}${v.name?'・'+v.name:''} ==`);
    for(const r of rs){if(r.err){bad=true;console.log(r.err);continue;}console.log(line(r));if(DETAIL)r.marks.forEach(m=>console.log(m));}
    const ok=rs.filter(r=>!r.err);if(ok.length){console.log('--\n'+summary(ok));rows.push([MODE_N[mode]+(v.row?'・'+v.row:''),ok]);}}
  if(rows.length){console.log('\n'+table(rows));console.log('\n'+bandMarkdown(rows));console.log('\n'+deathMarkdown(rows));const ages=ageMarkdown(rows);if(ages)console.log('\n'+ages);const hs=heirMarkdown(rows);if(hs)console.log('\n'+hs);}
  console.error(`\n${jobs.length}本のうち、測った ${todo.length}本／残してあった結果を使った ${jobs.length-todo.length}本`);
  process.exit(bad?1:0);
}
