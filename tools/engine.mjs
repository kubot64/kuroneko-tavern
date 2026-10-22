// index.html の /*ENGINE START*/〜/*ENGINE END*/ を取り出して node で動かす。spec-test と measure が使う。
// テストから使う名前の一覧は持たない。E.名前 と書くと、エンジンのトップレベルの宣言（function・const・let）をその名前で引く。
// エンジンに関数を足しても、ここを直さずにテストから使える。ない名前は undefined になる（--base で測る古いエンジンのため）
export const engineOf=html=>html.match(/\/\*ENGINE START\*\/([\s\S]*?)\/\*ENGINE END\*\//)[1];

const NAME=/^[A-Za-z_$][\w$]*$/;
// params はエンジンに渡す引数（{Math:M} など）。引いた値は名前ごとに覚え、2回目からは同じものを返す
export function loadEngine(engine,params={}){
  const keys=Object.keys(params);
  const look=new Function(...keys,`${engine}\n;return __k=>{try{return eval(__k);}catch(e){if(e instanceof ReferenceError)return undefined;throw e;}};`)(...keys.map(k=>params[k]));
  const got=new Map();
  return new Proxy({},{get(_,k){
    if(typeof k!=='string'||!NAME.test(k))return undefined;
    if(!got.has(k))got.set(k,look(k));
    return got.get(k);
  }});
}
