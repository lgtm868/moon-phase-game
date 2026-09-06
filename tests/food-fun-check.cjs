const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const { chromium } = require(path.join(runtime, 'node_modules/playwright'));
const bank = require('../food-quiz-bank.js');
const bankBefore = JSON.stringify(bank);
const url = pathToFileURL(path.resolve(__dirname, '../food-quiz-game.html')).href;
const key = 'moon-food-album-v1';
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'food-fun-'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
    await context.addInitScript(() => {
      // Keep optional shared ranking UI out of this feature test; verify its contract via a spy.
      window.__moonRankingBootstrapped = true;
      window.testSpeech = [];
      window.testCancels = 0;
      window.testCompletions = [];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        cancel() { window.testCancels++; }, getVoices() { return []; },
        speak(utterance) { window.testSpeech.push(utterance); }
      } });
      window.SpeechSynthesisUtterance = function(text) { this.text = text; };
      window.MoonRanking = { complete(payload) { window.testCompletions.push(payload); } };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const state = () => page.evaluate(() => window.FoodQuiz.getState());
    const ids = async () => (await state()).collectedIds;
    const open = () => page.locator('#albumButton').click();
    const close = () => page.locator('#albumClose').click();
    const answer = async (wrong = false) => {
      const q = (await state()).question;
      const id = wrong ? q.choices.find(id => id !== q.answer) : q.answer;
      await page.locator(`[data-answer="${id}"]`).click();
      return id;
    };
    const fit = async () => {
      const result = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('.top, .top-actions, #startButton, #prompt, #cards, #next, #again, .foot')]
          .filter(el => el.getClientRects().length);
        return {
          width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
          bad: nodes.filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1; }).map(el => el.id || el.className)
        };
      });
      assert(result.width <= 1024 && result.height <= 600, JSON.stringify(result));
      assert.deepEqual(result.bad, []);
    };
    assert.equal(bank.questions.length, 1000);
    assert.equal(bank.foods.length, 50);
    assert.equal(bank.levels.length, 3);
    await page.evaluate(() => document.documentElement.classList.add('is-embedded'));
    await fit();
    await open();
    assert.equal(await page.locator('.album-food').count(), 0);
    assert.equal(await page.locator('#albumClose').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#albumButton').evaluate(el => el === document.activeElement), true);
    await page.locator('#startButton').click();
    for (let round = 0; round < 5; round++) {
      const initialIds = await ids();
      for (let i = 0; i < 5; i++) {
        const before = await state();
        assert.equal(before.index, i);
        if (i === 0) {
          await answer(true);
          assert.deepEqual(await state(), before, 'Wrong answer changes neither collection nor stars');
        }
        const won = await answer();
        const after = await state();
        assert(after.collectedIds.includes(won));
        assert.equal(after.stars, i + 1);
        assert.equal(new Set(after.collectedIds).size, after.collectedIds.length);
        await page.locator(`[data-answer="${won}"]`).evaluate(el => el.dispatchEvent(new MouseEvent('click')));
        assert.deepEqual(await state(), after, 'Repeated correct event awards nothing extra');
        await fit();
        if (round === 0 && i === 0) {
          await open();
          assert.equal(await page.locator('.album-food').count(), 1);
          await page.locator(`[data-food="${won}"]`).click();
          assert.equal(await page.evaluate(() => testSpeech.at(-1).text), bank.foods.find(f => f.id === won).name);
          await page.screenshot({ path: path.join(artifacts, 'album-earned.png') });
          const cancellations = await page.evaluate(() => testCancels);
          await close();
          await page.waitForFunction(value => testCancels > value, cancellations);
          assert(await page.evaluate(() => testCancels) > cancellations);
          assert.deepEqual(await state(), after, 'Album does not advance the round');
          await page.locator('#sound').click();
          await open();
          const spoken = await page.evaluate(() => testSpeech.length);
          await page.locator('.album-food').click();
          assert.equal(await page.evaluate(() => testSpeech.length), spoken, 'Album respects mute');
          await close();
          await page.locator('#sound').click();
        }
        await page.locator('#next').click();
      }
      assert.equal((await state()).phase, 'finish');
      await fit();
      const completed = await page.evaluate(() => testCompletions);
      assert.equal(completed.length, round + 1);
      assert.deepEqual(completed.at(-1).metrics, { firstTry: 4, completed: 5, total: 5 });
      assert.equal(completed.at(-1).mode, 'easy');
      assert.equal(completed.at(-1).game, 'food');
      assert.equal(new Set(completed.map(x => x.runId)).size, completed.length);
      assert(completed.every(x => typeof x.runId === 'string' && x.runId.length));
      const collection = await ids();
      assert(initialIds.every(id => collection.includes(id)));
      await page.locator('#again').click();
      assert.deepEqual(await ids(), collection, 'Collection survives five round restarts');
      assert.equal((await state()).stars, 0);
    }
    const savedIds = await ids();
    await page.reload();
    assert.deepEqual(await ids(), savedIds, 'Collection survives reload');
    await page.locator('#difficultyHard').click();
    await page.locator('#startButton').click();
    await page.locator('#changeDifficulty').click();
    assert.deepEqual(await ids(), savedIds, 'Collection survives changing difficulty');

    for (const raw of ['{', '{}', 'null', '"onigiri"', JSON.stringify([bank.foods[0].id, bank.foods[0].id, '__proto__', '<script>', 42, null, {}]), ' '.repeat(17000)]) {
      await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
      await page.reload();
      const expected = raw.startsWith('[') ? [bank.foods[0].id] : [];
      assert.deepEqual(await ids(), expected, 'Malformed, unknown, duplicate and oversized storage is filtered');
      await page.locator('#startButton').click();
      const won = await answer();
      assert((await ids()).includes(won), 'Malformed storage cannot stop new rewards');
    }
    await page.evaluate(({ key, all }) => localStorage.setItem(key, JSON.stringify(all)), { key, all: bank.foods.map(f => f.id) });
    await page.reload();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open();
    assert.equal(await page.locator('.album-food').count(), 50);
    await page.locator('.album-food').last().click();
    const dialogFit = await page.locator('#albumDialog').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth;
    });
    assert(dialogFit, 'Full album scrolls within the viewport');
    await page.screenshot({ path: path.join(artifacts, 'album-full-desktop.png') });
    await close();
    await page.setViewportSize({ width: 375, height: 667 });
    await open();
    await page.locator('.album-food').last().click();
    assert(await page.locator('#albumDialog').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.screenshot({ path: path.join(artifacts, 'album-full-mobile.png') });
    await close();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(artifacts, 'start-mobile.png') });
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.setContent(`<iframe src="${url}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>`);
    const embedded = await page.locator('iframe').contentFrame();
    await embedded.locator('#startButton').click();
    assert(await embedded.locator('html').evaluate(el => el.classList.contains('is-embedded')));
    assert(await embedded.locator('html').evaluate(el => el.scrollHeight <= innerHeight && el.scrollWidth <= innerWidth));
    await embedded.locator('#albumButton').click();
    await embedded.locator('.album-food').last().click();
    await page.screenshot({ path: path.join(artifacts, 'album-embedded.png') });
    await embedded.locator('#albumClose').click();
    await page.screenshot({ path: path.join(artifacts, 'play-embedded.png') });
    await context.close();

    for (const failure of ['getter', 'read', 'write']) {
      const isolated = await browser.newContext();
      await isolated.addInitScript(({ failure }) => {
        window.__moonRankingBootstrapped = true;
        window.testCompletions = [];
        window.MoonRanking = { complete(payload) { window.testCompletions.push(payload); throw new Error('optional hook unavailable'); } };
        Object.defineProperty(window, 'localStorage', failure === 'getter' ? { get() { throw new Error('denied'); } } : { value: {
          getItem() { if (failure === 'read') throw new Error('denied'); return '[]'; },
          setItem() { throw new Error('quota'); }
        } });
        Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
      }, { failure });
      const p = await isolated.newPage();
      await p.goto(url);
      await p.locator('#sound').click();
      const level = { getter: 'Normal', read: 'Hard', write: 'Easy' }[failure];
      await p.locator('#difficulty' + level).click();
      await p.locator('#startButton').click();
      for (let i = 0; i < 5; i++) {
        const answerId = await p.evaluate(() => FoodQuiz.getState().question.answer);
        await p.locator(`[data-answer="${answerId}"]`).click();
        await p.locator('#next').click();
      }
      assert.equal(await p.evaluate(() => FoodQuiz.getState().phase), 'finish');
      const runs = await p.evaluate(() => testCompletions);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].mode, level.toLowerCase());
      assert(runs[0].runId.startsWith('food-'), 'Fallback run ID works without randomUUID');
      assert.deepEqual(runs[0].metrics, { firstTry: 5, completed: 5, total: 5 });
      const before = await p.evaluate(() => FoodQuiz.getState().collectedIds);
      await p.locator('#again').click();
      assert.deepEqual(await p.evaluate(() => FoodQuiz.getState().collectedIds), before);
      await isolated.close();
    }
    assert.equal(JSON.stringify(bank), bankBefore, 'Bank unchanged');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS: Chrome file:// album rewards, wrong/duplicate taps, five-round persistence, reload, defensive storage, speech/mute, dialog keyboard/focus, full album desktop/mobile fit, reduced motion, optional completion hooks.');
    console.log('Screenshots: ' + artifacts);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
