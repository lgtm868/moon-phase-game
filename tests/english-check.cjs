const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','english-game.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
new vm.Script(script);
function setup(seed=1,voices=[{lang:'en-US'}],speech=true){
 const elements=new Map(),events={},windowEvents={},utterances=[];let cancels=0;
 function element(){const classes=new Set();return {hidden:false,children:[],attributes:{},style:{},dataset:{},disabled:false,textContent:'',setAttribute(k,v){this.attributes[k]=String(v)},getAttribute(k){return this.attributes[k]},append(...c){this.children.push(...c)},replaceChildren(...c){this.children=c},focus(){},classList:{add(...n){n.forEach(x=>classes.add(x))},remove(...n){n.forEach(x=>classes.delete(x))}},click(){if(!this.disabled)this.onclick?.()},addEventListener(k,v){this[k]=v}}}
 const el=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
 const homeButtons=[element(),element(),element()];
 const document={hidden:false,querySelector:()=>element(),getElementById:el,createElement:element,querySelectorAll:()=>homeButtons,addEventListener:(k,v)=>events[k]=v};
 const window={scrollTo(){},addEventListener:(k,v)=>windowEvents[k]=v};
 const MathCopy=Object.create(Math);MathCopy.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const context={window,document,Math:MathCopy};
 if(speech){window.speechSynthesis={cancel(){cancels++},getVoices:()=>voices,speak(u){utterances.push(u)}};window.SpeechSynthesisUtterance=context.SpeechSynthesisUtterance=function(text){this.text=text}}
 vm.createContext(context);vm.runInContext(script,context);
 return {el,events,windowEvents,document,utterances,homeButtons,read:x=>vm.runInContext(x,context),get cancels(){return cancels}};
}
function chooseCategory(app,key){app.el('category').value=key;app.el('category').onchange()}
let count=0;const seen=new Set();
{
 const app=setup();assert.equal(app.read('screen'),'quiz','Opening English goes straight to the quiz');assert.equal(app.read('category'),'animals');assert.equal(app.read('position'),0);assert.equal(app.read('answered'),false);assert.equal(app.el('choices').children.length,3);assert.equal(app.el('quiz').hidden,false);assert.equal(app.utterances.length,0,'Initial render does not speak without a user gesture');
 assert(!/id=["'](?:home|learn|learn-grid|start)["']/.test(html),'Garden and learning entry screens are removed');
 app.el('listen').click();assert.equal(app.utterances.length,1,'First listen tap starts English speech');assert.equal(app.utterances[0].text,app.read('deck[position][0]'));assert.equal(app.utterances[0].lang,'en-US');
}
for(let seed=1;seed<=100;seed++)for(const category of ['animals','food','colors']){
 const app=setup(Math.imul(seed,2654435761)>>>0);chooseCategory(app,category);assert.equal(app.read('category'),category);assert.equal(app.read('screen'),'quiz');
 assert.equal(app.read('deck.length'),5);assert.equal(app.read('new Set(deck.map(w=>w[0])).size'),5);
 let stale;
 for(let round=0;round<5;round++){
  assert.equal(app.read('position'),round);assert.equal(app.read('screen'),'quiz');assert.equal(app.read('answered'),false);
  const word=app.read('deck[position][0]'),ja=app.read('deck[position][1]');seen.add(word);
  const cards=app.el('choices').children;assert.equal(cards.length,3);assert.equal(new Set(cards.map(c=>c.attributes['aria-label'])).size,3);
  const right=cards.find(c=>c.attributes['aria-label']===ja),wrong=cards.find(c=>c!==right);assert(right);
  app.el('next').onclick();assert.equal(app.read('position'),round,'Unanswered next cannot skip');
  if(stale){const feedback=app.el('feedback').textContent;stale.onclick();assert.equal(app.read('answered'),false,'Detached correct card cannot answer later question');assert.equal(app.el('feedback').textContent,feedback)}
  for(let retry=0;retry<10;retry++){wrong.click();assert.equal(app.read('position'),round);assert.equal(app.read('answered'),false)}
  right.click();assert.equal(app.read('answered'),true);assert.equal(app.read('position'),round,'Correct answer waits for manual next');assert.equal(app.el('next').hidden,false);assert(cards.every(c=>c.disabled));
  const oldVoice=app.utterances.at(-1);stale=right;app.el('next').onclick();oldVoice.onerror?.({error:'network'});assert.equal(app.read('audioFailed'),false,'Stale errors cannot affect the next question');count++;
 }
 assert.equal(app.read('screen'),'finish');app.el('next').onclick();assert.equal(app.read('screen'),'finish','Duplicate final next stays complete');assert.equal(app.read('position'),5);
 app.el('again').click();assert.equal(app.read('position'),0);assert.equal(app.read('answered'),false);assert.equal(app.read('screen'),'quiz');
 stale.onclick();assert.equal(app.read('answered'),false,'Previous session cards are invalid after restart');
}
assert.equal(seen.size,18);
{
 const app=setup();app.el('listen').click();assert.equal(app.utterances.at(-1).text,app.read('deck[position][0]'));assert.equal(app.utterances.at(-1).lang,'en-US');
 const old=app.utterances.at(-1);const before=app.cancels;app.el('sound').click();assert(app.cancels>before);assert.equal(app.el('hint').hidden,false);old.onerror?.({error:'network'});assert.equal(app.read('audioFailed'),false);
 const spoken=app.utterances.length;app.el('listen').click();assert.equal(app.utterances.length,spoken,'Mute suppresses listen');
 app.el('sound').click();const hiddenVoice=app.utterances.at(-1);app.document.hidden=true;const beforeHide=app.cancels;app.events.visibilitychange();assert(app.cancels>beforeHide);hiddenVoice.onerror?.({error:'network'});assert.equal(app.read('audioFailed'),false);app.el('listen').click();assert.equal(app.utterances.at(-1),hiddenVoice,'Hidden page cannot start speech');
 const beforePagehide=app.cancels;app.windowEvents.pagehide();assert(app.cancels>beforePagehide);
}
{
 const app=setup(1,[],false);chooseCategory(app,'food');assert.equal(app.el('hint').hidden,false);assert(app.el('audio-note').textContent);assert.equal(app.el('choices').children.length,3);
}
{
 const app=setup(1,[{lang:'ja-JP'}]);chooseCategory(app,'colors');assert.equal(app.el('hint').hidden,false,'Unavailable English voice reveals a usable Japanese hint');assert.equal(app.utterances.length,0,'Do not pronounce English with an unrelated voice');
}
{
 const app=setup();app.el('listen').click();const voice=app.utterances.at(-1);const oldCards=app.el('choices').children;const oldRun=app.read('runId');chooseCategory(app,'food');voice.onerror?.({error:'network'});assert.equal(app.read('audioFailed'),false,'Changing category invalidates old speech errors');assert.equal(app.read('screen'),'quiz');assert.equal(app.read('category'),'food');assert.equal(app.read('position'),0);assert.equal(app.read('answered'),false);assert.notEqual(app.read('runId'),oldRun);assert(app.read('deck.every(word=>DATA.food.words.includes(word))'));
 const spoken=app.utterances.length;for(const card of oldCards)card.onclick();assert.equal(app.utterances.length,spoken,'Detached previous-category choices cannot speak or answer');assert.equal(app.read('answered'),false);
 const run=app.read('runId');chooseCategory(app,'__proto__');assert.equal(app.read('runId'),run,'Prototype category values cannot start a round');assert.equal(app.read('category'),'food');
}

console.log(`PASS: ${count} English questions, all 18 words, unique targets/options, 15000 retries, manual next, stale cards, restart, mute/hidden/pagehide speech cancellation and no-speech fallback.`);
{
 const app=setup();
 app.read("window.results=[];window.MoonRanking={complete:value=>window.results.push(value)}");
 chooseCategory(app,'food');const firstRun=app.read('runId');
 for(let i=0;i<5;i++){
  const target=app.read('deck[position][1]');const cards=app.el('choices').children;
  if(i===0)cards.find(card=>card.attributes['aria-label']!==target).click();
  cards.find(card=>card.attributes['aria-label']===target).click();app.el('next').click();
 }
 const review=app.el('reviewWords').children;assert.equal(review.length,5);
 assert.equal(new Set(review.map(card=>card.attributes['aria-label'])).size,5);
 review[0].click();assert.equal(app.utterances.at(-1).text,app.read('deck[0][0]'));
 assert.equal(app.read('window.results.length'),1);assert.equal(app.read('window.results[0].metrics.firstTry'),4);
 assert.equal(app.read('window.results[0].runId'),firstRun);assert.equal(app.read('window.results[0].metrics.completed'),5);
 app.el('next').onclick();assert.equal(app.read('window.results.length'),1);
 app.el('again').click();assert.notEqual(app.read('runId'),firstRun);
 const spoken=app.utterances.length;review[0].onclick();assert.equal(app.utterances.length,spoken,'Old review cards cannot speak in a new round');
}
console.log('PASS: five earned review words, English replay, stale-review guard, optional first-try ranking and unique rounds.');



