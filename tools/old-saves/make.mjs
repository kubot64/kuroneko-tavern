// 古いセーブの見本を作る。版ごとに、その版で最後のコミットの index.html を git から取り出し、
// 決まった種で店を開いて DAYS 日回し、localStorage に入る形（{S,at,pend}）を gzip して vNN.json.gz に書く。
// 見本は一度作ってリポジトリに入れておくもので、ふだんは作り直さない。新しい版を足したときに、その版の分だけを足す。
//
//   node tools/old-saves/make.mjs        表のすべての版を作る
//   node tools/old-saves/make.mjs 31     その版だけを作る
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {engineOf,loadEngine} from '../engine.mjs';

// 版 → その版で最後のコミット。リポジトリの履歴は版24から始まるので、それより古い版の見本は作れない
const COMMITS={24:'5bbab35',25:'4e40e0f',26:'1f1cbc8',27:'4055fc6',28:'9550d66',29:'2134a24',30:'0d534ea',31:'414464b',32:'8a1f458',33:'3f5d986',34:'5a03295'};
const SEED=4242,DAYS=300,AT=Date.UTC(2026,9,1);

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
function make(v){
  const html=execFileSync('git',['show',`${COMMITS[v]}:index.html`],{cwd:ROOT,encoding:'utf8',maxBuffer:1<<26});
  let s=SEED>>>0;const M=Object.create(Math);M.random=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const E=loadEngine(engineOf(html),{Math:M});
  // 画面と同じ順に進める（店を開いて6刻、そのあとは1刻ごとに tick と rivalTemple）
  const S=E.newState();for(let i=0;i<6;i++)E.tick(S);
  for(let i=0;i<DAYS*E.TICKS_PER_DAY;i++){E.tick(S);E.rivalTemple(S);}
  if(S.v!==v)throw new Error(`${COMMITS[v]} の版は ${S.v}（${v} のはず）`);
  const out=fileURLToPath(new URL(`./v${v}.json.gz`,import.meta.url));
  writeFileSync(out,gzipSync(JSON.stringify({S,at:AT,pend:0}),{level:9}));
  console.log(`版${v}（${COMMITS[v]}）：${S.tick}刻、冒険者${Object.keys(S.adv).length}人 → ${out}`);
}
const want=process.argv.slice(2).map(Number);
for(const v of want.length?want:Object.keys(COMMITS).map(Number))make(v);
