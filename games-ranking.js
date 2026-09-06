/* Shared optional leaderboard. No network writes before the publish button. */
(() => {
  'use strict';
  if (window.MoonRanking && window.MoonRanking.ready) return;
  const ALIASES = [
    { id: 'sky-panda', name: 'そらの ぱんだ', icon: '🐼' },
    { id: 'star-cat', name: 'ほしの ねこ', icon: '🐱' },
    { id: 'moon-rabbit', name: 'つきの うさぎ', icon: '🐰' },
    { id: 'sun-dog', name: 'たいようの いぬ', icon: '🐶' },
    { id: 'sea-penguin', name: 'うみの ぺんぎん', icon: '🐧' },
    { id: 'forest-bear', name: 'もりの くま', icon: '🐻' }
  ];
  const GAMES = {
    moon: { name: 'つき', modes: [['current', 'いまの つき'], ['future', 'いっしゅうかんご']] },
    piano: { name: 'ぴあの', modes: [['twinkle','きらきらぼし'],['ode','よろこびの うた'],['mary','めりーさんの ひつじ'],['hotcross','ほっと くろす ばんず'],['london','ろんどんばし'],['canon','かのん'],['sakura','さくら'],['fur-elise','えりーぜの ために'],['eine-kleine','あいね くらいね'],['blue-danube','うつくしく あおき どなう'],['swan-lake','はくちょうの みずうみ'],['nutcracker','くるみわり にんぎょう'],['spring','はる'],['bach-air','じーせんじょうの ありあ'],['hallelujah','はれるや'],['william-tell','うぃりあむ てる'],['bridal-chorus','こんれいの がっしょう'],['anpanman-march-score','あんぱんまん まーち']] },
    addition: { name: 'さんすう', modes: [['add-5', 'たしざん・5まで'], ['add-10', 'たしざん・10まで'], ['add-20', 'たしざん・20まで'], ['sub-5', 'ひきざん・5まで'], ['sub-10', 'ひきざん・10まで'], ['sub-20', 'ひきざん・20まで']] },
    guess: { name: 'あてっこ', modes: [['default', 'あてっこ']] },
    food: { name: 'ごはん', modes: [['easy', 'やさしい'], ['normal', 'ふつう'], ['hard', 'むずかしい']] },
    english: { name: 'えいご', modes: [['animals', 'どうぶつ'], ['food', 'たべもの'], ['colors', 'いろ']] },
    baibain: { name: 'ばいばいん', modes: [['discoveries', 'みつけた もの']] }
  };
  const STORAGE_KEY = 'moon-ranking-player-v1';
  const submitted = new Set();
  let pending = null, identity = null, selectedAlias = ALIASES[0].id;
  let dialog, ui, trigger, opener = null, boardRequest = null, boardVersion = 0, submitting = false, initialized = false;
  function readIdentity() {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (value && typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 4096 && ALIASES.some(a => a.id === value.aliasId)) {
        identity = { token: value.token, aliasId: value.aliasId, alias: typeof value.alias === 'string' ? value.alias.slice(0, 80) : '' };
        selectedAlias = identity.aliasId;
      }
    } catch (_) { /* Private browsing or unavailable storage keeps an in-memory identity. */ }
  }
  function saveIdentity() { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity)); } catch (_) {} }
  function gameId(value) { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GAMES, value) ? value : 'moon'; }
  function currentGame() { return gameId(document.body && document.body.dataset.game); }
  function validMode(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value); }
  function validateResult(value) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(GAMES, value.game) || !validMode(value.mode)) return null;
    if (typeof value.runId !== 'string' || !/^[-a-zA-Z0-9_]{16,80}$/.test(value.runId)) return null;
    if (!value.metrics || typeof value.metrics !== 'object' || Array.isArray(value.metrics)) return null;
    let metrics;
    if (value.game === 'baibain') {
      if (!Array.isArray(value.metrics.discoveries) || value.metrics.discoveries.length < 1 || value.metrics.discoveries.length > 50 || !value.metrics.discoveries.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id))) return null;
      metrics = { discoveries: [...new Set(value.metrics.discoveries)] };
    } else {
      const keys = value.game === 'piano' ? ['perfect', 'great', 'good', 'ok', 'miss', 'maxCombo', 'noteCount'] : ['firstTry', 'completed', 'total'];
      if (!keys.every(key => Number.isSafeInteger(value.metrics[key]) && value.metrics[key] >= 0 && value.metrics[key] <= 1000000)) return null;
      metrics = Object.fromEntries(keys.map(key => [key, value.metrics[key]]));
      if (value.game === 'piano') {
        if (metrics.noteCount < 1 || metrics.maxCombo > metrics.noteCount || metrics.perfect + metrics.great + metrics.good + metrics.ok + metrics.miss !== metrics.noteCount) return null;
      } else if (metrics.total < 1 || metrics.completed !== metrics.total || metrics.firstTry > metrics.completed) return null;
    }
    return Object.freeze({ runId: value.runId, game: value.game, mode: value.mode, metrics: Object.freeze(metrics) });
  }
  function configBase() {
    const value = window.MOON_RANKING_CONFIG && window.MOON_RANKING_CONFIG.apiBase;
    if (typeof value !== 'string' || !value.trim()) return null;
    try { const url = new URL(value, window.location.href); return /^https?:$/.test(url.protocol) ? url.href.replace(/\/$/, '') : null; } catch (_) { return null; }
  }
  async function request(path, options = {}) {
    const base = configBase();
    if (!base) { const error = new Error('unconfigured'); error.code = 'unconfigured'; throw error; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal) { if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true }); }
    const timer = window.setTimeout(abort, 12000);
    try {
      const response = await window.fetch(base + path, { method: options.method || 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: options.headers || {}, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
      const data = await response.json();
      if (!response.ok) { const error = new Error('api'); error.code = data && data.error && data.error.code; error.status = response.status; throw error; }
      return data;
    } finally { window.clearTimeout(timer); if (options.signal) options.signal.removeEventListener('abort', abort); }
  }
  function messageFor(error) {
    if (error.code === 'unconfigured') return 'みんなの きろくは じゅんびちゅうだよ。げーむは そのまま あそべるよ。';
    if (error.status === 429) return 'すこし まってから、もういちど おしてね。';
    return 'つうしんが できなかったよ。「もういちど よむ」で ためしてね。';
  }
  function mountNavigation(actions) {
    if (!actions || actions.querySelector('[data-ranking-open]')) return;
    const button = element('button', 'moon-ranking-nav', 'らんきんぐ');
    button.type = 'button'; button.dataset.rankingOpen = ''; actions.append(button);
    updateTriggers();
  }
  function localTriggers() {
    const buttons = [...document.querySelectorAll('[data-ranking-open]')];
    try { if (window.parent !== window) buttons.push(...window.parent.document.querySelectorAll('[data-ranking-open]')); } catch (_) {}
    return buttons;
  }
  function parentHasNavigation() {
    try { return window.parent !== window && !!window.parent.document.querySelector('#gameNavigation, [data-game-nav-actions], .switcher'); } catch (_) { return false; }
  }
  function updateTriggers() {
    const available = !!pending && !submitted.has(pending.runId);
    const buttons = localTriggers();
    if (trigger) { trigger.hidden = buttons.length > 0 || parentHasNavigation(); buttons.push(trigger); }
    for (const button of buttons) {
      if (!button.dataset.rankingOriginalLabel) button.dataset.rankingOriginalLabel = button.textContent || 'らんきんぐ';
      button.dataset.rankingPending = String(available);
      button.textContent = available ? 'きろく' : button.dataset.rankingOriginalLabel;
      button.setAttribute('aria-label', available ? 'できた きろくを らんきんぐに のせる' : 'らんきんぐを ひらく');
    }
  }
  function complete(value) {
    const result = validateResult(value);
    if (!result || submitted.has(result.runId) || pending && pending.runId === result.runId) return false;
    pending = result;
    if (initialized) { if (ui) ui.publishStatus.textContent = ''; updateTriggers(); renderPending(); }
    return true;
  }
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function modesFor(game) {
    if (game !== 'piano') return GAMES[game].modes;
    let select = document.getElementById('songSelect');
    try { if (!select && window.parent !== window) select = window.parent.document.getElementById('gameFrame')?.contentDocument?.getElementById('songSelect'); } catch (_) {}
    const modes = select ? [...select.options].filter(o => validMode(o.value)).map(o => [o.value, o.textContent]) : [...GAMES.piano.modes];
    if (pending && pending.game === game && !modes.some(([id]) => id === pending.mode)) modes.push([pending.mode, 'あそんだ きょく']);
    return modes;
  }
  function renderModes(preferred) {
    const game = ui.game.value, modes = modesFor(game);
    ui.mode.replaceChildren(...modes.map(([id, name]) => { const option = element('option', '', name); option.value = id; return option; }));
    if (modes.some(([id]) => id === preferred)) ui.mode.value = preferred;
    ui.mode.disabled = modes.length === 0;
    ui.refresh.disabled = modes.length === 0;
  }
  function renderPending() {
    if (!ui) return;
    const match = pending && pending.game === ui.game.value && pending.mode === ui.mode.value;
    ui.publishPanel.hidden = !match;
    if (!match) return;
    ui.offer.textContent = submitted.has(pending.runId) ? 'この きろくは のせたよ！' : 'できた きろくを のせてみる？';
    ui.publish.disabled = submitting || submitted.has(pending.runId);
    ui.publish.textContent = submitting ? 'のせて いるよ…' : submitted.has(pending.runId) ? 'のせたよ！' : 'きろくを のせる';
    ui.alias.disabled = submitting;
    ui.note.textContent = 'えらんだ なまえと きろくが、みんなに みえるよ。';
  }
  async function loadBoard() {
    const version = ++boardVersion;
    if (boardRequest) boardRequest.abort();
    boardRequest = new AbortController();
    const game = ui.game.value, mode = ui.mode.value;
    ui.list.replaceChildren();
    renderPending();
    if (!mode) { ui.boardStatus.textContent = 'ぴあので きょくを えらぶと、きろくを みられるよ。'; return; }
    ui.boardStatus.textContent = 'みんなの きろくを よんで いるよ…';
    ui.list.setAttribute('aria-busy', 'true');
    try {
      const data = await request('/api/leaderboards?game=' + encodeURIComponent(game) + '&mode=' + encodeURIComponent(mode), { signal: boardRequest.signal });
      if (version !== boardVersion || !dialog.open) return;
      if (!data || !Array.isArray(data.entries)) throw new Error('invalid-response');
      const entries = data.entries.slice(0, 100);
      if (!entries.length) { ui.boardStatus.textContent = 'まだ きろくが ないよ。あそんでから のせてみよう！'; return; }
      ui.boardStatus.textContent = 'みんなの きろく';
      for (const entry of entries) {
        if (!entry || !Number.isSafeInteger(entry.rank) || entry.rank < 1 || typeof entry.alias !== 'string' || !Number.isFinite(entry.score)) continue;
        const row = element('li', 'mr-entry');
        const rank = element('span', 'mr-rank', String(entry.rank)); rank.setAttribute('aria-label', entry.rank + ' い');
        row.append(rank, element('span', 'mr-player', entry.alias.slice(0, 80)), element('strong', 'mr-score', entry.score.toLocaleString('ja-JP') + (typeof entry.unit === 'string' ? ' ' + entry.unit.slice(0, 20) : '')));
        ui.list.append(row);
      }
      if (!ui.list.children.length) throw new Error('invalid-response');
    } catch (error) {
      if (version !== boardVersion || !dialog.open) return;
      ui.boardStatus.textContent = messageFor(error);
    } finally { if (version === boardVersion) ui.list.setAttribute('aria-busy', 'false'); }
  }
  async function publish() {
    const run = pending;
    if (!run || submitting || submitted.has(run.runId) || run.game !== ui.game.value || run.mode !== ui.mode.value) return;
    submitting = true; renderPending(); ui.publishStatus.textContent = 'きろくを のせて いるよ…';
    const aliasId = ui.alias.value;
    try {
      if (!identity || identity.aliasId !== aliasId) {
        const player = await request('/api/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { aliasId } });
        if (!player || typeof player.token !== 'string' || !player.token || typeof player.alias !== 'string') throw new Error('invalid-player');
        identity = { token: player.token, alias: player.alias.slice(0, 80), aliasId };
        saveIdentity();
      }
      const data = await request('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + identity.token }, body: run });
      if (!data || !data.entry || !Number.isFinite(data.entry.score)) throw new Error('invalid-score');
      submitted.add(run.runId);
      if (pending?.runId === run.runId) ui.publishStatus.textContent = 'のせたよ！ ' + (Number.isSafeInteger(data.entry.rank) && data.entry.rank > 0 ? data.entry.rank + ' い。' : '') + 'また あそぼう！';
      updateTriggers();
      if (dialog.open && ui.game.value === run.game && ui.mode.value === run.mode) await loadBoard();
    } catch (error) {
      if (error.status === 401 || error.status === 403) { identity = null; try { window.localStorage.removeItem(STORAGE_KEY); } catch (_) {} }
      if (pending?.runId === run.runId) ui.publishStatus.textContent = error.code === 'unconfigured' ? messageFor(error) : error.status === 429 ? messageFor(error) : 'まだ のせられなかったよ。「きろくを のせる」で もういちど ためしてね。';
    } finally { submitting = false; renderPending(); }
  }
  function initialize() {
    if (initialized || !document.body) return;
    initialized = true;
    dialog = element('dialog', 'moon-ranking-dialog'); dialog.id = 'moonRankingDialog'; dialog.setAttribute('aria-labelledby', 'mrTitle');
    dialog.innerHTML = '<div class="mr-shell"><header class="mr-header"><div><p class="mr-kicker">MOON GAMES</p><h2 id="mrTitle">みんなの きろく</h2></div><button type="button" class="mr-close" aria-label="らんきんぐを とじる">×</button></header><div class="mr-content"><p class="mr-intro">じぶんの ぺーすで、たのしく あそぼう。</p><div class="mr-filters"><label>げーむ<select id="mrGame"></select></label><label>あそびかた<select id="mrMode"></select></label></div><section class="mr-publish" hidden aria-labelledby="mrOffer"><h3 id="mrOffer"></h3><label class="mr-alias-label">のせる なまえ<select id="mrAlias"></select></label><p class="mr-note" id="mrPrivacy"></p><button type="button" class="mr-primary" id="mrPublish">きろくを のせる</button><p class="mr-message" id="mrPublishStatus" role="status" aria-live="polite"></p></section><div class="mr-list-heading"><h3>らんきんぐ</h3><button type="button" class="mr-secondary" id="mrRefresh">もういちど よむ</button></div><p class="mr-message" id="mrStatus" role="status" aria-live="polite"></p><ol class="mr-list" id="mrList" aria-label="みんなの きろく"></ol></div><footer class="mr-footer"><button type="button" class="mr-secondary mr-return">げーむに もどる</button></footer></div>';
    document.body.append(dialog);
    const find = id => dialog.querySelector('#' + id);
    ui = { game: find('mrGame'), mode: find('mrMode'), alias: find('mrAlias'), offer: find('mrOffer'), note: find('mrPrivacy'), publish: find('mrPublish'), publishStatus: find('mrPublishStatus'), publishPanel: dialog.querySelector('.mr-publish'), refresh: find('mrRefresh'), boardStatus: find('mrStatus'), list: find('mrList') };
    for (const [id, game] of Object.entries(GAMES)) { const option = element('option', '', game.name); option.value = id; ui.game.append(option); }
    for (const alias of ALIASES) { const option = element('option', '', alias.icon + ' ' + alias.name); option.value = alias.id; ui.alias.append(option); }
    ui.alias.value = selectedAlias;
    ui.alias.addEventListener('change', () => { selectedAlias = ui.alias.value; });
    ui.game.addEventListener('change', () => { renderModes(pending?.game === ui.game.value ? pending.mode : undefined); ui.publishStatus.textContent = ''; loadBoard(); });
    ui.mode.addEventListener('change', () => { ui.publishStatus.textContent = ''; loadBoard(); });
    ui.refresh.addEventListener('click', loadBoard); ui.publish.addEventListener('click', publish);
    dialog.querySelector('.mr-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.mr-return').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { boardVersion++; if (boardRequest) boardRequest.abort(); window.dispatchEvent(new CustomEvent('moon:ranking-close')); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    trigger = element('button', 'moon-ranking-launch', 'らんきんぐ'); trigger.type = 'button'; trigger.id = 'moonRankingLaunch'; trigger.title = 'らんきんぐ'; trigger.addEventListener('click', () => open());
    const launchHost = document.querySelector('.scene-actions, .topbar, header.top, .app > header, main > header, .toolbar, [data-game-nav-actions]');
    if (launchHost) launchHost.append(trigger);
    mountNavigation(document.querySelector('[data-game-nav-actions]'));
    document.addEventListener('click', event => { const button = event.target.closest?.('[data-ranking-open]'); if (button) open({ game: button.dataset.rankingGame, mode: button.dataset.rankingMode }); });
    updateTriggers();
  }
  function open(options = {}) {
    const frame = document.getElementById('gameFrame');
    if (frame) {
      try {
        const child = frame.contentWindow;
        if (child && child.location.origin === window.location.origin && child.MoonRanking?.ready) {
          child.MoonRanking.open({ ...options, game: options.game || window.MoonGamesNavigation?.currentGame || currentGame(), returnFocus: document.activeElement });
          return;
        }
      } catch (_) { /* A standalone host view remains available if a frame cannot respond. */ }
    }
    initialize();
    if (!initialized) { document.addEventListener('DOMContentLoaded', () => open(options), { once: true }); return; }
    const game = gameId(options.game || pending?.game || currentGame());
    ui.game.value = game;
    renderModes(validMode(options.mode) ? options.mode : pending?.game === game ? pending.mode : document.getElementById('songSelect')?.value);
    ui.publishStatus.textContent = '';
    opener = options.returnFocus && typeof options.returnFocus.focus === 'function' ? options.returnFocus : document.activeElement;
    if (!dialog.open) { dialog.showModal(); window.dispatchEvent(new CustomEvent('moon:ranking-open')); }
    dialog.querySelector('.mr-close').focus({ preventScroll: true });
    loadBoard();
  }
  readIdentity();
  document.addEventListener('game-navigation-ready', event => { if (initialized) mountNavigation(event.detail?.actions || document.querySelector('[data-game-nav-actions]')); });
  document.addEventListener('game-navigation-change', () => { if (initialized) updateTriggers(); });
  window.MoonRanking = { ready: true, complete, open };
  const onComplete = event => complete(event.detail);
  window.addEventListener('moon:round-complete', onComplete);
  document.addEventListener('moon:round-complete', onComplete);
  const queue = Array.isArray(window.__moonRankingQueue) ? window.__moonRankingQueue.splice(0) : [];
  for (const value of queue) complete(value);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
  window.addEventListener('pagehide', () => { boardVersion++; if (boardRequest) boardRequest.abort(); });
})();
