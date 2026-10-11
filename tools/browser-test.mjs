// 画面まわりの決まりを、本物のブラウザ（Playwright の Chromium）で index.html を開いて確かめる。
// 時計は Playwright の偽の時計に差し替え、待たずに時間を進める。タブの表と裏は visibilityState を差し替えて起こす。
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
async function open({ctx,time=Date.UTC(2026,0,1)}={}){
  ctx=ctx||await browser.newContext();
  const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time});
  await page.goto(URL_);
  return {ctx,page,errors};
}
const tick=page=>page.evaluate('S.tick');
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
      for(const a of ms){if(!text.includes(a.name)||!text.includes(a.cls))bad.push(`${p.name} に ${a.name}（${a.cls}）がいない`);}
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
    return btn.top<label.bottom;
  });
  assert.equal(desk,true,'広い画面では返済ボタンが見出しの横にある');
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

test('帳場の蘇生は、押す前に状態と成功率が出て、押した直後に成否が残る',async()=>{
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
  assert.match(before,/死・成功率の目安 \d+%/);
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
  assert.match(ash,/灰・成功率の目安 \d+%/);
  assert.equal(await page.evaluate(()=>S.taverns.ours.gold),gold0-cost);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kuroneko-tavern-v1')));
  assert.equal(saved.S.reviveNote,undefined);
  assert.equal(saved.S.v,22);
  assert.equal(saved.S.adv[prep.id].status,'ash');
  const again=await open({ctx,time:Date.UTC(2026,0,1)});
  await again.page.locator('#sp0').click();
  await again.page.locator('button[data-v="desk"]').click();
  assert.equal(await again.page.locator('.revive-result').count(),0,'閉じたあとに成否の一文が残っている');
  const kept=await again.page.locator('#tbody .row',{has:again.page.locator(`button[data-act="revive"][data-a="${prep.id}"]`)}).innerText();
  assert.match(kept,/灰・成功率の目安/);
  await again.page.evaluate(()=>{Math.random=()=>0;});
  await again.page.locator(`button[data-act="revive"][data-a="${prep.id}"]`).click();
  assert.equal(await again.page.locator('.revive-result').innerText(),`${prep.name}がよみがえった`);
  assert.equal(await again.page.locator('.toast').innerText(),`${prep.name}がよみがえった`);
  assert.equal(await again.page.locator(`button[data-act="revive"][data-a="${prep.id}"]`).count(),0);
  const other=await again.page.evaluate(()=>{
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&x.status!=='lost'&&x.status!=='retired'&&x.status!=='dead'&&x.status!=='ash');
    a.status='ash';a.hp=0;a.party=null;S.taverns.ours.gold=100000;render();
    return {id:a.id,name:a.name};
  });
  await again.page.evaluate(()=>{Math.random=()=>0.999;});
  await again.page.locator(`button[data-act="revive"][data-a="${other.id}"]`).click();
  assert.equal(await again.page.locator('.revive-result').innerText(),`${other.name}は蘇生に失敗し、ロストした`);
  assert.equal(await again.page.evaluate(id=>S.adv[id].status,other.id),'lost');
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
    const bad=[];
    const r=row.getBoundingClientRect();
    if(r.left<-1||r.right>innerWidth+1)bad.push('行が横にはみ出す');
    if(document.documentElement.scrollWidth>innerWidth+1)bad.push('ページが横にはみ出す');
    const hint=row.querySelector('.does'),btn=row.querySelector('button[data-act="revive"]');
    if(!hint.innerText.includes('死・成功率の目安')||!hint.innerText.includes('寄進で上がっている'))bad.push(hint.innerText);
    if(btn.getBoundingClientRect().top<hint.getBoundingClientRect().bottom-1)bad.push('ボタンが見出しの横にある');
    return bad;
  },other.id);
  assert.deepEqual(phone,[]);
  await again.page.setViewportSize({width:1280,height:800});
  await again.page.locator('h3',{hasText:'常連への手当て'}).scrollIntoViewIfNeeded();
  const wide=await again.page.evaluate(id=>{
    const row=document.querySelector(`button[data-act="revive"][data-a="${id}"]`)?.closest('.row');
    if(!row)return ['行がない'];
    const who=row.querySelector('.who').getBoundingClientRect(),btn=row.querySelector('button[data-act="revive"]').getBoundingClientRect();
    const bad=[];
    if(!(btn.top<who.bottom&&btn.left>who.left))bad.push('広い画面でボタンが見出しの横にない');
    if(!row.innerText.includes('成功率の目安'))bad.push('目安がない');
    return bad;
  },other.id);
  assert.deepEqual(wide,[]);
  assert.deepEqual([...errors,...again.errors],[]);await ctx.close();
});
