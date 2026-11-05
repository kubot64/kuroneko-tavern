// 不具合を直す PR の再現テストが、直す前のコードでは落ちる（red になる）ことを確かめる。
// 直す前の index.html を git から取り出して別の場所に置き、いまのテストをそれに向けて回す。手元の index.html には触らない。
//
//   node tools/red.mjs --test "#302"                 名前に「#302」を含む画面のテストと仕様のテストを、直す前の版で回す
//   node tools/red.mjs --test "#302" --base main     比べる版を選ぶ（ふだんは origin/main との分かれ目）
//   node tools/red.mjs --test "#302" --only browser  画面のテストだけ（--only spec で仕様のテストだけ）
//
// 名前の合うテストが一つ以上あり、そのすべてが直す前の版で落ちれば red で、終了コード0。
// 通ってしまったテストがあれば、その名前を出して終了コード1。合うテストがなければ終了コード2。
// 画面のテストがページの読み込みのタイムアウトで落ちたときは、確かめにならないので終了コード2にする。
// 仕様のテストは種に関係ない確かめだけを回す（--seeds 0）。
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
const opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const PAT=opt('--test'),ONLY=opt('--only');
if(!PAT||(ONLY&&!['browser','spec'].includes(ONLY))){console.error('使い方：node tools/red.mjs --test <テストの名前の一部> [--base <版>] [--only browser|spec]');process.exit(2);}
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

let base=opt('--base');
try{base=base?git('rev-parse','--short',`${base}^{commit}`):git('merge-base','HEAD','origin/main').slice(0,7);}
catch(e){console.error(`比べる版を決められない（${String(e.stderr||e.message).trim()}）。--base で渡す`);process.exit(2);}
const dir=mkdtempSync(join(tmpdir(),'kt-red-')),html=join(dir,'index.html');
writeFileSync(html,git('show',`${base}:index.html`));
const env={...process.env,KT_HTML:html};
const run=(cmd,a)=>spawnSync(cmd,a,{cwd:ROOT,env,encoding:'utf8',maxBuffer:1<<28});

console.log(`直す前の版：${base}（${git('log','-1','--format=%s',base)}）`);
const red=[],green=[],unsure=[];
if(ONLY!=='spec'){
  const r=run(process.execPath,['--test','--test-name-pattern',PAT.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'tools/browser-test.mjs']);
  const out=r.stdout+r.stderr;
  // TAP の各テストの行と、その下の失敗の中身（次のテストの行まで）
  const blocks=out.split(/\n(?=(?:not )?ok \d+ - )/);
  for(const b of blocks){
    const m=/^(not )?ok \d+ - (.+)$/m.exec(b),title=m&&m[2].replace(/\\#/g,'#');if(!m||!title.includes(PAT))continue;
    const name='画面：'+title;
    if(!m[1])green.push(name);else if(/page\.goto: Timeout/.test(b))unsure.push(name+'（読み込みのタイムアウト）');else red.push(name);
  }
}
if(ONLY!=='browser'){
  const r=run(process.execPath,['tools/spec-test.mjs','--seeds','0']);
  const out=r.stdout+r.stderr;
  for(const line of out.split('\n')){
    const m=/^([○×]) (.+)$/.exec(line);if(!m||!m[2].includes(PAT))continue;
    (m[1]==='×'?red:green).push('仕様：'+m[2]);
  }
  // 古い版にない名前を呼んで、確かめの途中で止まったとき
  // どの確かめで止まったかは分からないので、確かめにならなかったものとして扱う
  if(r.status!==0&&!/件のうち/.test(out)){const e=/^\w*Error: .+$/m.exec(out);unsure.push(`仕様：確かめが途中で止まった（${e?e[0]:'終了コード'+r.status}）`);}
}
rmSync(dir,{recursive:true,force:true});

for(const n of red)console.log(`red    ${n}`);
for(const n of green)console.log(`通った ${n}`);
for(const n of unsure)console.log(`不明   ${n}`);
if(green.length){console.log(`\n直す前の版で通ったテストが${green.length}件ある。再現テストになっていない`);process.exit(1);}
if(unsure.length){console.log('\n確かめにならなかったものがある。タイムアウトなら回し直し、途中で止まったなら古い版にない名前をテストが呼んでいないかを見る');process.exit(2);}
if(!red.length){console.log(`\n名前に「${PAT}」を含むテストがない`);process.exit(2);}
console.log(`\n${red.length}件とも、直す前の版で落ちた（red）`);
