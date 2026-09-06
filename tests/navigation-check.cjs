const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const pages={moon:'moon-phase-game.html',piano:'sprunki-piano-game.html',addition:'sprunki-addition-game.html',guess:'sprunki-guess-game.html',food:'food-quiz-game.html'};
const markupTabs=[...html.matchAll(/<button\b[^>]*\bdata-game="([^"]+)"/g)].map(match=>match[1]);
assert.deepEqual(markupTabs,Object.keys(pages),'Every game route needs one visible navigation button');
function element(){const e={attrs:{},dataset:{},events:{},classes:new Set(),textContent:'',getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.events[k]=v;}};e.classList={toggle:(k,on)=>on?e.classes.add(k):e.classes.delete(k)};return e;}
function setup(search){const frame=element(),status=element(),body=element(),events={},calls=[];Object.defineProperty(frame,'src',{get(){return this.attrs.src;},set(value){this.attrs.src=value;}});const tabs=Object.keys(pages).map(game=>{const t=element();t.dataset.game=game;return t;});const location={pathname:'/moon-phase-game/index.html',search};const history={replaceState(state,title,url){calls.push({type:'replace',state,url});},pushState(state,title,url){calls.push({type:'push',state,url});}};const document={body,getElementById:id=>id==='gameFrame'?frame:status,querySelectorAll:()=>tabs};const window={addEventListener:(name,fn)=>events[name]=fn};vm.runInNewContext(script,{document,window,history,location,URLSearchParams});return {frame,status,body,tabs,events,location,calls};}
for(const initial of [...Object.keys(pages),'','invalid','__proto__','constructor','toString']){
 const app=setup(initial?'?game='+encodeURIComponent(initial):'');const expected=Object.hasOwn(pages,initial)?initial:'moon';assert.equal(app.frame.src.split('?')[0],pages[expected]);assert.equal(app.body.classes.has('moon-mode'),expected==='moon');assert.equal(app.calls[0].type,'replace');
 for(const tab of app.tabs){tab.events.click();const id=tab.dataset.game;assert.equal(app.frame.src.split('?')[0],pages[id]);assert.equal(app.body.classes.has('moon-mode'),id==='moon');assert.equal(app.calls.at(-1).state.game,id);assert.equal(app.calls.at(-1).type,'push');assert.equal(tab.attrs['aria-pressed'],'true');assert.equal(app.tabs.filter(t=>t.classes.has('is-active')).length,1);}
 for(const game of Object.keys(pages)){app.location.search='?game='+game;app.events.popstate();assert.equal(app.frame.src.split('?')[0],pages[game]);assert.equal(app.calls.at(-1).type,'replace');}
}
const moon=fs.readFileSync(path.join(root,pages.moon),'utf8');assert(/<a\b[^>]*href="index\.html\?game=guess"[^>]*target="_top"/.test(moon),'Moon needs a top-level route to guessing');
assert(/<a\b[^>]*href="index\.html\?game=food"[^>]*target="_top"/.test(moon),'Moon needs a top-level route to food quiz');
const foodApp=setup('?game=food');assert.equal(foodApp.status.textContent,'ごはんクイズ');assert.equal(foodApp.frame.title,'ごはんクイズ');
for(const file of ['index.html',...Object.values(pages)]){const source=fs.readFileSync(path.join(root,file),'utf8');for(const s of source.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(s[1],{filename:file});}
console.log('PASS: five game routes and visible buttons, deep links, invalid and prototype names, tab selection, history restoration, Moon entry links, food quiz title, and all inline JavaScript syntax.');
