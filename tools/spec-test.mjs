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
  'RARES','MAXF','DRAGON_F','TICKS_PER_DAY','awayPlan','smallOf','debtTick','DEBT0','encounter','rareSlain','rareMonOf','arrive',
  'repay','errandsOf','assignErrand','errandBlock','designateBlock','MAXF','MINE_TOP','MINE_BOT','MINE_N','FN','mineOpen','conquest','alive','markAdv','markedOf','BOARD_MAX','MARK_MAX','ARCS','reachFloor','GATE_F','fac','nextFac','buildFac','migrate'];

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
  {const got=E.FACILITIES.map(([,ts])=>ts.map(t=>t[0]+t[1]).join('→')).join(' ');
    check('大きな使い道：設備の段と費用が表のとおり',got==='稽古場15000→道場60000→修練場300000 情報屋50000→情報網300000 療養所800000','表',got);}
  // 「店の設備」：下の段から順に建て増し、その段の費用を払う。いちばん上より先はない
  {const S2=E.newState(),T0=S2.taverns.ours;T0.gold=1e6;const paid=[];
    for(let i=0;i<4;i++){const g=T0.gold;const ok=E.buildFac(S2,'dojo');paid.push(ok?`${E.fac(S2,'dojo')}段${g-T0.gold}`:'建たない');}
    check('大きな使い道：設備は下の段から順に建て増す',paid.join(' ')==='1段15000 2段60000 3段300000 建たない','修練場を4回建てる',paid.join(' '));
    const S3=E.newState();S3.taverns.ours.gold=59999;E.buildFac(S3,'dojo');S3.taverns.ours.gold=59999;
    check('大きな使い道：金が足りなければ建て増せない',!E.buildFac(S3,'dojo')&&E.fac(S3,'dojo')===1,'道場に59999G',`${E.fac(S3,'dojo')}段`);}
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
function errandScene(E,S,o){S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.tick;const B=E.errandsOf(S);B.board=[];
  const p=Object.values(S.parties).find(x=>x.tav==='ours');p.state='town';p.rest=99;
  p.members.forEach(id=>{const a=S.adv[id];a.status='idle';a.hp=a.mhp;});
  const e=Object.assign({id:900,hero:null,refused:[],tk:S.tick,until:S.tick+2*E.TICKS_PER_DAY},o);B.board.push(e);return {p,e,B};}
function checkErrands(){
  // 話が来るのは、借金を返し終えてから
  {const E=load(1),S=E.newState();for(let i=0;i<20*E.TICKS_PER_DAY;i++)E.tick(S);
    check('持ち込まれる話：借金を返し終えるまでは、話が来ない',E.errandsOf(S).board.length===0,'借金ありで20日',`掲示${E.errandsOf(S).board.length}`);
    E.repay(S,0);S.taverns.ours.gold=999999;E.repay(S,S.taverns.ours.debt);for(let i=0;i<10*E.TICKS_PER_DAY;i++)E.tick(S);
    check('持ち込まれる話：借金を返し終えると、話が来る',E.errandsOf(S).board.length+E.errandsOf(S).log.length>0,'返し終えて10日','話が来ない');}
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
  {const E=load(1),S=E.newState();S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.tick;const ours=Object.values(S.adv).filter(a=>a.tav==='ours');
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
    check('一行の名前：付け替えで店の金や冒険者の名は変わらない',S.taverns.ours.gold===gold&&S.taverns.ours.name==='黒猫亭'&&leader.name===member&&S.v===21, '付け替え後', `金${S.taverns.ours.gold} ${leader.name}`);
    const again=rest.map(p=>p.name).join(',');E.migrate(S);
    check('一行の名前：付け替えは一度だけ',rest.map(p=>p.name).join(',')===again&&ace.name==='白銀の牙', '二度目の読み込み', rest.map(p=>p.name).join(','));}
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

// ---- 何百日も回しながら、毎刻成り立つはずの性質 ----
function runSeed(seed){
  const E=load(seed),S=E.newState();
  for(let i=0;i<6;i++)E.tick(S);// 画面側の開店と同じ
  const prevState={},killed={},lore={};let conquered=null,arcStage=0,mineConq=null;
  // 種の半分では、店主が借金を返し、話を回し、常連を見込む（話の仕組みを動かすため）
  const owner=seed%2===1;
  for(let i=0;i<TICKS;i++){
    E.tick(S);E.rivalTemple(S);// 画面側の step と同じく、銀の杯亭の蘇生も毎刻呼ぶ
    if(owner&&S.tick%10===0){E.repay(S,Math.max(0,S.taverns.ours.gold-3000));const ours=Object.values(S.adv).filter(a=>a.tav==='ours'&&live(a));
      if(S.tick%500===0&&ours.length){const a=ours[(S.tick/10)%ours.length];E.markAdv(S,a,!a.marked);}
      for(const e of E.errandsOf(S).board)if(!e.hero&&!e.pend){const c=ours.filter(a=>!E.designateBlock(S,e,a));if(c.length)E.assignErrand(S,e,c[(S.tick/10)%c.length]);}}
    const at=`種${seed}・${S.tick}刻（${Math.floor(S.tick/E.TICKS_PER_DAY)+1}日目）`;
    const advs=Object.values(S.adv),parties=Object.values(S.parties),T0=S.taverns.ours;

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
    // 「鉄の山脈の坑道」：坑道に入るのは開いてから。坑道の階は坑道B25Fまで。坑道王の踏破は一度きり
    for(const p of parties)if(p.floor>E.MAXF&&p.state!=='town'){
      check('坑道：開くまでは誰も入らない',E.mineOpen(S),at,()=>`${p.name} ${E.FN(p.floor)}`);
      check('坑道：坑道B25Fより下はない',p.floor<=E.MINE_BOT,at,()=>`${p.name} ${p.floor}`);}
    if(S.mineConq){const k=JSON.stringify({tk:S.mineConq.tk,party:S.mineConq.party});if(!mineConq)mineConq=k;check('坑道：坑道王の踏破は一度きり',mineConq===k,at,S.mineConq.party);}
    // 「裏通りの酒場」：多くて6軒
    check('裏通りの酒場：多くて6軒',E.smallOf(S).length<=6,at,E.smallOf(S).length);
    // 「持ち込まれる話と、見込んだ者」
    {const B=E.errandsOf(S).board;
      check('持ち込まれる話：掲示は3つを超えない',B.length<=E.BOARD_MAX,at,B.length);
      check('持ち込まれる話：借金を返し終えるまでは、話が来ない',T0.debtFree!=null||B.length===0,at,B.length);
      check('持ち込まれる話：期限を過ぎた話は掲示に残らない',B.every(e=>e.until>S.tick),at,()=>B.filter(e=>e.until<=S.tick).map(e=>e.n).join('、'));
      check('持ち込まれる話：引き受けた話に、伝えるのを待つ主役は残らない',B.every(e=>!(e.hero&&e.pend)),at,()=>B.filter(e=>e.hero&&e.pend).map(e=>e.n).join('、'));
      const hs=B.map(e=>e.hero||e.pend).filter(Boolean);
      check('持ち込まれる話：主役は黒猫亭の常連で、1人が2つの話を持たない',new Set(hs).size===hs.length&&hs.every(id=>S.adv[id]&&S.adv[id].tav==='ours'&&live(S.adv[id])),at,()=>hs.map(id=>S.adv[id]&&`${S.adv[id].name}（${S.adv[id].tav}・${S.adv[id].status}）`).join('、'));
      check('見込む：見込んだ者は3人を超えない',E.markedOf(S).length<=E.MARK_MAX,at,E.markedOf(S).length);
      const arc=S.arcs&&S.arcs.gate;if(arc){
        check('続きもの：筋の段は順に進み、飛ばさない',arc.stage===arcStage||arc.stage===arcStage+1,at,`${arcStage}→${arc.stage}`);arcStage=arc.stage;
        check('続きもの：掲示の段は、次に果たす段',B.filter(e=>e.arc==='gate').every(e=>e.stage===arc.stage+1),at,()=>B.filter(e=>e.arc).map(e=>e.stage).join(','));}}
  }
  // 「新顔の来店」：評判を聞いて来る新顔は、常連の平均レベルの前後3以内（0は、これまでどおりの散らばりで来る印）
  {const rs=Object.values(S.adv).filter(a=>a.tav==='ours'&&live(a));const avg=Math.round(rs.reduce((s,a)=>s+a.lvl,0)/rs.length);
    for(let k=0;k<500;k++){const l=E.newcomerLvl(S,'ours');check('新顔の来店：評判を聞いて来る者は平均レベル±3',l===0||(l>=Math.max(1,avg-3)&&l<=avg+3),`種${seed}・終わり`,`平均${avg}に対して${l}`);}}
  return `種${seed}：${TICKS}刻を回した（最深 黒猫亭B${S.deepest.ours}F・銀の杯亭B${S.deepest.rival}F）`;
}

if(!isMainThread){const line=runSeed(workerData.seed);parentPort.postMessage({line,res:[...results]});}
else{
  checkTables();checkScenes();checkErrands();checkMine();
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
