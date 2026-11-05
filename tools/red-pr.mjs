// CI（pull request）で、不具合を直す PR の再現テストが直す前の版で落ちるかを確かめる。
// PR の本文の「Closes #番号」「Fixes #番号」「Resolves #番号」から Issue を拾い、bug のラベルが付いた Issue ごとに
// `node tools/red.mjs --test "#番号" --base <基のブランチ>` を回す。どれか一つでも red でなければ落とす。
// bug の Issue を閉じない PR では何もせずに通す。
//
//   PR_BODY=… REPO=owner/name BASE_REF=main GITHUB_TOKEN=… node tools/red-pr.mjs
//   BASE=<版> で比べる版を直に渡せる（手元で試すとき）
//
// テストの名前に「（#番号）」を入れておく決まり（README「再現テストが直す前に落ちるか」）を前提にする。
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const {PR_BODY='',REPO,BASE_REF='main',GITHUB_TOKEN}=process.env,BASE=process.env.BASE||`origin/${BASE_REF}`;
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const nums=[...new Set([...PR_BODY.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map(m=>m[1]))];
if(!nums.length){console.log('閉じる Issue が本文にない。確かめない');process.exit(0);}

const bugs=[];
for(const n of nums){
  const r=await fetch(`https://api.github.com/repos/${REPO}/issues/${n}`,{headers:{accept:'application/vnd.github+json',...(GITHUB_TOKEN?{authorization:`Bearer ${GITHUB_TOKEN}`}:{})}});
  if(!r.ok){console.error(`#${n} の Issue を読めない（${r.status}）`);process.exit(1);}
  const issue=await r.json();
  if(issue.pull_request)continue;
  if((issue.labels||[]).some(l=>(l.name||l)==='bug'))bugs.push(n);else console.log(`#${n} は bug のラベルがないので確かめない`);
}
if(!bugs.length){console.log('bug の Issue を閉じない。確かめない');process.exit(0);}

let bad=0;
for(const n of bugs){
  console.log(`\n=== #${n}`);
  const r=spawnSync(process.execPath,['tools/red.mjs','--test',`#${n}`,'--base',BASE],{cwd:ROOT,stdio:'inherit'});
  if(r.status!==0){bad++;console.log(r.status===2?`#${n}：確かめにならなかった。テストの名前に「（#${n}）」を入れたか、読み込みのタイムアウトでないかを見る`:`#${n}：直す前の版で通るテストがある`);}
}
process.exit(bad?1:0);
