const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sprunki-addition-game.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
scripts.forEach(s => new vm.Script(s[1]));
const game = vm.runInNewContext(scripts[0][1] + '\nAdditionGame;');
let questions = 0;
for (const operation of ['add','subtract']) for (const max of [5, 10, 20]) {
  for (let seed = 1; seed <= 500; seed++) {
    let x = seed;
    const rng = () => ((x = (1664525 * x + 1013904223) >>> 0) / 4294967296);
    const state = game.createSession(max, rng, operation);
    assert.equal(state.deck.length, 5);
    for (let round = 0; round < 5; round++) {
      const p = state.deck[state.index];
      assert(p.a >= 1 && p.b >= 1 && p.total <= max && p.total >= 0);
      assert.equal(p.total, operation === 'add' ? p.a + p.b : p.a - p.b);
      if (operation === 'subtract') assert(p.a <= max && p.b <= p.a);
      if (max === 20) assert(operation === 'add' ? p.total > 10 : p.a > 10);
      assert.equal(new Set(p.choices).size, 3);
      assert(p.choices.includes(p.total));
      assert(p.choices.every(n => Number.isInteger(n) && n >= (operation === 'subtract' ? 0 : 1) && n <= max));
      assert.equal(game.next(state), false);
      assert.equal(game.answer(state, p.choices.find(n => n !== p.total)), 'retry');
      assert.equal(state.stars, round);
      for (let i = p.total - 1; i >= 0; i--) {
        assert.equal(game.count(state, i), p.total - i);
        assert.equal(game.count(state, i), null);
      }
      assert.equal(game.count(state, p.total), null);
      assert.equal(game.answer(state, p.total), 'correct');
      assert.equal(game.answer(state, p.total), 'ignored');
      assert.equal(state.stars, round + 1);
      assert.equal(game.next(state), true);
      assert.equal(game.next(state), false);
      questions++;
    }
    assert.equal(state.phase, 'complete');
    assert.equal(state.index, 4);
  }
}
const pngSignature = '89504e470d0a1a0a';
assert.throws(() => game.createSession(5, Math.random, 'multiply'), /Unsupported operation/);
for (const name of ['oren','sky','simon']) {
  const wav=fs.readFileSync(path.join(root,'sounds',name+'.wav'));
  assert.equal(wav.subarray(0,4).toString(),'RIFF');
  assert.equal(wav.subarray(8,12).toString(),'WAVE');
}
for (const name of ['sprunki-oren.png', 'sprunki-sky.png', 'sprunki-simon.png']) {
  assert.equal(fs.readFileSync(path.join(root, name)).subarray(0, 8).toString('hex'), pngSignature);
}
console.log(`PASS: ${questions} questions; bounds, choices, counting, retries, double taps, completion and PNG assets.`);
