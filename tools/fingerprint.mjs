// 釣り合いの指紋。決まった種と日数で支援なしと支援ありの両方を回し、種ごとの結果（借金完済・踏破の日と店とレベル・全滅の回数・死因など）を
// tools/fingerprint.json に残す。CI は同じものを回して比べ、結果が変わったのに指紋を直していない変更を止める。
//
//   node tools/fingerprint.mjs --check     回して tools/fingerprint.json と比べる。違えば、どの種の何が変わったかを出して終了コード1
//   node tools/fingerprint.mjs --update    回して tools/fingerprint.json を書き直す（釣り合いを変えたと分かっているとき）
//   node tools/fingerprint.mjs --jobs 2    同時に回す数（ふだんは CPU の数）
//   node tools/fingerprint.mjs --shard 3/8 --out part.json   32本を8つに分けた3つめだけを回し、結果を part.json に書く（CI で並べて回す）
//   node tools/fingerprint.mjs --check --from DIR   回さずに、DIR にある --out の結果をすべて合わせて比べる（--update でも使える）
//
// 回すのは tools/measure.mjs と同じ中身（measure の1種ぶんを別のスレッドで回す）。種は measure と同じ並びの先頭 SEEDS 個、日数は DAYS 日。
// どちらの指紋でも、死因の偏り（下の SKEW）を確かめる。偏りすぎていれば、--update でも終了コード1にする（書き直しはする）。
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {availableParallelism} from 'node:os';

const SEEDS=Array.from({length:16},(_,i)=>1000+i*7919),DAYS=1400,MODES=['none','support'];
const MODE_N={none:'支援なし',support:'支援あり'};
const FILE=fileURLToPath(new URL('./fingerprint.json',import.meta.url));
const MEASURE=new URL('./measure.mjs',import.meta.url);
const ROOT=fileURLToPath(new URL('..',import.meta.url));

// 死因の偏り：measure の帯ごとに、16種を合わせて、魔物に倒された人数のうち、いちばん多い魔物が占める割合の上限。
// 宝箱のわな（「宝箱の○○」）は魔物とは別の死因なので、分子にも分母にも入れない（指紋の死因の記録には残す）。
// 魔物に倒された人数が MIN に満たない帯は見ない。60% は #193 で PM が決めた（docs/principles.md 6）
const SKEW={max:0.6,min:100};
const isTrap=n=>String(n).startsWith('宝箱の');

const args=process.argv.slice(2);
const val=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const CHECK=args.includes('--check'),UPDATE=args.includes('--update'),SHARD=val('--shard'),OUT=val('--out'),FROM=val('--from');
if(SHARD!=null?(CHECK||UPDATE||!OUT):CHECK===UPDATE){console.error('--check か --update のどちらか、または --shard k/n --out FILE を渡す');process.exit(2);}
const ji=args.indexOf('--jobs');
const JOBS=Math.max(1,Math.floor(Number(ji>=0?args[ji+1]:availableParallelism()))||1);

const html=readFileSync(ROOT+'index.html','utf8');
const engine=html.match(/\/\*ENGINE START\*\/([\s\S]*?)\/\*ENGINE END\*\//)[1];

const TAV={ours:'黒猫亭',rival:'銀の杯亭'};
const top=(o,n)=>Object.entries(o||{}).sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1)).slice(0,n);
// measure の1種ぶん（run）を、measure.mjs を別のスレッドとして回して受け取る。--shard のときは、k 番目から n 本おきだけを回す
const ALL=MODES.flatMap(mode=>SEEDS.map(seed=>({mode,seed})));
let jobs=ALL;
if(SHARD!=null){const m=/^(\d+)\/(\d+)$/.exec(SHARD),k=m?+m[1]:0,n=m?+m[2]:0;
  if(!(n>=1&&k>=1&&k<=n)){console.error('--shard は k/n（1≦k≦n）で渡す');process.exit(2);}
  jobs=ALL.filter((_,i)=>i%n===k-1);}
const t0=Date.now();
let out;
if(FROM){// --from：分けて回した結果を合わせる。どの本も、ちょうど1つずつそろっていなければ止める
  const parts=readdirSync(FROM).filter(f=>f.endsWith('.json')).flatMap(f=>JSON.parse(readFileSync(join(FROM,f),'utf8')));
  const key=j=>`${j.mode}:${j.seed}`,got=new Map();for(const r of parts){if(got.has(key(r))){console.error(`${key(r)} が二つある`);process.exit(1);}got.set(key(r),r);}
  const lack=ALL.filter(j=>!got.has(key(j)));if(lack.length){console.error(`結果がない：${lack.map(key).join('、')}`);process.exit(1);}
  out=ALL.map(j=>got.get(key(j)));
}else{
  out=new Array(jobs.length);let next=0;
  const one=()=>{if(next>=jobs.length)return Promise.resolve();const k=next++,j=jobs[k];
    return new Promise(ok=>{const w=new Worker(MEASURE,{workerData:{seed:j.seed,mode:j.mode,engine},argv:['--days',String(DAYS)]});
      w.once('message',m=>{out[k]=m;});w.once('error',e=>{out[k]={err:e.stack};});w.once('exit',ok);}).then(one);};
  await Promise.all(Array.from({length:Math.min(JOBS,jobs.length)},one));
  const errs=out.map((r,k)=>r&&r.err?`${MODE_N[jobs[k].mode]} 種${jobs[k].seed}：エラー ${r.err}`:!r?`${MODE_N[jobs[k].mode]} 種${jobs[k].seed}：結果がない`:null).filter(Boolean);
  if(errs.length){console.error(errs.join('\n'));process.exit(1);}
  // 比べるのに使う分だけに絞る（1本ぶんの指紋と、帯ごとの死因と、階を問わない死因）
  out=out.map((r,k)=>({mode:jobs[k].mode,seed:r.seed,print:print(r),bands:r.bands,causes:r.causes}));
}
if(SHARD!=null){writeFileSync(OUT,JSON.stringify(out));console.log(`${jobs.length}本を ${((Date.now()-t0)/1000).toFixed(0)}秒で回し、${OUT} に書いた`);process.exit(0);}

// 1種ぶんの指紋。キーの並びはここで決まる
function print(r){
  return {
    debtFree:r.debtFree??null,
    firstPay:!r.firstPay?null:r.firstPay.ok?'無事':`罰金（${r.firstPay.short}G不足）`,
    payPenalties:r.payPen||0,
    maze:r.conq?{day:r.conq.d,tav:TAV[r.conq.tav],lv:r.conq.lv}:null,
    mineOpen:r.open??null,
    mineBottom:r.bottom??null,
    kingFights:r.fights||0,
    mine:r.mconq?{day:r.mconq.d,tav:TAV[r.mconq.tav],lv:r.mconq.lv}:null,
    wipes:{ours:{maze:r.wipes.oursMaze||0,mine:r.wipes.oursMine||0},rival:{maze:r.wipes.rivalMaze||0,mine:r.wipes.rivalMine||0}},
    deaths:r.deathN,
    topCauses:top(r.causes,3).map(([n,c])=>`${n} ${c}`),
    rep:{ours:r.rep.ours,rival:r.rep.rival},
    earned:r.earned,
  };
}
// 帯ごとに、魔物に倒された人数と、いちばん多い魔物とその割合（16種の合計）。宝箱のわなは数えない
function skewOf(rs){
  const o={};
  for(const r of rs)for(const [band,b] of Object.entries(r.bands||{})){
    const t=o[band]||(o[band]={n:0,by:{}});for(const [m,c] of Object.entries(b.deaths)){if(isTrap(m))continue;t.n+=c;t.by[m]=(t.by[m]||0)+c;}}
  const all={n:0,by:{}};for(const r of rs)for(const [m,c] of Object.entries(r.causes||{})){if(isTrap(m))continue;all.n+=c;all.by[m]=(all.by[m]||0)+c;}
  const row=t=>{const [m,c]=top(t.by,1)[0]||['-',0];return {deaths:t.n,top:m,share:t.n?Math.round(1000*c/t.n)/1000:0};};
  return {...Object.fromEntries(Object.entries(o).map(([k,t])=>[k,row(t)])),'全体':row(all)};
}

const now={days:DAYS,seeds:SEEDS};
for(const mode of MODES){const rs=out.filter(r=>r.mode===mode);
  now[mode]={seeds:Object.fromEntries(rs.map(r=>[String(r.seed),r.print])),deathSkew:skewOf(rs)};}

// 書き出し。種ごとの指紋を1行にして、差分で変わった種が分かるようにする
function render(fp){
  const L=['{',`  "days": ${fp.days},`,`  "seeds": ${JSON.stringify(fp.seeds)},`];
  MODES.forEach((mode,i)=>{const m=fp[mode];
    L.push(`  "${mode}": {`,'    "seeds": {');
    const ks=Object.keys(m.seeds);ks.forEach((s,j)=>L.push(`      "${s}": ${JSON.stringify(m.seeds[s])}${j<ks.length-1?',':''}`));
    L.push('    },','    "deathSkew": {');
    const bs=Object.keys(m.deathSkew);bs.forEach((b,j)=>L.push(`      ${JSON.stringify(b)}: ${JSON.stringify(m.deathSkew[b])}${j<bs.length-1?',':''}`));
    L.push('    }',`  }${i<MODES.length-1?',':''}`);});
  L.push('}');return L.join('\n')+'\n';
}

// 死因の偏りの確かめ
const skewBad=[];
for(const mode of MODES)for(const [band,s] of Object.entries(now[mode].deathSkew)){
  const ok=s.deaths<SKEW.min||s.share<=SKEW.max;
  console.log(`${MODE_N[mode]} ${band}：魔物に倒された ${s.deaths}人、いちばん多い魔物 ${s.top} ${(s.share*100).toFixed(1)}%${s.deaths<SKEW.min?'（少ないので見ない）':ok?'':` ← 上限 ${SKEW.max*100}% を超える`}`);
  if(!ok)skewBad.push(`${MODE_N[mode]} ${band}`);}
console.log(FROM?`（${FROM} の ${out.length}本の結果を合わせた）`:`（${jobs.length}本を ${((Date.now()-t0)/1000).toFixed(0)}秒で回した）`);
if(skewBad.length)console.log(`\n死因が偏りすぎている：${skewBad.join('、')}。上限は tools/fingerprint.mjs の SKEW`);

const text=render(now);
if(UPDATE){writeFileSync(FILE,text);console.log(`\n${FILE} を書き直した`);process.exit(skewBad.length?1:0);}

// 比べる。違う所を「支援なし 種1000 maze.day：354 → 360」の形で出す
let old;try{old=JSON.parse(readFileSync(FILE,'utf8'));}catch(e){console.log(`\n${FILE} を読めない（${e.message}）。node tools/fingerprint.mjs --update で作る`);process.exit(1);}
const diffs=[];
function walk(a,b,path){
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
    for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],[...path,k]);return;}
  if(JSON.stringify(a)!==JSON.stringify(b))diffs.push(`${path.map(p=>MODE_N[p]||(/^\d+$/.test(p)?'種'+p:p)).join(' ').replace(/ seeds /,' ')}：${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}
walk(old,JSON.parse(text),[]);
if(diffs.length){
  console.log(`\n釣り合いの指紋が変わった（${diffs.length}か所。左が tools/fingerprint.json、右が今の結果）`);
  for(const d of diffs.slice(0,80))console.log('  '+d);
  if(diffs.length>80)console.log(`  ……ほか${diffs.length-80}か所`);
  console.log('\n釣り合いを変えるつもりなら、node tools/measure.mjs --seeds 16 --days 1400 --base origin/main で測って PR に書き、\nnode tools/fingerprint.mjs --update で指紋を書き直して、同じ変更に入れる。変えるつもりがなければ、変更のどこかが結果を動かしている。');
  process.exit(1);
}
console.log('\n釣り合いの指紋は tools/fingerprint.json と同じ');
process.exit(skewBad.length?1:0);
