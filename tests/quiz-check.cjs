const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = pathToFileURL(path.resolve(__dirname, '..', 'moon-phase-game.html')).href;
const phases = Array.from({ length: 8 }, (_, id) => id);
const phaseNames = ['しんげつ', 'ふくらむ細い月', 'じょうげん', 'ふくらむ丸い月',
  'まんげつ', 'かけていく丸い月', 'かげん', 'かけていく細い月'];
const weekAnswers = [2, 3, 4, 5, 6, 7, 0, 1];
// Independent reference cases: the displayed present moon is not the future answer.
const referenceCases = {
  6: { answer: 0, scene: '270', sourceName: 'かげん', answerName: 'しんげつ', file: 'lastquarter' },
  4: { answer: 6, scene: '180', sourceName: 'まんげつ', answerName: 'かげん', file: 'fullmoon' }
};
const modes = {
  current: { tab: '#tabQuiz', kinds: ['name', 'orbit'], size: 16 },
  future: { tab: '#tabChallenge', kinds: ['order'], size: 8 }
};
const motionControls = '#playButton, #stepButton, #resetButton';
const layoutViewports = [{ width: 320, height: 568 }, { width: 667, height: 375 }];

async function snapshot(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#quizPanel');
    const buttons = [...document.querySelectorAll('#quizOptions button')];
    return {
      mode: panel.dataset.mode,
      id: panel.dataset.questionId,
      kind: panel.dataset.kind,
      source: panel.dataset.source,
      prompt: document.querySelector('#quizPrompt').textContent,
      options: buttons.map(button => button.getAttribute('data-phase')),
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
  for (const key of ['mode', 'id', 'kind', 'source', 'prompt', 'options']) {
    assert.deepEqual(actual[key], expected[key], `${label}: ${key} changed`);
  }
}

async function checkSummary(page, question, label) {
  const solved = !question.nextDisabled;
  const masked = !solved && question.kind !== 'order';
  const phase = Number(question.source);
  assert.equal(question.scene, String(phase * 45), `${label}: source scene stays unchanged after grading`);
  assert.equal(question.summary.masked, masked, `${label}: only unsolved name/orbit hide the summary`);
  assert.equal(await page.locator('#phaseMoon').isHidden(), masked, `${label}: summary canvas visibility`);
  assert.equal(await page.locator('#phaseSummary .quiz-mask').isVisible(), masked, `${label}: visible question mask`);
  const name = phaseNames[phase];
  assert.equal(await page.locator(`#quizOptions button[data-phase="${phase}"]`).getAttribute('aria-label'),
    name, `${label}: source option has the expected accessible name`);
  if (masked) assert.notEqual(question.summary.name, name, `${label}: summary must not reveal the answer`);
  else assert.equal(question.summary.name, name, `${label}: summary names the displayed phase`);
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
  const samples = await page.locator('#quizOptions button').evaluateAll(buttons => buttons.map(button => {
    const canvases = button.querySelectorAll('canvas');
    if (canvases.length !== 1) return { id: button.dataset.phase, canvases: canvases.length };
    const canvas = canvases[0], { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    let total = 0, opaque = 0, bright = 0, left = 0, right = 0;
    // Sample inside the moon rim, excluding transparent padding and antialiasing.
    const radius = Math.min(width, height) * .39;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (Math.hypot(x + .5 - width / 2, y + .5 - height / 2) > radius) continue;
      total++;
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 200) continue;
      opaque++;
      if (data[offset] > 40) {
        bright++;
        if (x + .5 < width / 2) left++; else right++;
      }
    }
    return { id: Number(button.dataset.phase), canvases: 1, total,
      coverage: opaque / total, fraction: bright / total, side: (right - left) / total };
  }));
  for (const sample of samples) {
    const context = `${label}, canvas ${sample.id}: ${JSON.stringify(sample)}`;
    assert.equal(sample.canvases, 1, context);
    assert.ok(sample.total > 100 && sample.coverage > .95, `blank/incomplete ${context}`);
    const expected = (1 - Math.cos(sample.id * Math.PI / 4)) / 2;
    assert.ok(Math.abs(sample.fraction - expected) < .08, `illumination ${context}`);
    if (sample.id > 0 && sample.id < 4) assert.ok(sample.side > .075, `waxing must be right-lit: ${context}`);
    if (sample.id > 4) assert.ok(sample.side < -.075, `waning must be left-lit: ${context}`);
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

async function checkLayout(page, question, state, report) {
  const before = await snapshot(page);
  for (const viewport of layoutViewports) {
    await page.setViewportSize(viewport);
    // Flush resize handlers and two animation frames without real-time sleeps.
    await page.clock.runFor(34);
    const issues = await page.evaluate(() => {
      const issues = new Set(), tolerance = 1;
      const describe = element => element.id ? `#${element.id}`
        : element.tagName.toLowerCase() + (element.classList.length ? `.${[...element.classList].join('.')}` : '');
      const visible = element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible';
      const contains = (outer, inner, label) => {
        const excess = {
          left: outer.left - inner.left, top: outer.top - inner.top,
          right: inner.right - outer.right, bottom: inner.bottom - outer.bottom
        };
        const crossed = Object.entries(excess).filter(([, value]) => value > tolerance)
          .map(([side, value]) => `${side} ${value.toFixed(1)}px`);
        if (crossed.length) issues.add(`${label}: ${crossed.join(', ')}`);
      };
      for (const element of [document.documentElement, document.body]) {
        if (element.scrollWidth > innerWidth + tolerance) issues.add(`${describe(element)} horizontal scroll: ${element.scrollWidth} > ${innerWidth}`);
        if (element.scrollHeight > innerHeight + tolerance) issues.add(`${describe(element)} vertical scroll: ${element.scrollHeight} > ${innerHeight}`);
      }
      for (const selector of ['#phaseSummary', '#quizPanel', '[role="tablist"]']) {
        const region = document.querySelector(selector), bounds = region.getBoundingClientRect();
        if (!visible(region) || !bounds.width || !bounds.height) issues.add(`${selector} is not visible`);
        contains({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }, bounds, `${selector} outside viewport`);
        for (const element of [region, ...region.querySelectorAll('*')].filter(visible)) {
          const rect = element.getBoundingClientRect(), name = describe(element);
          contains(bounds, rect, `${name} outside ${selector}`);
          if (element.scrollWidth > element.clientWidth + tolerance) issues.add(`${name} horizontal content overflow: ${element.scrollWidth} > ${element.clientWidth}`);
          // The visible tab underline spans the border box, not just its content box.
          const height = element.matches('[role="tablist"]') && getComputedStyle(element).overflowY === 'visible'
            ? rect.height : element.clientHeight;
          if (element.scrollHeight > height + tolerance) issues.add(`${name} vertical content overflow: ${element.scrollHeight} > ${height}`);
          // DOM boxes alone miss text painted or clipped outside a fixed-height box.
          for (const node of element.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
            const range = document.createRange();
            range.setStart(node, node.textContent.search(/\S/));
            range.setEnd(node, node.textContent.trimEnd().length);
            for (const textRect of range.getClientRects()) {
              contains(rect, textRect, `${name} text outside its box`);
              contains(bounds, textRect, `${name} text outside ${selector}`);
            }
          }
        }
      }
      // Check adjacent content groups too: overflow can overlap a neighbor without leaving the panel.
      for (const selectors of [
        ['#quizPrompt', '#quizOptions', '#quizPanel .quiz-footer'],
        ['#phaseMoon', '#phaseSummary .quiz-mask', '#phaseSummary .phase-copy'],
        ['#phaseSummary .small-label', '#phaseName', '#phaseMessage'],
        ['#quizResult', '#quizNext'],
        ['#tabMoon', '#tabFriends', '#tabQuiz', '#tabChallenge']
      ]) {
        const elements = selectors.map(selector => document.querySelector(selector)).filter(visible);
        for (let i = 0; i < elements.length; i++) for (let j = i + 1; j < elements.length; j++) {
          const a = elements[i].getBoundingClientRect(), b = elements[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance) {
            issues.add(`${describe(elements[i])} overlaps ${describe(elements[j])}`);
          }
        }
      }
      return [...issues];
    });
    report.checks++;
    if (issues.length) report.failures.push({ viewport: `${viewport.width}x${viewport.height}`,
      question: `${question.mode}/${question.kind}:${question.source}`, state, prompt: question.prompt,
      result: await page.locator('#quizResult').textContent(), issues });
    const resized = await snapshot(page);
    assert.deepEqual(resized, before, `${state}: resize preserves source scene, summary and grading`);
    await checkSummary(page, resized, `${state}: resized summary`);
  }
}

async function checkDeck(browser, seed, exhaustive, errors, layout) {
  const page = await browser.newPage({ viewport: exhaustive ? { width: 1280, height: 800 } : { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Two reproducible random streams detect a fixed deck without flaky statistical assertions.
    await page.addInitScript(seed => {
      window.__spoken = [];
      window.speechSynthesis.speak = utterance => window.__spoken.push(utterance.text);
      window.speechSynthesis.cancel = () => {};
      window.speechSynthesis.getVoices = () => [];
      let state = seed >>> 0;
      Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }, seed);
    await page.clock.install();
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#voiceButton').click();
    const exploration = { scene: await page.locator('#space').getAttribute('aria-valuenow') };
    await page.locator('#tabQuiz').click();
    await page.locator('#quizNext').waitFor({ state: 'visible' });
    assert.equal((await snapshot(page)).mode, 'current', 'default quiz enters current mode');
    assert.ok(modes.current.kinds.includes((await snapshot(page)).kind), 'default quiz excludes future/order questions');
    const ids = { current: new Set(), future: new Set() }, exercisedKinds = new Set();
    const deck = { current: [], future: [] }, saved = {}, referencesChecked = new Set();
    // Interleave both modes through two complete decks, including independent refills.
    const schedule = Array.from({ length: 2 }, () => Array.from({ length: 16 }, (_, index) =>
      index < 8 ? ['current', 'future'] : ['current']).flat()).flat();
    for (const mode of schedule) {
      await page.locator(modes[mode].tab).click();
      const question = await snapshot(page);
      const index = deck[mode].length;
      const label = `seed ${seed}, ${mode} question ${index + 1} (${question.kind}:${question.source})`;
      if (saved[mode]) assert.deepEqual(question, saved[mode], `${label}: progress in other mode preserves queued question`);
      saved[mode] = question;
      assert.equal(question.mode, mode, `${label}: panel exposes selected mode`);
      assert.ok(question.id && !ids[mode].has(question.id), `${label}: nonempty unique questionId`);
      ids[mode].add(question.id);
      assert.ok(modes[mode].kinds.includes(question.kind), `${label}: mode contains only its own question kinds`);
      assert.match(question.source ?? '', /^[0-7]$/, `${label}: integer source 0..7`);
      assert.ok(question.prompt.trim(), `${label}: nonempty prompt`);
      assert.deepEqual([...question.options].sort(), phases.map(String), `${label}: eight unique phase buttons`);
      assert.deepEqual(question.correct, [], `${label}: no answer preselected`);
      assert.deepEqual(question.wrong, [], `${label}: wrong feedback cleared for new question`);
      assert.equal(question.nextDisabled, true, `${label}: next locked`);
      assert.equal(Number(question.result.match(/★\s*(\d+)/)?.[1]), index, `${label}: stars persist between questions`);
      deck[mode].push(`${question.kind}:${question.source}`);
      const reference = mode === 'future' ? referenceCases[question.source] : null;
      const answer = reference ? reference.answer : mode === 'future' ? weekAnswers[Number(question.source)] : Number(question.source);
      const correct = page.locator(`#quizOptions button[data-phase="${answer}"]`);
      await checkPixels(page, label);
      await checkSummary(page, question, label);
      if (reference) {
        assert.equal(question.scene, reference.scene, `${label}: explicit reference orbit position`);
        assert.equal(question.summary.name, reference.sourceName, `${label}: explicit present moon`);
        await checkSourceReadAloud(page, question, `${label}: unsolved`);
      }
      await checkControls(page, question, exhaustive && !exercisedKinds.has(question.kind));
      exercisedKinds.add(question.kind);

      if (!exhaustive) {
        await checkLayout(page, question, 'unsolved', layout);
        await page.locator(`#quizOptions button[data-phase="${(answer + 1) % 8}"]`).click();
        const rejected = await snapshot(page);
        assert.match(rejected.result, /もういちど/, `${label}: layout wrong-answer feedback`);
        assert.deepEqual(rejected.correct, [], `${label}: layout wrong answer rejected`);
        assert.equal(rejected.nextDisabled, true, `${label}: layout wrong answer cannot advance`);
        await checkLayout(page, question, 'wrong', layout);
      }

      if (exhaustive) {
        await page.locator('#quizNext').evaluate(button => button.click());
        await page.clock.fastForward(5000);
        assert.deepEqual(await snapshot(page), question, `${label}: no skipping/unsolved auto-next`);
        await checkPersistence(page, question, `${label}, unsolved`, exploration);
        await checkModePersistence(page, question, saved, `${label}, unsolved`, exploration);
        for (const wrong of phases.filter(id => id !== answer)) {
          await page.locator(`#quizOptions button[data-phase="${wrong}"]`).click();
          const rejected = await snapshot(page);
          sameQuestion(rejected, question, `${label}: wrong ${wrong}`);
          assert.match(rejected.result, /もういちど/, `${label}: wrong ${wrong} feedback`);
          assert.doesNotMatch(rejected.result, /みつけた/, `${label}: wrong ${wrong} not accepted`);
          assert.deepEqual(rejected.correct, [], `${label}: wrong ${wrong} not marked correct`);
          assert.ok(rejected.wrong.includes(String(wrong)), `${label}: wrong ${wrong} marked for retry`);
          assert.equal(rejected.nextDisabled, true, `${label}: wrong ${wrong} cannot advance`);
          assert.equal(rejected.scene, question.scene, `${label}: wrong ${wrong} preserves source scene`);
          assert.deepEqual(rejected.summary, question.summary, `${label}: wrong ${wrong} preserves summary`);
        }
        const rejected = await snapshot(page);
        await page.clock.fastForward(5000);
        assert.deepEqual(await snapshot(page), rejected, `${label}: wrong feedback has no timed transition`);
        await checkPersistence(page, rejected, `${label}, wrong`, exploration);
        await checkModePersistence(page, rejected, saved, `${label}, wrong`, exploration);
      }

      await correct.click();
      const solved = await snapshot(page);
      sameQuestion(solved, question, `${label}: correct answer`);
      assert.match(solved.result, /みつけた/, `${label}: success feedback`);
      assert.equal(Number(solved.result.match(/★\s*(\d+)/)?.[1]), index + 1, `${label}: exactly one star awarded`);
      assert.deepEqual(solved.correct, [String(answer)], `${label}: only correct answer marked`);
      assert.equal(solved.nextDisabled, false, `${label}: next unlocked`);
      await checkSummary(page, solved, `${label}: solved summary`);
      assert.equal(solved.result.split('\n')[1], `こたえ：${phaseNames[answer]}`,
        `${label}: second result line names the actual answer`);
      if (mode === 'future') {
        assert.equal(solved.scene, question.scene, `${label}: grading preserves source diagram`);
        assert.deepEqual(solved.summary, question.summary, `${label}: grading preserves entire source summary`);
      }
      if (reference) {
        assert.equal(solved.scene, reference.scene, `${label}: reference orbit stays at source after grading`);
        assert.equal(solved.summary.name, reference.sourceName, `${label}: source is not replaced by answer`);
        assert.equal(solved.result.split('\n')[1], `こたえ：${reference.answerName}`, `${label}: explicit future answer`);
        await checkSourceReadAloud(page, solved, `${label}: solved`);
        if (exhaustive && !referencesChecked.has(question.source)) {
          await page.screenshot({ path: path.resolve(__dirname, '..', 'output', `quiz-reference-${reference.file}.png`) });
        }
        referencesChecked.add(question.source);
      }
      if (!exhaustive) await checkLayout(page, solved, 'solved', layout);
      if (exhaustive) {
        // Dispatch also exercises the solved guard when native buttons become disabled.
        await correct.evaluate(button => { button.click(); button.click(); });
        await correct.dispatchEvent('click');
        await page.locator('#quizOptions button').evaluateAll(buttons => {
          buttons.forEach(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        });
        assert.deepEqual(await snapshot(page), solved, `${label}: repeat answers cannot add stars or alter success`);
        await page.clock.fastForward(5000);
        assert.deepEqual(await snapshot(page), solved, `${label}: no solved auto-next`);
        await checkPersistence(page, solved, `${label}, solved`, exploration);
        await checkModePersistence(page, solved, saved, `${label}, solved`, exploration);
        await page.clock.fastForward(5000);
        assert.deepEqual(await snapshot(page), solved, `${label}: no delayed next after returning`);
        await checkControls(page, solved, false);
      }
      await page.locator('#quizNext').click();
      const next = await snapshot(page);
      assert.ok(next.id && !ids[mode].has(next.id), `${label}: explicit next produces a new ID, including deck refill`);
      assert.equal(next.nextDisabled, true, `${label}: next question relocks next`);
      assert.deepEqual(next.correct, [], `${label}: next question clears success`);
      assert.deepEqual(next.wrong, [], `${label}: next question clears wrong feedback`);
      saved[mode] = next;
    }
    for (const [mode, config] of Object.entries(modes)) {
      const expected = config.kinds.flatMap(kind => phases.map(id => `${kind}:${id}`)).sort();
      for (let cycle = 0; cycle < 2; cycle++) {
        assert.deepEqual(deck[mode].slice(cycle * config.size, (cycle + 1) * config.size).sort(), expected,
          `${mode} deck ${cycle + 1}: every allowed kind/phase exactly once despite switching`);
      }
    }
    assert.deepEqual([...referencesChecked].sort(), ['4', '6'], 'both full moon -> last quarter and last quarter -> new moon regressions exercised');
    return deck;
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    const errors = [], layout = { checks: 0, failures: [] };
    const first = await checkDeck(browser, 12345, true, errors, layout);
    const second = await checkDeck(browser, 98765, false, errors, layout);
    for (const mode of Object.keys(modes)) {
      assert.notDeepEqual(first[mode].slice(0, modes[mode].size), second[mode].slice(0, modes[mode].size),
        `${mode}: different random seeds must shuffle the balanced deck`);
    }
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    assert.equal(layout.checks, 48 * 3 * layoutViewports.length, 'all question/state/viewport layouts checked');
    assert.equal(layout.failures.length, 0, JSON.stringify({ layoutChecks: layout.checks,
      failingLayouts: layout.failures.length, affected: layout.failures.map(({ viewport, question, state }) => `${viewport} ${question} ${state}`),
      examples: layout.failures.slice(0, 8) }, null, 2));
    console.log(JSON.stringify({ passed: true, questionsPerDeck: { current: 16, future: 8 }, seeds: 2,
      deckCyclesPerModePerSeed: 2, wrongAnswersRejected: 384, correctAnswersAccepted: 96,
      canvasChecks: 768, layoutChecks: layout.checks, layoutViewports }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
