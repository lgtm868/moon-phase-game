const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'output');
const quizModes = [['#tabQuiz', 'current'], ['#tabChallenge', 'future']];
const tabIds = ['tabMoon', 'tabFriends', 'tabQuiz', 'tabChallenge'];
const phaseNames = ['しんげつ', 'ふくらむ細い月', 'じょうげん', 'ふくらむ丸い月',
  'まんげつ', 'かけていく丸い月', 'かげん', 'かけていく細い月'];
const weekAnswers = [2, 3, 4, 5, 6, 7, 0, 1];

async function quizSnapshot(page) {
  return page.locator('#quizPanel').evaluate(panel => ({
    dataset: { ...panel.dataset }, prompt: document.querySelector('#quizPrompt').textContent,
    result: document.querySelector('#quizResult').textContent,
    nextDisabled: document.querySelector('#quizNext').disabled,
    options: [...document.querySelectorAll('#quizOptions button')].map(button => ({
      phase: button.dataset.phase, className: button.className, disabled: button.disabled
    })),
    scene: document.querySelector('#space').getAttribute('aria-valuenow'),
    summary: document.querySelector('#phaseSummary').textContent,
    sourceName: document.querySelector('#phaseName').textContent,
    sourceMessage: document.querySelector('#phaseMessage').textContent,
    sourceLabel: document.querySelector('#phaseSummary').getAttribute('aria-label'),
    moonLabel: document.querySelector('#phaseMoon').getAttribute('aria-label'),
    smallLabel: document.querySelector('#phaseSummary .small-label').textContent,
    masked: document.querySelector('#phaseSummary').classList.contains('is-masked')
  }));
}

async function checkQuizLayout(page, label) {
  const layout = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('[role="tab"], #quizPanel, #quizPrompt, #quizPanel button, #quizResult, #phaseName, #phaseMessage')];
    const overflow = elements.filter(el => {
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1
        && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
        && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)) return true;
      return [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).some(node => {
        const range = document.createRange();
        range.setStart(node, node.textContent.search(/\S/));
        range.setEnd(node, node.textContent.trimEnd().length);
        return [...range.getClientRects()].some(text => text.left < rect.left - 1 || text.right > rect.right + 1
          || text.top < rect.top - 1 || text.bottom > rect.bottom + 1);
      });
    }).map(el => ({ id: el.id, text: el.textContent, rect: el.getBoundingClientRect().toJSON() }));
    return { overflow, horizontal: document.documentElement.scrollWidth > innerWidth,
      vertical: document.documentElement.scrollHeight > innerHeight + 2 };
  });
  assert.ok(!layout.overflow.length && !layout.horizontal && !layout.vertical, `${label}: ${JSON.stringify(layout)}`);
}

async function checkTabKeyboard(page) {
  assert.deepEqual(await page.locator('[role="tab"]').evaluateAll(tabs => tabs.map(tab => tab.id)), tabIds,
    'four library tabs in current-then-challenge order');
  for (const [tab, mode] of quizModes) {
    assert.equal(await page.locator(tab).getAttribute('data-panel'), 'quizPanel');
    assert.equal(await page.locator(tab).getAttribute('data-quiz-mode'), mode);
  }
  for (let index = 0; index < tabIds.length; index++) {
    for (const [key, target] of [['ArrowRight', (index + 1) % 4], ['ArrowLeft', (index + 3) % 4], ['Home', 0], ['End', 3]]) {
      await page.locator(`#${tabIds[index]}`).click();
      await page.locator(`#${tabIds[index]}`).press(key);
      assert.equal(await page.evaluate(() => document.activeElement.id), tabIds[target], `${key}: focus`);
      const selected = await page.locator('[role="tab"]').evaluateAll(tabs => tabs.map(tab => ({
        selected: tab.getAttribute('aria-selected'), tabIndex: tab.tabIndex
      })));
      assert.deepEqual(selected, tabIds.map((_, i) => ({ selected: String(i === target), tabIndex: i === target ? 0 : -1 })), `${key}: roving focus and selection`);
      const panel = await page.locator(`#${tabIds[target]}`).getAttribute('aria-controls');
      assert.ok(await page.locator(`#${panel}`).isVisible(), `${key}: selected panel visible`);
      assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1, `${key}: one panel visible`);
      if (target >= 2) {
        assert.equal(await page.locator('#quizPanel').getAttribute('data-mode'), target === 2 ? 'current' : 'future');
        assert.equal(await page.locator('#quizPanel').getAttribute('aria-labelledby'), tabIds[target]);
      }
    }
  }
}
fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png' }[path.extname(target)] || 'application/octet-stream';
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }).end(data.subarray(start, end + 1));
    } else res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }).end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/moon-phase-game.html`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const failures = [], report = [];
  try {
    for (const [width, height] of [[390, 844], [375, 667], [320, 568], [1280, 800], [844, 390], [667, 375], [740, 360]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => failures.push(error.message));
      await page.addInitScript(() => {
        window.__audios = [];
        const NativeAudio = window.Audio;
        window.Audio = function(src) { const audio = new NativeAudio(src); window.__audios.push(audio); return audio; };
      });
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('#voiceButton').click();
      await page.screenshot({ path: path.join(artifacts, `quality-${width}x${height}.png`) });
      const layout = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth,
        vertical: document.documentElement.scrollHeight > innerHeight + 2,
        images: [...document.images].filter(img => !img.complete || !img.naturalWidth).length,
        scene: document.querySelector('#space').getBoundingClientRect().toJSON()
      }));
      assert.equal(layout.horizontal, false, `horizontal overflow ${width}`);
      assert.equal(layout.images, 0, 'broken images');
      assert.equal(layout.vertical, false, `vertical overflow ${width}`);
      const choices = page.locator('.phase-choice');
      assert.equal(await choices.count(), 16);
      for (const [index, expected] of [[0, 0], [4, .5], [8, 1], [12, .5]]) {
        await choices.nth(index).click();
        const light = await page.evaluate(() => {
          const canvas = document.querySelector('#phaseMoon'), ctx = canvas.getContext('2d');
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let count = 0, bright = 0, left = 0, right = 0;
          const radius = canvas.width * .39;
          for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
            if (Math.hypot(x - canvas.width / 2, y - canvas.height / 2) > radius) continue;
            count++;
            if (data[(y * canvas.width + x) * 4] > 40) { bright++; if (x < canvas.width / 2) left++; else right++; }
          }
          return { fraction: bright / count, left, right };
        });
        assert.ok(Math.abs(light.fraction - expected) < .08, `phase pixels ${index}: ${JSON.stringify(light)}`);
        if (index === 4) assert.ok(light.right > light.left * 10, 'waxing right');
        if (index === 12) assert.ok(light.left > light.right * 10, 'waning left');
      }
      for (let i = 0; i < 16; i++) {
        await choices.nth(i).click();
        assert.equal(await choices.nth(i).getAttribute('aria-pressed'), 'true');
      }
      await choices.nth(4).click();
      const quarter = await page.locator('#space').getAttribute('aria-valuenow');
      assert.equal(quarter, '90');
      await choices.nth(8).click();
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), '180');
      await choices.nth(12).click();
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), '270');
      await page.locator('#space').press('Home');
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), '0');
      const box = await page.locator('#space').boundingBox();
      const orbit = Math.min(box.width * .32, box.height * .37);
      await page.mouse.move(box.x + box.width * .58 - orbit, box.y + box.height * .52);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .58, box.y + box.height * .52 - orbit, { steps: 8 });
      await page.mouse.up();
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), '90', 'drag phase');
      await page.locator('#tabFriends').click();
      assert.equal(await page.locator('.sprunki-choice').count(), 30);
      await page.locator('.sprunki-choice').nth(1).click();
      assert.equal(await page.locator('.sprunki-choice.is-active').count(), 2);
      await page.screenshot({ path: path.join(artifacts, `friends-${width}x${height}.png`) });
      if (width === 390) {
        await page.locator('#musicButton').click();
        await page.waitForTimeout(800);
        const audio = await page.evaluate(() => window.__audios.slice(0, 2).map(a => ({ paused: a.paused, time: a.currentTime, error: a.error?.code })));
        assert.ok(audio.every(a => !a.paused && a.time > .1 && !a.error), JSON.stringify(audio));
        await page.locator('#musicButton').click();
        assert.ok(await page.evaluate(() => window.__audios.every(a => a.paused)), 'audio off');
        report.push({ audio });
      }
      const saved = {};
      for (const [tab, mode] of quizModes) {
        await page.locator(tab).click();
        const question = await page.locator('#quizPanel').evaluate(el => ({ ...el.dataset }));
        assert.equal(question.mode, mode);
        assert.ok(mode === 'current' ? ['name', 'orbit'].includes(question.kind) : question.kind === 'order');
        const source = Number(question.source);
        const target = mode === 'future' ? weekAnswers[source] : source;
        const before = await quizSnapshot(page);
        assert.equal(await page.locator('#quizOptions button').count(), 8);
        const prefix = mode === 'current' ? 'quiz' : 'challenge';
        for (const state of ['question', 'wrong', 'solved']) {
          if (state === 'wrong') {
            await page.locator(`#quizOptions button[data-phase="${(target + 1) % 8}"]`).click();
            assert.match(await page.locator('#quizResult').textContent(), /もういちど/);
          } else if (state === 'solved') {
            await page.locator(`#quizOptions button[data-phase="${target}"]`).click();
            assert.match(await page.locator('#quizResult').textContent(), /★\s*1\s+みつけた/);
          }
          const current = await quizSnapshot(page);
          assert.equal(current.scene, String(source * 45), `${mode} ${state}: diagram stays at source`);
          if (mode === 'future') {
            assert.equal(current.sourceName, phaseNames[source], `${state}: summary names the source`);
            assert.equal(current.moonLabel, phaseNames[source], `${state}: accessible moon names the source`);
            assert.equal(current.smallLabel, 'いまのつき', `${state}: summary remains present tense`);
            assert.equal(current.sourceLabel, `いまのつきは、${phaseNames[source]}。${current.sourceMessage}`,
              `${state}: accessible summary describes the source`);
            assert.equal(current.summary, before.summary, `${state}: grading preserves source summary`);
            assert.equal(current.sourceLabel, before.sourceLabel, `${state}: grading preserves accessible source description`);
          }
          if (state === 'solved') {
            assert.equal(current.result.split('\n')[1], `こたえ：${phaseNames[target]}`,
              `${mode}: second result line names the actual answer`);
          }
          assert.equal(await page.locator('#quizNext').isDisabled(), state !== 'solved');
          await checkQuizLayout(page, `${mode} ${state} ${width}x${height}`);
          await page.screenshot({ path: path.join(artifacts, `${prefix}${state === 'solved' ? '' : `-${state}`}-${width}x${height}.png`) });
        }
        saved[mode] = await quizSnapshot(page);
      }
      await checkTabKeyboard(page);
      for (const [tab, mode] of quizModes) {
        await page.locator(tab).click();
        assert.deepEqual(await quizSnapshot(page), saved[mode], `${mode}: keyboard and other tabs preserve solved state`);
      }
      report.push({ width, height, layout });
      await page.close();
    }
    const wrapper = await browser.newPage({ viewport: { width: 320, height: 568 } });
    await wrapper.goto(url.replace('moon-phase-game.html', 'index.html'));
    const frame = wrapper.frameLocator('#gameFrame');
    await frame.locator('#phaseName').waitFor();
    assert.ok(await frame.locator('body').evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2));
    await frame.locator('.game-link[href="index.html?game=piano"]').click();
    await wrapper.waitForURL(/game=piano/);
    assert.match(await wrapper.locator('#gameFrame').getAttribute('src'), /sprunki-piano-game/);
    await wrapper.close();

    const race = await browser.newPage();
    race.on('pageerror', error => failures.push(error.message));
    await race.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      let first = true;
      HTMLMediaElement.prototype.play = function() {
        if (first) { first = false; return new Promise((resolve, reject) => { window.__rejectOld = reject; }); }
        return play.call(this);
      };
    });
    await race.goto(url);
    await race.locator('#musicButton').click();
    await race.locator('#musicButton').click();
    await race.locator('#musicButton').click();
    await race.evaluate(() => window.__rejectOld(new DOMException('Old request', 'NotAllowedError')));
    await race.waitForTimeout(150);
    assert.equal(await race.locator('#musicButton').getAttribute('aria-pressed'), 'true');
    assert.ok(await race.locator('#audioStatus').isHidden());
    await race.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await race.locator('#musicButton').getAttribute('aria-pressed'), 'false');
    await race.close();

    const rejected = await browser.newPage();
    rejected.on('pageerror', error => failures.push(error.message));
    await rejected.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
    });
    await rejected.goto(url);
    await rejected.locator('#musicButton').click();
    await rejected.locator('#audioStatus').waitFor({ state: 'visible' });
    assert.equal(await rejected.locator('#musicButton').getAttribute('aria-pressed'), 'false');
    await rejected.close();

    const offline = await browser.newPage({ viewport: { width: 390, height: 844 } });
    offline.on('pageerror', error => failures.push(error.message));
    await offline.route(/^https?:/, route => route.abort());
    await offline.goto(require('node:url').pathToFileURL(path.join(root, 'moon-phase-game.html')).href);
    await offline.locator('.phase-choice').nth(8).click();
    assert.equal(await offline.locator('#space').getAttribute('aria-valuenow'), '180');
    assert.ok(await offline.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth)));
    await offline.close();
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ passed: true, report }, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { server.close(); console.error(error); process.exitCode = 1; });
