const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'food-quiz-game.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
scripts.forEach(script => new vm.Script(script[1]));
function setup(seed) {
  const elements = new Map(), events = {}, windowEvents = {};
  function element(id = '') {
    return {id, hidden: ['play','finish','next','audioNote'].includes(id), dataset: {}, attributes: {}, children: [], events: {}, disabled: false, isConnected: true, textContent: '', innerHTML: '', className: '',
      classList: {add() {}}, setAttribute(k,v) {this.attributes[k]=v;}, addEventListener(k,v) {this.events[k]=v;}, focus() {},
      replaceChildren() {for(const child of this.children)child.isConnected=false; this.children=[];},
      append(child) {child.isConnected=true; this.children.push(child);}, querySelectorAll() {return this.children;},
      click() {if(!this.disabled)this.events.click?.();}};
  }
  const document = {hidden:false,getElementById(id) {if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},createElement:()=>element(),addEventListener:(k,v)=>events[k]=v};
  const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const window = {addEventListener:(k,v)=>windowEvents[k]=v};
  vm.runInNewContext(scripts.map(s=>s[1]).join('\n'),{window,document,Math:math});
  return {game:window.FoodQuiz,el:document.getElementById,events,windowEvents};
}
const seen = new Set(), positions = new Set();let count=0;
for(let seed=1;seed<=500;seed++) {
  const app=setup(seed),{game,el}=app;
  assert.equal(game.getState().phase,'start');
  el('startButton').click();
  const initial=game.getState();
  assert.equal(initial.deck.length,5);
  assert.equal(new Set(initial.deck.map(q=>q.answer)).size,5);
  let stale;
  for(let index=0;index<5;index++) {
    const before=game.getState(),q=before.question;
    assert.equal(before.index,index);assert.equal(before.phase,'play');assert.equal(before.stars,index);assert.equal(before.answered,false);
    assert.equal(q.choices.length,3);assert.equal(new Set(q.choices).size,3);assert.equal(q.choices.filter(id=>id===q.answer).length,1);
    assert(q.choices.every(id=>game.foods.some(f=>f.id===id)));
    assert.equal(el('next').hidden,true);assert.equal(el('cards').children.length,3);
    const unchanged=JSON.stringify(before);
    el('next').events.click();assert.equal(JSON.stringify(game.getState()),unchanged);
    if(stale){const feedback=el('feedback').textContent;stale.events.click();assert.equal(JSON.stringify(game.getState()),unchanged,'Detached cards cannot affect later questions');assert.equal(el('feedback').textContent,feedback,'Detached cards cannot replace later feedback');}
    for(const card of el('cards').children.filter(c=>c.dataset.answer!==q.answer))for(let repeat=0;repeat<3;repeat++) {card.click();assert.equal(JSON.stringify(game.getState()),unchanged,'Wrong answers preserve all progress');assert.equal(el('next').hidden,true);}
    const correct=el('cards').children.find(c=>c.dataset.answer===q.answer);correct.click();
    const solved=game.getState();assert.equal(solved.stars,index+1);assert.equal(solved.index,index);assert.equal(solved.answered,true);assert.equal(el('next').hidden,false);assert(el('cards').children.every(c=>c.disabled));
    for(const card of el('cards').children)card.events.click();assert.equal(JSON.stringify(game.getState()),JSON.stringify(solved),'Duplicate taps do not award extra stars');
    seen.add(q.answer);positions.add(q.choices.indexOf(q.answer));stale=correct;
    el('next').click();const advanced=JSON.stringify(game.getState());el('next').events.click();assert.equal(JSON.stringify(game.getState()),advanced,'Repeated Next cannot skip a question');count++;
  }
  assert.equal(game.getState().phase,'finish');assert.equal(game.getState().stars,5);assert.equal(el('play').hidden,true);assert.equal(el('finish').hidden,false);
  el('again').click();assert.equal(game.getState().stars,0);assert.equal(game.getState().index,0);assert.equal(game.getState().phase,'play');assert.equal(el('finish').hidden,true);
  const restarted=JSON.stringify(game.getState()),feedback=el('feedback').textContent;stale.events.click();assert.equal(JSON.stringify(game.getState()),restarted,'Detached cards cannot affect a new round');assert.equal(el('feedback').textContent,feedback);
  el('sound').click();assert.equal(el('sound').attributes['aria-pressed'],'false');el('sound').click();assert.equal(el('sound').attributes['aria-pressed'],'true');
}
const {game}=setup(1);
assert.equal(seen.size,game.foods.length);assert.equal(positions.size,3);
assert.equal(new Set(game.foods.map(f=>f.id)).size,game.foods.length);
for(const food of game.foods)assert(/^[ぁ-ゖー ]+$/.test(food.name),food.name);
for(const question of game.questions){assert(question.clue.trim());assert.equal(question.choices.filter(id=>id===question.answer).length,1);}
assert(!html.includes('seventy'),'SVG paths contain no invalid text');
console.log(`PASS: ${count} food questions; all ${seen.size} foods; unique choices; unlimited retries; no skips; duplicate and stale taps; finish/restart; sound controls; hiragana names; inline JavaScript syntax.`);
