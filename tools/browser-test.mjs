// 画面まわりの決まりを、本物のブラウザ（Playwright の Chromium）で index.html を開いて確かめる。
// 時計は Playwright の偽の時計に差し替えて止め、テストが進めたぶんだけ進める。乱数は種を決めて固定する。タブの表と裏は visibilityState を差し替えて起こす。
//
//   npm install && npx playwright install chromium   最初の一度だけ
//   node --test tools/browser-test.mjs
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const URL_=new URL('../index.html',import.meta.url).href;
const HOUR=3600*1000;
let browser;
before(async()=>{browser=await chromium.launch();});
after(async()=>{await browser?.close();});

// まっさらな記録で店を開く。ctx を渡すと、その保存（localStorage）を引き継ぐ
// 時計は time で止め、乱数は seed で固定する。時が進むのは runFor か setSystemTime を呼んだときだけで、結果は実時間に左右されない
async function open({ctx,time=Date.UTC(2026,0,1),seed=1}={}){
  ctx=ctx||await browser.newContext();
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(s=>{
    // mulberry32。テストの中で Math.random を差し替えて戻しても、この列の続きに戻る
    Math.random=()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  },seed);
  await page.clock.install({time:time-1000});
  await page.clock.pauseAt(time);
  await page.goto(URL_);
  return {ctx,page,errors};
}
const tick=page=>page.evaluate('S.tick');
// 時計を止めているので、requestAnimationFrame は時計を進めないと呼ばれない。2こま分進めて待つ
const frames=page=>page.clock.runFor(40);
// 常連のひと幕が出ていることを確かめて閉じる。name を渡すと、その名が出ていることも確かめる
async function closeLife(page,name){
  const life=page.locator('#life');
  assert.equal(await life.isVisible(),true,'ひと幕が出ていない');
  if(name)assert.match(await life.innerText(),new RegExp(name));
  await page.locator('#lf-btn').click();
  assert.equal(await life.isVisible(),false);
}
const digestShown=page=>page.locator('#digest').isVisible();
const setVisibility=(page,state)=>page.evaluate(s=>{
  Object.defineProperty(document,'visibilityState',{value:s,configurable:true});
  Object.defineProperty(document,'hidden',{value:s==='hidden',configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
},state);
// タブを裏に回し、ms だけ実時間がたってから表に戻す。裏にいるあいだはタイマーを動かさない
async function hideFor(page,ms,{show=true}={}){
  await setVisibility(page,'hidden');
  await page.clock.setSystemTime(await page.evaluate(()=>Date.now())+ms);
  if(show)await setVisibility(page,'visible');
}

test('地図屋は、名を知った魔物に相性を添え、まだ知らない名には出さない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.evaluate(()=>{
    const mark=f=>{S.rares=S.rares||{};S.rares[f]={seen:{party:'夜明け団',tav:'ours',tk:S.tick}};};
    mark(1);mark(8);mark(10);mark(11);mark(12);mark(MINE_TOP+8);
    S.mine={open:0};
  });
  await page.locator('button[data-v="maps"]').click();
  const row=floor=>page.locator('#tbody table').nth(1).locator('tr',{has:page.locator('td.fl',{hasText:new RegExp('^'+floor+'$')})});
  const text=async floor=>(await row(floor).innerText()).replace(/\s+/g,' ');
  assert.match(await text('B1F'),/ドブ王/);
  assert.match(await text('B1F'),/炎に弱い/);
  assert.doesNotMatch(await text('B1F'),/氷|雷/);
  assert.match(await text('B2F'),/？？？/);
  assert.doesNotMatch(await text('B2F'),/炎|氷|雷/);
  assert.match(await text('B8F'),/市場の大ガーゴイル/);
  assert.match(await text('B8F'),/炎と氷に強く、雷に弱い/);
  assert.match(await text('B10F'),/迷い牛の古株/);
  assert.doesNotMatch(await text('B10F'),/炎|氷|雷/);
  assert.match(await text('B11F'),/水路の主/);
  assert.match(await text('B11F'),/炎に強く、雷に弱い/);
  assert.match(await text('B12F'),/双頭のキメラ/);
  assert.match(await text('B12F'),/炎に強く、氷に弱い/);
  assert.match(await text('坑道B9F'),/石の鍛冶頭/);
  assert.match(await text('坑道B9F'),/炎と氷に強く、雷に弱い/);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('1時間裏にいて戻ると、「留守のあいだに」が出て10日分（500刻）進む',async()=>{
  const {ctx,page,errors}=await open();
  const t0=await tick(page);
  await hideFor(page,HOUR);
  assert.ok(await digestShown(page),'留守のあいだにが出ていない');
  assert.ok(await page.locator('[data-act="closedigest"]').isDisabled(),'時が流れているあいだに店に戻るが押せる');
  await page.clock.runFor(5000);
  assert.match(await page.locator('#dg-sub').textContent(),/店をあけていたのは約1時間。迷宮では10\.0日が過ぎた。/);
  assert.ok(await page.locator('[data-act="closedigest"]').isEnabled(),'時が流れ終わっても店に戻るが押せない');
  assert.ok(await tick(page)>=t0+500,`${t0}→${await tick(page)}`);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('留守のあいだの減りは売上と書かず、帳場は返した額と利息を分ける',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const shown=await page.evaluate(()=>{
    const T=S.taverns.ours;
    // 売上 +923、返済 5580、支援 0 で、所持金は -4657
    T.gold=5343;T.earned=923;T.support=0;T.repaid=5580;T.interestPaid=1580;T.debt=75000;
    drawDigest({i:50,n:50,awaySec:3600,startTick:0,g0:10000,e0:0,s0:0,r0:0,lost0:S.memorial.length,returns:1,wipes:0});
    document.querySelector('#digest').hidden=false;
    return {sum:document.querySelector('#dg-sum').innerText,brk:document.querySelector('#dg-brk').innerText};
  });
  assert.match(shown.sum,/-4,657G/);
  assert.match(shown.sum,/所持金/);
  assert.doesNotMatch(shown.sum,/売上/);
  assert.match(shown.brk,/売上 \+923G/);
  assert.match(shown.brk,/支援 0G/);
  assert.match(shown.brk,/返済 5,580G/);
  await page.setViewportSize({width:375,height:740});
  await page.evaluate(()=>document.fonts.ready);
  const digestWrap=await page.evaluate(()=>{
    const bad=[];
    for(const s of document.querySelectorAll('#dg-brk .nw')){
      const range=document.createRange();range.selectNodeContents(s);
      const n=new Set([...range.getClientRects()].filter(r=>r.width>2).map(r=>Math.round(r.top))).size;
      if(n!==1)bad.push(s.textContent);
    }
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('はみ出す');
    return bad;
  });
  assert.deepEqual(digestWrap,[]);
  await page.evaluate(()=>{document.querySelector('#digest').hidden=true;});
  await page.setViewportSize({width:1280,height:800});
  const live=await page.evaluate(()=>{
    const T=S.taverns.ours;
    T.gold=20000;T.earned=100;T.support=40;T.repaid=1000;T.interestPaid=0;T.debt=79000;T.late=0;T.nextPay=S.tick;
    S.policy=Object.assign({},S.policy,{potion:3,mapPay:1,revive:1,rookie:1});
    return {gold:T.gold,earned:T.earned,support:T.support,repaid:T.repaid};
  });
  await page.locator('[data-act="skip"]').click();
  await page.clock.runFor(5000);
  const after=await page.evaluate(()=>{
    const T=S.taverns.ours;
    return {gold:T.gold,earned:T.earned,support:T.support||0,repaid:T.repaid||0,interest:T.interestPaid||0,v:S.v,
      sum:document.querySelector('#dg-sum').innerText,brk:document.querySelector('#dg-brk').innerText};
  });
  assert.equal(after.v,await page.evaluate('SAVE_V'));
  assert.doesNotMatch(after.sum,/売上/);
  assert.match(after.sum,/所持金/);
  const gd=after.gold-live.gold,yen=n=>n.toLocaleString('ja-JP'),esign=gd>=0?`+${yen(gd)}`:yen(gd);
  assert.match(after.sum,new RegExp(esign.replace(/[+-]/g,'\\$&')+'G'));
  assert.match(after.brk,new RegExp('売上 \\+'+yen(after.earned-live.earned)+'G'));
  assert.match(after.brk,new RegExp('支援 '+yen(after.support-live.support)+'G'));
  assert.match(after.brk,new RegExp('返済 '+yen(after.repaid-live.repaid)+'G'));
  assert.equal(after.repaid-live.repaid,5580);
  assert.equal(after.interest,1580);
  await page.locator('[data-act="closedigest"]').click();
  await page.locator('button[data-v="desk"]').click();
  const desk=await page.locator('#tbody').innerText();
  assert.match(desk,/これまでに返した額 6,580G（うち利息 1,580G）/);
  assert.doesNotMatch(desk,/売上 -/);
  await page.setViewportSize({width:375,height:740});
  await page.evaluate(()=>document.fonts.ready);
  const deskWrap=await page.evaluate(()=>{
    const bad=[];
    for(const s of document.querySelectorAll('.row.debt .nw')){
      const range=document.createRange();range.selectNodeContents(s);
      const n=new Set([...range.getClientRects()].filter(r=>r.width>2).map(r=>Math.round(r.top))).size;
      if(n!==1)bad.push(s.textContent+' が折れている');
    }
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('はみ出す');
    return bad;
  });
  assert.deepEqual(deskWrap,[]);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('30刻に満たない留守は、画面を出さずにその分だけ進め、そのあとも時間が流れる',async()=>{
  const {ctx,page,errors}=await open();
  const t0=await tick(page);
  await hideFor(page,25*1000);
  assert.equal(await digestShown(page),false);
  assert.equal(await tick(page),t0+10);
  await page.clock.runFor(2500);
  assert.equal(await tick(page),t0+11,'戻ったあとにタイマーが動いていない');
  assert.deepEqual(errors,[]);await ctx.close();
});

test('「止める」にしていたときは、裏にいた時間を進めない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const t0=await tick(page);
  await hideFor(page,HOUR);
  await page.clock.runFor(5000);
  assert.equal(await digestShown(page),false);
  assert.equal(await tick(page),t0);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('visibilitychange と pageshow の両方で戻っても、裏にいた時間は一度しか進めない',async()=>{
  const {ctx,page,errors}=await open();
  const t0=await tick(page);
  await hideFor(page,25*1000);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  assert.equal(await tick(page),t0+10);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('早送りの途中で裏に回ったら、裏にいた分を早送りに足す',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('[data-act="skip"]').click();
  await hideFor(page,HOUR);
  assert.equal(await page.evaluate('ff.n'),50+500);
  await page.clock.runFor(5000);
  assert.match(await page.locator('#dg-sub').textContent(),/迷宮では11\.0日が過ぎた。/);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('一行の札に、平均と最高と到達と顔ぶれが出て、狭い画面でも札の中がはみ出さない',async()=>{
  const {ctx,page,errors}=await open();
  const cards=page.locator('.pcard');
  assert.ok(await cards.count()>0,'一行の札がない');
  const sample=await cards.first().innerText();
  assert.match(sample,/平均/);
  assert.match(sample,/最高/);
  assert.match(sample,/到達/);
  assert.match(sample,/★/);
  const fit=await page.evaluate(()=>{
    const bad=[];
    for(const el of document.querySelectorAll('.pcard')){
      const id=el.dataset.p,p=S.parties[id];
      const ms=partyMembers(p);
      const text=el.textContent;
      if(ms.length&&!text.includes('平均'))bad.push(p.name+' 平均がない');
      if(ms.length&&!text.includes('最高'))bad.push(p.name+' 最高がない');
      if(!text.includes('到達'))bad.push(p.name+' 到達がない');
      for(const a of ms){if(!text.includes(a.name)||!text.includes(a.cls))bad.push(`${p.name} に ${a.name}（${a.cls}）がいない`);
        const who=[...el.querySelectorAll('.who')].find(n=>(n.querySelector('.nm')||{}).textContent.includes(a.name));
        const cls=who&&who.querySelector('.cls');
        if(!cls||!cls.textContent.startsWith(a.cls+' Lv'+a.lvl))bad.push(`${a.name} のLv ${cls&&cls.textContent}`);}
      if(p.leader&&S.adv[p.leader]&&ms.some(a=>a.id===p.leader)&&!text.includes('★'+S.adv[p.leader].name))bad.push(p.name+' のリーダー');
      const ja=crestJa(p.name);
      if(ja&&!text.includes(p.name+'（'+ja+'）'))bad.push(p.name+' の訳がない');
      if(!ja&&text.includes(p.name+'（'))bad.push(p.name+' に訳が付いた');
      if(el.scrollWidth>el.clientWidth+1)bad.push(p.name+' が横にはみ出す');
    }
    const ours=[...document.querySelectorAll('.pcard')].filter(el=>S.parties[el.dataset.p].tav==='ours');
    const rival=[...document.querySelectorAll('.pcard')].filter(el=>S.parties[el.dataset.p].tav==='rival');
    if(ours.length&&rival.length){
      const y=el=>el.getBoundingClientRect().top;
      if(Math.min(...rival.map(y))<Math.max(...ours.map(y))-1)bad.push('銀の杯亭が黒猫亭より前');
    }
    return bad;
  });
  assert.deepEqual(fit,[]);
  await page.setViewportSize({width:360,height:740});
  const narrow=await page.evaluate(()=>[...document.querySelectorAll('.pcard')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent.slice(0,20)));
  assert.deepEqual(narrow,[]);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('金額・階・席の知らせは、画面どうしで同じ書き方になる',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const shown=await page.evaluate(()=>{
    const cast=Object.values(S.adv).filter(a=>a.opening);
    const party=Object.values(S.parties).find(p=>p.tav==='ours');
    const idle=cast.find(a=>!party.members.includes(a.id));
    const diver=S.adv[party.members[0]];
    floorsInit(S);
    S.taverns.ours.gold=154420;
    S.taverns.ours.earned=462443;
    S.taverns.ours.support=154420;
    S.floors[4].arrive.party='鉄の誓い傭兵団（四十人）';
    S.floors[11].arrive.party='王国の調査隊二百人（全滅）';
    tab='desk';render();
    const desk=document.querySelector('#tbody').innerText;
    const gold=document.querySelector('#gold').textContent;
    const debt=document.querySelector('#debt').textContent;
    tab='maps';render();
    const maps=document.querySelector('#tbody').innerText;
    advOpen=idle.id;document.getElementById('advm').hidden=false;renderAdv();
    const idleBook=document.querySelector('#advbox .kv').innerText;
    diver.deepest=3;advOpen=diver.id;renderAdv();
    const diveBook=document.querySelector('#advbox .kv').innerText;
    const diveHead=document.querySelector('#advbox .adv-sub').innerText;
    document.getElementById('advm').hidden=true;advOpen=null;
    return {gold,debt,desk,maps,idleBook,diveBook,diveHead,rare:MEMO.find(m=>m.id==='rare').t,chatter:partyCount('鉄の誓い傭兵団（四十人）')};
  });
  assert.equal(shown.gold,'154,420');
  assert.equal(shown.debt,'80,000');
  assert.match(shown.desk,/462,443G/);
  assert.match(shown.desk,/154,420G/);
  assert.match(shown.desk,/店を広げる 5,000G/);
  assert.match(shown.maps,/40人/);
  assert.match(shown.maps,/200人/);
  assert.doesNotMatch(shown.maps,/四十人|二百人/);
  assert.match(shown.idleBook,/―/);
  assert.match(shown.idleBook,/最深到達/);
  assert.doesNotMatch(shown.idleBook,/B0F/);
  assert.match(shown.diveBook,/B3F/);
  assert.match(shown.diveHead,/Lv\d/);
  assert.doesNotMatch(shown.diveBook,/B0F/);
  assert.equal(shown.rare,'名のある魔物を、一体仕留める');
  assert.equal(shown.chatter,'鉄の誓い傭兵団（40人）');
  await page.locator('button[data-v="desk"]').click();
  await page.locator('[data-act="seats"]').click();
  assert.equal(await page.locator('.toast').innerText(),'常連の席は18席になった');
  assert.deepEqual(errors,[]);await ctx.close();
});

test('夢の貯金は両方を区切ってGを付け、地図屋の調査隊は括弧で人数を出し、店の分からない記録は「不明」と出し、帳場の「+」は半角の幅で出す',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const shown=await page.evaluate(async()=>{
    await document.fonts.ready;
    const a=Object.values(S.adv).find(x=>x.tav==='ours');
    a.dream=Object.assign({k:'wealth'},DREAMS.wealth.mk(a,S),{amt:94700});a.gold=5461;
    advOpen=a.id;document.getElementById('advm').hidden=false;renderAdv();
    const book=document.querySelector('#advbox').innerText;
    document.getElementById('advm').hidden=true;advOpen=null;
    floorsInit(S);
    S.floors[10].through.party='王国の調査隊200人';
    S.floors[11].arrive.party='王国の調査隊200人（全滅）';
    S.floors[2]={arrive:{party:'迷子の一行',tav:'gone',tk:0},map:false};
    S.rares[1]={killed:{party:'名無しの一行',tav:'gone',names:['某'],tk:0},seen:{party:'名無しの一行',tav:'gone',tk:0}};
    S.rares[3]={seen:{party:'見ただけの一行',tav:'gone',tk:0}};
    tab='maps';render();
    const maps=document.querySelector('#tbody').innerText;
    S.flow.hist.push(Object.assign(flowBlank(),{e:923}));
    tab='desk';render();
    const flow=document.querySelector('#flow');
    const cell=[...flow.querySelectorAll('.num')].find(x=>x.textContent.startsWith('+'));
    const w=t=>{const s=document.createElement('span');s.textContent=t;cell.append(s);const x=s.getBoundingClientRect().width;s.remove();return x;};
    return {book,maps,flowText:flow.innerText,plus:w('+'),kana:w('あ')};
  });
  assert.match(shown.book,/貯金 5,461G \/ 94,700G/);
  assert.match(shown.maps,/王国の調査隊（200人）/);
  assert.match(shown.maps,/王国の調査隊（200人・全滅）/);
  assert.doesNotMatch(shown.maps,/調査隊200人/);
  assert.match(shown.maps,/不明の迷子の一行/);
  assert.match(shown.maps,/不明の名無しの一行/);
  assert.match(shown.maps,/不明の見ただけの一行が目撃/);
  assert.match(shown.flowText,/\+923G/);
  assert.doesNotMatch(shown.flowText,/＋/);
  assert.ok(shown.plus<shown.kana*.7,`+ の幅 ${shown.plus} / あ の幅 ${shown.kana}`);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('黒猫亭の出発は日報に出て、同じ日の迷宮と坑道は一つにまとまる。銀の杯亭は出ない',async()=>{
  const {ctx,page,errors}=await open();
  const lines=await page.evaluate(()=>{
    noteDepart(S,{tav:'ours',name:'試しの剣',mineTrip:false});
    noteDepart(S,{tav:'ours',name:'樽ころがし',mineTrip:false});
    noteDepart(S,{tav:'ours',name:'試しの盾',mineTrip:true});
    noteDepart(S,{tav:'rival',name:'出ない牙',mineTrip:false});
    noteDepart(S,{tav:'ours',name:'試しの剣',mineTrip:false});
    render();
    return S.news.filter(n=>n.t.includes('出発')||n.t.includes('出ない牙')).map(n=>n.t);
  });
  assert.deepEqual(lines,['試しの剣、樽ころがしが迷宮へ、試しの盾が坑道へ出発した。']);
  assert.match(await page.locator('#tbody').innerText(),/試しの剣、樽ころがしが迷宮へ、試しの盾が坑道へ出発した。/);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('同じ日の銀の杯亭のレベル到達は噂の色の一件にまとまり、375pxと1280pxで語の途中で折れない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const want=await page.evaluate(()=>{
    // 名前の長い銀の杯亭の客から5人。折れ目が名前やLvの途中に来やすいようにする
    const rv=Object.values(S.adv).filter(a=>a.tav==='rival').sort((x,y)=>y.name.length-x.name.length).slice(0,5);
    rv.forEach((a,i)=>noteLevel(S,{tav:'rival',name:a.name,lvl:[20,30,40,30,20][i]}));
    render();
    return S.news.filter(n=>n.t.startsWith('噂：銀の杯亭では、')).map(n=>n.t);
  });
  assert.equal(want.length,1);
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.locator('#tabs button[data-v="news"]').click();
    await page.evaluate(()=>document.fonts.ready);
    const li=await page.evaluate(t=>[...document.querySelectorAll('.news li')].filter(li=>li.textContent.includes(t)).map(li=>li.querySelector('.rumor')?'rumor':'other'),want[0].slice(0,20));
    assert.ok(li.length>=1&&li.every(k=>k==='rumor'),`${width}px：${li.join()}`);
    assert.deepEqual(await page.evaluate(screenAudit),[],`${width}px の日報`);
  }
  assert.deepEqual(errors,[]);await ctx.close();
});

test('狭い画面ではタブが下にあり、帳場と地図屋が読めて、よく押す場所が44px以上ある',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>window.scrollTo(0,0));
  const phone=await page.evaluate(()=>{
    const bad=[];
    const vw=innerWidth,vh=innerHeight;
    if(getComputedStyle(document.querySelector('.tabs')).position!=='fixed')bad.push('タブが画面下に固定されていない');
    const tabs=[...document.querySelectorAll('#tabs button')];
    if(tabs.length<9)bad.push('タブが足りない');
    for(const b of tabs){
      const r=b.getBoundingClientRect();
      if(r.top<-1||r.left<-1||r.bottom>vh+1||r.right>vw+1)bad.push(b.textContent+' が画面の外');
      if(r.width<44||r.height<44)bad.push(b.textContent+` の押し幅 ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    for(const el of document.querySelectorAll('.tabrow')){
      if(el.scrollWidth>el.clientWidth+1)bad.push('タブが横にスクロールする');
    }
    if(document.documentElement.scrollWidth>vw+1)bad.push('ページが横にはみ出す');
    for(const b of document.querySelectorAll('.ctrl .btn')){
      const r=b.getBoundingClientRect();
      if(r.width<44||r.height<44)bad.push(b.textContent+` の押し幅 ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    const members=[...document.querySelectorAll('.c-members .m')];
    if(!members.length)bad.push('水晶にメンバーがいない');
    for(const m of members){
      const row=m.getBoundingClientRect();
      const link=m.querySelector('.nm-link');
      const lr=link.getBoundingClientRect();
      if(row.height<44)bad.push(link.textContent+' の行の高さ '+Math.round(row.height));
      if(lr.width<44||lr.height<44)bad.push(link.textContent+` の押し幅 ${Math.round(lr.width)}×${Math.round(lr.height)}`);
    }
    return bad;
  });
  assert.deepEqual(phone,[]);
  await page.locator('button[data-v="desk"]').click();
  const desk=await page.evaluate(()=>{
    const lineCount=el=>{const range=document.createRange();range.selectNodeContents(el);return new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size;};
    const bad=[];
    const row=[...document.querySelectorAll('#tbody .desk .row')];
    const find=t=>row.find(el=>el.innerText.includes(t));
    const debt=find('借金の残り'),pot=find('回復薬の差し入れ');
    if(!debt||!pot)bad.push('帳場の行がない');
    else{
      const label=debt.querySelector('b'),does=debt.querySelector('.does'),btn=debt.querySelector('button');
      const potLabel=pot.querySelector('b'),potBtn=pot.querySelector('button');
      if(lineCount(label)!==1)bad.push('借金の残りが折れている');
      if(lineCount(does)!==1)bad.push('これまでに返した額が折れている');
      if(lineCount(potLabel)!==1)bad.push('回復薬の差し入れが折れている');
      const lb=label.getBoundingClientRect(),db=does.getBoundingClientRect(),bb=btn.getBoundingClientRect();
      const pb=potLabel.getBoundingClientRect(),pbb=potBtn.getBoundingClientRect();
      if(bb.top<lb.bottom-1||bb.top<db.bottom-1)bad.push('返済のボタンが見出しの横にある');
      if(pbb.top<pb.bottom-1)bad.push('差し入れのボタンが見出しの横にある');
      const who=debt.querySelector('.who').getBoundingClientRect();
      if(who.width<debt.getBoundingClientRect().width*0.9)bad.push('見出しの幅が狭い');
    }
    const seen=debt.querySelector('b').getBoundingClientRect();
    const bar=document.querySelector('.tabs').getBoundingClientRect().top;
    if(seen.top<0||seen.bottom>bar+1)bad.push('帳場が画面に入っていない');
    return bad;
  });
  assert.deepEqual(desk,[]);
  await page.locator('button[data-v="maps"]').click();
  const maps=await page.evaluate(()=>{
    const lineCount=el=>{const range=document.createRange();range.selectNodeContents(el);return new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size;};
    const bad=[];
    const tr=document.querySelector('.mapfloors tr.flr');
    if(!tr)bad.push('階の札がない');
    else{
      const tds=[...tr.children].map(td=>td.getBoundingClientRect());
      const card=tr.getBoundingClientRect().width;
      if(tds[1].top<tds[0].bottom-2)bad.push('階の札が横並びのまま');
      if(tds[1].width<card*0.7)bad.push('初到達の幅が狭い');
      const label=getComputedStyle(tr.children[1],'::before').content;
      if(!label.includes('初到達'))bad.push('初到達の見出しがない');
      if(lineCount(tr.children[1])>2)bad.push('初到達が細く折れている');
    }
    return bad;
  });
  assert.deepEqual(maps,[]);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('広い画面ではタブが右の列に収まり、帳場と地図の表は横並びのまま',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>document.fonts.ready);
  const wide=await page.evaluate(()=>{
    const bad=[];
    if(getComputedStyle(document.querySelector('.tabs')).position==='fixed')bad.push('タブが画面下に固定されている');
    const side=document.querySelector('.side').getBoundingClientRect();
    const left=document.querySelector('.left').getBoundingClientRect();
    if(side.x<left.x+200)bad.push('右の列が左に落ちている');
    const ref=document.querySelector('button[data-v="ref"]');
    const row=ref.closest('.tabrow');
    const br=ref.getBoundingClientRect(),rr=row.getBoundingClientRect();
    if(br.left<rr.left-1||br.right>rr.right+1||br.bottom>rr.bottom+1)bad.push('資料がタブの外');
    if(br.right>innerWidth+1||br.left<0)bad.push('資料が画面の外');
    for(const el of document.querySelectorAll('.tabrow')){
      if(el.scrollWidth>el.clientWidth+1)bad.push('タブが横にスクロールする');
    }
    return bad;
  });
  assert.deepEqual(wide,[]);
  await page.locator('button[data-v="desk"]').click();
  const desk=await page.evaluate(()=>{
    const row=[...document.querySelectorAll('#tbody .row')].find(el=>el.innerText.includes('借金の残り'));
    const label=row.querySelector('b').getBoundingClientRect();
    const btn=row.querySelector('button').getBoundingClientRect();
    return btn.top>=label.bottom-1;
  });
  assert.equal(desk,true,'広い画面の右の列では返済ボタンが見出しの下にある');
  await page.locator('button[data-v="maps"]').click();
  const table=await page.evaluate(()=>{
    const tr=document.querySelector('.mapfloors tr.flr');
    const a=tr.children[0].getBoundingClientRect(),b=tr.children[1].getBoundingClientRect();
    return Math.abs(a.top-b.top)<8&&b.left>a.left;
  });
  assert.equal(table,true,'広い画面では階の一覧が表のまま');
  assert.deepEqual(errors,[]);await ctx.close();
});

test('裏に回ったときに保存するので、そのまま閉じられても次に開いたとき留守の時間が進む',async()=>{
  const {ctx,page,errors}=await open();
  await page.clock.runFor(1000);// 最後の保存（開店時）より時計を進めておく
  const hid=await page.evaluate(()=>Date.now());
  await hideFor(page,0,{show:false});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kuroneko-tavern-v1')));
  assert.ok(saved.at>=hid,'裏に回ったときに保存されていない');
  await page.close();// スマホでは、裏に回ったページが pagehide なしで消されることがある。pagehide が来ても、保存した時刻は裏に回ったときのまま
  const again=await open({ctx,time:saved.at+HOUR});
  assert.ok(await digestShown(again.page),'次に開いたときに留守のあいだにが出ていない');
  await again.page.clock.runFor(5000);
  assert.match(await again.page.locator('#dg-sub').textContent(),/店をあけていたのは約1時間。/);
  assert.deepEqual([...errors,...again.errors],[]);await ctx.close();
});

test('帳場の蘇生は、押す前に状態と司祭の見立てが出て、押した直後に成否が残る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const prep=await page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');
    a.status='dead';a.hp=0;a.lvl=1;a.party=null;a.traits=(a.traits||[]).filter(t=>t!=='信心深い');
    S.blessUntil=0;S.taverns.ours.gold=100000;
    return {id:a.id,name:a.name,hint:reviveHint(S,a)};
  });
  await page.locator('button[data-v="desk"]').click();
  const row=()=>page.locator('#tbody .row',{has:page.locator(`button[data-act="revive"][data-a="${prep.id}"]`)});
  const before=await row().innerText();
  assert.match(before,/寺院・死/);
  assert.match(before,/死・司祭の見立てでは、/);
  assert.doesNotMatch(prep.hint,/[0-9０-９%％]/,'見立てに数字が出ている');
  assert.equal(before.includes(prep.hint),true,before);
  assert.doesNotMatch(before,/寄進で上がっている|信心深く/);
  const raised=await page.evaluate(id=>{
    S.blessUntil=S.tick+TICKS_PER_DAY;
    const a=S.adv[id];a.traits=(a.traits||[]).concat(['信心深い']);
    render();
    return reviveHint(S,a);
  },prep.id);
  const mid=await row().innerText();
  assert.match(raised,/寄進で上がっている/);
  assert.match(raised,/信心深く、成功しやすい/);
  assert.equal(mid.includes(raised),true,mid);
  await page.evaluate(id=>{
    const a=S.adv[id];a.traits=(a.traits||[]).filter(t=>t!=='信心深い');S.blessUntil=0;render();
  },prep.id);
  const gold0=await page.evaluate(()=>S.taverns.ours.gold);
  const cost=await page.evaluate(id=>templeCost(S,S.adv[id]),prep.id);
  await page.evaluate(()=>{Math.random=()=>0.999;});
  await row().locator('button[data-act="revive"]').click();
  const failed=await page.locator('.revive-result').innerText();
  assert.equal(failed,`${prep.name}は蘇生に失敗し、灰になった`);
  assert.equal(await page.locator('.toast').innerText(),failed);
  const ash=await row().innerText();
  assert.match(ash,/寺院・灰/);
  assert.match(ash,/灰・司祭の見立てでは、/);
  assert.equal(await page.evaluate(()=>S.taverns.ours.gold),gold0-cost);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kuroneko-tavern-v1')));
  assert.equal(saved.S.reviveNote,undefined);
  assert.equal(saved.S.v,await page.evaluate('SAVE_V'));
  assert.equal(saved.S.adv[prep.id].status,'ash');
  const again=await open({ctx,time:Date.UTC(2026,0,1)});
  await again.page.locator('#sp0').click();
  await again.page.locator('button[data-v="desk"]').click();
  assert.equal(await again.page.locator('.revive-result').count(),0,'閉じたあとに成否の一文が残っている');
  const kept=await again.page.locator('#tbody .row',{has:again.page.locator(`button[data-act="revive"][data-a="${prep.id}"]`)}).innerText();
  assert.match(kept,/灰・司祭の見立てでは、/);
  await again.page.evaluate(()=>{Math.random=()=>0;});
  await again.page.locator(`button[data-act="revive"][data-a="${prep.id}"]`).click();
  assert.equal(await again.page.locator('.revive-result').innerText(),`${prep.name}がよみがえった`);
  assert.equal(await again.page.locator('.toast').innerText(),`${prep.name}がよみがえった`);
  assert.equal(await again.page.locator(`button[data-act="revive"][data-a="${prep.id}"]`).count(),0);
  await again.page.evaluate(id=>{const a=S.adv[id];a.status='dead';a.hp=0;a.party=null;render();},prep.id);
  assert.doesNotMatch(await again.page.locator('#tbody').innerText(),/よみがえった/,'また寺院に運ばれても、前の一文が残っている');
  await again.page.evaluate(id=>{const a=S.adv[id];a.status='idle';a.hp=a.mhp;render();},prep.id);
  const other=await again.page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired'&&x.status!=='dead'&&x.status!=='ash');
    a.status='ash';a.hp=0;a.party=null;S.taverns.ours.gold=100000;render();
    return {id:a.id,name:a.name};
  });
  await again.page.evaluate(()=>{Math.random=()=>0.999;});
  await again.page.locator(`button[data-act="revive"][data-a="${other.id}"]`).click();
  assert.equal(await again.page.locator('.revive-result').innerText(),`${other.name}は蘇生に失敗し、ロストした`);
  assert.equal(await again.page.evaluate(id=>S.adv[id].status,other.id),'lost');
  // 常連がロストしたので、ひと幕が出る。閉じてから先へ進む
  await closeLife(again.page,other.name);
  await again.page.locator('button[data-v="news"]').click();
  await again.page.locator('button[data-v="desk"]').click();
  assert.equal(await again.page.locator('.revive-result').count(),0,'別の札へ移ると成否が残っている');
  await again.page.evaluate(id=>{
    const a=S.adv[id];a.status='dead';a.hp=0;a.party=null;a.lvl=1;a.traits=(a.traits||[]).filter(t=>t!=='信心深い');
    S.blessUntil=S.tick+TICKS_PER_DAY;S.taverns.ours.gold=100000;render();
  },other.id);
  await again.page.setViewportSize({width:375,height:740});
  await again.page.locator('h3',{hasText:'常連への手当て'}).scrollIntoViewIfNeeded();
  const phone=await again.page.evaluate(id=>{
    const row=document.querySelector(`button[data-act="revive"][data-a="${id}"]`)?.closest('.row');
    if(!row)return ['行がない'];
    // 見立ての文が折れるのは、読点・中黒・句点・閉じかっこのあとか、開きかっこの前だけ。札の外にもはみ出さない
    const wrapBad=el=>{const tn=el.firstChild,t=tn.textContent,out=[];let top=null;
      for(let i=0;i<t.length;i++){const range=document.createRange();range.setStart(tn,i);range.setEnd(tn,i+1);const r=[...range.getClientRects()].find(x=>x.width>.5);if(!r)continue;
        if(top!=null&&r.top>top+2&&!('、。・）'.includes(t[i-1])||t[i]==='（'))out.push(`語の途中で折れる：${t.slice(Math.max(0,i-4),i)}｜${t.slice(i,i+4)}`);
        if(r.right>row.getBoundingClientRect().right+1)out.push('見立てが行の外にはみ出す');top=r.top;}
      return [...new Set(out)];};
    const bad=[];
    const r=row.getBoundingClientRect();
    if(r.left<-1||r.right>innerWidth+1)bad.push('行が横にはみ出す');
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    const hint=row.querySelector('.does'),btn=row.querySelector('button[data-act="revive"]');
    if(!hint.innerText.includes('死・司祭の見立てでは、')||!hint.innerText.includes('寄進で上がっている'))bad.push(hint.innerText);
    if(btn.getBoundingClientRect().top<hint.getBoundingClientRect().bottom-1)bad.push('ボタンが見出しの横にある');
    bad.push(...wrapBad(hint));
    return bad;
  },other.id);
  assert.deepEqual(phone,[]);
  await again.page.setViewportSize({width:1280,height:800});
  await again.page.locator('h3',{hasText:'常連への手当て'}).scrollIntoViewIfNeeded();
  const wide=await again.page.evaluate(id=>{
    const row=document.querySelector(`button[data-act="revive"][data-a="${id}"]`)?.closest('.row');
    if(!row)return ['行がない'];
    // 見立ての文が折れるのは、読点・中黒・句点・閉じかっこのあとか、開きかっこの前だけ。札の外にもはみ出さない
    const wrapBad=el=>{const tn=el.firstChild,t=tn.textContent,out=[];let top=null;
      for(let i=0;i<t.length;i++){const range=document.createRange();range.setStart(tn,i);range.setEnd(tn,i+1);const r=[...range.getClientRects()].find(x=>x.width>.5);if(!r)continue;
        if(top!=null&&r.top>top+2&&!('、。・）'.includes(t[i-1])||t[i]==='（'))out.push(`語の途中で折れる：${t.slice(Math.max(0,i-4),i)}｜${t.slice(i,i+4)}`);
        if(r.right>row.getBoundingClientRect().right+1)out.push('見立てが行の外にはみ出す');top=r.top;}
      return [...new Set(out)];};
    const who=row.querySelector('.who').getBoundingClientRect(),btn=row.querySelector('button[data-act="revive"]').getBoundingClientRect();
    const bad=[];
    if(!(btn.top<who.bottom&&btn.left>who.left))bad.push('広い画面でボタンが見出しの横にない');
    if(!row.innerText.includes('司祭の見立てでは、'))bad.push('見立てがない');
    bad.push(...wrapBad(row.querySelector('.does')));
    return bad;
  },other.id);
  assert.deepEqual(wide,[]);
  assert.deepEqual([...errors,...again.errors],[]);await ctx.close();
});

test('帳場の覚え書きと、次の返済までの日数・必要額が常に出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.locator('button[data-v="desk"]').click();
  const opened=await page.evaluate(()=>{
    const lis=[...document.querySelectorAll('#memo li')];
    return {n:lis.length,done:document.querySelectorAll('#memo s').length,text:document.querySelector('#memo').innerText,pay:document.querySelector('#payw').innerText,hidden:document.querySelector('#payw').hidden,log:document.querySelectorAll('#memo-log li').length};
  });
  assert.equal(opened.n,3);
  assert.equal(opened.done,0);
  assert.equal(opened.log,0);
  assert.match(opened.text,/送り出した連中が、生きて戻ってくる/);
  assert.match(opened.text,/取り立て人の顔は、もう見たくない/);
  assert.match(opened.text,/席を18にする/);
  assert.equal(opened.hidden,false);
  assert.match(opened.pay,/次の返済まであと/);
  assert.match(opened.pay,/必要額/);
  assert.match(opened.pay,/30/);
  assert.match(opened.pay,/5,600/);
  const back=await page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours');
    const rep=S.taverns.ours.rep;a.trips=1;render();
    const s=document.querySelector('#memo li.done s');
    const when=document.querySelector('#memo li.done .when');
    return {rep:S.taverns.ours.rep-rep,n:document.querySelectorAll('#memo li').length,struck:s&&s.textContent,when:when&&when.textContent,whenInside:s&&s.textContent.includes('日目'),desk:document.querySelector('#tbody').innerText};
  });
  assert.equal(back.rep,1);
  assert.equal(back.n,4);
  assert.match(back.struck,/送り出した連中が、生きて戻ってくる/);
  assert.match(back.when,/日目/);
  assert.equal(back.whenInside,false);
  assert.match(back.desk,/次の返済まであと30日・必要額5,600G/);
  await page.locator('button[data-v="rank"]').click();
  const rank=await page.locator('#memo-log').innerText();
  assert.match(rank,/送り出した連中が、生きて戻ってくる/);
  assert.match(rank,/日目/);
  await page.evaluate(()=>{S.memo.done.home.tk=TICKS_PER_DAY;render();});
  await page.setViewportSize({width:375,height:812});
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('button[data-v="desk"]').click();
  const phone=await page.evaluate(()=>{
    const bad=[];
    const pay=document.querySelector('#payw'),tabs=document.querySelector('.tabs'),memo=document.querySelector('#memo');
    const pr=pay.getBoundingClientRect(),tr=tabs.getBoundingClientRect(),mr=memo.getBoundingClientRect();
    if(getComputedStyle(pay).position!=='fixed')bad.push('返済が下に固定されていない');
    if(getComputedStyle(tabs).position!=='fixed')bad.push('タブが下に固定されていない');
    if(pr.bottom>tr.top+1)bad.push('返済がタブに重なる');
    if(pr.top<0||pr.left<-1||pr.right>innerWidth+1||pr.height<18)bad.push('返済が画面に収まらない');
    if(mr.left<-1||mr.right>innerWidth+1)bad.push('覚え書きが横にはみ出す');
    if(mr.top<0||mr.bottom>tr.top+1)bad.push('覚え書きがタブに隠れている');
    const punct='、。！？ 　';
    for(const li of document.querySelectorAll('#memo li')){
      const node=li.querySelector('s')?.firstChild||[...li.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
      if(!node)continue;
      const text=node.textContent;
      const range=document.createRange();
      let last=null;
      for(let i=0;i<text.length;i++){
        range.setStart(node,i);range.setEnd(node,i+1);
        const rr=[...range.getClientRects()].find(x=>x.width>1);
        if(!rr)continue;
        if(last!=null&&Math.abs(rr.top-last)>4){
          if(!punct.includes(text[i-1]))bad.push(text+' が途中で折れている');
          break;
        }
        last=rr.top;
      }
      const when=li.querySelector('.when');
      if(when){
        const wtext=when.textContent;
        if(li.dataset.id==='home'&&wtext!=='2日目')bad.push('かなえた日付が2日目ではない '+wtext);
        const node=when.firstChild;
        range.setStart(node,0);range.setEnd(node,wtext.length);
        const tops=new Set([...range.getClientRects()].filter(x=>x.width>2).map(x=>Math.round(x.top)));
        if(tops.size!==1)bad.push('日付が折れている '+wtext);
      }
    }
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    return bad;
  });
  assert.deepEqual(phone,[]);
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>{window.scrollTo(0,0);return document.fonts.ready;});
  const wide=await page.evaluate(()=>{
    const bad=[];
    const pay=document.querySelector('#payw'),tabs=document.querySelector('#tabs'),side=document.querySelector('.side');
    const pr=pay.getBoundingClientRect(),tr=tabs.getBoundingClientRect(),sr=side.getBoundingClientRect();
    if(getComputedStyle(pay).position==='fixed')bad.push('広い画面で返済が画面下に固定されている');
    if(pr.bottom>tr.top+2)bad.push('返済がタブの上にない');
    if(pr.left<sr.left-2||pr.right>sr.right+2)bad.push('返済が右の列からはみ出す');
    if(pr.top<0||pr.bottom>innerHeight+1)bad.push('返済が画面の外');
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    const memo=document.querySelector('#memo');
    if(!memo||memo.getBoundingClientRect().right>sr.right+2)bad.push('覚え書きが右の列からはみ出す');
    return bad;
  });
  assert.deepEqual(wide,[]);
  const old=await page.evaluate(()=>{
    S.v=SAVE_V;delete S.memo;S.taverns.ours.rep=4;
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&(x.trips||0)>=1);
    a.trips=2;migrate(S);const rep=S.taverns.ours.rep;render();
    const home=document.querySelector('#memo li[data-id="home"]');
    return {v:S.v,rep,home:home&&home.innerText,struck:!!home&&!!home.querySelector('s'),pay:document.querySelector('#payw').hidden};
  });
  assert.equal(old.v,await page.evaluate('SAVE_V'));
  assert.equal(old.rep,4);
  assert.equal(old.struck,true);
  assert.match(old.home,/送り出した連中が、生きて戻ってくる/);
  assert.equal(old.pay,false);
  const done=await page.evaluate(()=>{
    S.taverns.ours.rep=Math.max(S.taverns.ours.rep,200);
    const rep0=S.taverns.ours.rep;const before=new Set(Object.keys(S.memo.done));
    const a=Object.values(S.adv).find(x=>x.tav==='ours');
    a.pastDreams=[{k:'fame',t:'夢',tk:S.tick}];S.stats.dreams.ours=(S.stats.dreams.ours||0)+1;
    S.taverns.ours.seats=18;S.taverns.ours.cleanPay=S.taverns.ours.cleanPay??S.tick;
    S.deepest.ours=Math.max(S.deepest.ours,21);S.deepest.rival=1;S.rares=S.rares||{};S.rares[1]={killed:{tav:'ours',tk:S.tick,party:'p',names:[a.name]}};
    S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.taverns.ours.debtFree??S.tick;S.taverns.ours.overtook=S.tick;
    render();
    const added=MEMO.filter(m=>!before.has(m.id)).reduce((s,m)=>s+m.rep,0);
    return {rep:S.taverns.ours.rep-rep0,added,show:memoState(S).show.length,log:memoState(S).log.length,pay:document.querySelector('#payw').hidden,desk:!!document.querySelector('#memo')};
  });
  assert.equal(done.rep,done.added);
  assert.equal(done.show,0);
  assert.equal(done.desk,false);
  assert.equal(done.log,12);
  assert.equal(done.pay,true);
  await page.locator('button[data-v="rank"]').click();
  assert.equal(await page.locator('#memo-log li').count(),12);
  assert.equal(await page.locator('#memo-log s').count(),12);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('開店の顔ぶれは、知らせと手帳と記念碑に出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const info=await page.evaluate(()=>{
    const cast=Object.values(S.adv).filter(a=>a.opening).sort((a,b)=>a.id-b.id);
    const guests=S.news.find(n=>n.t.startsWith('最初の客たち'));
    const holders=cast.filter(a=>a.dream&&a.dream.k==='stele');
    const h=holders[0];
    const prog=DREAMS.stele.prog(h);
    return {n:cast.length,names:cast.map(a=>a.name),origins:cast.map(a=>a.origin),guests:guests&&guests.t,id:h.id,bg:h.bg,dream:dreamText(h.dream),texts:holders.map(a=>dreamText(a.dream)).sort(),prog};
  });
  assert.equal(info.n,7);
  assert.deepEqual(info.texts,['B6Fの転移の石碑に、一度触れてみたい','B6Fまで潜って、地上の店に戻ってみたい'].sort());
  assert.equal(info.prog,'まだ迷宮に潜っていない');
  const news=await page.locator('.news li',{hasText:'最初の客たち'}).innerText();
  assert.match(news,/最初の客たち/);
  for(const name of info.names)assert.match(news,new RegExp(name));
  for(const origin of info.origins)assert.match(news,new RegExp(origin+'出身'));
  await page.locator(`.c-members button[data-a="${info.id}"]`).click();
  const book=await page.locator('#advbox').innerText();
  assert.match(book,/開店からの常連/);
  assert.match(book,new RegExp(info.dream.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(book,new RegExp(info.prog.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(book,/Lv\d/);
  assert.doesNotMatch(book,/B0F/);
  assert.match(book,new RegExp(info.bg.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').slice(-12)));
  await page.locator('#advbox [data-act="closeadv"]').click();
  await page.evaluate(()=>{
    const cast=Object.values(S.adv).filter(a=>a.opening);
    const lost=cast[0],gone=cast[1];
    lost.status='lost';
    S.memorial.push({id:lost.id,name:lost.name,cls:lost.cls,lvl:lost.lvl,race:lost.race,tav:'ours',tk:S.tick,by:'オーク',floor:2,kills:0});
    S.farewells.push({id:gone.id,name:gone.name,cls:gone.cls,lvl:gone.lvl,race:gone.race,sex:gone.sex,age:gone.age,hage:gone.age,tav:'ours',tk:S.tick,why:'夢を果たした'});
    tab='stone';render();
  });
  const stones=page.locator('#tbody .ep',{hasText:'開店からの常連'});
  assert.equal(await stones.count(),2);
  assert.match(await stones.nth(0).innerText(),/開店からの常連/);
  assert.match(await stones.nth(1).innerText(),/開店からの常連/);
  // 記念碑の名前は文の頭ではなく添え書きの前。44pxの箱（nm-head）にはしない
  const inline=await page.evaluate(()=>{
    const bad=[];
    const marked=[...document.querySelectorAll('.stone')].filter(s=>s.querySelector('.ep')?.textContent.includes('開店からの常連'));
    if(marked.length<2)bad.push('開店からの常連の碑が足りない');
    for(const s of marked){
      const b=s.querySelector('.nm-link');
      if(!b)bad.push('碑の名前がない');
      else if(b.classList.contains('nm-head'))bad.push('碑の名前が行頭の44px');
      const ep=s.querySelector('.ep');
      const row=ep.getBoundingClientRect().top-s.getBoundingClientRect().top;
      if(row>36)bad.push('碑の名前の行が高い '+Math.round(row));
    }
    return bad;
  });
  assert.deepEqual(inline,[]);
  for(const width of [375,1280]){
    await page.setViewportSize({width,height:width===375?812:800});
    await page.locator('button[data-v="news"]').click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,`幅${width}で横にはみ出す`);
    const row=page.locator('.news li',{hasText:'最初の客たち'});
    await row.scrollIntoViewIfNeeded();
    const box=await row.boundingBox();
    assert.ok(box&&box.width>40,`幅${width}で知らせが見えない`);
    const newsFit=await row.evaluate(el=>{
      const bad=[];
      if(el.querySelector('.nm-link,.nm-head,button'))bad.push('最初の客たちの名前がボタンになっている');
      const span=[...el.children].find(n=>!n.classList.contains('d'));
      const range=document.createRange();range.selectNodeContents(span);
      const lineH=Math.max(...[...range.getClientRects()].map(r=>r.height));
      if(!(lineH<28))bad.push('最初の客たちの行が高い '+Math.round(lineH));
      return bad;
    });
    assert.deepEqual(newsFit,[],`幅${width}の最初の客たち`);
    if(width===375){
      await page.locator('button[data-v="stone"]').click();
      const stoneRow=await page.evaluate(()=>{
        const s=[...document.querySelectorAll('.stone')].find(el=>el.querySelector('.ep')?.textContent.includes('開店からの常連'));
        if(!s)return 999;
        const b=s.querySelector('.nm-link');
        if(!b||b.classList.contains('nm-head'))return 999;
        return s.querySelector('.ep').getBoundingClientRect().top-s.getBoundingClientRect().top;
      });
      assert.ok(stoneRow<=36,`幅375で記念碑の名前の行が高い ${stoneRow}`);
    }
  }
  assert.deepEqual(errors,[]);await ctx.close();
});

test('スマホ幅では帳場と名簿と留守のあいだの押し場所が44px以上で、見出しと知らせは語の途中で折れない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    if(p)p.state='explore';
    render();
  });
  await page.evaluate(()=>document.fonts.ready);
  const headsOf=()=>page.evaluate(()=>{
    const bad=[];
    const lines=node=>{
      const range=document.createRange();range.selectNodeContents(node);
      return new Set([...range.getClientRects()].filter(r=>r.width>2).map(r=>Math.round(r.top))).size;
    };
    const phrase=(node,s)=>{
      const text=node.textContent,i=text.indexOf(s);if(i<0)return 0;
      const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+s.length);
      return new Set([...range.getClientRects()].filter(r=>r.width>2).map(r=>Math.round(r.top))).size;
    };
    for(const h of document.querySelectorAll('h2.h2')){
      const tn=[...h.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
      const span=h.querySelector('span');
      const title=tn.textContent.trim();
      if(lines(tn)!==1)bad.push(title+' が見出しの途中で折れている');
      const tb=Math.max(...[...(()=>{const range=document.createRange();range.selectNodeContents(tn);return range.getClientRects();})()].map(r=>r.bottom));
      const spanTop=span.getBoundingClientRect().top;
      if(innerWidth<=640){
        if(spanTop<tb-1)bad.push(title+' の副題が横にある');
      }else if(spanTop>tn.parentElement.getBoundingClientRect().top+14){
        bad.push(title+' の副題が下に落ちている');
      }
      if(phrase(span.firstChild,'映ります')!==1)bad.push('映ります が途中で折れている');
    }
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    return bad;
  });
  for(const width of [375,390]){
    await page.setViewportSize({width,height:width===375?740:844});
    await page.evaluate(()=>document.fonts.ready);
    assert.deepEqual(await headsOf(),[],width+' の見出し');
    await page.locator('button[data-v="desk"]').click();
    const desk=await page.evaluate(()=>{
      const bad=[];
      const size=(el,name)=>{
        const r=el.getBoundingClientRect();
        if(r.width<44||r.height<44)bad.push(`${name} ${Math.round(r.width)}×${Math.round(r.height)}`);
      };
      const buttons=[...document.querySelectorAll('#tbody .btn')];
      if(buttons.length<5)bad.push('帳場のボタンが少ない');
      for(const b of buttons)size(b,b.innerText.replace(/\s+/g,' '));
      const links=[...document.querySelectorAll('#tbody .nm-link')];
      if(!links.length)bad.push('帳場に名前がない');
      for(const b of links)size(b,'名前 '+b.innerText);
      for(const g of [[...document.querySelectorAll('button[data-act="repay"]')],[...document.querySelectorAll('button[data-act="pol"][data-k="potion"]')]]){
        const rs=g.map(b=>b.getBoundingClientRect());
        for(let i=1;i<rs.length;i++){
          if(Math.abs(rs[i].top-rs[i-1].top)>8)continue;
          const gap=rs[i].left-rs[i-1].right;
          if(gap<7)bad.push(`ボタンの間隔 ${Math.round(gap)}`);
        }
      }
      const pay=document.querySelector('#payw');
      const pr=pay.getBoundingClientRect();
      const port=document.querySelector('.wrap').getBoundingClientRect();
      if(pay.hidden||getComputedStyle(pay).position!=='fixed')bad.push('返済の帯が下にない');
      for(const b of document.querySelectorAll('#tbody .btn')){
        const r=b.getBoundingClientRect();
        if(r.width<1||r.bottom<=port.top+1||r.top>=port.bottom-1)continue;
        if(!(r.right<=pr.left||r.left>=pr.right||r.bottom<=pr.top+1||r.top>=pr.bottom-1))bad.push('返済の帯がボタンを隠す '+b.innerText.replace(/\s+/g,' ').slice(0,20));
      }
      return bad;
    });
    assert.deepEqual(desk,[],width+' の帳場');
    await page.locator('button[data-v="roster"]').click();
    const roster=await page.evaluate(()=>{
      const links=[...document.querySelectorAll('#tbody .nm-link')];
      if(!links.length)return ['名簿に名前がない'];
      const bad=[];
      for(const b of links){
        const r=b.getBoundingClientRect();
        if(r.width<44||r.height<44)bad.push(`${b.innerText} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return bad;
    });
    assert.deepEqual(roster,[],width+' の名簿');
    const recall=await page.evaluate(()=>{
      const b=document.querySelector('.c-foot .btn');
      if(!b)return ['撤退のボタンがない'];
      const r=b.getBoundingClientRect();
      return r.width<44||r.height<44?[`撤退 ${Math.round(r.width)}×${Math.round(r.height)}`]:[];
    });
    assert.deepEqual(recall,[],width+' の撤退');
    const lines=await page.evaluate(()=>{
      const bad=[];
      const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');
      const name=a.name;
      a.name='ルゥ';
      const T0=S.taverns.ours;
      const debt=T0.debt,free=T0.debtFree,ch=S.chatter,mem=S.memorial.slice(),fw=(S.farewells||[]).slice();
      T0.debt=0;T0.debtFree=S.tick;
      const E=errandsOf(S);E.stage=3;const board=E.board.slice();
      S.chatter=[{tk:S.tick,lines:[{id:a.id,who:'ルゥ',t:'今夜は静かだな'},{who:'語り',t:'名前のない行です'}]}];
      S.memorial=[{id:a.id,name:'ルゥ',cls:'戦士',lvl:1,race:'人間',tav:'ours',tk:S.tick,by:'魔物',floor:1,kills:0}];
      S.farewells=[{name:'ルゥ',cls:'戦士',lvl:1,race:'人間',tav:'ours',tk:S.tick,why:'故郷へ帰る',age:30,sex:'男'}];
      E.board=[{id:9001,n:'試しの話',from:'王国',t:'文面だけ',until:S.tick+TICKS_PER_DAY,hero:a.id,tk:S.tick,refused:[]}];
      const h=el=>el.getBoundingClientRect().height;
      tab='bar';render();
      const chats=[...document.querySelectorAll('.quote.chat div')];
      if(chats.length<2)bad.push('ざわめきが足りない');
      else if(Math.abs(h(chats[0])-h(chats[1]))>4)bad.push(`ざわめきの行 ${Math.round(h(chats[0]))} と ${Math.round(h(chats[1]))}`);
      const link=chats[0]&&chats[0].querySelector('.nm-link');
      if(link&&link.getBoundingClientRect().width>=40)bad.push('短い名前が箱になっている '+Math.round(link.getBoundingClientRect().width));
      const by=document.querySelector('.quote.board .by');
      if(!by)bad.push('掲示がない');
      else if(h(by)>36)bad.push('掲示の一行が高い '+Math.round(h(by)));
      tab='stone';render();
      const stones=[...document.querySelectorAll('.stone')];
      const withName=stones.find(s=>s.querySelector('.nm-link'));
      const plain=stones.find(s=>!s.querySelector('.nm-link'));
      const nameRow=el=>{const ep=el.querySelector('.ep');return ep.getBoundingClientRect().top-el.getBoundingClientRect().top;};
      if(!withName||!plain)bad.push('記念碑が足りない');
      else if(Math.abs(nameRow(withName)-nameRow(plain))>6)bad.push(`記念碑の名前の行 ${Math.round(nameRow(withName))} と ${Math.round(nameRow(plain))}`);
      a.name=name;T0.debt=debt;T0.debtFree=free;S.chatter=ch;S.memorial=mem;S.farewells=fw;E.board=board;
      tab='desk';render();
      return bad;
    });
    assert.deepEqual(lines,[],width+' の文中の名前');
  }
  await page.setViewportSize({width:375,height:740});
  await page.evaluate(()=>{document.querySelector('#digest').hidden=false;});
  const back=await page.evaluate(()=>{
    const b=document.querySelector('[data-act="closedigest"]');
    const r=b.getBoundingClientRect();
    return r.width<44||r.height<44?[`店に戻る ${Math.round(r.width)}×${Math.round(r.height)}`]:[];
  });
  assert.deepEqual(back,[]);
  await page.evaluate(()=>{document.querySelector('#digest').hidden=true;});
  await page.locator('button[data-v="desk"]').click();
  await page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');
    a.name='エリン';a.status='ash';a.hp=0;a.party=null;S.taverns.ours.gold=100000;render();
  });
  await page.locator('h3',{hasText:'常連への手当て'}).scrollIntoViewIfNeeded();
  const toastAt=async()=>{
    await page.evaluate(()=>toast('エリンは蘇生に失敗し、ロストした'));
    await frames(page);
    return page.evaluate(()=>{
      const el=document.querySelector('.toast');
      if(!el)return ['知らせがない'];
      const bad=[];
      const r=el.getBoundingClientRect();
      const tab=document.querySelector('.tabs').getBoundingClientRect();
      const pay=document.querySelector('#payw');
      const payOn=pay&&!pay.hidden&&pay.getBoundingClientRect().height>0;
      const anchor=payOn?pay.getBoundingClientRect():tab;
      const text=el.firstChild,s=el.textContent,i=s.indexOf('ロスト');
      const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+'ロスト'.length);
      const rows=new Set([...range.getClientRects()].filter(x=>x.width>2).map(x=>Math.round(x.top)));
      if(rows.size!==1)bad.push('ロスト が途中で折れている');
      if(Math.abs(r.left-16)>2||Math.abs(innerWidth-r.right-16)>2)bad.push(`知らせの幅 ${Math.round(r.left)}..${Math.round(r.right)}`);
      if(r.bottom>anchor.top+1||anchor.top-r.bottom>20)bad.push(`知らせが${payOn?'返済の帯':'タブ'}のすぐ上にない ${Math.round(anchor.top-r.bottom)}`);
      if(payOn&&pay.getBoundingClientRect().bottom>tab.top+1)bad.push('返済の帯がタブに重なる');
      const zones=[{name:'知らせ',rect:r}];
      if(payOn)zones.push({name:'返済の帯',rect:pay.getBoundingClientRect()});
      const port=document.querySelector('.wrap').getBoundingClientRect();
      for(const b of document.querySelectorAll('#tbody .btn')){
        const br=b.getBoundingClientRect();
        if(br.width<1||br.bottom<=port.top+1||br.top>=port.bottom-1)continue;
        for(const z of zones){
          const zr=z.rect;
          const hit=!(br.right<=zr.left||br.left>=zr.right||br.bottom<=zr.top+1||br.top>=zr.bottom-1);
          if(hit)bad.push(z.name+'がボタンを隠す '+b.innerText.replace(/\s+/g,' ').slice(0,24));
        }
      }
      return bad;
    });
  };
  assert.deepEqual(await toastAt(),[],'手当てを見ているときの知らせ');
  await page.evaluate(()=>{
    document.querySelector('.toast')?.remove();
    const b=document.querySelector('button[data-act="reset"]');
    const tab=document.querySelector('.tabs').getBoundingClientRect().top;
    document.querySelector('.wrap').scrollBy(0,b.getBoundingClientRect().bottom-(tab-24));
  });
  assert.deepEqual(await toastAt(),[],'最初から始めるの上に知らせを出したとき');
  await page.evaluate(()=>{
    document.querySelector('.toast')?.remove();
    S.taverns.ours.debt=0;render();
    const b=document.querySelector('button[data-act="reset"]');
    const tab=document.querySelector('.tabs').getBoundingClientRect().top;
    document.querySelector('.wrap').scrollBy(0,b.getBoundingClientRect().bottom-(tab-24));
  });
  const paid=await page.evaluate(()=>({hidden:document.querySelector('#payw').hidden,h:getComputedStyle(document.documentElement).getPropertyValue('--paybar-h')}));
  assert.equal(paid.hidden,true);
  assert.equal(paid.h.trim(),'0px');
  assert.deepEqual(await toastAt(),[],'借金を返し終えたあとの知らせ');
  await page.evaluate(()=>{
    document.querySelector('.toast')?.remove();
    document.documentElement.style.removeProperty('--toast-h');
    S.taverns.ours.debt=DEBT0;render();
  });
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('button[data-v="desk"]').click();
  const wide=await page.evaluate(()=>{
    const bad=[];
    for(const h of document.querySelectorAll('h2.h2')){
      const tn=[...h.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
      const span=h.querySelector('span');
      const top=h.getBoundingClientRect().top;
      if(span.getBoundingClientRect().top>top+14)bad.push(tn.textContent.trim()+' の副題が下に落ちている');
    }
    const btn=document.querySelector('button[data-act="repay"]');
    const br=btn.getBoundingClientRect();
    if(br.height>=40)bad.push(`広い画面のボタンが高い ${Math.round(br.height)}`);
    const who=btn.closest('.row').querySelector('.who').getBoundingClientRect();
    if(!(br.top>=who.bottom-1))bad.push('狭い右の列で返済ボタンが見出しの横にある');
    toast('エリンは蘇生に失敗し、ロストした');
    const t=document.querySelector('.toast').getBoundingClientRect();
    if(t.width>innerWidth-80)bad.push('広い画面の知らせが幅いっぱい');
    if(t.left<40)bad.push('広い画面の知らせが左に寄っている');
    return bad;
  });
  assert.deepEqual(wide,[]);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('新しく始めると、何も押さなくても覚え書きがあると分かる',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.evaluate(()=>document.fonts.ready);
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>{document.querySelector('.wrap').scrollTo(0,0);window.scrollTo(0,0);});
    await page.evaluate(()=>document.fonts.ready);
    const seen=await page.evaluate(()=>{
      const bad=[];
      const line=document.querySelector('#memoline');
      const desk=document.querySelector('button[data-v="desk"]');
      if(!line||line.hidden)bad.push('いちばん近い目標が出ていない');
      else{
        const t=line.textContent;
        if(!t.startsWith('店主の覚え書き：'))bad.push(t);
        if(!t.includes('送り出した連中が、生きて戻ってくる'))bad.push(t);
        const r=line.getBoundingClientRect();
        if(r.top<0||r.bottom>innerHeight+1||r.left<-1||r.right>innerWidth+1)bad.push(`目標が画面の外 ${Math.round(r.top)}..${Math.round(r.bottom)}`);
        if(r.height<18)bad.push('目標が潰れている');
      }
      if(!desk||!desk.textContent.includes('覚え書き'))bad.push('帳場に覚え書きの印がない '+(desk&&desk.textContent));
      const dr=desk.getBoundingClientRect();
      if(dr.top<0||dr.bottom>innerHeight+1||dr.left<-1||dr.right>innerWidth+1)bad.push('帳場の札が画面の外');
      if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
      return bad;
    });
    assert.deepEqual(seen,[],width+' の初めの画面');
  }
  await page.setViewportSize({width:375,height:740});
  await page.locator('#memoline').click();
  const opened=await page.evaluate(()=>{
    const bad=[];
    const memo=document.querySelector('#memo');
    const desk=document.querySelector('button[data-v="desk"]');
    if(!memo)bad.push('帳場の覚え書きが開いていない');
    else{
      const r=memo.getBoundingClientRect();
      const bar=document.querySelector('.tabs').getBoundingClientRect().top;
      if(r.top<0||r.bottom>bar+1)bad.push('覚え書きが画面に入っていない');
    }
    if(desk.textContent.includes('覚え書き'))bad.push('帳場を開いたあとも印が残っている');
    if(document.querySelector('#memoline').hidden)bad.push('かなえていないのに一行が消えた');
    return bad;
  });
  assert.deepEqual(opened,[]);
  await page.evaluate(()=>{
    S.taverns.ours.rep=Math.max(S.taverns.ours.rep,200);
    const a=Object.values(S.adv).find(x=>x.tav==='ours');
    a.trips=1;a.pastDreams=[{k:'fame',t:'夢',tk:S.tick}];S.stats.dreams.ours=1;
    S.taverns.ours.seats=18;S.taverns.ours.cleanPay=S.tick;S.deepest.ours=30;S.deepest.rival=1;
    S.rares={1:{killed:{tav:'ours',tk:S.tick,party:'p',names:[a.name]}}};
    S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.tick;S.taverns.ours.overtook=S.tick;
    render();
  });
  const done=await page.evaluate(()=>({line:document.querySelector('#memoline').hidden,mark:document.querySelector('button[data-v="desk"]').textContent.includes('覚え書き')}));
  assert.equal(done.line,true);
  assert.equal(done.mark,false);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('900px以下では返済の帯とタブが初めから見え、ページ自体は動かず、最後の空きは12pxほど',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.evaluate(()=>document.fonts.ready);
  const look=()=>page.evaluate(()=>{
    const bad=[];
    const pay=document.querySelector('#payw'),tabs=document.querySelector('.tabs');
    const narrow=innerWidth<=900;
    const pr=pay.getBoundingClientRect(),tr=tabs.getBoundingClientRect();
    if(pay.hidden)bad.push('返済の帯が隠れている');
    if(getComputedStyle(pay).position!==(narrow?'fixed':'static')&&!(narrow&&getComputedStyle(pay).position==='fixed')){
      if(narrow&&getComputedStyle(pay).position!=='fixed')bad.push('返済が下に固定されていない');
      if(!narrow&&getComputedStyle(pay).position==='fixed')bad.push('広い幅で返済が画面下に固定されている');
    }
    if(narrow&&getComputedStyle(tabs).position!=='fixed')bad.push('タブが下に固定されていない');
    if(!narrow&&getComputedStyle(tabs).position==='fixed')bad.push('広い幅でタブが画面下に固定されている');
    if(pr.top<-1||pr.bottom>innerHeight+1||pr.left<-1||pr.right>innerWidth+1||pr.height<18)bad.push(`返済が画面の外 ${Math.round(pr.top)}..${Math.round(pr.bottom)}`);
    if(tr.top<-1||tr.bottom>innerHeight+1||tr.left<-1||tr.right>innerWidth+1)bad.push(`タブが画面の外 ${Math.round(tr.top)}..${Math.round(tr.bottom)}`);
    if(narrow&&pr.bottom>tr.top+1)bad.push('返済がタブに重なる');
    if(document.scrollingElement.scrollTop!==0)bad.push('ページ自体が動いている '+document.scrollingElement.scrollTop);
    if(getComputedStyle(document.body).marginTop!=='0px'||getComputedStyle(document.body).marginLeft!=='0px')bad.push('body の余白が残っている');
    const wrap=document.querySelector('.wrap').getBoundingClientRect();
    if(narrow&&Math.round(wrap.left)!==16)bad.push('中身の左が16pxではない '+Math.round(wrap.left));
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    const bs=[...document.querySelectorAll('.ctrl .btn')].map(b=>b.getBoundingClientRect()).sort((a,b)=>a.top-b.top||a.left-b.left);
    for(let i=1;i<bs.length;i++){
      if(Math.abs(bs[i].top-bs[i-1].top)>8)continue;
      const gap=bs[i].left-bs[i-1].right;
      if(gap<7||gap>10)bad.push(`速さのボタンの間隔 ${Math.round(gap)}`);
    }
    return {bad,wrapTop:Math.round(wrap.top)};
  });
  const tops=[];
  for(const [width,height] of [[375,740],[390,844],[640,900],[641,900],[768,1024],[844,390],[900,700],[901,800],[1280,800]]){
    await page.setViewportSize({width,height});
    // 幅を変えた直後は、返済の帯の位置を直す処理がまだ走っていないことがある。ここで一度直してから測る
    await page.evaluate(()=>{document.querySelector('.wrap').scrollTo(0,0);window.scrollTo(0,0);window.dispatchEvent(new Event('resize'));});
    await page.evaluate(()=>document.fonts.ready);
    const first=await look();
    assert.deepEqual(first.bad,[],`${width}×${height} を開いた直後`);
    if(width<=900)tops.push(first.wrapTop);
    await page.locator('button[data-v="desk"]').click();
    const desk=await page.evaluate(()=>{
      const bad=[];
      const pay=document.querySelector('#payw'),tabs=document.querySelector('.tabs');
      const pr=pay.getBoundingClientRect(),tr=tabs.getBoundingClientRect();
      const narrow=innerWidth<=900;
      if(narrow&&(getComputedStyle(pay).position!=='fixed'||getComputedStyle(tabs).position!=='fixed'))bad.push('帳場でも帯かタブが固定されていない');
      if(pr.top<-1||pr.bottom>innerHeight+1||tr.top<-1||tr.bottom>innerHeight+1)bad.push('帳場で帯かタブが画面の外');
      if(document.scrollingElement.scrollTop!==0)bad.push('ページ自体が動いている');
      const side=document.querySelector('.side').getBoundingClientRect();
      const wrap=document.querySelector('.wrap').getBoundingClientRect();
      if(narrow&&side.top>wrap.top+8)bad.push(`帳場の先頭が上に来ていない ${Math.round(side.top-wrap.top)}`);
      const row=[...document.querySelectorAll('#tbody .row')].find(el=>el.innerText.includes('借金の残り'));
      const label=row.querySelector('b').getBoundingClientRect();
      const btn=row.querySelector('button').getBoundingClientRect();
      const stacked=btn.top>=label.bottom-1;
      if(innerWidth<=640&&!stacked)bad.push('帳場のボタンが見出しの横にある');
      if(innerWidth>640&&innerWidth<=900&&stacked)bad.push('帳場のボタンが見出しの下にある');
      if(innerWidth>900&&!stacked)bad.push('狭い右の列で返済のボタンが見出しの横にある');
      const port=document.querySelector('.wrap').getBoundingClientRect();
      for(const b of document.querySelectorAll('#tbody .btn')){
        const r=b.getBoundingClientRect();
        const top=Math.max(r.top,port.top),bot=Math.min(r.bottom,port.bottom);
        if(r.width<1||bot-top<8)continue;
        if(r.right>innerWidth+1||r.left<-1)bad.push('ボタンが横にはみ出す');
        if(narrow&&!(r.right<=pr.left||r.left>=pr.right||bot<=pr.top+1||top>=pr.bottom-1))bad.push('返済の帯がボタンを隠す '+b.innerText.replace(/\s+/g,' ').slice(0,16));
        if(narrow&&!(r.right<=tr.left||r.left>=tr.right||bot<=tr.top+1||top>=tr.bottom-1))bad.push('タブがボタンを隠す');
      }
      if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
      if(innerWidth===768||innerWidth===900){
        const trf=document.querySelector('.mapfloors tr.flr');
        if(trf)bad.push('帳場に階の札がある');
      }
      return {bad,wrapTop:Math.round(wrap.top)};
    });
    assert.deepEqual(desk.bad,[],`${width}×${height} の帳場`);
    if(width<=900)tops.push(desk.wrapTop);
    if(width===768){
      await page.locator('button[data-v="maps"]').click();
      const table=await page.evaluate(()=>{
        const tr=document.querySelector('.mapfloors tr.flr');
        const a=tr.children[0].getBoundingClientRect(),b=tr.children[1].getBoundingClientRect();
        return Math.abs(a.top-b.top)<8&&b.left>a.left;
      });
      assert.equal(table,true,'768pxでは階の一覧が表のまま');
    }
    if(width===375||width===390){
      const gaps=[];
      for(const name of ['news','desk','stone','ref']){
        await page.locator(`button[data-v="${name}"]`).click();
        const gap=await page.evaluate(()=>{
          const wrap=document.querySelector('.wrap');
          wrap.scrollTop=wrap.scrollHeight;
          const pay=document.querySelector('#payw');
          const tabs=document.querySelector('.tabs');
          const anchor=(pay&&!pay.hidden?pay:tabs).getBoundingClientRect().top;
          const last=document.querySelector('#tbody').lastElementChild;
          const mb=parseFloat(getComputedStyle(last).marginBottom)||0;
          return Math.round(anchor-(last.getBoundingClientRect().bottom+mb));
        });
        gaps.push([name,gap]);
      }
      for(const [name,gap] of gaps)assert.ok(gap>=12&&gap<=24,`${width}px の${name}の下の空きは ${gap}px（${gaps.map(g=>g.join(':')).join(' ')}）`);
    }
  }
  const uniq=[...new Set(tops)];
  assert.equal(uniq.length,1,`中身の上端が揺れている ${uniq.join(',')}`);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('900px以下で中身の短いタブは、下まで送ったところで止まり、中身は帯の上にすべて見える',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  // 開き立て。帳場は長く先頭が上に来る。記念碑は短い。迷宮日報は375では上まで届き、768では届かない。
  const expect={375:{desk:'top',news:'top',stone:'short'},768:{desk:'top',news:'short',stone:'short'}};
  const place=()=>page.evaluate(()=>{
    const wrap=document.querySelector('.wrap');
    const side=document.querySelector('.side').getBoundingClientRect();
    const wr=wrap.getBoundingClientRect();
    const tb=document.querySelector('#tbody').getBoundingClientRect();
    const pay=document.querySelector('#payw'),tabs=document.querySelector('.tabs');
    const anchor=(pay&&!pay.hidden?pay:tabs).getBoundingClientRect().top;
    return {sideTop:side.top,wrapTop:wr.top,tbTop:tb.top,tbBot:tb.bottom,anchor,remain:wrap.scrollHeight-wrap.scrollTop-wrap.clientHeight,pageTop:document.scrollingElement.scrollTop};
  });
  for(const [width,height] of [[375,740],[768,1024]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready);
    for(const name of ['desk','news','stone']){
      await page.evaluate(()=>{document.querySelector('.wrap').scrollTo(0,0);window.scrollTo(0,0);});
      await page.locator(`button[data-v="${name}"]`).click();
      const m=await place();
      const atTop=m.sideTop<=m.wrapTop+8;
      const where=`${width}×${height} の${name}（先頭 ${Math.round(m.sideTop)}、上端 ${Math.round(m.wrapTop)}、残り ${Math.round(m.remain)}）`;
      assert.equal(m.pageTop,0,`${where} でページ自体が動いている`);
      assert.equal(atTop?'top':'short',expect[width][name],where);
      if(!atTop){
        assert.ok(m.remain<=1,`${where} は下まで送っていない`);
        assert.ok(m.tbTop>=m.wrapTop-1&&m.tbBot<=m.anchor+1,`${where} の中身が帯の上に見えない ${Math.round(m.tbTop)}..${Math.round(m.tbBot)} 帯 ${Math.round(m.anchor)}`);
      }
    }
  }
  assert.deepEqual(errors,[]);await ctx.close();
});

test('帳場の設備と席に、いまの段が出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.locator('button[data-v="desk"]').click();
  const phrases=(sel)=>page.evaluate(sel=>{
    const bad=[];
    const one=(el,s)=>{
      const node=[...el.childNodes].find(n=>n.nodeType===3&&n.textContent.includes(s));
      if(!node)return;
      const text=node.textContent,i=text.indexOf(s);
      const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+s.length);
      const tops=new Set([...range.getClientRects()].filter(r=>r.width>2).map(r=>Math.round(r.top)));
      if(tops.size!==1)bad.push(s+' が折れている');
    };
    const row=document.querySelector(sel);
    if(!row){bad.push(sel+' がない');return bad;}
    for(const node of row.querySelectorAll('b,.meta,.does,.chip')){
      for(const s of ['Lv0/3','Lv0/2','Lv0/1','Lv1/3','Lv2/3','Lv3/3','Lv0/4','Lv1/4','まだ建てていない','いまの効き目','未建築','建てた','拡張の段とは別'])one(node,s);
    }
    if(row.scrollWidth>row.clientWidth+1)bad.push(sel+' が横にはみ出す');
    return bad;
  },sel);
  const read=()=>page.evaluate(()=>{
    const flat=s=>s.replace(/[ \t\n\r\f]+/g,' ');
    const fac=k=>{const row=document.querySelector(`[data-fac="${k}"]`);return row?flat(row.innerText):'';};
    const seats=document.querySelector('[data-seats]');
    return {dojo:fac('dojo'),info:fac('info'),inn:fac('inn'),seats:seats?flat(seats.innerText):'',wide:document.documentElement.scrollWidth>innerWidth+1};
  });
  const lvUnderName=async width=>{
    const place=await page.evaluate(()=>{
      const one=sel=>{
        const row=document.querySelector(sel);
        const name=row.querySelector('b').getBoundingClientRect();
        const lv=row.querySelector('.meta.lv').getBoundingClientRect();
        return {nt:name.top,nb:name.bottom,nl:name.left,lt:lv.top,ll:lv.left};
      };
      return {dojo:one('[data-fac="dojo"]'),info:one('[data-fac="info"]'),inn:one('[data-fac="inn"]'),seats:one('[data-seats]')};
    });
    const bad=[];
    for(const [k,p] of Object.entries(place)){
      if(p.lt<p.nb-1)bad.push(`${k} の段が名前の下にない`);
      if(Math.abs(p.ll-p.nl)>2)bad.push(`${k} の段の左が名前と揃わない`);
    }
    const lefts=Object.values(place).map(p=>p.ll);
    if(Math.max(...lefts)-Math.min(...lefts)>2)bad.push('設備と席で段の左端が揃わない');
    assert.deepEqual(bad,[],`${width}px の段の位置 ${JSON.stringify(place)}`);
  };
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready);await frames(page);
    const fresh=await read();
    assert.match(fresh.dojo,/稽古場（未建築）/);
    assert.match(fresh.dojo,/Lv0\/3　まだ建てていない/);
    assert.match(fresh.dojo,/いまの効き目：なし/);
    assert.match(fresh.dojo,/建てると稽古場：/);
    assert.match(fresh.info,/情報屋（未建築）/);
    assert.match(fresh.info,/Lv0\/2/);
    assert.match(fresh.inn,/療養所（未建築）/);
    assert.match(fresh.inn,/Lv0\/1/);
    assert.match(fresh.seats,/常連の席 12席/);
    assert.match(fresh.seats,/Lv0\/4/);
    assert.doesNotMatch(fresh.seats,/支店/);
    assert.equal(fresh.wide,false,width+' でページが横にはみ出す');
    for(const sel of ['[data-fac="dojo"]','[data-fac="info"]','[data-fac="inn"]','[data-seats]'])assert.deepEqual(await phrases(sel),[],`${width}px の ${sel}`);
    await lvUnderName(width);
  }
  await page.setViewportSize({width:375,height:740});
  await page.evaluate(()=>{S.taverns.ours.gold=20000;render();});
  await page.locator('button[data-act="fac"][data-k="dojo"]').click();
  const built=await read();
  assert.match(built.dojo,/^稽古場 /);
  assert.match(built.dojo,/Lv1\/3/);
  assert.doesNotMatch(built.dojo,/未建築|まだ建てていない/);
  assert.match(built.dojo,/いまの効き目：/);
  assert.match(built.dojo,/建て増すと道場：/);
  const news=await page.evaluate(()=>S.news.map(n=>n.t).filter(t=>t.includes('稽古場')));
  assert.ok(news.some(t=>t.includes('稽古場ができた（Lv1）')),news.join(' / '));
  await page.evaluate(()=>{
    S.taverns.ours.gold=2000000;
    buildFac(S,'dojo');buildFac(S,'inn');
    S.taverns.ours.seats=18;
    const t=smallOf(S)[0];t.owned=S.tick;
    render();
  });
  const mid=await read();
  assert.match(mid.dojo,/道場/);
  assert.match(mid.dojo,/Lv2\/3/);
  assert.match(mid.dojo,/建て増すと修練場：/);
  assert.match(mid.info,/Lv0\/2　まだ建てていない/);
  assert.match(mid.inn,/療養所/);
  assert.match(mid.inn,/Lv1\/1/);
  assert.match(mid.inn,/建てた/);
  assert.doesNotMatch(mid.inn,/建てると|建て増すと/);
  assert.match(mid.seats,/常連の席 18席/);
  assert.match(mid.seats,/Lv1\/4/);
  assert.match(mid.seats,/支店で\+6席あり、あわせて24席/);
  assert.match(mid.seats,/拡張の段とは別/);
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready);await frames(page);
    const view=await read();
    assert.equal(view.wide,false,width+' でページが横にはみ出す');
    await lvUnderName(width);
    if(width<=640)for(const sel of ['[data-fac="dojo"]','[data-fac="info"]','[data-fac="inn"]','[data-seats]'])assert.deepEqual(await phrases(sel),[],`${width}px の段 ${sel}`);
    if(width>640){
      const beside=await page.evaluate(()=>{
        const row=document.querySelector('[data-fac="info"]');
        const who=row.querySelector('.who').getBoundingClientRect();
        const btn=row.querySelector('button').getBoundingClientRect();
        return {ok:btn.top<who.bottom&&btn.left>who.left,who:{t:who.top,l:who.left,b:who.bottom,w:who.width},btn:{t:btn.top,l:btn.left,w:btn.width},iw:innerWidth};
      });
      assert.equal(beside.ok,true,'広い画面では建てるボタンが見出しの横にある '+JSON.stringify(beside));
    }
  }
  await page.evaluate(()=>{S.taverns.ours.gold=2000000;buildFac(S,'dojo');render();});
  const maxed=await read();
  assert.match(maxed.dojo,/修練場/);
  assert.match(maxed.dojo,/Lv3\/3/);
  assert.match(maxed.dojo,/いまの効き目：/);
  assert.match(maxed.dojo,/建てた/);
  assert.doesNotMatch(maxed.dojo,/建て増すと|未建築/);
  const lv3=await page.evaluate(()=>S.news.map(n=>n.t).filter(t=>t.includes('修練場')));
  assert.ok(lv3.some(t=>t.includes('修練場ができた（Lv3）')),lv3.join(' / '));
  assert.deepEqual(errors,[]);await ctx.close();
});

test('帳場の説明、資料のヨミガエリ、地図屋のとどめ、踏破の年',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.locator('button[data-v="desk"]').click();
  const desk=await page.locator('#tbody').innerText();
  assert.match(desk,/額は黒猫亭の最深到達の深さで決まる/);
  assert.doesNotMatch(desk,/常連の潜る深さ/);
  assert.match(desk,/依頼を出すときに預ける/);
  assert.match(desk,/連れ帰った一行に払い、見つからなければ戻る/);
  assert.doesNotMatch(desk,/回収されたときに支払う/);
  await page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours');
    a.trips=1;S.taverns.ours.cleanPay=S.tick;S.taverns.ours.seats=18;render();
  });
  assert.match(await page.locator('#memo').innerText(),/B6Fの石碑に触れる/);
  assert.doesNotMatch(await page.locator('#memo').innerText(),/B6の石碑/);
  await page.locator('button[data-v="ref"]').click();
  const ref=await page.locator('#tbody').innerText();
  assert.match(ref,/B16Fから先の澱の中でだけ/);
  assert.doesNotMatch(ref,/より深い澱/);
  await page.locator('button[data-v="maps"]').click();
  await page.evaluate(()=>{
    const ours=Object.values(S.parties).find(p=>p.tav==='ours');
    const rival=Object.values(S.parties).find(p=>p.tav==='rival');
    const a=S.adv[ours.members[0]],b=S.adv[ours.members[1]];
    S.rares=S.rares||{};
    S.rares[1]={killed:{party:ours.name,tav:'ours',names:[a.name,b.name],by:a.name,tk:S.tick}};
    S.rares[2]={killed:{party:rival.name,tav:'rival',names:[S.adv[rival.members[0]].name],tk:10}};
    render();
  });
  const row=floor=>page.locator('#tbody table').nth(1).locator('tr',{has:page.locator('td.fl',{hasText:new RegExp('^'+floor+'$')})});
  const slayer=await page.evaluate(()=>S.adv[Object.values(S.parties).find(p=>p.tav==='ours').members[0]].name);
  assert.match(await row('B1F').innerText(),new RegExp('とどめ：'+slayer));
  assert.match(await row('B2F').innerText(),/とどめ：不明/);
  await page.locator('.c-members button').first().click();
  assert.equal(await page.locator('#advm').isVisible(),true);
  await page.locator('#advm').click({position:{x:2,y:2}});
  assert.equal(await page.locator('#advm').isHidden(),true);
  await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp;a.status='party';});
    S.tick=365*TICKS_PER_DAY;conquest(S,p);render();
  });
  assert.match(await page.locator('#ed-sub').innerText(),/迷宮暦82年・解禁から366日目/);
  const cleared=await page.evaluate(()=>S.news.find(n=>n.t.includes('初めての踏破')).t);
  assert.match(cleared,/迷宮暦82年、初めての踏破である/);
  assert.doesNotMatch(cleared,/81年以来/);
  await page.locator('#ed-btn').click();
  await page.locator('button[data-v="rank"]').click();
  assert.match(await page.locator('#tbody').innerText(),/迷宮暦82年・解禁から366日目/);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('坑道B13Fの水晶には、息を吐かない坑道都市の衛兵が出る',async()=>{
  const {ctx,page,errors}=await open();
  const text=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours'&&x.members.length);
    S.watch=[p.id];S.sel=0;
    p.floor=MINE_TOP+12;p.state='explore';p.maps=Object.assign({},p.maps,{[p.floor]:1});
    S.floors=S.floors||{};S.floors[p.floor]={through:1};
    S.mine={open:0};S.rares=S.rares||{};S.rares[p.floor]={killed:1};
    p.members.forEach(id=>{const a=S.adv[id];a.traits=[...new Set([...(a.traits||[]),'博識'])];a.lvl=40;a.hp=a.mhp=500;a.mp=20;a.status='party';});
    p.log=[];p.enemies=null;p.etype=null;
    let seen=false;
    for(let i=0;i<80&&!seen;i++){
      encounter(S,p);
      seen=!!(p.etype&&(p.etype.base||p.etype.n)==='坑道都市の衛兵');
      if(!seen){p.enemies=null;p.etype=null;p.log=[];}
    }
    if(!seen)return '衛兵が出なかった';
    p.ident=true;p.fought=true;p.ambush=false;p.potions=0;p.guard=0;p.buff=0;
    // 呪文と一撃は出さない。衛兵が生き残って、息ではなく斬りかかるところを見る
    p.members.forEach(id=>{const a=S.adv[id];a.cls='僧侶';a.lvl=3;a.mp=0;a.hp=a.mhp=80;a.eq={};a.traits=['博識'];});
    const said=[];const orig=plog;
    plog=function(p2,t,k){said.push(t);return orig(p2,t,k);};
    let swung=false;
    for(let i=0;i<8&&!swung;i++){
      p.state='explore';p.ambush=false;
      p.enemies.forEach(e=>{e.hp=99999;e.sleep=0;});
      p.members.forEach(id=>{const a=S.adv[id];a.hp=a.mhp;a.mp=0;a.status='party';});
      const n0=said.length;
      combat(S,p);
      swung=said.slice(n0).some(t=>/おそいかかった|こうげきを/.test(t));
    }
    plog=orig;render();
    const crystal=document.querySelector('.crystal');
    return {head:crystal.querySelector('.c-head').textContent,log:crystal.querySelector('.c-log').textContent,said,swung};
  });
  assert.match(text.head,/坑道B13F 戦闘中|坑道B13F 帰還中|坑道B13F 探索中/);
  assert.match(text.log,/坑道都市の衛兵/);
  assert.ok(text.said.some(t=>/おそいかかった|かわした/.test(t)),text.said.join('\n'));
  assert.ok(text.said.every(t=>!t.includes('ほのおを はいた')),text.said.join('\n'));
  assert.deepEqual(errors,[]);await ctx.close();
});

test('酒場の掲示は段ごとに開き、見込みの人数も段で変わる',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.locator('button[data-v="bar"]').click();
  const empty=await page.locator('#tbody').innerText();
  assert.match(empty,/掲示板はまだ空だ/);
  assert.match(empty,/最初の返済の日を迎えていない店に、頼みごとを持ち込む者はいない/);
  assert.doesNotMatch(empty,/見込んだ者/);
  assert.doesNotMatch(empty,/浅い頼みごと/);
  assert.equal(await page.locator('button[data-act="boardhelp"]').count(),0);
  await page.locator('button[data-v="rank"]').click();
  assert.doesNotMatch(await page.locator('#tbody').innerText(),/地上の話の筋/);
  await page.locator('button[data-v="roster"]').click();
  await page.locator('#tbody .nm-link').first().click();
  assert.equal(await page.locator('#advbox button[data-act="mark"]').count(),0);
  await page.locator('#advbox button[data-act="closeadv"]').click();
  await page.evaluate(()=>{
    const E=errandsOf(S);E.stage=1;E.stage1At=S.tick;
    E.board=[{id:900,k:'kitten',n:'迷い込んだ子猫',from:'黒猫亭の厨房',t:'店の黒猫の子が、大穴に落ちた',f:2,until:S.tick+TICKS_PER_DAY*10,hero:null,refused:[],tk:S.tick}];
    tab='bar';render();
  });
  const s1=await page.locator('#tbody').innerText();
  assert.match(s1,/1 \/ 1/);
  assert.match(s1,/いまは浅い頼みごとだけ。名が上がれば、もっと持ち込まれる。/);
  assert.match(s1,/迷い込んだ子猫/);
  assert.doesNotMatch(s1,/見込んだ者/);
  assert.equal(await page.locator('button[data-act="boardhelp"]').getAttribute('aria-expanded'),'false');
  assert.doesNotMatch(s1,/店主が決めるのは/);
  await page.locator('button[data-v="roster"]').click();
  await page.locator('#tbody .nm-link').first().click();
  assert.equal(await page.locator('#advbox button[data-act="mark"]').count(),0);
  await page.locator('#advbox button[data-act="closeadv"]').click();
  const id=await page.evaluate(()=>{
    errandsOf(S).stage=2;
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');
    tab='bar';render();
    return a.id;
  });
  const s2=await page.locator('#tbody').innerText();
  assert.match(s2,/1 \/ 2/);
  assert.match(s2,/見込んだ者　0 \/ 1/);
  assert.match(s2,/見込めるのは、いまは一人だけ。/);
  assert.doesNotMatch(s2,/いまは浅い頼みごとだけ/);
  await page.locator('button[data-v="roster"]').click();
  await page.locator(`#tbody button[data-act="adv"][data-a="${id}"]`).first().click();
  const btn=page.locator('#advbox button[data-act="mark"]');
  assert.equal(await btn.innerText(),'見込む');
  assert.equal(await btn.isDisabled(),false);
  await btn.click();
  assert.equal(await page.locator('#advbox button[data-act="mark"]').innerText(),'見込みを外す');
  await page.locator('#advbox button[data-act="closeadv"]').click();
  const id2=await page.evaluate(first=>{
    return Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired'&&x.id!==first).id;
  },id);
  await page.locator(`#tbody button[data-act="adv"][data-a="${id2}"]`).first().click();
  const btn2=page.locator('#advbox button[data-act="mark"]');
  assert.equal(await btn2.innerText(),'見込む');
  assert.equal(await btn2.isDisabled(),true);
  assert.equal(await page.locator('#advbox .markwhy').innerText(),'見込みは満員（1/1）。誰かの見込みを外すと見込める。');
  await page.locator('#advbox button[data-act="closeadv"]').click();
  await page.evaluate(()=>{
    errandsOf(S).stage=3;S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.tick;
    tab='bar';render();
  });
  const s3=await page.locator('#tbody').innerText();
  assert.match(s3,/1 \/ 3/);
  assert.match(s3,/見込んだ者　1 \/ 3/);
  assert.doesNotMatch(s3,/見込めるのは、いまは一人だけ/);
  await page.locator('button[data-v="rank"]').click();
  assert.match(await page.locator('#tbody').innerText(),/地上の話の筋　封じの門の抜け穴/);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('掲示の主役選びで話を持ちかけると、本人が口調どおりに返し、断った者は選べない。375px・768px・1280pxで崩れない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const ids=await page.evaluate(()=>{
    const T0=S.taverns.ours;T0.debt=0;T0.debtFree=S.tick;const E=errandsOf(S);E.stage=3;E.next=S.tick+99*TICKS_PER_DAY;
    E.board=[{id:900,k:'bell',n:'鐘楼の光',from:'梟の地図屋',t:ERRANDS.find(x=>x.k==='bell').txt(8),f:8,until:S.tick+TICKS_PER_DAY*20,hero:null,refused:[],tk:S.tick}];
    const ours=Object.values(S.adv).filter(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired').slice(0,4);
    const tones=['商人言葉','丁寧','陽気','田舎なまり'];
    ours.forEach((a,i)=>{a.status='idle';a.fear=null;a.traits=[];a.race='人間';a.quirk='無口';a.cls='戦士';a.pers='普通';a.tone=tones[i];});
    ours[0].fear='高い所';ours[1].traits=['俊足'];ours[3].traits=['鈍足'];
    tab='bar';pickErr=900;render();
    return ours.map(a=>a.id);
  });
  for(const id of ids)await page.locator(`button[data-act="ask"][data-a="${id}"]`).click();
  const rows=await page.evaluate(ids=>ids.map(id=>{const b=document.querySelector(`.pick button[data-act="adv"][data-a="${id}"]`);const row=b&&b.closest('.row');
    return {said:row&&row.querySelector('.does.ask')?row.querySelector('.does.ask').textContent:'',chip:row&&row.querySelector('.chip')?row.querySelector('.chip').textContent:'',ask:!!(row&&row.querySelector('[data-act="ask"]')),assign:!!(row&&row.querySelector('[data-act="assign"]'))};}),ids);
  const kinds=await page.evaluate(ids=>ids.map(id=>errandsOf(S).board[0].asked[id].k),ids);
  assert.deepEqual(kinds,['no','keen','vague','balk']);
  rows.forEach((r,i)=>{assert.match(r.said,/^「.+」$/,`${i}の返し`);assert.equal(r.ask,false,`${i}はもう持ちかけられない`);});
  assert.equal(rows[0].chip,'断られた');assert.equal(rows[0].assign,false);
  const said0=await page.evaluate(id=>errandsOf(S).board[0].asked[id].t,ids[0]);
  assert.ok(['堪忍や。鐘楼の光はよそを当たってんか','その話だけはあかん。よそに回してや'].includes(said0),said0);
  assert.equal(rows[0].said,`「${said0}」`);
  rows.slice(1).forEach((r,i)=>assert.equal(r.assign,true,`${i+1}は回せる`));
  const pick=await page.locator('.quote.board .pick').innerText();
  assert.doesNotMatch(pick,/[0-9０-９]+\s*[%％]|向いている|向かない|不向き|確率/);
  // しくじったあとの、返しとつながる土産話も同じ幅で見る
  await page.evaluate(ids=>{const h=S.adv[ids[3]],p=Object.values(S.parties).find(x=>x.tav==='ours');const m=Object.values(S.adv).find(x=>x.tav==='ours'&&x.id!==h.id);
    p.trip=Object.assign(p.trip||{},{askMiss:{id:h.id,who:h.name,n:'鐘楼の光',k:'balk'}});askTale(S,p,[m]);render();},ids);
  assert.match(await page.locator('#tbody').innerText(),/行く前から渋ってた/);
  for(const [width,height] of [[375,740],[768,1024],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready);
    assert.deepEqual(await page.evaluate(screenAudit),[],`${width}px の主役選び`);
  }
  await page.locator('button[data-act="pickerr"][data-e=""]').click();
  assert.match(await page.locator('.quote.board').innerText(),/断った者：/);
  await page.locator('button[data-act="pickerr"][data-e="900"]').click();
  await page.locator(`button[data-act="assign"][data-a="${ids[1]}"]`).click();
  // 一行が迷宮に出ていれば、戻ったときに伝える
  assert.equal(await page.evaluate(()=>{const e=errandsOf(S).board[0];return e.hero||e.pend;}),ids[1]);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('見込みが満員のときは理由が読め、見込むボタンはどの幅でも44px以上',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const ids=await page.evaluate(()=>{
    errandsOf(S).stage=2;
    const ours=Object.values(S.adv).filter(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');
    tab='bar';render();
    return ours.map(a=>a.id);
  });
  assert.ok(ids.length>=4,'常連が4人未満');
  const help=page.locator('button[data-act="boardhelp"]');
  assert.equal(await help.getAttribute('aria-expanded'),'false');
  assert.doesNotMatch(await page.locator('#tbody').innerText(),/店主が決めるのは/);
  await help.click();
  assert.equal(await help.getAttribute('aria-expanded'),'true');
  assert.match(await page.locator('#tbody .note').filter({hasText:'店主が決めるのは'}).innerText(),/店主が決めるのは、話を誰に回すかだけ。向き不向きは話の文面ににじむ。手帳を開いて、怖いものや得意不得意、出身と照らし合わせること。話が伝わるのは、主役が酒場にいて、一行が街で休んでいるとき。迷宮に出ている者を選んでおけば、戻ったときに伝える。/);
  await page.evaluate(()=>render());
  assert.equal(await page.locator('button[data-act="boardhelp"]').getAttribute('aria-expanded'),'true');
  assert.match(await page.locator('#tbody').innerText(),/戻ったときに伝える/);
  const saved=await page.evaluate(()=>{save();return JSON.parse(localStorage.getItem('kuroneko-tavern-v1'));});
  assert.equal(saved.boardHelpOpen,undefined);
  assert.equal(saved.S.boardHelpOpen,undefined);
  assert.equal(saved.S.v,await page.evaluate('SAVE_V'));
  await page.reload();
  await page.locator('#sp0').click();
  await page.locator('button[data-v="bar"]').click();
  assert.equal(await page.locator('button[data-act="boardhelp"]').getAttribute('aria-expanded'),'false');
  assert.doesNotMatch(await page.locator('#tbody').innerText(),/店主が決めるのは/);
  const look=async width=>{
    await page.setViewportSize({width,height:width===375?740:800});
    await page.evaluate(()=>document.fonts.ready);
    return page.evaluate(()=>{
      const bad=[];
      const line=document.querySelector('.markline');
      const note=document.querySelector('#tbody .note');
      if(!line)bad.push('見込みの行がない');
      else{
        const lc=getComputedStyle(line),nc=getComputedStyle(note),bc=getComputedStyle(document.body);
        if(lc.color!==bc.color)bad.push('見込みの行が地の色でない '+lc.color);
        if(note&&lc.color===nc.color)bad.push('見込みの行が注釈と同じ色');
        if(note&&parseFloat(lc.fontSize)<=parseFloat(nc.fontSize))bad.push('見込みの行が注釈より大きくない');
        if(!line.textContent.includes('見込んだ者　0 / 1'))bad.push('見込みの行 '+line.textContent);
        const lr=line.getBoundingClientRect();
        if(lr.right>innerWidth+1||lr.left<0)bad.push('見込みの行がはみ出す');
      }
      const btn=document.querySelector('button[data-act="boardhelp"]');
      const br=btn.getBoundingClientRect();
      if(innerWidth<=640&&(br.width<44||br.height<44))bad.push(`話の回し方 ${Math.round(br.width)}×${Math.round(br.height)}`);
      const box=btn.parentElement.getBoundingClientRect().height;
      if(box>72)bad.push('閉じた説明が高い '+Math.round(box));
      return bad;
    });
  };
  assert.deepEqual(await look(1280),[],'1280 の掲示');
  assert.deepEqual(await look(375),[],'375 の掲示');
  const book=async(width,id)=>{
    if(await page.locator('#advm').isVisible())await page.locator('#advbox button[data-act="closeadv"]').click();
    await page.setViewportSize({width,height:width===375?740:800});
    await page.locator('button[data-v="roster"]').click();
    await page.locator(`#tbody button[data-act="adv"][data-a="${id}"]`).first().click();
    await page.evaluate(()=>document.fonts.ready);
    const got=await page.evaluate(()=>{
      const bad=[];
      const b=document.querySelector('#advbox button[data-act="mark"]');
      const why=document.querySelector('#advbox .markwhy');
      if(!b)bad.push('見込むボタンがない');
      else{
        const r=b.getBoundingClientRect();
        if(r.width<44||r.height<44)bad.push(`${b.innerText} ${Math.round(r.width)}×${Math.round(r.height)}`);
        const box=document.querySelector('#advbox').getBoundingClientRect();
        if(r.top<box.top-1||r.bottom>box.bottom+1||r.left<0||r.right>innerWidth+1)bad.push('ボタンが画面の外');
      }
      if(why){
        const wc=getComputedStyle(why),bc=getComputedStyle(document.body);
        if(wc.color!==bc.color)bad.push('理由の色 '+wc.color);
        if(parseFloat(wc.opacity)<1)bad.push('理由が薄い');
        if(parseFloat(wc.fontSize)<13)bad.push('理由が小さい');
        const wr=why.getBoundingClientRect();
        const box=document.querySelector('#advbox').getBoundingClientRect();
        if(wr.height<16)bad.push('理由の高さ');
        if(wr.top<box.top-1||wr.bottom>Math.min(box.bottom,innerHeight)+1)bad.push('理由が読める範囲の外');
        if(wr.left<0||wr.right>innerWidth+1)bad.push('理由が横にはみ出す');
      }
      return {bad,text:b?b.innerText:'',disabled:!!(b&&b.disabled),why:why?why.textContent:''};
    });
    return got;
  };
  let got=await book(1280,ids[0]);
  assert.deepEqual(got.bad,[],'1280 で見込める');
  assert.equal(got.text,'見込む');
  assert.equal(got.disabled,false);
  assert.equal(got.why,'');
  await page.locator('#advbox button[data-act="mark"]').click();
  assert.equal(await page.locator('#advbox button[data-act="mark"]').innerText(),'見込みを外す');
  assert.equal(await page.locator('#advbox .markwhy').count(),0);
  const unmark=await book(1280,ids[0]);
  assert.equal(unmark.text,'見込みを外す');
  assert.equal(unmark.disabled,false);
  assert.deepEqual(unmark.bad,[],'1280 で外す');
  await page.locator('#advbox button[data-act="closeadv"]').click();
  for(const width of [1280,375]){
    got=await book(width,ids[1]);
    assert.deepEqual(got.bad,[],width+' で満員');
    assert.equal(got.text,'見込む');
    assert.equal(got.disabled,true);
    assert.equal(got.why,'見込みは満員（1/1）。誰かの見込みを外すと見込める。');
    await page.locator('#advbox button[data-act="closeadv"]').click();
  }
  await page.evaluate(list=>{
    errandsOf(S).stage=3;
    list.slice(1,3).forEach(id=>markAdv(S,S.adv[id],true));
    render();
  },ids);
  got=await book(375,ids[3]);
  assert.deepEqual(got.bad,[],'375 で段3が満員');
  assert.equal(got.disabled,true);
  assert.equal(got.why,'見込みは満員（3/3）。誰かの見込みを外すと見込める。');
  await page.locator('#advbox button[data-act="closeadv"]').click();
  got=await book(1280,ids[0]);
  assert.equal(got.text,'見込みを外す');
  assert.equal(got.why,'');
  assert.deepEqual(got.bad,[],'1280 で見込んだ者');
  assert.deepEqual(errors,[]);await ctx.close();
});

test('深手の者は水晶と札で赤くなり、撤退の横に一言出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const bad=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.state='explore';p.floor=4;p.enemies=null;p.plan='normal';p.pushWhy=null;
    const ms=p.members.map(id=>S.adv[id]);
    ms.forEach(a=>{a.status='party';a.hp=a.mhp=100;a.poison=0;a.mp=5;});
    const L=S.adv[p.leader];L.pers='普通';
    const hurt=ms.find(a=>a.id!==p.leader);
    const low=ms.find(a=>a!==hurt&&a.id!==p.leader);
    const half=ms.find(a=>a!==hurt&&a!==low&&a.id!==p.leader);
    hurt.mhp=12;hurt.hp=1;hurt.poison=1;
    low.mhp=100;low.hp=30;
    half.mhp=100;half.hp=50;
    S.watch[0]=p.id;S.sel=0;
    const news=S.news.map(n=>n.t).join('\n');
    render();
    const out=[];
    const crit=document.querySelector('.c-members .m.crit');
    const amber=document.querySelector('.c-members .m.low');
    if(!crit||!crit.textContent.includes(hurt.name)||!crit.textContent.includes('深手')||!crit.textContent.includes('毒'))out.push('深手の行 '+ (crit&&crit.textContent));
    if(crit&&crit.querySelector('.wound')&&crit.querySelector('.nm-link').textContent!==hurt.name)out.push('深手が名前のボタンに入っている');
    if(!amber||!amber.textContent.includes(low.name)||amber.textContent.includes('深手'))out.push('35%未満の行 '+ (amber&&amber.textContent));
    const cc=crit&&getComputedStyle(crit).color,ac=amber&&getComputedStyle(amber).color;
    if(!cc||!ac||cc===ac)out.push('深手と少ない者の色が分かれていない');
    const warn=document.querySelector('.c-warn');
    if(!warn||warn.dataset.k!=='wound'||!warn.textContent.includes(hurt.name+'が ふかでを おっている'))out.push('撤退の横 '+ (warn&&warn.textContent));
    if(warn&&warn.querySelector('.thought'))out.push('普通のリーダーに考えが出た');
    if(warn&&warn.querySelector('.fight'))out.push('戦いの注が先に出た');
    const card=[...document.querySelectorAll('.pcard')].find(el=>el.dataset.p==p.id);
    const st=card&&card.querySelector('.st');
    if(!st||!st.classList.contains('bad')||!st.textContent.includes('B4F 探索中・深手の者がいる'))out.push('札 '+ (st&&st.textContent));
    const names=[...card.querySelectorAll('.who .nm')].map(el=>el.textContent.replace('★',''));
    const colors=[...card.querySelectorAll('.hpstrip i')].map(el=>el.style.getPropertyValue('--c').trim());
    const want=a=>a.hp<=0?'var(--ash)':a.hp<a.mhp*.2?'var(--blood)':a.hp/a.mhp<.35?'var(--amber)':'var(--heal)';
    const byName=Object.fromEntries(ms.map(a=>[a.name,a]));
    if(names.length!==colors.length)out.push('帯の数');
    names.forEach((n,i)=>{const a=byName[n];if(a&&colors[i]!==want(a))out.push(`${n} の帯 ${colors[i]}（${a.hp}/${a.mhp}）`);});
    if(S.news.map(n=>n.t).join('\n')!==news)out.push('日報が増えた');
    if(news.includes('ふかで')||news.includes('深手の者がいる'))out.push('日報に危険が出た');
    L.pers='無謀';p.enemies=[{hp:3}];render();
    const w2=document.querySelector('.c-warn');
    if(!w2||!w2.querySelector('.thought')||!w2.textContent.includes('リーダーは ひきかえす きが ない'))out.push('無謀の考え '+ (w2&&w2.textContent));
    if(!w2||!w2.querySelector('.fight')||!w2.textContent.includes('たたかいの さいちゅう'))out.push('戦いの注 '+ (w2&&w2.textContent));
    const st2=[...document.querySelectorAll('.pcard')].find(el=>el.dataset.p==p.id).querySelector('.st');
    if(!st2.textContent.includes('戦闘中・深手の者がいる'))out.push('戦闘中の札 '+st2.textContent);
    p.state='return';p.enemies=null;render();
    if(document.querySelector('.c-warn'))out.push('帰還中なのに水晶の一言が残った');
    const st3=[...document.querySelectorAll('.pcard')].find(el=>el.dataset.p==p.id).querySelector('.st');
    if(!st3.textContent.includes('帰還中・深手の者がいる'))out.push('帰還中の札 '+st3.textContent);
    if(st3.classList.contains('bad')||!st3.classList.contains('ret'))out.push('帰還中の札が琥珀でない '+st3.className);
    const amberC=getComputedStyle(document.querySelector('.tag.ours')).color;
    const s3=getComputedStyle(st3);
    if(s3.color!==amberC)out.push('帰還中の札の色 '+s3.color);
    if(s3.animationName!=='none'||s3.transitionDuration.split(',').some(t=>parseFloat(t)>0))out.push('帰還中の札が動く');
    const save=ms.map(a=>a.hp);
    ms.forEach(a=>{if(a!==hurt)a.hp=Math.floor(a.mhp*.1);});render();
    const st4=[...document.querySelectorAll('.pcard')].find(el=>el.dataset.p==p.id).querySelector('.st');
    if(!st4.classList.contains('bad')||!st4.textContent.includes('帰還中・深手の者がいる'))out.push('全滅が近い帰還中の札 '+st4.className+' '+st4.textContent);
    ms.forEach((a,i)=>{a.hp=save[i];});
    p.enemies=[{hp:3}];render();
    const st5=[...document.querySelectorAll('.pcard')].find(el=>el.dataset.p==p.id).querySelector('.st');
    if(!st5.classList.contains('bad')||!st5.textContent.includes('戦闘中・深手の者がいる'))out.push('帰り道の戦闘の札 '+st5.className+' '+st5.textContent);
    p.enemies=null;render();
    return out;
  });
  assert.deepEqual(bad,[]);
  await page.setViewportSize({width:390,height:844});
  const narrow=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.state='explore';p.enemies=null;S.adv[p.leader].pers='普通';render();
    const out=[];
    const b=document.querySelector('.c-foot .btn');
    if(!b)out.push('撤退のボタンがない');
    else{const r=b.getBoundingClientRect();if(r.width<44||r.height<44)out.push(`撤退 ${Math.round(r.width)}×${Math.round(r.height)}`);}
    const w=document.querySelector('.c-warn');
    if(!w||!w.textContent.includes('ふかでを おっている'))out.push('狭い画面で一言がない');
    if(document.documentElement.scrollWidth>innerWidth+1)out.push('ページが横にはみ出す');
    return out;
  });
  assert.deepEqual(narrow,[]);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('375pxでは水晶の一言が語の途中で折れず、稼ぎは別の行に出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const prep=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.state='explore';p.floor=4;p.enemies=[{hp:3}];p.plan='normal';p.pushWhy=null;p.loot=299;
    const ms=p.members.map(id=>S.adv[id]);
    ms.forEach(a=>{a.status='party';a.hp=a.mhp=100;a.poison=0;a.mp=5;});
    S.adv[p.leader].pers='普通';
    const hurt=ms.find(a=>a.id!==p.leader);
    hurt.mhp=12;hurt.hp=1;
    S.taverns.ours.gold=1000;
    S.watch[0]=p.id;S.sel=0;
    render();
    return p.id;
  });
  const measure=async()=>{
    await page.evaluate(()=>document.fonts.ready);
    return page.evaluate(()=>{
      const bad=[];
      const warn=document.querySelector('.c-warn');
      const fight=warn&&warn.querySelector('.fight');
      const loot=document.querySelector('.c-loot');
      const foot=document.querySelector('.c-foot');
      if(!warn||!fight||!fight.textContent.includes('たたかいの さいちゅう。いま めいじても にげきれるとは かぎらない'))bad.push('戦いの一言がない '+(warn&&warn.textContent));
      if(!loot||loot.textContent!=='稼ぎ 299G')bad.push('稼ぎがない '+(loot&&loot.textContent));
      const runs=(el)=>{
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
        const re=/[0-9A-Za-zぁ-んァ-ヶ一-龥ー]+/g;
        let node;
        while((node=walker.nextNode())){
          const text=node.textContent;
          let m;
          while((m=re.exec(text))){
            const range=document.createRange();
            range.setStart(node,m.index);range.setEnd(node,m.index+m[0].length);
            const rects=[...range.getClientRects()].filter(r=>r.width>.5);
            const tops=new Set(rects.map(r=>Math.round(r.top)));
            const width=rects.reduce((s,r)=>s+r.width,0);
            const box=node.parentElement.getBoundingClientRect().width;
            if(tops.size>1&&width<=box+1)bad.push('語の途中で折れている '+m[0]);
          }
        }
      };
      if(warn)runs(warn);
      if(loot&&warn&&foot){
        const range=document.createRange();range.selectNodeContents(loot);
        const lr=range.getBoundingClientRect(),wr=warn.getBoundingClientRect(),fr=foot.getBoundingClientRect();
        const narrow=innerWidth<=640;
        if(narrow){
          if(lr.top<wr.bottom-1)bad.push('稼ぎが一言と同じ行');
          if(fr.right-lr.right>20)bad.push('稼ぎが右端にない '+Math.round(fr.right-lr.right));
        }else{
          const btn=foot.querySelector('.btn').getBoundingClientRect();
          if(!(lr.bottom>btn.top+1&&lr.top<btn.bottom-1))bad.push('広い画面で稼ぎがボタンの行にない');
          if(fr.right-lr.right>20)bad.push('稼ぎが右端にない '+Math.round(fr.right-lr.right));
        }
      }
      if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
      return bad;
    });
  };
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    assert.deepEqual(await measure(),[],`${width}px`);
  }
  assert.equal(prep>0,true);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('全滅と依頼の失敗には理由が一文つき、知れていない全滅は札も手帳も探索中のまま、消息不明の知らせに死因と階は入らない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const info=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.state='explore';p.floor=4;p.enemies=null;p.plan='normal';p.pushWhy=null;p.steps=400;
    p.trip=p.trip||{};p.trip.deep=1;p.maps={};p.announced=false;p.knownWiped=false;
    // 到達B2Fで出発し、探索中にB4Fまで進んだ（ふつうに起きる状態）
    p.reach=2;p.pushTo=0;p.mineTrip=false;noteKnownDepth(p);reachFloor(S,p,false);
    const ms=p.members.map(id=>S.adv[id]);
    ms.forEach(a=>{a.status='party';a.hp=a.mhp=100;a.poison=0;a.mp=5;a.pers='普通';a.quirk='無口';a.fear=null;a.traits=[];a.cls='戦士';});
    render();
    const card=()=>[...document.querySelectorAll('.pcard')].find(el=>el.dataset.p==String(p.id));
    const st=card().querySelector('.st');
    const out=[];
    if(!st||!st.classList.contains('bad')||!st.textContent.includes('探索中')||!st.textContent.includes('まだ戻らない'))out.push('遅れの札 '+(st&&st.textContent));
    const before=st.textContent;
    const a=S.adv[p.leader];
    const rnd=Math.random;Math.random=()=>0.99;
    errandEvent(S,p,{id:1,k:'kitten',n:'迷い込んだ子猫',f:2,hero:a.id});
    Math.random=rnd;
    ms.forEach(m=>{m.hp=0;m.mp=0;m.cls='戦士';});
    const h=ms[0];h.cls='僧侶';h.mp=0;
    S.watch=[null,null];
    wipe(S,p,'オーク');
    render();
    const st2=card().querySelector('.st');
    // 全滅しても、知れるまでは札の文も色も変わらない
    if(!st2||!st2.classList.contains('bad')||st2.textContent!==before)out.push('全滅直後の札 '+(st2&&st2.textContent)+'（前は '+before+'）');
    // 伏せ中は札を押しても「闇しか映さない」と出ず、水晶に移れる。HP帯も消えない
    const toast0=document.querySelector('.toast');if(toast0)toast0.remove();
    card().click();
    const toast1=(document.querySelector('.toast')||{}).textContent||'';
    if(toast1.includes('闇しか映さない'))out.push('伏せ中に闇しか映さない '+toast1);
    if(!S.watch.includes(p.id))out.push('伏せ中に水晶へ移れない');
    render();
    const strip=card().querySelector('.hpstrip');
    if(!strip)out.push('伏せ中にHP帯が消えた');
    if(strip&&[...strip.querySelectorAll('i')].some(i=>getComputedStyle(i).getPropertyValue('--w').trim()==='0%'))out.push('伏せ中のHP帯が0');
    tab='news';render();
    const news=document.querySelector('#tbody').innerText;
    if(!news.includes('向かなかった'))out.push('日報に失敗の理由がない');
    if(news.includes('癒し手の呪文が尽きていた'))out.push('見ていない全滅の理由が先に出た');
    tab='roster';render();
    const roster=document.querySelector('#tbody').innerText;
    if(roster.includes('行方不明'))out.push('名簿に行方不明が出た');
    if(roster.includes('HP0/')||roster.includes('倒'))out.push('伏せ中の名簿にHP0か倒が出た');
    const chip=[...document.querySelectorAll('#tbody .row')].find(el=>el.querySelector('.nm-link')?.textContent===h.name)?.querySelector('.chip')?.textContent;
    if(chip!=='探索中')out.push('名簿のチップ '+chip);
    advOpen=h.id;document.querySelector('#advm').hidden=false;renderAdv();
    const book=document.querySelector('#advbox').innerText;
    if(book.includes('全滅した。'))out.push('手帳に原因が先に出た');
    if(/B\d+Fで.+に倒れる/.test(book))out.push('手帳に倒れた階が先に出た');
    if(!book.includes('探索中'))out.push('手帳の状態が探索中でない');
    if(book.includes('行方不明'))out.push('手帳に行方不明が出た');
    if(/\b0\/100\b/.test(book)||book.includes('HP\n0'))out.push('手帳にHP0が出た');
    // 予定帰還の刻から MISSING_GRACE 刻たつと消息不明。知らせに死因も階も入らず、札は迷宮とだけ出る
    document.querySelector('#advm').hidden=true;advOpen=null;
    Object.values(S.parties).forEach(q=>{if(q!==p){q.state='town';q.rest=99;}});
    p.dueAt=S.tick-MISSING_GRACE;tick(S);tab='news';render();
    const news2=document.querySelector('#tbody').innerText;
    const line=(S.news.findLast(x=>x.t.includes('予定を過ぎても戻らない'))||{}).t||'';
    if(!line.startsWith(p.name+'が予定を過ぎても戻らない。'))out.push('消息不明の知らせがない '+line);
    if(/B\d+F|癒し手/.test(line))out.push('消息不明の知らせに死因か階が入った '+line);
    const st3=card().querySelector('.st');
    if(!st3||st3.textContent!=='消息不明（迷宮）'||!st3.classList.contains('bad'))out.push('消息不明の札 '+(st3&&st3.textContent));
    const mark=card().querySelector('.roster .who .cls');
    if(!mark||!mark.textContent.includes('不明'))out.push('消息不明の名簿印 '+(mark&&mark.textContent));
    if(mark&&mark.textContent.includes('倒'))out.push('消息不明なのに倒の印 '+mark.textContent);
    // 「不明」の印は、倒れた者の赤とは別の色
    const who=card().querySelector('.roster .who');
    if(!who||!who.classList.contains('gone')||who.classList.contains('down'))out.push('不明の印の色 '+(who&&who.className));
    // 消息不明の札の「到達」に、倒れた階（B4F）を出さない
    if(card().innerText.includes('B4F'))out.push('消息不明の札に倒れた階 '+card().innerText.replace(/\n/g,' '));
    tab='desk';render();
    const desk=document.querySelector('#tbody').innerText;
    if(/消息不明[\s\S]*B4F/.test(desk)&&desk.includes(p.name+' 黒猫亭・B4F'))out.push('帳場の依頼欄に階が出た');
    // 依頼額は倒れた階や、探索中に進んだ最深（B4F）ではなく、出発のときの深さで決まる
    const price=bountyPrice(p),priceFloor=r100(incomeAt(dz(4)));
    if(p.reach!==4)out.push('探索中に最深が進んでいない '+p.reach);
    if(price===priceFloor)out.push('依頼額が倒れた階のまま '+price);
    // 巡回隊が連れ帰ると、死因と階が手帳と知らせに残る
    corpsesHome(S,p,'巡回隊が見つけ、',null);tab='news';render();
    const news3=(S.news.findLast(x=>x.t.includes('遺体が街に届いた'))||{}).t||'';
    if(news3!=='巡回隊が見つけ、'+p.name+'の遺体が街に届いた。B4F、オークに倒れていた。癒し手の呪文が尽きていた。')out.push('届いた知らせがない '+news3);
    advOpen=h.id;document.querySelector('#advm').hidden=false;renderAdv();
    const book2=document.querySelector('#advbox').innerText;
    if(!book2.includes('全滅した。癒し手の呪文が尽きていた'))out.push('届いたあとの手帳に原因がない');
    return {out,pid:p.id,aid:h.id};
  });
  assert.deepEqual(info.out,[]);
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready);
    const bad=await page.evaluate(({pid,aid})=>{
      tab='news';advOpen=aid;document.querySelector('#advm').hidden=false;render();renderAdv();
      const out=[];
      const li=[...document.querySelectorAll('.news li')].find(el=>el.textContent.includes('向かなかった'));
      const span=li&&[...li.children].find(n=>!n.classList.contains('d'));
      const side=document.querySelector('.side').getBoundingClientRect();
      if(!span)out.push('失敗の知らせがない');
      else{
        const r=span.getBoundingClientRect();
        if(r.height<1||r.right>side.right+1||r.left<side.left-1)out.push('知らせが右の列の外');
        if(span.scrollWidth>span.clientWidth+1)out.push('知らせが折れていない');
      }
      const li2=[...document.querySelectorAll('.news li')].find(el=>el.textContent.includes('遺体が街に届いた'));
      const span2=li2&&[...li2.children].find(n=>!n.classList.contains('d'));
      if(!span2)out.push('届いた知らせがない');else if(span2.scrollWidth>span2.clientWidth+1)out.push('届いた知らせが折れていない');
      const row=[...document.querySelectorAll('#advbox .tl li')].find(el=>el.textContent.includes('全滅した。癒し手の呪文が尽きていた'));
      const modal=document.querySelector('#advbox').getBoundingClientRect();
      if(!row)out.push('手帳の行がない');
      else{
        const r=row.getBoundingClientRect();
        if(r.height<1||r.right>modal.right+1||r.left<modal.left-1)out.push('手帳が窓の外');
        if(row.scrollWidth>row.clientWidth+1)out.push('手帳が折れていない');
      }
      if(document.documentElement.scrollWidth>innerWidth+1)out.push('ページが横にはみ出す');
      return out;
    },info);
    assert.deepEqual(bad,[],`${width}px`);
  }
  // 巡回隊の届かない深さで20日見つからないと、消えた者の名が二つ名つきで知らせに並ぶ。375px でも名前は語の途中で折れない
  const lost=await page.evaluate(()=>{
    document.querySelector('#advm').hidden=true;advOpen=null;
    const p=Object.values(S.parties).find(x=>x.tav==='ours'&&x.members.length>=2);
    const ms=p.members.map(id=>S.adv[id]);ms.forEach(a=>{a.status='missing';a.hp=0;a.party=p.id;});
    ms[0].title='牙折り';ms[0].titleKind='kills';ms[0].titleTier=1;ms[0].titleStem='kills';
    const names=ms.map(a=>a.title?`「${a.title}」${a.name}`:a.name);
    Object.assign(p,{state:'wiped',retrieved:false,announced:true,knownWiped:false,wipedAt:S.tick-1001,floor:4,killer:'オーク',cause:'オークに倒れた',causeTold:false,dueAt:S.tick-200});
    S.deepest.ours=1;S.deepest.rival=1;S.watch=[null,null];
    tick(S);
    const n=S.news.findLast(x=>x.t.includes('ついに見つからなかった'));
    return {names,text:n&&n.t,ok:!!n&&n.k==='lost'&&n.t.includes(names.join('、')+'の'+names.length+'人の名が記念碑に刻まれる。')};
  });
  assert.ok(lost.ok,`見つからなかった知らせ ${lost.text}`);
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready);
    const bad=await page.evaluate(names=>{
      tab='news';document.querySelector('#advm').hidden=true;advOpen=null;render();
      const out=[];
      const li=[...document.querySelectorAll('.news li')].find(el=>el.textContent.includes('ついに見つからなかった'));
      const span=li&&[...li.children].find(n=>!n.classList.contains('d'));
      if(!span){out.push('見つからなかった知らせがない');return out;}
      const side=document.querySelector('.side').getBoundingClientRect();
      const r=span.getBoundingClientRect();
      if(r.height<1||r.right>side.right+1||r.left<side.left-1)out.push('知らせが右の列の外');
      if(span.scrollWidth>span.clientWidth+1)out.push('知らせが折れていない');
      for(const name of names){
        const nw=[...span.querySelectorAll('.nw')].find(el=>el.textContent===name);
        if(!nw){out.push(name+' が一続きになっていない');continue;}
        const tops=new Set([...nw.getClientRects()].filter(x=>x.width>1).map(x=>Math.round(x.top)));
        if(tops.size!==1)out.push(name+' が途中で折れている');
      }
      if(document.documentElement.scrollWidth>innerWidth+1)out.push('ページが横にはみ出す');
      return out;
    },lost.names);
    assert.deepEqual(bad,[],`${width}px 見つからなかった知らせ`);
  }
  assert.deepEqual(errors,[]);await ctx.close();
});

test('便りは青く出て、記念碑と手帳に残る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const info=await page.evaluate(()=>{
    const ours=Object.values(S.adv).filter(a=>a.tav==='ours').sort((a,b)=>a.id-b.id);
    const a=ours[0],b=ours[1],c=ours[2];
    a.trips=5;a.favor=2;a.status='idle';a.party=null;a.tav='ours';
    b.status='idle';b.party=null;b.eq={};b.tav='ours';
    ours.forEach(x=>{if(x!==a&&x!==b)x.status='party';});
    const k=a.id<b.id?`${a.id}-${b.id}`:`${b.id}-${a.id}`;
    S.bonds=S.bonds||{};S.bonds[k]={n:4,ev:[{tk:1,t:'一緒に潜った'}]};
    a.pastDreams=[{k:'marry',who:'故郷で待つ幼なじみ',t:'幼なじみと所帯を持つ',tk:1}];
    retire(S,a,'所帯を持つ');
    S.tick=Math.ceil(a.nextLetter/TICKS_PER_DAY)*TICKS_PER_DAY;letterTick(S);
    c.trips=4;c.status='lost';c.tav='ours';c.lastBy='オーク';
    S.rares=S.rares||{};S.rares[1]={killed:{party:'夜明け団',tav:'ours',names:[c.name],by:c.name,tk:1}};
    memorialize(S,c,{by:'オーク',floor:3});
    S.taverns.ours.seats=36;S.tick=Math.ceil(S.tick/TICKS_PER_DAY)*TICKS_PER_DAY;
    c.kinDue={tk:S.tick,kind:'lost'};kinTick(S);
    const kin=Object.values(S.adv).find(x=>x.kin&&x.kin.id===c.id);
    tab='stone';render();
    return {aid:a.id,cid:c.id,kid:kin&&kin.id,kname:kin&&kin.name,line:(a.letters||[]).slice(-1)[0]&&a.letters.slice(-1)[0].line,rare:(S.memorial.find(m=>m.id===c.id)||{}).rares};
  });
  assert.ok(info.line,'便りが届いていない');
  assert.ok(info.kid,'弟妹が来ていない');
  assert.ok(info.rare&&info.rare.includes('ドブ王'),`記念碑の魔物 ${info.rare}`);
  // 3回以上潜った常連が店を去ったので、ひと幕が出る。閉じてから先へ進む
  await closeLife(page);
  await page.locator('button[data-v="news"]').click();
  const letter=page.locator('.news .letter').filter({hasText:'【便り】'}).first();
  await letter.scrollIntoViewIfNeeded();
  const color=await letter.evaluate(el=>getComputedStyle(el).color);
  assert.equal(color,'rgb(143, 180, 201)');
  assert.match(await letter.innerText(),/【便り】/);
  assert.doesNotMatch(await letter.innerText(),/為替|紹介状/);
  await page.locator('button[data-v="stone"]').click();
  const stone=await page.locator('#tbody').innerText();
  assert.match(stone,new RegExp(`日目の便り：「${info.line.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}」`));
  assert.match(stone,/名のある魔物「ドブ王」を討った者/);
  await page.evaluate(id=>{advOpen=id;document.getElementById('advm').hidden=false;document.getElementById('advbox').scrollTop=0;renderAdv();},info.kid);
  const book=await page.locator('#advbox').innerText();
  assert.match(book,/続柄は/);
  assert.match(book,/の手帳/);
  assert.match(book,/まだ迷宮に潜っていない/);
  assert.doesNotMatch(book,/B0F/);
  const other=await page.evaluate(()=>{
    const kin=S.adv[advOpen];
    kin.dream={k:'kinvenge',m:'ドブ王',elder:'兄',who:'親'};
    renderAdv();
    const prog=document.getElementById('advbox').innerText;
    kin.status='idle';kin.party=null;checkDream(S,kin);
    const told=(S.news||[]).slice(-1)[0];
    return {prog,dream:kin.dream,past:(kin.pastDreams||[]).some(d=>d.k==='kinvenge'),news:told&&told.t};
  });
  assert.match(other.prog,/仇は別の者に討たれた/);
  assert.equal(other.dream,null);
  assert.ok(other.past);
  assert.match(other.news,/別の者に討たれていた/);
  assert.doesNotMatch(other.news,/を討った/);
  await page.locator('#advbox .nm-link').click();
  const parent=await page.locator('#advbox').innerText();
  assert.match(parent,new RegExp(`${info.kname}（.+）が黒猫亭に来た`));
  assert.match(parent,/ロスト/);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('375pxの記念碑は地の文を「」に入れず、言葉の終わりを1文字だけ残さない。仇を見届けた夢と、手帳の続柄の押し幅',async()=>{
  const {ctx,page,errors}=await open();
  await page.setViewportSize({width:375,height:740});
  await page.locator('#sp0').click();
  const info=await page.evaluate(()=>{
    const ours=Object.values(S.adv).filter(a=>a.tav==='ours').sort((a,b)=>a.id-b.id);
    const [a,b,c]=ours;
    for(const x of [a,b]){x.trips=5;x.status='idle';x.party=null;x.tav='ours';}
    retire(S,a,'大陸をめぐる旅に出る');
    S.tick=Math.ceil(a.nextLetter/TICKS_PER_DAY)*TICKS_PER_DAY;letterTick(S);
    const first=(S.news||[]).filter(n=>n.t.startsWith('【便り】')).slice(-1)[0];
    retire(S,b,'剣を置いて故郷の村で隠居する');
    // 古い記録。印のない潮の便り
    c.trips=5;c.tav='ours';c.status='idle';c.party=null;retire(S,c,'海を渡って東方の島国アズマへ向かう');
    c.letters=[{tk:S.tick,n:1,line:'潮で字が半分にじんでいる'}];
    tab='stone';render();
    return {aid:a.id,bid:b.id,cid:c.id,first:first&&first.t};
  });
  assert.ok(info.first,'1通目が届いていない');
  assert.doesNotMatch(info.first,/前の便りと違う/);
  const eps=await page.evaluate(({ids,bid})=>{
    const epOf=id=>{const s=[...document.querySelectorAll('.stone')].find(el=>el.querySelector(`[data-a="${id}"]`));return s&&[...s.querySelectorAll('.ep')].slice(-1)[0];};
    // 最後の行に入っている字。テキストノードを1字ずつ見る
    const tailOf=ep=>{
      const tops=[];const w=document.createTreeWalker(ep,NodeFilter.SHOW_TEXT);const chars=[];
      for(let n=w.nextNode();n;n=w.nextNode())for(let i=0;i<n.length;i++){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const rr=r.getBoundingClientRect();if(rr.width){chars.push([Math.round(rr.top),n.data[i]]);tops.push(Math.round(rr.top));}}
      const last=Math.max(...tops);const rows=new Set(tops.map(t=>Math.round(t/4))).size;
      return {rows,tail:chars.filter(([t])=>Math.abs(t-last)<=2).map(([,c])=>c).join('')};
    };
    const out={a:epOf(ids[0]).innerText,c:epOf(ids[1]).innerText,short:[]};
    // 長さを変えて、どの長さでも最後の行が「る」」だけにならない
    const b=S.adv[bid];
    for(let k=0;k<=40;k++){
      b.letters=[{tk:S.tick,n:1,line:'膝が痛む日は、'+'迷'.repeat(k)+'宮の階段を思い出している'}];render();
      const r=tailOf(epOf(bid));
      if(r.rows>=2&&r.tail.length<4)out.short.push(`${k}:${r.tail}`);
    }
    return out;
  },{ids:[info.aid,info.cid],bid:info.bid});
  assert.match(eps.a,/^\d+日目の便り（ベルクラントの鉱山町から）$/);
  assert.doesNotMatch(eps.a,/「/);
  assert.match(eps.c,/^\d+日目の便り（セーレの港から）$/);
  assert.deepEqual(eps.short,[]);
  const book=await page.evaluate(()=>{
    const ours=Object.values(S.adv).filter(a=>a.tav==='ours'&&a.status!=='retired'&&a.status!=='lost').sort((a,b)=>a.id-b.id);
    const c=ours[0];c.trips=4;c.status='lost';c.lastBy='オーク';
    S.rares=S.rares||{};S.rares[1]={killed:{party:'夜明け団',tav:'rival',names:['別人'],by:'別人',tk:1}};
    memorialize(S,c,{by:'ドブ王',floor:3});
    S.taverns.ours.seats=40;S.tick=Math.ceil(S.tick/TICKS_PER_DAY)*TICKS_PER_DAY;
    c.kinDue={tk:S.tick,kind:'lost'};kinTick(S);
    const kin=Object.values(S.adv).find(x=>x.kin&&x.kin.id===c.id);
    kin.dream={k:'kinvenge',m:'ドブ王',elder:'兄',who:'親'};kin.status='idle';kin.party=null;checkDream(S,kin);
    advOpen=kin.id;document.getElementById('advm').hidden=false;renderAdv();
    const box=document.getElementById('advbox');
    const link=box.querySelector('.note .nm-link');const note=link&&link.closest('.note');
    const lr=link.getBoundingClientRect();
    const lh=parseFloat(getComputedStyle(note).lineHeight)||0;
    return {text:box.innerText,h:lr.height,w:lr.width,noteH:note.getBoundingClientRect().height,lh};
  });
  assert.match(book.text,/見届けた夢・/);
  assert.doesNotMatch(book.text,/かなえた夢・/);
  assert.ok(book.h>=44,`続柄のリンクの押し幅 ${Math.round(book.w)}×${Math.round(book.h)}`);
  assert.ok(book.noteH<30,`続柄の行が高くなった ${book.noteH}`);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('375pxと1280pxでは所属の札が行に収まり、名簿と日報と地図は語の途中で折れない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const cast=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours'&&x.members&&x.members.length);
    if(!p)return null;
    p.name='ナジュム・ドラコ';
    const leader=S.adv[p.leader];
    const other=Object.values(S.adv).find(a=>a.tav==='ours'&&a.id!==leader.id&&a.status!=='lost');
    other.race='ドワーフ';other.cls='聖騎士';other.sex='女';other.age=90;other.status='idle';other.party=null;
    p.members=p.members.filter(id=>id!==other.id);
    S.farewells=S.farewells||[];
    S.farewells.push({id:other.id,name:other.name,cls:'聖騎士',lvl:21,race:'ドワーフ',sex:'女',age:90,hage:23,tav:'ours',tk:S.tick,why:'夢を果たした'});
    const F=floorsInit(S);F[1].map=true;F[1].sold=12;
    render();
    const opening=Object.values(S.adv).filter(a=>a.opening);
    return {names:opening.map(a=>a.name),origins:[...new Set(opening.map(a=>a.origin))]};
  });
  assert.ok(cast,'黒猫亭の一行がない');
  const measure=info=>page.evaluate(info=>{
    const bad=[];
    const lines=node=>{
      const range=document.createRange();range.selectNodeContents(node);
      return new Set([...range.getClientRects()].filter(r=>r.width>1).map(r=>Math.round(r.top))).size;
    };
    const tags=[...document.querySelectorAll('#tbody .ptag')];
    if(info.part==='roster'){
      if(!tags.length)bad.push('所属の札がない');
      const side=document.querySelector('.side').getBoundingClientRect();
      for(const tag of tags){
        const row=tag.closest('.row')||tag.parentElement;
        const tr=tag.getBoundingClientRect(),rr=row.getBoundingClientRect();
        if(tr.width<8||tr.height<8)bad.push('札が潰れている '+tag.textContent);
        if(tr.right>rr.right+1||tr.left<rr.left-1)bad.push('札が行からはみ出す '+tag.textContent);
        if(tr.right>side.right+1)bad.push('札が右の列からはみ出す '+tag.textContent);
        if(lines(tag)!==1)bad.push('札が折れている '+tag.textContent);
        if(tag.title!==tag.textContent)bad.push('札の全文が違う '+tag.title+' / '+tag.textContent);
      }
      const lead=tags.find(t=>t.textContent.includes('ナジュム・ドラコ'));
      if(!lead||!lead.textContent.includes('明星の竜')||!lead.textContent.includes('のリーダー'))bad.push('長い所属の札がない '+(lead&&lead.textContent));
      for(const nw of document.querySelectorAll('#tbody .meta .nw')){
        if(lines(nw)!==1)bad.push(nw.textContent+' が折れている');
      }
      if(![...document.querySelectorAll('#tbody .meta')].some(el=>el.textContent.includes('歳相当')&&el.textContent.includes('聖騎士')))bad.push('名簿に歳相当と聖騎士がない');
    }
    if(info.part==='news'){
      const li=[...document.querySelectorAll('.news li')].find(el=>el.textContent.includes('最初の客たち'));
      if(!li)bad.push('最初の客たちがない');
      else{
        if(li.querySelector('.nm-link,.nm-head,button'))bad.push('名前がボタンになっている');
        const span=[...li.children].find(n=>!n.classList.contains('d'));
        const nws=[...span.querySelectorAll('.nw')];
        for(const name of info.names){
          const el=nws.find(n=>n.textContent===name);
          if(!el)bad.push(name+' がまとまっていない');
          else if(lines(el)!==1)bad.push(name+' が折れている');
        }
        for(const origin of info.origins){
          const el=nws.find(n=>n.textContent===origin);
          if(!el)bad.push(origin+' がまとまっていない');
          else if(lines(el)!==1)bad.push(origin+' が折れている');
        }
        const shop=nws.find(n=>n.textContent==='黒猫亭');
        if(!shop)bad.push('黒猫亭がまとまっていない');
        else if(lines(shop)!==1)bad.push('黒猫亭が折れている');
      }
    }
    if(info.part==='stone'){
      const s=[...document.querySelectorAll('.stone')].find(el=>el.textContent.includes('23歳相当'));
      if(!s)bad.push('記念碑に23歳相当がない');
      else{
        for(const nw of s.querySelectorAll('.nw'))if(lines(nw)!==1)bad.push(nw.textContent+' が折れている');
        if(!s.textContent.includes('ドワーフの聖騎士'))bad.push('記念碑の職業が欠けている');
      }
    }
    if(info.part==='maps'){
      const sold=[...document.querySelectorAll('.nw')].find(el=>el.textContent==='・12部');
      if(!sold)bad.push('12部がない');
      else if(lines(sold)!==1)bad.push('12部が折れている');
      const cell=sold&&(sold.closest('td')||sold.parentElement);
      if(sold&&cell&&sold.getBoundingClientRect().right>cell.getBoundingClientRect().right+1)bad.push('部がマスからはみ出す');
    }
    if(info.part==='desk'){
      const row=document.querySelector('.row.debt');
      if(!row)bad.push('借金の行がない');
      else{
        const label=row.querySelector('b'),rep=row.querySelector('.does'),btn=row.querySelector('button');
        if(lines(label)!==1)bad.push('借金の残りが折れている');
        if(lines(rep)!==1)bad.push('これまでに返した額が折れている');
        const stacked=btn.getBoundingClientRect().top>=label.getBoundingClientRect().bottom-1;
        if((innerWidth<=640||innerWidth>900)&&!stacked)bad.push('返済ボタンが見出しの横にある');
        if(innerWidth>640&&innerWidth<=900&&stacked)bad.push('返済ボタンが見出しの下にある');
        const side=document.querySelector('.side').getBoundingClientRect();
        if(btn.getBoundingClientRect().right>side.right+1)bad.push('返済ボタンが右の列からはみ出す');
      }
    }
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    return bad;
  },info);
  for(const width of [375,390,768,1280]){
    await page.setViewportSize({width,height:width>=768?900:812});
    await page.evaluate(()=>document.fonts.ready);
    for(const part of ['roster','news','stone','maps','desk']){
      await page.locator(`button[data-v="${part}"]`).click();
      assert.deepEqual(await measure({...cast,part}),[],`${width}px の ${part}`);
    }
  }
  assert.deepEqual(errors,[]);await ctx.close();
});

test('帳場のきょうの出入りは前日と直近7日で、375pxでも短く、方針に1日あたりが出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.setViewportSize({width:375,height:740});
  await page.locator('#sp0').click();
  await page.locator('button[data-v="desk"]').click();
  await page.evaluate(()=>document.fonts.ready);
  const flow=page.locator('#flow');
  const text=await flow.innerText();
  assert.match(text,/前日/);
  assert.match(text,/直近7日/);
  for(const name of ['売上','支援','蘇生代','立て替えの返り','返済','施設'])assert.match(text,new RegExp(name));
  const zeros=await page.locator('#flow .num').allInnerTexts();
  assert.deepEqual(zeros,Array(12).fill('0G'));
  assert.match(await page.locator('[data-cost="potion"]').innerText(),/2本にすると、いまの深さだと 1日あたり約\d+G/);
  for(const k of ['mapPay','revive','rookie'])assert.match(await page.locator(`[data-cost="${k}"]`).innerText(),/^いまの深さだと 1日あたり約\d+G$/);
  const layout=async()=>page.evaluate(()=>{
    const bad=[];
    const lines=el=>el.getClientRects().length;
    const box=document.querySelector('#flow').getBoundingClientRect();
    if(box.height>200)bad.push(`出入りが長い ${Math.round(box.height)}px`);
    if(box.right>innerWidth+1||box.left<-1)bad.push('出入りが横にはみ出す');
    for(const n of document.querySelectorAll('#flow .num'))if(lines(n)!==1)bad.push(n.textContent+' が折れている');
    // 行の名前（立て替えの返りなど）も一続き
    for(const el of document.querySelectorAll('#flow > div:nth-child(3n+1)')){
      if(!el.textContent.trim())continue;
      if(lines(el)!==1)bad.push(el.textContent+' の見出しが折れている');
    }
    for(const c of document.querySelectorAll('[data-cost]')){
      if(c.getBoundingClientRect().height>52)bad.push(`${c.dataset.cost} の見積もりが長い ${Math.round(c.getBoundingClientRect().height)}px`);
      if(c.getBoundingClientRect().right>innerWidth+1)bad.push(c.dataset.cost+' が横にはみ出す');
    }
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    return bad;
  });
  assert.deepEqual(await layout(),[]);
  await page.evaluate(()=>{S.taverns.ours.gold=5000;render();});
  await page.locator('button[data-act="repay"][data-v="1000"]').click();
  assert.match(await flow.innerText(),/-1,000G/);
  const rev=await page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status==='idle');
    a.status='dead';a.hp=0;a.party=null;
    S.taverns.ours.gold=100000;S.taverns.ours.support=0;
    const c=templeCost(S,a);render();return {c,id:a.id};
  });
  await page.locator(`button[data-act="revive"][data-a="${rev.id}"]`).click();
  assert.match(await flow.innerText(),new RegExp('-'+rev.c+'G'));
  assert.equal(await page.evaluate(()=>S.taverns.ours.support||0),0);
  await page.evaluate(()=>{
    S.flow=null;S.tick=0;
    flowAdd(S,'e',923);flowAdd(S,'s',180);flowAdd(S,'v',470);flowAdd(S,'r',5580);flowAdd(S,'f',15000);
    render();
  });
  const shown=await flow.innerText();
  assert.match(shown,/\+923G/);
  assert.match(shown,/-180G/);
  assert.match(shown,/-470G/);
  assert.match(shown,/-5,580G/);
  assert.match(shown,/-15,000G/);
  assert.deepEqual(await layout(),[]);
  const want=await page.evaluate(()=>policyCost(S).potion[1]);
  await page.locator('button[data-act="pol"][data-k="potion"][data-v="1"]').click();
  assert.equal(await page.locator('[data-cost="potion"]').innerText(),`いまの深さだと 1日あたり約${want}G`);
  assert.deepEqual(await layout(),[]);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('倒れた者の札、番付の数、出資の買い取り、記念碑の印が状態と合う',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const roster=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours'&&x.members.length>=2);
    const down=S.adv[p.members.find(id=>id!==p.leader)];
    const up=S.adv[p.leader];
    down.hp=0;down.status='party';
    up.hp=up.mhp;up.status='party';
    const miss=Object.values(S.adv).find(a=>a.tav==='ours'&&a.id!==down.id&&a.id!==up.id);
    miss.hp=0;miss.status='missing';miss.party=null;
    tab='roster';render();
    const row=name=>[...document.querySelectorAll('#tbody .row')].find(el=>el.querySelector('.nm-link')?.textContent===name);
    const chip=name=>row(name).querySelector('.chip').textContent;
    const card=[...document.querySelectorAll('.pcard')].find(el=>el.dataset.p==p.id);
    const mark=name=>{
      const who=[...card.querySelectorAll('.who')].find(el=>el.querySelector('.nm').textContent.replace('★','')===name);
      return who.querySelector('.cls').textContent;
    };
    const sect=name=>row(name).closest('.sect').querySelector('h3').textContent;
    return {down:down.name,up:up.name,miss:miss.name,chipDown:chip(down.name),chipUp:chip(up.name),chipMiss:chip(miss.name),markDown:mark(down.name),markUp:mark(up.name),sectDown:sect(down.name),sectMiss:sect(miss.name)};
  });
  assert.equal(roster.chipDown,'倒れている');
  assert.match(roster.markDown,/倒$/);
  assert.match(roster.sectDown,/探索中/);
  assert.equal(roster.chipUp,'探索中');
  assert.doesNotMatch(roster.markUp,/倒/);
  assert.equal(roster.chipMiss,'行方不明');
  assert.match(roster.sectMiss,/行方不明/);
  const rankOf=()=>page.evaluate(()=>{
    tab='rank';render();
    const rows=rankRows(S),won=rows.filter(r=>r.lead>0).length;
    const note=document.querySelector('#tbody .sect .note').textContent;
    return {n:rows.length,won,note};
  });
  const quiet=await rankOf();
  assert.equal(quiet.n,8);
  assert.match(quiet.note,new RegExp(`（${quiet.n}項目のうち${quiet.won}項目で上回る）`));
  if(quiet.won<=3)assert.match(quiet.note,/まだ追いかける側だ/);
  const ahead=await page.evaluate(()=>{
    S.taverns.ours.rep=824;S.taverns.rival.rep=601;
    S.mine={open:0};
    tab='rank';render();
    const rows=rankRows(S),won=rows.filter(r=>r.lead>0).length;
    const rep=rows.find(r=>r.name==='評判');
    const note=document.querySelector('#tbody .sect .note').textContent;
    return {n:rows.length,won,lead:rep.lead,note};
  });
  assert.equal(ahead.n,9);
  assert.ok(ahead.lead>0);
  assert.match(ahead.note,new RegExp(`（${ahead.n}項目のうち${ahead.won}項目で上回る）`));
  if(ahead.won<=3)assert.match(ahead.note,/まだ追いかける側だ。/);
  if(ahead.won>=6)assert.match(ahead.note,/新参と呼ぶ者はいない。/);
  const before=await page.evaluate(()=>{
    const t=smallOf(S).find(x=>!x.owned&&x.score<3);
    S.taverns.ours.gold=1e9;
    tab='rank';render();
    return {n:t.n,price:buyPrice(S,t),note:document.querySelector('#tbody').innerText};
  });
  assert.match(before.note,/景気が上がると、買い取りの値も上がる/);
  assert.match(before.note,new RegExp('買い取る '+before.price.toLocaleString('ja-JP')+'G'));
  await page.locator(`button[data-act="invest"][data-n="${before.n}"]`).click();
  const after=await page.evaluate(n=>{
    const t=smallOf(S).find(x=>x.n===n);
    return {price:buyPrice(S,t),score:t.score,note:document.querySelector('#tbody').innerText};
  },before.n);
  assert.ok(after.price>before.price,`${before.price}→${after.price}`);
  assert.ok(after.score>0);
  assert.match(after.note,/景気が上がると、買い取りの値も上がる/);
  assert.match(after.note,new RegExp('買い取る '+after.price.toLocaleString('ja-JP')+'G'));
  const badge=await page.evaluate(()=>{
    S.memorial.push({id:1,name:'消えた者',cls:'戦士',lvl:1,race:'人間',tav:'rival',tk:1,by:'オーク',floor:2,kills:0});
    tab='news';render();
    const btn=[...document.querySelectorAll('#tabs button')].find(b=>b.dataset.v==='stone');
    return btn.querySelector('.cnt').textContent;
  });
  assert.equal(badge,'ロスト1');
  await page.locator('button[data-v="stone"]').click();
  const still=await page.locator('button[data-v="stone"] .cnt').innerText();
  assert.equal(still,'ロスト1');
  assert.match(await page.locator('#tbody').innerText(),/消えた者/);
  assert.deepEqual(errors,[]);await ctx.close();
});

test('札の印は右上に揃い、方針ボタンの幅は変わらず、狭い画面ではログとタブの位置が収まる',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.evaluate(()=>document.fonts.ready);
  const tags=()=>page.evaluate(()=>{
    const bad=[];
    for(const el of document.querySelectorAll('.pcard')){
      const top=el.querySelector('.top'),pn=el.querySelector('.pn'),tag=el.querySelector('.tag');
      if(!top||!pn||!tag){bad.push('札の頭がない');continue;}
      const tr=top.getBoundingClientRect(),pr=pn.getBoundingClientRect(),gr=tag.getBoundingClientRect();
      if(gr.top>pr.bottom-1)bad.push('印が次の行に落ちた');
      if(Math.abs(gr.right-tr.right)>2)bad.push(`印が右上にない ${Math.round(gr.right-tr.right)}`);
      if(gr.left<pr.right-2)bad.push('印が名前に重なる');
      const cs=getComputedStyle(pn);
      if(cs.textOverflow!=='ellipsis'||cs.overflowX!=='hidden'&&cs.overflow!=='hidden')bad.push('名前が省略されない');
      if(el.scrollWidth>el.clientWidth+1)bad.push('札が横にはみ出す');
    }
    return bad;
  });
  assert.deepEqual(await tags(),[]);
  await page.setViewportSize({width:375,height:740});
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.name='ナハト・ラーベ・とても長い一行の名前が札の端で省略される';
    render();
  });
  const long=await page.evaluate(()=>{
    const el=[...document.querySelectorAll('.pcard')].find(x=>x.textContent.includes('ナハト・ラーベ・とても長い'));
    const pn=el.querySelector('.pn');
    const range=document.createRange();range.selectNodeContents(pn);
    const lines=new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size;
    return {clipped:pn.scrollWidth>pn.clientWidth+1,lines};
  });
  assert.equal(long.clipped,true,'長い名前が省略されていない');
  assert.equal(long.lines,1);
  assert.deepEqual(await tags(),[]);
  const phone=await page.evaluate(()=>{
    const bad=[];
    const log=document.querySelector('.c-log');
    if(!log)bad.push('ログがない');
    else{
      const h=log.getBoundingClientRect().height;
      if(h>innerHeight/2+1)bad.push(`ログが高い ${Math.round(h)} / 半分 ${Math.round(innerHeight/2)}`);
      if(h>380)bad.push(`ログが380pxを超える ${Math.round(h)}`);
    }
    for(const b of document.querySelectorAll('.ctrl .btn')){
      const r=b.getBoundingClientRect();
      if(r.right>innerWidth-15)bad.push(b.textContent.trim()+' が右端 '+Math.round(innerWidth-r.right));
      if(r.left<15)bad.push(b.textContent.trim()+' が左端');
    }
    return bad;
  });
  assert.deepEqual(phone,[]);
  await page.locator('button[data-v="desk"]').click();
  const widths=()=>page.evaluate(()=>{
    const bs=[...document.querySelectorAll('#tbody button.pol')];
    return bs.map(b=>({k:b.dataset.k,t:b.textContent,w:Math.round(b.getBoundingClientRect().width)}));
  });
  const before=await widths();
  assert.equal(before.length,3);
  assert.equal(new Set(before.map(b=>b.w)).size,1,`方針の幅が違う ${before.map(b=>b.k+b.w).join(' ')}`);
  await page.locator('button.pol').first().click();
  const after=await widths();
  assert.deepEqual(after.map(b=>b.w),before.map(b=>b.w),`切り替えると幅が変わる ${before.map(b=>b.t+b.w).join(' ')} → ${after.map(b=>b.t+b.w).join(' ')}`);
  await page.setViewportSize({width:390,height:844});
  await page.locator('button[data-v="news"]').click();
  await page.evaluate(()=>{const w=document.querySelector('.wrap');w.scrollTop=w.scrollHeight;});
  await page.locator('button[data-v="ref"]').click();
  const dy=await page.evaluate(()=>{
    const side=document.querySelector('.side').getBoundingClientRect();
    const wrap=document.querySelector('.wrap').getBoundingClientRect();
    return side.top-wrap.top;
  });
  assert.ok(Math.abs(dy)<=8,`タブを切り替えても先頭に来ない ${dy}`);
  const close=await page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours');
    advOpen=a.id;document.getElementById('advm').hidden=false;renderAdv();
    const b=[...document.querySelectorAll('#advbox button')].find(x=>x.textContent==='閉じる');
    return {on:b.classList.contains('on'),bg:getComputedStyle(b).backgroundColor};
  });
  assert.equal(close.on,true);
  assert.equal(close.bg,'rgb(227, 166, 73)');
  assert.deepEqual(errors,[]);await ctx.close();
});

test('黒猫亭の帳面の一行は、手帳と記念碑で語の途中で折れない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.evaluate(()=>{
    const D=TICKS_PER_DAY,base=Object.values(S.adv).find(a=>a.tav==='ours');
    const mk=(tk,status)=>{const a=JSON.parse(JSON.stringify(base));a.id=S.nid++;a.name='帳面'+a.id;a.status=status;a.party=null;a.opening=false;a.chron=[{tk,t:'扉をくぐる'}];S.adv[a.id]=a;return a;};
    for(let i=0;i<30;i++)mk(0,'idle');
    const ids=Object.values(S.adv).filter(a=>a.name.startsWith('帳面')).map(a=>a.id);
    ids.slice(0,3).forEach((id,i)=>{S.adv[id].status='lost';S.memorial.push({id,name:S.adv[id].name,cls:'戦士',lvl:5,race:'人間',tav:'ours',tk:(100+i*50)*D,by:'オーク',floor:3,kills:9});});
    S.farewells=S.farewells||[];
    ids.slice(3,7).forEach((id,i)=>{S.adv[id].status='retired';S.farewells.push({id,name:S.adv[id].name,tav:'ours',tk:(580+i*20)*D,why:'故郷に帰る',lvl:9,cls:'戦士',race:'人間',sex:'男',age:30,hage:30});});
    const lost=mk(1000*D,'lost');lost.chron.push({tk:1173*D,t:'ロスト。その名は記念碑に刻まれる'});
    S.memorial.push({id:lost.id,name:lost.name,cls:'戦士',lvl:12,race:'人間',tav:'ours',tk:1173*D,by:'オーク',floor:9,kills:40});
    const gone=mk(1000*D,'retired');gone.chron.push({tk:1642*D,t:'故郷に帰るため、黒猫亭を去る'});
    S.farewells.push({id:gone.id,name:gone.name,tav:'ours',tk:1642*D,why:'故郷に帰る',lvl:9,cls:'戦士',race:'人間',sex:'男',age:30,hage:30});
    window.__ledger=[lost.id,gone.id];
  });
  const broken=()=>page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('.ledger').forEach(el=>{
      if(!el.getClientRects().length)return;// 閉じた手帳に残る行は見ない
      el.querySelectorAll('.nw').forEach(s=>{if(s.getClientRects().length!==1)out.push(s.textContent);});
      if(!el.textContent.startsWith('帳面によれば、'))out.push('頭：'+el.textContent);});
    return out;});
  for(const w of [375,1280]){
    await page.setViewportSize({width:w,height:800});
    await page.evaluate(()=>{tab='stone';render();});
    const stone=await page.locator('#tbody').innerText();
    assert.match(stone,/帳面によれば、[^\n]*人に一人の側に入った。在籍は百七十日ほど。/);
    assert.match(stone,/帳面によれば、自分の足で出ていった。在籍は六百四十日ほど。帳面のとおりだった。/);
    assert.deepEqual(await broken(),[],`幅${w}の記念碑`);
    for(const id of await page.evaluate('window.__ledger')){
      await page.evaluate(id=>{advOpen=id;document.getElementById('advm').hidden=false;renderAdv();},id);
      const book=await page.locator('#advbox').innerText();
      assert.match(book,/帳面によれば、この街の冒険者のうち、戻らなかったのは[^\n]*人に一人。たいていは六百日ほどで、自分の足で出ていく。/);
      assert.equal((book.match(/帳面によれば、/g)||[]).length,2,`幅${w}の手帳の帳面の行数`);
      assert.deepEqual(await broken(),[],`幅${w}の手帳`);
      await page.evaluate(()=>{advOpen=null;document.getElementById('advm').hidden=true;});
    }
  }
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('記念碑の最後の言葉と見送りの一行は、375pxと1280pxで語の途中で折れず、「」。」だけが次の行に残らない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const info=await page.evaluate(()=>{
    const ours=Object.values(S.adv).filter(a=>a.tav==='ours').sort((a,b)=>a.id-b.id);
    const [lost,friend,quiet]=ours;
    for(const x of [lost,friend,quiet]){x.party=null;x.status='idle';x.trips=4;}
    friend.pers='慎重';friend.tone='普通';
    S.bonds=S.bonds||{};S.bonds[bkey(lost,friend)]={n:3,ev:[]};
    lost.said=[{tk:S.tick-2,t:'一つ目'},{tk:S.tick-1,t:'二つ目'},{tk:S.tick,t:'次は盗賊を連れていく'}];
    lost.status='lost';lost.lastBy='オーク';
    const m=memorialize(S,lost,{by:'オーク',floor:3});
    S.news.push({tk:S.tick,t:`黒猫亭の${lost.name}、ロスト。その名は記念碑に刻まれる。${m.farewell}`,k:'lost'});
    // 絆のない者。店の一行になる
    quiet.said=[];quiet.status='lost';const m2=memorialize(S,quiet,{by:'オーク',floor:2});
    tab='stone';render();
    return {lost:lost.id,friend:friend.name,quiet:quiet.id,fw:m.farewell,fw2:m2.farewell,last:m.last&&m.last.t};
  });
  assert.equal(info.last,'次は盗賊を連れていく');
  assert.match(info.fw,new RegExp('^'+info.friend+'は、'));
  assert.match(info.fw2,/^その夜、黒猫亭/);
  assert.doesNotMatch(info.fw+info.fw2,/店主|見ていなかった/);
  const broken=()=>page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('.stone .ep .nw, .news li .nw').forEach(s=>{if(s.getClientRects().length>1)out.push(s.textContent);});
    return out;});
  for(const w of [375,1280]){
    await page.setViewportSize({width:w,height:800});
    await page.evaluate(()=>{tab='stone';render();});
    const stone=await page.locator('#tbody').innerText();
    assert.match(stone,/酒場で最後に言ったのは「次は盗賊を連れていく」。/);
    assert.doesNotMatch(stone,/酒場で最後に言ったのは「」/);
    assert.match(stone,new RegExp(info.fw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(stone,new RegExp(info.fw2.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    // 最後の言葉は添え書きより先。見送りの一行は帳面の下
    const order=await page.evaluate(id=>{const s=[...document.querySelectorAll('.stone')].find(el=>el.querySelector(`[data-a="${id}"]`));const t=[...s.children].map(c=>c.className+':'+c.textContent.slice(0,6));return t.join('|');},info.lost);
    assert.match(order,/ep:酒場で最後に.*ep:(開店からの|黒猫亭の客).*ledger:.*ep:/);
    assert.deepEqual(await broken(),[],`幅${w}の記念碑`);
    // 言葉の長さを変えても、最後の行が「」。」だけにならない
    const short=await page.evaluate(id=>{
      const m=S.memorial.find(x=>x.id===id);const out=[];
      const tailOf=ep=>{const tops=[],chars=[];const w=document.createTreeWalker(ep,NodeFilter.SHOW_TEXT);
        for(let n=w.nextNode();n;n=w.nextNode())for(let i=0;i<n.length;i++){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const rr=r.getBoundingClientRect();if(rr.width){chars.push([Math.round(rr.top),n.data[i]]);tops.push(Math.round(rr.top));}}
        const last=Math.max(...tops);return {rows:new Set(tops.map(t=>Math.round(t/4))).size,tail:chars.filter(([t])=>Math.abs(t-last)<=2).map(([,c])=>c).join('')};};
      for(let k=0;k<=40;k++){m.last={tk:1,t:'次は'+'盗'.repeat(k)+'賊を連れていく'};render();
        const s=[...document.querySelectorAll('.stone')].find(el=>el.querySelector(`[data-a="${id}"]`));const ep=[...s.querySelectorAll('.ep')][0];
        const r=tailOf(ep);if(r.rows>=2&&r.tail.length<4)out.push(`${k}:${r.tail}`);}
      m.last={tk:1,t:'次は盗賊を連れていく'};render();return out;},info.lost);
    assert.deepEqual(short,[],`幅${w}の最後の言葉`);
    await page.locator('button[data-v="news"]').click();
    const row=page.locator('.news li',{hasText:'ロスト。その名は記念碑に刻まれる。'}).first();
    assert.match(await row.innerText(),new RegExp(info.fw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.deepEqual(await broken(),[],`幅${w}の日報`);
  }
  assert.deepEqual(errors,[]);await ctx.close();
});

test('まだ知れていない全滅の水晶は、生きている一行と見分けがつかない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  for(const w of [375,1280]){
    await page.setViewportSize({width:w,height:900});
    const r=await page.evaluate(()=>{
      const out=[];
      const p=Object.values(S.parties).find(x=>x.tav==='ours');
      Object.values(S.parties).forEach(q=>{if(q!==p){q.state='town';q.rest=99;}});
      p.state='explore';p.floor=5;p.enemies=null;p.plan='normal';p.pushWhy=null;p.steps=0;p.fsteps=0;p.maps={};p.announced=false;p.knownWiped=false;p.hideRecall=0;
      p.trip=p.trip||{};p.trip.deep=5;p.log=[];p.lc=0;p.loot=1234;
      const ms=p.members.map(id=>S.adv[id]);
      ms.forEach(a=>{a.status='party';a.hp=a.mhp=100;a.poison=0;a.mp=5;a.pers='普通';a.cls='戦士';});
      ms[0].hp=40;// 傷を負った者がいる
      plog(p,'くらい つうろを すすむ','move');plog(p,'とびらを あけた','move');
      // 戦いのない歩みで、水晶の位置と体力が控えられる（本物の歩みを1回）
      const rnd=Math.random;Math.random=()=>0.99;stepParty(S,p);Math.random=rnd;
      const calm=p.calmLc;
      plog(p,'＊ かいぶつが あらわれた ＊','sys');plog(p,'オーク ×3','sys');
      ms.forEach(a=>{a.hp=0;});S.watch=[p.id,null];S.sel=0;
      // 見ていないことにして全滅させ、そのあと水晶を向ける
      const wl=S.watch;S.watch=[null,null];wipe(S,p,'オーク');S.watch=[p.id,null];
      render();
      const cr=document.querySelector('.crystal.sel')||document.querySelector('.crystal');
      const txt=cr?cr.innerText:'';
      if(!cr)out.push('水晶がない');
      if(/ぜんめつ|うつさない|かいぶつが あらわれた|オーク/.test(txt))out.push('全滅した戦いが映った '+txt.replace(/\n/g,' / '));
      if(!txt.includes('とびらを あけた'))out.push('全滅より前の記録が消えた');
      if(!txt.includes('40/100'))out.push('傷を負った者の体力が戻った '+txt.replace(/\n/g,' / '));
      if(!cr.querySelector('[data-act="recall"]'))out.push('撤退のボタンがない');
      if(!txt.includes('稼ぎ'))out.push('稼ぎが出ない');
      const n0=cr.querySelectorAll('.c-log div').length;
      S.tick+=20;render();
      const cr2=document.querySelector('.crystal.sel')||document.querySelector('.crystal');
      const n1=cr2.querySelectorAll('.c-log div').length;
      if(n1<=n0)out.push(`歩みの行が増えない ${n0}→${n1}`);
      // 伝書鳩：50G かかり、帰路の様子になる
      const g0=T().gold;T().gold=Math.max(g0,100);const g1=T().gold;
      cr2.querySelector('[data-act="recall"]').click();
      const cr3=document.querySelector('.crystal.sel')||document.querySelector('.crystal');
      if(T().gold!==g1-50)out.push('伝書鳩の代金 '+(g1-T().gold));
      if(!cr3.innerText.includes('でんしょばとが まいおりた'))out.push('伝書鳩の行がない');
      if(!cr3.innerText.includes('帰路についている')||cr3.querySelector('[data-act="recall"]'))out.push('撤退のあとの足元 '+cr3.querySelector('.c-foot').innerText);
      if(!stateText(p)[0].includes('帰還中'))out.push('撤退のあとの札 '+stateText(p)[0]);
      if(!wipeHidden(p))out.push('撤退で全滅が知れた');
      return {out,calm};
    });
    assert.deepEqual(r.out,[],`幅${w}`);
  }
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('水晶のログのいちばん新しい行も、375pxで折り返して右で切れない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  await page.setViewportSize({width:375,height:900});
  const r=await page.evaluate(()=>{
    const out=[];
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    Object.values(S.parties).forEach(q=>{if(q!==p){q.state='town';q.rest=99;}});
    p.state='explore';p.floor=5;p.enemies=null;p.trip=p.trip||{};p.trip.deep=5;p.log=[];p.lc=0;
    p.members.forEach(id=>{const a=S.adv[id];a.status='party';a.hp=a.mhp=100;});
    S.watch=[p.id,null];S.sel=0;
    plog(p,'くらい つうろを すすむ','move');render();
    // 前の描画のあとに足した行が「新しい行」になる
    const long='ながい ぎょうが みぎはしで きれずに おりかえされるかを たしかめる ための とても ながい ぎょう です';
    plog(p,long,'move');render();
    const cr=document.querySelector('.crystal.sel')||document.querySelector('.crystal');
    const log=cr&&cr.querySelector('.c-log');
    if(!log)return ['ログがない'];
    const row=[...log.querySelectorAll('div')].find(d=>d.textContent===long);
    if(!row)return ['新しい行がない'];
    if(!row.classList.contains('fresh'))out.push('新しい行の印がない '+row.className);
    if(row.classList.contains('nw'))out.push('新しい行に折り返さない印が付いている');
    const old=[...log.querySelectorAll('div')].find(d=>d!==row);
    if(old&&getComputedStyle(row).whiteSpace!==getComputedStyle(old).whiteSpace)out.push(`新しい行の white-space ${getComputedStyle(row).whiteSpace}（ほかの行は ${getComputedStyle(old).whiteSpace}）`);
    if(row.scrollWidth>row.clientWidth+1)out.push(`新しい行が横にはみ出す ${row.scrollWidth}/${row.clientWidth}`);
    const lr=log.getBoundingClientRect(),rr=row.getBoundingClientRect();
    if(rr.right>lr.right+1||rr.right>innerWidth)out.push(`新しい行の右端 ${Math.round(rr.right)} ログ ${Math.round(lr.right)}`);
    const range=document.createRange();range.selectNodeContents(row);
    const lines=new Set([...range.getClientRects()].filter(x=>x.width>1).map(x=>Math.round(x.top))).size;
    if(lines<2)out.push('新しい行が折り返されていない');
    // ほかの場所の折り返さない印は、そのまま
    const nw=document.querySelector('.nw:not(.c-log *)');
    if(nw&&getComputedStyle(nw).whiteSpace!=='nowrap')out.push('.nw が折り返す');
    return out;
  });
  assert.deepEqual(r,[]);
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('常連のひと幕は、留守のまとめのあとに出て、375pxと1280pxで語の途中で折れず、記念碑に生涯が残る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  for(const w of [375,1280]){
    await page.setViewportSize({width:w,height:w===375?740:800});
    // 留守のあいだのまとめが出ているあいだは出さない
    const who=await page.evaluate(()=>{
      $('digest').hidden=false;
      const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');
      a.trips=12;a.kills=345;a.deepest=14;a.party=null;a.title='牙折り';
      Math.random=()=>0.999;a.status='ash';a.hp=0;a.gold=1e6;a.lastBy='キメラ';a.lastFloor=14;temple(S,a,false);
      render();return {id:a.id,name:a.name,life:!$('life').hidden};
    });
    assert.equal(who.life,false,`幅${w}：まとめの上にひと幕が出た`);
    await page.locator('[data-act="closedigest"]').click();
    const life=page.locator('#life');
    assert.equal(await life.isVisible(),true,`幅${w}：まとめを閉じてもひと幕が出ない`);
    const text=await life.innerText();
    assert.match(text,new RegExp(who.name));
    assert.match(text,/B14Fでキメラに倒れ、\d+日目、灰から戻ることなく記念碑に刻まれた。/);
    assert.match(text,/12回潜/);
    assert.match(text,/迷宮暦\d+年・解禁から\d+日目/);
    const fit=await page.evaluate(narrow=>{
      const bad=[];const box=document.querySelector('#life .mbox').getBoundingClientRect();
      if(box.left<0||box.right>innerWidth+1)bad.push('ひと幕が横にはみ出す');
      if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
      const btn=$('lf-btn').getBoundingClientRect();
      // 押しやすい大きさの44pxは、ほかのボタンと同じく幅640px以下で
      if(narrow&&(btn.height<44||btn.width<44))bad.push(`ボタンが小さい ${Math.round(btn.width)}x${Math.round(btn.height)}`);
      if($('lf-btn').textContent!=='杯を上げる')bad.push('ボタン '+$('lf-btn').textContent);
      for(const el of document.querySelectorAll('#lf-body .nw')){const r=new Set([...el.getClientRects()].filter(x=>x.width>1).map(x=>Math.round(x.top)));if(r.size>1)bad.push(el.textContent+' が折れている');}
      if(!document.querySelector('#lf-body .nw'))bad.push('一続きの語がない');
      return bad;
    },w===375);
    assert.deepEqual(fit,[],`幅${w}`);
    await page.locator('#lf-btn').click();
    assert.equal(await life.isVisible(),false);
    assert.equal(await page.evaluate(()=>(S.lifeQ||[]).length),0);
    // 同じ者に二度は出ない
    await page.evaluate(()=>render());
    assert.equal(await life.isVisible(),false,`幅${w}：閉じたひと幕がまた出た`);
    // 記念碑の添え書きの下に、同じ文が生涯として残る
    await page.locator('button[data-v="stone"]').click();
    const stone=page.locator('.stone',{has:page.locator(`[data-a="${who.id}"]`)});
    // 「生涯」の押す所は、375pxでも高さ44px以上。すぐ上の行にも、札の外にも重ならない
    const sum=await stone.locator('details.life summary').evaluate(el=>{const r=el.getBoundingClientRect(),up=el.parentElement.previousElementSibling.getBoundingClientRect(),card=el.closest('.stone').getBoundingClientRect();
      return {h:r.height,w:r.width,top:r.top,bottom:r.bottom,upBottom:up.bottom,cardBottom:card.bottom};});
    assert.ok(sum.h>=44&&sum.w>=44,`幅${w}：生涯の押す所が小さい ${JSON.stringify(sum)}`);
    assert.ok(sum.top>=sum.upBottom-0.5,`幅${w}：生涯の押す所が上の行に重なる ${JSON.stringify(sum)}`);
    assert.ok(sum.bottom<=sum.cardBottom+0.5,`幅${w}：生涯の押す所が札の外にはみ出す ${JSON.stringify(sum)}`);
    await stone.locator('details.life summary').click();
    // 開いたとき、「生涯」の行と本文のあきは10px前後。押す所は44pxのまま、下の端まで押せる
    const open=await stone.locator('details.life summary').evaluate(el=>{const r=el.getBoundingClientRect(),cs=getComputedStyle(el),p=el.nextElementSibling.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.bottom-2);return {gap:p.top-(r.top+parseFloat(cs.paddingTop)+parseFloat(cs.lineHeight)),h:r.height,hit:!!hit&&el.contains(hit)};});
    assert.ok(open.gap>=6&&open.gap<=14,`幅${w}：生涯と本文のあきが10px前後でない ${JSON.stringify(open)}`);
    assert.ok(open.h>=44&&open.hit,`幅${w}：開いた生涯の押す所が44pxでない ${JSON.stringify(open)}`);
    const lifeText=(await stone.locator('details.life p').innerText()).replace(/\s+/g,'');
    assert.ok(text.replace(/\s+/g,'').includes(lifeText),`幅${w}：記念碑の生涯がひと幕と違う ${lifeText}`);
    // 店を去った者は「見送る」で閉じる
    await page.evaluate(id=>{const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired'&&x.id!==id);a.trips=5;a.party=null;a.status='idle';retire(S,a,'旅に出る');render();},who.id);
    assert.equal(await page.locator('#lf-btn').innerText(),'見送る');
    assert.match(await life.innerText(),/旅に出るため店を去った。/);
    await page.locator('#lf-btn').click();
  }
  // 踏破のひと幕が待っているときは、それを閉じたあとに出す
  await page.evaluate(()=>{const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');a.trips=5;a.party=null;a.status='idle';
    S.conquered={tk:S.tick,tav:'ours',party:'夜明け団',names:[a.name],ending:true};retire(S,a,'旅に出る');render();});
  assert.equal(await page.locator('#ending').isVisible(),true);
  assert.equal(await page.locator('#life').isVisible(),false,'踏破のひと幕より先に出た');
  await page.locator('#ed-btn').click();
  assert.equal(await page.locator('#life').isVisible(),true,'踏破のひと幕を閉じても出ない');
  await page.locator('#lf-btn').click();
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('完済の場面は、返し終えたその場で一度だけ、留守のまとめのあとに出て、踏破のひと幕より先に出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const yen=n=>n.toLocaleString('ja-JP');
  const got=await page.evaluate(()=>{
    $('digest').hidden=false;
    const U=S.taverns.ours;U.payClean=3;U.repaid=12000;U.interestPaid=3000;U.gold=U.debt+5000;repay(S,U.debt);
    const a=Object.values(S.adv).find(x=>x.tav==='ours');S.conquered={tk:S.tick,tav:'ours',party:'夜明け団',names:[a.name],ending:true};
    render();return {shown:!$('payoff').hidden,ending:!$('ending').hidden,repaid:U.repaid,intr:U.interestPaid,day:Math.floor(U.debtFree/TICKS_PER_DAY)+1};
  });
  assert.equal(got.shown,false,'留守のまとめの上に完済の場面が出た');
  await page.locator('[data-act="closedigest"]').click();
  const po=page.locator('#payoff');
  assert.equal(await po.isVisible(),true,'まとめを閉じても完済の場面が出ない');
  assert.equal(await page.locator('#ending').isVisible(),false,'完済の場面より先に踏破のひと幕が出た');
  const text=(await po.innerText()).replace(/\s+/g,'');
  assert.match(text,/^借用書に最後の印を押した/);
  assert.match(text,new RegExp(`迷宮暦\\d+年・開店から${got.day}日目`));
  assert.ok(text.includes(`返した額は、あわせて${yen(got.repaid)}G（うち利息${yen(got.intr)}G）。`),text);
  assert.ok(text.includes('返済日に、取り立て人を呼ばずに済んだのは3回。'),text);
  assert.ok(text.includes('帳場の覚え書きに、次の行を書き足した。まずは、ロウエンいちの酒場の名を、銀の杯亭から取る。'),text);
  for(const w of [375,1280]){
    await page.setViewportSize({width:w,height:w===375?740:800});await page.evaluate(()=>document.fonts.ready);
    assert.deepEqual(await page.evaluate(screenAudit),[],`${w}px の完済の場面`);
  }
  await page.locator('#po-btn').click();
  assert.equal(await po.isVisible(),false);
  assert.equal(await page.locator('#ending').isVisible(),true,'完済の場面を閉じても踏破のひと幕が出ない');
  await page.locator('#ed-btn').click();
  await page.evaluate(()=>render());
  assert.equal(await po.isVisible(),false,'閉じた完済の場面がまた出た');
  // 開き直しても出ない
  const again=await open({ctx});
  assert.equal(await again.page.locator('#payoff').isVisible(),false,'開き直すと完済の場面がまた出た');
  assert.deepEqual(errors,[]);assert.deepEqual(again.errors,[]);
  await ctx.close();
});

test('回数を持たない記録では、完済の場面に回数の行を出さない。すでに返し終えた古い記録を開いても、場面は出ない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  // 常連のひと幕が出ているときに返し終えたら、ひと幕を閉じたあとに出る
  await page.evaluate(()=>{const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired');a.trips=5;a.party=null;a.status='idle';retire(S,a,'旅に出る');render();});
  assert.equal(await page.locator('#life').isVisible(),true);
  await page.evaluate(()=>{const U=S.taverns.ours;delete U.payClean;U.gold=U.debt+5000;repay(S,U.debt);render();});
  const po=page.locator('#payoff');
  assert.equal(await po.isVisible(),false,'出ているひと幕の上に完済の場面が出た');
  await page.locator('#lf-btn').click();
  assert.equal(await po.isVisible(),true,'ひと幕を閉じても完済の場面が出ない');
  const text=await po.innerText();
  assert.match(text,/返した額は、あわせて/);
  assert.doesNotMatch(text,/取り立て人/);
  await page.locator('#po-btn').click();
  // 版31の、すでに返し終えた記録（場面の印も回数もない）を開く
  await page.evaluate(()=>{const U=S.taverns.ours;S.v=31;delete U.payClean;delete U.payoffScene;delete S.memo.done.top;U.overtook=S.tick;save();});
  const again=await open({ctx});
  assert.equal(await again.page.locator('#payoff').isVisible(),false,'返し終えた古い記録で完済の場面が出た');
  const m=await again.page.evaluate(()=>({v:S.v,top:S.memo.done.top,overtook:S.taverns.ours.overtook}));
  assert.equal(m.v,await again.page.evaluate('SAVE_V'));
  assert.equal(m.top&&m.top.tk,m.overtook,'もう満たしている行に線が引かれていない');
  assert.deepEqual(errors,[]);assert.deepEqual(again.errors,[]);
  await ctx.close();
});

test('水晶の札：映せない一行を押すと、わけが一言出る',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const got=await page.evaluate(()=>{
    const ours=Object.values(S.parties).find(x=>x.tav==='ours');
    const rival=Object.values(S.parties).find(x=>x.tav==='rival');
    const press=p=>{S.watch=[null,null];render();document.querySelector('.toast')?.remove();
      document.querySelector(`.pcard[data-p="${p.id}"]`).click();return {toast:(document.querySelector('.toast')||{}).textContent||'',watched:S.watch.includes(p.id)};};
    const out={};
    rival.state='explore';rival.seen=S.tick-31;out.rival=press(rival);
    rival.seen=S.tick;out.rivalSeen=press(rival);
    rival.state='wiped';rival.announced=true;out.rivalWiped=press(rival);
    ours.state='wiped';ours.announced=true;ours.knownWiped=false;out.missing=press(ours);
    ours.knownWiped=true;out.known=press(ours);
    return out;
  });
  assert.deepEqual(got.rival,{toast:'銀の杯亭の一行は、すれ違ったときしか見えない',watched:false});
  assert.deepEqual(got.rivalSeen,{toast:'',watched:true});
  assert.deepEqual(got.rivalWiped,{toast:'銀の杯亭の全滅は、噂でしか伝わらない',watched:false});
  assert.deepEqual(got.missing,{toast:'消息不明の一行は、水晶には映らない',watched:false});
  assert.deepEqual(got.known,{toast:'',watched:true});
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('帳場の死体回収の依頼は、見つかる見込みを言葉で添え、預けると次の返済に足りなくなるときだけ一言出す',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  const prep=await page.evaluate(()=>{
    const p=Object.values(S.parties).find(x=>x.tav==='ours');
    p.members.forEach(id=>{const a=S.adv[id];a.status='missing';a.hp=0;a.party=p.id;});
    Object.assign(p,{state:'wiped',retrieved:false,announced:true,knownWiped:false,causeTold:false,wipedAt:S.tick,floor:4,killer:'オーク',cause:'オークに倒れた'});
    const U=S.taverns.ours;U.gold=bountyPrice(p)+nextDue(S).due+1000;
    return {id:p.id,hint:bountyHint(S,p),price:bountyPrice(p),due:nextDue(S).due};
  });
  await page.locator('button[data-v="desk"]').click();
  const row=()=>page.locator('#tbody .row').filter({hasText:prep.hint});
  assert.doesNotMatch(prep.hint,/[0-9０-９%％]/,'見込みに数字が出ている');
  assert.equal(await row().count(),1,'依頼の行に見込みの言葉が出ていない');
  assert.doesNotMatch(await row().innerText(),/次の返済に足りなくなる/,'足りるのに一言が出ている');
  await page.evaluate(({price,due})=>{S.taverns.ours.gold=price+due-1;render();},prep);
  assert.match(await row().innerText(),/預けると、次の返済に足りなくなる/);
  await row().locator('button[data-act="bounty"]').click();
  const after=await row().innerText();
  assert.match(after,/依頼中/);
  assert.equal(after.includes(prep.hint),true,'依頼中の行に見込みの言葉が出ていない');
  assert.doesNotMatch(after,/次の返済に足りなくなる/,'依頼中の行に一言が出ている');
  // 状況が変われば言葉も変わる：ほかの一行がみな全滅すれば、その深さに届く一行はいない
  const none=await page.evaluate(id=>{Object.values(S.parties).forEach(q=>{if(q.id!==id)q.state='wiped';});S.deepest.ours=1;S.deepest.rival=1;render();return bountyHint(S,S.parties[id]);},prep.id);
  assert.equal(none,'いまその深さに届く一行は、ほとんどいない');
  assert.match(await page.locator('#tbody').innerText(),/いまその深さに届く一行は、ほとんどいない/);
  assert.deepEqual(errors,[]);await ctx.close();
});

// 画面全体で、押す所の大きさ・はみ出し・折れ目を確かめ、崩れを「何が・どこで」の一行ずつで返す（ページの中で動かす）
//   押す所：押せるもの（ボタン・リンク・欄の開け閉め・data-act の付いたもの）は縦横44px以上
//   はみ出し：ページが横に滑らない。要素は画面の外に出ず、字は入れ物の外に出ず、横に滑る枠もない
//   折れ目：一続きにした語（.nw・.tie、名前のボタン、所属の札）は1行。字を1字ずつ並べて、行が変わるところが
//     人の名前・一行の名・店の名・地名、「Lv20 ホビットの盗賊」、B○F、数と単位（3,000G・12日目・10%など）、中が12字までのかっこ書きの途中なら崩れ。
//     句読点と閉じかっこが行の頭に来るのと、開きかっこが行の末尾に残るのも崩れ（docs/principles.md 8）
// 例外とその理由
//   - 768px と 1280px の押す所は、手帳の「見込む」と記念碑の「生涯」だけを見る。ほかの44pxは、spec.md「タブ」で640px以下に限っている
//   - 文の途中の名前は、横幅を見ない。箱にすると文の行が崩れるので、押せる範囲を縦にだけ広げている（spec.md「タブ」）
//   - 語ひとつが行より長いとき（表の狭いますに入る長い一行の名など）は、その語の途中で折れてよい（spec.md「タブ」）
//   - 水晶のログは、幅に合わせて字の単位で折り返す作り（spec.md「遠見の水晶」）なので、折れ目は見ない。はみ出しは見る
//   - 末尾を「…」にする札（所属の札、一行の札の名）は、字が枠の外に出ても見ない。全文は札に触れると出る
function screenAudit(){
  const bad=[],vw=innerWidth,phone=vw<=640;
  const shown=el=>{for(let e=el;e&&e.nodeType===1;e=e.parentElement){const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')return false;}return true;};
  const where=el=>{const p=[];for(let e=el;e&&e!==document.body&&p.length<3;e=e.parentElement)p.unshift(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+[...e.classList].map(c=>'.'+c).join(''));return p.join('>');};
  const say=el=>(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,20);
  const charRect=(n,i)=>{const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);return [...r.getClientRects()].find(x=>x.width>.5)||null;};
  const cut=el=>{for(let e=el;e&&e!==document.body;e=e.parentElement){const cs=getComputedStyle(e);if(cs.textOverflow==='ellipsis'&&cs.overflowX!=='visible')return true;}return false;};
  // 押す所
  for(const el of document.querySelectorAll('button,a[href],input,select,summary,[data-act]:not(.modal)')){
    if(!el.getClientRects().length||!shown(el))continue;
    if(!phone&&!el.matches('[data-act="mark"],.life>summary'))continue;
    const r=el.getBoundingClientRect(),inline=el.matches('.nm-link:not(.nm-head)')&&!el.closest('.c-members');
    if((!inline&&r.width<44)||r.height<44)bad.push(`押す所が小さい ${where(el)}「${say(el)}」${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // はみ出し
  if(document.documentElement.scrollWidth>vw+1)bad.push(`ページが横にはみ出す ${document.documentElement.scrollWidth}px`);
  for(const el of document.body.querySelectorAll('*')){
    if(!el.getClientRects().length||!shown(el))continue;
    const cs=getComputedStyle(el),r=el.getBoundingClientRect();
    if((cs.overflowX==='auto'||cs.overflowX==='scroll')&&el.scrollWidth>el.clientWidth+1)bad.push(`横に滑る ${where(el)} ${el.scrollWidth}>${el.clientWidth}`);
    if(r.width>=1&&(r.right>vw+1||r.left<-1)&&!cut(el.parentElement))bad.push(`画面の外 ${where(el)}「${say(el)}」`);
  }
  const blockOf=n=>{let e=n.parentElement;while(e&&getComputedStyle(e).display==='inline')e=e.parentElement;return e;};
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let n;(n=walker.nextNode());){
    if(!n.textContent.trim()||!shown(n.parentElement))continue;
    if(cut(n.parentElement))continue;
    const b=blockOf(n).getBoundingClientRect(),range=document.createRange();range.selectNodeContents(n);
    if(![...range.getClientRects()].some(r=>r.width>=1&&(r.right>b.right+1.5||r.left<b.left-1.5)))continue;
    // 行末の空白だけがはみ出すのは見ない
    const t=n.textContent;
    for(let i=0;i<t.length;i++){if(!t[i].trim())continue;const r=charRect(n,i);if(r&&(r.right>b.right+1.5||r.left<b.left-1.5)){bad.push(`字が入れ物の外 ${where(blockOf(n))}「${t.trim().slice(0,20)}」`);break;}}
  }
  // 折れ目：一続きにした語は1行
  const lines=rs=>{const m=[];for(const r of rs){if(r.width<1)continue;const c=(r.top+r.bottom)/2;if(!m.some(x=>Math.abs(x-c)<r.height/2))m.push(c);}return m.length;};
  for(const el of document.querySelectorAll('.nw,.tie,.nm-link,.ptag')){
    if(!el.getClientRects().length||!shown(el))continue;
    const range=document.createRange();range.selectNodeContents(el);
    if(lines(range.getClientRects())>1)bad.push(`一続きの語が折れる ${where(el)}「${el.textContent}」`);
  }
  // 折れ目：入れ物ごとに字を並べ、行が変わるところを見る。行の中でひとかたまりの要素（inline-block など）は1字（￼）と数え、その中は別の入れ物として見る
  const groups=new Map();
  const put=(blk,ch,r)=>{if(!groups.has(blk))groups.set(blk,[]);groups.get(blk).push({ch,r});};
  const walk=(blk,el)=>{for(const c of el.childNodes){
    if(c.nodeType===3){for(let i=0;i<c.textContent.length;i++)put(blk,c.textContent[i],charRect(c,i));continue;}
    if(c.nodeType!==1)continue;
    const d=getComputedStyle(c).display;
    if(d==='none')continue;
    if(d==='inline'){walk(blk,c);continue;}
    if(d.startsWith('inline')){const r=c.getBoundingClientRect();put(blk,'￼',r.width?r:null);}else put(blk,'\n',null);
    walk(c,c);
  }};
  walk(document.body,document.body);
  // 人の名など（newsTerms）に加えて、性格と素質の言葉（「慎重」「有望」。土産話の添え書きと手帳の見出しに出る）も一続きの語とする
  const traits=[...Object.keys(PERS),...Object.keys(TAL)].filter(t=>t.length>=2);
  const terms=[...new Set(newsTerms().flatMap(t=>{const m=/^(.+)(（[^（）]+）)$/.exec(t);return m?[m[1],m[2]]:[t];}).concat(traits))];
  const units=[/Lv\d+(?: [^\s・、。（）]+の[^\s・、。（）]+)?/g,/（[^（）\s￼]{1,12}）/g,/(?:坑道)?B\d+F/g,/[+-]?\d[\d,]*(?:\.\d+)?(?:G|日目|日|歳相当|歳|部|人|本|年|月|時|作目|刻|階|段|回|体|倍|%)?/g];
  for(const [blk,arr] of groups){
    if(!shown(blk)||blk.closest('.c-log'))continue;
    const s=arr.map(x=>x.ch).join(''),spans=[];
    for(const re of units)for(const m of s.matchAll(re))if(m[0].length>1)spans.push([m.index,m.index+m[0].length,m[0]]);
    for(const t of terms)for(let i=s.indexOf(t);i>=0;i=s.indexOf(t,i+1))spans.push([i,i+t.length,t]);
    const cs=getComputedStyle(blk),room=blk.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
    const wide=([p,q])=>arr.slice(p,q).reduce((w,x)=>w+(x.r?x.r.width:0),0);
    let prev=-1;
    for(let i=0;i<arr.length;i++){
      const x=arr[i];
      if(x.ch==='\n'){prev=-1;continue;}
      if(!x.r||!x.ch.trim())continue;
      const a=prev>=0&&arr[prev].r;
      if(a&&x.r.top>(a.top+a.bottom)/2&&x.r.top>a.top+3){
        const at=`${where(blk)} ${s.slice(Math.max(0,prev-6),prev+1)}｜${s.slice(i,i+6)}`.replace(/\n/g,'');
        const hit=spans.find(sp=>sp[0]<=prev&&i<sp[1]&&wide(sp)<=room);
        if(hit)bad.push(`語の途中で折れる「${hit[2]}」 ${at}`);
        else if('、。，．）」』】！？'.includes(x.ch))bad.push(`句読点か閉じかっこが行の頭 ${at}`);
        else if('（「『【'.includes(arr[prev].ch))bad.push(`開きかっこが行の末尾 ${at}`);
      }
      prev=i;
    }
  }
  return [...new Set(bad)];
}

test('どのタブも、375px・768px・1280pxで押す所が44px以上あり、横にはみ出さず、語の途中で折れない',async()=>{
  const {ctx,page,errors}=await open();
  await page.locator('#sp0').click();
  // 300日すすめて、どのタブにも中身を出す。寺院に常連を1人置き、帳場に蘇生の見立てのかっこ書きを出す
  const ids=await page.evaluate(()=>{
    for(let i=0;i<300*TICKS_PER_DAY;i++){tick(S);rivalTemple(S);}
    const ours=Object.values(S.adv).filter(x=>x.tav==='ours'&&!['lost','retired','dead','ash'].includes(x.status));
    const a=ours.find(x=>x.lvl>=10);
    a.status='dead';a.hp=0;a.party=null;a.traits=(a.traits||[]).concat(['信心深い']);S.blessUntil=S.tick+30*TICKS_PER_DAY;
    render();
    // 手帳は、寺院で眠る常連とほかの常連に加えて、素質ごとに1人ずつと、いちばんレベルの高い者（銀の杯亭の客も含む）を開く
    const live=Object.values(S.adv).filter(x=>x!==a&&!['lost','retired'].includes(x.status));
    const more=Object.keys(TAL).map(t=>live.find(x=>x.tal===t)).concat([live.slice().sort((x,y)=>y.lvl-x.lvl)[0]]);
    return [...new Set([a.id,ours.find(x=>x!==a).id,...more.filter(Boolean).map(x=>x.id)])];
  });
  const widths=[[375,740],[768,1024],[1280,800]];
  const check=async(width,what)=>{
    await page.evaluate(()=>document.fonts.ready);
    assert.deepEqual(await page.evaluate(screenAudit),[],`${width}px の${what}`);
  };
  // 300日のあいだにたまった常連のひと幕
  assert.equal(await page.locator('#life').isVisible(),true,'ひと幕が出ていない');
  for(const [width,height] of widths){await page.setViewportSize({width,height});await check(width,'ひと幕');}
  await page.locator('#lf-btn').click();
  const tabs=await page.locator('#tabs button[data-act="tab"]').evaluateAll(bs=>bs.map(b=>b.dataset.v));
  assert.deepEqual(tabs,['news','bar','roster','rank','stone','ref','desk','shop','maps']);
  for(const [width,height] of widths){
    await page.setViewportSize({width,height});
    for(const v of tabs){
      await page.locator(`#tabs button[data-v="${v}"]`).click();
      assert.ok((await page.locator('#tbody').innerText()).length>200,`${v} の中身が少ない`);
      // 酒場は土産話（話した者・一行・性格の添え書き）が出ている状態で見る
      if(v==='bar')assert.ok(await page.locator('#tbody .quote .by').count()>0,'酒場に土産話が出ていない');
      await check(width,v);
    }
    // 冒険者の手帳。寺院で眠る常連と、ほかの常連
    for(const id of ids){
      await page.evaluate(id=>{advOpen=id;$('advm').hidden=false;renderAdv();},id);
      await check(width,'手帳');
      await page.keyboard.press('Escape');
    }
  }
  await page.locator('#tabs button[data-v="desk"]').click();
  assert.match(await page.locator(`#tbody .row:has(button[data-act="revive"][data-a="${ids[0]}"])`).innerText(),/（寄進で上がっている。信心深く、成功しやすい）/);
  // 死体回収の依頼の行。見込みの言葉と、預けると次の返済に足りなくなる一言が出ている状態と、依頼中の行
  await page.evaluate(()=>{
    const U=S.taverns.ours;if(!(U.debt>0))U.debt=60000;
    const ps=Object.values(S.parties).filter(x=>x.state==='town'||x.state==='explore'||x.state==='return').slice(0,2);
    ps.forEach((p,i)=>{p.members.forEach(id=>{const a=S.adv[id];a.status='missing';a.hp=0;a.party=p.id;});
      Object.assign(p,{state:'wiped',retrieved:false,announced:true,knownWiped:false,causeTold:false,wipedAt:S.tick,floor:p.floor||5,killer:'オーク',cause:'オークに倒れた',carried:[]});
      if(i)S.bounties[p.id]=bountyPrice(p);});
    U.gold=bountyPrice(ps[0])+nextDue(S).due-1;render();
  });
  assert.match(await page.locator('#tbody').innerText(),/預けると、次の返済に足りなくなる/);
  assert.match(await page.locator('#tbody').innerText(),/依頼中/);
  for(const [width,height] of widths){await page.setViewportSize({width,height});await check(width,'帳場の死体回収の依頼');}
  // 完済の場面。300日のうちに返し終えていなければ、ここで返し終える
  await page.evaluate(()=>{const U=S.taverns.ours;if(U.debt>0){U.gold+=U.debt;repay(S,U.debt);}U.payoffScene=true;render();});
  assert.equal(await page.locator('#payoff').isVisible(),true,'完済の場面が出ていない');
  for(const [width,height] of widths){await page.setViewportSize({width,height});await check(width,'完済の場面');}
  await page.locator('#po-btn').click();
  assert.deepEqual(errors,[]);await ctx.close();
});
