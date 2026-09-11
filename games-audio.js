/* Shared audio clock. Classic scripts keep packaged games usable via file://. */
(() => {
  'use strict';
  if (window.MoonAudio) return;
  const assetBase = document.currentScript?.src || location.href;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const settingsKey = 'moon-audio-settings-v1';
  let volumes = { music: 0.65, effects: 0.55, voice: 0.85 };
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) || 'null');
    for (const key of Object.keys(volumes)) if (saved && Number.isFinite(saved[key])) volumes[key] = Math.max(0, Math.min(1, saved[key]));
  } catch (_) { /* Storage is optional, including offline and private browsing. */ }
  let context = null, decoder = null, buses = null, master = null, compressor = null, resumePromise = null;
  let epoch = null, generation = 0, lifecycle = 0, ducked = false;
  let selected = new Set();
  const completedOneShots = new Set();
  const playing = new Map(), pending = new Set(), errors = new Map();
  const assets = new Map(), loaders = new Map(), decoded = new Map();
  const stopListeners = new Set(), effects = new Set(), retiring = new Set(), timers = new Set();
  function emit() { window.dispatchEvent(new CustomEvent('moon:audio-state', { detail: getMusicState() })); }
  function later(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer); return timer;
  }
  function ramp(node, value, seconds = 0.025) {
    if (!node || !context || context.state === 'closed') return;
    const parameter = node.gain, now = context.currentTime;
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
    else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
    parameter.linearRampToValueAtTime(value, now + seconds);
  }
  function refreshGains() {
    if (!buses) return;
    const time = context.currentTime;
    const joins = [...new Set([...playing.values()].map(voice => voice.when).filter(when => when > time))].sort((a, b) => a - b);
    const levelAt = when => {
      const power = [...playing.values()].filter(voice => voice.when <= when).reduce((total, voice) => total + voice.meta.gain ** 2, 0);
      return volumes.music * Math.min(0.8, 0.9 / Math.sqrt(Math.max(1, power))) * (ducked ? 0.28 : 1);
    };
    let level = levelAt(time);
    ramp(buses.music, level, Math.min(ducked ? 0.06 : 0.18, (joins[0] ?? Infinity) - time));
    // A queued stem must not attenuate the ensemble before its audible join.
    for (const when of joins) {
      buses.music.gain.setValueAtTime(level, when);
      level = levelAt(when);
      buses.music.gain.linearRampToValueAtTime(level, when + 0.008);
    }
    ramp(buses.effects, volumes.effects * 0.55);
  }
  function getContext() {
    if (!context || context.state === 'closed') {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('audio-unavailable');
      context = new Audio({ latencyHint: 'interactive' });
      buses = { music: context.createGain(), effects: context.createGain() };
      master = context.createGain(); master.gain.value = 0.8;
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 12;
      compressor.ratio.value = 8; compressor.attack.value = 0.003; compressor.release.value = 0.15;
      buses.music.connect(compressor); buses.effects.connect(compressor);
      compressor.connect(master); master.connect(context.destination);
      buses.music.gain.value = volumes.music * 0.8 * (ducked ? 0.28 : 1);
      buses.effects.gain.value = volumes.effects * 0.55;
      const created = context;
      created.addEventListener?.('statechange', () => {
        if (created === context && created.state === 'interrupted') suspend();
      });
    }
    return context;
  }
  function unlock() {
    if (document.hidden) return Promise.reject(new Error('page-hidden'));
    let current;
    try { current = getContext(); } catch (error) { return Promise.reject(error); }
    if (current.state === 'running') return Promise.resolve(current);
    if (!resumePromise) {
      const version = lifecycle;
      // resume is invoked synchronously in the originating user gesture.
      const attempt = Promise.resolve(current.resume()).then(() => {
        if (version !== lifecycle || current !== context || document.hidden) throw new Error('audio-cancelled');
        if (current.state !== 'running') throw new Error('audio-locked');
        return current;
      }).finally(() => { if (resumePromise === attempt) resumePromise = null; });
      resumePromise = attempt;
    }
    return resumePromise;
  }
  function output(bus = 'effects') { getContext(); return buses[bus === 'music' ? 'music' : 'effects']; }
  function now() { return getContext().currentTime; }
  function setVolumes(value) {
    for (const key of Object.keys(volumes)) if (value && Number.isFinite(value[key])) volumes[key] = Math.max(0, Math.min(1, value[key]));
    refreshGains();
    try { localStorage.setItem(settingsKey, JSON.stringify(volumes)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('moon:audio-volume', { detail: { ...volumes } }));
  }
  function setDucking(value) { ducked = !!value; refreshGains(); }
  function registerAsset(id, asset) {
    if (!/^[a-z0-9-]{1,40}$/.test(id) || !asset || typeof asset.data !== 'string') return;
    assets.set(id, asset);
  }
  function manifest(id) {
    const tracks = window.MoonAudioManifest?.tracks;
    if (!tracks || !own(tracks, id)) throw new Error('unknown-track');
    return tracks[id];
  }
  function loadAsset(id) {
    const metadata = manifest(id);
    if (assets.has(id)) return Promise.resolve(assets.get(id));
    if (loaders.has(id)) return loaders.get(id);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const path = metadata.file || 'sounds/packed/' + id + '.js';
      if (!/^sounds\/packed\/[a-z0-9-]+\.js$/.test(path)) { reject(new Error('invalid-track-path')); return; }
      let finished = false;
      const timer = setTimeout(() => finish(new Error('audio-load-timeout')), 15000);
      function finish(error) {
        if (finished) return; finished = true;
        clearTimeout(timer); script.onload = null; script.onerror = null; script.remove();
        if (error || !assets.has(id)) reject(error || new Error('missing-audio-data'));
        else resolve(assets.get(id));
      }
      script.src = new URL(path, assetBase).href;
      script.onload = () => finish(); script.onerror = () => finish(new Error('audio-load-failed'));
      document.head.append(script);
    }).catch(error => { loaders.delete(id); throw error; });
    loaders.set(id, promise); return promise;
  }
  async function loadTrack(id) {
    getContext();
    if (!decoded.has(id)) {
      const promise = loadAsset(id).then(async asset => {
        const raw = atob(asset.data), bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        // Device-rate decoding can truncate a loop by one sample. Keep the
        // source clock at the pack rate; Web Audio resamples during playback.
        const OfflineAudio = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineAudio) throw new Error('audio-decoder-unavailable');
        if (!decoder) decoder = new OfflineAudio(2, 1, 48000);
        const buffer = await decoder.decodeAudioData(bytes.buffer);
        const meta = { ...manifest(id), ...asset }; delete meta.data;
        const beats = Number(meta.beats), start = Number(meta.loopStart || 0), end = Number(meta.loopEnd);
        const bpm = Number(window.MoonAudioManifest?.bpm || 100);
        if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start || end > buffer.duration + 1 / buffer.sampleRate) throw new Error('invalid-loop');
        if (meta.loopable !== false && (!Number.isInteger(beats) || beats < 4 || beats > 128 || beats % 4)) throw new Error('invalid-loop');
        if (meta.loopable !== false && Math.abs(end - start - beats * 60 / bpm) > 1.1 / buffer.sampleRate) throw new Error('loop-not-on-beat');
        meta.loopStart = start; meta.loopEnd = Math.min(end, buffer.duration); meta.beats = meta.loopable === false ? null : beats;
        meta.gain = Number.isFinite(meta.gain) ? Math.max(0, Math.min(2, meta.gain)) : 1;
        return { buffer, meta };
      }).catch(error => { if (decoded.get(id) === promise) decoded.delete(id); throw error; });
      decoded.set(id, promise);
    }
    return decoded.get(id);
  }
  function disconnectVoice(voice) {
    if (voice.cleaned) return; voice.cleaned = true;
    retiring.delete(voice);
    try { voice.source.disconnect(); voice.gain.disconnect(); } catch (_) {}
  }
  function stopVoice(voice, immediate = false) {
    voice.stopped = true;
    retiring.add(voice);
    try {
      const time = voice.source.context.currentTime;
      if (immediate) voice.gain.gain.value = 0;
      else ramp(voice.gain, 0, 0.025);
      voice.source.stop(time + (immediate ? 0 : 0.03));
    } catch (_) {}
    if (immediate) disconnectVoice(voice); else later(() => disconnectVoice(voice), 60);
  }
  function balance() {
    refreshGains();
  }
  function getMusicState() {
    const time = context?.currentTime || 0;
    return {
      selected: [...selected],
      playing: [...playing].filter(([, voice]) => voice.when <= time).map(([id]) => id),
      pending: [...new Set([...pending, ...[...playing].filter(([, voice]) => voice.when > time).map(([id]) => id)])],
      errors: [...errors].map(([id, message]) => ({ id, message }))
    };
  }
  async function setMusicSelection(ids) {
    const allowed = Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)) : [];
    const version = ++generation, life = lifecycle;
    // Selection is level-triggered: stale UI snapshots cannot repeat a finished
    // one-shot. Omit its ID in a selection update before selecting it again.
    for (const id of completedOneShots) if (!allowed.includes(id)) completedOneShots.delete(id);
    selected = new Set(allowed.filter(id => !completedOneShots.has(id))); errors.clear();
    for (const [id, voice] of playing) if (!selected.has(id)) { stopVoice(voice); playing.delete(id); }
    pending.clear(); for (const id of selected) if (!playing.has(id)) pending.add(id);
    balance(); emit();
    if (!selected.size) { epoch = null; return; }
    let current;
    try { current = await unlock(); }
    catch (error) {
      if (version === generation && life === lifecycle) {
        for (const id of selected) if (!playing.has(id)) errors.set(id, error.message);
        pending.clear(); emit();
      }
      throw error;
    }
    const results = await Promise.all([...pending].map(async id => {
      try { return { id, ...(await loadTrack(id)) }; } catch (error) { return { id, error }; }
    }));
    if (version !== generation || life !== lifecycle || current !== context || document.hidden) return;
    const bpm = Number(window.MoonAudioManifest?.bpm || 100), bar = 4 * 60 / bpm;
    if (epoch === null) epoch = current.currentTime + 0.1;
    const when = epoch + Math.max(0, Math.ceil((current.currentTime + 0.08 - epoch) / bar)) * bar;
    for (const result of results) {
      const { id, buffer, meta, error } = result; pending.delete(id);
      if (error) { errors.set(id, error.message); continue; }
      if (!selected.has(id) || playing.has(id)) continue;
      let source, gain;
      try {
        source = current.createBufferSource(); gain = current.createGain();
        source.buffer = buffer; source.loop = meta.loopable !== false;
        if (source.loop) { source.loopStart = meta.loopStart; source.loopEnd = meta.loopEnd; }
        const duration = meta.beats * 60 / bpm;
        const offset = source.loop ? meta.loopStart + ((when - epoch) % duration + duration) % duration : 0;
        gain.gain.value = 0; gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(meta.gain, when + 0.008);
        source.connect(gain); gain.connect(output('music'));
        const voice = { source, gain, meta, when, offset, cleaned: false };
        source.onended = () => {
          disconnectVoice(voice);
          if (source.loop || voice.stopped || life !== lifecycle || playing.get(id) !== voice) return;
          playing.delete(id); selected.delete(id); completedOneShots.add(id);
          if (!selected.size) epoch = null;
          balance(); emit();
        };
        source.start(when, offset); playing.set(id, voice);
      } catch (_) {
        try { source?.stop(); } catch (_) {}
        try { source?.disconnect(); gain?.disconnect(); } catch (_) {}
        errors.set(id, 'audio-start-failed');
      }
    }
    balance(); emit();
    later(() => { if (life === lifecycle) emit(); }, Math.max(0, (when - current.currentTime) * 1000 + 25));
  }
  function stopMusic() {
    completedOneShots.clear();
    generation++; selected.clear(); pending.clear(); errors.clear(); epoch = null;
    for (const voice of playing.values()) stopVoice(voice);
    playing.clear(); balance(); emit();
  }
  async function effect(name = 'tap') {
    const life = lifecycle;
    if (document.hidden || volumes.effects === 0) return;
    let current;
    try { current = await unlock(); } catch (_) { return; }
    if (life !== lifecycle || document.hidden) return;
    const notes = name === 'complete' ? [523.25, 659.25, 783.99, 1046.5] : name === 'correct' ? [659.25, 880, 1046.5] : name === 'retry' ? [392] : [783.99];
    if (effects.size > 12) return;
    notes.forEach((frequency, index) => {
      const source = current.createOscillator(), gain = current.createGain(), when = current.currentTime + index * 0.075;
      source.type = 'triangle'; source.frequency.value = frequency;
      gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(0.12, when + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.23);
      source.connect(gain); gain.connect(output('effects'));
      const voice = { source, gain, cleaned: false }; effects.add(voice);
      source.onended = () => { effects.delete(voice); disconnectVoice(voice); };
      source.start(when); source.stop(when + 0.25);
    });
  }
  function suspend() {
    const musicVoices = [...new Set([...playing.values(), ...retiring])];
    lifecycle++; stopMusic(); ducked = false; resumePromise = null;
    for (const voice of musicVoices) stopVoice(voice, true);
    for (const timer of timers) clearTimeout(timer); timers.clear();
    for (const voice of effects) stopVoice(voice, true); effects.clear();
    for (const callback of stopListeners) { try { callback(); } catch (_) {} }
    // Disconnect music even when a suspended context can no longer reach its stop time.
    if (context && context.state !== 'closed') void context.suspend().catch(() => {});
    refreshGains();
  }
  function dispose() {
    suspend(); const old = context; context = null; decoder = null; buses = null; resumePromise = null;
    decoded.clear(); if (old && old.state !== 'closed') void old.close().catch(() => {});
  }
  function onSuspend(callback) { stopListeners.add(callback); return () => stopListeners.delete(callback); }
  window.MoonAudio = { getContext, unlock, output, now, setVolumes, getVolumes: () => ({ ...volumes }), setDucking,
    registerAsset, loadTrack, setMusicSelection, stopMusic, getMusicState, effect, suspend, dispose, onSuspend };
  function loadControls() {
    if (document.getElementById('moonAudioControlsScript')) return;
    const css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = new URL('games-audio-controls.css?v=20260912-polish', assetBase).href;
    const script = document.createElement('script'); script.id = 'moonAudioControlsScript';
    script.src = new URL('games-audio-controls.js?v=20260912-polish', assetBase).href;
    document.head.append(css, script);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadControls, { once: true });
  else loadControls();
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  window.addEventListener('pagehide', dispose);
})();
