'use strict';

// Uses the installed Chrome and bundled Playwright, with no downloads or repo artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const runtime = process.env.GUESS_NODE_MODULES || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(runtime, 'playwright'));
const { PNG } = require(path.join(runtime, 'pngjs'));
const root = path.resolve(__dirname, '..');
const artifacts = process.env.GUESS_FUN_ARTIFACTS || path.join(os.tmpdir(), 'guess-fun-check');
const html = fs.readFileSync(path.join(root, 'sprunki-guess-game.html'), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const game = vm.runInNewContext(source + ';GuessGame');
const characters = JSON.parse(JSON.stringify(game.characters));
const rng = seed => () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);

let owned = [], modelQuestions = 0;
for (let seed = 1; seed <= 100; seed++) {
  const state = game.createSession(rng(seed));
  assert.equal(state.hintLevel, 0);
  for (const q of state.deck) {
    assert.equal(state.hintLevel, 0);
    assert.equal(game.collectRound(state).owned.length, 0, 'No premature awards');
    for (let i = 1; i <= 5; i++) assert.equal(game.revealHint(state), Math.min(i, 3));
    game.answer(state, q.choices.find(c => c.id !== q.target.id).id);
    const before = JSON.stringify(state);
    for (let i = 0; i < 4; i++) assert.equal(game.answer(state, q.choices.find(c => c.id !== q.target.id).id), 'retry');
    assert.equal(JSON.stringify(state), before, 'Retries preserve every state field');
    assert.equal(game.next(state), false);
    assert.equal(game.answer(state, q.target.id), 'correct');
    assert.equal(game.collectRound(state).owned.length, 0, 'Even fifth answer waits for reward button');
    assert.equal(game.answer(state, q.target.id), 'ignored');
    assert.equal(game.next(state), true);
    modelQuestions++;
  }
  const result = game.collectRound(state, owned);
  assert.equal(result.newIds.length, result.owned.length - owned.length);
  owned = result.owned;
  assert.equal(new Set(owned).size, owned.length);
  assert.equal(game.collectRound(state, owned).newIds.length, 0);
  const before = JSON.stringify(state);
  game.revealHint(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.firstTry, 0);
}
assert.equal(owned.length, 8);
assert.equal(game.collectRound(game.createSession(), ['unknown', 'oren', 'oren']).owned.join(), 'oren');
const firstTryState = game.createSession();
const runId = firstTryState.runId;
for (let i = 0; i < 5; i++) {
  const q = firstTryState.deck[i];
  game.answer(firstTryState, 'invalid');
  game.revealHint(firstTryState);
  if (i % 2) game.answer(firstTryState, q.choices.find(c => c.id !== q.target.id).id);
  game.answer(firstTryState, q.target.id);
  game.answer(firstTryState, q.target.id);
  game.next(firstTryState);
  assert.equal(firstTryState.runId, runId);
}
assert.equal(firstTryState.firstTry, 3);
assert.notEqual(game.createSession().runId, runId);
assert.equal(typeof runId, 'string');

// Deterministic media spies verify cancellation, not physical speaker output.
function browserSetup() {
  let seed = 43;
  Math.random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
  window.mediaLog = { cancels: 0, spoken: [], contexts: [] };
  window.rankingCalls = [];
  window.MoonRanking = { ready: true, complete(payload) { window.rankingCalls.push(payload); return Promise.resolve(); } };
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(text) { this.text = text; } } });
  Object.defineProperty(window, 'speechSynthesis', { value: {
    cancel() { window.mediaLog.cancels++; },
    getVoices() { return [{ lang: 'ja-JP' }]; },
    speak(utterance) { window.mediaLog.spoken.push(utterance); utterance.onstart?.(); }
  } });
  Object.defineProperty(window, 'AudioContext', { value: class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; window.mediaLog.contexts.push(this); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createOscillator() { return { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  } });
}

async function layout(frame, label) {
  await frame.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter(img => img.getClientRects().length).map(img => img.decode()));
  });
  const issues = await frame.evaluate(() => {
    const errors = [], visible = el => el.getClientRects().length > 0;
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) errors.push('Document overflow');
    const elements = [...document.querySelectorAll('button,h1,p,.hint,.friend,.question-panel,.cards,.hint-art,.friend span')].filter(visible);
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) errors.push(`Outside viewport: ${el.id || el.className}`);
      if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) errors.push(`Content overflow: ${el.id || el.className}`);
      if (el.matches('button') && (r.width < 44 || r.height < 44)) errors.push(`Small touch target: ${el.id || el.className}`);
    }
    for (const selectors of [['.question-panel', '.cards'], ['.cards', '#feedback'], ['#feedback', '#next'], ['#friends', '#again'], ['#collectionSummary', '#friends'], ['.helpers', '#hint'], ['#hint', '#audioNote']]) {
      const [a, b] = selectors.map(s => document.querySelector(s));
      if (!visible(a) || !visible(b)) continue;
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      if (Math.min(x.right, y.right) > Math.max(x.left, y.left) + 1 && Math.min(x.bottom, y.bottom) > Math.max(x.top, y.top) + 1) errors.push(`Overlap: ${selectors}`);
    }
    if (getComputedStyle(document.body).backgroundColor !== 'rgb(21, 25, 24)') errors.push('Shared theme lost');
    return errors;
  });
  assert.deepEqual(issues, [], label);
}

function pixelDifference(a, b) {
  const first = PNG.sync.read(a), second = PNG.sync.read(b);
  assert.equal(first.width, second.width); assert.equal(first.height, second.height);
  let changed = 0;
  for (let i = 0; i < first.data.length; i += 4) {
    if ([0, 1, 2].some(c => Math.abs(first.data[i + c] - second.data[i + c]) > 15)) changed++;
  }
  assert(changed > 40, `Hint stage must visibly change (${changed} pixels)`);
}

async function runCase(browser, viewport, embedded) {
  const label = `${viewport.width}x${viewport.height}-${embedded ? 'embedded' : 'direct'}`;
  const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(browserSetup);
  const page = await context.newPage(), errors = [], seen = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!req.url().startsWith('file:')) errors.push(`External asset: ${req.url()}`); });
  page.on('response', res => { if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`); });
  try {
    await page.goto(pathToFileURL(path.join(root, embedded ? 'index.html' : 'sprunki-guess-game.html')).href + (embedded ? '?game=guess' : ''));
    const frame = embedded ? await (await page.waitForSelector('#gameFrame')).contentFrame() : page.mainFrame();
    await frame.waitForSelector('#targetName');
    const shot = async name => {
      await layout(frame, `${label}-${name}`);
      await page.screenshot({ path: path.join(artifacts, `${label}-${name}.png`), fullPage: true });
    };
    await shot('initial');
    let collection = new Set(), round = 0, previousHint;
    do {
      const prior = new Set(collection), targets = [];
      for (let question = 0; question < 5; question++) {
        assert.equal(await frame.locator('#hint').isVisible(), false);
        assert.equal(await frame.locator('#hintButton').textContent(), 'かげを みる');
        const targetName = await frame.locator('#targetName').textContent();
        const target = characters.find(c => c.name === targetName);
        assert(target, 'Exact canonical name'); targets.push(target.id); seen.add(target.id);
        const cardIds = await frame.locator('.card').evaluateAll(cards => cards.map(c => c.dataset.id));
        assert.equal(new Set(cardIds).size, 3); assert(cardIds.includes(target.id));
        assert.deepEqual(await frame.locator('.pick').allTextContents(), ['この こ！', 'この こ！', 'この こ！']);
        for (let stage = 1; stage <= 3; stage++) {
          if (stage === 1 && !question) { await frame.locator('#hintButton').focus(); await page.keyboard.press('Enter'); }
          else await frame.locator('#hintButton').click();
          assert.equal(await frame.locator('#hint').getAttribute('data-level'), String(stage));
          assert.equal(await frame.locator('#hintButton').getAttribute('aria-expanded'), 'true');
          assert((await frame.locator('#hintImage').getAttribute('alt')).startsWith(target.name));
          assert((await frame.locator('#hintImage').getAttribute('src')) === target.file);
          if (!round && !question) {
            await frame.locator('#audioNote').evaluate(el => { el.hidden = false; });
            await shot(`hint-${stage}`);
            const pixels = await frame.locator('.hint-art').screenshot();
            if (stage > 1) pixelDifference(previousHint, pixels);
            previousHint = pixels;
          }
        }
        assert(await frame.locator('#hintButton').isDisabled());
        await frame.locator('#hintButton').evaluate(button => button.click());
        assert.equal(await frame.locator('#hint').getAttribute('data-level'), '3');
        const wrong = frame.locator(`.card[data-id="${cardIds.find(id => id !== target.id)}"]`);
        if (question % 2 === 0) for (let retry = 0; retry < 3; retry++) await wrong.click();
        assert.equal(await frame.locator('.star.earned').count(), question);
        assert.equal(await frame.locator('#targetName').textContent(), target.name);
        assert.deepEqual(await frame.locator('.card').evaluateAll(cards => cards.map(c => c.dataset.id)), cardIds);
        assert.equal(await frame.locator('#hint').getAttribute('data-level'), '3');
        assert.equal(await frame.locator('#next').isVisible(), false);
        await frame.locator('#next').evaluate(button => button.click());
        assert.equal(await frame.locator('#targetName').textContent(), target.name);
        if (!round && !question) await shot('retry');
        const correct = frame.locator(`.card[data-id="${target.id}"]`);
        await correct.click();
        await correct.evaluate(button => button.click());
        assert.equal(await frame.locator('.card:disabled').count(), 3);
        assert.equal(await frame.locator('.correct .pick').textContent(), target.name);
        assert.equal(await frame.locator('.star.earned').count(), question + 1);
        assert.equal(await frame.evaluate(() => rankingCalls.length), round, 'No queue before manual completion');
        if (!round && !question) {
          await page.waitForTimeout(2100);
          assert.equal(await frame.locator('#targetName').textContent(), target.name, 'No auto advance');
          await shot('solved');
          await frame.locator('#sound').click();
          await frame.evaluate(() => {
            if (!mediaLog.contexts.length || mediaLog.contexts.some(c => c.state !== 'closed')) throw Error('Mute must close chime');
            for (const u of mediaLog.spoken) { u.onstart?.(); u.onerror?.({ error: 'network' }); }
          });
          assert.equal(await frame.locator('#audioNote').isVisible(), false, 'Stale speech callbacks ignored');
          await frame.locator('#sound').click();
        }
        if (!round && question === 4) {
          await page.waitForTimeout(600);
          assert.equal(await frame.locator('#finish').isVisible(), false, 'Reward waits for user');
        }
        await frame.locator('#next').click();
        await frame.evaluate(() => { if (mediaLog.contexts.some(c => c.state !== 'closed')) throw Error('Advance must close chime'); });
      }
      assert.equal(new Set(targets).size, 5);
      const calls = await frame.evaluate(() => rankingCalls);
      assert.equal(calls.length, round + 1, 'One optional completion per round');
      assert.deepEqual(calls[round].metrics, { firstTry: 2, completed: 5, total: 5 });
      assert.equal(calls[round].game, 'guess'); assert.equal(calls[round].mode, 'default');
      assert.equal(new Set(calls.map(call => call.runId)).size, calls.length);
      await frame.locator('#next').evaluate(button => button.click());
      assert.equal(await frame.evaluate(() => rankingCalls.length), round + 1, 'Completion is queued once');
      targets.forEach(id => collection.add(id));
      assert.equal(await frame.locator('.friend').count(), 8);
      assert.equal(await frame.locator('.friend.owned').count(), collection.size);
      assert.equal(await frame.locator('.friend.new').count(), [...collection].filter(id => !prior.has(id)).length);
      assert.equal(await frame.locator('#collectionSummary').textContent(), collection.size === 8 ? 'みんな なかよし！ 8 / 8' : `なかよし ${collection.size} / 8`);
      for (const character of characters) {
        const slot = frame.locator(`.friend[data-id="${character.id}"]`);
        assert.equal(await slot.locator('img').count(), collection.has(character.id) ? 1 : 0);
        if (collection.has(character.id)) {
          assert((await slot.getAttribute('aria-label')).startsWith(character.name));
          await slot.click();
          assert.equal(await frame.evaluate(() => mediaLog.spoken.at(-1).text), character.name);
        }
      }
      await shot(`collection-${round + 1}`);
      await frame.locator('#sound').click();
      const spokenBefore = await frame.evaluate(() => mediaLog.spoken.length);
      await frame.locator('.friend.owned').first().click();
      assert.equal(await frame.evaluate(() => mediaLog.spoken.length), spokenBefore, 'Album respects mute');
      await frame.locator('#sound').click();
      const cancelsBefore = await frame.evaluate(() => mediaLog.cancels);
      await frame.locator('#again').click();
      assert((await frame.evaluate(() => mediaLog.cancels)) > cancelsBefore, 'Restart cancels voice');
      assert.equal(await frame.locator('.star.earned').count(), 0);
      assert.equal(await frame.locator('#hint').isVisible(), false);
      assert.equal(await frame.locator('#finish').isVisible(), false);
      round++;
    } while (round < 3 || (collection.size < 8 && round < 12));
    assert.equal(collection.size, 8);
    for (const mode of ['absent', 'throws', 'rejects']) {
      await frame.evaluate(mode => {
        window.MoonRanking = mode === 'absent' ? undefined : { complete() { if (mode === 'throws') throw Error('Optional hook failure'); return Promise.reject(Error('Optional hook failure')); } };
      }, mode);
      for (let i = 0; i < 5; i++) {
        const name = await frame.locator('#targetName').textContent();
        await frame.locator(`.card[data-id="${characters.find(c => c.name === name).id}"]`).click();
        await frame.locator('#next').click();
      }
      assert(await frame.locator('#finish').isVisible(), `Optional hook ${mode} cannot block reward`);
      await frame.locator('#again').click();
    }
    // Exercise visibility and page lifecycle while a real UI-triggered chime is active.
    for (const event of ['visibilitychange', 'pagehide']) {
      const name = await frame.locator('#targetName').textContent();
      await frame.locator(`.card[data-id="${characters.find(c => c.name === name).id}"]`).click();
      const cancels = await frame.evaluate(() => mediaLog.cancels);
      await frame.evaluate(event => {
        if (event === 'visibilitychange') {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event(event));
          delete document.hidden;
        } else window.dispatchEvent(new Event(event));
        if (mediaLog.contexts.some(c => c.state !== 'closed')) throw Error(`${event} must stop chime`);
      }, event);
      assert((await frame.evaluate(() => mediaLog.cancels)) > cancels);
      await frame.locator('#next').click();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${label}; ${round} rounds; ${seen.size} characters; hint pixels, retries, manual next, collection, layout, media cancellation`);
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    console.log(`Chrome ${browser.version()}; model: ${modelQuestions} questions`);
    for (const viewport of [{ width: 1024, height: 600 }, { width: 1180, height: 820 }]) {
      for (const embedded of [false, true]) await runCase(browser, viewport, embedded);
    }
    console.log(`Screenshots: ${artifacts}`);
  } finally {
    if (browser) await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
