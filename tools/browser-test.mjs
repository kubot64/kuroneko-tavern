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
