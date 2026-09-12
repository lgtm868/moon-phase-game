'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const TAU = Math.PI * 2, DAYS = 29.53059;
const anchors = [0, 1, 2, 5, DAYS / 4, 9, 12, 13, DAYS / 2, 15.5, 16.5, 17.5, DAYS * 3 / 4, 24, 26, 28];
const anchorNames = ['\u3057\u3093\u3052\u3064', '\u3075\u3064\u304b\u3065\u304d', '\u307f\u304b\u3065\u304d', '\u3080\u3044\u304b\u3081\u306e\u3064\u304d', '\u3058\u3087\u3046\u3052\u3093', '\u3068\u304a\u304b\u3093\u3084', '\u3058\u3085\u3046\u3055\u3093\u3084', '\u3053\u3082\u3061\u3065\u304d', '\u307e\u3093\u3052\u3064', '\u3044\u3056\u3088\u3044', '\u305f\u3061\u307e\u3061\u3065\u304d', '\u3044\u307e\u3061\u3065\u304d', '\u304b\u3052\u3093', '\u3042\u308a\u3042\u3051', '\u307b\u305d\u3044\u3042\u308a\u3042\u3051', '\u307f\u305d\u304b\u3065\u304d'];
const dailyNames = [
  '\u3057\u3093\u3052\u3064', '\u3075\u3064\u304b\u3065\u304d', '\u307f\u304b\u3065\u304d', '\u3088\u3063\u304b\u3081\u306e\u3064\u304d', '\u3044\u3064\u304b\u3081\u306e\u3064\u304d',
  '\u3080\u3044\u304b\u3081\u306e\u3064\u304d', '\u306a\u306e\u304b\u3081\u306e\u3064\u304d', '\u3088\u3046\u304b\u3081\u306e\u3064\u304d', '\u3053\u3053\u306e\u304b\u3081\u306e\u3064\u304d', '\u3068\u304a\u304b\u3093\u3084',
  '\u3058\u3085\u3046\u3044\u3061\u306b\u3061\u3081\u306e\u3064\u304d', '\u3058\u3085\u3046\u306b\u306b\u3061\u3081\u306e\u3064\u304d', '\u3058\u3085\u3046\u3055\u3093\u3084', '\u3053\u3082\u3061\u3065\u304d', '\u3058\u3085\u3046\u3054\u3084',
  '\u3044\u3056\u3088\u3044', '\u305f\u3061\u307e\u3061\u3065\u304d', '\u3044\u307e\u3061\u3065\u304d', '\u306d\u307e\u3061\u3065\u304d', '\u3075\u3051\u307e\u3061\u3065\u304d',
  '\u306b\u3058\u3085\u3046\u3044\u3061\u306b\u3061\u3081\u306e\u3064\u304d', '\u306b\u3058\u3085\u3046\u306b\u306b\u3061\u3081\u306e\u3064\u304d', '\u306b\u3058\u3085\u3046\u3055\u3093\u3084', '\u306b\u3058\u3085\u3046\u3088\u3063\u304b\u3081\u306e\u3064\u304d', '\u306b\u3058\u3085\u3046\u3054\u306b\u3061\u3081\u306e\u3064\u304d',
  '\u306b\u3058\u3085\u3046\u308d\u304f\u3084', '\u306b\u3058\u3085\u3046\u3057\u3061\u306b\u3061\u3081\u306e\u3064\u304d', '\u306b\u3058\u3085\u3046\u306f\u3061\u306b\u3061\u3081\u306e\u3064\u304d', '\u306b\u3058\u3085\u3046\u304f\u306b\u3061\u3081\u306e\u3064\u304d', '\u307f\u305d\u304b\u3065\u304d'
];
const stops = [...new Set([...anchors, ...Array.from({ length: 30 }, (_, i) => i)])].sort((a, b) => a - b);
assert.equal(stops.length, 36);
const file = path.resolve(__dirname, '..', 'moon-phase-game.html');
const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '      buildPhasePicker();\n      updateAlbumCount();';
assert.equal(source.split(marker).length, 2, 'unique initialization probe point');
// Expose copies of live state in the served response only; never mutate app state.
const fixture = source.replace(marker,
  '      window.__moonNamesRead = () => ({ phase, shape: explorationShape(), quiz: quizShapeAt(normalizedPhase()), ages: [...phaseAges] });\n' + marker);
const artifacts = process.env.MOON_NAMES_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'moon-names-'));
const click = (page, selector) => page.locator(selector).evaluate(button => button.click());

async function checkLayout(page, label) {
  const issues = await page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('horizontal page overflow');
    if (document.documentElement.scrollHeight > innerHeight + 2) problems.push('vertical page overflow');
    const name = document.querySelector('#phaseName'), summary = document.querySelector('#phaseSummary');
    const nr = name.getBoundingClientRect(), sr = summary.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(name);
    for (const r of range.getClientRects()) {
      if (r.left < nr.left - 1 || r.right > nr.right + 1 || r.top < nr.top - 1 || r.bottom > nr.bottom + 1) problems.push('name text outside its box');
      if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1) problems.push('name text outside summary');
    }
    if (nr.width <= 0 || nr.height <= 0) problems.push('name hidden');
    const message = document.querySelector('#phaseMessage').getBoundingClientRect();
    if (nr.bottom > message.top + 1) problems.push('name overlaps description');
    if (message.bottom > sr.bottom + 1) problems.push('description outside summary: ' + message.bottom + ' > ' + sr.bottom);
    return problems;
  });
  assert.deepEqual(issues, [], label);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  const errors = [];
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1024, 600]]) {
      for (const embedded of [false, true]) {
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const host = await browser.newPage({ viewport: { width, height }, reducedMotion });
        host.on('pageerror', error => errors.push(error.message));
        await host.clock.install();
        await host.clock.pauseAt(new Date());
        await host.addInitScript(() => {
          window.__spoken = [];
          speechSynthesis.speak = utterance => window.__spoken.push({ text: utterance.text, lang: utterance.lang });
          speechSynthesis.cancel = () => {};
        });
        await host.route('**/moon-phase-game.html*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
        await host.goto(pathToFileURL(embedded ? path.join(path.dirname(file), 'index.html') : file).href);
        const page = embedded ? await (await host.locator('#gameFrame').elementHandle()).contentFrame() : host;
        await page.waitForFunction(() => typeof window.__moonNamesRead === 'function');
        await page.evaluate(() => document.fonts.ready);
        assert.deepEqual(await page.evaluate(() => __moonNamesRead().ages), anchors);
        assert.equal(await page.locator('#phaseList button').count(), 16);
        await click(page, '#resetButton');
        const seen = new Map();
        for (let step = 0; step <= stops.length; step++) {
          const age = stops[step % stops.length], anchor = anchors.indexOf(age);
          const expected = anchor >= 0 ? anchorNames[anchor] : dailyNames[Math.floor(age + 1e-8)];
          if (step) {
            await page.evaluate(() => { window.__spoken.length = 0; });
            await click(page, '#stepButton');
            await host.clock.runFor(400);
            assert.deepEqual(await page.evaluate(() => __spoken), [{ text: expected, lang: 'ja-JP' }],
              width + ' ' + reducedMotion + ' step speech age ' + age);
          }
          const { phase, shape, quiz } = await page.evaluate(() => __moonNamesRead());
          assert.ok(Math.abs(phase - age / DAYS * TAU) < 1e-8, 'destination age ' + age);
          assert.equal(shape.name, expected, 'name at age ' + age);
          assert.doesNotMatch(shape.name, /\u304b\u3051\u3066\u3044\u304f|\u3075\u304f\u3089\u3080/, 'name, not shape description');
          assert.equal(shape.index, anchor, 'exact anchor identity at age ' + age);
          assert.equal(await page.locator('#phaseName').textContent(), expected);
          assert.equal(await page.locator('#space').getAttribute('aria-valuetext'), expected);
          assert.ok((await page.locator('#phaseSummary').getAttribute('aria-label')).startsWith(expected + '\u3002'));
          if (anchor < 0) {
            assert.equal(shape.calendar, true, 'approximate calendar name');
            assert.equal(shape.message, quiz.detail, 'physical description remains separate');
            assert.equal(await page.locator('#phaseSummary .small-label').textContent(), '\u3053\u3088\u307f\u306e \u306a\u307e\u3048\u30fb\u3081\u3084\u3059');
          }
          await checkLayout(page, width + ' embedded=' + embedded + ' ' + reducedMotion + ' age ' + age);
          seen.set(age, expected);
          if (age === 20 && reducedMotion === 'reduce') {
            await host.screenshot({ path: path.join(artifacts, 'names-' + width + 'x' + height + (embedded ? '-embedded' : '-direct') + '.png') });
          }
        }
        for (const [age, expected] of [[18, '\u306d\u307e\u3061\u3065\u304d'], [19, '\u3075\u3051\u307e\u3061\u3065\u304d'], [22, '\u306b\u3058\u3085\u3046\u3055\u3093\u3084'], [25, '\u306b\u3058\u3085\u3046\u308d\u304f\u3084']]) {
          assert.equal(seen.get(age), expected, 'lunar day is age + 1');
        }
        for (let i = 0; i < anchors.length; i++) {
          await page.locator('#phaseList button').nth(i).evaluate(button => button.click());
          assert.equal(await page.locator('#phaseName').textContent(), anchorNames[i], 'picker anchor ' + i);
        }
        console.log('PASS ' + width + 'x' + height + ' embedded=' + embedded + ' ' + reducedMotion + ': 36 names, step speech, 16 anchors, text bounds');
        await host.close();
      }
      }
    }
    assert.deepEqual(errors, [], 'no browser errors');
    console.log('Screenshots: ' + artifacts);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
