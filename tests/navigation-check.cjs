const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
// Default: dependency-free VM checks. Add --browser for real Chromium checks,
// --screenshots for output/nav-shots, or NAVIGATION_ROOT to test a staged site.
// --browser --layout-only runs the focused pending-ranking layout regression.
const root = path.resolve(process.env.NAVIGATION_ROOT || path.join(__dirname, '..'));
const pages = { moon: 'moon-phase-game.html', piano: 'sprunki-piano-game.html', addition: 'sprunki-addition-game.html', guess: 'sprunki-guess-game.html', baibain: 'baibain-game.html', food: 'food-quiz-game.html', english: 'english-game.html' };
const routes = Object.keys(pages);
const source = fs.readFileSync(path.join(root, 'game-navigation.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
new vm.Script(source, { filename: 'game-navigation.js' });

// This DOM deliberately rejects navigation of a mounted iframe. The router must
// configure a detached replacement, preserving one top-level history entry.
function setup(url, { page = 'index.html', embedded = false, narrow = false, nativeDialog = true } = {}) {
  let document, frame, cursor = 0, redirects = [], replacements = 0, srcWrites = 0;
  const historyEntries = [new URL(url)], calls = [], windowEvents = new Map();
  let currentURL = new URL(url);
  const location = {
    get href() { return currentURL.href; }, get pathname() { return currentURL.pathname; },
    get search() { return currentURL.search; }, get hash() { return currentURL.hash; },
    get origin() { return currentURL.origin; }, get protocol() { return currentURL.protocol; },
    replace(value) { redirects.push(new URL(value, currentURL).href); currentURL = new URL(value, currentURL); },
    toString() { return this.href; }
  };
  function match(el, selector) {
    if (selector === '*') return true;
    if (selector.includes(',')) return selector.split(',').some(s => match(el, s.trim()));
    const not = selector.match(/:not\(([^)]+)\)/);
    if (not) return !match(el, not[1]) && match(el, selector.replace(not[0], ''));
    if (selector.startsWith('#')) return el.id === selector.slice(1);
    if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
    const attr = selector.match(/^([a-z0-9-]+)?\[([^\]=~^]+)(?:([~^]?=)["']?([^"'\]]*)["']?)?\]$/i);
    if (attr) {
      if (attr[1] && el.localName !== attr[1]) return false;
      const actual = el.getAttribute(attr[2]);
      return !attr[3] ? actual !== null : attr[3] === '^=' ? actual?.startsWith(attr[4]) : actual === attr[4];
    }
    return el.localName === selector;
  }
  class Element {
    constructor(tag) { this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.parentElement = null; this.events = new Map(); this.hidden = false; this._text = ''; this.dataset = new Proxy({}, { set: (target, key, value) => { target[key] = String(value); this.attrs['data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = String(value); return true; } }); if (tag === 'dialog' && !nativeDialog) { this.showModal = undefined; this.close = undefined; } }
    get open() { return this.hasAttribute('open'); } set open(value) { value ? this.setAttribute('open', '') : this.removeAttribute('open'); }
    get id() { return this.attrs.id || ''; } set id(value) { this.setAttribute('id', value); }
    get className() { return this.attrs.class || ''; } set className(value) { this.attrs.class = value; }
    get classList() { const self = this; return {
      contains(value) { return self.className.split(/\s+/).includes(value); },
      add(...values) { self.className = [...new Set([...self.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
      remove(...values) { self.className = self.className.split(/\s+/).filter(x => !values.includes(x)).join(' '); },
      toggle(value, enabled) { const on = enabled ?? !this.contains(value); on ? this.add(value) : this.remove(value); return on; }
    }; }
    setAttribute(name, value) { this.attrs[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
    removeAttribute(name) { delete this.attrs[name]; }
    get isConnected() { return this === document?.documentElement || Boolean(this.parentElement?.isConnected); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { if (this.localName === 'iframe') { assert.equal(this.isConnected, false, 'Mounted iframe.src creates nested history'); srcWrites++; } this.setAttribute('src', value); }
    get href() { return new URL(this.attrs.href || '', currentURL).href; } set href(value) { this.setAttribute('href', value); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    set innerHTML(html) { this.replaceChildren(); parse(html, this); }
    get innerHTML() { return this.textContent; }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'string') { this._text += node; continue; } node.parentElement = this; this.children.push(node); } }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
    cloneNode(deep) { assert.equal(deep, false); const clone = new Element(this.localName); for (const [k, v] of Object.entries(this.attrs)) clone.setAttribute(k, v); return clone; }
    replaceWith(next) { assert.equal(this.localName, 'iframe'); assert.equal(this, frame); assert.equal(next.isConnected, false); assert.equal(next.id, this.id); assert.equal(next.getAttribute('allow'), this.getAttribute('allow')); const parent = this.parentElement; parent.children[parent.children.indexOf(this)] = next; next.parentElement = parent; this.parentElement = null; frame = next; replacements++; }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(match(c, selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return match(this, selector) ? this : this.parentElement?.closest(selector) || null; }
    matches(selector) { return match(this, selector); }
    contains(node) { return node === this || this.children.some(c => c.contains(node)); }
    addEventListener(type, fn) { const list = this.events.get(type) || []; list.push(fn); this.events.set(type, list); }
    removeEventListener(type, fn) { this.events.set(type, (this.events.get(type) || []).filter(f => f !== fn)); }
    dispatchEvent(event) { event.target ||= this; event.currentTarget = this; event.preventDefault ||= function() { this.defaultPrevented = true; }; for (const fn of this.events.get(event.type) || []) fn(event); if (event.bubbles && !event.cancelBubble) this.parentElement?.dispatchEvent(event); return !event.defaultPrevented; }
    click() { this.dispatchEvent({ type: 'click', button: 0, bubbles: true, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
    scrollIntoView() {}
  }
  function parse(html, parent) {
    const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const stack = [parent];
    for (const token of stripped.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>|([^<]+)/gi)) {
      if (token[3]) { stack.at(-1)._text += token[3]; continue; }
      if (token[0].startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      const el = new Element(token[1]);
      for (const attr of token[2].matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g)) el.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
      stack.at(-1).append(el);
      if (!['meta', 'link', 'img', 'input', 'br', 'hr', 'source', 'area', 'base', 'embed', 'wbr'].includes(el.localName)) stack.push(el);
    }
  }
  document = {
    readyState: 'complete', activeElement: null, events: new Map(),
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    getElementById(id) { return this.documentElement.querySelector('#' + id); },
    querySelectorAll(selector) { return [...(match(this.documentElement, selector) ? [this.documentElement] : []), ...this.documentElement.querySelectorAll(selector)]; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { const list = this.events.get(type) || []; list.push(fn); this.events.set(type, list); },
    dispatchEvent(event) { for (const fn of this.events.get(event.type) || []) fn(event); return true; }
  };
  const container = new Element('root');
  parse(fs.readFileSync(path.join(root, page), 'utf8'), container);
  document.documentElement = container.querySelector('html');
  document.head = document.documentElement.querySelector('head');
  document.body = document.documentElement.querySelector('body');
  document.currentScript = { src: new URL('game-navigation.js', currentURL).href };
  frame = document.getElementById('gameFrame');
  const history = {
    get length() { return historyEntries.length; },
    replaceState(state, title, value) { currentURL = new URL(value, currentURL); historyEntries[cursor] = currentURL; calls.push({ type: 'replace', state, url: currentURL.href }); },
    pushState(state, title, value) { currentURL = new URL(value, currentURL); historyEntries.splice(cursor + 1); historyEntries.push(currentURL); cursor++; calls.push({ type: 'push', state, url: currentURL.href }); }
  };
  const window = { document, location, history, innerWidth: narrow ? 390 : 1280,
    addEventListener(type, fn) { const list = windowEvents.get(type) || []; list.push(fn); windowEvents.set(type, list); },
    matchMedia: () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }) };
  window.self = window; window.top = embedded ? {} : window; window.parent = window.top;
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  vm.runInNewContext(source, { document, window, location, history, URL, URLSearchParams, CustomEvent, console, setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, requestAnimationFrame: fn => fn() }, { filename: 'game-navigation.js' });
  const emit = type => { for (const fn of windowEvents.get(type) || []) fn({ type }); };
  for (const fn of document.events.get('DOMContentLoaded') || []) fn();
  return { document, window, location, history, calls, redirects, get frame() { return frame; }, get replacements() { return replacements; }, get srcWrites() { return srcWrites; }, emit,
    step(delta) { assert(cursor + delta >= 0 && cursor + delta < historyEntries.length); cursor += delta; currentURL = new URL(historyEntries[cursor]); emit('popstate'); },
    restore(search) { currentURL = new URL(search, currentURL); emit('popstate'); } };
}

function links(app) { return app.document.querySelectorAll('[data-nav-game]'); }
function selection(app, game) {
  const url = new URL(app.frame.src, app.location.href);
  assert.equal(path.posix.basename(url.pathname), pages[game]);
  assert(url.searchParams.get('v'), 'Child URLs carry a cache version');
  assert.equal(app.document.body.dataset.game, game);
  assert(app.frame.title && app.frame.title.length);
  for (const link of links(app)) {
    const selected = link.dataset.navGame === game;
    assert.equal(link.getAttribute('aria-current') === 'page', selected, 'Both navigation copies expose the selected game');
  }
  assert.equal(new URLSearchParams(app.location.search).get('game'), game);
}
function checkVM() {
  assert(/data-game-shell/.test(shell), 'The wrapper declares its role');
  const iframe = shell.match(/<iframe\b[^>]*id="gameFrame"[^>]*>/)[0];
  assert(!/\bsrc\s*=/.test(iframe), 'Do not preload Moon for every deep link');
  for (const game of routes) {
    assert(fs.existsSync(path.join(root, pages[game])));
    const child = fs.readFileSync(path.join(root, pages[game]), 'utf8');
    assert.equal([...child.matchAll(/<script\b[^>]*src="game-navigation\.js[^"]*"[^>]*>/g)].length, 1, game + ': one navigation script');
    assert(/<script\b(?=[^>]*src="game-navigation\.js)(?=[^>]*\bdefer\b)[^>]*>/.test(child), game + ': deferred navigation');
    for (const inline of child.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=|application\/(?:ld\+)?json/.test(inline[1])) new vm.Script(inline[2], { filename: pages[game] });
    }
  }
  for (const initial of [...routes, '', 'invalid', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const app = setup('https://example.test/games/index.html?game=' + encodeURIComponent(initial));
    const expected = routes.includes(initial) ? initial : 'moon';
    selection(app, expected);
    assert.equal(app.srcWrites, 1, 'One initial iframe URL assignment');
    assert.equal(app.calls[0].type, 'replace');
    assert.equal(links(app).length, routes.length * 2, 'Desktop and small-screen menus share seven destinations');
    for (const game of routes) {
      const link = links(app).find(l => l.dataset.navGame === game);
      const was = app.document.body.dataset.game, beforeCalls = app.calls.length, beforeFrame = app.frame;
      link.click(); selection(app, game);
      assert.equal(app.calls.length, beforeCalls + Number(was !== game));
      assert.equal(app.frame === beforeFrame, was === game);
      const calls = app.calls.length, frame = app.frame;
      link.click(); assert.equal(app.calls.length, calls); assert.equal(app.frame, frame);
    }
    for (const game of routes.slice(0, -1).reverse()) { app.step(-1); selection(app, game); }
    for (const game of routes.slice(1)) { app.step(1); selection(app, game); }
    for (const bad of ['invalid', '__proto__', 'constructor', 'toString']) { app.restore('?game=' + bad); selection(app, 'moon'); }
  }
  for (const game of routes) {
    const direct = setup('https://example.test/games/' + pages[game] + '?seed=42&mode=easy&v=old#round2', { page: pages[game] });
    assert.equal(direct.redirects.length, 1);
    const target = new URL(direct.redirects[0]); assert.equal(target.pathname, '/games/index.html'); assert.equal(target.searchParams.get('game'), game);
    assert.equal(target.searchParams.get('seed'), '42'); assert.equal(target.searchParams.get('mode'), 'easy'); assert.equal(target.hash, '#round2');
    assert.equal(target.searchParams.has('v'), false, 'Direct normalization removes stale cache versions');
    const embedded = setup('https://example.test/games/' + pages[game] + '?seed=42', { page: pages[game], embedded: true });
    assert.equal(embedded.redirects.length, 0, 'Embedded game never nests another wrapper');
    const standalone = setup('https://example.test/games/' + pages[game] + '?standalone=1&seed=42', { page: pages[game] });
    assert.equal(standalone.redirects.length, 0, 'Explicit standalone mode keeps the pure game');
    const offline = setup('file:///C:/Games/' + pages[game] + '?seed=42', { page: pages[game] });
    assert.equal(offline.redirects.length, 0, 'Offline direct files keep the pure game');
  }
  const query = setup('https://example.test/games/index.html?game=addition&seed=42&mode=easy&v=stale#round2');
  const childURL = new URL(query.frame.src, query.location.href);
  assert.equal(childURL.searchParams.get('seed'), '42'); assert.equal(childURL.searchParams.get('mode'), 'easy'); assert.equal(childURL.searchParams.has('game'), false); assert.notEqual(childURL.searchParams.get('v'), 'stale');
  const menuApp = setup('https://example.test/games/index.html?game=moon', { narrow: true });
  const toggle = menuApp.document.getElementById('gameMenuToggle'), menu = menuApp.document.getElementById('gameMenu'), close = menuApp.document.getElementById('gameMenuClose');
  toggle.focus(); toggle.click(); assert.equal(menu.open, true); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  close.click(); assert.equal(menu.open, false); assert.equal(menuApp.document.activeElement, toggle);
  toggle.click(); const cancel = { type: 'cancel' }; menu.dispatchEvent(cancel); if (!cancel.defaultPrevented) menu.close();
  assert.equal(menu.open, false); assert.equal(menuApp.document.activeElement, toggle);
  const api = menuApp.window.MoonGamesNavigation;
  assert.deepEqual(Object.keys(api.games), routes); assert(Object.isFrozen(api.games));
  api.selectGame('english'); selection(menuApp, 'english'); assert.equal(api.currentGame, 'english');
  const before = menuApp.calls.length;
  const modified = { type: 'click', button: 0, ctrlKey: true };
  links(menuApp).find(link => link.dataset.navGame === 'moon').dispatchEvent(modified);
  assert.equal(menuApp.calls.length, before); assert.equal(Boolean(modified.defaultPrevented), false, 'Ctrl-click retains native new-tab behavior');
  api.openMenu(); assert.equal(menu.open, true); api.selectGame('english'); assert.equal(menu.open, false); assert.equal(menuApp.calls.length, before);
  const fallback = setup('https://example.test/games/index.html?game=moon', { nativeDialog: false });
  fallback.window.MoonGamesNavigation.openMenu();
  const fallbackMenu = fallback.document.getElementById('gameMenu'), fallbackClose = fallback.document.getElementById('gameMenuClose');
  const fallbackLinks = fallbackMenu.querySelectorAll('[data-nav-game]');
  assert.equal(fallbackMenu.open, true); assert.equal(fallback.frame.inert, true);
  fallbackLinks.at(-1).focus(); fallbackMenu.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false }); assert.equal(fallback.document.activeElement, fallbackClose);
  fallbackClose.focus(); fallbackMenu.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true }); assert.equal(fallback.document.activeElement, fallbackLinks.at(-1));
  fallbackMenu.dispatchEvent({ type: 'keydown', key: 'Escape' }); assert.equal(fallbackMenu.open, false); assert.equal(fallback.frame.inert, false);
  console.log('PASS VM: central registry; seven routes; single initial iframe; same-tab preservation; full back/forward history; invalid routes; direct/embedded/standalone/offline handling; parameter forwarding; dialog/focus/fallback; public API; inline syntax.');
}
checkVM();

async function checkBrowser() {
  const http = require('node:http');
  const screenshotRoot = process.argv.includes('--screenshots') ? path.resolve(__dirname, '..', 'output', 'nav-shots') : null;
  if (screenshotRoot) fs.mkdirSync(screenshotRoot, { recursive: true });
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!target.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(target, (error, data) => {
      if (error) return res.writeHead(404).end();
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(data);
    });
  });
  let browser;
  const failures = [];
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) failures.push(response.status() + ' ' + response.url()); });
    async function loaded(game) {
      await page.waitForFunction(({ game, file }) => {
        const frame = document.querySelector('#gameFrame');
        return document.body.dataset.game === game && new URLSearchParams(location.search).get('game') === game
          && frame?.contentDocument?.readyState === 'complete' && frame.contentWindow.location.pathname.endsWith('/' + file);
      }, { game, file: pages[game] });
      const frame = await (await page.locator('#gameFrame').elementHandle()).contentFrame();
      assert.equal(page.frames().length, 2, game + ': one shell and one game');
      assert.equal(await frame.locator('#gameNavigation').count(), 0, game + ': embedded game does not duplicate navigation');
      return frame;
    }
    const desktopLink = game => page.locator('.game-nav-shortcuts [data-nav-game="' + game + '"]');
    if (!process.argv.includes('--layout-only')) {
    await page.goto(base + '/index.html?game=moon'); await loaded('moon');
    for (const game of routes) {
      await desktopLink(game).click();
      const frame = await loaded(game);
      await frame.evaluate(() => { window.__navigationMarker = 'keep-game-state'; });
      const count = await page.evaluate(() => history.length);
      await desktopLink(game).click();
      assert.equal(await frame.evaluate(() => window.__navigationMarker), 'keep-game-state');
      assert.equal(await page.evaluate(() => history.length), count);
    }
    for (const game of routes.slice(0, -1).reverse()) { await page.goBack(); await loaded(game); }
    for (const game of routes.slice(1)) { await page.goForward(); await loaded(game); }
    // Native anchor keyboard activation must work without custom mouse handling.
    await desktopLink('addition').focus(); await page.keyboard.press('Enter'); await loaded('addition');
    for (const game of routes) {
      await page.goto(base + '/' + pages[game] + '?navCheck=42#keep');
      const frame = await loaded(game);
      assert.equal(new URL(page.url()).searchParams.get('navCheck'), '42');
      assert.equal(new URL(page.url()).hash, '#keep');
      assert.equal(new URL(frame.url()).searchParams.get('navCheck'), '42');
      assert.equal(new URL(frame.url()).searchParams.has('game'), false);
      await page.goto(base + '/' + pages[game] + '?standalone=1');
      assert.equal(new URL(page.url()).pathname, '/' + pages[game]);
      assert.equal(page.frames().length, 1, game + ': standalone keeps a pure game view');
      assert.equal(await page.locator('#gameNavigation').count(), 0);
    }
    for (const invalid of ['invalid', '__proto__', 'constructor', 'toString']) {
      await page.goto(base + '/index.html?game=' + invalid); await loaded('moon');
    }
    for (const [width, height] of [[1280, 800], [1024, 600], [768, 1024], [844, 390], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height }); await page.goto(base + '/index.html?game=moon'); await loaded('moon');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow at ' + width);
      const toggle = page.locator('#gameMenuToggle');
      for (const game of routes) assert.equal(await desktopLink(game).isVisible(), width >= 1280, width + ': desktop shortcut breakpoint');
      if (screenshotRoot) await page.screenshot({ path: path.join(screenshotRoot, 'shell-' + width + 'x' + height + '.png') });
      if (await toggle.isVisible()) {
        await toggle.focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#gameMenu').open);
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        const menu = page.locator('#gameMenu');
        const choices = menu.locator('[data-nav-game]');
        assert.equal(await choices.count(), 7);
        if (screenshotRoot) await page.screenshot({ path: path.join(screenshotRoot, 'menu-' + width + 'x' + height + '.png') });
        for (const link of await choices.all()) {
          const box = await link.boundingBox(); assert(box && box.width >= 44 && box.height >= 44, width + ': large menu target');
        }
        // Tab stays within the native modal, never entering the game iframe.
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab');
          assert(await page.evaluate(() => !document.hasFocus() || document.querySelector('#gameMenu').contains(document.activeElement)), 'Document focus stays in the modal; browser chrome may receive focus');
        }
        await page.keyboard.press('Escape'); assert.equal(await menu.evaluate(el => el.open), false);
        assert.equal(await toggle.evaluate(el => document.activeElement === el), true);
        await toggle.click(); await menu.locator('[data-nav-game="english"]').click(); await loaded('english');
        assert.equal(await menu.evaluate(el => el.open), false);
        await toggle.click(); await page.locator('#gameMenuClose').click(); assert.equal(await menu.evaluate(el => el.open), false);
      } else {
        for (const game of routes) assert.equal(await desktopLink(game).isVisible(), true, width + ': visible route ' + game);
      }
    }
    }
    // A pending score used to wrap the ranking action into three clipped lines.
    // Force the longest supported label and exercise every active-game label.
    let pendingLayouts = 0;
    for (const [width, height] of [[320, 568], [390, 844], [1024, 600], [1133, 744], [1180, 820], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/index.html?game=moon'); await loaded('moon');
      if (!await page.locator('[data-ranking-open]').count()) break;
      for (const game of routes) {
        await page.evaluate(game => window.MoonGamesNavigation.selectGame(game), game);
        await loaded(game);
        const layout = await page.evaluate(() => {
          document.querySelector('[data-ranking-open]').textContent = 'きろくを のせる';
          const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          const controls = [...document.querySelectorAll('#gameNavigation button,.game-nav-shortcut')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height);
          return {
            header: rect(document.querySelector('#gameNavigation')), frame: rect(document.querySelector('#gameFrame')),
            overflow: document.documentElement.scrollWidth > innerWidth,
            shortcuts: getComputedStyle(document.querySelector('.game-nav-shortcuts')).display,
            controls: controls.map(element => {
              const range = document.createRange(); range.selectNodeContents(element);
              return { text: element.textContent.trim(), box: rect(element), content: rect({ getBoundingClientRect: () => range.getBoundingClientRect() }) };
            })
          };
        });
        const label = game + ' pending ranking at ' + width;
        assert.equal(layout.header.height, 56, label + ': fixed shell height');
        assert.equal(layout.frame.height, height - 56, label + ': game keeps its viewport budget');
        assert.equal(layout.overflow, false, label + ': no horizontal overflow');
        assert.equal(layout.shortcuts !== 'none', width >= 1280, label + ': shortcut breakpoint');
        for (const control of layout.controls) {
          assert.equal(control.box.height, 44, label + ': 44px navigation controls');
          assert(control.box.width >= 44, label + ': touch width');
          assert(control.content.x >= control.box.x - .5 && control.content.right <= control.box.right + .5 && control.content.y >= control.box.y - .5 && control.content.bottom <= control.box.bottom + .5, label + ': unclipped ' + control.text);
        }
        await page.locator('#gameMenuToggle').click();
        const menu = page.locator('#gameMenu');
        assert.equal(await menu.evaluate(el => el.open), true);
        assert.equal(await menu.locator('[data-nav-game]').count(), 7);
        assert.equal(await menu.locator('[data-nav-game="' + game + '"]').getAttribute('aria-current'), 'page');
        await page.keyboard.press('Tab');
        assert(await page.evaluate(() => !document.hasFocus() || document.querySelector('#gameMenu').contains(document.activeElement)), label + ': modal keyboard focus');
        await page.keyboard.press('Escape');
        assert.equal(await menu.evaluate(el => el.open), false);
        assert.equal(await page.locator('#gameMenuToggle').evaluate(el => el === document.activeElement), true);
        if (screenshotRoot && game === 'baibain') {
          await page.locator('[data-ranking-open]').evaluate(element => { element.textContent = 'きろくを のせる'; });
          await page.screenshot({ path: path.join(screenshotRoot, 'pending-' + width + 'x' + height + '.png') });
        }
        pendingLayouts++;
      }
    }
    console.log('PASS browser: ' + pendingLayouts + ' pending-ranking layout and keyboard cases (zero means optional ranking was not installed).');
    assert.deepEqual(failures, [], 'No script exceptions or missing local resources');
    console.log(process.argv.includes('--layout-only')
      ? 'PASS browser: focused pending-ranking layouts, modal keyboard behavior, no local 404s.'
      : 'PASS browser: seven games, same-tab state, real back/forward, direct URL normalization, keyboard links, responsive modal, Escape/focus, no local 404s.');
  } finally {
    try { if (browser) await browser.close(); }
    finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  }
}
if (process.argv.includes('--browser')) checkBrowser().catch(error => { console.error(error); process.exitCode = 1; });
