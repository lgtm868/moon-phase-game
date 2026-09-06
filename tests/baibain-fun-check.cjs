const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const runtime = 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(runtime, 'node_modules/playwright'));
const M = require('../baibain-model.js');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'output/playwright/baibain-fun');
const installedChrome = process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const failures = [];
const gameURL = pathToFileURL(path.join(root, 'baibain-game.html')).href;

async function observation(frame) {
  return frame.evaluate(() => Object.fromEntries(['elapsed', 'exactCount', 'formula', 'mass', 'height'].map(id => [id, document.getElementById(id).textContent])));
}

async function assertLayout(frame, label, dialog = false) {
  const result = await frame.evaluate(isDialog => {
    const host = document.querySelector(isDialog ? '#predictionDialog' : '.app');
    const box = host.getBoundingClientRect();
    const controls = [...host.querySelectorAll(isDialog ? 'button, .prediction-bun, #predictionPrompt, #predictionFeedback' : 'button, select, input, canvas')]
      .filter(el => el.getBoundingClientRect().width && !el.closest('dialog:not([open])'));
    const outside = controls.filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < -1 || r.right > innerWidth + 1 || (isDialog && (r.top < box.top || r.bottom > box.bottom));
    }).map(el => el.id || el.className.baseVal || el.className);
    const clipped = controls.filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.id || el.className);
    return { outside, clipped, width: innerWidth, height: innerHeight, bottom: box.bottom, top: box.top,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      below: [...document.body.querySelectorAll('*')].filter(el => el.getBoundingClientRect().bottom > innerHeight + 1).map(el => el.id || el.tagName).slice(0,12),
      dialogScroll: host.scrollHeight - host.clientHeight };
  }, dialog);
  assert.deepEqual(result.outside, [], `${label}: visible controls fit`);
  assert.deepEqual(result.clipped, [], `${label}: control text fits`);
  assert(result.scrollWidth <= result.width + 1, `${label}: no horizontal scrolling`);
  if (dialog) {
    assert(result.top >= 0 && result.bottom <= result.height, `${label}: entire challenge fits`);
    assert(result.dialogScroll <= 1, `${label}: challenge needs no scrolling`);
    const boxes = await frame.locator('.prediction-choice').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, right: r.right, width: r.width, height: r.height };
    }));
    assert(boxes.every(box => box.width >= 44 && box.height >= 44), `${label}: touch targets`);
    assert(boxes[0].right < boxes[1].x && boxes[1].right < boxes[2].x, `${label}: separate answer targets`);
  } else if (result.width >= 901) {
    assert(result.scrollHeight <= result.height + 1, `${label}: observation fits landscape ${JSON.stringify(result)}`);
  }
}

async function assertQuestion(frame, generation) {
  const current = Number(M.snapshot(generation * M.DEFAULTS.interval).count);
  const answer = Number(M.snapshot((generation + 1) * M.DEFAULTS.interval).count);
  assert.equal(await frame.locator('#predictionCount').textContent(), String(current));
  assert.equal(await frame.locator('#predictionNowImages .prediction-bun').count(), current);
  const choices = await frame.locator('.prediction-choice').evaluateAll(elements => elements.map(el => ({
    value: Number(el.dataset.count), images: el.querySelectorAll('.prediction-bun').length,
    label: el.getAttribute('aria-label'), text: el.querySelector('.prediction-number').textContent,
    disabled: el.disabled
  })));
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices.map(choice => choice.value)).size, 3);
  assert.equal(choices.filter(choice => choice.value === answer).length, 1);
  assert(choices.every(choice => choice.value === choice.images && choice.label === `${choice.value}こ` && choice.text === String(choice.value) && !choice.disabled));
  assert(await frame.locator('#predictionNext').isDisabled(), 'No skipping ahead before success');
  assert(await frame.locator('#predictionStar').isHidden());
  return answer;
}

async function exercise(page, frame, label) {
  await frame.locator('#openPrediction').waitFor();
  await frame.evaluate(() => document.fonts.ready);
  await page.clock.runFor(60);
  await assertLayout(frame, label);
  const sceneColors = await frame.locator('#scene').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 128) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return colors.size;
  });
  assert(sceneColors > 20, `${label}: observation canvas is not blank`);
  await page.screenshot({ path: path.join(artifacts, `${label}-observation.png`) });
  await frame.locator('#timeline').evaluate(el => { el.value = '777'; el.dispatchEvent(new Event('input')); });
  await page.clock.runFor(50);
  const saved = await observation(frame);
  await frame.locator('#openPrediction').click();
  await frame.locator('#predictionDialog').waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#play').getAttribute('aria-pressed'), 'false');
  await assertLayout(frame, label, true);
  await page.screenshot({ path: path.join(artifacts, `${label}-question.png`) });
  for (let round = 0; round < 8; round++) {
    const answer = await assertQuestion(frame, round % 4);
    const before = await frame.locator('.prediction-choice').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    }));
    const wrong = frame.locator(`.prediction-choice:not([data-count="${answer}"])`).first();
    for (let retry = 0; retry < 3; retry++) await wrong.click();
    await assertQuestion(frame, round % 4);
    assert.match(await frame.locator('#predictionFeedback').textContent(), /もういちど/);
    if (round === 0) {
      await page.clock.fastForward(60000);
      await assertQuestion(frame, 0);
      await page.keyboard.press('Escape');
      assert(await frame.locator('#predictionDialog').isHidden());
      assert.equal(await frame.evaluate(() => document.activeElement.id), 'openPrediction');
      assert.deepEqual(await observation(frame), saved, 'Practice never seeks the observation');
      await frame.locator('#openPrediction').click();
      assert.match(await frame.locator('#predictionFeedback').textContent(), /もういちど/, 'Reopen preserves retry state');
      for (let tab = 0; tab < 6; tab++) {
        await page.keyboard.press('Tab');
        assert(await frame.evaluate(() => !!document.activeElement.closest('#predictionDialog')), 'Focus stays in the modal');
      }
      await page.screenshot({ path: path.join(artifacts, `${label}-retry.png`) });
    }
    if (round === 1) {
      await frame.locator(`.prediction-choice[data-count="${answer}"]`).focus();
      await page.keyboard.press('Space');
    } else {
      // Image taps must reach the answer button, including its nested SVG use.
      await frame.locator(`.prediction-choice[data-count="${answer}"] .prediction-bun`).first().click();
    }
    assert.match(await frame.locator('#predictionFeedback').textContent(), new RegExp(`だいせいかい！ ${answer / 2} \\+ ${answer / 2} = ${answer}こ`));
    assert(await frame.locator('#predictionStar').isVisible());
    assert.equal(await frame.locator('#predictionStar').evaluate(el => getComputedStyle(el).animationName), 'none', 'Celebration respects reduced motion');
    assert(await frame.locator('#predictionNext').isEnabled());
    assert.equal(await frame.locator('.prediction-choice:disabled').count(), 3);
    assert.equal(await frame.evaluate(() => document.activeElement.id), 'predictionNext');
    const after = await frame.locator('.prediction-choice').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    }));
    assert.deepEqual(after, before, 'Feedback never shifts answer targets');
    await page.clock.fastForward(60000);
    assert.equal(await frame.locator('#predictionCount').textContent(), String(answer / 2), 'Correct answer waits indefinitely for Next');
    assert.deepEqual(await observation(frame), saved, 'No practice mutation of exact observation');
    await assertLayout(frame, label, true);
    if (round === 3) {
      await page.screenshot({ path: path.join(artifacts, `${label}-correct-16.png`) });
      await frame.locator('#predictionDialog [data-close-dialog]').click();
      await frame.locator('#openPrediction').click();
      assert(await frame.locator('#predictionNext').isEnabled(), 'Reopen preserves success');
      assert.equal(await frame.evaluate(() => document.activeElement.id), 'predictionNext');
    }
    await page.keyboard.press('Enter');
  }
  await assertQuestion(frame, 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(await observation(frame), saved);
  for (const id of ['exactDialog', 'observationDialog', 'milestonesDialog', 'assumptionsDialog']) {
    await frame.locator(`[data-dialog="${id}"]`).click();
    assert(await frame.locator(`#${id}`).isVisible(), `${id}: original dialog preserved`);
    await frame.locator(`#${id} [data-close-dialog]`).click();
  }
  for (const seconds of [0, 299, 300, 599, 600, 3600, 86400]) {
    await frame.locator('#timeline').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input')); }, String(seconds));
    assert.equal((await frame.locator('#exactCount').textContent()).replace(/[,\s個]/g, ''), M.snapshot(seconds).count.toString(), `Exact observation at ${seconds}s`);
  }
  await frame.locator('#reset').click();
  await frame.locator('#speed').selectOption('1');
  await frame.locator('#play').click();
  await page.clock.runFor(1000);
  await frame.locator('#openPrediction').click();
  const paused = await observation(frame);
  await page.clock.fastForward(60000);
  assert.deepEqual(await observation(frame), paused, 'Opening practice pauses running observation');
  await page.keyboard.press('Escape');
  assert.equal(await frame.locator('#play').getAttribute('aria-pressed'), 'false', 'Closing never silently resumes time');
  await frame.locator('#play').click();
  await page.clock.runFor(1100);
  assert.notDeepEqual(await observation(frame), paused, 'Observation can still resume manually');
  await frame.locator('#play').click();
  console.log(`PASS ${label}: 8 questions, unlimited retry, explicit next, exact state, focus, fit, original dialogs`);
}

async function run() {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: installedChrome });
  try {
    for (const [width, height, embedded] of [[1024, 600, false], [1024, 600, true], [1180, 820, false], [1180, 820, true], [320, 568, false], [390, 844, true]]) {
      const label = `${embedded ? 'embedded' : 'direct'}-${width}x${height}`;
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' });
      page.on('pageerror', error => failures.push(error.message));
      await page.clock.install();
      // Establish a file origin without starting a second simulator in the host.
      await page.goto(embedded ? pathToFileURL(__filename).href : gameURL);
      if (embedded) await page.setContent(`<!doctype html><html><body style="margin:0"><iframe id="gameFrame" title="Baibain" src="${gameURL}" style="display:block;width:100vw;height:100dvh;border:0"></iframe></body></html>`);
      const frame = embedded ? await (await page.locator('#gameFrame').elementHandle()).contentFrame() : page;
      await exercise(page, frame, label);
      await page.close();
    }
    for (const [width, height] of [[1024, 600], [1180, 820]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?game=baibain');
      const frame = await (await page.locator('#gameFrame').elementHandle()).contentFrame();
      await frame.locator('#openPrediction').click();
      await assertLayout(frame, `shell-${width}x${height}`, true);
      await frame.locator('.prediction-choice[data-count="2"]').tap();
      assert.equal(await frame.locator('#predictionStar').evaluate(el => getComputedStyle(el).animationName), 'prediction-pop');
      await page.screenshot({ path: path.join(artifacts, `shell-${width}x${height}-correct.png`) });
      await page.close();
    }
    assert.deepEqual(failures, [], 'No browser JavaScript errors');
    console.log(`PASS: installed Chrome; 6 direct/iframe layouts and 2 real shell layouts. Screenshots: ${artifacts}`);
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
