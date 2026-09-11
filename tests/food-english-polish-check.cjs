const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const { chromium } = require(path.join(runtime, 'node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'food-english-polish-'));

async function fit(frame, label) {
  const result = await frame.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, h1, h2, .feedback, .prompt, .choices, .cards, .review-words, .finish-foods')].filter(el => el.getClientRects().length && getComputedStyle(el).clipPath !== 'inset(50%)');
    return { width: innerWidth, height: innerHeight, scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], bad: nodes.filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1 || el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
    }).map(el => el.id || el.className) };
  });
  assert(result.scroll[0] <= result.width && result.scroll[1] <= result.height + 1, label + JSON.stringify(result));
  assert.deepEqual(result.bad, [], label + JSON.stringify(result));
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [width, height] of [[1024, 600], [390, 844], [320, 568]]) for (const embedded of [false, true]) for (const game of ['food', 'english']) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript(() => {
        window.__moonRankingBootstrapped = true;
        window.testSpeech = []; window.testResults = []; window.testEffects = [];
        Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, getVoices: () => [{ lang: 'en-US' }, { lang: 'ja-JP' }], speak(u) { testSpeech.push(u); } } });
        window.SpeechSynthesisUtterance = function(text) { this.text = text; };
        window.MoonRanking = { complete(payload) { testResults.push(payload); } };
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const url = pathToFileURL(path.join(root, game === 'food' ? 'food-quiz-game.html' : 'english-game.html')).href;
      await page.goto(url);
      let frame = page;
      if (embedded) {
        await page.setContent(`<iframe src="${url}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>`);
        frame = page.frameLocator('iframe');
        await frame.locator('body').waitFor();
      }
      // Locator evaluation also works in the actual embedded document.
      const target = { evaluate: (fn, arg) => frame.locator('body').evaluate((_, { source, arg }) => (0, eval)('(' + source + ')')(arg), { source: fn.toString(), arg }) };
      const label = `${game}-${width}x${height}-${embedded ? 'embedded' : 'direct'}`;
      assert.equal(await target.evaluate(() => testSpeech.length), 0, 'No initial speech');
      await target.evaluate(() => {
        const original = MoonAudio.effect;
        MoonAudio.effect = name => { testEffects.push(name); return original(name); };
        MoonAudio.setVolumes({ voice: .35 });
      });
      await fit(target, label + '-initial');
      if (game === 'food') {
        await frame.locator('#difficultyHard').click();
        await frame.locator('#startButton').click();
        const overflow = await target.evaluate(() => {
          const prompt = document.getElementById('prompt'), saved = prompt.textContent, bad = [];
          for (const q of FoodQuiz.questions) { prompt.textContent = q.clue; if (prompt.scrollHeight > prompt.clientHeight + 1 || prompt.scrollWidth > prompt.clientWidth + 1) bad.push(q.id); }
          prompt.textContent = saved; return bad;
        });
        assert.deepEqual(overflow, [], label + ': all 1000 clues fit');
        for (let i = 0; i < 5; i++) {
          await fit(target, label + '-question');
          const q = await target.evaluate(() => FoodQuiz.getState().question);
          if (i === 0) await frame.locator(`[data-answer="${q.choices.find(id => id !== q.answer)}"]`).click();
          await frame.locator(`[data-answer="${q.answer}"]`).click();
          await fit(target, label + '-correct');
          await frame.locator('#next').click();
        }
        assert.equal(await frame.locator('.finish-food').count(), 5);
        const before = await target.evaluate(() => JSON.stringify(FoodQuiz.getState()));
        for (let i = 0; i < 5; i++) {
          const button = frame.locator('.finish-food').nth(i);
          assert(await button.evaluate(el => el.clientWidth >= 44 && el.clientHeight >= 44));
          await button.click();
          assert.equal(await target.evaluate(() => testSpeech.at(-1).text), await button.locator('span').textContent());
        }
        assert.equal(await target.evaluate(() => JSON.stringify(FoodQuiz.getState())), before, 'Replay never awards');
      } else {
        for (let i = 0; i < 5; i++) {
          const name = await target.evaluate(() => deck[position][1]);
          if (i === 0) await frame.locator('.choice').filter({ hasNotText: name }).first().click();
          await frame.getByRole('button', { name, exact: true }).click();
          await fit(target, label + '-correct');
          await frame.locator('#next').click();
        }
        assert.equal(await frame.locator('.review-word').count(), 5);
        await frame.locator('.review-word').first().click();
        assert.equal(await frame.locator('.speaking').count(), 0, 'Wait for actual speech start');
        await target.evaluate(() => { testSpeech.at(-1).onstart(); window.oldSpeech = testSpeech.at(-1); });
        assert.equal(await frame.locator('.speaking').count(), 1);
        await page.screenshot({ path: path.join(artifacts, label + '-speaking.png') });
        await frame.locator('.review-word').nth(1).click();
        await target.evaluate(() => { testSpeech.at(-1).onstart(); oldSpeech.onend(); oldSpeech.onerror({ error: 'network' }); oldSpeech.onstart(); });
        assert.equal(await frame.locator('.speaking').count(), 1, 'Stale events leave new speech alone');
        await target.evaluate(() => testSpeech.at(-1).onend());
        assert.equal(await frame.locator('.speaking').count(), 0);
        await frame.locator('.review-word').nth(2).click();
        await target.evaluate(() => testSpeech.at(-1).onstart());
        await frame.locator('#sound').click();
        assert.equal(await frame.locator('.speaking').count(), 0, 'Mute clears');
        await frame.locator('#sound').click();
        await frame.locator('.review-word').nth(3).click();
        await target.evaluate(() => { testSpeech.at(-1).onstart(); MoonAudio.suspend(); });
        assert.equal(await frame.locator('.speaking').count(), 0, 'Shared suspension clears native speech');
      }
      assert.equal(await target.evaluate(() => testResults.length), 1);
      assert.equal(await target.evaluate(() => testResults[0].metrics.firstTry), 4);
      assert.equal(await target.evaluate(() => testSpeech.at(-1).volume), .35);
      assert.deepEqual(await target.evaluate(() => testEffects), ['correct', 'correct', 'correct', 'correct', 'correct', 'complete']);
      await fit(target, label + '-finish');
      await page.screenshot({ path: path.join(artifacts, label + '-finish.png') });
      await frame.locator('#again').click();
      await fit(target, label + '-restart');
      assert.deepEqual(errors, []);
      await context.close();
      console.log('PASS ' + label);
    }
    console.log('Screenshots: ' + artifacts);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
