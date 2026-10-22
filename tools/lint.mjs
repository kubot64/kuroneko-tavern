// index.html の <script> を取り出して ESLint にかけ、使っていない名前（no-unused-vars）と、宣言していない名前（no-undef）を見つける。
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
  rules:{'no-unused-vars':['error',{vars:'all',args:'none',caughtErrors:'none'}],'no-undef':'error'},
}]});
// ESLint は拡張子で設定を選ぶので、script だけを .js の名前で渡す（そのファイルは作らない）
const [r]=await eslint.lintText(code,{filePath:FILE.replace(/\.html$/,'.script.js')});
for(const x of r.messages)console.log(`index.html:${x.line}:${x.column}  ${x.message}  (${x.ruleId||'構文'})`);
const n=r.messages.length;
console.log(n?`\n${n}件`:'index.html の script：使っていない名前も、宣言していない名前もない');
process.exit(n?1:0);
