const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'food-quiz-game.html'), 'utf8');
const bank = require(path.join(root, 'food-quiz-bank.js'));
delete require.cache[require.resolve(path.join(root, 'food-quiz-bank.js'))];
assert.deepEqual(require(path.join(root, 'food-quiz-bank.js')).questions, bank.questions, 'Question records and IDs stay stable across loads');
const browserBankContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'food-quiz-bank.js'), 'utf8'), browserBankContext);
assert.equal(JSON.stringify(browserBankContext.window.FoodQuizBank), JSON.stringify(bank), 'Browser and Node load the identical bank');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attrs, body]) => {
  const src = attrs.match(/\bsrc=["']([^"']+)["']/)?.[1];
  if (!src) return body;
  assert(!/^(?:https?:)?\/\//.test(src), 'The quiz must work without third-party scripts');
  if (src.split('?')[0] === 'food-quiz-bank.js') return 'window.FoodQuizBank = __testBank;';
  return fs.readFileSync(path.join(root, src.split('?')[0]), 'utf8');
});
scripts.forEach(script => new vm.Script(script));
const expectedCounts = { easy: 400, normal: 350, hard: 250 };
assert.deepEqual(bank.levels.map(level => level.id), Object.keys(expectedCounts));
for (const level of bank.levels) assert.equal(level.count, expectedCounts[level.id], 'Shown tier count matches the actual pool');
const difficultyButton = difficulty => 'difficulty' + difficulty[0].toUpperCase() + difficulty.slice(1);
const foodById = new Map(bank.foods.map(food => [food.id, food]));
const questionById = new Map(bank.questions.map(question => [question.id, question]));
const factById = new Map(bank.facts.map(fact => [fact.id, fact]));
assert.equal(bank.questions.length, 1000, 'Exactly 1,000 authored question records');
assert.equal(questionById.size, 1000, 'Question IDs are globally unique');
assert.equal(new Set(bank.questions.map(q => q.clue.replace(/\s+/g, ' ').trim())).size, 1000, 'Every written clue is distinct');
assert.equal(new Set(bank.questions.map(q => q.answer + '|' + [...q.facts].sort().join('|'))).size, 1000, 'Different wording alone cannot create another question');
assert.equal(foodById.size, bank.foods.length);
for (const food of bank.foods) {
  assert(/^[ぁ-ゖー ・]+$/.test(food.name), `Hiragana-first food name: ${food.name}`);
  assert(Array.isArray(food.facts) && food.facts.length, `${food.id} has a factual catalogue`);
  assert.equal(new Set(food.facts).size, food.facts.length, `${food.id} has distinct facts`);
  assert(Array.isArray(food.possibleFacts), `${food.id} distinguishes possible facts from verified facts`);
  assert(food.facts.every(fact => food.possibleFacts.includes(fact)), `${food.id} possible facts include everything verified`);
  assert(typeof food.svg === 'string' && food.svg.length > 20, `${food.id} has packaged art`);
  assert(!/<(?:script|foreignObject|image)\b|\bon\w+\s*=|javascript:|https?:\/\//i.test(food.svg), `${food.id} art has no active or external resources`);
  for (const [, data] of food.svg.matchAll(/\bd="([^"]*)"/g)) {
    assert(!/-\s+\d/.test(data), `${food.id} SVG numbers cannot have a space after a minus sign`);
    assert(/^[MmZzLlHhVvCcSsQqTtAaEe\d\s.,+\-]*$/.test(data), `${food.id} SVG contains no invalid path words`);
  }
}
for (const [difficulty, expected] of Object.entries(expectedCounts)) {
  const pool = bank.questions.filter(q => q.difficulty === difficulty);
  assert.equal(pool.length, expected, `${difficulty} pool size`);
  assert(new Set(pool.map(q => q.answer)).size >= 5, `${difficulty} has enough answers for a varied round`);
  for (const question of pool) {
    assert(/^[a-z0-9_-]+$/i.test(question.id), `Stable machine-readable ID: ${question.id}`);
    assert(question.clue.trim(), `${question.id} has a clue`);
    assert(!/[一-龯ァ-ヺ]/u.test(question.clue), `${question.id} clue stays readable in hiragana`);
    assert.equal(question.choices.length, 3, `${question.id} has three cards`);
    assert.equal(new Set(question.choices).size, 3, `${question.id} cards are distinct`);
    assert(question.choices.every(id => foodById.has(id)), `${question.id} references existing food art`);
    assert(question.facts.length > 0 && new Set(question.facts).size === question.facts.length);
    assert(question.facts.every(fact => foodById.get(question.answer).facts.includes(fact)), `${question.id} answer definitely has every clue fact`);
    const matching = question.choices.filter(id => question.facts.every(fact => (foodById.get(id).possibleFacts ?? foodById.get(id).facts).includes(fact)));
    assert.deepEqual(matching, [question.answer], `${question.id} has exactly one answer satisfying ALL stated facts`);
    if (difficulty === 'hard') {
      for (const fact of question.facts) assert(question.choices.some(id => id !== question.answer && (foodById.get(id).possibleFacts ?? foodById.get(id).facts).includes(fact)), `${question.id} requires combining hints, not just finding one unique clue`);
      for (const fact of question.facts) assert(question.choices.some(id => id !== question.answer && foodById.get(id).facts.includes(fact)), `${question.id} has a real competing match for each individual hint`);
    }
    const clueTexts = question.facts.map(id => factById.get(id)?.text);
    assert(!(clueTexts.includes('おさらに のって いる') && question.facts.includes('k:plate')), `${question.id} repeats the same plate clue`);
    assert(!(clueTexts.includes('そとに つぶつぶが ある') && question.facts.includes('k:berryOutside')), `${question.id} repeats the same outside-dots clue`);
  }
}
assert.equal(bank.questions.filter(q => Object.hasOwn(expectedCounts, q.difficulty)).length, 1000);
// These independent counterexamples caught real ambiguities in the first generated bank.
// A missing catalogue property is not evidence that a pictured alternative is wrong.
const independentlyKnown = {
  cherry: ['k:juice', 'k:cut', 'k:above'], orange: ['k:cut', 'k:above'], corn: ['k:cut'],
  ricecracker: ['k:salt', 'k:plate'], apple: ['k:above'], peach: ['k:above'], pear: ['k:above'], lemon: ['k:above']
};
for (const question of bank.questions) for (const id of question.choices.filter(id => id !== question.answer)) {
  const compatible = new Set([...foodById.get(id).facts, ...(independentlyKnown[id] ?? [])]);
  assert(!question.facts.every(fact => compatible.has(fact)), `${question.id}: ${id} is also a plausible correct answer after independent factual review`);
}
for (const id of ['tofu', 'cheese']) assert(!foodById.get(id).facts.includes('k:cool'), `${id}: cooling is not the process that coagulates this food`);

function setup(seed, withSpeech = false) {
  const elements = new Map(), events = {}, windowEvents = {}, utterances = [];
  let cancelCount = 0;
  function element(id = '') {
    const item = { id, hidden: ['play', 'finish', 'next', 'audioNote'].includes(id), dataset: {}, attributes: {}, children: [], events: {}, disabled: false, isConnected: true, textContent: '', innerHTML: '', className: '', tabIndex: 0,
      setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; }, addEventListener(k, v) { this.events[k] = v; }, focus() {},
      replaceChildren(...children) { for (const child of this.children) child.isConnected = false; this.children = []; this.append(...children); },
      append(...children) { for (const child of children) { child.isConnected = true; this.children.push(child); } }, querySelectorAll() { return this.children; },
      click() { if (!this.disabled) this.events.click?.(); } };
    const classes = new Set(); item.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) };
    return item;
  }
  const el = id => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); };
  const document = { hidden: false, body: element('body'), documentElement: element('html'), querySelector: () => null, getElementById: el, createElement: () => element(), addEventListener: (k, v) => events[k] = v,
    querySelectorAll: selector => selector.includes('difficulty') ? Object.keys(expectedCounts).map(d => el(difficultyButton(d))) : [] };
  for (const difficulty of Object.keys(expectedCounts)) el(difficultyButton(difficulty)).dataset.difficulty = difficulty;
  el('difficultyChoices').children = Object.keys(expectedCounts).map(d => el(difficultyButton(d)));
  const math = Object.create(Math); math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const window = { addEventListener: (k, v) => windowEvents[k] = v };
  const context = { window, document, Math: math, __testBank: bank };
  if (withSpeech) {
    const speechSynthesis = { cancel() { cancelCount++; }, getVoices: () => [{ lang: 'ja-JP' }], speak(utterance) { utterances.push(utterance); utterance.onstart?.(); } };
    const SpeechSynthesisUtterance = function(text) { this.text = text; };
    Object.assign(window, { speechSynthesis, SpeechSynthesisUtterance }); Object.assign(context, { speechSynthesis, SpeechSynthesisUtterance });
  }
  vm.runInNewContext(scripts.join('\n'), context);
  return { game: window.FoodQuiz, el, events, windowEvents, document, utterances, get cancelCount() { return cancelCount; } };
}

const seen = new Set(), positions = new Set(); let count = 0;
function finishRound(app, difficulty, detailed = true) {
  const { game, el } = app; const initial = game.getState();
  assert.equal(initial.deck.length, 5); assert.equal(new Set(initial.deck.map(q => q.id)).size, 5);
  assert(initial.deck.every(q => q.difficulty === difficulty), 'Every question belongs to the selected difficulty');
  let stale;
  for (let index = 0; index < 5; index++) {
    const before = game.getState(), q = before.question;
    assert.equal(before.index, index); assert.equal(before.phase, 'play'); assert.equal(before.stars, index); assert.equal(before.answered, false); assert.equal(before.difficulty, difficulty);
    assert(questionById.has(q.id)); assert.equal(q.difficulty, difficulty);
    assert.equal(el('next').hidden, true); assert.equal(el('cards').children.length, 3);
    const unchanged = JSON.stringify(before);
    el('next').events.click(); assert.equal(JSON.stringify(game.getState()), unchanged);
    if (stale) { const feedback = el('feedback').textContent; stale.events.click(); assert.equal(JSON.stringify(game.getState()), unchanged, 'Detached cards cannot affect later questions'); assert.equal(el('feedback').textContent, feedback); }
    if (detailed) for (const card of el('cards').children.filter(c => c.dataset.answer !== q.answer)) for (let repeat = 0; repeat < 3; repeat++) { card.click(); assert.equal(JSON.stringify(game.getState()), unchanged, 'Wrong answers preserve question and stars'); assert.equal(el('next').hidden, true); }
    const correct = el('cards').children.find(c => c.dataset.answer === q.answer); correct.click();
    const solved = game.getState(); assert.equal(solved.stars, index + 1); assert.equal(solved.index, index); assert.equal(solved.answered, true); assert.equal(el('next').hidden, false); assert(el('cards').children.every(c => c.disabled));
    for (const card of el('cards').children) card.events.click(); assert.equal(JSON.stringify(game.getState()), JSON.stringify(solved), 'Duplicate taps cannot award extra stars');
    seen.add(q.answer); positions.add(q.choices.indexOf(q.answer)); stale = correct;
    el('next').click(); const advanced = JSON.stringify(game.getState()); el('next').events.click(); assert.equal(JSON.stringify(game.getState()), advanced, 'Repeated Next cannot skip'); count++;
  }
  assert.equal(game.getState().phase, 'finish'); assert.equal(game.getState().stars, 5); assert.equal(el('play').hidden, true); assert.equal(el('finish').hidden, false);
  return stale;
}
for (const difficulty of Object.keys(expectedCounts)) for (let seed = 1; seed <= 100; seed++) {
  const app = setup(seed), { game, el } = app;
  assert.equal(game.getState().phase, 'start'); assert.equal(game.getState().difficulty, 'easy', 'Four-year-olds start on easy');
  el(difficultyButton(difficulty)).click(); assert.equal(game.getState().difficulty, difficulty);
  for (const level of Object.keys(expectedCounts)) assert.equal(el(difficultyButton(level)).getAttribute('aria-checked'), String(level === difficulty));
  el('startButton').click(); const firstIds = new Set(game.getState().deck.map(q => q.id));
  const stale = finishRound(app, difficulty);
  el('again').click(); assert.equal(game.getState().stars, 0); assert.equal(game.getState().index, 0); assert.equal(game.getState().difficulty, difficulty); assert.equal(el('finish').hidden, true);
  assert(game.getState().deck.every(q => !firstIds.has(q.id)), 'Replay draws new questions');
  const restarted = JSON.stringify(game.getState()), feedback = el('feedback').textContent; stale.events.click(); assert.equal(JSON.stringify(game.getState()), restarted); assert.equal(el('feedback').textContent, feedback);
  const abandoned = el('cards').children[0]; el('changeDifficulty').click(); assert.equal(game.getState().phase, 'start'); const returned = JSON.stringify(game.getState()); abandoned.events.click(); assert.equal(JSON.stringify(game.getState()), returned);
  const nextDifficulty = difficulty === 'hard' ? 'easy' : 'hard'; el(difficultyButton(nextDifficulty)).click(); el('startButton').click(); assert(game.getState().deck.every(q => q.difficulty === nextDifficulty));
  const switched = JSON.stringify(game.getState()); abandoned.events.click(); assert.equal(JSON.stringify(game.getState()), switched, 'Cards from previous tier cannot affect new tier');
}
// Exhaust every pool in one visit: changes in tier must not mix queues or repeat before exhaustion.
for (const difficulty of Object.keys(expectedCounts)) {
  const app = setup(1701), ids = new Set(); app.el(difficultyButton(difficulty)).click(); app.el('startButton').click();
  for (let round = 0; round < expectedCounts[difficulty] / 5; round++) {
    for (const question of app.game.getState().deck) { assert(!ids.has(question.id), `${difficulty}: repeated ${question.id} before pool exhaustion`); ids.add(question.id); }
    finishRound(app, difficulty, false); if (round + 1 < expectedCounts[difficulty] / 5) app.el('again').click();
  }
  assert.equal(ids.size, expectedCounts[difficulty]); app.el('finishDifficulty').click(); assert.equal(app.game.getState().phase, 'start');
}
// Speech failures and stale callbacks may not corrupt a later screen or defeat mute.
{
  const app = setup(29); let prevented = 0;
  const key = (difficulty, value) => app.el(difficultyButton(difficulty)).events.keydown({ key: value, preventDefault() { prevented++; } });
  key('easy', 'ArrowRight'); assert.equal(app.game.getState().difficulty, 'normal');
  key('normal', 'End'); assert.equal(app.game.getState().difficulty, 'hard');
  key('hard', 'ArrowRight'); assert.equal(app.game.getState().difficulty, 'easy');
  key('easy', 'ArrowLeft'); assert.equal(app.game.getState().difficulty, 'hard');
  key('hard', 'Home'); assert.equal(app.game.getState().difficulty, 'easy');
  assert.equal(prevented, 5);
  assert.equal(app.el('difficultyEasy').tabIndex, 0); assert.equal(app.el('difficultyNormal').tabIndex, -1); assert.equal(app.el('difficultyHard').tabIndex, -1);
}
{
  const app = setup(10, true); app.el('startButton').click(); assert(app.utterances.length > 0); const old = app.utterances.at(-1);
  const cancellations = app.cancelCount; app.el('sound').click(); assert(app.cancelCount > cancellations); assert.equal(app.el('sound').getAttribute('aria-pressed'), 'false');
  old.onerror?.({ error: 'network' }); assert.equal(app.el('audioNote').hidden, true, 'Stale speech error stays hidden after mute');
  app.el('sound').click(); assert.equal(app.el('sound').getAttribute('aria-pressed'), 'true'); const fromPlay = app.utterances.at(-1);
  app.el('changeDifficulty').click(); fromPlay.onerror?.({ error: 'network' }); assert.equal(app.el('audioNote').hidden, true, 'Old question speech stays canceled after leaving play');
  const beforeHide = app.cancelCount; app.document.hidden = true; app.events.visibilitychange(); assert(app.cancelCount > beforeHide); const beforeUnload = app.cancelCount; app.windowEvents.pagehide(); assert(app.cancelCount > beforeUnload);
}
assert.equal(seen.size, bank.foods.length, 'All illustrated foods occur as answers'); assert.equal(positions.size, 3);
console.log(`PASS: 1000 unique factual questions (400/350/250); unique IDs/clues/semantic signatures; one fact-matching answer; ${count} played questions; all ${seen.size} foods; tier selection/default/replay/exhaustion; unlimited retries; duplicate/stale taps; finish/restart; speech cancellation.`);
