// docs/spec.md に書かれた決まりを「いつでも成り立つはずの性質」として、ゲームの中身を回しながら確かめる。
// ブラウザは使わない。index.html の /*ENGINE START*/〜/*ENGINE END*/ を取り出して node で動かす。
//
//   node tools/spec-test.mjs                 完全版。乱数の種を48個、それぞれ30000刻（600日）回す
//   node tools/spec-test.mjs --quick         速い版。完全版と同じ並びの先頭12種を、それぞれ30000刻回す
//   node tools/spec-test.mjs --seeds 40 --ticks 10000
//   node tools/spec-test.mjs --seed 12345    その種だけを回す（不合格の再現に使う）
//   node tools/spec-test.mjs --jobs 2        同時に回す数。環境変数 SPEC_TEST_JOBS でも指定できる（ふだんは CPU のコア数）
// 種ごとに別のスレッドで回す。進捗と合否は種の順に出すので、同時に回す数を変えても結果は同じになる。
import {readFileSync} from 'node:fs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';

const args=process.argv.slice(2);
const opt=(k,d)=>{const i=args.indexOf(k);return i>=0?Number(args[i+1]):d;};
const TICKS=opt('--ticks',30000);
// 速い版の12種は、完全版（1000 から 7919 ずつ）の先頭で、毎回同じ並び
const QUICK_SEEDS=12;
const seedN=args.includes('--seed')?1:opt('--seeds',args.includes('--quick')?QUICK_SEEDS:48);
const SEEDS=args.includes('--seed')?[opt('--seed',1)]:Array.from({length:Number.isFinite(seedN)&&seedN>=0?seedN:0},(_,i)=>1000+i*7919);
// --jobs が最優先。なければ SPEC_TEST_JOBS。どちらもなければ CPU の数
function jobCount(){
  let n;
  if(args.includes('--jobs'))n=opt('--jobs',1);
  else if(process.env.SPEC_TEST_JOBS!=null&&process.env.SPEC_TEST_JOBS!=='')n=Number(process.env.SPEC_TEST_JOBS);
  else n=availableParallelism();
  return Math.max(1,Number.isFinite(n)?Math.floor(n):1);
}
const JOBS=jobCount();

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ENGINE=html.match(/\/\*ENGINE START\*\/([\s\S]*?)\/\*ENGINE END\*\//)[1];
const EXPORTS=['newState','tick','rivalTemple','seatCap','seatsUsed','nextSeats','newcomerLvl','buyPrice','investPrice','FACILITIES',
  'RARES','MAXF','DRAGON_F','TICKS_PER_DAY','awayPlan','smallOf','debtTick','DEBT0','encounter','rareSlain','rareMonOf','arrive',
  'repay','flowAdd','flowView','flowRoll','policyCost','goldSign','errandsOf','assignErrand','errandBlock','designateBlock','MAXF','MINE_TOP','MINE_BOT','MINE_N','FN','deepNow','G','groupMoney','floorsInit','mineOpen','conquest','mineConquest','title','alive','markAdv','markedOf','BOARD_MAX','MARK_MAX','errandStage','boardMax','markMax','ARCS','reachFloor','GATE_F','fac','nextFac','buildFac','migrate','partyShown','crestJa','glossText','PT_A','PT_B','takeCrest','pickCrest','newPartyName','combat','MON','elemMul','elemNote','sleepMul','sleepReach','MINE_RARES','supplyTeam','potionPrice','lendRival','reviveChance','reviveHint','reviveResultText','temple','checkMemo','memoState','nextDue','rankRows','MEMO','setQuietLog','DREAMS','rollAge','AGE2','ORIGINS','careerLine','originBg','BGS','originIntro','newcomerClause','doorLine','ourNewcomerNews','SPELL_LIST','foePool','dz','chest','victory','partyDanger','hpBand','retreatLine','retire','letterTick','kinTick','schedulePendingLetters','scheduleLostKin','memorialize','lostRareLine','dreamText','letterQuote','checkDream','wipe','wipeCause','errandEvent','errandFailLine','partyOverdue','returnPeril','SAVE_V','letterNews','fitOf','ERRANDS','ledgerLine','kanjiNum','corpsesHome','deliverCorpses','owe','inheritWill','wipeHidden','overdueSteps','tellCause','MISSING_GRACE','PATROL_DEPTH','OWED_RATE','OWED_REPAY','INHERIT_SAY','INHERIT_DEBT_SAY','inheritScore','inheritSay','heirScore','disbandParty','arrive','succession','leaderScore','bkey','farewellLine','FAREWELL_ACTS','FAREWELL_TONE','FAREWELL_QUIET'];

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
// 今のセーブの版。古い記録を開いたあとの版は、数字を直に書かずにこれと比べる
const SAVE_V=load(1).SAVE_V;

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
  const yomi=E.SPELL_LIST.find(s=>s[0]==='ヨミガエリ');
  check('ヨミガエリ：資料の説明はB16Fから先',!!yomi&&yomi[1].startsWith('B16Fから先の澱の中でだけ')&&!yomi[1].includes('より深い'),'資料',yomi&&yomi[1]);
  // 「大きな使い道」：店の設備の費用
  {const got=E.FACILITIES.map(([,ts])=>ts.map(t=>t[0]+t[1]).join('→')).join(' ');
    check('大きな使い道：設備の段と費用が表のとおり',got==='稽古場15000→道場60000→修練場300000 情報屋50000→情報網300000 療養所800000','表',got);}
  // 「店の設備」：下の段から順に建て増し、その段の費用を払う。いちばん上より先はない
  {const S2=E.newState(),T0=S2.taverns.ours;T0.gold=1e6;const paid=[];
    for(let i=0;i<4;i++){const g=T0.gold;const ok=E.buildFac(S2,'dojo');paid.push(ok?`${E.fac(S2,'dojo')}段${g-T0.gold}`:'建たない');}
    check('大きな使い道：設備は下の段から順に建て増す',paid.join(' ')==='1段15000 2段60000 3段300000 建たない','修練場を4回建てる',paid.join(' '));
    const S3=E.newState();S3.taverns.ours.gold=59999;E.buildFac(S3,'dojo');S3.taverns.ours.gold=59999;
    check('大きな使い道：金が足りなければ建て増せない',!E.buildFac(S3,'dojo')&&E.fac(S3,'dojo')===1,'道場に59999G',`${E.fac(S3,'dojo')}段`);}
  // 「店の設備」：できた知らせに、できた段を添える。記録の版は上がらない
  {const S4=E.newState();S4.taverns.ours.gold=2e6;const lines=[];
    for(const k of ['dojo','dojo','dojo','info','inn']){E.buildFac(S4,k);lines.push(S4.news.at(-1).t);}
    check('店の設備：できた知らせに段を添える',lines[0].includes('稽古場ができた（Lv1）')&&lines[1].includes('道場ができた（Lv2）')&&lines[2].includes('修練場ができた（Lv3）')&&lines[3].includes('情報屋ができた（Lv1）')&&lines[4].includes('療養所ができた（Lv1）')&&S4.v===SAVE_V,'知らせ',lines.join(' / ')+` 版${S4.v}`);}
  // 「借金と返済」：最初の借金と所持金
  check('借金と返済：80000Gの借金と400Gで始まる',S.taverns.ours.debt===80000&&S.taverns.ours.gold===400,'開店',`借金${S.taverns.ours.debt} 所持金${S.taverns.ours.gold}`);
  check('金額：画面に出すときは3桁ごとに区切る',E.G(600000)==='600,000G'&&E.G(5600)==='5,600G'&&E.G(50)==='50G'&&E.G(0)==='0G'&&E.G(-1540)==='-1,540G'&&E.groupMoney('返済5600Gと罰金1600G。残りは600000G。')==='返済5,600Gと罰金1,600G。残りは600,000G。'&&E.groupMoney(E.groupMoney('600000G'))==='600,000G','G',E.G(600000));
  {const src='<div class="g" data-n="5600G" id="x1234Gb"><b>1234</b>Gold 12GB 3 Gold v1234G 1.2345G 返済5600G</div>',out=E.groupMoney(src);
  check('金額：金額でない数字＋G（タグの属性、12GB、3 Gold、v1234G、1.2345G）は区切らない',out==='<div class="g" data-n="5600G" id="x1234Gb"><b>1234</b>Gold 12GB 3 Gold v1234G 1.2345G 返済5,600G</div>'&&E.groupMoney('1234 Gの残り')==='1,234 Gの残り'&&E.groupMoney('-1540G')==='-1,540G','G',out);}
  check('最深：着いていないときは―',E.deepNow(0)==='―'&&E.deepNow(1)==='B1F'&&E.FN(0)==='B0F','deepNow',E.deepNow(0));
  {const rare=E.MEMO.find(m=>m.id==='rare');
    check('覚え書き：名のある魔物は一体',!!rare&&rare.t==='名のある魔物を、一体仕留める','MEMO',rare&&rare.t);}
  {const F=E.floorsInit(E.newState());const blob=JSON.stringify(F);
    check('地図の昔の人数は算用数字',F[4].arrive.party.includes('40人')&&F[11].arrive.party.includes('200人')&&!blob.includes('四十')&&!blob.includes('三十')&&!blob.includes('二十')&&!blob.includes('五十')&&!blob.includes('百人')&&!blob.includes('二百'),'階の記録',blob);}
  // 「借金と返済」：返済日には利息2%を足し、4000G＋利息を払う。足りれば借金は4000G減る
  {const T0=S.taverns.ours;T0.gold=999999;T0.debt=50000;T0.nextPay=S.tick;const d0=T0.debt,g0=T0.gold;E.debtTick(S);
    check('借金と返済：返済日に4000G＋利息2%を払う',T0.debt===d0-4000&&g0-T0.gold===4000+Math.round(d0*.02),'返済日',`借金${d0}→${T0.debt} 支払い${g0-T0.gold}`);}
  // 「借金と返済」：足りないと、不足の25%が罰金として足され、評判が3下がる（0未満にはならない）
  {const T0=S.taverns.ours;T0.gold=1000;T0.debt=50000;T0.rep=2;T0.nextPay=S.tick;const due=4000+Math.round(50000*.02);E.debtTick(S);
    check('借金と返済：足りないと罰金25%、評判は0未満にならない',T0.debt===50000+Math.round(50000*.02)-1000+Math.round((due-1000)*.25)&&T0.rep===0,'返済日',`借金${T0.debt} 評判${T0.rep}`);}
  // 「借金と返済」：返した額と利息。手返済は元だけ。返済日は利息込み。延滞で払えた分も足し、利息を先に充てる。版は上がらない
  {const E2=load(4),S2=E2.newState(),U=S2.taverns.ours;U.gold=999999;const hand=E2.repay(S2,1000);
    check('借金と返済：手で返した分は利息に入らない',hand===1000&&U.debt===79000&&U.repaid===1000&&!(U.interestPaid>0)&&S2.v===SAVE_V,'1000G',`借金${U.debt} 返${U.repaid} 利息${U.interestPaid||0}`);
    U.nextPay=S2.tick;E2.debtTick(S2);
    const intr=Math.round(79000*.02),due=4000+intr;
    check('借金と返済：返済日は利息込みで、借金の減りは元の分だけ',U.debt===75000&&U.repaid===1000+due&&U.interestPaid===intr&&U.repaid-U.interestPaid===80000-U.debt&&S2.v===SAVE_V,'79000Gの翌月',`借金${U.debt} 返${U.repaid} 利息${U.interestPaid}`);
    const rep=U.rep;U.gold=2500;U.debt=50000;U.nextPay=S2.tick;const r0=U.repaid,i0=U.interestPaid;const intr2=Math.round(50000*.02);E2.debtTick(S2);
    const p0=2500,pen=Math.round((4000+intr2-p0)*.25);
    check('借金と返済：延滞で払えた分は返した額に入り、利息を先に充てる',U.repaid===r0+p0&&U.interestPaid===i0+intr2&&U.debt===50000+intr2-p0+pen&&U.late===1&&U.rep===Math.max(0,rep-3),'2500G',`借金${U.debt} 返${U.repaid} 利息${U.interestPaid}`);
    U.gold=400;U.debt=50000;U.late=0;U.rep=5;U.nextPay=S2.tick;const r1=U.repaid,i1=U.interestPaid;const intr3=Math.round(50000*.02);E2.debtTick(S2);
    check('借金と返済：利息より少ない延滞は、払った分がすべて利息',U.repaid===r1+400&&U.interestPaid===i1+400&&U.debt===50000+intr3-400+Math.round((4000+intr3-400)*.25),'400G',`借金${U.debt} 返${U.repaid} 利息${U.interestPaid}`);
    U.gold=0;U.debt=50000;U.nextPay=S2.tick;const r2=U.repaid,i2=U.interestPaid;E2.debtTick(S2);
    check('借金と返済：1Gも払えなければ返した額も利息も増えない',U.repaid===r2&&U.interestPaid===i2&&U.gold===0,'所持金0',`返${U.repaid} 利息${U.interestPaid}`);
    U.gold=5000;const i3=U.interestPaid;E2.repay(S2,1000);
    check('借金と返済：利息を積んだあとの手返済は利息を増やさない',U.interestPaid===i3&&U.repaid===r2+1000,'手で1000G',`返${U.repaid} 利息${U.interestPaid}`);}
  {const fill=(patch,news)=>{const E3=load(5),S3=E3.newState(),U=S3.taverns.ours;Object.assign(U,patch);if(!('interestPaid' in patch))delete U.interestPaid;if(news)S3.news.push(...news);S3.v=SAVE_V;E3.migrate(S3);return {E:E3,S:S3,U};};
    const pay=t=>[{tk:1,t,k:'info'}];
    const a=fill({repaid:6580,debt:75000,late:0},pay('セーレの両替商に、今月の返済5580G（うち利息1580G）を払った。借金の残りは75000G。'));
    check('借金と返済：延滞の跡がなければ、返した額と借金の減りの差を利息にする',a.U.interestPaid===1580&&a.S.v===SAVE_V,'6580G・借金75000',`利息${a.U.interestPaid} 版${a.S.v}`);
    a.U.debt=74000;a.E.migrate(a.S);
    check('借金と返済：一度埋めた利息は開き直しても計算し直さない',a.U.interestPaid===1580,'借金を動かして開き直す',a.U.interestPaid);
    const b=fill({repaid:11120,debt:72000,late:0},[]);
    check('借金と返済：知らせがこぼれていても、延滞の跡がなければ差を利息にする',b.U.interestPaid===3120,'知らせなし',b.U.interestPaid);
    const c=fill({repaid:5660,debt:79000,late:0},pay('今月の返済に4600G足りなかった。延滞の罰金1400Gが上乗せされ、借金の残りは83000G。').concat(pay('セーレの両替商に、今月の返済5660G（うち利息1660G）を払った。借金の残りは79000G。')));
    check('借金と返済：延滞の知らせが残っていれば、知らせの利息だけを足す',c.U.interestPaid===1660,'延滞のあと完済の月',c.U.interestPaid);
    const d=fill({repaid:0,debt:81750,late:1},[]);
    check('借金と返済：いま延滞している記録は、残っている知らせの利息だけ',d.U.interestPaid===0,'延滞中',d.U.interestPaid);
    const e=fill({repaid:5660,debt:81000,late:0},pay('セーレの両替商に、今月の返済5660G（うち利息1660G）を払った。借金の残りは81000G。'));
    check('借金と返済：借金が80000Gを超える記録は、知らせの利息だけを足す',e.U.interestPaid===1660,'借金81000',e.U.interestPaid);
    const f=fill({repaid:1000,debt:79000,late:0,interestPaid:40});
    check('借金と返済：すでに利息がある記録は埋め直さない',f.U.interestPaid===40,'利息40',f.U.interestPaid);}
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
  // 「保存と、閉じているあいだの時間」：2.5秒で1刻、10日分（500刻）まで。30刻以上か早送りの残りがあれば「留守のあいだに」を出す
  // ページを閉じていたときも、開いたまま裏に回っていたときも、同じ決まりで進める
  {const E=load(1);const plan=(sec,pend)=>{const r=E.awayPlan(sec,pend);return `${r.n}${r.digest?'出す':'出さない'}`;};
    const cases=[[0,0,'0出さない'],[2.4,0,'0出さない'],[2.5,0,'1出さない'],[74,0,'29出さない'],[75,0,'30出す'],[3600,0,'500出す'],[86400*30,0,'500出す'],
      [0,3,'3出す'],[86400*30,7,'507出す'],[-100,0,'0出さない']];
    for(const [sec,pend,want] of cases)check('時間と保存：留守にしていた時間から進める刻と画面が決まりのとおり',plan(sec,pend)===want,`${sec}秒・早送りの残り${pend}刻`,`${plan(sec,pend)}（決まりは${want}）`);}
  // 「名のある魔物」：各階に1体きり。ある一行が戦っているあいだは、同じ階の別の一行の前には現れない
  // 乱数をいつも0にして、出会えるときは必ず出会うようにする
  const meet=fighting=>{const E=load(1,1e-9),S=E.newState();const [p,q]=Object.values(S.parties);
    p.floor=q.floor=23;p.enemies=q.enemies=null;p.etype=q.etype=null;
    if(fighting){q.etype=E.rareMonOf(23);q.enemies=[{hp:q.etype.hp,sleep:0}];}
    E.encounter(S,p);return !!(p.etype&&p.etype.rare);};
  check('名のある魔物：誰も戦っていなければ、出会える（下の確かめが空振りでない）',meet(false),'B23F・ほかの一行は戦っていない','出会えなかった');
  check('名のある魔物：ほかの一行が戦っているあいだは、別の一行の前に現れない',!meet(true),'B23F・ほかの一行が戦っている','別の一行の前にも現れた');
  // 「貸し付け」：坑道に潜る銀の杯亭の一行は、回復薬を5本借り、代金が借金に足される。迷宮に潜る一行は借りない
  for(const mine of [true,false]){const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='rival');
    const al=p.members.map(id=>S.adv[id]);const d0=al.reduce((s,a)=>s+(a.debt||0),0);p.mineTrip=mine;p.potions=0;const c=5*E.potionPrice(S,p);E.supplyTeam(S,p);
    const d1=al.reduce((s,a)=>s+(a.debt||0),0);const ok=mine?p.potions===5&&d1-d0>=c&&d1-d0<c+al.length:p.potions===0&&d1===d0;
    check('貸し付け：坑道に潜る銀の杯亭の一行だけが回復薬5本を借り、代金が借金に足される',ok,mine?'坑道へ':'迷宮へ',`回復薬${p.potions}本・借金+${d1-d0}G（代金${c}G）`);}
  // 「貸し付け」：手帳の「借金を返し終える」は、最初に装備を借りた分を返したときの1回きり。坑道で借りた分を返しても書かない
  {const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='rival');const al=p.members.map(id=>S.adv[id]);const a=al.find(x=>x.loanItem)||al[0];
    a.loanItem=a.loanItem||'借りた剣';const line='銀の杯亭への借金を返し終える';const cnt=()=>(a.chron||[]).filter(x=>x.t===line).length;const got=[];
    for(let i=0;i<3;i++){al.forEach(x=>{x.hp=x.mhp;x.status='party';});if(i===0)a.debt=1;else E.lendRival(S,p,al.length);
      p.loot=100000;p.carried=[];p.rescue=[];E.arrive(S,p);got.push(`${a.debt}G/${cnt()}回`);}
    check('貸し付け：手帳の「借金を返し終える」は、装備の借金を返したときの1回きり',cnt()===1&&!a.loanItem,'返し終える→坑道で借りて返す×2',got.join(' → '));}
  // この決まりより前の記録では、装備の借金を返し終えても貸し付けの印が残る。借金のない客は読み込みで消し、坑道の借りを返しても手帳に出さない
  {const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='rival');const al=p.members.map(id=>S.adv[id]);
    const paid=al[0],owing=al[1];const line='銀の杯亭への借金を返し終える';
    paid.debt=0;paid.loanItem='借りた剣';paid.chron=(paid.chron||[]).concat([{tk:1,t:line}]);
    owing.debt=50;owing.loanItem='借りた盾';owing.chron=(owing.chron||[]).filter(x=>x.t!==line);
    S.v=21;E.migrate(S);
    const cnt=a=>(a.chron||[]).filter(x=>x.t===line).length;
    check('貸し付け：古い記録を開くと、借金のない客の貸し付けの印が消える',!paid.loanItem&&owing.loanItem==='借りた盾'&&cnt(paid)===1&&cnt(owing)===0&&S.v===SAVE_V,'版21を開く',`返し済み${paid.loanItem||'なし'}・${cnt(paid)}回 残債${owing.loanItem||'なし'}・${cnt(owing)}回 版${S.v}`);
    al.forEach(x=>{x.hp=x.mhp;x.status='party';});E.lendRival(S,p,al.length);p.loot=100000;p.carried=[];p.rescue=[];E.arrive(S,p);
    check('貸し付け：印を消した客は、坑道で借りた分を返しても手帳に出ない',cnt(paid)===1&&paid.debt===0&&!paid.loanItem&&cnt(owing)===1&&owing.debt===0&&!owing.loanItem,'坑道の借りを返す',`返し済み${cnt(paid)}回・借金${paid.debt} 残債${cnt(owing)}回・借金${owing.debt}`);}
  // 「戦闘」：群れで出ても、炎の息を吐くのはひと巡りに1体まで。黒竜は1ラウンドに2回とも吐ける
  // 乱数をいつも0にして、吐けるときは必ず吐くようにする。B6Fより下の記録は文字が乱れるので、B5Fで戦わせる
  // 開店の顔ぶれには、敵を眠らせる者と急所を突く者がいる。戦士にしてMPを空にし、息の前に勝負が終わらないようにする
  for(const [name,want] of [['キメラ',1],['黒竜',2]]){const E=load(1,1e-9),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.mhp=a.hp=99999;a.mp=0;a.cls='戦士';});
    const t=E.MON.find(m=>m.n===name);p.floor=5;p.state='explore';p.etype=t;p.ident=true;p.fought=true;p.enemies=Array.from({length:name==='黒竜'?1:3},()=>({hp:1e9,sleep:0}));p.log=[];
    E.combat(S,p);const n=p.log.filter(x=>x.t.startsWith(`${name} は `)&&x.t.includes('を はいた！')).length;
    check('戦闘：炎の息は、群れでもひと巡りに1体まで（黒竜は2回）',n===want,`${name}${p.enemies.length}体`,`${n}回吐いた（決まりは${want}回）`);}
  // 「吸精」：レベルを2つ吸い取り、手帳に吸い取られたあとのレベルを残す。レベル2以下は下がらない
  {const E=load(1,1e-9),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.mhp=a.hp=99999;a.mp=0;a.cls='戦士';a.lvl=19;a.xp=0;a.pers='普通';a.eq={};a.traits=[];});
    const t=E.MON.find(m=>m.n==='レイス');const hit=S.adv[p.members[0]];
    p.floor=5;p.state='explore';p.etype=t;p.ident=true;p.fought=true;p.maps={5:1};p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.enemies=[{hp:1e9,sleep:0}];p.log=[];p.trip={close:[]};
    E.combat(S,p);
    const line='レイスでレベルを吸い取られ、レベル17になる';
    check('吸精：手帳に、吸い取られたあとのレベルが残る',hit.lvl===17&&(hit.chron||[]).some(c=>c.t===line)&&p.members.slice(1).every(id=>S.adv[id].lvl===19),'レイス・レベル19',`${hit.name}は${hit.lvl} ${(hit.chron||[]).filter(c=>c.t.includes('吸い取')).map(c=>c.t).join(' / ')||'記録なし'}`);
    p.members.forEach(id=>{const a=S.adv[id];a.lvl=2;a.hp=a.mhp;a.chron=(a.chron||[]).filter(c=>!c.t.includes('吸い取'));});
    p.enemies=[{hp:1e9,sleep:0}];p.etype=t;p.log=[];E.combat(S,p);
    check('吸精：レベル2以下は吸い取られない',p.members.every(id=>S.adv[id].lvl===2&&!(S.adv[id].chron||[]).some(c=>c.t.includes('吸い取'))),'レベル2','レベル '+p.members.map(id=>S.adv[id].lvl).join(','));}
  // 「前人未踏の階」：まだ誰もB11Fに着いていないうちに罠でB12F以降へ飛ばされても、封じの門を越えた知らせが出る
  for(const f of [11,13]){const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp;a.status='party';});S.deepest.ours=S.deepest.rival=E.GATE_F;p.floor=f;p.trip=p.trip||{};
    const n0=S.news.length;E.reachFloor(S,p,f>11);const got=S.news.slice(n0).map(x=>x.t).filter(t=>t.includes(p.name));
    check('前人未踏の階：封じの門を初めて越えた一行には、着いた階によらず門の知らせが出る',got.some(t=>t.includes('封じの門を越え')&&t.includes(E.FN(f))),`${E.FN(f)}${f>11?'（罠）':''}`,got.join(' / ')||'知らせなし');}
  // 「名のある魔物」「伝説の品」：2つの一行が続けて討っても、褒美と記録は最初の一行の1回きり
  {const E=load(1),S=E.newState();const [p,q]=Object.values(S.parties);const t=E.rareMonOf(23);const it=E.RARES.find(r=>r.f===23).item.n;
    E.rareSlain(S,p,t);E.rareSlain(S,q,t);
    const n=Object.values(S.adv).filter(a=>Object.values(a.eq||{}).some(x=>x&&x.n===it)).length;
    check('名のある魔物：続けて2回討たれても、褒美と記録は最初の1回きり',n<=1&&S.rares[23].killed.party===p.name,'B23F・2つの一行が続けて討つ',`${it}を持つ者${n}人・記録は${S.rares[23].killed.party}`);}
  // 「二つ名」：名のある魔物の「○○殺し」は、とどめを刺した者だけ。呪文・息吹・爆薬・相棒の獣は使い手の手柄
  const slay=(floor,cls,rnd,prep)=>{const E=load(1,rnd),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.mhp=a.hp=99999;a.mp=30;a.pers='無謀';a.fear=null;a.poison=0;a.eq={};a.tal=[];a.traits=[];
      a.title=null;a.titleKind=null;a.titleTier=0;a.titleStem=null;a.rareKills=0;a.kills=0;a.disarms=0;a.deepest=1;a.revived=0;a.slain={};a.conq=false;a.mconq=false;a.mineDeep=0;a.errandsDone=0;a.cls=cls;a.lvl=6;a.beast=null;});
    if(prep)prep(S,p);
    const expect=prep?p.members.length-1:0;
    p.members.forEach((id,i)=>{const a=S.adv[id];if(i===expect)return;a.title='鉄拳';a.titleKind='k80';a.titleTier=1;a.titleStem='鉄拳';});
    p.floor=floor;p.state='explore';p.fought=true;p.ident=true;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.log=[];
    p.etype=E.rareMonOf(floor);p.enemies=[{hp:1,sleep:0}];
    E.combat(S,p);return {E,S,p,n:p.etype.n,al:p.members.map(id=>S.adv[id]),expect};};
  const bondOf=(S,a,b)=>{const k=a.id<b.id?`${a.id}-${b.id}`:`${b.id}-${a.id}`;return (S.bonds||{})[k];};
  const slayerNews=(S,E,at)=>{const names=[...E.RARES,...E.MINE_RARES].map(r=>r.n);
    const fresh=(S.news||[]).filter(n=>n.tk===S.tick&&String(n.t).includes('と呼ばれはじめた')&&String(n.t).includes('殺し'));
    let bad=null;for(const nm of names){const c=fresh.filter(n=>n.t.includes(nm+'殺し')).length;if(c>1)bad=`${nm}が${c}件`;}
    check('名のある魔物：同じ刻に同じ「殺し」の知らせは一件だけ',!bad,at,bad||fresh.map(n=>n.t).join(' / ')||'なし');};
  for(const [how,floor,cls,rnd,prep] of [['呪文',1,'魔術師',1e-9,null],['爆薬',2,'錬金術師',1e-9,null],['息吹',5,'竜騎士',1e-9,null],['相棒の獣',4,'戦士',0.99,(S,p)=>{const id=p.members.at(-1);const a=S.adv[id];a.cls='獣使い';a.beast={kind:'狼',name:'クロ'};}]]){
    const {E,S,p,n,al,expect}=slay(floor,cls,rnd,prep);const slayer=al[expect];const others=al.filter(a=>a!==slayer);const k=S.rares[floor]&&S.rares[floor].killed;
    const titled=al.filter(a=>a.title&&a.title.includes(n)&&a.title.includes('殺し'));
    const news=(S.news||[]).filter(x=>x.tk===S.tick&&x.t.includes(n+'殺し')&&x.t.includes('と呼ばれはじめた'));
    const bonds=others.every(a=>{const ev=((bondOf(S,slayer,a)||{}).ev||[]);return ev.some(e=>e.k==='rare'&&String(e.t).includes(n+'討伐に加わった'));});
    const kept=others.every(a=>a.title==='鉄拳'&&!(a.rareKills>0)&& (a.chron||[]).some(c=>c.t.includes(n+'討伐に加わった')));
    const fin=(slayer.chron||[]).some(c=>c.t.includes(`「${n}」を討つ`))&&slayer.rareKills===1&&slayer.title&&slayer.title.includes(n)&&slayer.title.includes('殺し');
    check('二つ名：名のある魔物の「殺し」はとどめを刺した者だけに付く',!!k&&k.by===slayer.name&&titled.length===1&&titled[0]===slayer&&fin&&kept&&bonds&&news.length===1,`${how}・${E.FN(floor)}の${n}`,
      `とどめ${k&&k.by} 二つ名${al.map(a=>a.title||'なし').join('・')} 知らせ${news.length}件`);
    slayerNews(S,E,`${how}・${n}`);}
  // 黒竜・沈んだ王・坑道王の二つ名は、その場にいた全員
  {const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    const clear=a=>{a.status='party';a.mhp=a.hp=99999;a.title=null;a.titleKind=null;a.titleTier=0;a.titleStem=null;a.kills=0;a.rareKills=0;a.disarms=0;a.deepest=1;a.revived=0;a.slain={};a.eq={};a.conq=false;a.mconq=false;a.mineDeep=0;a.errandsDone=0;};
    p.members.forEach(id=>clear(S.adv[id]));E.conquest(S,p);const al=p.members.map(id=>S.adv[id]);
    check('二つ名：沈んだ王を討った一行は全員が踏破者の二つ名を得る',al.length>=3&&al.every(a=>a.titleKind==='conq'&&a.title),'沈んだ王',al.map(a=>`${a.name}「${a.title||'なし'}」`).join('、'));
    const S2=E.newState();const p2=Object.values(S2.parties).find(x=>x.tav==='ours');p2.members.forEach(id=>clear(S2.adv[id]));E.mineConquest(S2,p2);const al2=p2.members.map(id=>S2.adv[id]);
    check('二つ名：坑道王を討った一行は全員が坑道踏破者の二つ名を得る',al2.length>=3&&al2.every(a=>a.titleKind==='mconq'&&a.title),'坑道王',al2.map(a=>`${a.name}「${a.title||'なし'}」`).join('、'));
    const S3=E.newState();const p3=Object.values(S3.parties).find(x=>x.tav==='ours');p3.members.forEach(id=>{const a=S3.adv[id];clear(a);a.slain={'黒竜':1};E.title(S3,a);});const al3=p3.members.map(id=>S3.adv[id]);
    check('二つ名：黒竜を討った一行は全員が竜の二つ名を得る',al3.length>=3&&al3.every(a=>a.titleKind==='dragon'&&a.title),'黒竜',al3.map(a=>`${a.name}「${a.title||'なし'}」`).join('、'));}
  // すでに付いている二つ名は書き換えない。とどめの者がいない古い討伐記録は、その場にいた者を候補にする
  {const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const [a,b]=p.members.map(id=>S.adv[id]);
    const wipe=x=>{x.kills=0;x.rareKills=1;x.disarms=0;x.deepest=1;x.revived=0;x.slain={};x.eq={};x.conq=false;x.mconq=false;x.mineDeep=0;x.errandsDone=0;x.title=null;x.titleKind=null;x.titleTier=0;x.titleStem=null;};
    wipe(a);wipe(b);a.title='ドブ王殺し';a.titleKind='rare';a.titleTier=2;a.titleStem='rare:ドブ王';
    S.rares=S.rares||{};S.rares[1]={killed:{party:p.name,tav:p.tav,names:[a.name,b.name],tk:1}};S.v=22;E.migrate(S);E.title(S,a);E.title(S,b);
    check('二つ名：古い討伐記録では、その場にいた者も「殺し」の候補になる',a.title==='ドブ王殺し'&&b.title&&b.title.includes('ドブ王')&&b.title.includes('殺し'),'by のない記録',`${a.name}「${a.title}」 ${b.name}「${b.title||'なし'}」`);
    const S4=E.newState();const q=Object.values(S4.parties).find(x=>x.tav==='ours');const [c,d]=q.members.map(id=>S4.adv[id]);wipe(c);wipe(d);
    c.title='ドブ王殺し';c.titleKind='rare';c.titleTier=2;c.titleStem='rare:ドブ王';
    S4.rares=S4.rares||{};S4.rares[1]={killed:{party:q.name,tav:q.tav,names:[c.name,d.name],by:c.name,tk:1}};S4.v=22;E.migrate(S4);E.title(S4,c);E.title(S4,d);
    check('二つ名：すでに付いている二つ名は読み込んでも変わらない',c.title==='ドブ王殺し'&&!d.title,'とどめは別の者',`${c.name}「${c.title}」 ${d.name}「${d.title||'なし'}」`);}
  // 「二つ名」「記念碑」：とどめの者がその戦いで倒れていても、手柄はその者のもの。二つ名の知らせは出さない
  {const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    const [slayer,other]=p.members.map(id=>S.adv[id]);
    p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.hp=a.mhp=999;a.title=null;a.titleKind=null;a.titleTier=0;a.titleStem=null;a.rareKills=0;a.kills=0;a.disarms=0;a.deepest=1;a.revived=0;a.slain={};a.eq={};a.conq=false;a.mconq=false;a.mineDeep=0;a.errandsDone=0;a.pers='普通';});
    slayer.hp=0;p.rareBy=slayer.id;p.floor=1;p.trip={};p.log=[];p.loot=0;
    const n0=S.news.length;const t=E.rareMonOf(1);E.rareSlain(S,p,t);
    const titled=S.news.slice(n0).some(n=>n.t.includes('と呼ばれはじめた'));
    const k=S.rares[1]&&S.rares[1].killed;
    check('二つ名：倒れた者のとどめにも「殺し」は付くが、知らせは出ない',!!k&&k.by===slayer.name&&slayer.rareKills===1&&slayer.title&&slayer.title.includes('ドブ王')&&slayer.title.includes('殺し')&&!titled&&(slayer.chron||[]).some(c=>c.t.includes('「ドブ王」を討つ'))&&!(other.rareKills>0),
      'B1Fのドブ王',`とどめ${k&&k.by} 「${slayer.title||'なし'}」 知らせ${titled?'出た':'なし'}`);
    slayer.trips=4;slayer.tav='ours';slayer.status='lost';E.memorialize(S,slayer,{by:'ドブ王',floor:1});
    const m=S.memorial.at(-1);
    check('記念碑：倒れた者の添え書きに、討った名のある魔物が残る',m&&m.id===slayer.id&&m.rares&&m.rares.includes('ドブ王')&&E.lostRareLine(m).includes('名のある魔物「ドブ王」を討った者'),'ロスト',E.lostRareLine(m));}
  // 「記念碑」「知らせ」：20日見つからなかった一行の知らせには、消えた者の名が二つ名つきで全員ぶん並ぶ。銀の杯亭も同じ文
  for(const tav of ['ours','rival']){const E=load(2),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav===tav&&x.members.length>=2);
    if(!p){check('記念碑：見つからなかった一行の知らせに、消えた者の名が二つ名つきで全員ぶん並ぶ',false,tav,'一行がない');continue;}
    const ms=p.members.map(id=>S.adv[id]);ms[0].title='牙折り';ms[0].titleKind='kills';ms[0].titleTier=1;ms[0].titleStem='kills';
    ms.forEach(a=>{a.status='missing';a.hp=0;a.party=p.id;});
    // 巡回隊が届かない深さ（最深階から PATROL_DEPTH 階より浅くない）で、20日見つからなかった
    p.state='wiped';p.retrieved=false;p.wipedAt=S.tick-1001;p.floor=Math.max(S.deepest.ours,S.deepest.rival);p.killer='オーク';
    Object.values(S.parties).forEach(q=>{if(q!==p){q.state='town';q.rest=99;}});
    const n0=S.news.length,m0=S.memorial.length;E.tick(S);
    const n=S.news.slice(n0).find(x=>x.t.includes('ついに見つからなかった'));
    const want=ms.map(a=>a.title?`「${a.title}」${a.name}`:a.name);
    const exp=`${S.taverns[tav].name}の${p.name}は、ついに見つからなかった。${E.FN(p.floor)}に消えた${want.join('、')}の${want.length>1?want.length+'人の':''}名が記念碑に刻まれる。`;
    const carved=S.memorial.slice(m0).map(x=>x.name);
    // 黒猫亭なら、知らせの文に続けて見送りの一行が1つ付き、消えた者それぞれの記念碑に同じ一行が残る。銀の杯亭には付かない
    const fws=S.memorial.slice(m0).map(x=>x.farewell||'');const fw=tav==='ours'?fws[0]:'';
    check('記念碑：見つからなかった一行の知らせに、消えた者の名が二つ名つきで全員ぶん並ぶ',!!n&&n.t===exp+fw&&n.k==='lost'&&ms.every(a=>a.status==='lost')&&want.every(x=>carved.includes(x)),S.taverns[tav].name,n?`${n.t}（期待：${exp+fw}）`:'知らせなし');
    check('見送りの一行：まとめてロストしたときは知らせ1件に一行だけで、消えた者それぞれの記念碑に同じ一行が残る',tav==='ours'?(!!fw&&fws.every(x=>x===fw)&&(n.t.match(/。/g)||[]).length===(exp.match(/。/g)||[]).length+1):fws.every(x=>x===''),S.taverns[tav].name,fws.join(' / '));}
  // 「身内探し」「席と拡張」：席が埋まっているときは、救い出された身内は客にならない。見つけた本人と故郷へ帰る
  {const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    const finder=S.adv[p.leader];const kin='席のない身内';
    p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp;a.status='party';});
    p.loot=0;p.carried=[];p.rescue=[{by:finder.id,name:kin,who:'兄',f:12}];
    S.taverns.ours.seats=E.seatsUsed(S,'ours');
    const before=E.seatsUsed(S,'ours');
    E.arrive(S,p);
    const joined=Object.values(S.adv).some(a=>a.name===kin);
    const home=S.news.some(n=>n.t.includes(`見つけ出した兄の${kin}と故郷へ帰る`));
    check('身内探し：席が埋まっているときは、救い出された身内は客にならず、見つけた本人と故郷へ帰る',
      !joined&&home&&finder.status==='retired'&&E.seatsUsed(S,'ours')<before&&E.seatsUsed(S,'ours')<=E.seatCap(S,'ours'),
      '満席で帰還',`${joined?'客になった':'客にならない'} ${home?'本人と帰る':'残る'} ${finder.status} ${E.seatsUsed(S,'ours')}人 / ${E.seatCap(S,'ours')}席`);}
  // 席が空いていれば、これまでのとおり半々で、故郷へ帰るか客になる
  {let joined=false,home=false;
    for(let seed=1;seed<=40&&!(joined&&home);seed++){const E=load(seed),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');if(!p)continue;
      const finder=S.adv[p.leader];const kin='空きのある身内'+seed;
      p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp;a.status='party';});
      p.loot=0;p.carried=[];p.rescue=[{by:finder.id,name:kin,who:'兄',f:12}];
      S.taverns.ours.seats=36;
      E.arrive(S,p);
      if(Object.values(S.adv).some(a=>a.name===kin))joined=true;
      if(S.news.some(n=>n.t.includes(`見つけ出した兄の${kin}と故郷へ帰る`)))home=true;
      check('身内探し：席が空いていても常連の数は席を超えない',E.seatsUsed(S,'ours')<=E.seatCap(S,'ours'),`種${seed}`,`${E.seatsUsed(S,'ours')}人 / ${E.seatCap(S,'ours')}席`);}
    check('身内探し：席が空いていれば、半々で故郷へ帰るか客になる',joined&&home,'席に空き',`客になる:${joined} 帰る:${home}`);}
}

// 「持ち込まれる話と、見込んだ者」の場面。主役に回せる形（酒場にいて、街で休む一行に入っている）にそろえる
function errandScene(E,S,o){S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.tick;const B=E.errandsOf(S);B.stage=3;B.board=[];
  const p=Object.values(S.parties).find(x=>x.tav==='ours');p.state='town';p.rest=99;
  p.members.forEach(id=>{const a=S.adv[id];a.status='idle';a.hp=a.mhp;});
  const e=Object.assign({id:900,hero:null,refused:[],tk:S.tick,until:S.tick+2*E.TICKS_PER_DAY},o);B.board.push(e);return {p,e,B};}
function checkErrands(){
  const nail='掲示板に、釘がひとつ打たれた',second='掲示の釘がもうひとつ増えた',third='持ち込まれる話の質が変わった';
  const shallow=['kitten','ledger','ring'],deeper=['mushroom','bell','letter','barge','scale','grave','tome'];
  const posts=(E,S,n)=>{const seen=new Set();let arc=false;S.deepest.ours=Math.max(S.deepest.ours||0,25);
    for(let k=0;k<n;k++){const B=E.errandsOf(S);B.board=[];B.next=S.tick;E.tick(S);B.board.forEach(e=>{if(e.arc)arc=true;else if(e.k)seen.add(e.k);});}
    return {seen,arc};};
  // 最初の返済日の前は来ない。足りなくても段1が開き、浅い話だけが来る。覚え書きの取り立て人は、罰金のままではかなわない
  {const E=load(1),S=E.newState();const day=E.TICKS_PER_DAY;
    for(let i=0;i<30*day-1;i++)E.tick(S);
    check('持ち込まれる話：最初の返済日の前は、話が来ない',E.errandStage(S)===0&&E.errandsOf(S).board.length===0,'返済日の前',`段${E.errandStage(S)} 掲示${E.errandsOf(S).board.length}`);
    S.taverns.ours.gold=0;E.tick(S);
    const n1=S.news.filter(n=>n.t.includes(nail)).length;
    const bill=S.memo&&S.memo.done&&S.memo.done.bill;
    check('持ち込まれる話：最初の返済日に足りなくても段1が開く',E.errandStage(S)===1&&E.boardMax(S)===1&&E.markMax(S)===0&&S.taverns.ours.cleanPay==null&&(S.taverns.ours.late||0)>0&&n1===1&&!bill,'罰金の返済日',`段${E.errandStage(S)} 延滞${S.taverns.ours.late} 知らせ${n1} 覚え書き${!!bill}`);
    const got=posts(E,S,12);
    check('持ち込まれる話：段1では区画の始まりがB3Fまでの話だけ',got.seen.size>0&&[...got.seen].every(k=>shallow.includes(k))&&!got.arc&&E.errandStage(S)===1,'段1で12回',`来た話${[...got.seen].join(',')}`);
    S.taverns.ours.rep=200;const at=E.errandsOf(S).stage1At;const target=at+20*day-1;
    while(S.tick<target)E.tick(S);
    check('持ち込まれる話：段1から20日経つ前は、評判が高くても段2にならない',E.errandStage(S)===1&&S.tick===target,'19日と端数',`段${E.errandStage(S)} 刻${S.tick-at}`);
    E.tick(S);
    check('持ち込まれる話：段1から20日たち評判150以上で段2が開く',E.errandStage(S)===2&&E.boardMax(S)===2&&E.markMax(S)===1&&S.news.filter(n=>n.t.includes(second)).length===1,'20日目',`段${E.errandStage(S)}`);
    const deep=posts(E,S,40);
    check('持ち込まれる話：段2では単発の話が来て、続きものは来ない',E.errandStage(S)===2&&[...deep.seen].some(k=>deeper.includes(k))&&!deep.arc,'段2で40回',`話${[...deep.seen].join(',')}`);
    S.taverns.ours.rep=0;E.tick(S);
    check('持ち込まれる話：段は下がらない',E.errandStage(S)===2,'評判0',`段${E.errandStage(S)}`);
    const ours=Object.values(S.adv).filter(a=>a.tav==='ours'&&a.status!=='lost'&&a.status!=='retired');
    const marked=ours.slice(0,2).map(a=>E.markAdv(S,a,true));
    check('見込む：段2では1人まで',marked.join(',')==='true,false'&&E.markedOf(S).length===1,'2人を見込む',marked.join(','));
    const before=S.news.filter(n=>n.t.includes(third)).length;
    S.taverns.ours.gold=999999;E.repay(S,S.taverns.ours.debt);
    check('持ち込まれる話：借金を返し終えると段3が開き、知らせは一つ',E.errandStage(S)===3&&E.boardMax(S)===3&&E.markMax(S)===3&&S.news.filter(n=>n.t.includes(third)).length===before+1&&S.news.filter(n=>n.t.includes(nail)).length===1,'完済',`段${E.errandStage(S)}`);
    let arc=false;S.deepest.ours=12;
    for(let k=0;k<40&&!arc;k++){const B=E.errandsOf(S);B.board=[];B.next=S.tick;E.tick(S);arc=B.board.some(e=>e.arc==='gate');}
    check('続きもの：段3では封じの門の話が来る',arc,'段3で繰り返す',arc?'来た':'来ない');}
  // 足りて払えた返済日でも段1は開く。覚え書きの取り立て人は、こちらではかなう
  {const E=load(4),S=E.newState();const day=E.TICKS_PER_DAY;S.taverns.ours.gold=999999;
    for(let i=0;i<30*day;i++)E.tick(S);
    const bill=S.memo&&S.memo.done&&S.memo.done.bill;
    check('持ち込まれる話：不足なく払えた返済日でも段1が開く',E.errandStage(S)===1&&S.taverns.ours.cleanPay!=null&&!!bill&&S.news.filter(n=>n.t.includes(nail)).length===1,'無事な返済日',`段${E.errandStage(S)} clean ${S.taverns.ours.cleanPay}`);}
  // 最初の返済日より前に全額を返すと、段3だけが開く
  {const E=load(2),S=E.newState();S.taverns.ours.gold=999999;const n0=S.news.length;E.repay(S,S.taverns.ours.debt);
    const added=S.news.slice(n0).map(n=>n.t);
    check('持ち込まれる話：返済日の前に返し終えると段3だけが開く',E.errandStage(S)===3&&!added.some(t=>t.includes(nail))&&added.filter(t=>t.includes(third)).length===1,'全額',added.join(' / '));
    for(let i=0;i<4*E.TICKS_PER_DAY;i++)E.tick(S);
    const B=E.errandsOf(S);
    check('持ち込まれる話：段が開くと、数日で話が来る',B.board.length+B.log.length>0,'段3から4日',`掲示${B.board.length} 記録${B.log.length}`);}
  // 古い記録。知らせは出さず、評判は動かさない。完済は段3、返済日の前後で段0・1・2
  {const E=load(3),S=E.newState();const day=E.TICKS_PER_DAY;const quiet=(fn,label,ok)=>{const n=S.news.length,rep=S.taverns.ours.rep;fn();check(label,ok()&&S.v===SAVE_V&&S.news.length===n&&S.taverns.ours.rep===rep,label,`段${E.errandStage(S)} 版${S.v} 知らせ${S.news.length-n} 評判${S.taverns.ours.rep}`);};
    S.v=24;S.tick=10*day;S.taverns.ours.rep=200;delete S.errands;
    quiet(()=>E.migrate(S),'持ち込まれる話：返済日の前の古い記録は段0',()=>E.errandStage(S)===0);
    const S2=E.newState();S2.v=24;S2.taverns.ours.debt=0;S2.taverns.ours.debtFree=100;S2.taverns.ours.rep=40;
    S2.errands={board:[{id:1,k:'bell',n:'鐘楼の光',hero:null,refused:[],until:99999}],next:null,log:[],nid:2};
    const n2=S2.news.length,rep2=S2.taverns.ours.rep;E.migrate(S2);
    check('持ち込まれる話：借金を返し終えた古い記録は段3から始まり、掲示は残る',S2.v===SAVE_V&&E.errandStage(S2)===3&&S2.errands.board.length===1&&S2.errands.board[0].n==='鐘楼の光'&&S2.news.length===n2&&S2.taverns.ours.rep===rep2,'版24・完済',`段${E.errandStage(S2)}`);
    const S3=E.newState();S3.v=24;S3.tick=50*day-1;S3.taverns.ours.cleanPay=30*day;S3.taverns.ours.nextPay=60*day;S3.taverns.ours.rep=200;S3.taverns.ours.late=0;
    const n3=S3.news.length,rep3=S3.taverns.ours.rep;E.migrate(S3);
    check('持ち込まれる話：返済日から20日経っていない古い記録は段1',S3.v===SAVE_V&&E.errandStage(S3)===1&&S3.errands.stage1At===30*day&&S3.news.length===n3&&S3.taverns.ours.rep===rep3,'版24・段1',`段${E.errandStage(S3)} 起点${S3.errands.stage1At}`);
    E.tick(S3);
    check('持ち込まれる話：古い記録を開いたあとも、条件がそろった刻に一度だけ段が開く',E.errandStage(S3)===2&&S3.news.filter(n=>n.t.includes(second)).length===1,'移行の翌刻',`段${E.errandStage(S3)}`);
    const S4=E.newState();S4.v=24;S4.tick=50*day;S4.taverns.ours.cleanPay=30*day;S4.taverns.ours.nextPay=60*day;S4.taverns.ours.rep=150;
    const n4=S4.news.length,rep4=S4.taverns.ours.rep;E.migrate(S4);
    check('持ち込まれる話：条件を満たした古い記録は段2で、知らせは出ない',S4.v===SAVE_V&&E.errandStage(S4)===2&&S4.news.length===n4&&S4.taverns.ours.rep===rep4,'版24・段2',`段${E.errandStage(S4)}`);
    E.tick(S4);
    check('持ち込まれる話：移行で開いた段の知らせは、そのあとにも出ない',E.errandStage(S4)===2&&!S4.news.some(n=>n.t.includes(second)),'段2のまま',`段${E.errandStage(S4)}`);
    const S5=E.newState();S5.v=24;S5.tick=35*day;S5.taverns.ours.late=1;S5.taverns.ours.nextPay=60*day;S5.taverns.ours.rep=10;delete S5.taverns.ours.cleanPay;
    const n5=S5.news.length;E.migrate(S5);
    check('持ち込まれる話：延滞だけの古い記録も段1になる',S5.v===SAVE_V&&E.errandStage(S5)===1&&S5.news.length===n5,'版24・延滞',`段${E.errandStage(S5)}`);
    const S6=E.newState();S6.v=23;S6.tick=80*day;S6.taverns.ours.repaid=9000;S6.taverns.ours.late=0;S6.taverns.ours.nextPay=90*day;delete S6.taverns.ours.cleanPay;S6.taverns.ours.rep=80;S6.memo={done:{}};
    const n6=S6.news.length,rep6=S6.taverns.ours.rep;E.migrate(S6);
    check('持ち込まれる話：版23の記録は、推定した無事な返済から段を決め、評判は増えない',S6.v===SAVE_V&&S6.taverns.ours.cleanPay===60*day&&E.errandStage(S6)===1&&S6.news.length===n6&&S6.taverns.ours.rep===rep6,'版23',`段${E.errandStage(S6)} clean ${S6.taverns.ours.cleanPay}`);}
  // 臆病な者は、怖いものに正面から当たる話を断ることがある（乱数を0にして、起きうることを必ず起こす）
  {const E=load(1,1e-9),S=E.newState();const {p,e}=errandScene(E,S,{k:'bell',f:8,n:'鐘楼の光'});const [a,b]=p.members.map(id=>S.adv[id]);
    a.pers='臆病';a.fear='高い所';b.pers='普通';b.fear=null;
    const r1=E.assignErrand(S,e,a),r2=E.assignErrand(S,e,a),r3=E.assignErrand(S,e,b);
    check('持ち込まれる話：臆病な者は、怖いものに当たる話を断ることがある',r1==='refused','高い所を怖がる臆病者に鐘楼の話',r1);
    check('持ち込まれる話：断った者には、同じ話をもう回せない',r2===null,'断った者にもう一度',r2);
    check('持ち込まれる話：主役は1人で、引き受けたら5日は待ってもらえる',r3==='ok'&&e.hero===b.id&&e.until>=S.tick+5*E.TICKS_PER_DAY&&E.assignErrand(S,e,S.adv[p.members[2]])===null,'普通の者に回す',`${r3} 期限${e.until-S.tick}刻`);}
  // 一行が迷宮にいる者も主役に指定でき、酒場にいて一行が街で休んでいるときに伝わる
  {const E=load(1),S=E.newState();const {p,e}=errandScene(E,S,{k:'kitten',f:2,n:'迷い込んだ子猫'});const a=S.adv[p.members[0]];a.pers='普通';
    p.state='explore';const r=E.assignErrand(S,e,a);E.tick(S);const waiting=e.pend===a.id&&!e.hero;
    check('持ち込まれる話：一行が迷宮にいる者を指定すると、伝えるのを待つ',r==='pending'&&waiting,'一行が迷宮',`${r} 待ち${waiting}`);
    const b=S.adv[p.members[1]];const r2=E.assignErrand(S,e,b);
    check('持ち込まれる話：伝えるのを待つあいだに選び直すと、主役が入れ替わる',r2==='pending'&&e.pend===b.id,'待ちのあいだに別の者',`${r2} 待ち${e.pend}`);
    e.pend=a.id;p.state='town';p.rest=99;a.status='idle';E.tick(S);
    check('持ち込まれる話：酒場にいて一行が街で休んでいれば、伝わる',e.hero===a.id&&!e.pend,'一行が街に戻る',`主役${e.hero} 待ち${e.pend}`);}
  // 期限を過ぎた続きものの段は銀の杯亭に流れ、筋はそこで止まる
  {const E=load(1),S=E.newState();const {e,B}=errandScene(E,S,{arc:'gate',stage:1,f:8,n:'抜け穴の印',until:S.tick+1});E.tick(S);
    check('続きもの：期限を過ぎた段は銀の杯亭に流れ、筋が止まる',!B.board.includes(e)&&S.arcs.gate.stopped===1&&S.news.some(n=>n.t===E.ARCS.gate.half),'期限切れ',`掲示に${B.board.includes(e)?'残る':'ない'} 止まった段${S.arcs.gate.stopped}`);
    for(let i=0;i<40*E.TICKS_PER_DAY;i++)E.tick(S);
    check('続きもの：止まった筋の話は、もう来ない',!B.board.some(x=>x.arc==='gate')&&S.arcs.gate.stage===0,'止まってから40日',`段${S.arcs.gate.stage}`);}
  // 見込めるのは3人まで。外すと恩が少し減る
  {const E=load(1),S=E.newState();S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.tick;E.errandsOf(S).stage=3;const ours=Object.values(S.adv).filter(a=>a.tav==='ours');
    const r=ours.slice(0,4).map(a=>E.markAdv(S,a,true));
    check('見込む：見込めるのは3人まで',r.join(',')==='true,true,true,false'&&E.markedOf(S).length===3,'4人を見込む',r.join(','));
    ours[0].favor=3;E.markAdv(S,ours[0],false);
    check('見込む：外すと恩が1減る',ours[0].favor===2&&!ours[0].marked,'恩3で外す',`恩${ours[0].favor}`);}
  // 古い記録の一行名は、読み込み時に紋章名へ付け替える。看板と封鎖前の大部隊、店の名、食べ物の語は残す
  {const E=load(1),S=E.newState();
    const crest=/^[\u30A1-\u30F6\u30FC]+・[\u30A1-\u30F6\u30FC]+$/;
    const ps=Object.values(S.parties).sort((a,b)=>a.id-b.id);
    const ace=ps.find(p=>p.name==='白銀の牙');
    const olds=['鉄鍋隊','泥ねずみ','石橋組','葡萄酒隊','灯り持ち','黒猫の旗','錆びた剣','月影隊'];
    const rest=ps.filter(p=>p!==ace);
    rest.forEach((p,i)=>{delete S.usedParty[p.name];p.name=olds[i]||`北風隊${i}`;S.usedParty[p.name]=1;});
    const names0=Object.fromEntries(ps.map(p=>[p.id,p.name]));
    const leader=S.adv[rest[0].leader];
    const blob=rest.map(p=>p.name).join('と')+'が葡萄酒を飲んだ。鉄の誓い傭兵団（四十人）と七つ星団（赤い樽亭・三十人）と夜鷹団と黄金の剣団の話は昔。黒猫亭と銀の杯亭。白銀の牙は看板。錆びた兜が転がっていて、灯りの火が小さい。';
    S.news.push({tk:1,t:blob,k:'info'});
    leader.chron.push({tk:1,t:`仲間を集め、${rest[0].name}を結成してリーダーになる`});
    rest[0].log.push({t:`${rest[0].name} が めいきゅうへ しゅっぱつした`,k:'sys',n:99});
    S.floors[3].arrive={party:rest[0].name,tav:rest[0].tav,tk:1};
    const hist=S.floors[1].through.party;
    S.rares=S.rares||{};S.rares[1]=Object.assign(S.rares[1]||{},{killed:{party:rest[0].name,tav:rest[0].tav,names:[leader.name],tk:1}});
    leader.last={party:rest[0].name,tk:1,deep:1};
    const gold=S.taverns.ours.gold, member=leader.name;
    S.v=20;E.migrate(S);
    const renamed=rest.every(p=>crest.test(p.name)&&p.name!==names0[p.id]);
    const news=S.news.at(-1).t;
    const oldGone=olds.every(n=>!news.includes(n));
    const kept=news.includes('葡萄酒を飲んだ')&&news.includes('鉄の誓い傭兵団（四十人）')&&news.includes('七つ星団（赤い樽亭・三十人）')&&news.includes('夜鷹団')&&news.includes('黄金の剣団')&&news.includes('黒猫亭')&&news.includes('銀の杯亭')&&news.includes('白銀の牙は看板')&&news.includes('錆びた兜')&&news.includes('灯りの火');
    check('一行の名前：古い記録のいまいる一行は紋章名に付け替わる',!!ace&&ace.name==='白銀の牙'&&renamed&&rest.every(p=>news.includes(p.name))&&oldGone&&kept, '付け替え', news);
    check('一行の名前：付け替えは手帳と迷宮の記録にも行き渡る',leader.chron.at(-1).t.includes(rest[0].name)&&!leader.chron.at(-1).t.includes(names0[rest[0].id])&&rest[0].log.at(-1).t.includes(rest[0].name)&&S.floors[3].arrive.party===rest[0].name&&S.floors[1].through.party===hist&&S.rares[1].killed.party===rest[0].name&&leader.last.party===rest[0].name, '手帳と記録', `${leader.chron.at(-1).t} / ${hist}`);
    check('一行の名前：付け替えで店の金や冒険者の名は変わらない',S.taverns.ours.gold===gold&&S.taverns.ours.name==='黒猫亭'&&leader.name===member&&S.v===SAVE_V, '付け替え後', `金${S.taverns.ours.gold} ${leader.name}`);
    const again=rest.map(p=>p.name).join(',');E.migrate(S);
    check('一行の名前：付け替えは一度だけ',rest.map(p=>p.name).join(',')===again&&ace.name==='白銀の牙', '二度目の読み込み', rest.map(p=>p.name).join(','));}
}

// 紋章名の訳。記録には書かず、名前から引く
function checkCrest(){
  const E=load(1);
  check('一行の名前：紋章名には日本語の訳が付く',E.partyShown('ナハト・ラーベ')==='ナハト・ラーベ（夜の大鴉）'&&E.partyShown('ゴルト・グリフ')==='ゴルト・グリフ（金のグリフォン）'&&E.partyShown('シルバ・クロウ')==='シルバ・クロウ（銀の鴉）','訳',E.partyShown('ナハト・ラーベ')+' / '+E.partyShown('ゴルト・グリフ')+' / '+E.partyShown('シルバ・クロウ'));
  const all=E.PT_A.flatMap(a=>E.PT_B.map(b=>E.crestJa(a.t+'・'+b.t)));
  check('一行の名前：どの紋章名にも別の訳がある',all.length===E.PT_A.length*E.PT_B.length&&all.every(t=>t&&t.includes('の'))&&new Set(all).size===all.length&&new Set(E.PT_A.map(w=>w.ja)).size===E.PT_A.length&&new Set(E.PT_B.map(w=>w.ja)).size===E.PT_B.length,'訳の数',`${new Set(all).size}/${all.length}`);
  const plain=['白銀の牙','鉄鍋隊','泥ねずみ','葡萄酒隊','ローエンの一行','無名の一行・2'];
  check('一行の名前：看板と旧名と「の一行」には訳が付かない',plain.every(n=>E.partyShown(n)===n&&E.glossText(`知らせ：${n}が戻った`)===`知らせ：${n}が戻った`),'訳なし',plain.map(n=>E.partyShown(n)).join('、'));
  const line='ローエンが仲間を集め、ナハト・ラーベを結成した。仲間はエリアス・フリーダ。';
  const g=E.glossText(line);
  check('一行の名前：知らせの訳は文の中に添え、二度は付けない',g==='ローエンが仲間を集め、ナハト・ラーベ（夜の大鴉）を結成した。仲間はエリアス・フリーダ。'&&E.glossText(g)===g,'知らせ',g);
  const S=E.newState();
  check('一行の名前：訳は記録に残さない',Object.values(S.parties).every(p=>!('ja' in p)&&!('gloss' in p)&&p.name===p.name.replace(/（.+）$/,''))&&!JSON.stringify(S).includes('夜の大鴉'),'記録',Object.values(S.parties).map(p=>p.name).slice(0,4).join('、'));
  const themed=(leader)=>{const U={usedParty:{}};const nm=E.takeCrest(U,leader);const [at,bt]=nm.split('・');return {nm,shown:E.partyShown(nm),a:E.PT_A.find(w=>w.t===at),b:E.PT_B.find(w=>w.t===bt)};};
  const fit=(x,lang,cls)=>!!x.a&&!!x.b&&x.a.lang.includes(lang)&&(x.b.lang.includes(lang)||x.b.cls.includes(cls));
  const samples=[
    [{origin:'東方の島国アズマ',race:'人間',cls:'侍',name:'レン'},'アズマ','侍','ヤミ・ヤイバ'],
    [{origin:'霧の森',race:'エルフ',cls:'魔術師',name:'シエラ'},'森','魔術師','ステルン・クロウ'],
    [{origin:'鉄の山脈',race:'ドワーフ',cls:'戦士',name:'ドルフ'},'山','戦士','アイゼン・ハンマー'],
    [{origin:'麦穂の丘',race:'ホビット',cls:'盗賊',name:'ピピン'},'丘','盗賊','コルン・フクス'],
    [{origin:'聖オルド教国',race:'人間',cls:'僧侶',name:'ルカ'},'教','僧侶','ルクス・オイレ'],
    [{origin:'北の氷海ノルデン',race:'人間',cls:'獣使い',name:'オラフ'},'ノルデン','獣使い','アイス・ウルフ'],
    [{origin:'砂の大陸ザハル',race:'人間',cls:'竜騎士',name:'ラシド'},'ザハル','竜騎士','ラムル・ドラコ'],
    [{origin:'グラウ帝国',race:'人間',cls:'戦士',name:'カール'},'帝国','戦士','シュタール・アドラー'],
    [{origin:'ラウレンツ王国',race:'人間',cls:'吟遊詩人',name:'レオ'},'大陸','吟遊詩人','ナハト・リート'],
  ];
  const got=samples.map(([L,lang,cls,want])=>{const x=themed(L);return {ok:x.nm===want&&fit(x,lang,cls),t:`${L.origin}の${L.race}の${L.cls}→${x.shown}`};});
  check('一行の名前：リーダーの出身と種族と職業に合う',got.every(g=>g.ok),'付け方',got.map(g=>g.t).join(' / '));
  const blank={usedParty:{}};
  const spread=[0.02,0.18,0.4,0.62,0.84,0.97].map(u=>E.pickCrest(blank,samples[0][0],u));
  check('一行の名前：同じリーダーでも重みの中でばらける',new Set(spread).size>=3&&spread.every(n=>E.crestJa(n)),'ばらけ',spread.join('、'));
  const one=Object.values(S.parties).find(p=>p.name!=='白銀の牙');
  const keep={};Object.keys(S.usedParty).forEach(k=>{if(!/・/.test(k))keep[k]=1;});
  S.parties={[one.id]:one};one.name='鉄鍋隊';S.usedParty=Object.assign(keep,{'鉄鍋隊':1});
  S.adv[one.leader].origin='東方の島国アズマ';S.adv[one.leader].race='人間';S.adv[one.leader].cls='侍';
  S.v=20;E.migrate(S);
  check('一行の名前：付け替えもリーダーに合わせ、乱数の名は記録しない',one.name==='ヤミ・ヤイバ'&&S.v===SAVE_V&&!('ja' in one),'付け替え',one.name);
}
// 仕様「紋章名が尽きたときは、リーダーの名前に『の一行』を添える。重なれば『・2』から番号を添える」
function checkRowFallback(){
  const E=load(4),S=E.newState();
  for(const a of E.PT_A)for(const b of E.PT_B)S.usedParty[a.t+'・'+b.t]=1;
  S.usedParty['ミナの一行']=1;
  const row=(name,prefer)=>E.newPartyName(S,prefer||null,name?{name,origin:'ラウレンツ王国',race:'人間',cls:'戦士'}:{origin:'ラウレンツ王国',race:'人間',cls:'戦士'});
  const got={n1:row('ローエン'),n2:row('ローエン'),n3:row('ローエン'),u1:row(null),u2:row(null),m:row('ミナ'),ace:E.newPartyName(S,'白銀の牙',{name:'ケヴィ',origin:'聖オルド教国',race:'人間',cls:'魔術師'})};
  const want={n1:'ローエンの一行',n2:'ローエンの一行・2',n3:'ローエンの一行・3',u1:'無名の一行',u2:'無名の一行・2',m:'ミナの一行・2',ace:'ケヴィの一行'};
  const vals=Object.values(got);
  check('一行の結成：紋章名が尽きたときの「の一行」は番号で区別する',Object.entries(want).every(([k,v])=>got[k]===v)&&new Set(vals).size===vals.length&&vals.every(n=>S.usedParty[n]&&n!=='白銀の牙'),'紋章名を使い切る',Object.entries(got).map(([k,v])=>`${k}:${v}`).join(' / '));
}
// 「鉄の山脈の坑道」の場面
function checkMine(){
  const E=load(1),S=E.newState();
  check('坑道：階の呼び方は坑道B1F〜B25F',E.FN(E.MINE_TOP)==='坑道B1F'&&E.FN(E.MINE_BOT)==='坑道B25F'&&E.FN(E.MAXF)==='B30F','呼び方',`${E.FN(E.MINE_TOP)} ${E.FN(E.MINE_BOT)} ${E.FN(E.MAXF)}`);
  for(let i=0;i<20*E.TICKS_PER_DAY;i++)E.tick(S);
  check('坑道：迷宮が踏破されるまでは開かない',!E.mineOpen(S),'踏破なしで20日','開いた');
  const p=Object.values(S.parties).find(x=>x.tav==='ours');p.floor=E.MAXF;E.conquest(S,p);const t0=S.tick;let opened=null;
  for(let i=0;i<12*E.TICKS_PER_DAY&&opened==null;i++){E.tick(S);if(E.mineOpen(S))opened=S.tick-t0;}
  check('坑道：迷宮の踏破から5〜10日で開く',opened!=null&&opened>=5*E.TICKS_PER_DAY&&opened<=10*E.TICKS_PER_DAY+1,'踏破のあと',`${opened}刻`);
}

// 「属性の相性」：名から引く倍率、見せ方、息吹と爆薬、王の黒い炎
function checkAffinity(){
  const E=load(1);
  const want=Object.fromEntries(`
大ネズミ 1.3,1,1
スライム 1.2,1.5,0.6
コボルド 1,1,1
オーク 1,1,1
ゾンビ 1.5,0.7,1
骸骨兵 1.5,0.7,1
巨大蜘蛛 1.3,1,1
吸血コウモリ 1.3,1,1
ガーゴイル 0.5,0.5,1.6
オーガ 1,1,1
レイス 1.5,0.7,1
ミノタウロス 1,1,1
溺れた衛兵 1.5,0.7,1
キメラ 0.4,1.5,1
水路の大蛇 0.8,1,1.5
堕ちた騎士 1,1,1.3
石の巨像 0.5,0.5,1.6
亡霊騎士 1.5,0.7,1
宮廷魔術師の亡霊 1.5,0.7,1
墓所の番犬 0.4,1.5,1
屍喰らい 1.5,0.7,1
吸魂の司祭 1.5,0.7,1
塔の番兵ゴーレム 0.5,0.5,1.6
狂った見習い魔術師 1,1,1
近衛騎士長 1,1,1.3
澱の落とし子 1.2,1.5,0.6
黒竜 0.4,1.5,1
儀式の守護者 1,1,1.3
沈んだ王 1,1,1
岩喰い虫 1.3,1,1
坑夫の亡霊 1.5,0.7,1
崩落蜘蛛 1.3,1,1
鉄喰いトロール 1,1,1
坑道ゴーレム 0.5,0.5,1.6
盲目の洞窟竜 0.4,1.5,1
澱の坑夫 1.2,1.5,0.6
坑道都市の衛兵 1,1,1.3
炉の番人ゴーレム 0.5,0.5,1.6
鉱脈の大蛇 0.8,1,1.5
晶石の亡霊 1.5,0.7,1
地底の巨人 1,1,1
溶岩の獣 0.8,1.2,1
澱の古蟲 1.2,1.5,0.6
堕ちた坑夫長 1,1,1
澱を呑んだ竜 0.4,1.5,1
鉄血の近衛 1,1,1.3
澱の巫女 1.2,1.5,0.6
坑道王の親衛 1,1,1.3
澱呑みの坑道王 1,1,1
ドブ王 1.3,1,1
片耳のコボルド王 1,1,1
首狩りコボルド 1,1,1
泣き女の亡霊 1.5,0.7,1
牢番の亡霊 1.5,0.7,1
大蜘蛛の女王 1.3,1,1
鎖つきのオーガ 1,1,1
市場の大ガーゴイル 0.5,0.5,1.6
首なし騎士 1.5,0.7,1
迷い牛の古株 1,1,1
水路の主 0.8,1,1.5
双頭のキメラ 0.4,1.5,1
暴走した鉄の巨人 0.5,0.5,1.6
溺れた水門番 1.5,0.7,1
目覚めた巨像 0.5,0.5,1.6
鏡の亡霊騎士 1.5,0.7,1
墓守の老婆 1.5,0.7,1
生贄たちの群れ 1.5,0.7,1
番犬の母 0.4,1.5,1
屍の王 1.5,0.7,1
塔の主の使い魔 1,1,1
吸魂の大司祭 1.5,0.7,1
宮廷魔術師長の影 1.5,0.7,1
近衛の旗手 1,1,1.3
澱の母胎 1.2,1.5,0.6
黒衣の騎士団長 1,1,1.3
黒竜の落とし仔 0.4,1.5,1
竜番の骸 1.5,0.7,1
仮面の司祭長 1,1,1.3
玉座の影 1.5,0.7,1
金歯のトロール 1,1,1
ランプ持ちの坑夫頭 1.5,0.7,1
天井の母蜘蛛 1.3,1,1
石の鍛冶頭 0.5,0.5,1.6
酒蔵の主 1.5,0.7,1
鉱脈喰らい 0.8,1,1.5
黒曜の騎士 1,1,1.3
溶鉱炉の竜 0.4,1.5,1
澱の乳母 1.2,1.5,0.6
坑道王の盾持ち 1,1,1.3
`.trim().split('\n').map(s=>{const i=s.lastIndexOf(' ');return [s.slice(0,i),s.slice(i+1)];}));
  const all=[...E.MON.map(m=>m.n),...E.RARES.map(r=>r.n),...E.MINE_RARES.map(r=>r.n)];
  check('属性の相性：表は迷宮と坑道の魔物をすべて含む',all.length===Object.keys(want).length&&all.every(n=>want[n]),'名簿',all.filter(n=>!want[n]).join('、')||`${all.length}体`);
  for(const n of all){const got=['fire','ice','bolt'].map(k=>E.elemMul({n},k)).join(',');
    check('属性の相性：倍率が表のとおり',got===want[n],n,`${got}（表は${want[n]}）`);}
  check('属性の相性：変異種は元の名で決まる',E.elemMul({n:'巨大な黒竜',base:'黒竜'},'fire')===.4&&E.elemMul({n:'澱にまみれたスライム',base:'スライム'},'ice')===1.5,'変異種','元の名を見ていない');
  const phrase={黒竜:'炎に強く、氷に弱い',溶岩の獣:'炎に強く、氷に弱い',ガーゴイル:'炎と氷に強く、雷に弱い',スライム:'炎と氷に弱く、雷に強い',ゾンビ:'炎に弱く、氷に強い',水路の大蛇:'炎に強く、雷に弱い',堕ちた騎士:'雷に弱い',岩喰い虫:'炎に弱い',オーク:'',鉄血の近衛:'雷に弱い',ドブ王:'炎に弱い',溺れた衛兵:'炎に弱く、氷に強い',竜番の骸:'炎に弱く、氷に強い',澱を呑んだ竜:'炎に強く、氷に弱い',坑道王の親衛:'雷に弱い',沈んだ王:''};
  for(const [n,w] of Object.entries(phrase))check('属性の相性：表示の言葉が倍率と一致する',E.elemNote({n})===w,n,`${E.elemNote({n})}（決まりは${w}）`);
  for(const n of all){const note=E.elemNote({n});const bits=note?note.split('、'):[];const seen=[];let ok=true;
    bits.forEach((b,i)=>{const m=b.match(/^(.*)に(弱|強)(い|く)$/);if(!m){ok=false;return;}const names=m[1].split('と');const end=i===bits.length-1?'い':'く';
      if(m[3]!==end)ok=false;for(const jp of names){const k={炎:'fire',氷:'ice',雷:'bolt'}[jp];const mul=k?E.elemMul({n},k):NaN;seen.push(k);
        if(m[2]==='弱'&&!(mul>1))ok=false;if(m[2]==='強'&&!(mul<1))ok=false;}});
    for(const k of ['fire','ice','bolt']){const mul=E.elemMul({n},k);if(mul!==1&&!seen.includes(k))ok=false;if(mul===1&&seen.includes(k))ok=false;}
    check('属性の相性：どの魔物も、表示した強弱が倍率と一致する',ok,n,note||'（相性なし）');}
  // 息吹と爆薬は炎。竜には弱く、等倍の相手には一言が付かない。乱数の進み方は倍率の前後で同じ
  const strike=(seed,cls,mon)=>{const E2=load(seed),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.cls=cls;a.lvl=10;a.hp=a.mhp=500;a.mp=8;a.pers='普通';a.poison=0;a.eq={};
    p.members=[a.id];p.leader=a.id;p.floor=1;p.state='explore';p.fought=true;p.ident=true;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.log=[];
    p.etype=Object.assign({},E2.MON.find(m=>m.n===mon));p.enemies=[{hp:99999,sleep:0}];
    E2.combat(S,p);return {dmg:99999-p.enemies[0].hp,log:p.log.map(x=>x.t).join('\n')};};
  let breath=null,bomb=null;
  for(let seed=1;seed<=80&&(!breath||!bomb);seed++){const b=strike(seed,'竜騎士','オーク');if(!breath&&b.log.includes('りゅうの いぶき'))breath=seed;
    const c=strike(seed,'錬金術師','オーク');if(!bomb&&c.log.includes('ばくやくを なげつけた'))bomb=seed;}
  check('属性の相性：息吹と爆薬が試し打ちできる',!!breath&&!!bomb,'80種',`息吹${breath} 爆薬${bomb}`);
  if(breath){const oak=strike(breath,'竜騎士','オーク'),dr=strike(breath,'竜騎士','黒竜'),lava=strike(breath,'竜騎士','溶岩の獣');
    check('属性の相性：竜の息吹は竜に弱く効く',dr.dmg===Math.round(oak.dmg*.4)&&dr.dmg<oak.dmg&&dr.log.includes('あまり きかない')&&!oak.log.includes('きいた')&&!oak.log.includes('きかない'),`種${breath}`,`オーク${oak.dmg} 黒竜${dr.dmg}`);
    check('属性の相性：竜の息吹は溶岩の獣に弱く効く',lava.dmg===Math.round(oak.dmg*.8)&&lava.dmg<oak.dmg&&lava.log.includes('あまり きかない'),`種${breath}`,`オーク${oak.dmg} 溶岩${lava.dmg}`);
    const hid=strike(breath,'竜騎士','黒竜');const E3=load(breath),S=E3.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.cls='竜騎士';a.lvl=10;a.hp=a.mhp=500;a.mp=0;a.pers='普通';a.poison=0;a.eq={};
    p.members=[a.id];p.leader=a.id;p.floor=1;p.state='explore';p.fought=true;p.ident=false;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.log=[];
    p.etype=Object.assign({},E3.MON.find(m=>m.n==='黒竜'));p.enemies=[{hp:99999,sleep:0}];E3.combat(S,p);
    check('属性の相性：正体がわからなくても息吹の傷には倍率がかかる',99999-p.enemies[0].hp===hid.dmg&&p.log.some(x=>x.t.includes('あまり きかない')),`種${breath}`,`見破る${hid.dmg} まだ${99999-p.enemies[0].hp}`);}
  if(bomb){const oak=strike(bomb,'錬金術師','オーク'),dr=strike(bomb,'錬金術師','黒竜');
    check('属性の相性：爆薬は炎で、竜に弱く効く',dr.dmg===Math.round(oak.dmg*.4)&&dr.dmg<oak.dmg&&dr.log.includes('あまり きかない')&&oak.log.includes('ばくふうに のまれた')&&!oak.log.includes('きいた')&&!oak.log.includes('きかない'),`種${bomb}`,`オーク${oak.dmg} 黒竜${dr.dmg}`);}
  // 呪文の選びは、正体がわかっているときだけ相性を見る。傷の計算とは別
  const cast=(ident)=>{const E2=load(1),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.cls='魔術師';a.lvl=10;a.hp=a.mhp=200;a.mp=8;a.pers='普通';a.poison=0;a.eq={};a.tal=[];
    p.members=[a.id];p.leader=a.id;p.floor=1;p.state='explore';p.fought=true;p.ident=ident;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.log=[];
    p.etype=Object.assign({},E2.MON.find(m=>m.n==='黒竜'));p.enemies=[{hp:500,sleep:0},{hp:500,sleep:0}];
    E2.combat(S,p);return p.log.map(x=>x.t).join('\n');};
  const known=cast(true),unknown=cast(false);
  check('属性の相性：見破ってから相性で呪文を選ぶ',known.includes('コオリ')&&!known.includes('イカズチ')&&unknown.includes('イカズチ')&&!unknown.includes('コオリ'),'黒竜が2体',`見破る「${known.split('\n')[0]}」 まだ「${unknown.split('\n')[0]}」`);
  // 「眠り」：眠りやすさは名で決まる。作り物と不死は眠らず、竜と澱は眠りにくく、獣と虫は眠りやすい
  const sleepWant={ガーゴイル:0,坑道ゴーレム:0,ゾンビ:0,骸骨兵:0,坑夫の亡霊:0,竜番の骸:0,スライム:.5,キメラ:.5,盲目の洞窟竜:.5,澱の坑夫:.5,大ネズミ:1.3,巨大蜘蛛:1.3,溶岩の獣:1.3,オーク:1,鉄喰いトロール:1,堕ちた騎士:1};
  for(const [n,w] of Object.entries(sleepWant))check('眠り：眠りやすさが表のとおり',E.sleepMul({n})===w,n,`${E.sleepMul({n})}（表は${w}）`);
  // ネムリの届く深さは、レベルの半分＋6（魔導士は＋4）。乱数をいつも0にして、唱えられるときは必ず唱えるようにする
  const nemuri=(cls,lvl,floor,mon,ident)=>{const E2=load(1,1e-9),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.cls=cls;a.lvl=lvl;a.hp=a.mhp=99999;a.mp=8;a.pers='普通';a.poison=0;a.eq={};a.tal=[];
    p.members=[a.id];p.leader=a.id;p.floor=floor;p.state='explore';p.fought=true;p.ident=ident;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.log=[];
    p.etype=Object.assign({},E2.MON.find(m=>m.n===mon));p.enemies=Array.from({length:3},()=>({hp:1e9,sleep:0}));
    E2.combat(S,p);return {slept:p.enemies.filter(e=>e.sleep>0).length,mp:a.mp,log:p.log.map(x=>x.t).join('\n')};};
  check('眠り：レベル1の魔術師のネムリはB6Fまで',E.sleepReach({cls:'魔術師',lvl:1})===6.5&&nemuri('魔術師',1,6,'オーク',true).slept===3&&nemuri('魔術師',1,7,'オーク',true).slept===0,'魔術師Lv1',`B6F${nemuri('魔術師',1,6,'オーク',true).slept}体 B7F${nemuri('魔術師',1,7,'オーク',true).slept}体`);
  check('眠り：レベル24の魔導士のネムリはB22Fまで',E.sleepReach({cls:'魔導士',lvl:24})===22&&nemuri('魔導士',24,22,'オーク',true).slept===3&&nemuri('魔導士',24,23,'オーク',true).slept===0,'魔導士Lv24',`B22F${nemuri('魔導士',24,22,'オーク',true).slept}体 B23F${nemuri('魔導士',24,23,'オーク',true).slept}体`);
  {const known=nemuri('魔術師',1,3,'ゾンビ',true),unknown=nemuri('魔術師',1,3,'ゾンビ',false);
    check('眠り：正体のわかった眠らない魔物にはネムリを唱えず、わからなければ唱えて効かない',!known.log.includes('ネムリ')&&unknown.log.includes('ネムリ')&&unknown.log.includes('ねむらなかった')&&unknown.slept===0,'ゾンビ3体',`わかる「${known.log.split('\n')[0]}」 わからない「${unknown.log.split('\n').slice(0,2).join(' ')}」`);}
  // 子守歌も同じ。乱数をいつも0にして、歌えるときは必ず歌う。勇ましい歌はすでにかかっているものとして、子守歌の手番を見る。B6F以上はログの文字が乱れるので、文言はB5Fで見る
  const lullaby=(mon,ident,floor)=>{const E2=load(1,1e-9),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.cls='吟遊詩人';a.lvl=10;a.hp=a.mhp=99999;a.mp=8;a.pers='普通';a.poison=0;a.eq={};a.tal=[];a.fear=null;
    p.members=[a.id];p.leader=a.id;p.floor=floor;p.state='explore';p.fought=true;p.ident=ident;p.ambush=false;p.potions=0;p.guard=0;p.buff=1;p.log=[];
    p.etype=Object.assign({},E2.MON.find(m=>m.n===mon));p.enemies=Array.from({length:2},()=>({hp:1e9,sleep:0}));
    E2.combat(S,p);return {slept:p.enemies.filter(e=>e.sleep>0).length,mp:a.mp,hp:p.enemies[0].hp,log:p.log.map(x=>x.t).join('\n')};};
  {const known=lullaby('ゾンビ',true,5),unknown=lullaby('ゾンビ',false,5),golem=lullaby('ガーゴイル',true,5);
    check('眠り：正体のわかった眠らない魔物には子守歌を歌わず、わからなければ歌って効かない',!known.log.includes('こもりうた')&&known.mp===8&&known.slept===0&&known.hp<1e9&&!golem.log.includes('こもりうた')&&golem.mp===8&&unknown.log.includes('こもりうた')&&unknown.log.includes('ねむらなかった')&&unknown.slept===0&&unknown.mp===7&&unknown.hp===1e9,'ゾンビとガーゴイルが2体',`わかる「${known.log.split('\n')[0]}」MP${known.mp} わからない「${unknown.log.split('\n').slice(0,2).join(' / ')}」MP${unknown.mp}`);}
  {const oak=lullaby('オーク',true,25),slime=lullaby('スライム',true,25),deep=lullaby('坑道ゴーレム',true,40),half=lullaby('澱の坑夫',true,40);
    check('眠り：眠れる群れと眠りにくい群れには深い階でも子守歌を歌い、眠らない群れには歌わない',oak.slept===2&&oak.mp===7&&oak.hp===1e9&&slime.slept===2&&slime.mp===7&&half.slept===2&&half.mp===7&&deep.slept===0&&deep.mp===8&&deep.hp<1e9,'B25Fのオークとスライム、坑道の澱の坑夫とゴーレム',`オーク${oak.slept}体 スライム${slime.slept}体 澱${half.slept}体 ゴーレムMP${deep.mp}`);}
  // 沈んだ王と坑道王の黒い炎は、炎を防ぐ装備では軽くならない。ふつうの炎の息は軽くなる
  const hurt=(seed,mon,fire)=>{const E2=load(seed),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.cls='戦士';a.lvl=8;a.hp=a.mhp=50000;a.mp=0;a.pers='普通';a.poison=0;a.eq=fire?{body:{fire,slot:'body'}}:{};
    p.members=[a.id];p.leader=a.id;p.floor=1;p.state='explore';p.fought=true;p.ident=true;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.log=[];
    p.etype=Object.assign({},E2.MON.find(m=>m.n===mon));p.enemies=[{hp:99999,sleep:0}];
    E2.combat(S,p);return {dmg:50000-a.hp,log:p.log.map(x=>x.t).join('\n')};};
  let black=false,breathHit=false;
  for(let seed=1;seed<=40;seed++){for(const mon of ['沈んだ王','澱呑みの坑道王']){const a=hurt(seed,mon,0),b=hurt(seed,mon,.8);
      if(a.log.includes('くろい ほのお'))black=true;
      check('属性の相性：黒い炎は炎の耐性では軽くならない',a.dmg===b.dmg,`${mon}・種${seed}`,`なし${a.dmg} 耐性${b.dmg}`);}
    const a=hurt(seed,'キメラ',0),b=hurt(seed,'キメラ',.5);
    if(a.log.includes('ほのおを はいた')){breathHit=true;check('属性の相性：ふつうの炎の息は炎の耐性で軽くなる',b.dmg<a.dmg,`キメラ・種${seed}`,`なし${a.dmg} 耐性${b.dmg}`);}
    else check('属性の相性：炎の息を吐かなければ耐性では変わらない',a.dmg===b.dmg,`キメラ・種${seed}`,`なし${a.dmg} 耐性${b.dmg}`);}
  check('属性の相性：黒い炎と炎の息の両方を試し打ちした',black&&breathHit,'40種',`黒い炎${black} 炎の息${breathHit}`);
  // 「罠と宝箱」：2割を切った者がいるときは、無謀と強欲以外は開けない。判定は手当てよりあと
  const trip0=()=>({mats:{},kills:{},items:[],found:[],deep:4,chests:0,crits:[],traps:[],close:[],deaths:[],met:[],poison:[],fled:0,slept:0,heals:0,big:null,rec:false,lv:[],empty:0});
  const chestScene=(pers,hp,{thief=false,dead=false,mhp=100}={})=>{
    const E=load(1,1e-9),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.floor=4;p.state='explore';p.enemies=null;p.log=[];p.loot=0;p.trip=trip0();p.maps={};p.tmap={};p.potions=0;
    p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.hp=a.mhp=100;a.mp=0;a.poison=0;a.cls='戦士';a.traits=[];a.lvl=8;});
    const L=S.adv[p.leader];L.pers=pers;L.cls=thief?'盗賊':'戦士';L.hp=L.mhp=100;
    const hurt=S.adv[p.members.find(id=>id!==p.leader)];hurt.mhp=mhp;hurt.hp=hp;
    if(dead){const id=p.members.find(x=>x!==p.leader&&x!==hurt.id);if(id)S.adv[id].hp=0;}
    const n0=S.news.length;E.chest(S,p);
    return {log:p.log.map(l=>l.t).join('\n'),chests:p.trip.chests,loot:p.loot,hp:hurt.hp,name:L.name,news:S.news.length-n0};
  };
  {const w=chestScene('普通',19);
    check('罠と宝箱：体力が2割を切った者がいると、普通のリーダーは宝箱を開けない',w.chests===0&&w.loot===0&&w.hp===19&&w.log.includes(`${w.name}「けがにんが いる。はこは あきらめろ」`)&&w.log.includes('たからばこが ある')&&!w.log.includes('わな')&&w.news===0,'HP19/100',w.log);}
  {const w=chestScene('普通',1,{mhp:12});
    check('罠と宝箱：HP1/12でも見送りの一言が出て、罠も金も出ない',w.chests===0&&w.loot===0&&w.hp===1&&w.log.includes('けがにんが いる'),'HP1/12',w.log);}
  for(const pers of ['慎重','臆病']){const w=chestScene(pers,19);
    check('罠と宝箱：けが人がいるときは、慎重や臆病でも罠を怖がる一言より見送りが先',w.chests===0&&w.log.includes('けがにんが いる')&&!w.log.includes('わなが こわい'),pers,w.log);}
  {const w=chestScene('慎重',100);
    check('罠と宝箱：けが人がいなければ、盗賊のいない慎重なリーダーはこれまでどおり開けない',w.chests===0&&w.loot===0&&w.log.includes('わなが こわい')&&!w.log.includes('けがにん'),'HP満タン',w.log);}
  {const w=chestScene('普通',19,{thief:true});
    check('罠と宝箱：盗賊がいても、2割を切った者がいれば普通のリーダーは開けない',w.chests===0&&w.log.includes('けがにんが いる')&&!w.log.includes('わなを はずした'),'盗賊あり',w.log);}
  for(const pers of ['無謀','強欲']){const w=chestScene(pers,19,{thief:pers==='強欲'});
    check('罠と宝箱：無謀と強欲のリーダーは、2割を切っていても宝箱を開ける',w.chests===1&&w.loot>0&&!w.log.includes('けがにん'),pers,w.log);}
  {const w=chestScene('普通',20);
    check('罠と宝箱：体力がちょうど2割のときは見送りに当たらず、箱を開ける',w.chests===1&&!w.log.includes('けがにん'),'HP20/100',w.log);}
  {const w=chestScene('普通',2,{mhp:10});
    check('罠と宝箱：最大体力10で2のときはちょうど2割で、箱を開ける',w.chests===1&&!w.log.includes('けがにん'),'HP2/10',w.log);}
  {const w=chestScene('普通',100,{dead:true});
    check('罠と宝箱：倒れて担がれているだけでは、2割未満の見送りには当たらない',w.chests===1&&!w.log.includes('けがにん'),'死者1人・ほかは満タン',w.log);}
  {const win=(hp,cls,mp)=>{const E=load(1,1e-9),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
      p.floor=4;p.state='explore';p.log=[];p.loot=0;p.trip=trip0();p.maps={};p.tmap={};p.potions=0;p.buff=0;p.guard=0;
      p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.hp=a.mhp=100;a.mp=0;a.poison=0;a.cls='戦士';a.traits=[];a.lvl=8;a.pers='普通';});
      const L=S.adv[p.leader];L.pers='普通';const heal=S.adv[p.members.find(id=>id!==L.id)];heal.cls=cls;heal.mp=mp;
      const hurt=S.adv[p.members.find(id=>id!==L.id&&id!==heal.id)];hurt.hp=hp;
      p.etype={n:'スライム',f:1};p.enemies=[{hp:1}];
      E.victory(S,p);return {log:p.log.map(l=>l.t).join('\n'),chests:p.trip.chests,hp:hurt.hp};};
    const still=win(1,'錬金術師',3),over=win(15,'錬金術師',3),plain=win(19,'戦士',0);
    check('罠と宝箱：勝ったあとの手当てでも2割を切っていれば、その箱は開けない',still.chests===0&&still.hp<20&&still.log.includes('ひやく')&&still.log.includes('けがにんが いる'),'HP1が秘薬のあと',`${still.hp} ${still.log}`);
    check('罠と宝箱：手当てで2割以上に戻っていれば、その箱は開ける',over.chests===1&&over.hp>=20&&over.log.includes('ひやく')&&!over.log.includes('けがにん'),'HP15が秘薬のあと',`${over.hp} ${over.log}`);
    check('罠と宝箱：手当てがなければ、勝った直後の体力のまま見送る',plain.chests===0&&plain.hp===19&&plain.log.includes('けがにんが いる')&&!plain.log.includes('ひやく'),'戦士だけ',plain.log);}
  // 「画面と語り」：水晶の一言と札の理由。表示だけで、知らせは増えない
  const dangerScene=mut=>{const E=load(2),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.state='explore';p.floor=4;p.enemies=null;p.pushWhy=null;p.maps={[4]:1};p.tmap={};p.potions=0;
    p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.hp=a.mhp=100;a.mp=5;a.poison=0;a.cls='戦士';a.lvl=8;a.traits=[];});
    const L=S.adv[p.leader];L.pers='普通';L.cls='戦士';L.mp=0;L.hp=L.mhp=100;
    const n0=S.news.length;mut(S,p,L);const d=E.partyDanger(S,p);
    return {d,p,S,E,L,news:S.news.length-n0,band:id=>E.hpBand(S.adv[id])};};
  {const hurtId=(p,L)=>p.members.find(id=>id!==L.id);
    const w=dangerScene((S,p,L)=>{const a=S.adv[hurtId(p,L)];a.mhp=12;a.hp=1;});
    const name=w.S.adv[hurtId(w.p,w.L)].name;
    check('危険の知らせ：2割を切った者の名前で深手の一言が出て、札は深手と出る',w.d&&w.d.key==='wound'&&w.d.line===`${name}が ふかでを おっている`&&w.d.card==='深手の者がいる'&&!w.d.thought&&!w.d.fight&&w.news===0&&w.band(hurtId(w.p,w.L))==='crit','HP1/12',JSON.stringify(w.d));
    const tie=dangerScene((S,p,L)=>{const ids=p.members.filter(id=>id!==L.id);S.adv[ids[0]].hp=10;S.adv[ids[1]].hp=10;S.adv[ids[0]].mhp=S.adv[ids[1]].mhp=100;});
    check('危険の知らせ：深手が同じ割合なら、並びの先の名前を出す',tie.d&&tie.d.line.startsWith(tie.S.adv[tie.p.members.find(id=>id!==tie.L.id)].name),'二人とも1割',tie.d&&tie.d.line);
    const exact=dangerScene((S,p,L)=>{const a=S.adv[hurtId(p,L)];a.hp=20;});
    check('危険の知らせ：ちょうど2割は深手にせず、帯は少ない側になる',!exact.d&&exact.band(hurtId(exact.p,exact.L))==='low','HP20/100',JSON.stringify(exact.d));
    const mid=dangerScene((S,p,L)=>{const a=S.adv[hurtId(p,L)];a.hp=30;});
    check('危険の知らせ：35%未満でも2割以上なら、深手の一言は出さず帯は少ない側',!mid.d&&mid.band(hurtId(mid.p,mid.L))==='low','HP30/100',JSON.stringify(mid.d));
    const ok=dangerScene((S,p,L)=>{S.adv[hurtId(p,L)].hp=50;});
    check('危険の知らせ：35%以上は一言も出さず、帯はふつうの色',!ok.d&&ok.band(hurtId(ok.p,ok.L))==='','HP50/100','');
    const dead=dangerScene((S,p,L)=>{S.adv[hurtId(p,L)].hp=0;});
    check('危険の知らせ：倒れた者は深手ではなく死んだ色で、それだけでは一言が出ない',!dead.d&&dead.band(hurtId(dead.p,dead.L))==='dead','HP0',JSON.stringify(dead.d));}
  {const hurtId=(p,L)=>p.members.find(id=>id!==L.id);
    const near=dangerScene((S,p,L)=>{p.state='return';p.members.forEach(id=>{S.adv[id].hp=10;});S.adv[hurtId(p,L)].mhp=12;S.adv[hurtId(p,L)].hp=1;});
    check('帰還中の札：深手の者がいて体力の合計が引き返す目安の半分を下回れば、全滅が近いとみる',near.E.returnPeril(near.S,near.p)===true,'普通・HP1割',near.E.retreatLine(near.S,near.p));
    const calm=dangerScene((S,p,L)=>{p.state='return';S.adv[hurtId(p,L)].mhp=12;S.adv[hurtId(p,L)].hp=1;});
    check('帰還中の札：深手の者がいても体力の合計が多ければ、全滅が近いとはみない',calm.E.returnPeril(calm.S,calm.p)===false,'ほかは満タン','');
    const breath=dangerScene((S,p)=>{p.state='return';p.members.forEach(id=>{S.adv[id].hp=21;});});
    check('帰還中の札：深手の者がいなければ、体力が少なくても全滅が近いとはみない',breath.d&&breath.d.key==='breath'&&breath.E.returnPeril(breath.S,breath.p)===false,'全員HP21%',JSON.stringify(breath.d));
    const half=dangerScene((S,p,L)=>{p.state='return';p.members.forEach(id=>{S.adv[id].hp=21;});S.adv[hurtId(p,L)].hp=10;L.hp=32;});
    check('帰還中の札：体力の合計がちょうど目安の半分なら、全滅が近いとはみない',half.E.returnPeril(half.S,half.p)===false,'合計21%・線42%','');}
  {const poison=dangerScene((S,p,L)=>{const a=S.adv[p.members.find(id=>id!==L.id)];a.poison=1;a.cls='戦士';p.potions=10;});
    const name=poison.S.adv[poison.p.members.find(id=>id!==poison.L.id)].name;
    check('危険の知らせ：ドクケシを唱える者がいない毒は、回復薬があっても抜けない',poison.d&&poison.d.key==='poison'&&poison.d.line===`${name}の どくが ぬけない`&&poison.d.card==='毒が抜けない'&&poison.news===0,'僧侶なし・回復薬10',JSON.stringify(poison.d));
    const cured=dangerScene((S,p,L)=>{const ids=p.members.filter(id=>id!==L.id);S.adv[ids[0]].poison=1;S.adv[ids[1]].cls='僧侶';S.adv[ids[1]].mp=3;});
    check('危険の知らせ：呪文の残った癒し手がいれば、毒の一言は出ない',!cured.d,'僧侶MP3',JSON.stringify(cured.d));
    const dry=dangerScene((S,p,L)=>{const ids=p.members.filter(id=>id!==L.id);S.adv[ids[0]].poison=1;S.adv[ids[1]].cls='僧侶';S.adv[ids[1]].mp=0;p.potions=8;});
    check('危険の知らせ：癒し手の呪文が尽きていれば、毒の一言が呪文切れより先',dry.d&&dry.d.key==='poison'&&dry.d.card==='毒が抜けない','僧侶MP0・回復薬8',JSON.stringify(dry.d));
    const spells=dangerScene((S,p,L)=>{const a=S.adv[p.members.find(id=>id!==L.id)];a.cls='僧侶';a.mp=0;p.potions=8;});
    check('危険の知らせ：毒が無く呪文だけ尽きたときは、癒し手の一言で札には出さない',spells.d&&spells.d.key==='spells'&&spells.d.line==='いやしての じゅもんが つきた'&&!spells.d.card,'僧侶MP0',JSON.stringify(spells.d));}
  {const low=dangerScene((S,p)=>{p.members.forEach(id=>{S.adv[id].hp=50;});});
    check('危険の知らせ：体力の合計が引き返す目安より1割低いと、息が上がっている',low.d&&low.d.key==='breath'&&low.d.line==='いっこうの いきが あがっている'&&low.d.card==='息が上がっている'&&Math.abs(low.E.retreatLine(low.S,low.p)-.42)<1e-9,'普通・HP50%',JSON.stringify(low.d));
    const young=dangerScene((S,p)=>{p.members.forEach(id=>{const a=S.adv[id];a.lvl=1;a.hp=60;});});
    check('危険の知らせ：平均が低い一行は、引き返す線が上がったところで息が上がる',young.d&&young.d.key==='breath'&&young.E.retreatLine(young.S,young.p)>.5,'Lv1・HP60%',`線${young.E.retreatLine(young.S,young.p)}`);
    const push=dangerScene((S,p)=>{p.pushWhy='race';p.members.forEach(id=>{S.adv[id].hp=40;});});
    check('危険の知らせ：深みを目指す理由があると、息の線もその分下がる',push.d&&push.d.key==='breath'&&Math.abs(push.E.retreatLine(push.S,push.p)-.36)<1e-9,'目安0.36・HP40%',`線${push.E.retreatLine(push.S,push.p)}`);}
  {const front=dangerScene((S,p,L)=>{p.floor=12;p.maps={};const a=S.adv[p.members.find(id=>id!==L.id)];a.cls='僧侶';a.mp=1;p.members.forEach(id=>{if(id!==a.id)S.adv[id].mp=0;S.adv[id].hp=55;});});
    check('危険の知らせ：地図のない最前線で、息か呪文に近いときだけその一言が出る',front.d&&front.d.key==='front'&&front.d.line==='ちずの ない さいぜんせんに いる'&&!front.d.card,'B12F・HP55%・僧侶MP1',JSON.stringify(front.d));
    const deep=dangerScene((S,p,L)=>{p.floor=20;p.maps={};const a=S.adv[p.members.find(id=>id!==L.id)];a.cls='僧侶';a.mp=5;});
    check('危険の知らせ：安全な深さより下なだけでは一言を出さない',!deep.d,'B20F・体力も呪文も足りている',JSON.stringify(deep.d));
    const mapped=dangerScene((S,p,L)=>{p.floor=12;p.maps={12:1};p.members.forEach(id=>{S.adv[id].hp=55;});});
    check('危険の知らせ：地図があれば、最前線でもその一言は出ない',!mapped.d,'B12F・地図あり・HP55%',JSON.stringify(mapped.d));
    const far=dangerScene((S,p,L)=>{p.floor=12;p.maps={};const a=S.adv[p.members.find(id=>id!==L.id)];a.cls='僧侶';a.mp=2;});
    check('危険の知らせ：呪文が2残っていて体力にも余裕があれば、最前線だけでは出ない',!far.d,'B12F・僧侶MP2',JSON.stringify(far.d));}
  {const wild=dangerScene((S,p,L)=>{S.adv[p.leader].pers='無謀';const a=S.adv[p.members.find(id=>id!==L.id)];a.hp=10;p.enemies=[{hp:5}];});
    check('危険の知らせ：無謀なリーダーは深手でも引き返さず、戦いの最中はその注が付く',wild.d&&wild.d.key==='wound'&&wild.d.thought==='リーダーは ひきかえす きが ない'&&wild.d.fight==='たたかいの さいちゅう。いま めいじても にげきれるとは かぎらない','無謀・戦闘中',JSON.stringify(wild.d));
    const greed=dangerScene((S,p,L)=>{S.adv[p.leader].pers='強欲';S.adv[p.members.find(id=>id!==L.id)].hp=10;});
    check('危険の知らせ：強欲のリーダーには、引き返さない一言は出さない',greed.d&&greed.d.key==='wound'&&!greed.d.thought&&!greed.d.fight,'強欲',JSON.stringify(greed.d));
    const calm=dangerScene((S,p,L)=>{S.adv[p.leader].pers='無謀';});
    check('危険の知らせ：無謀でも深手がなければ、リーダーの考えは出さない',!calm.d,'無謀・満タン',JSON.stringify(calm.d));}
  // 全滅の一文と、引き返す歩数を過ぎた札。乱数では選ばない
  {const scene=()=>{const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');return {E,S,p};};
    const prep=(E,S,p,opt={})=>{
      p.state='explore';p.floor=opt.floor||4;p.maps={};p.tmap={};p.plan='normal';p.pushWhy=null;p.enemies=null;
      p.trip=p.trip||{};p.trip.poison=opt.poison||[];p.trip.deep=opt.deep||p.floor;p.cause='';p.killer='';
      p.knownWiped=false;p.announced=false;p.retrieved=false;p.steps=0;
      p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp||10;a.mp=5;a.cls='戦士';a.status='party';a.poison=0;});
      if(opt.healer){const a=S.adv[p.members[0]];a.cls='僧侶';a.mp=opt.mp==null?0:opt.mp;}
      if(opt.floor)S.floors=Object.assign({},S.floors,{[opt.floor]:opt.through?{through:1}:{}});
      S.watch=opt.watch?[p.id,null]:[null,null];
      return p;
    };
    {const {E,S,p}=scene();prep(E,S,p,{healer:true,mp:0,poison:['誰か']});const n0=S.news.length;p.steps=40;E.wipe(S,p,'オーク');
      const told=()=>p.members.some(id=>(S.adv[id].chron||[]).some(c=>c.t.startsWith('全滅した。')));
      check('全滅：癒し手の呪文が尽きた一文は、毒より先で決まり、見ていなければ手帳にも知らせにもその場では出ない',p.cause==='癒し手の呪文が尽きていた'&&!told()&&!p.causeTold&&S.news.length===n0&&p.dueAt===S.tick+E.overdueSteps(p)-40&&S.v===SAVE_V,'僧侶MP0・毒あり・40歩',`${p.cause} 手帳${told()} 予定${p.dueAt}`);
      Object.values(S.parties).forEach(q=>{if(q!==p){q.state='town';q.rest=99;}});
      check('全滅：予定帰還の刻までは隠れていて、まだ戻らないとも出ない',E.wipeHidden(p)&&!E.partyOverdue(S,p),'全滅直後',`隠れ${E.wipeHidden(p)} 遅れ${E.partyOverdue(S,p)}`);
      S.tick=p.dueAt;check('全滅：予定帰還の刻を過ぎると、隠れたまま、まだ戻らないになる',E.wipeHidden(p)&&E.partyOverdue(S,p),'予定の刻',`隠れ${E.wipeHidden(p)} 遅れ${E.partyOverdue(S,p)}`);
      S.tick=p.dueAt+E.MISSING_GRACE-1;E.tick(S);
      const n=S.news.slice(n0).find(x=>x.t.includes(p.name));
      check('全滅：消息不明の知らせは予定帰還の刻から MISSING_GRACE 刻あとに出て、死因も階も入らない',!!n&&p.announced&&!E.wipeHidden(p)&&n.t.startsWith(`${p.name}が予定を過ぎても戻らない。`)&&!n.t.includes('癒し手')&&!/B\d+F/.test(n.t)&&n.k==='death'&&!told()&&!p.causeTold,`${E.MISSING_GRACE}刻後`,n?n.t:'知らせなし');
      // 見ていれば、その場で死因が手帳と知らせに出て、消息不明の期間はない
      const {E:E2,S:S2,p:p2}=scene();prep(E2,S2,p2,{healer:true,mp:0,watch:true});E2.wipe(S2,p2,'オーク');
      const told2=p2.members.every(id=>(S2.adv[id].chron||[]).some(c=>c.tk===S2.tick&&c.t==='全滅した。癒し手の呪文が尽きていた'));
      check('全滅：水晶で見ていれば、その場で手帳に一文が残り、隠れない',told2&&p2.causeTold&&p2.knownWiped&&p2.announced&&!E2.wipeHidden(p2),'見ていた',`手帳${told2}`);}
    {const {E,S,p}=scene();prep(E,S,p,{watch:true});E.wipe(S,p,'オーク');
      const n=S.news.slice(-1)[0].t;
      check('全滅：癒し手がいなければ、その一文を水晶の知らせに添える',p.cause==='癒し手がひとりもいなかった'&&n.includes('癒し手がひとりもいなかった')&&n.includes('オークに倒れる'),'戦士だけ',n);}
    {const {E,S,p}=scene();prep(E,S,p,{healer:true,mp:4,watch:true});E.wipe(S,p,'オーク');
      const n=S.news.slice(-1)[0].t;
      const chron=p.members.every(id=>(S.adv[id].chron||[]).some(c=>c.t==='全滅した。オークに倒れた'));
      check('全滅：倒した相手の繰り返しは、水晶の知らせに重ねない',p.cause==='オークに倒れた'&&n.includes('オークに倒れる')&&!n.includes('オークに倒れた')&&chron,'僧侶MP4・B4F',n);}
    {const {E,S,p}=scene();prep(E,S,p,{poison:['誰か']});E.wipe(S,p,'オーク');
      check('全滅：毒が抜けない一文は、癒し手不在より先',p.cause==='毒が抜けないまま倒れた','毒あり・戦士だけ',p.cause);}
    {const {E,S,p}=scene();prep(E,S,p,{healer:true,mp:3});E.wipe(S,p,'宝箱のどくばり');
      check('全滅：宝箱の罠なら、その一文',p.cause==='宝箱の罠にかかっていた','僧侶MP3・B4F',p.cause);}
    {const {E,S,p}=scene();prep(E,S,p,{healer:true,mp:4,floor:12});E.wipe(S,p,'オーク');
      check('全滅：地図のない最前線なら、その一文',p.cause==='地図のない最前線で倒れた','B12F・地図なし・僧侶MP4',p.cause);}
    {const {E,S,p}=scene();const a=S.adv[p.leader];
      p.state='explore';p.floor=2;p.enemies=null;p.members.forEach(id=>{const m=S.adv[id];m.hp=m.mhp;m.status='party';m.pers='普通';m.quirk='無口';m.fear=null;m.traits=[];m.cls='戦士';});
      const def=E.ERRANDS.find(x=>x.k==='kitten');const plain=E.fitOf(def,a);
      check('依頼：向きも不向きもなければ、向かなかったと書く',E.errandFailLine(def,a,plain)==='心得のない者に「迷い込んだ子猫」は向かなかった','無口・普通',JSON.stringify(plain));
      a.fear='獣';const fear=E.fitOf(def,a);
      check('依頼：不向きがあれば、その一言を書く',E.errandFailLine(def,a,fear)===`獣を嫌う${a.name}は、子猫に手を伸ばせなかった`,'獣が怖い',JSON.stringify(fear));
      a.fear=null;a.quirk='猫好き';const like=E.fitOf(def,a);
      check('依頼：向いていて果たせなければ、手を尽くしたと書く',E.errandFailLine(def,a,like)===`${a.name}は手を尽くしたが、目当てのものは見つからなかった`,'猫好き',JSON.stringify(like));
      const F=load(1,0.99),T=F.newState(),q=Object.values(T.parties).find(x=>x.tav==='ours'),h=T.adv[q.leader];
      q.state='explore';q.floor=2;q.enemies=null;q.members.forEach(id=>{const m=T.adv[id];m.hp=m.mhp;m.status='party';m.pers='普通';m.quirk='無口';m.fear=null;m.traits=[];m.cls='戦士';});
      const run=(mut)=>{mut();const e={id:1,k:'kitten',n:'迷い込んだ子猫',f:2,hero:h.id};F.errandEvent(T,q,e);
        return {news:T.news.slice(-1)[0].t,chron:(h.chron||[]).slice(-1)[0].t};};
      const none=run(()=>{});
      check('依頼：向かなかった一文は、知らせと手帳に残る',none.news.includes('心得のない者に「迷い込んだ子猫」は向かなかった')&&none.chron===`店主に回された「迷い込んだ子猫」をしくじる。心得のない者に「迷い込んだ子猫」は向かなかった`,'手がかりなし',none.news+' / '+none.chron);
      const scared=run(()=>{h.fear='獣';});
      check('依頼：不向きの一文は、知らせと手帳に残る',scared.news.includes(`獣を嫌う${h.name}は、子猫に手を伸ばせなかった`)&&scared.chron.includes('をしくじる。')&&scared.chron.includes(`獣を嫌う${h.name}は、子猫に手を伸ばせなかった`),'獣が怖い',scared.news);
      const suited=run(()=>{h.fear=null;h.quirk='猫好き';});
      check('依頼：手を尽くした一文は、知らせと手帳に残る',suited.news.includes(`${h.name}は手を尽くしたが、目当てのものは見つからなかった`)&&suited.chron.includes('をしくじる。')&&suited.chron.includes('手を尽くしたが'),'猫好きなのに果たせない',suited.news);}
    {const {E,S,p}=scene();p.tav='ours';p.state='explore';p.plan='normal';p.announced=false;p.knownWiped=false;p.steps=200;p.trip={deep:1};
      check('まだ戻らない：ふつうの回は、160歩に深さの6倍を足した歩数を過ぎると真',E.partyOverdue(S,p)===true,'200歩・B1F',p.steps);
      p.steps=100;check('まだ戻らない：引き返す歩数の内側では偽',E.partyOverdue(S,p)===false,'100歩',p.steps);
      p.plan='grind';p.steps=230;check('まだ戻らない：腕を磨く回は220歩が基準',E.partyOverdue(S,p)===true,'230歩',p.steps);
      p.steps=220;check('まだ戻らない：腕を磨く回の基準ちょうどでは偽',E.partyOverdue(S,p)===false,'220歩',p.steps);
      p.plan='normal';p.steps=200;p.state='town';check('まだ戻らない：街にいるあいだは偽',E.partyOverdue(S,p)===false,'休息',p.state);
      p.state='explore';p.tav='rival';check('まだ戻らない：銀の杯亭の札には出さない',E.partyOverdue(S,p)===false,'銀の杯亭',p.tav);
      p.tav='ours';p.trip={deep:35};p.steps=200;check('まだ戻らない：坑道の深さは入口から数える',E.partyOverdue(S,p)===true,'坑道B5F・200歩',p.trip.deep);}
  }
}

// 「便り」「次の世代」「記念碑」の場面。乱数を固定して、届くときと届かないときを分ける
function checkLetters(){
  const day=50;
  const oursOf=S=>Object.values(S.adv).filter(a=>a.tav==='ours').sort((a,b)=>a.id-b.id);
  const bond=(S,a,b,n)=>{const k=a.id<b.id?`${a.id}-${b.id}`:`${b.id}-${a.id}`;S.bonds=S.bonds||{};S.bonds[k]={n,ev:[{tk:1,t:'一緒に潜った'}]};};
  // 恩のある常連。1通目は20日、品が付き、2通目で子の誕生、3通目で歩きはじめ。金と紹介状は来ない
  {const E=load(1,1e-9),S=E.newState();const [a,b]=oursOf(S);
    a.trips=5;a.favor=3;a.status='idle';a.party=null;a.pastDreams=[{k:'marry',who:'故郷で待つ幼なじみ',t:'幼なじみと所帯を持つための金を貯めたい',tk:1}];
    b.status='idle';b.party=null;b.eq={};oursOf(S).slice(2).forEach(x=>{x.status='party';});bond(S,a,b,5);
    const t0=S.tick;E.retire(S,a,'所帯を持つ');const g1=S.taverns.ours.gold;
    check('便り：恩が2以上の1通目は、去ってから20〜40日',a.nextLetter>=t0+20*day&&a.nextLetter<=t0+40*day&&a.nextLetter%day===0,'所帯を持つ',`${(a.nextLetter-t0)/day}日`);
    check('次の世代：所帯を持って去ると、1〜2年後の弟妹か甥姪と、暦どおりの子の予定が付く',a.kinDue&&a.kinDue.kind==='ysib'&&a.kinDue.tk>=t0+365*day&&a.kinDue.tk<=t0+730*day&&a.childAt>a.kinDue.tk,'所帯を持つ',`身内${a.kinDue&&(a.kinDue.tk-t0)/day}日 子${a.childAt&&(a.childAt-t0)/day}日`);
    S.tick=a.nextLetter;E.letterTick(S);
    const news=S.news.filter(n=>n.k==='letter');
    const gift=b.eq&&b.eq.acc;
    check('便り：1通目は便りの知らせになり、絆の深い者へ小さな品が添う',news.length===1&&news[0].t.startsWith('【便り】')&&news[0].t.includes('幼なじみ')&&news[0].t.includes('添えてあった')&&gift&&gift.ac===1&&gift.slot==='acc'&&String(gift.lore).includes('故郷から送った')&&(a.chron||[]).some(c=>c.t==='黒猫亭に便りを寄越す')&&S.taverns.ours.gold===g1&&!news[0].t.includes('為替')&&!news[0].t.includes('紹介状'),
      '1通目',news.map(n=>n.t).join(' / ')+` 品${gift&&gift.n}`);
    // 店の金は、去るときに置いていった恩だけで、便りでは増えない
    S.tick=a.nextLetter;E.letterTick(S);
    const second=a.letters[1];
    check('便り：所帯を持った者の2通目は、120〜240日あとで、子が生まれたと知らせる',a.letters.length===2&&second&&(second.tk-a.letters[0].tk)/day>=120&&(second.tk-a.letters[0].tk)/day<=240&&second.line.includes('子が生まれた')&&S.taverns.ours.gold===g1,'2通目',second&&second.line);
    S.tick=a.nextLetter;E.letterTick(S);
    check('便り：3通で終わり、3通目は子が歩いていると書く',a.letters.length===3&&a.letterDone&&a.nextLetter==null&&a.letters[2].line.includes('歩いて')&&(a.letters[2].tk-a.letters[1].tk)/day>=120,'3通目',a.letters[2]&&a.letters[2].line);
    // 歳の離れた弟妹。席がなければ来ない。空いていれば、兄か姉のように名を上げる夢で来る
    const u=E.seatsUsed(S,'ours');S.taverns.ours.seats=u;S.tick=a.kinDue.tk;const n0=S.news.length;E.kinTick(S);
    check('次の世代：席が埋まっていれば、その回は来ずに故郷へ帰る',!Object.values(S.adv).some(x=>x.kin)&&S.news.slice(n0).some(n=>n.t.includes('席がなかった')),'満席',S.news.slice(n0).map(n=>n.t).join(' / '));
    S.taverns.ours.seats=u+1;a.kinDue={tk:S.tick,kind:'ysib'};E.kinTick(S);
    const ys=Object.values(S.adv).find(x=>x.kin&&x.kin.id===a.id);
    check('次の世代：歳の離れた弟妹は、種族と出身を継ぎ、兄か姉のように名を上げる夢を持つ',!!ys&&ys.race===a.race&&ys.origin===a.origin&&ys.lvl>=1&&ys.lvl<=5&&ys.dream&&ys.dream.k==='kinname'&&(ys.dream.uncle==='兄'||ys.dream.uncle==='姉')&&E.dreamText(ys.dream).includes('黒猫亭で名を上げたい')&&(a.kinOf||[]).some(k=>k.id===ys.id)&&(ys.sex==='女'?ys.kin.rel==='妹':ys.kin.rel==='弟'),
      '弟妹',ys&&`${ys.name} ${ys.sex}の${ys.kin.rel} 「${E.dreamText(ys.dream)}」`);
    S.taverns.ours.seats=E.seatsUsed(S,'ours')+1;S.tick=a.childAt;E.kinTick(S);
    const ch=Object.values(S.adv).find(x=>x.kin&&x.kin.id===a.id&&x!==ys);
    check('次の世代：子は暦の日に、父か母のように名を上げる夢で来る',!!ch&&ch.dream&&ch.dream.k==='kinname'&&(ch.dream.uncle==='父'||ch.dream.uncle==='母')&&ch.lvl<=5&&(ch.sex==='女'?ch.kin.rel==='娘':ch.kin.rel==='息子'),'子',ch&&`${ch.name} ${ch.kin.rel} 「${E.dreamText(ch.dream)}」`);}
  // 品は4通に1通ほど。乱数を半分に固定すると添わない。探索3回未満と銀の杯亭からは来ない
  {const E=load(2,0.5),S=E.newState();const [a,b,c]=oursOf(S);const r=Object.values(S.adv).find(x=>x.tav==='rival');
    a.trips=4;a.favor=0;a.status='idle';a.party=null;b.status='idle';b.eq={};bond(S,a,b,3);oursOf(S).slice(1).forEach(x=>{if(x!==b)x.status='party';});
    const t0=S.tick;E.retire(S,a,'故郷へ帰る');
    check('便り：恩がなければ1通目は20〜60日',a.nextLetter>=t0+20*day&&a.nextLetter<=t0+60*day,'故郷へ帰る',`${(a.nextLetter-t0)/day}日`);
    S.tick=a.nextLetter;E.letterTick(S);
    const news=S.news.filter(n=>n.k==='letter');
    check('便り：添えるかどうかは4通に1通で、当たらなければ品も金もない',news.length===1&&news[0].t.startsWith('【便り】')&&!news[0].t.includes('添えて')&&!(b.eq&&b.eq.acc)&&!news[0].t.includes('G'),'当たらない便り',news[0]&&news[0].t);
    c.trips=2;c.status='idle';c.party=null;E.retire(S,c,'故郷へ帰る');
    check('便り：3回未満の者からは来ない',c.letterDone&&c.nextLetter==null&&!(c.letters&&c.letters.length),'探索2回',c.nextLetter);
    r.trips=9;r.status='idle';E.retire(S,r,'故郷へ帰る');
    check('便り：銀の杯亭の客からは来ない',r.letterDone&&r.nextLetter==null,'銀の杯亭',r.tav);}
  // 店全体で5日に1通。予定が同じ日でも、片方は5日待つ
  {const E=load(3,1e-9),S=E.newState();const [a,b]=oursOf(S);
    [a,b].forEach(x=>{x.trips=4;x.status='idle';x.party=null;x.favor=0;E.retire(S,x,'故郷へ帰る');x.letters=[];x.letterDone=0;x.nextLetter=1000;});
    S.tick=1000;S.lastLetter=null;E.letterTick(S);
    check('便り：同じ日に届く予定でも、店からは1通だけ出る',[a,b].filter(x=>x.letters.length).length===1,'同じ日',`${a.letters.length}+${b.letters.length}`);
    S.tick=1000+4*day;E.letterTick(S);
    check('便り：5日たたなければ次の便りは出ない',[a,b].filter(x=>x.letters.length).length===1,'4日後',`${a.letters.length}+${b.letters.length}`);
    S.tick=1000+5*day;E.letterTick(S);
    check('便り：5日たてば、待っていた便りが届く',[a,b].every(x=>x.letters.length===1),'5日後',`${a.letters.length}+${b.letters.length}`);}
  // 古い記録。便りの予定は人ごとの計算で一度だけ付く。版24も版25も読め、開くと今の版になる。昔のロストに弟妹の予定は付かない
  {const E=load(4),S=E.newState();const [a,low]=oursOf(S);const r=Object.values(S.adv).find(x=>x.tav==='rival');
    a.status='retired';a.trips=6;a.favor=2;a.tav='ours';delete a.letters;delete a.nextLetter;delete a.letterDone;
    low.status='retired';low.trips=1;delete low.letters;delete low.nextLetter;delete low.letterDone;
    r.status='retired';r.trips=8;delete r.letters;delete r.nextLetter;delete r.letterDone;
    const lost=oursOf(S)[2];lost.status='lost';lost.trips=9;S.memorial.push({id:lost.id,name:lost.name,cls:lost.cls,lvl:lost.lvl,race:lost.race,tav:'ours',tk:1,by:'オーク',floor:2,kills:0});
    S.tick=800;S.v=23;const gold=S.taverns.ours.gold;E.migrate(S);
    const span=21,want=800+(20+(a.id*13)%span)*day;
    check('便り：版23の記録を開くと、条件を満たす者にだけ予定が付き、版は今の版になる',S.v===SAVE_V&&E.errandStage(S)===0&&a.nextLetter===want&&Array.isArray(a.letters)&&a.letters.length===0&&low.letterDone&&low.nextLetter==null&&r.letterDone&&!lost.kinDue&&S.taverns.ours.gold===gold,'版23',`版${S.v} 段${E.errandStage(S)} 予定${a.nextLetter} 決まり${want} 金${S.taverns.ours.gold}`);
    const again=a.nextLetter;E.migrate(S);
    check('便り：今の版を開き直しても予定は動かない',a.nextLetter===again&&a.letters.length===0&&S.v===SAVE_V,'二度目',a.nextLetter);
    const S5=E.newState();const [a5,low5]=oursOf(S5);const r5=Object.values(S5.adv).find(x=>x.tav==='rival');const lost5=oursOf(S5)[2];
    a5.status='retired';a5.trips=6;a5.favor=2;delete a5.letters;delete a5.nextLetter;delete a5.letterDone;
    low5.status='retired';low5.trips=1;delete low5.letters;delete low5.nextLetter;delete low5.letterDone;
    r5.status='retired';r5.trips=8;delete r5.letters;delete r5.nextLetter;delete r5.letterDone;
    lost5.status='lost';lost5.trips=9;
    S5.tick=800;S5.v=25;S5.errands={board:[{id:1,n:'鐘楼の光'}],next:null,log:[],nid:2,stage:2,stage1At:100};const gold5=S5.taverns.ours.gold;
    E.migrate(S5);
    const want5=800+(20+(a5.id*13)%span)*day;
    check('便り：版25の記録を開くと、話の段は残ったまま便りの予定が付き、版は今の版になる',S5.v===SAVE_V&&S5.errands.stage===2&&S5.errands.board.length===1&&S5.errands.board[0].n==='鐘楼の光'&&a5.nextLetter===want5&&low5.letterDone&&r5.letterDone&&!lost5.kinDue&&S5.taverns.ours.gold===gold5,'版25',`版${S5.v} 段${S5.errands.stage} 予定${a5.nextLetter}`);
    const S4b=E.newState();const a4b=oursOf(S4b)[0];
    a4b.status='retired';a4b.trips=6;a4b.favor=2;delete a4b.letters;delete a4b.nextLetter;delete a4b.letterDone;
    S4b.tick=800;S4b.v=24;delete S4b.errands;E.migrate(S4b);
    const want4=800+(20+(a4b.id*13)%span)*day;
    check('便り：版24の記録を開くと、話の段と便りの予定が付き、版は今の版になる',S4b.v===SAVE_V&&E.errandStage(S4b)===0&&a4b.nextLetter===want4,'版24',`版${S4b.v} 段${E.errandStage(S4b)} 予定${a4b.nextLetter}`);}
  // ロストした常連の弟妹。魔物が分かれば仇討ち、分からなければ花。30%で、30〜120日後
  {const E=load(5,1e-9),S=E.newState();const a=oursOf(S)[0];
    a.trips=3;a.tav='ours';a.status='lost';a.lastBy='オーク';a.sex='男';E.scheduleLostKin(S,a);
    check('次の世代：ロストした常連の弟妹は30%で、30〜120日後に予定が付く',a.kinDue&&a.kinDue.kind==='lost'&&a.kinDue.tk-S.tick>=30*day&&a.kinDue.tk-S.tick<=120*day,'オークに倒れた',`${a.kinDue&&(a.kinDue.tk-S.tick)/day}日`);
    S.taverns.ours.seats=E.seatsUsed(S,'ours')+1;S.tick=a.kinDue.tk;E.kinTick(S);
    const k=Object.values(S.adv).find(x=>x.kin&&x.kin.id===a.id);
    check('次の世代：倒した魔物が分かれば、その仇を討つ夢と形見を持って来る',!!k&&k.dream.k==='kinvenge'&&k.dream.m==='オーク'&&k.bg.includes('形見')&&k.race===a.race&&k.origin===a.origin&&k.lvl<=5&&E.dreamText(k.dream).includes('オーク'),'弟妹',k&&E.dreamText(k.dream));
    const b=oursOf(S).find(x=>x!==a&&!x.kin);b.trips=5;b.status='lost';b.tav='ours';b.lastBy='罠';b.kinDue={tk:S.tick,kind:'lost'};E.kinTick(S);
    const f=Object.values(S.adv).find(x=>x.kin&&x.kin.id===b.id);
    check('次の世代：倒した相手が魔物でなければ、記念碑に花を手向ける夢で来る',!!f&&f.dream.k==='kinflower'&&E.dreamText(f.dream).includes('花を手向けたい'),'罠で倒れた',f&&E.dreamText(f.dream));}
  {const E=load(6,0.5),S=E.newState();const a=oursOf(S)[0];a.trips=8;a.status='lost';a.tav='ours';a.lastBy='オーク';E.scheduleLostKin(S,a);
    check('次の世代：30%に当たらなければ、弟妹は来ない',!a.kinDue,'当たらない',a.kinDue&&a.kinDue.kind);}
  // 弟子は客としては来ない。去った師の口癖を受け継ぐ
  {const E=load(7),S=E.newState();const [m,p]=oursOf(S);
    m.catch='酒は命より重い';p.catch='別の口癖';p.status='idle';p.tav=m.tav;m.trips=1;m.status='idle';
    m.pastDreams=[{k:'mentor',pupil:p.name,t:'駆け出しを一人前に育てたい',tk:1}];
    E.retire(S,m,'故郷へ帰る');
    check('次の世代：育てた相手は、去った者の口癖を受け継ぐ',p.catch===m.catch&&(p.chron||[]).some(c=>c.t.includes('口癖')&&c.t.includes(m.catch))&&!Object.values(S.adv).some(x=>x.kin&&x.kin.id===m.id),'口癖',p.catch);}
  // 子の予定の日に40%を外すと、子は来ない
  {const E=load(8,0.5),S=E.newState();const a=oursOf(S)[0];a.trips=5;a.favor=0;a.status='idle';a.party=null;E.retire(S,a,'所帯を持つ');
    const due=a.kinDue;if(due){S.taverns.ours.seats=E.seatsUsed(S,'ours')+2;S.tick=due.tk;E.kinTick(S);} 
    const before=Object.keys(S.adv).length;S.tick=a.childAt;E.kinTick(S);
    check('次の世代：子は40%を外すとその日には来ない',Object.keys(S.adv).length===before&&a.childDone,'暦の日',`増分${Object.keys(S.adv).length-before}`);}
  // 大陸をめぐる者の3通は差出地がすべて違う。屋敷と「引退」は店の便りにも膝の便りにもしない
  {const E=load(9),S=E.newState();const a=oursOf(S)[0];
    a.leftWhy='大陸をめぐる旅に出る';
    let bad=null;const sample=[];
    for(const id of [a.id,0,1,2,3,4,17,100]){a.id=id;const ps=[1,2,3].map(n=>E.letterQuote(S,a,n).place);sample.push(ps.join('・'));
      if(new Set(ps).size!==3||ps[0]!=='ベルクラントの鉱山町')bad=`${id}:${ps.join(',')}`;}
    check('便り：大陸をめぐる者の3通は、差出地がすべて違う',!bad,'差出地',bad||sample[0]);
    const tour=[1,2,3].map(n=>E.letterNews(a,E.letterQuote(S,a,n),n));
    check('便り：大陸をめぐる者の1通目は、差出地と届いたことだけで、前の便りと比べない',tour[0]===`【便り】ベルクラントの鉱山町から、${a.name}の便りが届いた。`&&tour[1].endsWith('差出地は、前の便りと違う。')&&tour[2].endsWith('差出地は、前の便りと違う。'),'1通目',tour.join(' / '));
    check('便り：差出地と潮のにじみは地の文で、本人の言葉ではない',E.letterQuote(S,a,1).narr&&!E.letterQuote(S,a,1).quote&&(()=>{a.leftWhy='海を渡って東方の島国アズマへ向かう';const q=E.letterQuote(S,a,1);return q.narr&&q.tide&&!q.quote&&q.place==='セーレの港';})(),'地の文',a.leftWhy);
    a.leftWhy='王都に屋敷を構える';const manor=E.letterQuote(S,a,1);
    check('便り：屋敷を構えるは店の便りにしない',manor.line==='こちらは変わりない'&&!String(manor.quote).includes('どうにか回っている')&&!String(manor.quote).includes('札'),'屋敷',manor.quote);
    a.leftWhy='海を渡って故郷に帰り、王都の大通りにパン屋を構える';const shop=E.letterQuote(S,a,1);
    check('便り：店の名は最後の「に」から読み、その店が回っていると書く',shop.line==='パン屋はどうにか回っている'&&String(shop.quote).includes('黒猫亭の名を書いた札'),'パン屋',shop.quote);
    a.leftWhy='思い残すことなく引退する';const last=E.letterQuote(S,a,1);
    check('便り：思い残すことなく引退する者は、膝の便りにしない',last.line==='こちらは変わりない'&&!String(last.quote).includes('膝が痛む'),'引退',last.quote);
    a.leftWhy='八十歳。老いを感じ、冒険から身を引く';const old=E.letterQuote(S,a,1);
    a.leftWhy='剣を置いて故郷の村で隠居する';const quiet=E.letterQuote(S,a,1);
    check('便り：老いて身を引いた者と隠居した者は、膝の痛みを書く',old.short&&String(old.quote).includes('膝が痛む')&&quiet.short&&String(quiet.quote).includes('膝が痛む'),'老いと隠居',`${old.quote} / ${quiet.quote}`);}
  // まだ潜っていない仇討ちの進み。名のある魔物をほかの一行が先に討つと、答え合わせで夢がかなう
  {const E=load(10),S=E.newState();const a=oursOf(S)[0];
    a.trips=3;a.tav='ours';a.status='lost';a.lastBy='ドブ王';a.sex='男';a.deepest=4;
    S.taverns.ours.seats=E.seatsUsed(S,'ours')+1;a.kinDue={tk:S.tick,kind:'lost'};E.kinTick(S);
    const k=Object.values(S.adv).find(x=>x.kin&&x.kin.id===a.id);
    const d=k&&k.dream;
    check('次の世代：まだ潜っていない仇討ちの進みは、まだ迷宮に潜っていない',!!k&&d&&d.k==='kinvenge'&&(k.deepest||0)===0&&E.DREAMS.kinvenge.prog(k,d,S)==='まだ迷宮に潜っていない','進み',k&&E.DREAMS.kinvenge.prog(k,d,S));
    k.deepest=2;
    check('次の世代：潜ったあとの仇討ちの進みは、これまでの最深である',E.DREAMS.kinvenge.prog(k,d,S)==='これまでの最深 B2F','最深',E.DREAMS.kinvenge.prog(k,d,S));
    S.rares=S.rares||{};S.rares[1]={killed:{party:'銀の杯亭の一行',tav:'rival',names:['別人'],by:'別人',tk:1}};
    check('次の世代：名のある仇をほかの一行が討つと、進みは仇は別の者に討たれた',E.DREAMS.kinvenge.prog(k,d,S)==='仇は別の者に討たれた'&&E.DREAMS.kinvenge.ok(S,k,d),'別の一行',E.DREAMS.kinvenge.prog(k,d,S));
    k.status='idle';k.party=null;const n0=S.news.length;E.checkDream(S,k);
    const told=S.news.slice(n0).map(n=>n.t).join(' / ');
    check('次の世代：別の者に討たれた仇の夢は、酒場にいるあいだにかなう',!k.dream&&(k.pastDreams||[]).some(x=>x.k==='kinvenge')&&told.includes('別の者に討たれていた')&&!told.includes('を討った'),'答え合わせ',told);
    const seenRec=(k.pastDreams||[]).find(x=>x.k==='kinvenge');const seenChron=(k.chron||[]).slice(-1)[0];
    check('次の世代：別の者に討たれた仇の夢は、見届けた夢として残る',!!seenRec&&seenRec.seen===1&&seenChron&&String(seenChron.t).startsWith('仇の最期を見届ける')&&!String(seenChron.t).includes('夢がかなう'),'見届けた',seenChron&&seenChron.t);
    const oak={k:'kinvenge',m:'オーク',elder:'兄'};
    check('次の世代：何度でも出る魔物は、自分が討つまでは夢がかなわない',!E.DREAMS.kinvenge.ok(S,k,oak)&&E.DREAMS.kinvenge.prog(k,oak,S)==='これまでの最深 B2F','オーク',E.DREAMS.kinvenge.prog(k,oak,S));}
}

// ---- 何百日も回しながら、毎刻成り立つはずの性質 ----
function runSeed(seed){
  const E=load(seed),S=E.newState();
  // 仕様の3点。名前は id に結び、消えたあとも覚えておく。別の id に同じ名前が付いたら不合格
  const seenAdv=new Map([[S.taverns.rival.owner,'銀の杯亭の主人']]);
  const seenParty=new Map();
  for(const n of ['鉄の誓い','黄金の剣','七つ星','夜鷹','鉄の誓い傭兵団','黄金の剣団'])seenParty.set(n,'封鎖前の大部隊');
  const kinNames=new Set();
  const plain=n=>String(n||'').replace(/^「.*?」/,'');
  const noteNames=at=>{
    let advDup=null,partyDup=null;
    const claimA=(name,id)=>{const n=plain(name);if(!n)return;const prev=seenAdv.get(n);if(prev!=null&&prev!==id)advDup=advDup||`${n}（${prev} と ${id}）`;else seenAdv.set(n,id);};
    const claimP=(name,id)=>{const prev=seenParty.get(name);if(prev!=null&&prev!==id)partyDup=partyDup||`${name}（${prev} と ${id}）`;else seenParty.set(name,id);};
    const advs=Object.values(S.adv);
    for(const a of advs){const d=a.dream;if(d&&d.k==='kin'&&d.name)kinNames.add(d.name);}
    for(const a of advs){
      if(!advDup&&kinNames.has(a.name)&&!seenAdv.has(a.name)&&!(a.bg||'').includes('救い出された'))advDup=`${a.name}（肉親の名を別の者が使っている）`;
      claimA(a.name,a.id);
    }
    for(const m of S.memorial||[])claimA(m.name,m.id);
    for(const f of S.farewells||[])claimA(f.name,f.id);
    for(const a of advs){const d=a.dream;if(!advDup&&d&&d.k==='kin'&&d.name&&seenAdv.has(d.name))advDup=`${d.name}（肉親の名を id ${seenAdv.get(d.name)} が使っている）`;}
    for(const p of Object.values(S.parties))claimP(p.name,p.id);
    check('新顔の来店：引退・ロスト・死亡・追悼のあとにも名前を再使用しない',!advDup,at,advDup);
    check('一行の結成：解散した一行と白銀の牙と封鎖前の大部隊の名も再使用しない',!partyDup,at,partyDup);
  };
  noteNames(`種${seed}・開店`);
  for(let i=0;i<6;i++){E.tick(S);noteNames(`種${seed}・開店直後${i+1}刻`);}// 画面側の開店と同じ
  const prevState={},killed={},lore={},owedSeen={};let conquered=null,arcStage=0,mineConq=null,errandSt=E.errandStage(S);
  // 種の半分では、店主が借金を返し、話を回し、常連を見込む（話の仕組みを動かすため）
  const owner=seed%2===1;
  for(let i=0;i<TICKS;i++){
    E.tick(S);E.rivalTemple(S);// 画面側の step と同じく、銀の杯亭の蘇生も毎刻呼ぶ
    if(owner&&S.tick%10===0){E.repay(S,Math.max(0,S.taverns.ours.gold-3000));const ours=Object.values(S.adv).filter(a=>a.tav==='ours'&&live(a));
      if(S.tick%500===0&&ours.length){const a=ours[(S.tick/10)%ours.length];E.markAdv(S,a,!a.marked);}
      for(const e of E.errandsOf(S).board)if(!e.hero&&!e.pend){const c=ours.filter(a=>!E.designateBlock(S,e,a));if(c.length)E.assignErrand(S,e,c[(S.tick/10)%c.length]);}}
    const at=`種${seed}・${S.tick}刻（${Math.floor(S.tick/E.TICKS_PER_DAY)+1}日目）`;
    const advs=Object.values(S.adv),parties=Object.values(S.parties),T0=S.taverns.ours;
    noteNames(at);

    // 「席と拡張」：寺院や行方不明の者も含め、常連の数は席の数を超えない
    check('席と拡張：常連の数は席の数を超えない',E.seatsUsed(S,'ours')<=E.seatCap(S,'ours'),at,()=>`${E.seatsUsed(S,'ours')}人 / ${E.seatCap(S,'ours')}席`);
    check('席と拡張：銀の杯亭の常連も席の数を超えない',E.seatsUsed(S,'rival')<=E.seatCap(S,'rival'),at,()=>`${E.seatsUsed(S,'rival')}人 / ${E.seatCap(S,'rival')}席`);
    // 「新顔の来店」：名前はほかの冒険者と重ならない
    {const seen=new Map();let dup=null;for(const a of advs){if(seen.has(a.name))dup=a.name;seen.set(a.name,1);}check('新顔の来店：冒険者の名前は重ならない',!dup,at,dup);}
    // 「一行の結成」：一行の名前は重ならない。大陸の言葉の紋章名（看板の白銀の牙、名前が尽きたときの「の一行」も許す）
    {const ns=parties.map(p=>p.name);check('一行の結成：一行の名前は重ならない',new Set(ns).size===ns.length,at,ns.join('、'));
      const crest=/^[\u30A1-\u30F6\u30FC]+・[\u30A1-\u30F6\u30FC]+$/;
      const bad=ns.filter(n=>n!=='白銀の牙'&&!crest.test(n)&&!n.includes('の一行'));
      check('一行の結成：名前は大陸の言葉の紋章名',!bad.length,at,bad.join('、'));}
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
      if(p.state==='wiped'&&prevState[p.id]!=='wiped'){
        const cause=p.cause;const told=(p.members||[]).some(id=>{const a=S.adv[id];return a&&(a.chron||[]).some(c=>c.tk===S.tick&&c.t===`全滅した。${cause}`);});
        check('全滅：原因の一文は、水晶で見ていればその場で手帳に残り、見ていなければ遺体が着くまで残らない',!!cause&&(p.knownWiped?told:!told)&&p.causeTold===p.knownWiped&&p.dueAt>=S.tick&&p.dueAt<=S.tick+E.overdueSteps(p),at,()=>`${p.name} ${cause||'なし'} 見ていた${p.knownWiped} 手帳${told} 予定${p.dueAt}`);
      }
      if(E.wipeHidden(p))check('全滅：まだ知れていない全滅は、予定帰還の刻から MISSING_GRACE 刻より前',S.tick<(p.dueAt||0)+E.MISSING_GRACE,at,()=>`${p.name} 予定${p.dueAt} いま${S.tick}`);
      if(p.state==='wiped'&&p.announced&&!p.knownWiped&&!p.retrieved&&owedSeen[p.id]!=null)check('一行の借り：消息不明のあいだは減らず、日ごとに利息がつく',(p.owed||0)>=owedSeen[p.id]&&(S.tick%E.TICKS_PER_DAY||(p.owed||0)===owedSeen[p.id]+Math.round(owedSeen[p.id]*E.OWED_RATE)),at,()=>`${p.name} 借り${owedSeen[p.id]}→${p.owed}`);
      if(p.state==='wiped'&&p.knownWiped&&owedSeen[p.id]!=null)check('一行の借り：水晶で最期を見ていた一行には利息がつかない',(p.owed||0)===owedSeen[p.id],at,()=>`${p.name} 借り${owedSeen[p.id]}→${p.owed}`);
      if(p.state==='wiped')owedSeen[p.id]=p.owed||0;else delete owedSeen[p.id];
      prevState[p.id]=p.state;
    }
    for(const n of S.news){
      if(n.tk!==S.tick)continue;
      if(n.t.includes('最期を映した')||n.t.includes('遺体が街に届いた')){
        const hit=parties.filter(q=>q.cause&&n.t.includes(q.name)).sort((a,b)=>b.name.length-a.name.length)[0];
        const cause=hit&&hit.cause;
        const said=cause&&(n.t.includes(cause)||(cause.endsWith('に倒れた')&&(n.t.includes(cause.slice(0,-1)+'る')||n.t.includes(cause.slice(0,-1)+'ていた'))));
        check('全滅：水晶の知らせと遺体が届いた知らせには、原因の一文と階がある',!!said&&/B\d+F/.test(n.t),at,()=>n.t);
      }
      if(n.t.includes('予定を過ぎても戻らない')||n.t.includes('から戻らないらしい')){
        const hit=parties.filter(q=>q.state==='wiped'&&n.t.includes(q.name)).sort((a,b)=>b.name.length-a.name.length)[0];
        check('全滅：消息不明の知らせには死因も階も入らない',!!hit&&hit.announced&&!/B\d+F/.test(n.t)&&!(hit.cause&&n.t.includes(hit.cause)),at,()=>n.t);
      }
      if(n.t.includes('をしくじった。')||n.t.includes('をしくじり、')){
        const said=advs.some(a=>(a.chron||[]).some(c=>c.tk===S.tick&&typeof c.t==='string'&&c.t.includes('をしくじる。')));
        check('依頼：しくじった理由が手帳に残る',said,at,n.t);
      }
    }
    // 数値が壊れていない（NaN や無限大にならない）
    check('お金と体力が数として壊れない',num(T0.gold)&&num(T0.rep)&&num(T0.debt)&&advs.every(a=>num(a.gold)&&num(a.hp)&&num(a.xp)&&Number.isInteger(a.lvl)&&a.lvl>=1),at,
      ()=>`所持金${T0.gold} 評判${T0.rep} 借金${T0.debt} ${(advs.find(a=>!(num(a.gold)&&num(a.hp)&&num(a.xp)))||{}).name||''}`);
    // 「借金と返済」：借金は負にならず、評判は0より下にならない
    check('借金と返済：借金は負にならない',T0.debt>=0,at,T0.debt);
    {const A=S.flow&&S.flow.all;check('きょうの出入り：売上・支援・蘇生代・返済が帳簿の増分と合う',!!A&&A.e===(T0.earned||0)&&(A.s||0)+(A.v||0)===(T0.support||0)&&(A.r||0)===(T0.repaid||0)&&!(A.f>0),at,
      ()=>`出入り 売上${A&&A.e} 支援${A&&A.s} 蘇生${A&&A.v} 返済${A&&A.r} 施設${A&&A.f}／帳簿 売上${T0.earned||0} 支援${T0.support||0} 返済${T0.repaid||0}`);}
    check('評判：0より下にならない',T0.rep>=0,at,T0.rep);
    // 「沈んだ王」：踏破は一度きりで、記録が書き換わらない
    if(S.conquered){if(!conquered)conquered=JSON.stringify({tk:S.conquered.tk,tav:S.conquered.tav,party:S.conquered.party});
      check('沈んだ王：踏破は一度きり',conquered===JSON.stringify({tk:S.conquered.tk,tav:S.conquered.tav,party:S.conquered.party}),at,S.conquered.party);}
    // 「名のある魔物」：一度討たれた魔物の記録は書き換わらない（再び討たれない）
    for(const [f,r] of Object.entries(S.rares||{}))if(r.killed){const k=JSON.stringify(r.killed);if(!killed[f])killed[f]=k;check('名のある魔物：一度討たれたら再び討たれない',killed[f]===k,at,`B${f}F`);}
    // 「二つ名」：同じ刻に、同じ名のある魔物の「殺し」の知らせは一件まで（王殺し・竜殺し・坑道王殺しは全員に出てよい）
    {const names=[...E.RARES,...E.MINE_RARES].map(r=>r.n);
      const fresh=(S.news||[]).filter(n=>n.tk===S.tick&&String(n.t).includes('と呼ばれはじめた')&&String(n.t).includes('殺し'));
      let bad=null;for(const nm of names){const c=fresh.filter(n=>n.t.includes(nm+'殺し')).length;if(c>1)bad=`${nm}が${c}件：${fresh.filter(n=>n.t.includes(nm+'殺し')).map(n=>n.t).join(' / ')}`;}
      check('名のある魔物：同じ刻に同じ「殺し」の知らせは一件だけ',!bad,at,bad||'なし');}
    // 「記録の断片」：それぞれ見つかるのは一度きり
    for(const [i,r] of Object.entries(S.loreFound||{})){const k=JSON.stringify(r);if(!lore[i])lore[i]=k;check('記録の断片：見つかるのは一度きり',lore[i]===k,at,`断片${i}`);}
    // 「名のある魔物」「アイテムと装備」：伝説の品は世界にひとつずつ（いま生きている冒険者の装備の中で重ならない）
    {const own=new Map();let dup=null;for(const a of advs)if(live(a))for(const it of Object.values(a.eq||{}))if(it&&(it.rare||it.named)){if(own.has(it.n))dup=`${it.n}（${own.get(it.n)}と${a.name}）`;own.set(it.n,a.name);}
      check('伝説の品：世界にひとつずつ',!dup,at,dup);}
    // 「夢」：一度叶えた種類の夢は二度と持たない
    for(const a of advs){const ks=(a.pastDreams||[]).map(d=>d.k);
      check('夢：同じ種類の夢を二度叶えない',new Set(ks).size===ks.length,at,()=>`${a.name}：${ks.join(',')}`);
      if(a.dream)check('夢：叶えた種類の夢を再び持たない',!ks.includes(a.dream.k),at,()=>`${a.name}：${a.dream.k}`);
      const clash=sexClash(a.sex,a.bg);
      check('経歴：来た者の生い立ちが性別と食い違わない',!clash,at,()=>`${a.name}（${a.sex}・${a.origin}）${a.bg}：${clash}`);}
    // 「便り」「次の世代」「記念碑」
    {const lts=(S.news||[]).filter(n=>n.k==='letter'||String(n.t).startsWith('【便り】'));
      let bad=null;
      for(const n of lts){if(n.k!=='letter'||!String(n.t).startsWith('【便り】')||n.t.includes('為替')||n.t.includes('紹介状'))bad=n.t;}
      for(let i=1;i<lts.length&&!bad;i++){const d=(lts[i].tk-lts[i-1].tk)/E.TICKS_PER_DAY;if(d<5)bad=`${d}日`;}
      check('便り：知らせは便りの色で、5日に1通まで、金も紹介状も来ない',!bad,at,bad||`${lts.length}通`);
      const rareN=new Set([...E.RARES,...E.MINE_RARES].map(r=>r.n));
      for(const a of advs){const L=a.letters||[];
        if(L.length){const f=(S.farewells||[]).find(x=>x.id===a.id);
          const gaps=L.every((x,i)=>i===0||(x.tk-L[i-1].tk)/E.TICKS_PER_DAY>=120);
          check('便り：3回以上潜って去った黒猫亭の常連から、3通まで、120日以上あけて届く',a.status==='retired'&&a.tav==='ours'&&(a.trips||0)>=3&&L.length<=3&&gaps,at,()=>`${a.name} ${a.status} 探索${a.trips} ${L.length}通`);
          if(f)check('便り：1通目は去ってから20日以降',(L[0].tk-f.tk)/E.TICKS_PER_DAY>=20,at,()=>`${a.name} ${Math.floor((L[0].tk-f.tk)/E.TICKS_PER_DAY)}日`);}
        for(const it of Object.values(a.eq||{}))if(it&&String(it.lore||'').includes('故郷から送った'))
          check('便り：添えものは守りの小さい装飾品',it.slot==='acc'&&it.ac===1,at,()=>`${a.name} ${it.n}`);
        if(a.kin){const p=S.adv[a.kin.id];const back=p&&(p.kinOf||[]).some(k=>k.id===a.id);
          const relOk=(a.sex==='女'&&['妹','姪','娘'].includes(a.kin.rel))||(a.sex==='男'&&['弟','甥','息子'].includes(a.kin.rel));
          const kinds=['kinvenge','kinflower','kinname'];
          const had=(a.dream&&kinds.includes(a.dream.k))||(a.pastDreams||[]).some(d=>kinds.includes(d.k));
          check('次の世代：種族と出身を継ぎ、続柄が性別と合い、手帳が互いにつながる',!!(p&&p.race===a.race&&p.origin===a.origin&&back&&relOk&&a.lvl0>=1&&a.lvl0<=5&&had),at,()=>`${a.name}（${a.sex}・${a.kin.rel}）←${p&&p.name}`);}
        if(a.dream&&['kinvenge','kinflower','kinname'].includes(a.dream.k))
          check('次の世代：その夢は続柄で来た者だけが持つ',!!a.kin,at,a.name);}
      for(const n of S.news||[]){const mm=/ついに見つからなかった。B\d+Fに消えた(.+?)の(?:(\d+)人の)?名が記念碑に刻まれる。/.exec(String(n.t));if(!mm)continue;
        const names=mm[1].split('、');const carved=(S.memorial||[]).filter(m=>m.tk===n.tk).map(m=>m.name);
        check('記念碑：見つからなかった知らせの名は、同じ刻に記念碑に刻まれた名で、人数と合う',names.every(x=>carved.includes(x))&&(mm[2]?+mm[2]===names.length:names.length===1),at,()=>n.t);}
      for(const m of S.memorial||[])if(m.rares&&m.rares.length){const a=S.adv[m.id];
        const by=a?Object.entries(S.rares||{}).filter(([,v])=>v.killed&&v.killed.by===a.name).map(([f])=>{const r=[...E.RARES,...E.MINE_RARES].find(x=>x.f===+f);return r&&r.n;}).filter(Boolean):[];
        check('記念碑：討った名のある魔物の名だけが刻まれる',m.rares.every(n=>rareN.has(n)&&(!a||by.includes(n))),at,()=>`${m.name}：${(m.rares||[]).join('、')}`);}
      // 「酒場のざわめき」「土産話」：しまった言葉は3件までで古い順。見えている会話（40件）と土産話（80件）の言葉は、しまってあるか、それより新しい言葉が3件しまってある
      {const spoken={};const addSp=(id,tk,t)=>{(spoken[id]=spoken[id]||[]).push({tk,t});};
        for(const c of S.chatter||[])for(const l of c.lines||[])addSp(l.id,c.tk,l.t);
        for(const t of S.tales||[])if(t.whoId!=null)addSp(t.whoId,t.tk,t.t);
        for(const a of advs){const sd=a.said||[];
          const sorted=sd.every((x,i)=>i===0||x.tk>=sd[i-1].tk)&&sd.every(x=>x.tk<=S.tick&&typeof x.t==='string'&&x.t.length>0);
          const vis=(spoken[a.id]||[]);
          const covered=vis.every(u=>sd.some(x=>x.tk===u.tk&&x.t===u.t)||(sd.length===3&&sd[0].tk>=u.tk));
          check('最後の言葉：しまう言葉は3件までで古い順に並び、見えている会話と土産話の言葉はしまってあるか、それより新しい3件に押し出されている',sd.length<=3&&sorted&&covered,at,()=>`${a.name} しまった${sd.map(x=>x.tk+':'+x.t).join('／')} 見えている${vis.map(x=>x.tk+':'+x.t).join('／')}`);}}
      // 「知らせ」「記念碑」：黒猫亭のロストの知らせには、記念碑と同じ見送りの一行が続く。銀の杯亭には続かない
      for(const n of S.news||[]){if(n.k!=='lost')continue;const t=String(n.t);
        const ash=/^(黒猫亭|銀の杯亭)の(.+?)、ロスト。その名は記念碑に刻まれる。(.*)$/.exec(t);const gone=ash?null:/^(黒猫亭|銀の杯亭)の.+?は、ついに見つからなかった。.+?名が記念碑に刻まれる。(.*)$/.exec(t);
        if(!ash&&!gone)continue;const tav=(ash||gone)[1],tail=ash?ash[3]:gone[2];
        const ms=(S.memorial||[]).filter(m=>m.tk===n.tk&&(tav==='黒猫亭'?m.tav==='ours':m.tav==='rival')&&(!ash||m.name===ash[2]));
        check('見送りの一行：黒猫亭のロストの知らせには記念碑と同じ一行が続き、銀の杯亭には続かない',ms.length>0&&(tav==='黒猫亭'?(!!tail&&ms.every(m=>m.farewell===tail)):(tail===''&&ms.every(m=>!m.farewell))),at,()=>t);
        if(tail)check('見送りの一行：「店主は」で始まらず、見ていなかった・間に合わなかったとは書かない',!/^店主|見ていなかった|間に合わなかった/.test(tail)&&tail.endsWith('。'),at,()=>tail);}}
    // 「お触れ」：同じ種類は重ならない。蘇生代の値上げと半額も重ならない
    {const act=(S.edicts||[]).filter(e=>e.until>S.tick).map(e=>e.k);
      check('お触れ：同じ種類は重ならない',new Set(act).size===act.length,at,act.join(','));
      check('お触れ：蘇生代の値上げと半額は重ならない',!(act.includes('templeUp')&&act.includes('templeDown')),at,act.join(','));}
    // 「鉄の山脈の坑道」：坑道に入るのは開いてから。坑道の階は坑道B25Fまで。坑道王の踏破は一度きり
    for(const p of parties)if(p.floor>E.MAXF&&p.state!=='town'){
      check('坑道：開くまでは誰も入らない',E.mineOpen(S),at,()=>`${p.name} ${E.FN(p.floor)}`);
      check('坑道：坑道B25Fより下はない',p.floor<=E.MINE_BOT,at,()=>`${p.name} ${p.floor}`);}
    if(S.mineConq){const k=JSON.stringify({tk:S.mineConq.tk,party:S.mineConq.party});if(!mineConq)mineConq=k;check('坑道：坑道王の踏破は一度きり',mineConq===k,at,S.mineConq.party);}
    // 「裏通りの酒場」：多くて6軒
    check('裏通りの酒場：多くて6軒',E.smallOf(S).length<=6,at,E.smallOf(S).length);
    // 「持ち込まれる話と、見込んだ者」
    {const B=E.errandsOf(S).board;const st=E.errandStage(S);const shallow=['迷い込んだ子猫','牢番の名簿','蜘蛛の巣の指輪'];
      check('持ち込まれる話：段は下がらない',st>=errandSt,at,`${errandSt}→${st}`);errandSt=st;
      check('持ち込まれる話：掲示はその段の枠を超えない',B.length<=E.boardMax(S)&&B.length<=E.BOARD_MAX,at,`${B.length}/${E.boardMax(S)}`);
      check('持ち込まれる話：段が開くまでは話が来ない',st>=1||B.length===0,at,B.length);
      check('持ち込まれる話：段1では浅い単発の話だけ',st!==1||B.every(e=>!e.arc&&shallow.includes(e.n)),at,()=>B.map(e=>e.n+(e.arc?'続き':'')).join('、'));
      check('続きもの：借金を返し終えるまでは来ない',T0.debtFree!=null||!B.some(e=>e.arc),at,()=>B.filter(e=>e.arc).map(e=>e.n).join('、'));
      check('持ち込まれる話：期限を過ぎた話は掲示に残らない',B.every(e=>e.until>S.tick),at,()=>B.filter(e=>e.until<=S.tick).map(e=>e.n).join('、'));
      check('持ち込まれる話：引き受けた話に、伝えるのを待つ主役は残らない',B.every(e=>!(e.hero&&e.pend)),at,()=>B.filter(e=>e.hero&&e.pend).map(e=>e.n).join('、'));
      const hs=B.map(e=>e.hero||e.pend).filter(Boolean);
      check('持ち込まれる話：主役は黒猫亭の常連で、1人が2つの話を持たない',new Set(hs).size===hs.length&&hs.every(id=>S.adv[id]&&S.adv[id].tav==='ours'&&live(S.adv[id])),at,()=>hs.map(id=>S.adv[id]&&`${S.adv[id].name}（${S.adv[id].tav}・${S.adv[id].status}）`).join('、'));
      check('見込む：見込んだ者はその段の人数を超えない',E.markedOf(S).length<=E.markMax(S)&&E.markedOf(S).length<=E.MARK_MAX,at,`${E.markedOf(S).length}/${E.markMax(S)}`);
      const arc=S.arcs&&S.arcs.gate;if(arc){
        check('続きもの：筋の段は順に進み、飛ばさない',arc.stage===arcStage||arc.stage===arcStage+1,at,`${arcStage}→${arc.stage}`);arcStage=arc.stage;
        check('続きもの：掲示の段は、次に果たす段',B.filter(e=>e.arc==='gate').every(e=>e.stage===arc.stage+1),at,()=>B.filter(e=>e.arc).map(e=>e.stage).join(','));}}
  }
  // 「新顔の来店」：評判を聞いて来る新顔は、常連の平均レベルの前後3以内（0は、これまでどおりの散らばりで来る印）
  {const rs=Object.values(S.adv).filter(a=>a.tav==='ours'&&live(a));const avg=Math.round(rs.reduce((s,a)=>s+a.lvl,0)/rs.length);
    for(let k=0;k<500;k++){const l=E.newcomerLvl(S,'ours');check('新顔の来店：評判を聞いて来る者は平均レベル±3',l===0||(l>=Math.max(1,avg-3)&&l<=avg+3),`種${seed}・終わり`,`平均${avg}に対して${l}`);}}
  // 「冒険者の手帳」「記念碑」：帳面の一行は描くたびに同じで、数字も店主も出さない。銀の杯亭の者には出ない
  for(const a of Object.values(S.adv))for(const k of ['came','end']){const t=E.ledgerLine(S,a,k);
    check('帳面：同じ記録からは同じ文で、算用数字と店主の心情を書かない',t===E.ledgerLine(S,a,k)&&!/[0-9０-９]|店主/.test(t)&&(a.tav==='ours'||t===''),`種${seed}・終わり`,`${a.name}：${t}`);}
  return `種${seed}：${TICKS}刻を回した（最深 黒猫亭B${S.deepest.ours}F・銀の杯亭B${S.deepest.rival}F）`;
}

function checkRevive(){
  const near=(g,w)=>Math.abs(g-w)<1e-9;
  const E=load(1),S=E.newState();
  const a=Object.values(S.adv).find(x=>x.tav==='ours');
  const p=(status,lvl,faith,bless)=>{a.status=status;a.lvl=lvl;a.traits=faith?['信心深い']:[];S.blessUntil=bless?S.tick+1:0;return E.reviveChance(S,a);};
  const dead=(lvl,faith,bless)=>Math.min(bless?.99:.97,.84+Math.ceil(lvl/2)*.01+(faith?.05:0)+(bless?.08:0));
  const ash=(lvl,faith,bless)=>Math.min(bless?.97:.94,.7+Math.ceil(lvl/2)*.015+(faith?.06:0)+(bless?.08:0));
  check('蘇生：死は84%から、強いほど上がり、97%まで',near(p('dead',1,0,0),dead(1,0,0))&&near(p('dead',3,0,0),dead(3,0,0))&&p('dead',40,0,0)===.97,'Lv1・3・40',p('dead',40,0,0));
  check('蘇生：灰は70%から、強いほど上がり、94%まで',near(p('ash',1,0,0),ash(1,0,0))&&p('ash',40,0,0)===.94,'Lv1・40',p('ash',1,0,0));
  check('蘇生：信心深い者は成功しやすい',near(p('dead',1,1,0),dead(1,1,0))&&p('dead',1,1,0)>p('dead',1,0,0)&&near(p('ash',1,1,0),ash(1,1,0))&&p('ash',1,1,0)>p('ash',1,0,0),'Lv1','');
  check('蘇生：寄進中は8ポイント上がり、上限も上がる',near(p('dead',1,0,1),dead(1,0,1))&&p('dead',40,0,1)===.99&&near(p('ash',1,0,1),ash(1,0,1))&&p('ash',40,0,1)===.97,'Lv1と上限',`${p('dead',40,0,1)} ${p('ash',40,0,1)}`);
  a.status='dead';a.lvl=1;a.traits=[];S.blessUntil=0;
  check('蘇生の目安：押す前に状態と百分率が出る',E.reviveHint(S,a)===`死・成功率の目安 ${Math.round(E.reviveChance(S,a)*100)}%`,'死・寄進なし',E.reviveHint(S,a));
  a.status='ash';a.traits=['信心深い'];S.blessUntil=S.tick+1;
  const hint=E.reviveHint(S,a);
  check('蘇生の目安：寄進と信心深さは一言添える',hint.startsWith(`灰・成功率の目安 ${Math.round(E.reviveChance(S,a)*100)}%`)&&hint.includes('寄進で上がっている')&&hint.includes('信心深く、成功しやすい'),'灰・両方',hint);
  check('蘇生の結果：その場の文面',E.reviveResultText('ファビアン','ok')==='ファビアンがよみがえった'&&E.reviveResultText('ファビアン','ash')==='ファビアンは蘇生に失敗し、灰になった'&&E.reviveResultText('ファビアン','lost')==='ファビアンは蘇生に失敗し、ロストした','三通り','');
  // 第2引数の 0 は偽なので乱数を固定できない。成功する小さな値にして、開店の抽選で種の並びがずれても結果を確かめる
  {const E2=load(2,1e-9),S2=E2.newState();const b=Object.values(S2.adv).find(x=>x.tav==='ours');b.status='dead';b.hp=0;
    check('蘇生：成功すると生き返る',E2.temple(S2,b,true)==='ok'&&b.status==='idle'&&b.hp===b.mhp,'必ず成功',b.status);}
  {const E2=load(3,.999),S2=E2.newState();const b=Object.values(S2.adv).find(x=>x.tav==='ours');b.status='dead';b.hp=0;
    check('蘇生：死から失敗すると灰になる',E2.temple(S2,b,true)==='ash'&&b.status==='ash','必ず失敗',b.status);
    check('蘇生：灰から失敗するとロストする',E2.temple(S2,b,true)==='lost'&&b.status==='lost','灰から失敗',b.status);}
}

function checkMemoNotes(){
  const texts=E=>E.MEMO.map(m=>m.t).join('|');
  {const E=load(1);const t=id=>E.MEMO.find(m=>m.id===id).t;
    check('覚え書き：文面は生きて戻る、席は18、石碑はB6F',t('home')==='送り出した連中が、生きて戻ってくる'&&t('seats')==='壁際に卓を足して、席を18にする'&&t('stone')==='うちの客の誰かが、B6Fの石碑に触れる','文面',E.MEMO.map(m=>m.t).join(' / '));}
  {const E=load(1),S=E.newState(),T0=S.taverns.ours;E.checkMemo(S);const a=E.memoState(S);
    check('覚え書き：新しく始めると未達が3行',a.show.length===3&&a.show.every(m=>!m.done)&&a.show.map(m=>m.t).join('|')===texts(E).split('|').slice(0,3).join('|')&&a.log.length===0&&!a.allDone,'開店',a.show.map(m=>m.t).join(' / '));
    check('覚え書き：開始時は番付に勝ちがない',!E.rankRows(S).some(r=>r.lead>0)&&!E.MEMO.find(m=>m.id==='rank').met(S),'開店',E.rankRows(S).filter(r=>r.lead>0).map(r=>r.name).join(','));
    const rep0=T0.rep,adv=Object.values(S.adv).find(x=>x.tav==='ours');adv.trips=1;E.checkMemo(S);const b=E.memoState(S);
    check('覚え書き：無事に戻ると線が引かれ、次の行が出て、評判は1だけ増える',b.show[0].done&&b.show[0].id==='home'&&b.show[0].tk===S.tick&&b.show.filter(m=>!m.done).length===3&&b.show[3].id==='rare'&&T0.rep===rep0+1,'帰還',`rep ${rep0}→${T0.rep} ${b.show.map(m=>m.id+(m.done?'済':'')).join(',')}`);
    E.checkMemo(S);
    check('覚え書き：同じ行の評判は一度だけ',T0.rep===rep0+1,'二度目',T0.rep);
    S.small=[{n:'赤い樽亭',owned:true,owner:'a',trait:'b',score:0,since:0,log:[]}];E.checkMemo(S);
    check('覚え書き：支店の席は十八席に数えない',!S.memo.done.seats&&T0.seats===12,'支店',T0.seats);
    T0.seats=18;E.checkMemo(S);const c=E.memoState(S);
    check('覚え書き：席を18にすると線が引かれ、次の行が出る',c.show.find(m=>m.id==='seats').done&&c.show.some(m=>m.id==='stone'&&!m.done)&&c.log.filter(m=>m.tk===S.tick).length>=2,'拡張',c.show.map(m=>m.id+(m.done?'済':'')).join(','));}
  {const E=load(2),S=E.newState(),U=S.taverns.ours;U.gold=999999;U.debt=80000;U.nextPay=S.tick;U.rep=0;const due=E.nextDue(S);
    check('返済：必要額は利息2%を足した4000G',due&&due.due===4000+Math.round(80000*.02)&&due.days>=1,'開店の借金',JSON.stringify(due));
    E.debtTick(S);E.checkMemo(S);
    check('覚え書き：不足なく払えた返済日で、取り立て人の行がかなう',U.cleanPay===S.tick&&E.memoState(S).log.some(m=>m.id==='bill'&&m.tk===S.tick)&&U.rep===1,'返済日',`clean ${U.cleanPay} rep ${U.rep}`);}
  {const E=load(3),S=E.newState();S.taverns.ours.debt=3000;const d=E.nextDue(S);
    check('返済：残りが少なければ利息を足した全額',d&&d.due===3000+Math.round(3000*.02),'借金3000',d&&d.due);
    S.taverns.ours.debt=0;
    check('返済：返し終えると必要額はない',E.nextDue(S)===null,'完済','');}
  {const E=load(4),S=E.newState();S.deepest.rival=1;S.deepest.ours=1;E.checkMemo(S);
    check('覚え書き：番付が同点だけのあいだは勝ったことにならない',!S.memo.done.rank&&E.rankRows(S).some(r=>r.lead===0)&&!E.rankRows(S).some(r=>r.lead>0),'同点',E.rankRows(S).map(r=>r.name+r.lead).join(','));
    S.deepest.ours=2;const rep=S.taverns.ours.rep;E.checkMemo(S);
    check('覚え書き：番付で一つ勝つと評判が2増える',!!(S.memo.done.rank&&S.memo.done.rank.tk===S.tick)&&S.taverns.ours.rep===rep+2,'最深',S.taverns.ours.rep);}
  {const E=load(5),S=E.newState();S.dragon={kills:1};E.checkMemo(S);
    check('覚え書き：黒竜を討っても名のある魔物にはならない',!(S.memo&&S.memo.done&&S.memo.done.rare),'黒竜','');}
  {const E=load(6),S=E.newState(),U=S.taverns.ours;U.gold=0;U.debt=80000;U.rep=5;U.nextPay=S.tick;E.debtTick(S);E.checkMemo(S);
    check('覚え書き：返済に足りないと取り立て人の行は残る',!(S.memo.done&&S.memo.done.bill)&&U.cleanPay==null,'延滞',U.rep);
    U.gold=999999;U.nextPay=S.tick;E.debtTick(S);E.checkMemo(S);
    check('覚え書き：あとから不足なく払えばかなう',!!(S.memo.done.bill&&U.cleanPay===S.tick),'翌月',U.cleanPay);}
  {const E=load(7),S=E.newState(),U=S.taverns.ours;U.gold=100000;U.debt=1000;const rep=U.rep;E.repay(S,1000);
    check('覚え書き：返し終えると返済・半分・完済が同時にかなう',!!(S.memo.done.bill&&S.memo.done.half&&S.memo.done.free)&&U.rep===rep+10+1+3+3,'完済',`rep ${rep}→${U.rep}`);
    U.debt=50000;E.checkMemo(S);
    check('覚え書き：かなえた行は条件が戻っても消えない',!!S.memo.done.half,'利息で戻る','');}
  {const E=load(8),S=E.newState(),adv=Object.values(S.adv).find(x=>x.tav==='ours');adv.trips=1;adv.pastDreams=[{k:'fame',t:'夢',tk:10}];S.stats.dreams.ours=1;S.taverns.ours.seats=18;S.taverns.ours.debt=0;S.taverns.ours.debtFree=20;S.taverns.ours.cleanPay=15;S.deepest.ours=6;S.rares={1:{killed:{tav:'ours',tk:12,party:'p',names:['a']}}};S.taverns.ours.rep=500;const rep=S.taverns.ours.rep;E.checkMemo(S);const st=E.memoState(S);const sum=E.MEMO.reduce((s,m)=>s+m.rep,0);
    check('覚え書き：すべてかなえると帳場からは消え、評判は合計だけ一度増える',st.show.length===0&&st.allDone&&st.log.length===9&&S.taverns.ours.rep===rep+sum&&sum===17,'全達成',`show ${st.show.length} log ${st.log.length} rep +${S.taverns.ours.rep-rep}`);
    E.checkMemo(S);
    check('覚え書き：すべてかなえたあとは評判が増えない',S.taverns.ours.rep===rep+sum,'二度目',S.taverns.ours.rep);}
  {const E=load(9),S=E.newState(),a=Object.values(S.adv).find(x=>x.tav==='ours');a.trips=2;a.chron.push({tk:40,t:'はじめてB6Fに足を踏み入れる'});a.pastDreams=[{k:'fame',t:'夢',tk:50}];S.stats.dreams.ours=1;S.deepest.ours=8;S.rares={3:{killed:{tav:'ours',tk:33,party:'p',names:['b']}},4:{killed:{tav:'rival',tk:10,party:'q',names:['c']}}};S.taverns.ours.seats=18;S.taverns.ours.debt=10000;S.taverns.ours.rep=7;S.news.push({tk:21,t:'セーレの両替商に、今月の返済5600G（うち利息1600G）を払った。借金の残りは76000G。',k:'info'});S.v=22;delete S.memo;E.migrate(S);const m=S.memo.done;
    check('覚え書き：古い記録はかなえた行に線を引き、評判は増えない',S.v===SAVE_V&&S.taverns.ours.rep===7&&S.taverns.ours.cleanPay===21&&m.home&&m.home.tk==null&&m.bill&&m.bill.tk===21&&m.seats&&m.seats.tk==null&&m.rare&&m.rare.tk===33&&m.stone&&m.stone.tk===40&&m.dream&&m.dream.tk===50&&m.half&&m.half.tk==null&&m.rank&&m.rank.tk==null&&!m.free,'版22',JSON.stringify(m));}
  // 知らせが最新300件からこぼれていても、返した額があり延滞していなければ、直前の返済日を無事な返済とみなす
  {const E=load(11),S=E.newState(),U=S.taverns.ours;const day=E.TICKS_PER_DAY;
    U.repaid=12000;U.late=0;U.debt=60000;U.nextPay=200*day;S.tick=180*day;U.rep=4;
    S.news=S.news.filter(n=>!(n.t&&n.t.startsWith('セーレの両替商に、今月の返済')));
    S.v=22;delete S.memo;E.migrate(S);const guessed=170*day;
    check('覚え書き：知らせがなくても、返した額があり延滞していなければ直前の返済日でかなう',S.v===SAVE_V&&U.cleanPay===guessed&&S.memo.done.bill&&S.memo.done.bill.tk===guessed&&U.rep===4,'版22・知らせなし',`clean ${U.cleanPay} rep ${U.rep}`);}
  {const E=load(12),S=E.newState(),U=S.taverns.ours;const day=E.TICKS_PER_DAY;
    U.repaid=8000;U.late=0;U.debt=70000;U.nextPay=90*day;S.tick=70*day;U.rep=3;
    S.news=S.news.filter(n=>!(n.t&&n.t.startsWith('セーレの両替商に、今月の返済')));
    S.memo={done:{}};S.v=23;E.migrate(S);const guessed=60*day;
    check('覚え書き：版23の記録でも、知らせがなければ返した額と延滞から推定して線を引く',S.v===SAVE_V&&U.cleanPay===guessed&&S.memo.done.bill&&S.memo.done.bill.tk===guessed&&U.rep===3,'版23',`clean ${U.cleanPay} rep ${U.rep}`);}
  {const E=load(13),S=E.newState(),U=S.taverns.ours;const day=E.TICKS_PER_DAY;
    U.repaid=5000;U.late=2;U.debt=70000;U.nextPay=90*day;S.tick=70*day;U.rep=3;
    S.news=S.news.filter(n=>!(n.t&&n.t.startsWith('セーレの両替商に、今月の返済')));
    S.memo={done:{}};S.v=23;E.migrate(S);
    check('覚え書き：延滞中で知らせがなければ、取り立て人の行はかなえない',S.v===SAVE_V&&U.cleanPay==null&&!(S.memo.done&&S.memo.done.bill)&&U.rep===3,'延滞',`clean ${U.cleanPay} rep ${U.rep}`);}
  {const E=load(14),S=E.newState(),U=S.taverns.ours;const day=E.TICKS_PER_DAY;
    U.repaid=1000;U.late=0;U.debt=79000;U.nextPay=30*day;S.tick=10*day;U.rep=2;
    S.news=S.news.filter(n=>!(n.t&&n.t.startsWith('セーレの両替商に、今月の返済')));
    S.memo={done:{}};S.v=23;E.migrate(S);
    check('覚え書き：最初の返済日の前は、返した額があっても取り立て人の行はかなえない',S.v===SAVE_V&&U.cleanPay==null&&!(S.memo.done&&S.memo.done.bill),'手返済だけ',`clean ${U.cleanPay} next ${U.nextPay}`);}
  {const E=load(15),S=E.newState(),U=S.taverns.ours;const day=E.TICKS_PER_DAY;
    U.cleanPay=40;U.repaid=9000;U.late=0;U.nextPay=90*day;S.tick=80*day;U.rep=5;
    S.memo={done:{bill:{tk:40}}};S.v=23;E.migrate(S);
    check('覚え書き：すでに分かっている返済日は推定で書き直さない',S.v===SAVE_V&&U.cleanPay===40&&S.memo.done.bill.tk===40&&U.rep===5,'版23・日付あり',`clean ${U.cleanPay}`);}
  {const clearAt=(tick)=>{const E=load(1),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
      p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp;a.status='party';});S.tick=tick;E.conquest(S,p);
      const n=S.news.find(x=>x.t&&x.t.includes('初めての踏破'));return n?n.t:'';};
    const E=load(1);const y81=clearAt(0),y82=clearAt(365*E.TICKS_PER_DAY);
    check('踏破：知らせの年は踏破した日の迷宮暦',y81.includes('迷宮暦81年、初めての踏破である。')&&!y81.includes('81年以来')&&y82.includes('迷宮暦82年、初めての踏破である。'),'81年と82年',`${y81} / ${y82}`);}
  {const E=load(10),S=E.newState();const n=E.nextDue(S);
    check('返済：始めは30日後・5600G',n&&n.days===30&&n.due===5600,'開店',JSON.stringify(n));
    for(let i=0;i<6;i++)E.tick(S);const n2=E.nextDue(S);
    check('返済：開店の数刻後も30日・5600G',n2&&n2.days===30&&n2.due===5600,'6刻',JSON.stringify(n2));}
}

const OPENING_TIE=['空き家の前の住人の娘','空き家の前の住人の息子','開店の夜、雨宿りに入ってそのまま居ついた','空き家の片付けを手伝ったついでに居ついた','セーレの両替商の使いとして開店の金を届け、そのまま残った','封じの門が開いたと聞いて、誰より先に店の前で待っていた','銀の杯亭には席がなく、西の縁の新しい店に来た','店の看板を、店主と一緒に掲げた','店主と同じ船でセーレから来た'];
const STELE=['B6Fの転移の石碑に、一度触れてみたい','B6Fまで潜って、地上の店に戻ってみたい'];
function openingOf(S){return Object.values(S.adv).filter(a=>a.opening).sort((a,b)=>a.id-b.id);}
function tieOf(a){const i=a.bg.lastIndexOf('。');return i>=0?a.bg.slice(i+1):a.bg;}
function dreamLine(a){const c=(a.chron||[]).find(x=>x.t&&x.t.includes('夢は「'));const m=c&&c.t.match(/夢は「([^」]*)」/);return m?m[1]:'';}
// 「冒険者の手帳」「記念碑」：黒猫亭の帳面。その日より前の記録だけで数え、数は漢数字の言葉で書く
function checkLedger(){
  const E=load(1),D=E.TICKS_PER_DAY;
  check('帳面：漢数字の書き方',[[9,'九'],[15,'十五'],[30,'三十'],[170,'百七十'],[640,'六百四十'],[1200,'千二百']].every(([n,k])=>E.kanjiNum(n)===k),'表',[9,15,30,170,640,1200].map(E.kanjiNum).join('・'));
  // 開店の顔ぶれは、いつも白い頁
  for(let i=0;i<4;i++){const S=load(1000+i*7919).newState();const L=load(1000+i*7919);
    const cast=Object.values(S.adv).filter(a=>a.opening);
    check('帳面：開店の顔ぶれは白い頁',cast.length===7&&cast.every(a=>L.ledgerLine(S,a,'came')==='帳面によれば、まだ白い頁が多い。'),`種${1000+i*7919}`,()=>cast.map(a=>L.ledgerLine(S,a,'came')).join(' / '));}
  // 来た者20人・ロスト2人・去った者3人の帳面
  const mk=(id,tk,tav='ours',status='idle')=>({id,tav,status,name:'者'+id,chron:[{tk,t:'扉をくぐる'}]});
  const S={adv:{},memorial:[],farewells:[]};
  for(let i=1;i<=20;i++)S.adv[i]=mk(i,0);
  S.memorial.push({id:1,tk:150*D},{id:2,tk:300*D});S.adv[1].status=S.adv[2].status='lost';
  [[3,590],[4,600],[5,640]].forEach(([id,d])=>{S.farewells.push({id,tk:d*D});S.adv[id].status='retired';});
  for(let i=30;i<40;i++)S.adv[i]=mk(i,0,'rival');
  const me=S.adv[50]=mk(50,1000*D);
  const came=E.ledgerLine(S,me,'came');
  check('帳面：来た者20人・ロスト2人・去った者3人で「十人に一人」と日数の句',came==='帳面によれば、この店に来た者のうち、戻らなかったのは十人に一人。たいていは六百日ほどで、自分の足で出ていく。','場面',came);
  check('帳面：去った者が3人未満なら日数の句を省く',(()=>{const f=S.farewells.pop();const t=E.ledgerLine(S,me,'came');S.farewells.push(f);return t==='帳面によれば、この店に来た者のうち、戻らなかったのは十人に一人。';})(),'場面',came);
  check('帳面：銀の杯亭の者には出ない',E.ledgerLine(S,S.adv[30],'came')===''&&E.ledgerLine(S,{...me,tav:'rival'},'came')==='','場面','');
  // 開く時点が後でも、来た日の文は変わらない（そのあとの記録は数えない）
  S.memorial.push({id:6,tk:1200*D});S.adv[6].status='lost';
  for(let i=60;i<80;i++)S.adv[i]=mk(i,1100*D);
  check('帳面：同じ記録を2回描くと同じ文で、来た日のあとの記録は数えない',E.ledgerLine(S,me,'came')===came&&E.ledgerLine(S,me,'came')===came,'場面',E.ledgerLine(S,me,'came'));
  // 終わった日
  S.farewells.push({id:50,tk:(1000+640)*D});me.status='retired';
  const left=E.ledgerLine(S,me,'end');
  check('帳面：店を去った者は在籍の日数と、帳面のとおりなら「帳面のとおりだった」',left==='帳面によれば、自分の足で出ていった。在籍は六百四十日ほど。帳面のとおりだった。','場面',left);
  const lostMe=S.adv[51]=mk(51,1000*D);S.memorial.push({id:51,tk:(1000+172)*D});lostMe.status='lost';
  const lost=E.ledgerLine(S,lostMe,'end');
  check('帳面：ロストした者は「○人に一人の側に入った」と在籍の日数',lost==='帳面によれば、二十人に一人の側に入った。在籍は百七十日ほど。','場面',lost);
  check('帳面：その日より前に20人来ていなければ白い頁',E.ledgerLine(S,S.adv[3],'end')==='帳面によれば、まだ白い頁が多い。','場面',E.ledgerLine(S,S.adv[3],'end'));
  // 来た者÷戻らなかった者が1.5未満でも「一人に一人」とは書かない。1.5以上なら二人に一人
  {let bad=null;
    for(let c=20;c<=60&&!bad;c++)for(let l=1;l<=c&&!bad;l++){
      const T={adv:{},memorial:[],farewells:[]};for(let i=1;i<=c;i++)T.adv[i]=mk(i,0);
      for(let i=1;i<=l;i++){T.memorial.push({id:i,tk:i});T.adv[i].status='lost';}
      const cm=T.adv[100]=mk(100,10*D),lm=T.adv[101]=mk(101,10*D);T.memorial.push({id:101,tk:50*D});lm.status='lost';
      const a=E.ledgerLine(T,cm,'came'),b=E.ledgerLine(T,lm,'end'),fa=c/l<1.5,fb=(c+1)/l<1.5;// ロストした日の帳面には、先に来た cm も入る
      const ok=!/一人に一人/.test(a+b)&&(fa?a.startsWith('帳面によれば、この店に来た者のうち、ほとんどが戻らなかった。'):/人に一人。/.test(a))&&(fb?b.startsWith('帳面によれば、ほとんどの側に入った。'):/人に一人の側に入った。/.test(b));
      if(!ok)bad=`来た${c}人・ロスト${l}人：${a} / ${b}`;}
    check('帳面：割合が一人に一人になるときは「ほとんど」と書き、「一人に一人」とは書かない',!bad,'場面',bad);}
  const none={adv:{},memorial:[],farewells:[]};for(let i=1;i<=24;i++)none.adv[i]=mk(i,0);none.adv[99]=mk(99,10*D);
  check('帳面：まだ誰もロストしていなければ「まだいない」',E.ledgerLine(none,none.adv[99],'came')==='帳面によれば、この店から迷宮に呑まれた者は、まだいない。','場面',E.ledgerLine(none,none.adv[99],'came'));
}

function checkOpening(){
  const names=[];
  for(let i=0;i<16;i++){
    const seed=1000+i*7919,E=load(seed),S=E.newState();
    const cast=openingOf(S),ours=Object.values(S.adv).filter(a=>a.tav==='ours');
    const cls=new Set(cast.map(a=>a.cls));
    const ties=cast.map(tieOf);
    const party=Object.values(S.parties).find(p=>p.tav==='ours');
    const ranked=party.members.map(id=>S.adv[id]).sort((a,b)=>b.lvl-a.lvl||a.id-b.id);
    const holders=cast.filter(a=>a.dream&&a.dream.k==='stele').sort((a,b)=>a.dream.vi-b.dream.vi);
    const guests=S.news.find(n=>n.t.startsWith('最初の客たち'));
    const opened=S.news.findIndex(n=>n.t.includes('黒猫亭を開いた'));
    const guestAt=S.news.indexOf(guests);
    const sele=cast.find(a=>a.origin==='セーレ自由都市同盟');
    check('開店の顔ぶれ：最初の常連は7人で、銀の杯亭には印がない',cast.length===7&&ours.length===7&&Object.values(S.adv).every(a=>a.tav==='ours'||!a.opening),`種${seed}`,`${cast.length}人`);
    check('開店の顔ぶれ：戦士・僧侶・盗賊・魔術師がそろう',['戦士','僧侶','盗賊','魔術師'].every(c=>cls.has(c)),`種${seed}`,[...cls].join('・'));
    check('開店の顔ぶれ：生い立ちに開店の一行が入り、7人で重ならない',ties.every(t=>OPENING_TIE.includes(t))&&new Set(ties).size===7,`種${seed}`,ties.join(' / '));
    check('開店の顔ぶれ：セーレ出身がいるときは、その一人が同じ船で来た',!sele||tieOf(sele)==='店主と同じ船でセーレから来た',`種${seed}`,sele?tieOf(sele):'なし');
    check('開店の顔ぶれ：名前は種ごとに違い、主人の名は使わない',cast.every(a=>a.name!=='ロドリック'),`種${seed}`,cast.map(a=>a.name).join('・'));
    check('開店の顔ぶれ：一行の中でレベルが高い2人が、別の文面の短い夢を持つ',holders.length===2&&holders.map(a=>a.id).join()===ranked.slice(0,2).map(a=>a.id).sort((a,b)=>S.adv[a].dream.vi-S.adv[b].dream.vi).join()&&holders.map(dreamLine).join('|')===STELE.join('|')&&party.members.includes(holders[0].id)&&party.members.includes(holders[1].id),`種${seed}`,holders.map(a=>`${a.name}Lv${a.lvl} ${dreamLine(a)}`).join(' / '));
    check('開店の顔ぶれ：最初の客たちの知らせが、開店の知らせの次に出る',!!guests&&guests.k==='info'&&guestAt===opened+1&&cast.every(a=>guests.t.includes(a.origin+'出身の'+a.name))&&guests.t.endsWith('が、開店の日から黒猫亭にいる。'),`種${seed}`,guests&&guests.t);
    check('開店の顔ぶれ：手帳の来店の記録に、生い立ちと夢が残る',cast.every(a=>{const door=(a.chron||[]).find(c=>c.t&&c.t.includes('扉をくぐる'));return !!(door&&door.t.includes(tieOf(a))&&door.t.includes('夢は「'+dreamLine(a)+'」'));}),`種${seed}`,()=>cast.filter(a=>{const door=(a.chron||[]).find(c=>c.t&&c.t.includes('扉をくぐる'));return !(door&&door.t.includes(tieOf(a))&&door.t.includes('夢は「'+dreamLine(a)+'」'));}).map(a=>`${a.name}：${(a.chron.find(c=>c.t&&c.t.includes('扉をくぐる'))||{}).t||'記録なし'}`).join(' / '));
    check('開店の顔ぶれ：まだ潜っていない短い夢の進みはB0Fと出ない',holders.every(a=>(a.deepest||0)===0&&E.DREAMS.stele.prog(a)==='まだ迷宮に潜っていない'),`種${seed}`,holders.map(a=>E.DREAMS.stele.prog(a)).join(' / '));
    check('開店の直後：階段を降りる前なので、個人の最深到達は0',Object.values(S.adv).every(a=>(a.deepest||0)===0),`種${seed}`,Object.values(S.adv).filter(a=>a.deepest).map(a=>`${a.name}${a.deepest}`).slice(0,4).join(' / '));
    check('開店の直後：まだ最深のない客の手帳の最深は―',holders.every(a=>E.deepNow(a.deepest)==='―'),`種${seed}`,holders.map(a=>E.deepNow(a.deepest)).join(' / '));
    names.push(cast.map(a=>a.name).join(','));
    if(i===0){
      Object.values(S.adv).forEach(a=>{delete a.opening;if(a.dream&&a.dream.k==='stele')a.dream={k:'fame',vi:0};});
      S.v=23;E.migrate(S);
      check('開店の顔ぶれ：版23の古い記録を開いても印は付かない',S.v===SAVE_V&&Object.values(S.adv).every(a=>!a.opening&&!(a.dream&&a.dream.k==='stele')),'版23',`版${S.v}`);
    }
  }
  check('開店の顔ぶれ：名前は使い回さず、種が違えば顔ぶれも違う',new Set(names).size===names.length,'16種',names[0]);
  {const E=load(1);check('短い夢：まだ潜っていない進みは、まだ迷宮に潜っていない',E.DREAMS.stele.prog({deepest:0})==='まだ迷宮に潜っていない'&&E.DREAMS.stele.prog({deepest:1})==='これまでの最深 B1F','進み',E.DREAMS.stele.prog({deepest:0})+' / '+E.DREAMS.stele.prog({deepest:1}));}
  let hit=0,left=0;
  for(let i=0;i<16;i++){
    const seed=1000+i*7919,E=load(seed);E.setQuietLog(true);const S=E.newState();
    for(let t=0;t<6;t++)E.tick(S);
    let day=0;
    for(let d=1;d<=30;d++){for(let t=0;t<E.TICKS_PER_DAY;t++){E.tick(S);E.rivalTemple(S);}if(!day&&(S.stats.dreams.ours||0)>0)day=d;}
    if(day)hit++;
    for(const a of Object.values(S.adv)){
      if(!a.opening&&((a.dream&&a.dream.k==='stele')||(a.pastDreams||[]).some(d=>d.k==='stele')))left++;
      const why=(S.farewells||[]).find(f=>f.id===a.id);
      if(why&&/石碑/.test(why.why))left++;
    }
  }
  check('開店の顔ぶれ：店主が何もしなくても、種の半数以上で30日までに黒猫亭の夢がかなう',hit>=8&&left===0,'16種',`${hit}/16 もれ${left}`);
}

// 「出身と経歴」：性別を決めつける文は、その人の性別に合わせる。女に男・息子・三男、男に娘は付かない
function sexClash(sex,t){
  t=String(t||'');
  if(sex==='女'){
    if(/男|息子|人夫/.test(t))return '男・息子・人夫';
    if(t.includes('僧')&&!t.includes('尼僧'))return '僧';
    if(t.includes('浪人')&&!t.includes('女浪人'))return '浪人';
  }else if(/娘|女|尼/.test(t))return '娘・女・尼';
  return '';
}
function checkCareer(){
  const E=load(1);
  const bad=[];
  for(const [name,o] of Object.entries(E.ORIGINS)){
    if(!o.bg||o.bg.length!==3)bad.push(`${name}の段階が${o.bg?o.bg.length:'なし'}`);
    (o.bg||[]).forEach((pool,i)=>pool.forEach(line=>{
      for(const sex of ['男','女']){
        const t=E.careerLine(line,sex);
        const why=sexClash(sex,t);
        if(why||typeof t!=='string'||!t)bad.push(`${name}[${i}]${sex}「${t}」${why||'空'}`);
      }
    }));
  }
  check('経歴：文の候補は性別と食い違わない',!bad.length,'出身ごとの経歴',bad.join(' / ')||'合う');
  // 乱数を先頭・中間・末尾に固定して、各段階の候補を取り切る
  const bands=[[1,0],[4,0],[5,1],[10,1],[11,2],[24,2]];
  const miss=[];
  for(const fixed of [1e-9,.5,.999]){
    const F=load(2,fixed);
    for(const [name,o] of Object.entries(F.ORIGINS))for(const [lv,bi] of bands)for(const sex of ['男','女']){
      const t=F.originBg(name,lv,sex);
      const allow=o.bg[bi].map(line=>F.careerLine(line,sex));
      if(!allow.includes(t)||sexClash(sex,t))miss.push(`${name}・Lv${lv}・${sex}・乱数${fixed}「${t}」`);
    }
  }
  check('経歴：来店時のレベルと性別で、その段階の文だけが出る',!miss.length,'出身×段階×性別',miss.slice(0,8).join(' / ')||'合う');
  const lived=[];
  for(let i=0;i<8;i++){
    const S=load(1000+i*7919).newState();
    for(const a of Object.values(S.adv)){const why=sexClash(a.sex,a.bg);if(why)lived.push(`${a.name}（${a.sex}・${a.origin}）${a.bg}`);}
  }
  check('経歴：来た者の生い立ちが性別と食い違わない',!lived.length,'8種の開店',lived.slice(0,4).join(' / ')||'合う');
  {const E3=load(3),S=E3.newState(),a=Object.values(S.adv).find(x=>x.tav==='ours');
    a.sex='女';a.bg='辺境の農家の三男坊。空き家の前の住人の息子';
    const door=a.chron.find(c=>c.t&&c.t.includes('扉をくぐる'));const before=door&&door.t;
    S.v=23;E3.migrate(S);
    check('経歴：この決まりより前の記録は、食い違った文のまま残る',S.v===SAVE_V&&a.bg==='辺境の農家の三男坊。空き家の前の住人の息子'&&door&&door.t===before,'版23',`版${S.v} ${a.bg}`);}
}

// 「来店時の年齢」：年長枠の割合はレベルで決まり、枠の中は若い側に寄る。55歳以上の伸びはこれまでどおり
function checkAge(){
  const E=load(11);
  const N=8000;
  const bands=[[1,.03],[10,.03],[11,.08],[16,.08],[17,.15],[24,.15]];
  const lo=p=>p===.03?.015:p===.08?.055:.115,hi=p=>p===.03?.042:p===.08?.11:.19;
  for(const race of Object.keys(E.AGE2))for(const [lv,p] of bands){
    const r=E.AGE2[race];let old=0,bad=0;
    for(let i=0;i<N;i++){const age=E.rollAge(race,lv);
      if(age<r.n[0]||age>r.o[1]||(age>r.n[1]&&age<r.o[0]))bad++;
      else if(age>=r.o[0])old++;}
    const rate=old/N;
    check('年齢：年長枠の割合は来店時レベルどおり',bad===0&&rate>lo(p)&&rate<hi(p),`${race}・レベル${lv}`,`${(rate*100).toFixed(2)}%（決まりは${Math.round(p*100)}%）範囲外${bad}`);
  }
  const ages=[];
  for(let i=0;i<20000;i++){const age=E.rollAge('人間',21);if(age>=31)ages.push(age);}
  ages.sort((a,b)=>a-b);
  const med=ages[Math.floor(ages.length/2)];
  const elder=ages.filter(a=>a>=55).length/ages.length;
  check('年齢：年長枠は枠の若い側に寄り、55歳以上は多くない',ages.length>500&&med>=34&&med<=42&&elder>.04&&elder<.18,'人間・レベル21',`中央${med}歳・55歳以上${(elder*100).toFixed(1)}%（${ages.length}人）`);
}

// 出る魔物。窓・重み・息を吐かない魔物の攻撃と経験。古い記録の戦い相手はそのまま
function checkFoes(){
  const E=load(1);
  // 息の四体の出やすさ。死因の1位が息の魔物に寄りすぎないよう、番犬と炉の番人ゴーレムはさらに下げる
  const breath={'キメラ':.6,'墓所の番犬':.45,'盲目の洞窟竜':.6,'炉の番人ゴーレム':.4};
  // 息の傷の倍率。番犬は 0.75、炉の番人ゴーレムは 0.9 で、ほかの息の魔物は持たない
  const scale={'墓所の番犬':.75,'炉の番人ゴーレム':.9};
  for(const m of E.MON)if(m.sp==='breath'||m.br!=null)check('出る魔物：息の傷の倍率を持つのは番犬（0.75）と炉の番人ゴーレム（0.9）だけ',m.br===scale[m.n],m.n,`倍率${m.br==null?'なし':m.br}（決まりは${scale[m.n]==null?'なし':scale[m.n]}）`);
  // 番犬の息を、同じ種で、倍率のない同じ強さの魔物と比べる。古い記録で戦いの途中だった番犬（倍率の値を持たない）には名で引いてかける。
  // 水晶のログは名の文字数ぶん乱数を引き、怖いものや相性は名で引くので、比べる相手は同じ長さで「番犬」を含む名にする
  const breathDmg=(seed,fix)=>{const E2=load(seed),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.cls='戦士';a.lvl=8;a.hp=a.mhp=50000;a.mp=0;a.pers='普通';a.poison=0;a.eq={};
    p.members=[a.id];p.leader=a.id;p.floor=15;p.state='explore';p.fought=true;p.ident=true;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;p.log=[];
    S.floors=S.floors||{};S.floors[15]={through:1};// 前人未踏の足しがなく、階の強さが整数（10）なので、息の傷の0.75倍を端数なしで比べられる
    p.etype=fix(Object.assign({},E2.MON.find(m=>m.n==='墓所の番犬')));p.enemies=[{hp:99999,sleep:0}];
    E2.combat(S,p);return {dmg:50000-a.hp,breathed:p.log.some(x=>x.t.includes('ほのおを はいた'))};};
  let hound=0;
  for(let seed=1;seed<=40&&hound<5;seed++){
    const plain=breathDmg(seed,t=>Object.assign(t,{n:'ためし番犬',br:undefined}));
    if(!plain.breathed)continue;hound++;
    const now=breathDmg(seed,t=>t),old=breathDmg(seed,t=>{delete t.br;return t;});
    check('出る魔物：番犬の息の傷は、同じ強さの息の0.75倍',now.breathed&&now.dmg===Math.round(plain.dmg*.75)&&now.dmg<plain.dmg,`種${seed}`,`倍率なし${plain.dmg} 番犬${now.dmg}`);
    check('出る魔物：倍率の値を持たない古い記録の番犬にも、名で引いて同じ倍率がかかる',old.dmg===now.dmg,`種${seed}`,`番犬${now.dmg} 古い${old.dmg}`);
    const vplain=breathDmg(seed,t=>Object.assign(t,{n:'若い墓所の番犬',base:'ためし番犬',br:undefined})),vari=breathDmg(seed,t=>Object.assign(t,{n:'若い墓所の番犬',base:'墓所の番犬'})),vold=breathDmg(seed,t=>{delete t.br;return Object.assign(t,{n:'若い墓所の番犬',base:'墓所の番犬'});});
    if(vplain.breathed)check('出る魔物：変異種の番犬の息にも同じ倍率がかかり、倍率の値を持たなくても元の名で引く',vari.dmg===Math.round(vplain.dmg*.75)&&vold.dmg===vari.dmg,`種${seed}`,`倍率なし${vplain.dmg} 変異種${vari.dmg} 古い変異種${vold.dmg}`);}
  check('出る魔物：番犬の息を5種で試し打ちした',hound===5,'40種',`${hound}種`);
  // 炉の番人ゴーレムも同じく。比べる相手は同じ長さで「ゴーレム」を含む名にする
  const golemDmg=(seed,fix)=>breathDmg(seed,t=>fix(Object.assign(t,E.MON.find(m=>m.n==='炉の番人ゴーレム'),{})));
  let golemN=0;
  for(let seed=1;seed<=80&&golemN<5;seed++){
    const plain=golemDmg(seed,t=>Object.assign(t,{n:'ため番人ゴーレム',br:undefined}));
    if(!plain.breathed)continue;golemN++;
    const now=golemDmg(seed,t=>t),old=golemDmg(seed,t=>{delete t.br;return t;});
    check('出る魔物：炉の番人ゴーレムの息の傷は、同じ強さの息の0.9倍',now.breathed&&now.dmg===Math.round(plain.dmg*.9)&&now.dmg<plain.dmg,`種${seed}`,`倍率なし${plain.dmg} ゴーレム${now.dmg}`);
    check('出る魔物：倍率の値を持たない古い記録の炉の番人ゴーレムにも、名で引いて同じ倍率がかかる',old.dmg===now.dmg,`種${seed}`,`ゴーレム${now.dmg} 古い${old.dmg}`);}
  check('出る魔物：炉の番人ゴーレムの息を5種で試し打ちした',golemN===5,'80種',`${golemN}種`);
  const maze={
    'レイス':8,'ミノタウロス':13,'溺れた衛兵':12,'水路の大蛇':14,'堕ちた騎士':16,'石の巨像':20,
    '亡霊騎士':20,'宮廷魔術師の亡霊':16,'屍喰らい':22,'吸魂の司祭':20,'塔の番兵ゴーレム':24,
    '狂った見習い魔術師':21,'近衛騎士長':28,'澱の落とし子':26,
  };
  const mine={
    '崩落蜘蛛':26,'鉄喰いトロール':28,'坑道ゴーレム':29,'澱の坑夫':33,'坑道都市の衛兵':34,
    '鉱脈の大蛇':38,'晶石の亡霊':39,'地底の巨人':42,
  };
  for(const m of E.MON){
    if(breath[m.n]!=null)check('出る魔物：息の四体の出やすさはキメラと洞窟竜が0.6、番犬が0.45、炉の番人ゴーレムが0.4で、経験の埋め合わせはない',m.w===breath[m.n]&&!m.xb&&m.sp==='breath',m.n,`w${m.w}（決まりは${breath[m.n]}） 経験${m.xb||1}`);
    else if(maze[m.n]!=null)check('出る魔物：迷宮の埋め合わせは攻撃を上げず、経験が1.13倍',m.atk===maze[m.n]&&m.xb===1.13&&!m.w,m.n,`攻${m.atk} 経験${m.xb||1} 出やすさ${m.w||1}`);
    else if(mine[m.n]!=null)check('出る魔物：坑道の埋め合わせは攻撃を上げず、経験が1.15倍',m.atk===mine[m.n]&&m.xb===1.15&&!m.w,m.n,`攻${m.atk} 経験${m.xb||1} 出やすさ${m.w||1}`);
    else check('出る魔物：それ以外の出やすさと経験は変えない',!m.w&&!m.xb,m.n,`出やすさ${m.w||1} 経験${m.xb||1}`);
  }
  const rare=new Set(E.RARES.concat(E.MINE_RARES||[]).map(r=>r.n));
  for(let f=1;f<=E.MINE_BOT;f++)for(const fr of [0,1]){
    const pool=E.foePool(f,!!fr),mine=f>E.MAXF,fs=E.dz(f)+(fr?1.8:0),span=2;
    const here=E.MON.filter(m=>!m.boss&&!m.gate&&!!m.mine===mine);
    const win=here.filter(m=>m.f<=fs+.4&&m.f>=fs-span);
    const want=(win.length?win:here.filter(m=>m.f<=fs+.4).slice(-3));
    const exp=(want.length?want:here.slice(0,3)).map(m=>m.n).join('、');
    const got=pool.map(m=>m.n).join('、');
    const bad=pool.some(m=>m.boss||m.gate||rare.has(m.n)||!!m.mine!==mine);
    check('出る魔物：候補は窓の中の、同じダンジョンの普通の魔物',got===exp&&!bad,`${E.FN(f)}${fr?'・前人未踏':''}`,bad?'主か名のある魔物が入った':`${got}（決まりは${exp}）`);
  }
  const pin=(f,fr,want)=>check('出る魔物：階ごとの顔ぶれが決まりどおり',E.foePool(f,fr).map(m=>m.n).join('、')===want,`${E.FN(f)}${fr?'・前人未踏':''}`,E.foePool(f,fr).map(m=>m.n).join('、'));
  pin(14,false,'溺れた衛兵、キメラ、水路の大蛇、堕ちた騎士');
  pin(14,true,'石の巨像、亡霊騎士');
  pin(37,false,'鉄喰いトロール、坑道ゴーレム、盲目の洞窟竜');
  pin(38,false,'坑道ゴーレム、盲目の洞窟竜');
  pin(42,false,'澱の坑夫、坑道都市の衛兵、炉の番人ゴーレム');
  pin(43,false,'坑道都市の衛兵、炉の番人ゴーレム');
  pin(45,false,'炉の番人ゴーレム、鉱脈の大蛇、晶石の亡霊');
  const boss=()=>{const S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');p.floor=E.MAXF;p.state='explore';E.encounter(S,p);return p.etype&&p.etype.n;};
  check('出る魔物：まだ討っていないB30Fの相手は沈んだ王',boss()==='沈んだ王','B30F',boss());
  // 坑道B12F。顔ぶれは坑夫1・衛兵1・ゴーレム0.4。種を固定して、ゴーレムが衛兵より少ないことを見る
  {const E2=load(7),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.floor=42;p.state='explore';S.floors=S.floors||{};S.floors[42]={through:1};S.rares=S.rares||{};S.rares[42]={killed:1};
    const c={};for(let i=0;i<800;i++){E2.encounter(S,p);const n=(p.etype.base||p.etype.n);c[n]=(c[n]||0)+1;p.enemies=null;}
    const g=c['炉の番人ゴーレム']||0,w=c['坑道都市の衛兵']||0,d=c['盲目の洞窟竜']||0,k=c['澱の坑夫']||0;
    check('出る魔物：息の魔物は、同じ階の息を吐かない魔物より出にくい',g<w&&g<k&&d===0&&g+w+k===800,'坑道B12Fを800回',`ゴーレム${g} 洞窟竜${d} 衛兵${w} 坑夫${k}`);}
  const xpOf=mon=>{const E2=load(1,.99),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.race='エルフ';a.tal='並';a.traits=[];a.xp=0;a.lvl=10;a.hp=a.mhp=100;p.members=[a.id];p.floor=43;p.state='explore';p.maps={43:1};p.loot=0;p.trip=p.trip||{kills:{},deep:43};
    p.etype=Object.assign({},E2.MON.find(m=>m.n===mon));p.enemies=[{hp:0,sleep:0}];E2.victory(S,p);return {xp:a.xp,gold:p.loot};};
  const raw=f=>(6*Math.pow(f,1.6)+3)*3;
  const golem=xpOf('坑道ゴーレム'),dragon=xpOf('盲目の洞窟竜');
  check('出る魔物：坑道の埋め合わせの経験は1.15倍で、金にはかからない',golem.xp===Math.round(raw(16)*1.15)&&golem.gold===Math.round(12*16*3),'坑道ゴーレム',`経験${golem.xp}（1.15倍は${Math.round(raw(16)*1.15)}） 金${golem.gold}`);
  check('出る魔物：息の魔物の経験と金は強さのまま',dragon.xp===Math.round(raw(17))&&dragon.gold===Math.round(12*17*3),'盲目の洞窟竜',`経験${dragon.xp} 金${dragon.gold}`);
  const knight=xpOf('堕ちた騎士');
  const knightRaw=(6*Math.pow(9,1.6)+3);
  check('出る魔物：迷宮の埋め合わせの経験は1.13倍で、金にはかからない',knight.xp===Math.round(knightRaw*1.13)&&knight.gold===Math.round(12*9),'堕ちた騎士',`経験${knight.xp}（1.13倍は${Math.round(knightRaw*1.13)}） 金${knight.gold}`);
  {const E2=load(1,.99),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const a=S.adv[p.leader];
    a.race='エルフ';a.tal='並';a.traits=[];a.xp=0;a.lvl=10;a.hp=a.mhp=100;p.members=[a.id];p.floor=43;p.state='explore';p.maps={43:1};p.loot=0;p.trip=p.trip||{kills:{},deep:43};
    const t=E2.MON.find(m=>m.n==='坑道都市の衛兵');
    p.etype=Object.assign({},t,{n:'飢えた'+t.n,base:t.n,xpm:1.1});p.enemies=[{hp:0,sleep:0}];E2.victory(S,p);
    check('出る魔物：変異の倍率は、埋め合わせのあとにもかかる',a.xp===Math.round(raw(t.f)*1.15*1.1),'飢えた坑道都市の衛兵',`経験${a.xp}（決まりは${Math.round(raw(t.f)*1.15*1.1)}）`);}
  {const E2=load(3),S=E2.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours'&&x.members.length);
    p.floor=43;p.state='explore';p.fought=true;p.enemies=[{hp:99999,sleep:0}];
    p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp;});
    p.etype={n:'坑道都市の衛兵',u:'ずんぐりした よろいの ひとかげ',f:19,hp:215,atk:99,mine:true};
    S.v=23;E2.migrate(S);const t0=S.tick;E2.tick(S);
    check('古い記録：戦いの途中の魔物は今の強さに読み替えず、開いたあとにも進む',p.etype&&p.etype.atk===99&&p.etype.n==='坑道都市の衛兵'&&p.enemies&&p.enemies[0].hp>0&&S.v===SAVE_V&&S.tick>t0,'版23',`攻${p.etype&&p.etype.atk} 版${S.v} 刻${S.tick}`);}
  {const S=E.newState();S.v=SAVE_V-1;E.migrate(S);
    check('古い記録：新しい記録の版と、移行を終えた記録の版はどちらも今の版',E.newState().v===SAVE_V&&S.v===SAVE_V,`版${SAVE_V-1}`,`新しい記録${E.newState().v} 移行後${S.v} 今の版${SAVE_V}`);}
}

// 「全滅」「他の一行の発見」「後継ぎ」「寺院の費用と店の立て替え」：消息不明の期間、遺体の搬送、巡回隊、一行の借り、看板を継ぐかどうか
function checkMissing(){
  const MAXF0=load(1).MAXF;
  const wipedScene=(seed,floor,opt={})=>{const E=load(seed),S=E.newState();const ps=Object.values(S.parties).filter(x=>x.tav==='ours');const p=ps[0],q=ps[1]||Object.values(S.parties).find(x=>x!==p);
    Object.values(S.parties).forEach(x=>{x.state='town';x.rest=99;});
    p.members.forEach(id=>{const a=S.adv[id];a.status='missing';a.hp=0;a.party=p.id;});
    Object.assign(p,{state:'wiped',retrieved:false,announced:!!opt.announced,knownWiped:!!opt.known,wipedAt:S.tick,floor,killer:'オーク',cause:'オークに倒れた',causeTold:!!opt.known,dueAt:S.tick+100,owed:opt.owed||0});
    return {E,S,p,q};};
  const told=(S,p)=>p.members.every(id=>(S.adv[id].chron||[]).some(c=>c.t==='全滅した。オークに倒れた'));
  // 生還した一行が、同じ探索先で全滅した階以上まで潜っていれば、その帰還の刻に遺体が届く
  {const {E,S,p,q}=wipedScene(1,5);q.trip=Object.assign(q.trip||{},{deep:4});E.deliverCorpses(S,q);
    check('発見：全滅した階より浅くしか潜っていない一行では、遺体は届かない',!p.retrieved&&!told(S,p)&&p.members.every(id=>S.adv[id].status==='missing'),'B4Fまで',`${p.retrieved}`);
    q.trip.deep=E.MAXF+5;E.deliverCorpses(S,q);
    check('発見：坑道に潜った一行は、迷宮で全滅した一行を持ち帰らない',!p.retrieved,'坑道B5Fまで',`${p.retrieved}`);
    q.trip.deep=5;S.bounties[p.id]=700;const g0=E.alive(S,q).map(a=>a.gold);const n0=S.news.length;E.deliverCorpses(S,q);
    const n=S.news.slice(n0).map(x=>x.t);
    check('発見：全滅した階以上まで潜って戻った一行がいれば、遺体が街に届き、死因と階が手帳と知らせに残る',p.retrieved&&p.announced&&told(S,p)&&p.members.every(id=>S.adv[id].status!=='missing')&&n.some(t=>t.includes(`${q.name}${q.tav===p.tav?'':'（銀の杯亭）'}がB5Fまで潜って戻り、${p.name}の遺体が街に届いた。B5F、オークに倒れていた。`)),'B5Fまで',n.join(' / '));
    check('発見：死体回収の依頼の報酬は、届けた一行に払われる',!S.bounties[p.id]&&E.alive(S,q).every((a,i)=>a.gold>g0[i])&&n.some(t=>t.includes('死体回収の報酬')),'依頼700G',n.join(' / '));
    E.tick(S);check('発見：遺体が着いた一行は街の支度に戻る',p.state==='town'&&!p.retrieved,'次の刻',p.state);}
  // 20日たっても見つからなければ、最深階から PATROL_DEPTH 階上までなら巡回隊が連れ帰り、それより深ければロスト
  {const {E,S,p}=wipedScene(2,4);S.deepest.ours=7;S.deepest.rival=1;p.wipedAt=S.tick-1001;const n0=S.news.length;E.tick(S);
    check('巡回隊：最深階から3階上までなら、20日後に遺体を連れ帰る',p.state==='town'&&told(S,p)&&S.news.slice(n0).some(x=>x.t.startsWith(`巡回隊が見つけ、${p.name}の遺体が街に届いた。B4F、`))&&S.parties[p.id],'最深B7F・B4F',S.news.slice(n0).map(x=>x.t).join(' / '));}
  {const {E,S,p}=wipedScene(2,5);S.deepest.ours=7;S.deepest.rival=1;p.wipedAt=S.tick-1001;const n0=S.news.length;E.tick(S);
    check('巡回隊：それより深ければ届かず、ロストする',!S.parties[p.id]&&S.news.slice(n0).some(x=>x.t.includes('ついに見つからなかった')&&x.t.includes('B5Fに消えた')),'最深B7F・B5F',S.news.slice(n0).map(x=>x.t).join(' / '));}
  {const {E,S,p}=wipedScene(2,MAXF0+2);S.mineDeep={ours:5,rival:2};S.deepest.ours=30;p.wipedAt=S.tick-1001;const n0=S.news.length;E.tick(S);
    check('巡回隊：坑道は坑道の最深階で比べる',p.state==='town'&&S.news.slice(n0).some(x=>x.t.startsWith('巡回隊が')),'坑道最深B5F・坑道B2F',S.news.slice(n0).map(x=>x.t).join(' / '));}
  {const {E,S,p}=wipedScene(2,MAXF0+3);S.mineDeep={ours:5,rival:2};S.deepest.ours=30;p.wipedAt=S.tick-1001;E.tick(S);
    check('巡回隊：坑道の最深階から3階より浅くなければロスト',!S.parties[p.id],'坑道最深B5F・坑道B3F',`${!!S.parties[p.id]}`);}
  // 一行の借り：立て替えの記録、消息不明のあいだの利息、帰還時の返し、貸し倒れ
  {const E=load(3),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours'),r=Object.values(S.parties).find(x=>x.tav==='rival');
    E.owe(S,p,300);E.owe(S,p,200.4);E.owe(S,r,500);E.owe(S,null,100);
    check('一行の借り：黒猫亭の一行にだけ積み、端数は丸める',p.owed===500&&!(r.owed>0),'300+200.4',`黒${p.owed} 銀${r.owed}`);
    const {E:E2,S:S2,p:p2}=wipedScene(3,5,{announced:true,owed:1000});S2.tick=E2.TICKS_PER_DAY*10-1;E2.tick(S2);
    check('一行の借り：消息不明の1日ごとに OWED_RATE の複利がつく',p2.owed===1020&&p2.owedInterest===20,'1000G・1日',`${p2.owed}`);
    S2.tick=E2.TICKS_PER_DAY*11-1;E2.tick(S2);check('一行の借り：複利なので2日目は増えた分にもつく',p2.owed===1040&&p2.owedInterest===40,'2日目',`${p2.owed}`);
    const {E:E3,S:S3,p:p3}=wipedScene(3,5,{announced:true,known:true,owed:1000});S3.tick=E3.TICKS_PER_DAY*10-1;E3.tick(S3);
    check('一行の借り：水晶で最期を見ていた一行には利息がつかない',p3.owed===1000,'見ていた',`${p3.owed}`);
    const {E:E4,S:S4,p:p4}=wipedScene(3,5,{owed:1000});S4.tick=E4.TICKS_PER_DAY*10-1;p4.dueAt=S4.tick+1000;E4.tick(S4);
    check('一行の借り：まだ消息不明と知れていないあいだは利息がつかない',p4.owed===1000,'隠れている',`${p4.owed}`);}
  {const E=load(4),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');const T0=S.taverns.ours;
    p.state='return';p.floor=1;p.loot=2000;p.owed=1000;p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.hp=a.mhp;});const g0=T0.gold;E.arrive(S,p);
    check('一行の借り：帰還のとき、稼ぎの OWED_REPAY までを返し、出入りに立て替えの返りとして出る',p.owed===500&&T0.owedBack===500&&E.flowView(S).w.k===500&&T0.gold>=g0+500,'稼ぎ2000・借り1000',`借り${p.owed} 戻り${T0.owedBack} 出入り${E.flowView(S).w.k}`);
    p.state='return';p.floor=1;p.loot=1000;p.owed=100;p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.hp=a.mhp;});E.arrive(S,p);
    check('一行の借り：借りが稼ぎの割合より少なければ、残り全部を返す',p.owed===0&&T0.owedBack===600,'稼ぎ1000・借り100',`借り${p.owed} 戻り${T0.owedBack}`);}
  // 看板を継ぐかどうか。性格の傾きに絆・恩・素質・前のリーダーの去り方・借りを足し引きし、番号で決まる揺れを足す。乱数は引かない
  {const E=load(5),E2=load(99);
    // 判定に要るのは、継ぐ者・前のリーダー・一行・二人の絆だけ。乱数の種が違う二つの中身で同じ答えになるかも見る
    const set=(pers,n,fv,owed,traits,id,ost)=>{const a={id,pers,favor:fv,traits:traits||[]},old={id:7,status:ost||'retired'},p={id:3,owed};
      const r=[E,E2].map(EE=>EE.inheritWill({bonds:{[EE.bkey(a,old)]:{n,ev:[]}}},a,old,p));return r[0]===r[1]?r[0]:null;};
    const ids=Array.from({length:60},(_,i)=>1000+i*37);
    for(const pers of ['無謀','普通','慎重','強欲','臆病']){
      const rs=ids.map(id=>set(pers,20,0,0,[],id));
      check('後継ぎ：同じ記録からは、乱数の種によらず同じ答えになる',rs.every(x=>x!==null),pers,rs.join(','));
      check('後継ぎ：どの性格も、継ぐことも継がないこともある（絆20・恩0・借りなし）',rs.includes(true)&&rs.includes(false),pers,`継ぐ${rs.filter(x=>x).length}／継がない${rs.filter(x=>x===false).length}`);
      const lo=ids.filter(id=>set(pers,5,0,0,[],id)).length,hi=ids.filter(id=>set(pers,40,3,0,[],id)).length;
      check('後継ぎ：絆と恩が深いほど継ぎやすい',hi>lo&&ids.every(id=>!set(pers,5,0,0,[],id)||set(pers,40,3,0,[],id)),pers,`絆5で${lo}人 → 絆40・恩3で${hi}人`);
      const free=ids.filter(id=>set(pers,20,0,0,[],id)).length,owe=ids.filter(id=>set(pers,20,0,2000,[],id)).length;
      check('後継ぎ：借りが重いと継ぎにくい',owe<free,pers,`借りなし${free}人 → 借り2000Gで${owe}人`);}
    const g0=ids.filter(id=>set('強欲',20,0,0,[],id)).length,g1=ids.filter(id=>set('強欲',20,0,1200,[],id)).length,n0=ids.filter(id=>set('普通',20,0,0,[],id)).length,n1=ids.filter(id=>set('普通',20,0,1200,[],id)).length;
    check('後継ぎ：強欲な者は、借りが重いとほかの性格より逃げやすい',g1===0&&g0-g1>n0-n1,'借り1200G',`強欲${g0}→${g1}・普通${n0}→${n1}`);
    const c0=ids.filter(id=>set('臆病',30,0,0,[],id,'retired')).length,c1=ids.filter(id=>set('臆病',30,0,0,[],id,'lost')).length,m0=ids.filter(id=>set('普通',30,0,0,[],id,'retired')).length,m1=ids.filter(id=>set('普通',30,0,0,[],id,'lost')).length;
    check('後継ぎ：前のリーダーを失ったとき、臆病な者は畳みやすく、ほかの者は継ぎやすい',c1<c0&&m1>=m0,'ロストと引退',`臆病${c0}→${c1}・普通${m0}→${m1}`);
    check('後継ぎ：どの性格にも継ぐときと継がないときの一言があり、強欲な者は借りが残ると別の一言',Object.keys(E.INHERIT_SAY).length===5&&Object.values(E.INHERIT_SAY).every(x=>x.length===2&&x.every(t=>typeof t==='string'&&t.length>0))&&E.inheritSay({pers:'強欲'},{owed:1},false)===E.INHERIT_DEBT_SAY&&E.inheritSay({pers:'強欲'},{owed:0},false)===E.INHERIT_SAY['強欲'][1],'一覧',JSON.stringify(E.INHERIT_SAY));
    const coward={pers:'臆病',lvl:20,traits:[],trips:50,age:30,race:'人間',cls:'戦士'},brave={pers:'慎重',lvl:12,traits:[],trips:10,age:30,race:'人間',cls:'戦士'};
    check('後継ぎ：跡継ぎは腕と経験と人望で選び、性格では外さない（臆病な者も選ばれる）',E.heirScore(coward)>E.heirScore(brave)&&E.leaderScore(coward)-E.heirScore(coward)===-3,'臆病Lv20と慎重Lv12',`${E.heirScore(coward)}／${E.heirScore(brave)}`);}
  {const E=load(6),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours'&&x.members.length>=3);const ms=p.members.map(id=>S.adv[id]);const old=S.adv[p.leader];
    ms.forEach(a=>{a.status='idle';a.hp=a.mhp;a.pers='強欲';a.favor=0;});old.status='lost';old.party=null;p.state='town';p.rest=1;p.owed=800;
    const best=ms.filter(a=>a!==old).sort((x,y)=>E.heirScore(y)-E.heirScore(x)||x.id-y.id)[0];const n0=S.news.length;const T0=S.taverns.ours;
    const ok=E.succession(S,p,ms.filter(a=>a!==old),old);const n=S.news.slice(n0).map(x=>x.t);
    check('後継ぎ：強欲な者は借りの残る看板を継がず、一行は解散して借りは貸し倒れになる',!ok&&!S.parties[p.id]&&T0.badDebt===800&&n.some(t=>t.includes('解散した。')&&t.includes(`${best.name}は看板を継がなかった。「借りまで継ぐ気はない」`))&&n.some(t=>t.includes('800Gは、貸し倒れになった')),'強欲・借り800',n.join(' / '));}
  {const E=load(6),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours'&&x.members.length>=3);const ms=p.members.map(id=>S.adv[id]);const old=S.adv[p.leader];
    ms.forEach(a=>{a.status='idle';a.hp=a.mhp;a.pers='無謀';a.traits=['人望'];});old.status='lost';old.party=null;p.owed=800;// 無謀で人望があり、前のリーダーを失った者は、揺れがいちばん悪くても継ぐ
    const best=ms.filter(a=>a!==old).sort((x,y)=>E.heirScore(y)-E.heirScore(x)||x.id-y.id)[0];const n0=S.news.length;
    const ok=E.succession(S,p,ms.filter(a=>a!==old),old);const n=S.news.slice(n0).map(x=>x.t);
    check('後継ぎ：継げば看板と借りをそのまま引き継ぎ、一言が添う',ok&&p.leader===best.id&&p.owed===800&&n.some(t=>t.includes(`${best.name}が後を継いで一行を率いることになった。「あいつの分まで潜ってやる」`)),'無謀・借り800',n.join(' / '));}
  // 古い記録。全滅中の一行は、まだ知らせていなければ古い決まりの15刻で知らせ、手帳の一文はもうある
  {const E=load(7),S=E.newState();const p=Object.values(S.parties).find(x=>x.tav==='ours');p.state='wiped';p.wipedAt=S.tick;p.announced=false;delete p.dueAt;delete p.owed;delete p.causeTold;S.v=27;E.migrate(S);
    check('古い記録：古い版を開くと今の版になり、全滅中の一行の予定帰還の刻は全滅から15刻で知らせる値、借りは0、手帳の一文は書いた扱いになる',S.v===E.SAVE_V&&p.dueAt===p.wipedAt+15-E.MISSING_GRACE&&p.owed===0&&p.causeTold===true,'版27',`予定${p.dueAt} 借り${p.owed} 一文${p.causeTold}`);}
}
// 「酒場のざわめき」「土産話」「記念碑」「知らせ」：最後の言葉と見送りの一行
function checkLastWords(){
  // 重複で捨てた会話の行はしまわない。同じ種で、会話が記録に入る刻の直前まで回し、その最初の一言を直近の会話に仕込んでから1刻進める
  {let hit=null;const E1=load(11),S1=E1.newState();for(let i=0;i<4000&&!hit;i++){const c0=(S1.chatter||[]).length;E1.tick(S1);if((S1.chatter||[]).length>c0)hit={i,entry:S1.chatter[S1.chatter.length-1]};}
    check('最後の言葉：会話が起きる刻を見つけた',!!hit,'種11・4000刻',hit?`${hit.i+1}刻目`:'起きない');
    if(hit){const E2=load(11),S2=E2.newState();for(let i=0;i<hit.i;i++)E2.tick(S2);
      const ids=hit.entry.lines.map(l=>l.id);
      S2.chatter=S2.chatter||[];S2.chatter.push({tk:S2.tick,lines:[{id:ids[0],who:'',t:hit.entry.lines[0].t}]});
      const snap=()=>JSON.stringify(ids.map(id=>S2.adv[id].said||[]));
      const before=snap(),c0=S2.chatter.length;E2.tick(S2);
      check('最後の言葉：重複で捨てた会話の行はしまわない',S2.chatter.length===c0&&snap()===before,'種11',`会話${c0}→${S2.chatter.length}`);
      // 仕込まなければ、同じ刻に同じ会話が入り、話した者の言葉がしまわれる
      const E3=load(11),S3=E3.newState();for(let i=0;i<=hit.i;i++)E3.tick(S3);
      check('最後の言葉：会話が記録に入ると、その各行が話した者にしまわれる',hit.entry.lines.every(l=>(S3.adv[l.id].said||[]).some(x=>x.t===l.t&&x.tk===hit.entry.tk)),'種11',hit.entry.lines.map(l=>l.t).join('／'));}}
  // 記念碑の最後の言葉は、しまった言葉のいちばん新しい1件。あとで変わらない。言葉がなければ刻まない。銀の杯亭にも刻む
  {const E=load(1),S=E.newState();const ours=Object.values(S.adv).filter(a=>a.tav==='ours');const [a,b]=ours;
    a.said=[{tk:1,t:'一つ目'},{tk:2,t:'二つ目'},{tk:3,t:'三つ目'}];a.status='lost';const m=E.memorialize(S,a,{by:'オーク',floor:2});
    a.said.push({tk:4,t:'四つ目'});
    check('記念碑：最後の言葉は、しまった言葉のいちばん新しい1件で、あとから変わらない',!!m.last&&m.last.t==='三つ目'&&m.last.tk===3,'3件',JSON.stringify(m.last));
    b.status='lost';const m2=E.memorialize(S,b,{by:'オーク',floor:2});
    check('記念碑：しまった言葉がなければ最後の言葉は刻まない',!('last' in m2),'言葉なし',JSON.stringify(m2.last));
    const r=Object.values(S.adv).find(x=>x.tav==='rival');r.said=[{tk:5,t:'銀の言葉'}];r.status='lost';const m3=E.memorialize(S,r,{by:'オーク',floor:2});
    check('記念碑：銀の杯亭の者にも最後の言葉を刻み、見送りの一行は付けない',!!m3.last&&m3.last.t==='銀の言葉'&&!('farewell' in m3),'銀の杯亭',JSON.stringify([m3.last,m3.farewell]));}
  {const E=load(1),S=E.newState();S.v=27;Object.values(S.adv).forEach(a=>{delete a.said;});E.migrate(S);
    check('古い記録：版27を開くと今の版になり、言葉は埋めず、記念碑にも何も足さない',S.v===E.SAVE_V&&Object.values(S.adv).every(a=>a.said==null)&&S.memorial.every(m=>!m.last&&!m.farewell),'版27',`版${S.v}`);}
  // 見送りの一行。選び方と文
  {const E=load(2),S=E.newState();const ours=Object.values(S.adv).filter(a=>a.tav==='ours').sort((x,y)=>x.id-y.id);
    const [lost,b,c,d]=ours;for(const x of [b,c,d]){x.status='idle';x.party=null;}
    const bond=(x,y,n,ev)=>{S.bonds=S.bonds||{};S.bonds[E.bkey(x,y)]={n,ev:ev||[]};};
    b.pers='慎重';b.tone='普通';bond(lost,b,3);
    const l1=E.farewellLine(S,[lost]);
    check('見送りの一行：絆3以上の生きている者がいれば、その者の名で始まる動きの一行',l1.startsWith(b.name+'は、')&&l1.endsWith('。'),'絆3・酒場',l1);
    check('見送りの一行：同じ記録からは何度やっても同じ一行',E.farewellLine(S,[lost])===l1,'絆3・酒場',l1);
    b.status='party';b.party=Object.keys(S.parties)[0];const l2=E.farewellLine(S,[lost]);
    check('見送りの一行：迷宮に出ている者なら、まだ迷宮にいて知らないと書く',l2===`${b.name}はまだ迷宮にいて、それを知らない。`,'絆3・迷宮',l2);
    b.status='idle';b.party=null;
    for(const st of ['dead','ash','missing','retired','lost']){b.status=st;const l=E.farewellLine(S,[lost]);
      check('見送りの一行：寺院で眠る者、行方不明の者、去った者、ロストした者は選ばれず、店の一行になる',/^その夜、黒猫亭/.test(l)&&!l.includes(b.name),st,l);}
    b.status='idle';S.bonds[E.bkey(lost,b)].n=2;const l3=E.farewellLine(S,[lost]);
    check('見送りの一行：絆が2以下なら選ばれない',/^その夜、黒猫亭/.test(l3),'絆2',l3);
    S.bonds[E.bkey(lost,b)].n=3;c.pers='普通';c.tone='普通';bond(lost,c,4);const l4=E.farewellLine(S,[lost]);
    check('見送りの一行：絆の深い者を選ぶ',l4.startsWith(c.name+'は、'),'絆3と4',l4);
    S.bonds[E.bkey(lost,c)].n=3;S.bonds[E.bkey(lost,c)].ev=[{k:'x'}];const l5=E.farewellLine(S,[lost]);
    check('見送りの一行：絆が同じなら出来事の多い者を選ぶ',l5.startsWith(c.name+'は、'),'絆3・出来事1',l5);
    S.bonds[E.bkey(lost,c)].ev=[];const l6=E.farewellLine(S,[lost]);
    check('見送りの一行：絆も出来事も同じなら先に店に来た者を選ぶ',l6.startsWith(b.name+'は、'),'絆3・出来事0',l6);
    b.tone='無口';const l7=E.farewellLine(S,[lost]);
    check('見送りの一行：口調が無口なら、無口の一覧から選ぶ',E.FAREWELL_TONE['無口'].some(t=>l7===t.replace(/\{n\}/g,b.name)),'無口',l7);
    b.tone='普通';bond(lost,d,5);d.tav='rival';const l8=E.farewellLine(S,[lost]);
    check('見送りの一行：よその店の者は選ばれない',l8.startsWith(b.name+'は、'),'銀の杯亭の絆5',l8);
    lost.tav='rival';check('見送りの一行：銀の杯亭の者には付けない',E.farewellLine(S,[lost])==='','銀の杯亭',E.farewellLine(S,[lost]));lost.tav='ours';
    const all=[...Object.values(E.FAREWELL_ACTS).flat(),...Object.values(E.FAREWELL_TONE).flat(),...E.FAREWELL_QUIET];
    check('見送りの一行：一覧のどの文も「店主」で始まらず、見ていなかった・間に合わなかったとは書かない',all.every(t=>!/店主|見ていなかった|間に合わなかった/.test(t)&&t.endsWith('。')),'一覧',all.length+'文');}
  // 友を失って変わる（無謀→慎重）より前の性格で決める。乱数を0.01に固定すると必ず変わる
  {const E=load(1,.01),S=E.newState();const ours=Object.values(S.adv).filter(a=>a.tav==='ours').sort((x,y)=>x.id-y.id);const [lost,b]=ours;
    b.status='idle';b.party=null;b.pers='無謀';b.tone='普通';S.bonds=S.bonds||{};S.bonds[E.bkey(lost,b)]={n:5,ev:[]};lost.status='lost';
    const m=E.memorialize(S,lost,{by:'オーク',floor:2});
    check('見送りの一行：友を失って変わるより前の性格で決める',b.pers==='慎重'&&E.FAREWELL_ACTS['無謀'].some(t=>m.farewell===t.replace(/\{n\}/g,b.name).replace(/\{o\}/g,lost.name)),'無謀→慎重',`${b.pers} ${m.farewell}`);}
}
function checkFlow(){
  const E=load(1),S=E.newState();
  const z=E.flowView(S);
  check('きょうの出入り：初日の前日は0',z.y.e===0&&z.y.s===0&&z.y.v===0&&z.y.r===0&&z.y.f===0&&z.w.e===0,'開店',JSON.stringify(z.y));
  E.flowAdd(S,'e',923);E.flowAdd(S,'s',180);E.flowAdd(S,'v',470);E.flowAdd(S,'r',5580);E.flowAdd(S,'f',15000);
  const a=E.flowView(S);
  check('きょうの出入り：その日の分は直近7日に入り、前日は0',a.y.e===0&&a.w.e===923&&a.w.s===180&&a.w.v===470&&a.w.r===5580&&a.w.f===15000,'初日',JSON.stringify(a.w));
  check('金額の表記：増減は+923Gと-4657G、0は0G',E.goldSign(923)==='+923G'&&E.goldSign(-4657)==='-4657G'&&E.goldSign(0)==='0G'&&E.goldSign(-180)==='-180G','表記',E.goldSign(-4657));
  S.tick=E.TICKS_PER_DAY;
  const b=E.flowView(S);
  check('きょうの出入り：日が変わると前日になる',b.y.e===923&&b.y.s===180&&b.y.v===470&&b.y.r===5580&&b.y.f===15000&&b.w.e===923&&b.w.f===15000,'2日目',JSON.stringify(b.y));
  S.tick=E.TICKS_PER_DAY*7;
  const c=E.flowView(S);
  check('きょうの出入り：7日より前は直近7日から外れる',c.y.e===0&&c.w.e===0&&c.w.f===0&&c.all.e===923&&c.all.f===15000,'8日目',JSON.stringify(c.w));
  const E2=load(2),S2=E2.newState(),T=S2.taverns.ours;
  T.gold=20000;S2.policy={potion:1,mapPay:false,revive:false,rookie:false};
  const paid=E2.repay(S2,1000);
  check('きょうの出入り：手で返した分は返済に入る',paid===1000&&E2.flowView(S2).w.r===1000&&S2.v===SAVE_V,'1000G',`返${E2.flowView(S2).w.r} 版${S2.v}`);
  E2.buildFac(S2,'dojo');
  const p=Object.values(S2.parties).find(x=>x.tav==='ours');
  const sup=T.support||0;E2.supplyTeam(S2,p);const pot=(T.support||0)-sup;
  const v2=E2.flowView(S2);
  check('きょうの出入り：設備は施設、回復薬は支援で、蘇生代には入らない',v2.w.f===15000&&pot>0&&v2.w.s===pot&&v2.w.v===0&&v2.w.r===1000,'建てる・差し入れ',`施設${v2.w.f} 支援${v2.w.s} 薬${pot}`);
  const E3=load(3),S3=E3.newState();
  const dead=Object.values(S3.adv).find(x=>x.tav==='ours'&&x.status!=='lost');
  const team=dead.party&&S3.parties[dead.party];if(team)team.members=team.members.filter(id=>id!==dead.id);
  dead.party=null;dead.status='dead';dead.hp=0;dead.tw=0;S3.policy={potion:0,mapPay:false,revive:true,rookie:false};
  S3.taverns.ours.gold=100000;const sup0=S3.taverns.ours.support||0;
  E3.tick(S3);
  const v3=E3.flowView(S3),dsup=(S3.taverns.ours.support||0)-sup0;
  check('きょうの出入り：自動の蘇生代は支援の行に入れない',v3.all.v>0&&v3.all.s===0&&v3.all.v===dsup&&dead.status!=='dead','肩代わり',`蘇生${v3.all.v} 支援${v3.all.s} 帳簿${dsup} 状態${dead.status}`);
  const E4=load(4),S4=E4.newState();
  Object.values(S4.adv).forEach(a=>{if(a.tav==='ours'&&a.status!=='lost'&&a.status!=='retired')a.lvl=19;});
  const c4=E4.policyCost(S4);
  const inc=f=>Math.round(70*Math.pow(Math.max(1,f),1.45));
  const mp=f=>{const d=E4.dz(f);return f<=3?[0,40,80,150][f]:Math.round((30*d*d+100*d)/10)*10;};
  const potU=Math.max(20,Math.round(inc(8)*.12/10)*10),per=.25;
  const base=Math.round(inc(8)*.5/10)*10;
  check('方針の費用：深さ8・一行1組の見積もり',c4.depth===8&&c4.parties===1&&c4.potion.join(',')===[0,2,5,10].map(b=>Math.round(b*potU*per)).join(',')&&c4.map===Math.round(mp(8)*per)&&c4.revive===Math.round(base/10),'Lv19',`深さ${c4.depth} 一行${c4.parties} 薬${c4.potion.join(',')} 地図${c4.map} 蘇生${c4.revive}`);
  S4.edicts=[{k:'templeUp',m:1.5,until:99999,t:''}];
  const up=E4.policyCost(S4);
  check('方針の費用：蘇生の見積もりはお触れの倍率を掛ける',up.revive===Math.round(Math.round(base*1.5)/10),'五割増',up.revive);
  Object.values(S4.adv).forEach(a=>{if(a.tav==='ours')a.lvl=1;});S4.taverns.ours.rep=0;S4.edicts=[];
  const low=E4.policyCost(S4);
  check('方針の費用：平均レベルが10未満の新人は、肩を並べる者も対象に数える',low.rookie===Math.round(0.016*50*(0.5+0.5*0.8)*300),'Lv1・評判0',low.rookie);
  Object.values(S4.adv).forEach(a=>{if(a.tav==='ours')a.lvl=19;});S4.edicts=[{k:'mercs',until:99999,t:''}];
  const merc=E4.policyCost(S4);
  check('方針の費用：平均レベル10以上の新人は肩を並べる者を外し、傭兵のお触れは1.8倍',merc.rookie===Math.round(0.016*50*1.8*(1-0.5)*0.8*300),'Lv19・傭兵',merc.rookie);
  const E5=load(5),S5=E5.newState();
  delete S5.flow;S5.tick=100*E5.TICKS_PER_DAY;S5.taverns.ours.earned=5000;S5.v=SAVE_V;E5.migrate(S5);
  const v5=E5.flowView(S5);
  check('きょうの出入り：古い記録の過ぎた日は0で、版は上がらない',v5.y.e===0&&v5.w.e===0&&v5.all.e===0&&S5.v===SAVE_V,'今の版',`売上${v5.w.e} 版${S5.v}`);
}

// 「出身と経歴」：知らせと手帳で、出身と経歴の言葉が重ならない。経歴はどの出身とも組んで確かめる
function checkIntro(){
  const E=load(1);
  const bgs=[];
  for(const o of Object.values(E.ORIGINS)) for(const pool of o.bg) for(const line of pool) for(const sex of ['男','女']) bgs.push(E.careerLine(line,sex));
  for(const [,pool] of E.BGS) for(const line of pool) bgs.push(line);
  const lines=[...new Set(bgs)];
  const bad=[],past=[];
  for(const origin of Object.keys(E.ORIGINS)){
    const o=E.ORIGINS[origin];
    for(const bg of lines){
      if(bg.endsWith('だった')) past.push(`${origin}「${bg}」`);
      const intro=E.originIntro(origin,bg);
      const clause=E.newcomerClause(origin,bg);
      if(clause.includes('だっただ')) bad.push(`だっただ ${origin}「${bg}」${clause}`);
      for(const token of [origin,o.short]){
        if(bg.includes(token)&&(intro.news.includes(token)||intro.door.includes(token))) bad.push(`重なり ${origin}「${token}」${bg}`);
      }
      const tail=bg.endsWith('だった')?'という':'だという';
      if(clause!==intro.news+bg+tail) bad.push(`つなぎ ${origin}「${bg}」${clause}`);
    }
  }
  check('知らせ：出身と経歴のすべての組み合わせで、だっただと地名の重なりがない',!bad.length,'出身×経歴',bad.slice(0,6).join(' / ')||'合う');
  check('経歴：文は「だった」で終わらない',!past.length,'経歴の一覧',past.slice(0,6).join(' / ')||'名詞');
  const sheep=E.newcomerClause('カルセ王国','羊飼いだった');
  const mine=E.newcomerClause('ベルクラント鉱山諸侯領','鉱山の元用心棒');
  const lowen=E.newcomerClause('ロウエン','ロウエン生まれの冒険者の二世');
  const empire=E.newcomerClause('グラウ帝国','帝国の脱走兵');
  const azuma=E.newcomerClause('東方の島国アズマ','アズマで名を馳せた剣客');
  check('知らせ：重なっていた事例は、地名を一度だけにする',
    sheep==='カルセ王国出身の羊飼いだったという'&&!sheep.includes('だっただ')
    &&mine==='ベルクラント鉱山諸侯領出身の鉱山の元用心棒だという'
    &&lowen==='ロウエン生まれの冒険者の二世だという'&&!lowen.includes('ロウエン出身')
    &&empire==='帝国の脱走兵だという'&&!empire.includes('グラウ帝国出身')
    &&azuma==='海の向こうから来たアズマで名を馳せた剣客だという'&&!azuma.includes('東方の島国アズマから来た'),
    '事例',[sheep,mine,lowen,empire,azuma].join(' / '));
  const who={race:'人間',age:18,sex:'男',cls:'戦士',lvl:11,name:'アルト',odd:false,blessed:false,cursed:false,traits:[]};
  const news=E.ourNewcomerNews(Object.assign({origin:'ロウエン',bg:'ロウエン生まれの冒険者の二世'},who));
  const far=E.ourNewcomerNews(Object.assign({origin:'東方の島国アズマ',bg:'海を渡ってきた若い剣士'},who));
  check('知らせ：新顔の文は、省いた出身のあとに年齢と名前が続く',
    news.k==='info'&&news.t==='新顔がやってきた。ロウエン生まれの冒険者の二世だという18歳の人間の戦士、アルト（Lv11）。'
    &&far.k==='record'&&far.t.startsWith('新顔がやってきた。海の向こう、東方の島国アズマから来た海を渡ってきた若い剣士だという18歳の'),
    '新顔の文',news.t+' / '+far.t);
  const S0={taverns:{ours:{name:'黒猫亭'}}};
  const door=E.doorLine(S0,{origin:'ロウエン',bg:'ロウエン生まれの冒険者の二世',race:'人間',age:18,sex:'男',cls:'戦士',lvl:12,tav:'ours',dream:{k:'abyss'}});
  const plain=E.doorLine(S0,{origin:'ラウレンツ王国',bg:'辺境の元守備隊長',race:'人間',age:40,sex:'女',cls:'戦士',lvl:14,tav:'ours',dream:{k:'abyss'}});
  check('手帳：出身の名が経歴にあるときは「の出身。」を重ねない',
    door.startsWith('ロウエン生まれの冒険者の二世。')&&!door.includes('ロウエンの出身')&&door.includes('黒猫亭の扉をくぐる')
    &&plain.startsWith('ラウレンツ王国の出身。辺境の元守備隊長。'),
    '来店の記録',door+' / '+plain);
  const lived=[];
  for(let i=0;i<4;i++){
    const S=load(1000+i*7919).newState();
    for(const a of Object.values(S.adv)){
      const o=E.ORIGINS[a.origin];
      const doorC=(a.chron||[]).find(c=>c.t&&c.t.includes('扉をくぐる'));
      const again=E.doorLine(S,a);
      if(!doorC||doorC.t!==again) lived.push(`${a.name}：${doorC&&doorC.t} ≠ ${again}`);
      const intro=E.originIntro(a.origin,a.bg);
      for(const token of [a.origin,o.short]) if(a.bg.includes(token)&&(intro.news.includes(token)||intro.door.includes(token))) lived.push(`重なり ${a.name}「${token}」${a.bg}`);
      if(E.newcomerClause(a.origin,a.bg).includes('だっただ')) lived.push(`だっただ ${a.name} ${a.bg}`);
    }
  }
  check('手帳：来た者の記録でも、出身と経歴は重ならない',!lived.length,'4種の開店',lived.slice(0,3).join(' / ')||'合う');
}

if(!isMainThread){const line=runSeed(workerData.seed);parentPort.postMessage({line,res:[...results]});}
else{
  checkTables();checkScenes();checkLetters();checkErrands();checkCrest();checkRowFallback();checkMine();checkAffinity();checkRevive();checkMemoNotes();checkOpening();checkCareer();checkIntro();checkAge();checkFoes();checkFlow();checkLedger();checkMissing();checkLastWords();
  // 種ごとの結果は、種の順に重ねる。反例は、いちばん若い種の最初のものを残す。進捗の行も種の順に出す
  const out=new Array(SEEDS.length);let next=0,printed=0;
  const flush=()=>{while(printed<out.length&&out[printed]){if(out[printed].line)console.log(out[printed].line);printed++;}};
  const runOne=()=>{if(next>=SEEDS.length)return Promise.resolve();const k=next++;
    return new Promise((ok)=>{const w=new Worker(new URL(import.meta.url),{workerData:{seed:SEEDS[k]},argv:args});
      w.once('message',m=>{out[k]=m;flush();});
      // ゲームの中身が例外を投げたら、その種は「エラーで止まった」として不合格にする
      const stopped=e=>`種${SEEDS[k]}：${e&&e.stack?e.stack.split('\n').slice(0,3).join(' / '):e}`;
      w.once('error',e=>{if(!out[k])out[k]={line:`種${SEEDS[k]}：エラーで止まった`,res:[['ゲームがエラーで止まらない',stopped(e)]]};flush();});
      w.once('exit',code=>{if(!out[k])out[k]={line:`種${SEEDS[k]}：エラーで止まった`,res:[['ゲームがエラーで止まらない',`種${SEEDS[k]}：終了コード${code}`]]};flush();ok();});}).then(runOne);};
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
