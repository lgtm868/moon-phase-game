const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const artifacts = process.env.QUALITY_ARTIFACTS || path.join(root, 'output');
const quizModes = [['#tabQuiz', 'current'], ['#tabChallenge', 'future']];
const tabIds = ['tabMoon', 'tabFriends', 'tabQuiz', 'tabChallenge'];
const TAU = 2 * Math.PI;
const normalize = a => ((a % TAU) + TAU) % TAU;
const distance = (a, b) => Math.min(normalize(a - b), normalize(b - a));
const afterSevenDays = source => {
  const periodDays = 29.53059, ageDays = source / TAU * periodDays;
  return ((ageDays + 7) % periodDays) / periodDays * TAU;
};
const shapeName = angle => {
  const names = ['しんげつ', 'じょうげん', 'まんげつ', 'かげん'];
  const cardinal = names.findIndex((_, i) => distance(angle, i * Math.PI / 2) < 1e-8);
  if (cardinal >= 0) return names[cardinal];
  if ((1 - Math.cos(angle)) / 2 < .01) return angle < Math.PI ? 'しんげつの すこしあと' : 'しんげつの すこしまえ';
  return (angle < Math.PI ? 'ふくらむ' : 'かけていく') + ((1 - Math.cos(angle)) / 2 < .5 ? '細い月' : '丸い月');
};
const illuminationLabel = angle => {
  const percent = (1 - Math.cos(angle)) * 50;
  if (percent > 0 && percent < 1) return '1パーセントより すくない';
  if (percent > 99 && percent < 100) return '99パーセントより おおきい';
  return `やく${Math.round(percent)}パーセント`;
};

async function quizSnapshot(page) {
  return page.locator('#quizPanel').evaluate(panel => ({
    dataset: { ...panel.dataset }, prompt: document.querySelector('#quizPrompt').textContent,
    result: document.querySelector('#quizResult').textContent,
    nextDisabled: document.querySelector('#quizNext').disabled,
    options: [...document.querySelectorAll('#quizOptions button')].map(button => ({
      phase: button.dataset.phase, angle: Number(button.dataset.angle), name: button.dataset.name,
      label: button.getAttribute('aria-label'), className: button.className, disabled: button.disabled
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
    const elements = [...document.querySelectorAll('[role="tab"], #quizPanel, #quizPrompt, #quizPanel button, #quizOptions canvas, #quizResult, #phaseName, #phaseMessage')];
    const overflow = elements.filter(el => {
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.top >= -1
        && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
        && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)) return true;
      if (el.matches('#quizOptions canvas')) {
        const parent = el.parentElement.getBoundingClientRect();
        if (rect.left < parent.left || rect.right > parent.right
          || rect.top < parent.top || rect.bottom > parent.bottom) return true;
      }
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
  await checkSceneLayout(page, label);
}

async function checkSceneLayout(page, label) {
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector('#space'), box = canvas.getBoundingClientRect();
    const controls = document.querySelector('.scene-actions').getBoundingClientRect();
    const footer = document.querySelector('.scene-footer').getBoundingClientRect();
    const scale = Math.max(1, Math.min(devicePixelRatio || 1, 2));
    return { canvas: box.toJSON(), controls: controls.toJSON(), footer: footer.toJSON(),
      width: canvas.width, height: canvas.height, scale,
      blocked: Array.from({ length: 16 }, (_, i) => {
        const angle = i * Math.PI / 8, radius = Math.min(box.width * .32, box.height * .37);
        const x = box.left + box.width * .58 + Math.cos(angle) * radius;
        const y = box.top + box.height * .52 + Math.sin(angle) * radius;
        return document.elementFromPoint(x, y) !== canvas ? { x, y } : null;
      }).filter(Boolean) };
  });
  assert.ok(geometry.controls.bottom <= geometry.canvas.top && geometry.canvas.bottom <= geometry.footer.top,
    `${label}: toolbar/canvas/footer are separate rows: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.width, Math.round(geometry.canvas.width * geometry.scale), `${label}: own canvas width`);
  assert.equal(geometry.height, Math.round(geometry.canvas.height * geometry.scale), `${label}: own canvas height`);
  assert.deepEqual(geometry.blocked, [], `${label}: all orbit positions accept input without control overlays`);
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

async function checkDragInterruptions(browser, url, failures) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => failures.push(error.message));
  const reasons = ['lostcapture', 'pointercancel', 'blur', 'resize', 'hidden', 'pagehide', 'quiz'];
  try {
    await page.addInitScript(() => {
      window.__spoken = [];
      window.__speechCancels = 0;
      speechSynthesis.speak = utterance => __spoken.push(utterance.text);
      speechSynthesis.cancel = () => { __speechCancels++; };
      document.addEventListener('pointerdown', event => { window.__pointerId = event.pointerId; }, true);
    });
    await page.goto(url);
    for (const reason of reasons) {
      await page.locator('#resetButton').click();
      const box = await page.locator('#space').boundingBox();
      const cx = box.x + box.width * .58, cy = box.y + box.height * .52;
      const radius = Math.min(box.width * .32, box.height * .37);
      await page.mouse.move(cx + radius, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + radius, { steps: 4 });
      const before = await page.locator('#space').getAttribute('aria-valuenow');
      assert.equal(before, '90', `${reason}: moved drag is active before interruption`);
      await page.evaluate(() => { __spoken.length = 0; __speechCancels = 0; });
      const pointerId = await page.evaluate(() => __pointerId);
      assert.ok(await page.locator('#space').evaluate((canvas, id) => canvas.hasPointerCapture(id), pointerId));
      await page.evaluate(reason => {
        const canvas = document.querySelector('#space');
        if (reason === 'lostcapture') canvas.releasePointerCapture(__pointerId);
        else if (reason === 'pointercancel') canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: __pointerId }));
        else if (reason === 'quiz') document.querySelector('#tabQuiz').click();
        else if (reason === 'hidden') {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        } else window.dispatchEvent(new Event(reason));
      }, reason);
      // Dispatch pending native lostpointercapture while the original button is still held.
      await page.mouse.move(10, 10);
      assert.equal(await page.locator('#space').evaluate((canvas, id) => canvas.hasPointerCapture(id), pointerId), false,
        `${reason}: capture released`);
      if (reason === 'quiz') {
        await page.locator('#tabMoon').evaluate(button => button.click());
        await page.evaluate(() => { __spoken.length = 0; });
      }
      await page.locator('#space').dispatchEvent('pointermove', {
        pointerId, pointerType: 'mouse', buttons: 1, clientX: cx, clientY: cy - radius
      });
      await page.locator('#space').dispatchEvent('pointercancel', { pointerId });
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), before,
        `${reason}: stale pressed move cannot resume cancelled drag`);
      await page.mouse.up();
      await page.mouse.move(cx - radius, cy);
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), before,
        `${reason}: hover with no button cannot move moon`);
      assert.deepEqual(await page.evaluate(() => __spoken), [], `${reason}: cancellation is silent`);
      if (reason === 'hidden' || reason === 'pagehide') {
        assert.ok(await page.evaluate(() => __speechCancels > 0), `${reason}: active speech cancelled`);
      }
      if (reason === 'hidden') await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // Cancellation must clear state, not permanently disable subsequent input.
      await page.mouse.move(cx + radius, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - radius, { steps: 4 });
      await page.mouse.up();
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), '270', `${reason}: fresh drag works`);
      assert.deepEqual(await page.evaluate(() => __spoken), [await page.locator('#phaseName').textContent()],
        `${reason}: completed fresh drag speaks the visible phase exactly once`);
    }
    return { dragInterruptions: reasons.length, recoveryDrags: reasons.length };
  } finally { await page.close(); }
}

async function checkInterruptions(browser, url, failures) {
  return {
    ...await checkDragInterruptions(browser, url, failures),
    ...await require('./moon-music-check.cjs').checkMoonMusic(browser, url)
  };
}

fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png' }[path.extname(target)] || 'application/octet-stream';
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }).end(data.subarray(start, end + 1));
    } else res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }).end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/moon-phase-game.html?standalone=1`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const failures = [], report = [];
  try {
    if (process.env.QUALITY_FOCUS === 'interruptions') {
      report.push(await checkInterruptions(browser, url, failures));
      assert.deepEqual(failures, []);
      console.log(JSON.stringify({ passed: true, report }, null, 2));
      return;
    }
    for (const [width, height] of [[1024, 600], [390, 844], [375, 667], [320, 568], [1280, 800], [844, 390], [667, 375], [740, 360]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => failures.push(error.message));
      await page.addInitScript(() => {
        let seed = 12345;
        Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
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
      await checkSceneLayout(page, `exploration ${width}x${height}`);
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
      await page.mouse.move(box.x + box.width * .58, box.y + box.height * .52 + orbit, { steps: 8 });
      await page.mouse.up();
      assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), '90', 'north-side view: bottom drag is first quarter');
      await page.locator('#tabFriends').click();
      assert.equal(await page.locator('.sprunki-choice').count(), 30);
      await page.locator('.sprunki-choice').nth(1).click();
      assert.equal(await page.locator('.sprunki-choice.is-active').count(), 2);
      await page.screenshot({ path: path.join(artifacts, `friends-${width}x${height}.png`) });
      const saved = {};
      for (const [tab, mode] of quizModes) {
        await page.locator(tab).click();
        const question = await page.locator('#quizPanel').evaluate(el => ({ ...el.dataset }));
        assert.equal(question.mode, mode);
        assert.ok(mode === 'current' ? ['name', 'orbit'].includes(question.kind) : question.kind === 'order');
        const source = Number(question.sourceAngle);
        assert.ok(Number.isFinite(source) && source >= 0 && source < TAU);
        assert.equal(question.source, undefined, 'legacy integer source removed');
        assert.ok(['anchor', 'continuous'].includes(question.sourceType));
        const target = mode === 'future' ? afterSevenDays(source) : source;
        const before = await quizSnapshot(page);
        assert.equal(await page.locator('#quizOptions button').count(), 8);
        assert.deepEqual(before.options.map(option => option.phase).sort(), Array.from({ length: 8 }, (_, i) => String(i)));
        const answers = before.options.filter(option => distance(option.angle, target) < 1e-8);
        assert.equal(answers.length, 1, 'unique correct option determined by angle, not local ID');
        const answer = answers[0], wrong = before.options.find(option => option.phase !== answer.phase);
        for (const option of before.options) {
          assert.equal(option.name, shapeName(option.angle));
          assert.equal(option.label, `${option.name}、あかるいところ ${illuminationLabel(option.angle)}`);
        }
        const prefix = mode === 'current' ? 'quiz' : 'challenge';
        for (const state of ['question', 'wrong', 'solved']) {
          if (state === 'wrong') {
            await page.locator(`#quizOptions button[data-phase="${wrong.phase}"]`).click();
            assert.match(await page.locator('#quizResult').textContent(), /もういちど/);
          } else if (state === 'solved') {
            await page.locator(`#quizOptions button[data-phase="${answer.phase}"]`).click();
            assert.match(await page.locator('#quizResult').textContent(), /★\s*1\s+みつけた/);
          }
          const current = await quizSnapshot(page);
          assert.equal(current.scene, before.scene, `${mode} ${state}: diagram stays at source`);
          assert.ok(distance(Number(current.scene) * Math.PI / 180, source) <= Math.PI / 360 + 1e-8);
          assert.deepEqual(current.dataset, before.dataset, `${mode} ${state}: question fixed`);
          assert.deepEqual(current.options.map(({ phase, angle, name, label }) => ({ phase, angle, name, label })),
            before.options.map(({ phase, angle, name, label }) => ({ phase, angle, name, label })), 'options fixed after grading');
          if (mode === 'future') {
            assert.equal(current.sourceName, shapeName(source), `${state}: summary names the source`);
            assert.equal(current.moonLabel, shapeName(source), `${state}: accessible moon names the source`);
            assert.equal(current.smallLabel, 'いまのつき', `${state}: summary remains present tense`);
            assert.equal(current.sourceLabel, `いまのつきは、${shapeName(source)}。${current.sourceMessage}`,
              `${state}: accessible summary describes the source`);
            assert.equal(current.summary, before.summary, `${state}: grading preserves source summary`);
            assert.equal(current.sourceLabel, before.sourceLabel, `${state}: grading preserves accessible source description`);
          }
          if (state === 'solved') {
            assert.equal(current.result.split('\n').length, 2, 'two-line answer');
            assert.equal(current.result.split('\n')[1], `こたえ：${shapeName(target)}`,
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
    wrapper.on('pageerror', error => failures.push(error.message));
    await wrapper.goto(new URL('index.html', url).href);
    const frame = wrapper.frameLocator('#gameFrame');
    await frame.locator('#phaseName').waitFor();
    assert.ok(await frame.locator('body').evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2));
    const menuToggle = wrapper.locator('#gameMenuToggle');
    const menuLinks = wrapper.locator('.game-menu-card[data-nav-game]');
    const gameKeys = ['moon', 'piano', 'addition', 'guess', 'baibain', 'food', 'english'];
    assert.ok(await menuToggle.isVisible(), 'shared navigation remains available in Moon');
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');
    assert.ok(await wrapper.locator('#gameMenu').isHidden(), 'game menu starts closed');
    await menuToggle.click();
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await wrapper.locator('.game-menu-card[data-nav-game]:visible').count(), 7, 'all seven registry links are visible in the open menu');
    assert.deepEqual(await menuLinks.evaluateAll(links => links.map(link => ({
      game: link.dataset.navGame, href: link.getAttribute('href'), current: link.getAttribute('aria-current')
    }))), gameKeys.map(game => ({ game, href: `?game=${game}`, current: game === 'moon' ? 'page' : null })));
    assert.ok(await frame.locator('.game-link[href="index.html?game=piano"]').isHidden(), 'embedded Moon does not duplicate navigation');
    await wrapper.locator('.game-menu-card[data-nav-game="piano"]').click();
    await wrapper.waitForURL(/game=piano/);
    assert.match(await wrapper.locator('#gameFrame').getAttribute('src'), /sprunki-piano-game/);
    assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');
    assert.ok(await wrapper.locator('#gameMenu').isHidden(), 'choosing a game closes the menu');
    assert.deepEqual(await menuLinks.evaluateAll(links => links.map(link => link.getAttribute('aria-current'))),
      gameKeys.map(game => game === 'piano' ? 'page' : null), 'current-page selection follows navigation');
    await wrapper.close();

    report.push(await checkInterruptions(browser, url, failures));

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
