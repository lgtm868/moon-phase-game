(() => {
  'use strict';
  const version = '20260907-fun';
  const games = Object.freeze({
    moon: { label: 'つき', title: 'おつきさま', icon: '🌙', file: 'moon-phase-game.html' },
    piano: { label: 'ぴあの', title: 'すぷらんきー ぴあの', icon: '🎹', file: 'sprunki-piano-game.html' },
    addition: { label: 'さんすう', title: 'すぷらんきーと さんすう', icon: '＋−', file: 'sprunki-addition-game.html' },
    guess: { label: 'あてっこ', title: 'すぷらんきー あてっこ', icon: '？', file: 'sprunki-guess-game.html' },
    baibain: { label: 'バイバイン', title: 'バイバイン観察室', icon: '×2', file: 'baibain-game.html' },
    food: { label: 'ごはん', title: 'ごはんクイズ', icon: '🍎', file: 'food-quiz-game.html' },
    english: { label: 'えいご', title: 'えいごで あそぼ', icon: 'Aa', file: 'english-game.html' }
  });
  const valid = key => Object.prototype.hasOwnProperty.call(games, key);
  const filename = location.pathname.split('/').pop() || '';
  const directGame = Object.keys(games).find(key => games[key].file === filename);
  if (directGame) {
    // Offline files and the explicit standalone mode retain the pure game view.
    const standalone = location.protocol === 'file:' || new URLSearchParams(location.search).get('standalone') === '1';
    if (window.self === window.top && !standalone) {
      const target = new URL('index.html', location.href);
      target.search = location.search;
      target.searchParams.delete('v');
      target.searchParams.set('game', directGame);
      target.hash = location.hash;
      location.replace(target.href);
    }
    return;
  }
  const header = document.getElementById('gameNavigation');
  let frame = document.getElementById('gameFrame');
  if (!header || !frame) return;
  const links = kind => Object.entries(games).map(([key, game]) =>
    `<a class="game-nav-link ${kind}" data-nav-game="${key}" href="?game=${key}"><span class="game-nav-icon" aria-hidden="true">${game.icon}</span><span>${game.label}</span><span class="game-nav-selected" aria-hidden="true">✓</span></a>`).join('');
  header.innerHTML = `<div class="game-nav-bar">
    <button id="gameMenuToggle" type="button" aria-haspopup="dialog" aria-controls="gameMenu" aria-expanded="false"><span aria-hidden="true">☷</span> ゲームを えらぶ</button>
    <span id="gameCurrent" class="game-nav-current" aria-live="polite"></span>
    <nav class="game-nav-shortcuts" aria-label="ゲームを えらぶ">${links('game-nav-shortcut')}</nav>
    <div data-game-nav-actions></div>
  </div>
  <dialog id="gameMenu" aria-labelledby="gameMenuTitle">
    <div class="game-menu-heading"><h2 id="gameMenuTitle">なにで あそぶ？</h2><button id="gameMenuClose" type="button" aria-label="ゲームいちらんを とじる">とじる <span aria-hidden="true">×</span></button></div>
    <nav class="game-menu-grid" aria-label="すべての ゲーム">${links('game-menu-card')}</nav>
  </dialog>`;
  const toggle = document.getElementById('gameMenuToggle');
  const dialog = document.getElementById('gameMenu');
  const close = document.getElementById('gameMenuClose');
  const current = document.getElementById('gameCurrent');
  const navLinks = Array.from(header.querySelectorAll('[data-nav-game]'));
  let activeGame = null, activeSource = null, fallbackInert = false;
  function closeMenu() {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    if (fallbackInert) { frame.inert = false; fallbackInert = false; }
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus({ preventScroll: true });
  }
  function openMenu() {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); frame.inert = true; fallbackInert = true; }
    toggle.setAttribute('aria-expanded', 'true');
    (dialog.querySelector(`[data-nav-game="${activeGame}"]`) || close).focus({ preventScroll: true });
  }
  function selectedGameFromURL() {
    const requested = new URLSearchParams(location.search).get('game');
    return valid(requested) ? requested : 'moon';
  }
  function sourceFor(key) {
    const url = new URL(games[key].file, location.href);
    const params = new URLSearchParams(location.search);
    params.delete('game'); params.delete('v'); params.delete('standalone');
    params.set('v', version); url.search = params.toString(); url.hash = location.hash;
    return url.href;
  }
  function selectGame(requested, replace = false) {
    const key = valid(requested) ? requested : 'moon';
    if (key === activeGame && !replace) { if (dialog.open) closeMenu(); return; }
    const route = new URL(location.href);
    if (!replace && activeGame !== key) { route.search = ''; route.hash = ''; }
    route.searchParams.set('game', key);
    if (replace) history.replaceState({ game: key }, '', route.href);
    else history.pushState({ game: key }, '', route.href);
    const source = sourceFor(key);
    if (source !== activeSource) {
      const nextFrame = frame.cloneNode(false);
      nextFrame.src = source;
      frame.replaceWith(nextFrame);
      frame = nextFrame;
      activeSource = source;
    }
    activeGame = key; frame.title = games[key].title;
    document.body.dataset.game = key; document.title = `${games[key].label} · Moon Games`;
    current.textContent = games[key].label;
    for (const link of navLinks) {
      const selected = link.dataset.navGame === key;
      link.classList.toggle('is-active', selected);
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    if (dialog.open) closeMenu();
    document.dispatchEvent(new CustomEvent('game-navigation-change', { detail: { game: key } }));
  }
  for (const link of navLinks) link.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button && event.button !== 0)) return;
    event.preventDefault(); selectGame(link.dataset.navGame);
  });
  toggle.addEventListener('click', openMenu); close.addEventListener('click', closeMenu);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeMenu(); });
  dialog.addEventListener('close', () => {
    toggle.setAttribute('aria-expanded', 'false');
    if (fallbackInert) { frame.inert = false; fallbackInert = false; }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeMenu();
  }});
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    if (event.key === 'Tab' && fallbackInert) {
      const items = [close, ...dialog.querySelectorAll('[data-nav-game]')], i = items.indexOf(document.activeElement);
      if (event.shiftKey && i <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && i === items.length - 1) { event.preventDefault(); close.focus(); }
    }
  });
  window.addEventListener('popstate', () => selectGame(selectedGameFromURL(), true));
  window.MoonGamesNavigation = Object.freeze({ games, selectGame, openMenu, closeMenu, get currentGame() { return activeGame; } });
  selectGame(selectedGameFromURL(), true);
  document.dispatchEvent(new CustomEvent('game-navigation-ready', { detail: { actions: header.querySelector('[data-game-nav-actions]') } }));
})();
