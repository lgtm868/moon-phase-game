const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'sprunki-guess-game.html'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
scripts.forEach(s=>new vm.Script(s[1]));
const game=vm.runInNewContext(scripts[0][1]+';GuessGame;');
const seen=new Set();let questions=0;
for(let seed=1;seed<=500;seed++){
 let n=seed;const random=()=>((n=(Math.imul(1664525,n)+1013904223)>>>0)/4294967296);
 const state=game.createSession(random);assert.equal(state.deck.length,5);assert.equal(new Set(state.deck.map(q=>q.target.id)).size,5);
 for(let i=0;i<5;i++){
  const q=state.deck[i];seen.add(q.target.id);assert.equal(state.index,i);assert.equal(state.phase,'asking');assert.equal(q.choices.length,3);assert.equal(new Set(q.choices.map(c=>c.id)).size,3);assert.equal(q.choices.filter(c=>c.id===q.target.id).length,1);
  assert.equal(game.next(state),false);assert.equal(game.answer(state,'unknown'), 'ignored');assert.equal(game.answer(state,q.choices.find(c=>c.id!==q.target.id).id),'retry');assert.equal(state.stars,i);assert.equal(state.phase,'asking');assert.equal(state.deck[i],q);
  assert.equal(game.answer(state,q.target.id),'correct');assert.equal(state.stars,i+1);assert.equal(game.answer(state,q.target.id),'ignored');assert.equal(game.answer(state,q.choices.find(c=>c.id!==q.target.id).id),'ignored');assert.equal(game.next(state),true);assert.equal(game.next(state),false);questions++;
 }
 assert.equal(state.phase,'complete');assert.equal(state.stars,5);assert.equal(game.answer(state,state.deck[4].target.id),'ignored');
}
assert.equal(seen.size,8);
for(const c of game.characters){assert(/^[ぁ-ゖー]+$/.test(c.name));assert.equal(fs.readFileSync(path.join(root,c.file)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
console.log(`PASS: ${questions} questions; all eight characters; three unique choices; retries; double answers; double next; completion; hiragana names; packaged image integrity.`);
