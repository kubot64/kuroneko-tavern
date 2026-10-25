// index.html の <script> を取り出して ESLint にかけ、使っていない名前（no-unused-vars）と、宣言していない名前（no-undef）と、
// 冒険者の status を文字列と直に比べる書き方（no-restricted-syntax）を見つける。
// あわせて、画面の側（ENGINE END より下）が全滅を伏せるためのフラグや判定を直に使っていないかを見る（viewOf を通す）。
// 職業と種族の表示名を判定に使っていないかも見る（鍵を使う）。
//
//   npm install   最初の一度だけ
//   node tools/lint.mjs
//
// 行番号は index.html の行番号のまま出す。テストや measure からしか使わないトップレベルの名前は、
// index.html の /* exported 名前 */ に並べる（そこに並べた名前は、使っていなくても咎めない）。
// 関数の引数は見ない。会話や夢の表のように、同じ形で並べた関数（(A,B)=>…）は、使わない引数があっても形をそろえておくため。
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';
import globals from 'globals';

const FILE=fileURLToPath(new URL('../index.html',import.meta.url));
const html=readFileSync(FILE,'utf8');
const m=/<script>\n([\s\S]*?)<\/script>/.exec(html);
if(!m){console.error('index.html に <script> が見つからない');process.exit(2);}
// script より前の行を空行で埋め、行番号を index.html に合わせる
const code='\n'.repeat(html.slice(0,m.index).split('\n').length)+m[1];

const eslint=new ESLint({overrideConfigFile:true,overrideConfig:[{
  languageOptions:{ecmaVersion:'latest',sourceType:'script',globals:globals.browser},
  linterOptions:{reportUnusedDisableDirectives:'error'},
  rules:{'no-unused-vars':['error',{vars:'all',args:'none',caughtErrors:'none'}],'no-undef':'error',
    // 冒険者の居どころ（status）を文字列と直に比べない。isActive・isIdle などを通す（#194）
    'no-restricted-syntax':['error',
      {selector:"BinaryExpression[operator=/^[!=]==?$/][left.property.name='status'][right.type='Literal']",message:'status を直に比べない。isActive・isIdle・inTemple などを使う'},
      {selector:"BinaryExpression[operator=/^[!=]==?$/][right.property.name='status'][left.type='Literal']",message:'status を直に比べない。isActive・isIdle・inTemple などを使う'},
      {selector:"CallExpression[callee.property.name='includes'] > MemberExpression.arguments[property.name='status']",message:'status を直に比べない。isActive・isIdle・inTemple などを使う'},
      // 一行の状態（state と、全滅の中の wipe）を書くのは setPhase だけ（#194）
      {selector:"AssignmentExpression[left.property.name=/^(state|wipe)$/]",message:'一行の状態は setPhase で変える'},
      {selector:"UnaryExpression[operator='delete'][argument.property.name=/^(state|wipe)$/]",message:'一行の状態は setPhase で変える'},
      {selector:"ObjectExpression > Property[key.name='state']",message:'一行の状態は setPhase で変える'},
      // 全滅を表していた古いフラグは、版34の移行で wipe に写した。読むときは wipeAnnounced・wipeSeen・wipeFound・wipeCauseTold を使う
      {selector:"MemberExpression[property.name=/^(announced|knownWiped|retrieved|causeTold)$/]",message:'古い全滅のフラグは使わない。wipeAnnounced・wipeSeen・wipeFound・wipeCauseTold を使う'}]},
}]});
// ESLint は拡張子で設定を選ぶので、script だけを .js の名前で渡す（そのファイルは作らない）
const [r]=await eslint.lintText(code,{filePath:FILE.replace(/\.html$/,'.script.js')});
for(const x of r.messages)console.log(`index.html:${x.line}:${x.column}  ${x.message}  (${x.ruleId||'構文'})`);
// 画面の側（ENGINE END より下）は、全滅を伏せるためのフラグと判定を直に読まず、viewOf・hpView・shownStatus・chronShown を通す（#194）
const HIDE=/\.(announced|knownWiped|causeTold|retrieved|calmHp|calmLc|hideRecall|wipedAt|dueAt)\b|\b(wipeHidden|wipeUnknown|partyOverdue|partyVisible|partyLabel|partyCard|partyDepth|hiddenLog)\(/g;
const lines=html.split('\n'),endAt=lines.findIndex(l=>l.includes('/*ENGINE END*/'));
let hideN=0;
lines.forEach((l,i)=>{if(i<=endAt)return;for(const mm of l.matchAll(HIDE)){hideN++;console.log(`index.html:${i+1}:${mm.index+1}  画面の側で「${mm[0]}」を直に使わない。viewOf などを通す  (伏せる処理)`);}});
// 職業と種族は内部の鍵（warrior・human など）で判定し、表示名（戦士・人間など）は CLS と RACE の n にだけ書く（#195）。
// 移行（migrate）は古い記録の名前を鍵に写すので、そこだけは名前を書いてよい
const NAMES=/'(戦士|侍|盗賊|僧侶|魔術師|聖騎士|狂戦士|剣聖|忍者|司教|魔導士|竜騎士|吟遊詩人|錬金術師|獣使い|人間|エルフ|ドワーフ|ホビット)'/g;
const migA=lines.findIndex(l=>l.startsWith('function migrate(S){')),migB=lines.findIndex(l=>l.startsWith('function migrateV2(S){'));
let nameN=0;
lines.forEach((l,i)=>{if(i>=migA&&i<migB)return;for(const mm of l.matchAll(NAMES)){if(/\bn:$/.test(l.slice(0,mm.index))||/who:\[[^\]]*$/.test(l.slice(0,mm.index)))continue;
  nameN++;console.log(`index.html:${i+1}:${mm.index+1}  職業と種族の名前「${mm[1]}」で判定しない。鍵（CLS・RACE の鍵）を使い、表示は clsName・raceName で  (表示名)`);}});
const n=r.messages.length+hideN+nameN;
console.log(n?`\n${n}件`:'index.html の script：使っていない名前も、宣言していない名前も、status の直の比較も、画面の側で伏せるフラグを読むところも、職業と種族の表示名での判定もない');
process.exit(n?1:0);
