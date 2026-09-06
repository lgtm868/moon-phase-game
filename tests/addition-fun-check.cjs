// node tests/addition-fun-check.cjs [--browser]
// Browser checks use installed Chrome and file://, never HTTP or ranking submission.
// Intentional opt-in contract: hands-on answers return 'remove-first' until b
// distinct physical counters are removed. Default answer/count contracts stay unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sprunki-addition-game.html'), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const game = vm.runInNewContext(source + '\nAdditionGame;');
const ids = n => Array.from({ length: n }, (_, i) => i);
let cases = 0;
for (const max of [5, 10, 20]) for (let a = 1; a <= max; a++) for (let b = 1; b <= a; b++) {
  const state = game.createSession(max, Math.random, 'subtract');
  const total = a - b;
  const p = { a, b, total, choices: [total, total + 1, total === 0 ? 2 : total - 1] };
  state.deck[0] = p;
  const runId = state.runId;
  assert.equal(game.setHandsOn(state, true), true);
  assert.equal(game.answer(state, p.total), 'remove-first');
  assert.equal(game.count(state, 0), null);
  assert.equal(state.attempted, false);
  assert.equal(state.stars, 0);
  for (const bad of [-1, a, 0.5, NaN, '0']) assert.equal(game.remove(state, bad), null);
  const order = [...ids(a).filter(i => i % 2), ...ids(a).filter(i => !(i % 2))];
  for (let i = 0; i < b; i++) {
    assert.equal(game.remove(state, order[i]), i + 1);
    assert.equal(game.remove(state, order[i]), null);
  }
  assert.equal(game.needsRemoval(state), false);
  const remaining = order.slice(b).reverse();
  for (const id of order.slice(0, b)) assert.equal(game.count(state, id), null);
  for (const [i, id] of remaining.entries()) {
    assert.equal(game.remove(state, id), null, 'No over-removal');
    assert.equal(game.count(state, id), i + 1, 'Count surviving physical IDs');
    assert.equal(game.count(state, id), null);
  }
  assert.equal(state.counted.length, p.total);
  assert.equal(game.answer(state, p.total + 1), 'retry');
  assert.equal(state.removed.length, b, 'Retry preserves completed manipulation');
  assert.equal(game.answer(state, p.total), 'correct');
  assert.equal(state.firstTry, 0);
  assert.equal(state.handsOnStars, 1);
  assert.equal(game.answer(state, p.total), 'ignored');
  assert.equal(game.setHandsOn(state, false), false);
  assert.equal(game.next(state), true);
  assert.equal(state.runId, runId);
  assert.equal(state.removed.length, 0);
  assert.equal(state.counted.length, 0);
  assert.equal(state.attempted, false);
  assert.equal(state.handsOn, true);
  cases++;
}
for (const operation of ['add', 'subtract']) for (const max of [5, 10, 20]) {
  const state = game.createSession(max, Math.random, operation);
  const runId = state.runId;
  assert.equal(typeof runId, 'string');
  assert.notEqual(game.createSession(max).runId, runId);
  assert.equal(game.remove(state, 0), null);
  if (operation === 'add') assert.equal(game.setHandsOn(state, true), false);
  for (let i = 0; i < 5; i++) {
    const p = state.deck[i];
    assert.equal(game.answer(state, -1), 'invalid');
    if (i === 1) {
      assert.equal(game.answer(state, p.choices.find(n => n !== p.total)), 'retry');
      if (operation === 'subtract') {
        game.setHandsOn(state, true);
        game.setHandsOn(state, false);
        assert.equal(state.attempted, true, 'Toggling cannot restore first-try credit');
      }
    }
    assert.equal(game.answer(state, p.total), 'correct');
    assert.equal(game.answer(state, p.total), 'ignored');
    assert.equal(game.next(state), true);
    assert.equal(state.runId, runId);
  }
  assert.equal(state.firstTry, 4);
  assert.equal(state.stars, 5);
  assert.equal(state.phase, 'complete');
  assert.equal(game.next(state), false);
}
const uuidGame = vm.runInNewContext(source + '\nAdditionGame;', { crypto: { randomUUID: () => 'test-uuid' } });
assert.equal(uuidGame.createSession().runId, 'test-uuid');
console.log(`PASS model: ${cases} subtraction pairs; physical IDs, gating, retries, zero, resets and first-try metrics.`);

async function browserChecks() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'addition-fun-'));
  const errors = [];
  const submissions = new Set();
  try {
    for (const viewport of [{ width: 1024, height: 600 }, { width: 1180, height: 820 }]) {
      for (const embedded of [false, true]) {
        const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        await page.clock.install();
        await page.clock.pauseAt(new Date(Date.now() + 1000));
        await page.goto(pathToFileURL(path.join(root, embedded ? 'index.html' : 'sprunki-addition-game.html')).href + (embedded ? '?game=addition' : ''));
        const f = embedded ? await (await page.locator('#gameFrame').elementHandle()).contentFrame() : page.mainFrame();
        await f.locator('#answers button').first().waitFor();
        // Keep file navigation real; intercept only the optional integration boundary.
        await f.evaluate(() => {
          window.rankingCalls = [];
          Object.defineProperty(window, 'MoonRanking', { configurable: true, writable: true, value: { complete(payload) { window.rankingCalls.push(payload); } } });
        });
        // Fixed valid questions cover worst-case density, asymmetry, and zero.
        // The original random deck is separately exercised by addition-check.cjs.
        await f.evaluate(() => {
          const original = AdditionGame.createSession;
          AdditionGame.createSession = (...args) => {
            const state = original(...args), max = state.max;
            state.deck = [max, 1, Math.floor(max / 2), max - 1, 2].map((b, i) => {
              const a = state.operation === 'subtract' ? max : i === 0 ? 1 : Math.floor(max / 2);
              if (state.operation === 'add') b = max - a;
              const total = state.operation === 'subtract' ? a - b : a + b;
              const alternatives = Array.from({ length: max + 1 }, (_, n) => n).filter(n => n !== total && (state.operation === 'subtract' || n > 0));
              return { a, b, total, choices: [alternatives[0], total, alternatives[1]] };
            });
            return state;
          };
        });
        const label = `${viewport.width}x${viewport.height}-${embedded ? 'embedded' : 'direct'}`;
        const tap = selector => f.locator(selector).tap();
        const geometry = () => f.locator('#left .character').evaluateAll(els => els.map(el => {
          const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
        }));
        async function layout(stage) {
          const issues = await f.evaluate(() => {
            const problems = [];
            for (const el of document.querySelectorAll('#play button,#play label,#play p,#equation,#party h2,#party p,#again')) {
              if (!el.getClientRects().length) continue;
              const r = el.getBoundingClientRect();
              if (r.x < -1 || r.right > innerWidth + 1 || r.y < -1 || r.bottom > innerHeight + 1) problems.push(`out of viewport: ${el.id || el.className}`);
              if (el.scrollWidth > el.clientWidth + 2) problems.push(`text overflow: ${el.id || el.className}`);
              if (el.matches('.character') && (r.width < 44 || r.height < 44)) problems.push('counter below 44px touch target');
            }
            const controls = [...document.querySelectorAll('.stage-top > *')].filter(el => el.getClientRects().length);
            for (let i = 1; i < controls.length; i++) if (controls[i - 1].getBoundingClientRect().right > controls[i].getBoundingClientRect().left) problems.push('stage controls overlap');
            for (const img of document.querySelectorAll('#groups img')) if (!img.complete || !img.naturalWidth) problems.push('missing character image');
            return problems;
          });
          assert.deepEqual(issues, [], `${label}/${stage}`);
        }
        for (const operation of ['add', 'subtract']) for (const max of [5, 10, 20]) {
          await tap(operation === 'add' ? '#addMode' : '#subtractMode');
          await f.locator('#level').selectOption(String(max));
          if (operation === 'subtract') {
            await f.locator('#handsOn').uncheck();
            assert.equal(await f.locator('#left .gone').count(), max, 'Default subtraction hint preserved');
            assert.equal(await f.locator('#answers button:enabled').count(), 3);
            await f.locator('#handsOn').check();
          } else assert(await f.locator('#handsOnLabel').isHidden());
          for (let round = 0; round < 5; round++) {
            const numbers = await f.locator('#equation > span').allTextContents();
            const a = Number(numbers[0]), b = Number(numbers[2]), total = operation === 'subtract' ? a - b : a + b;
            const choices = await f.locator('#answers button').allTextContents();
            if (operation === 'subtract') {
              assert.equal(await f.locator('#left .gone').count(), 0);
              assert.equal(await f.locator('#answers button:disabled').count(), 3);
              if (max === 20 && round === 0) await page.screenshot({ path: path.join(artifacts, `${label}-ready.png`) });
              const before = await geometry();
              const order = [...ids(a).filter(i => i % 2), ...ids(a).filter(i => !(i % 2))];
              for (let i = 0; i < b; i++) {
                const button = f.locator(`[data-counter-id="${order[i]}"]`);
                if (i === 0 && round === 1) { await button.focus(); await button.press('Space'); }
                else await button.tap();
                await button.dispatchEvent('click');
                assert.equal(await f.locator('#left .gone').count(), i + 1, 'Repeat activation cannot remove twice');
                assert.deepEqual(await geometry(), before, 'Removal never rearranges counters');
              }
              assert.equal(await f.locator('#answers button:enabled').count(), 3);
              assert.deepEqual(await f.locator('#answers button').allTextContents(), choices);
              assert.equal(await f.locator('#left button:enabled').count(), total);
              const survivors = f.locator('#left button:enabled');
              for (let i = total - 1; i >= 0; i--) {
                await survivors.nth(i).tap();
                await survivors.nth(i).tap();
                assert.equal(await f.locator('.counted').count(), total - i);
              }
            } else {
              const counters = f.locator('#groups button');
              for (let i = 0; i < total; i++) await counters.nth(i).tap();
              assert.equal(await f.locator('.counted').count(), total);
            }
            if (round === 0) {
              await f.locator('#answers button').filter({ hasText: new RegExp(`^${choices.find(n => Number(n) !== total)}$`) }).tap();
              assert.equal(await f.locator('.star.earned').count(), 0);
              assert(await f.locator('#next').isHidden());
              if (operation === 'subtract') assert.equal(await f.locator('#left .gone').count(), b);
            }
            await layout(`${operation}-${max}-${round}`);
            if (max === 20 && round === 2) await page.screenshot({ path: path.join(artifacts, `${label}-${operation}.png`) });
            await f.locator('#answers button').filter({ hasText: new RegExp(`^${total}$`) }).tap();
            assert.equal(await f.locator('.star.earned').count(), round + 1);
            if (operation === 'subtract') assert(await f.locator('#handsOn').isDisabled());
            if (round === 0 || round === 4) await page.clock.runFor(1801);
            else await tap('#next');
          }
          assert(await f.locator('#party').isVisible());
          await layout(`${operation}-${max}-party`);
          if (operation === 'subtract') assert.match(await f.locator('#party p').textContent(), /5もん/);
          if (operation === 'subtract' && max === 20) await page.screenshot({ path: path.join(artifacts, `${label}-party.png`) });
          const calls = await f.evaluate(() => window.rankingCalls);
          const call = calls.at(-1);
          assert.equal(call.game, 'addition');
          assert.equal(call.mode, `${operation === 'subtract' ? 'sub' : 'add'}-${max}`);
          assert.deepEqual(call.metrics, { firstTry: 4, completed: 5, total: 5 });
          assert(!submissions.has(call.runId), 'New session has a new ID');
          submissions.add(call.runId);
          await page.clock.runFor(6500);
          assert.equal(await f.evaluate(() => window.rankingCalls.length), calls.length, 'No duplicate completion');
          await tap('#again');
          assert.equal(await f.locator('.star.earned').count(), 0);
        }
        // Reset while partially manipulated; mode and level changes start cleanly.
        await tap('#subtractMode');
        await f.locator('#level').selectOption('20');
        await f.locator('#left button').first().tap();
        await f.locator('#handsOn').uncheck();
        assert.equal(await f.locator('#left .gone').count(), 20);
        assert.equal(await f.locator('#answers button:enabled').count(), 3);
        await f.locator('#handsOn').check();
        assert.equal(await f.locator('#left .gone').count(), 0);
        await f.locator('#left button').first().tap();
        await tap('#restart');
        assert.equal(await f.locator('#left .gone').count(), 0);
        await f.locator('#left button').first().tap();
        await tap('#addMode');
        assert.equal(await f.locator('#left .gone').count(), 0);
        assert.equal(await f.locator('#answers button:enabled').count(), 3);
        // A solved session's timer must not advance the replacement session.
        await f.locator('#answers button').filter({ hasText: /^20$/ }).tap();
        await tap('#restart');
        await page.clock.runFor(7000);
        assert.match(await f.locator('#round').textContent(), /^1 \/ 5/);
        assert.equal(await f.locator('.star.earned').count(), 0);
        // Hidden pages pause auto-advance and resume it only after becoming visible.
        await f.locator('#answers button').filter({ hasText: /^20$/ }).tap();
        await f.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.runFor(7000);
        assert.match(await f.locator('#round').textContent(), /^1 \/ 5/);
        await f.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.runFor(1801);
        assert.match(await f.locator('#round').textContent(), /^2 \/ 5/);
        // Missing, throwing and rejecting integrations cannot break completion.
        for (const behavior of ['missing', 'throw', 'reject']) {
          await f.evaluate(behavior => {
            Object.defineProperty(window, 'MoonRanking', { configurable: true, value: behavior === 'missing' ? undefined : { complete() { if (behavior === 'throw') throw new Error('offline'); return Promise.reject(new Error('offline')); } } });
          }, behavior);
          await tap('#restart');
          for (let i = 0; i < 5; i++) { await f.locator('#answers button').filter({ hasText: /^20$/ }).tap(); await tap('#next'); }
          assert(await f.locator('#party').isVisible());
        }
        await context.close();
        console.log(`PASS browser: ${label}; six modes, touch/keyboard, geometry, assets, retries, auto/manual advance and ranking.`);
      }
    }
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log(`Screenshots: ${artifacts}`);
  } finally { await browser.close(); }
}
if (process.argv.includes('--browser')) browserChecks().catch(error => { console.error(error); process.exitCode = 1; });
