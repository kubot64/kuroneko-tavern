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

test('裏に回ったときに保存するので、そのまま閉じられても次に開いたとき留守の時間が進む',async()=>{
  const {ctx,page,errors}=await open();
  await page.clock.runFor(1000);// 最後の保存（開店時）より時計を進めておく
  const hid=await page.evaluate(()=>Date.now());
  await hideFor(page,0,{show:false});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kuroneko-tavern-v1')));
  assert.ok(saved.at>=hid,'裏に回ったときに保存されていない');
  // スマホでは、裏に回ったページが pagehide なしで消されることがある。
  // 閉じたときにもう一度保存されると、偽の時計も実時間で進むので保存の時刻が少しずれる。1時間を切って「約60分」と出ないよう、1分足しておく
  await page.close();
  const again=await open({ctx,time:saved.at+HOUR+60*1000});
  assert.ok(await digestShown(again.page),'次に開いたときに留守のあいだにが出ていない');
  await again.page.clock.runFor(5000);
  assert.match(await again.page.locator('#dg-sub').textContent(),/店をあけていたのは約1時間。/);
  assert.deepEqual([...errors,...again.errors],[]);await ctx.close();
});
