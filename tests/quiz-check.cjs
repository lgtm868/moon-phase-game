const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = pathToFileURL(path.resolve(__dirname, '..', 'moon-phase-game.html')).href;
const fs = require('node:fs');
const TAU = Math.PI * 2, QUARTER = Math.PI / 2, EPS = 1e-8;
const phases = Array.from({ length: 8 }, (_, id) => id);
const cardinalNames = ['しんげつ', 'じょうげん', 'まんげつ', 'かげん'];
const normalize = a => ((a % TAU) + TAU) % TAU;
const distance = (a, b) => Math.min(normalize(a - b), normalize(b - a));
const SYNODIC_DAYS = 29.53059;
// Advance elapsed lunar age, independently of the application's angular step.
const afterDays = (source, days) => ((source / TAU * SYNODIC_DAYS + days) % SYNODIC_DAYS) / SYNODIC_DAYS * TAU;
const targetFor = (source, mode) => mode === 'future' ? afterDays(source, 7) : source;
const cardinal = a => cardinalNames.findIndex((_, i) => distance(a, i * QUARTER) < EPS);
const shapeName = a => {
  const anchor = cardinal(a);
  if (anchor >= 0) return cardinalNames[anchor];
  if ((1 - Math.cos(a)) / 2 < .01) return a < Math.PI ? 'しんげつの すこしあと' : 'しんげつの すこしまえ';
  return (a < Math.PI ? 'ふくらむ' : 'かけていく') + ((1 - Math.cos(a)) / 2 < .5 ? '細い月' : '丸い月');
};
const illuminationLabel = a => {
  const percent = (1 - Math.cos(a)) * 50;
  if (percent > 0 && percent < 1) return '1パーセントより すくない';
  if (percent > 99 && percent < 100) return '99パーセントより おおきい';
  return `やく${Math.round(percent)}パーセント`;
};
const screenshots = process.env.QUIZ_SCREENSHOTS !== '0';
const modes = {
  current: { tab: '#tabQuiz', label: 'いまの形', kinds: ['name', 'orbit'], size: 20 },
  future: { tab: '#tabChallenge', label: '1週間後', kinds: ['order'], size: 20 }
};
const motionControls = '#playButton, #stepButton, #resetButton';
const pixelSizes = [64, 40];
const pixels = { canvases: 0, minimum: 1,
  byResolution: Object.fromEntries(pixelSizes.map(size => [size, { canvases: 0, minimum: 1 }])) };

async function checkModeLabels(page) {
  for (const { tab, label } of Object.values(modes)) {
    assert.equal((await page.locator(tab).innerText()).trim(), label, `${tab}: explicit visible mode label`);
    assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('id'), tab.slice(1),
      `${tab}: accessible mode label retains the existing tab ID`);
  }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#quizPanel');
    const buttons = [...document.querySelectorAll('#quizOptions button')];
    return {
      mode: panel.dataset.mode,
      id: panel.dataset.questionId,
      kind: panel.dataset.kind,
      source: Number(panel.dataset.sourceAngle),
      sourceType: panel.dataset.sourceType, legacySource: panel.dataset.source,
      prompt: document.querySelector('#quizPrompt').textContent,
      options: buttons.map(button => button.getAttribute('data-phase')),
      shapes: buttons.map(button => ({ id: button.dataset.phase, angle: Number(button.dataset.angle),
        name: button.dataset.name, label: button.getAttribute('aria-label') })),
      correct: buttons.filter(button => button.classList.contains('correct'))
        .map(button => button.getAttribute('data-phase')),
      wrong: buttons.filter(button => button.classList.contains('try-again'))
        .map(button => button.getAttribute('data-phase')),
      buttonStates: buttons.map(button => ({ phase: button.dataset.phase,
        className: button.className, disabled: button.disabled, label: button.getAttribute('aria-label') })),
      result: document.querySelector('#quizResult').textContent,
      nextDisabled: document.querySelector('#quizNext').disabled,
      scene: document.querySelector('#space').getAttribute('aria-valuenow'),
      summary: {
        masked: document.querySelector('#phaseSummary').classList.contains('is-masked'),
        name: document.querySelector('#phaseName').textContent,
        message: document.querySelector('#phaseMessage').textContent,
        label: document.querySelector('#phaseSummary').getAttribute('aria-label'),
        smallLabel: document.querySelector('#phaseSummary .small-label').textContent,
        moonLabel: document.querySelector('#phaseMoon').getAttribute('aria-label')
      }
    };
  });
}

function sameQuestion(actual, expected, label) {
  for (const key of ['mode', 'id', 'kind', 'source', 'sourceType', 'prompt', 'options', 'shapes']) {
    assert.deepEqual(actual[key], expected[key], `${label}: ${key} changed`);
  }
}

async function checkSummary(page, question, label) {
  const solved = !question.nextDisabled;
  const masked = !solved && question.kind !== 'order';
  assert.ok(distance(Number(question.scene) * Math.PI / 180, question.source) <= Math.PI / 360 + EPS,
    `${label}: scene represents source radians, rounded to degrees`);
  assert.equal(question.summary.masked, masked, `${label}: only unsolved name/orbit hide the summary`);
  assert.equal(await page.locator('#phaseMoon').isHidden(), masked);
  assert.equal(await page.locator('#phaseSummary .quiz-mask').isVisible(), masked);
  const name = shapeName(question.source);
  if (masked) assert.notEqual(question.summary.name, name, `${label}: no answer leak`);
  else assert.equal(question.summary.name, name, `${label}: summary names source, not future target`);
  if (question.kind === 'order') {
    assert.equal(question.summary.smallLabel, 'いまのつき', `${label}: summary is the present moon`);
    assert.equal(question.summary.moonLabel, name, `${label}: accessible moon names the source`);
    assert.equal(question.summary.label, `いまのつきは、${name}。${question.summary.message}`,
      `${label}: accessible summary describes the source, not the future answer`);
  }
}

async function checkSourceReadAloud(page, question, label) {
  await page.locator('#voiceButton').click();
  await page.evaluate(() => { window.__spoken.length = 0; });
  await page.locator('#phaseSummary').click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [question.summary.label],
    `${label}: tapping source summary reads its accessible source description`);
  await page.locator('#voiceButton').click();
}

async function checkPixels(page, label) {
  for (const size of pixelSizes) await checkPixelsAtSize(page, `${label}, ${size}px`, size);
}

async function checkPixelsAtSize(page, label, size) {
  const report = await page.locator('#quizOptions button').evaluateAll((buttons, size) => {
    const masks = [], samples = [];
    for (const button of buttons) {
      const canvases = button.querySelectorAll('canvas');
      if (canvases.length !== 1) return { error: 'each option needs one canvas' };
      const original = canvases[0], bounds = original.getBoundingClientRect();
      // Resample the same option at desktop and short-landscape display resolutions.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
      const { width, height } = canvas, { data } = ctx.getImageData(0, 0, width, height);
      const radius = Math.min(width, height) * 54 / 128, angle = Number(button.dataset.angle);
      const mask = [];
      let total = 0, opaque = 0, bright = 0, mismatch = 0;
      // Independent projected-sphere lighting oracle, not the application's shape/answer helpers.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const nx = (x + .5 - width / 2) / radius, ny = (y + .5 - height / 2) / radius;
        if (nx * nx + ny * ny > .96 ** 2) continue;
        const offset = (y * width + x) * 4;
        const lit = data[offset] > 40 && data[offset + 3] >= 200;
        const expected = nx * Math.sin(angle) - Math.sqrt(1 - nx * nx - ny * ny) * Math.cos(angle) > 0;
        total++; opaque += data[offset + 3] >= 200; bright += lit; mismatch += lit !== expected;
        mask.push(Number(lit));
      }
      masks.push(mask);
      samples.push({ id: button.dataset.phase, width, height,
        displayWidth: Math.round(bounds.width), displayHeight: Math.round(bounds.height),
        total, coverage: opaque / total,
        fraction: bright / total, expected: (1 - Math.cos(angle)) / 2, mismatch: mismatch / total });
    }
    let minimum = 1;
    for (let i = 0; i < masks.length; i++) for (let j = i + 1; j < masks.length; j++) {
      if (masks[i].length !== masks[j].length) return { error: 'option canvas sizes differ' };
      let changed = 0;
      for (let k = 0; k < masks[i].length; k++) changed += masks[i][k] !== masks[j][k];
      minimum = Math.min(minimum, changed / masks[i].length);
    }
    return { samples, minimum };
  }, size);
  assert.equal(report.error, undefined, `${label}: ${report.error}`);
  for (const sample of report.samples) {
    const context = `${label}: ${JSON.stringify(sample)}`;
    assert.equal(sample.displayWidth, 64, `desktop display resolution: ${context}`);
    assert.equal(sample.displayHeight, 64, `desktop display resolution: ${context}`);
    assert.equal(sample.width, size, `sample resolution: ${context}`);
    assert.equal(sample.height, size, `sample resolution: ${context}`);
    assert.ok(sample.total > 100 && sample.coverage > .95, `nonblank: ${context}`);
    assert.ok(Math.abs(sample.fraction - sample.expected) < .08, `illumination: ${context}`);
    assert.ok(sample.mismatch < .07, `side and terminator: ${context}`);
  }
  assert.ok(report.minimum >= .15, `${label}: rendered binary-mask distance ${report.minimum} < .15`);
  pixels.canvases += report.samples.length;
  pixels.minimum = Math.min(pixels.minimum, report.minimum);
  pixels.byResolution[size].canvases += report.samples.length;
  pixels.byResolution[size].minimum = Math.min(pixels.byResolution[size].minimum, report.minimum);
}

function checkSeparation(question, label) {
  const arc = a => a <= Math.PI ? (1 - Math.cos(a)) / 2 : 2 - (1 - Math.cos(a)) / 2;
  const positions = question.shapes.map(s => arc(s.angle)).sort((a, b) => a - b);
  for (let i = 0; i < 8; i++) {
    const gap = (positions[(i + 1) % 8] - positions[i] + 2) % 2;
    assert.ok(Math.abs(gap - .25) < EPS, `${label}: ideal area arc gap ${gap}`);
  }
}

async function checkControls(page, question, exercise) {
  const disabled = await page.locator(motionControls).evaluateAll(buttons => buttons.map(button => button.disabled));
  assert.deepEqual(disabled, [true, true, true], 'play/step/reset must be disabled in quiz');
  assert.equal(await page.locator('#space').getAttribute('aria-disabled'), 'true', 'orbit slider must be disabled');
  if (!exercise) return;
  const phase = await page.locator('#space').getAttribute('aria-valuenow');
  assert.ok(phase !== null, 'orbit slider exposes its current phase');
  await page.locator(motionControls).evaluateAll(buttons => buttons.forEach(button => button.click()));
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    await page.locator('#space').dispatchEvent('keydown', { key, bubbles: true });
    assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), phase, `quiz ignores ${key}`);
  }
  const box = await page.locator('#space').boundingBox();
  assert.ok(box, 'orbit scene is visible');
  const radius = Math.min(box.width * .32, box.height * .37);
  await page.mouse.move(box.x + box.width * .58 - radius, box.y + box.height * .52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .58, box.y + box.height * .52 - radius, { steps: 5 });
  await page.mouse.up();
  await page.clock.fastForward(1000);
  assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), phase, 'quiz ignores dragging/playback');
  assert.deepEqual(await snapshot(page), question, 'motion controls cannot mutate the quiz');
}

async function checkPersistence(page, expected, label, exploration) {
  const oldButtons = await page.locator('#quizOptions button').elementHandles();
  for (const tab of ['#tabMoon', '#tabFriends']) {
    await page.locator(tab).click();
    assert.ok(await page.locator('#quizPanel').isHidden(), `${label}: switched away`);
    assert.equal(await page.locator('#space').getAttribute('aria-valuenow'), exploration.scene,
      `${label}: leaving quiz restores the exploration phase saved on entry`);
    const disabled = await page.locator(motionControls).evaluateAll(buttons => buttons.map(button => button.disabled));
    assert.deepEqual(disabled, [false, false, false], `${label}: exploration controls restored`);
    for (const button of oldButtons) await button.evaluate(element => element.dispatchEvent(new MouseEvent('click')));
    await page.locator('#quizNext').dispatchEvent('click');
    await page.locator('#space').press(expected.scene === '0' ? 'End' : 'Home');
    assert.notEqual(await page.locator('#space').getAttribute('aria-valuenow'), expected.scene,
      `${label}: exploration actually changes the scene`);
    exploration.scene = await page.locator('#space').getAttribute('aria-valuenow');
    await page.locator(modes[expected.mode].tab).click();
    assert.deepEqual(await snapshot(page), expected, `${label}: ${tab} round trip`);
    await checkSummary(page, expected, `${label}: ${tab} summary restored`);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.deepEqual(await snapshot(page), expected, `${label}: pagehide`);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.deepEqual(await snapshot(page), expected, `${label}: foreground return`);
  for (const button of oldButtons) await button.dispose();
}

async function checkModePersistence(page, expected, saved, label, exploration) {
  const other = expected.mode === 'current' ? 'future' : 'current';
  const oldButtons = await page.locator('#quizOptions button').elementHandles();
  await page.locator(modes[other].tab).click();
  const peer = await snapshot(page);
  assert.equal(peer.mode, other, `${label}: switched quiz mode`);
  if (saved[other]) assert.deepEqual(peer, saved[other], `${label}: inactive mode was not mutated`);
  else {
    assert.equal(peer.nextDisabled, true, `${label}: other mode starts unsolved`);
    assert.match(peer.result, /★\s*0\s*$/, `${label}: other mode starts with its own zero score`);
  }
  saved[other] = peer;
  await checkSummary(page, peer, `${label}: other mode summary`);
  await checkControls(page, peer, false);
  for (const button of oldButtons) {
    assert.equal(await button.evaluate(element => element.isConnected), false, `${label}: old mode button detached`);
    await button.evaluate(element => {
      element.click();
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await button.dispose();
  }
  assert.deepEqual(await snapshot(page), peer, `${label}: stale old-mode buttons cannot grade active question`);
  await page.clock.fastForward(5000);
  assert.deepEqual(await snapshot(page), peer, `${label}: other mode has no timed transition`);
  await checkPersistence(page, peer, `${label}: other mode`, exploration);
  await page.locator(modes[expected.mode].tab).click();
  assert.deepEqual(await snapshot(page), expected, `${label}: original mode fully restored`);
  await checkSummary(page, expected, `${label}: original summary restored`);
  saved[expected.mode] = expected;
}

async function checkDeck(browser, seed, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const deck = { current: [], future: [] }, saved = {}, ids = new Set();
  const references = new Set(), captured = new Set(), exercised = new Set();
  try {
    await page.addInitScript(seed => {
      if (seed === 12345) {
        const NativeImage = window.Image;
        let first = true;
        window.Image = function(...args) {
          const image = new NativeImage(...args);
          if (first) {
            first = false;
            // The first Image is the embedded lunar texture; delay its actual load handler.
            Object.defineProperty(image, 'onload', { set(handler) {
              image.addEventListener('load', () => {
                window.__releaseLunarTexture = () => handler.call(image);
              }, { once: true });
            } });
          }
          return image;
        };
        window.Image.prototype = NativeImage.prototype;
      }
      window.__spoken = [];
      window.speechSynthesis.speak = utterance => window.__spoken.push(utterance.text);
      window.speechSynthesis.cancel = () => {};
      window.speechSynthesis.getVoices = () => [];
      let state = seed >>> 0;
      Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    }, seed);
    await page.clock.install();
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await checkModeLabels(page);
    await page.locator('#voiceButton').click();
    const exploration = { scene: await page.locator('#space').getAttribute('aria-valuenow') };
    // One 20-card deck per mode and seed; switching is interleaved, not extra deck traversal.
    for (let index = 0; index < 20; index++) for (const mode of Object.keys(modes)) {
      await page.locator(modes[mode].tab).click();
      const q = await snapshot(page), label = `seed ${seed}, ${mode} ${index + 1}, ${q.source}`;
      if (saved[mode]) assert.deepEqual(q, saved[mode], `${label}: queued mode preserved`);
      assert.equal(q.mode, mode);
      assert.equal(q.legacySource, undefined, `${label}: old integer source removed`);
      assert.ok(Number.isFinite(q.source) && q.source >= 0 && q.source < TAU, `${label}: source radians`);
      assert.ok(q.id && !ids.has(q.id), `${label}: unique ID`); ids.add(q.id);
      const anchor = cardinal(q.source);
      assert.ok(['anchor', 'continuous'].includes(q.sourceType));
      assert.equal(q.kind, mode === 'future' ? 'order' : q.sourceType === 'anchor' ? 'name' : 'orbit');
      assert.equal(anchor >= 0, q.sourceType === 'anchor', `${label}: only exact cardinal anchors`);
      assert.ok(q.prompt.trim());
      if (mode === 'current') assert.doesNotMatch(q.prompt, /しゅうかん|週間|つぎ|未来/, `${label}: no future questions`);
      assert.deepEqual([...q.options].sort(), phases.map(String));
      for (const s of q.shapes) {
        assert.ok(Number.isFinite(s.angle) && s.angle >= 0 && s.angle < TAU);
        assert.equal(s.name, shapeName(s.angle), `${label}: generic/cardinal name`);
        assert.equal(s.label, `${s.name}、あかるいところ ${illuminationLabel(s.angle)}`);
      }
      assert.deepEqual(q.correct, []); assert.deepEqual(q.wrong, []);
      assert.ok(q.nextDisabled && q.buttonStates.every(b => !b.disabled));
      assert.equal(Number(q.result.match(/★\s*(\d+)/)?.[1]), index);
      const target = targetFor(q.source, mode);
      const answers = q.shapes.filter(s => distance(s.angle, target) < EPS);
      assert.equal(answers.length, 1, `${label}: exactly one correct angle`);
      const answer = answers[0], wrong = q.shapes.find(s => s.id !== answer.id);
      checkSeparation(q, label);
      await checkPixels(page, label);
      await checkSummary(page, q, label);
      if (seed === 12345 && index === 0 && mode === 'future') {
        assert.equal(await page.evaluate(() => typeof window.__releaseLunarTexture), 'function');
        await page.evaluate(() => window.__releaseLunarTexture());
        assert.deepEqual(await snapshot(page), q, `${label}: delayed texture preserves active question`);
        await checkPixels(page, `${label}: delayed texture uses option angles, not IDs`);
      }
      deck[mode].push({ angle: q.source, kind: q.kind, type: q.sourceType, answerId: answer.id });
      const exercise = seed === 12345 && !exercised.has(q.kind);
      if (exercise) {
        exercised.add(q.kind);
        await checkControls(page, q, true);
        await page.locator('#quizNext').evaluate(b => b.click());
        await checkModePersistence(page, q, saved, `${label}: unsolved`, exploration);
      }
      await page.locator(`#quizOptions button[data-phase="${wrong.id}"]`).click();
      const rejected = await snapshot(page);
      sameQuestion(rejected, q, `${label}: wrong`);
      assert.match(rejected.result, /もういちど/);
      assert.deepEqual(rejected.correct, []);
      assert.ok(rejected.wrong.includes(wrong.id) && rejected.nextDisabled);
      assert.equal(rejected.scene, q.scene);
      assert.deepEqual(rejected.summary, q.summary);
      if (exercise) await checkModePersistence(page, rejected, saved, `${label}: wrong`, exploration);
      await page.locator(`#quizOptions button[data-phase="${answer.id}"]`).click();
      const solved = await snapshot(page);
      sameQuestion(solved, q, `${label}: solved`);
      assert.match(solved.result, /みつけた/);
      assert.equal(Number(solved.result.match(/★\s*(\d+)/)?.[1]), index + 1);
      assert.deepEqual(solved.correct, [answer.id]);
      assert.equal(solved.nextDisabled, false);
      assert.equal(solved.result.split('\n').length, 2);
      assert.equal(solved.result.split('\n')[1], `こたえ：${shapeName(target)}`);
      assert.equal(solved.scene, q.scene, `${label}: grading never moves source`);
      if (mode === 'future') assert.deepEqual(solved.summary, q.summary, `${label}: entire source summary fixed`);
      await checkSummary(page, solved, `${label}: solved`);
      if (mode === 'future' && [2, 3].includes(anchor)) {
        assert.ok(distance(answer.angle, afterDays(q.source, 7)) < EPS);
        assert.ok(distance(answer.angle, anchor === 3 ? 0 : 3 * QUARTER) > .08,
          `${label}: seven days must not silently become a quarter cycle`);
        assert.equal(solved.summary.name, cardinalNames[anchor]);
        assert.equal(solved.result.split('\n')[1], `こたえ：${shapeName(target)}`);
        await checkSourceReadAloud(page, solved, label);
        references.add(anchor);
      }
      if (screenshots && seed === 12345 && index > 0 && anchor < 0 && !captured.has(mode)) {
        await page.clock.runFor(800);
        await page.screenshot({ path: path.resolve(__dirname, '..', 'output', `quiz-${mode}-intermediate.png`) });
        captured.add(mode);
      }
      await page.locator('#quizOptions button').evaluateAll(bs =>
        bs.forEach(b => b.dispatchEvent(new MouseEvent('click', { bubbles: true }))));
      assert.deepEqual(await snapshot(page), solved, `${label}: no repeated scoring`);
      if (exercise) await checkModePersistence(page, solved, saved, `${label}: solved`, exploration);
      await page.locator('#quizNext').click();
      const next = await snapshot(page);
      assert.ok(next.id && !ids.has(next.id) && next.nextDisabled, `${label}: explicit next/refill`);
      assert.deepEqual(next.correct, []); assert.deepEqual(next.wrong, []);
      saved[mode] = next;
    }
    for (const [mode, questions] of Object.entries(deck)) {
      const anchors = questions.filter(q => q.type === 'anchor'), arbitrary = questions.filter(q => q.type === 'continuous');
      assert.deepEqual(anchors.map(q => cardinal(q.angle)).sort(), [0, 1, 2, 3], `${mode}: four anchors`);
      assert.equal(arbitrary.length, 16);
      assert.deepEqual(arbitrary.map(q => Math.floor(q.angle / TAU * 16)).sort((a, b) => a - b),
        Array.from({ length: 16 }, (_, i) => i), `${mode}: all cycle sectors`);
      assert.ok(arbitrary.every(q => Math.abs(q.angle / (TAU / 16) - Math.round(q.angle / (TAU / 16))) > EPS),
        `${mode}: jittered continuous angles, not a 16/8-phase grid`);
      assert.ok(new Set(questions.map(q => q.answerId)).size > 1, `${mode}: randomized correct local ID`);
    }
    assert.deepEqual([...references].sort(), [2, 3], 'full and last-quarter sources advance seven days, not 90 degrees');
    return deck;
  } finally { await page.close(); }
}

async function checkBoundaryPhases(browser, errors) {
  const covered = new Set();
  let tinyWaning = 0, rejected = 0, checked = 0;
  const sourceAtNew = (SYNODIC_DAYS - 7) / SYNODIC_DAYS * TAU;
  const jitterAt = source => source / TAU * 16 % 1;
  const fixtures = [
    { name: 'sector-start', jitter: 1e-6 },
    { name: 'sector-end', jitter: 1 - 1e-6 },
    ...[-1e-6, 0, 1e-6].map(delta => ({
      name: `seven-day-wrap-${delta}`, jitter: jitterAt(sourceAtNew + delta)
    })),
    ...[.12, .18].map(delta => ({
      name: `visible-waning-${delta}`, jitter: jitterAt(sourceAtNew - delta), tinySource: sourceAtNew - delta
    }))
  ];
  assert.ok(Math.abs(sourceAtNew * 180 / Math.PI - 274.6647594917677) < 1e-10,
    'seven-day wrap is after last quarter, not at 270 degrees');
  // Fixed jitter forces both sides of the actual seven-day wrap and sub-1% crescents.
  // Drive the real deck through its UI; do not replace production answer/shape helpers.
  for (const { name, jitter, tinySource } of fixtures) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(value => { Math.random = () => value; }, jitter);
      await page.clock.install();
      await page.goto(url);
      await checkModeLabels(page);
      await page.locator('#voiceButton').click();
      for (const mode of Object.keys(modes)) {
        await page.locator(modes[mode].tab).click();
        const sourceCoverage = [];
        for (let index = 0; index < 20; index++) {
          const q = await snapshot(page), label = `boundary ${name}, ${mode}, source ${q.source}`;
          sourceCoverage.push({ angle: q.source, type: q.sourceType });
          const target = targetFor(q.source, mode);
          const answers = q.shapes.filter(s => distance(s.angle, target) < EPS);
          assert.equal(answers.length, 1, `${label}: exactly one geometrically correct option`);
          const answer = answers[0];
          const tiny = mode === 'future' && tinySource !== undefined && distance(q.source, tinySource) < EPS;
          const endpoint = distance(target, 0) < 1e-5;
          if (tiny || endpoint) {
            checked++;
            await checkPixels(page, label);
            await checkSummary(page, q, label);
            if (endpoint) {
              const side = distance(target, 0) < EPS ? 'new' : target < Math.PI ? 'after' : 'before';
              covered.add(`${mode}:${side}`);
              assert.equal(answer.name, side === 'new' ? 'しんげつ'
                : side === 'after' ? 'しんげつの すこしあと' : 'しんげつの すこしまえ', label);
              assert.equal(answer.label, `${answer.name}、あかるいところ ${side === 'new'
                ? 'やく0パーセント' : '1パーセントより すくない'}`, label);
            }
            for (const shape of q.shapes) {
              assert.equal(shape.name, shapeName(shape.angle), `${label}: option name`);
              assert.equal(shape.label, `${shape.name}、あかるいところ ${illuminationLabel(shape.angle)}`,
                `${label}: precise accessible illumination`);
            }
            if (tiny) {
              tinyWaning++;
              assert.ok(target > TAU - .2 && target < TAU, `${label}: target is before new, not after`);
              assert.ok((1 - Math.cos(target)) / 2 < .01, `${label}: genuinely sub-1% illuminated`);
              assert.equal(answer.name, 'しんげつの すこしまえ');
              assert.ok(distance(answer.angle, 0) > .05, `${label}: tiny phase is not rounded to new`);
              const mask = await page.locator(`#quizOptions button[data-phase="${answer.id}"] canvas`).evaluate(canvas => {
                const { width, height } = canvas;
                const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
                let left = 0, right = 0, opaque = 0;
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                  const offset = (y * width + x) * 4;
                  if (data[offset + 3] < 200) continue;
                  opaque++;
                  if (data[offset] > 40) { if (x < width / 2) left++; else right++; }
                }
                return { left, right, opaque };
              });
              assert.ok(mask.opaque > 1000 && mask.left > 0, `${label}: visible left crescent ${JSON.stringify(mask)}`);
              assert.equal(mask.right, 0, `${label}: waning light cannot be on the right`);
              assert.ok(mask.left / mask.opaque < .02, `${label}: rendered crescent stays tiny`);
            }
            for (const wrong of q.shapes.filter(s => s.id !== answer.id)) {
              await page.locator(`#quizOptions button[data-phase="${wrong.id}"]`).click();
              const attempt = await snapshot(page);
              sameQuestion(attempt, q, `${label}: rejected ${wrong.id}`);
              assert.deepEqual(attempt.correct, [], `${label}: wrong option never scores`);
              assert.ok(attempt.nextDisabled && attempt.wrong.includes(wrong.id));
              assert.match(attempt.result, /もういちど/);
              assert.equal(attempt.scene, q.scene);
              assert.deepEqual(attempt.summary, q.summary);
              rejected++;
            }
            const wrongState = await snapshot(page);
            await page.locator(modes[mode === 'future' ? 'current' : 'future'].tab).click();
            await page.locator(modes[mode].tab).click();
            assert.deepEqual(await snapshot(page), wrongState, `${label}: boundary retries survive mode switches`);
          }
          await page.locator(`#quizOptions button[data-phase="${answer.id}"]`).click();
          const solved = await snapshot(page);
          sameQuestion(solved, q, `${label}: scoring preserves exact source`);
          assert.equal(solved.scene, q.scene, `${label}: scoring preserves source scene`);
          assert.deepEqual(solved.correct, [answer.id]);
          assert.equal(solved.nextDisabled, false);
          assert.equal(Number(solved.result.match(/★\s*(\d+)/)?.[1]), index + 1);
          if (mode === 'future') assert.deepEqual(solved.summary, q.summary, `${label}: source summary unchanged`);
          if (tiny || endpoint) {
            await page.locator('#tabMoon').click();
            await page.locator(modes[mode].tab).click();
            assert.deepEqual(await snapshot(page), solved, `${label}: solved boundary survives exploration`);
          }
          await page.locator('#quizNext').click();
        }
        assert.deepEqual(sourceCoverage.filter(q => q.type === 'anchor').map(q => cardinal(q.angle)).sort(),
          [0, 1, 2, 3], `${name} ${mode}: all four anchors retained`);
        assert.deepEqual(sourceCoverage.filter(q => q.type === 'continuous').map(q => Math.floor(q.angle / TAU * 16)).sort((a, b) => a - b),
          Array.from({ length: 16 }, (_, i) => i), `${name} ${mode}: all 16 source sectors retained`);
      }
    } finally { await page.close(); }
  }
  assert.equal(tinyWaning, 2, 'both sub-1% waning targets before the seven-day wrap exercised');
  assert.deepEqual([...covered].sort(), ['current:after', 'current:before', 'current:new',
    'future:after', 'future:before', 'future:new'], 'both sides and exact new exercised in each mode');
  return { cases: checked, decks: fixtures.length * 2, questions: fixtures.length * 40,
    tinyWaning, wrongAnswersRejected: rejected };
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    if (screenshots) fs.mkdirSync(path.resolve(__dirname, '..', 'output'), { recursive: true });
    const errors = [];
    const boundaries = await checkBoundaryPhases(browser, errors);
    const first = await checkDeck(browser, 12345, errors);
    const second = await checkDeck(browser, 98765, errors);
    for (const mode of Object.keys(modes)) {
      const angles = deck => deck[mode].filter(q => q.type === 'continuous').map(q => q.angle).sort((a, b) => a - b);
      assert.notDeepEqual(angles(first), angles(second), `${mode}: seeds vary angles, not just deck order`);
      assert.notDeepEqual(first[mode], second[mode], `${mode}: shuffled deck`);
    }
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log(JSON.stringify({ passed: true, questionsPerModePerSeed: 20, seeds: 2,
      correctAnswersAccepted: 80, wrongAnswersRejected: 80, canvasChecks: pixels.canvases,
      boundaries, delayedTextureChecks: 1, displayPixels: pixelSizes,
      pixelChecksByResolution: pixels.byResolution, minimumRenderedMaskDistance: pixels.minimum,
      requiredRenderedMaskDistance: .15 }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
