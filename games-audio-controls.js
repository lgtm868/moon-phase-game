/* Volume-only UI: the audio engine owns persistence, playback and mute state. */
(() => {
  'use strict';
  function mount() {
    const audio = window.MoonAudio;
    if (!audio?.getVolumes || !audio?.setVolumes || document.getElementById('moonAudioSettings')) return;
    const header = document.querySelector('.scene-actions, .topbar, header.top, .app > header, main > header, .toolbar');
    if (!header) return;
    // Share the piano's existing ranking row, preserving the keyboard's budget.
    const ranking = header.querySelector('#moonRankingLaunch, [data-ranking-open]');
    let host = header.querySelector('.title-block, .top-actions') || header;
    if (header.querySelector('.title-block') && ranking?.parentElement === header && !ranking.hidden) {
      host = document.createElement('div');
      host.className = 'moon-audio-launch-row';
      ranking.replaceWith(host); host.append(ranking);
    }
    if (host.classList.contains('title-block')) header.classList.add('moon-audio-title-host');
    host.classList.add('moon-audio-host');
    const button = document.createElement('button');
    button.id = 'moonAudioSettings';
    button.className = 'moon-audio-icon-button';
    button.type = 'button';
    button.title = 'おとの おおきさ';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'moonAudioDialog');
    button.setAttribute('aria-expanded', 'false');
    /* Lucide SlidersHorizontal, ISC License.
     * Copyright (c) 2026 Lucide Icons and Contributors
     * Permission to use, copy, modify, and/or distribute this software for any
     * purpose with or without fee is hereby granted, provided that the above
     * copyright notice and this permission notice appear in all copies.
     * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
     * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
     * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
     * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
     * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
     * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
     * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
     */
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(key, value);
    for (const d of ['M10 5H3', 'M12 19H3', 'M14 3v4', 'M16 17v4', 'M21 12h-9', 'M21 19h-5', 'M21 5h-7', 'M8 10v4', 'M8 12H3']) {
      const path = document.createElementNS(icon.namespaceURI, 'path');
      path.setAttribute('d', d); icon.append(path);
    }
    button.append(icon);
    host.append(button);

    const dialog = document.createElement('dialog');
    dialog.id = 'moonAudioDialog';
    dialog.setAttribute('aria-labelledby', 'moonAudioTitle');
    const heading = document.createElement('div');
    heading.className = 'moon-audio-heading';
    const title = document.createElement('h2');
    title.id = 'moonAudioTitle'; title.textContent = 'おとの おおきさ';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'moon-audio-icon-button';
    close.textContent = '\u00d7'; close.title = 'とじる'; close.setAttribute('aria-label', 'とじる');
    heading.append(title, close); dialog.append(heading);
    const controls = new Map();
    for (const [key, labelText] of [['music', 'おんがく'], ['effects', 'こうかおん'], ['voice', 'こえ']]) {
      const row = document.createElement('div'); row.className = 'moon-audio-row';
      const label = document.createElement('label'); label.textContent = labelText; label.htmlFor = `moonAudio-${key}`;
      const input = document.createElement('input');
      input.id = label.htmlFor; input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01';
      const output = document.createElement('output'); output.htmlFor = input.id;
      row.append(label, output, input); dialog.append(row);
      controls.set(key, { input, output });
      input.addEventListener('input', () => {
        audio.setVolumes({ [key]: input.valueAsNumber });
        sync();
      });
    }
    document.body.append(dialog);
    function sync() {
      const volumes = audio.getVolumes();
      for (const [key, { input, output }] of controls) {
        const value = Number.isFinite(volumes[key]) ? Math.max(0, Math.min(1, volumes[key])) : 0;
        input.value = String(value);
        const percent = `${Math.round(value * 100)}%`;
        output.value = percent; input.setAttribute('aria-valuetext', percent);
      }
    }
    button.addEventListener('click', () => {
      if (dialog.open) return;
      sync(); dialog.showModal(); button.setAttribute('aria-expanded', 'true'); close.focus();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
    dialog.addEventListener('close', () => {
      button.setAttribute('aria-expanded', 'false');
      if (button.isConnected) button.focus({ preventScroll: true });
    });
    // Keep game keyboard and delegated click handlers out of this settings UI.
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click']) {
      dialog.addEventListener(type, event => event.stopPropagation());
      button.addEventListener(type, event => event.stopPropagation());
    }
    window.addEventListener('moon:audio-volume', sync);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
