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
  assert.equal(saved.S.v,26);
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
  assert.match(opened.pay,/5600/);
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
  assert.match(back.desk,/次の返済まであと30日・必要額5600G/);
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
    S.v=22;delete S.memo;S.taverns.ours.rep=4;
    const a=Object.values(S.adv).find(x=>x.tav==='ours'&&(x.trips||0)>=1);
    a.trips=2;migrate(S);const rep=S.taverns.ours.rep;render();
    const home=document.querySelector('#memo li[data-id="home"]');
    return {v:S.v,rep,home:home&&home.innerText,struck:!!home&&!!home.querySelector('s'),pay:document.querySelector('#payw').hidden};
  });
  assert.equal(old.v,26);
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
    S.deepest.ours=Math.max(S.deepest.ours,6);S.rares=S.rares||{};S.rares[1]={killed:{tav:'ours',tk:S.tick,party:'p',names:[a.name]}};
    S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.taverns.ours.debtFree??S.tick;
    render();
    const added=MEMO.filter(m=>!before.has(m.id)).reduce((s,m)=>s+m.rep,0);
    return {rep:S.taverns.ours.rep-rep0,added,show:memoState(S).show.length,log:memoState(S).log.length,pay:document.querySelector('#payw').hidden,desk:!!document.querySelector('#memo')};
  });
  assert.equal(done.rep,done.added);
  assert.equal(done.show,0);
  assert.equal(done.desk,false);
  assert.equal(done.log,9);
  assert.equal(done.pay,true);
  await page.locator('button[data-v="rank"]').click();
  assert.equal(await page.locator('#memo-log li').count(),9);
  assert.equal(await page.locator('#memo-log s').count(),9);
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
    return {n:cast.length,names:cast.map(a=>a.name),origins:cast.map(a=>a.origin),guests:guests&&guests.t,id:h.id,bg:h.bg,dream:dreamText(h.dream),texts:holders.map(a=>dreamText(a.dream)).sort(),prog:DREAMS.stele.prog(h)};
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
  assert.match(book,/まだ迷宮に潜っていない/);
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
  const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
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
    await frames();
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
    S.taverns.ours.seats=18;S.taverns.ours.cleanPay=S.tick;S.deepest.ours=30;
    S.rares={1:{killed:{tav:'ours',tk:S.tick,party:'p',names:[a.name]}}};
    S.taverns.ours.debt=0;S.taverns.ours.debtFree=S.tick;
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
    await page.evaluate(()=>{document.querySelector('.wrap').scrollTo(0,0);window.scrollTo(0,0);});
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
  for(const [width,height] of [[375,740],[1280,800]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
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
    await page.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
    const view=await read();
    assert.equal(view.wide,false,width+' でページが横にはみ出す');
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
