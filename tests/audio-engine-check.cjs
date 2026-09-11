'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'games-audio.js'), 'utf8');

function setup(options = {}) {
  const sources = [], contexts = [], decoders = [], scripts = [], dispatched = [], timers = new Map(), events = new Map();
  const decoderControl = { hook: null };
  const sourceControl = { startHook: null };
  let timerId = 0;
  class Parameter {
    constructor(value = 0, context = null) { this._value = value; this.initial = value; this.context = context; this.events = []; }
    get value() { return this._value; }
    set value(value) { this._value = value; this.events.push(['set', value, this.context?.currentTime || 0]); }
    setValueAtTime(value, time) { this._value = value; this.events.push(['set', value, time]); }
    linearRampToValueAtTime(value, time) { this._value = value; this.events.push(['linear', value, time]); }
    exponentialRampToValueAtTime(value, time) { this._value = value; this.events.push(['exponential', value, time]); }
    valueAt(time) {
      let value = this.initial, at = 0;
      for (const [kind, next, end] of [...this.events].sort((a, b) => a[2] - b[2])) {
        if (end > time) {
          if (kind === 'set' || end === at) return value;
          const fraction = (time - at) / (end - at);
          return kind === 'exponential' && value > 0 ? value * (next / value) ** fraction : value + (next - value) * fraction;
        }
        value = next; at = end;
      }
      return value;
    }
    cancelScheduledValues(time) { this.events = this.events.filter(event => event[2] < time); }
    cancelAndHoldAtTime(time) { const held = this.valueAt(time); this.cancelScheduledValues(time); this.setValueAtTime(held, time); }
  }
  class Node {
    constructor(context) { this.context = context; this.gain = new Parameter(0, context); this.connections = []; this.connectionHistory = []; }
    connect(other) { this.connections.push(other); this.connectionHistory.push(other); return other; }
    disconnect() { this.disconnected = true; this.connections = []; }
  }
  class AudioContext {
    constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = {}; this.sampleRate = 44100; this.listeners = new Map(); this.resumeCalls = 0; this.decodeCalls = 0; contexts.push(this); }
    createGain() { return new Node(this); }
    createDynamicsCompressor() { const node = new Node(this); for (const key of ['threshold','knee','ratio','attack','release']) node[key] = new Parameter(); return node; }
    createBufferSource() { const node = new Node(this); node.start = (when, offset) => { if (sourceControl.startHook) sourceControl.startHook(node, when, offset); node.started = [when, offset]; }; node.stop = when => { node.stopped = when; }; sources.push(node); return node; }
    createOscillator() { const node = this.createBufferSource(); node.frequency = new Parameter(); return node; }
    resume() { this.resumeCalls++; if (this.resumeHook) return this.resumeHook(); this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    decodeAudioData(bytes) { this.decodeCalls++; if (this.decodeHook) return this.decodeHook(bytes); return Promise.resolve({ ...JSON.parse(Buffer.from(bytes).toString()), sampleRate: this.sampleRate }); }
  }
  class OfflineAudioContext {
    constructor(channels, length, sampleRate) {
      this.channels = channels; this.length = length; this.sampleRate = sampleRate;
      this.decodeCalls = 0; decoders.push(this);
    }
    decodeAudioData(bytes) {
      this.decodeCalls++;
      if (decoderControl.hook) return decoderControl.hook(bytes);
      return Promise.resolve({ ...JSON.parse(Buffer.from(bytes).toString()), sampleRate: this.sampleRate });
    }
  }
  const document = {
    hidden: false, currentScript: { src: 'file:///game/games-audio.js' }, readyState: 'loading',
    addEventListener(name, fn) { events.set('document:' + name, fn); },
    createElement() { return { remove() { this.removed = true; } }; },
    head: { append(script) { scripts.push(script); } }
  };
  const window = {
    AudioContext,
    OfflineAudioContext: options.webkitOnly ? undefined : OfflineAudioContext,
    webkitOfflineAudioContext: OfflineAudioContext,
    MoonAudioManifest: { bpm: 100, beatsPerBar: 4, tracks: {} },
    addEventListener(name, fn) { events.set('window:' + name, fn); }, dispatchEvent(event) { dispatched.push(event); }
  };
  const globals = { window, document, location: { href: 'file:///game/index.html' }, URL, Uint8Array,
    localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, globals);
  function add(id, beats = 8, loaded = true, length = beats * .6) {
    const meta = { beats, loopStart: 0, loopEnd: length, gain: 1, file: 'sounds/packed/' + id + '.js' };
    const asset = { ...meta, data: Buffer.from(JSON.stringify({ duration: length })).toString('base64'), type: 'audio/wav' };
    window.MoonAudioManifest.tracks[id] = meta;
    if (loaded) window.MoonAudio.registerAsset(id, asset);
    return asset;
  }
  function addBlack(loaded = true) {
    const asset = add('black', 0, false, 17.46);
    asset.loopable = false; asset.type = 'audio/mpeg';
    window.MoonAudioManifest.tracks.black.loopable = false;
    if (loaded) window.MoonAudio.registerAsset('black', asset);
    return asset;
  }
  return { api: window.MoonAudio, document, window, contexts, decoders, decoderControl, sourceControl, sources, scripts, events, dispatched, timers, add, addBlack };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function lifecycleChecks() {
  const failures = [];
  async function check(name, run, options) {
    const t = setup(options);
    try { await run(t); console.log('PASS ' + name); }
    catch (error) { failures.push({ name, error }); console.error('FAIL ' + name + ': ' + error.message); }
    finally { t.api.dispose(); }
  }

  for (const webkitOnly of [false, true]) {
    await check('Lazy singleton 48kHz offline decoder' + (webkitOnly ? ' (webkit fallback)' : ''), async t => {
      assert.equal(t.decoders.length, 0, 'Engine load never allocates a decoder');
      const playback = await t.api.unlock();
      assert.equal(playback.sampleRate, 44100, 'Exercise an actual 44.1kHz playback-device model');
      assert.equal(t.decoders.length, 0, 'Unlock alone never allocates a decoder');
      t.add('a'); t.add('b');
      const [a, b] = await Promise.all([t.api.loadTrack('a'), t.api.loadTrack('b')]);
      assert.equal(t.decoders.length, 1, 'Concurrent track decodes share one offline decoder');
      const decoder = t.decoders[0];
      assert.deepEqual([decoder.channels, decoder.length, decoder.sampleRate], [2, 1, 48000]);
      assert.equal(a.buffer.sampleRate, 48000);
      assert.equal(b.buffer.sampleRate, 48000);
      assert.equal(playback.decodeCalls, 0, 'Never decode through the playback device sample rate');
      assert.equal(decoder.decodeCalls, 2);
      assert.equal(await t.api.loadTrack('a'), a);
      assert.equal(decoder.decodeCalls, 2, 'Cached buffers are not decoded again');
    }, { webkitOnly });
  }

  await check('source.start failure is isolated to its track and disconnects partial nodes', async t => {
    t.add('keep'); t.add('bad', 16); t.add('join', 32);
    await t.api.setMusicSelection(['keep']);
    const keeper = t.sources[0]; t.contexts[0].currentTime = .5;
    t.sourceControl.startHook = node => { if (node.buffer.duration === 9.6) throw new Error('start-fault'); };
    await t.api.setMusicSelection(['keep', 'bad', 'join']);
    const failed = t.sources.find(node => node.buffer.duration === 9.6);
    assert(failed, 'Fault injection reached the failing source');
    assert(failed.disconnected, 'Failed source must be disconnected');
    assert(failed.connectionHistory[0]?.disconnected, 'Its gain must also be disconnected');
    assert.equal(failed.started, undefined);
    assert.equal(keeper.stopped, undefined);
    assert.equal(keeper.disconnected, undefined);
    const state = t.api.getMusicState();
    assert(state.playing.includes('keep'), 'Existing stem survives another track failing');
    assert.equal(state.errors.length, 1);
    assert.equal(state.errors[0].id, 'bad');
    assert.equal(state.errors[0].message, 'audio-start-failed');
    assert(!state.pending.includes('bad'));
    assert(t.sources.some(node => node.buffer.duration === 19.2 && node.started), 'Later tracks in the same batch still start');
  });

  await check('Future stem join cannot attenuate the already playing mix early', async t => {
    t.add('keep'); t.add('join');
    await t.api.setMusicSelection(['keep']);
    const ctx = t.contexts[0]; ctx.currentTime = .5;
    const gain = t.sources[0].connections[0].gain, bus = t.api.output('music').gain;
    const level = gain.valueAt(.5) * bus.valueAt(.5);
    assert(level > 0);
    await t.api.setMusicSelection(['keep', 'join']);
    const joining = t.sources[1], when = joining.started[0];
    assert(when > .6, 'Exercise a genuinely future bar');
    for (const at of [.5, .55, (when + .5) / 2, when - .001]) {
      assert(Math.abs(gain.valueAt(at) * bus.valueAt(at) - level) < 1e-9,
        `Existing mix changed before scheduled join at ${when}s (sample ${at}s)`);
      assert.equal(joining.connections[0].gain.valueAt(at), 0, 'Joining stem stays silent before its scheduled onset');
    }
    assert(gain.valueAt(when + .1) * bus.valueAt(when + .1) < level,
      'Headroom balancing still takes effect after the join');
  });

  await check('Black preview and next-bar original one-shot, natural end and stale selection suppression', async t => {
    t.addBlack();
    const preview = await t.api.loadTrack('black');
    assert.equal(preview.buffer.duration, 17.46);
    assert.equal(preview.meta.loopable, false);
    assert.equal(preview.meta.beats, null, 'No verified period is invented');
    assert.equal(t.sources.length, 0, 'Decoding alone cannot start a preview');
    t.add('verified');
    await t.api.setMusicSelection(['verified']);
    const keeper = t.sources[0], ctx = t.contexts[0]; ctx.currentTime = .5;
    await t.api.setMusicSelection(['black', 'verified']);
    const black = t.sources[1], gain = black.connections[0], bus = t.api.output('music').gain;
    assert.equal(black.buffer, preview.buffer, 'Use the entire original decoded buffer');
    assert.equal(black.loop, false);
    assert.equal(black.loopEnd, undefined, 'No cropping or loop boundary on the source');
    assert.equal(black.playbackRate, undefined, 'No stretching');
    assert.deepEqual(black.started, [2.5, 0]);
    assert.equal(black.stopped, undefined, 'No scheduled truncation');
    assert.equal(t.api.getMusicState().errors.length, 0);
    assert(t.api.getMusicState().pending.includes('black'));
    await t.api.setMusicSelection(['black', 'verified']);
    assert.equal(t.sources.length, 2, 'Unchanged queued selection never restarts');
    ctx.currentTime = 3;
    await t.api.setMusicSelection(['black', 'verified']);
    assert.equal(t.sources.length, 2, 'Unchanged playing selection never restarts');
    assert(t.api.getMusicState().playing.includes('black'));
    t.api.setVolumes({ music: .4 }); t.api.setDucking(true);
    assert(Math.abs(bus.valueAt(3.2) - .4 * .9 / Math.sqrt(2) * .28) < 1e-9);
    ctx.currentTime = 19.95; t.api.setDucking(false);
    assert(!gain.disconnected, 'Per-track gain stays connected through the whole original');
    ctx.currentTime = 19.96;
    const count = t.dispatched.length;
    black.onended();
    assert(black.disconnected && gain.disconnected);
    assert.equal(t.dispatched.length, count + 1);
    assert.equal(t.dispatched.at(-1).type, 'moon:audio-state');
    assert.deepEqual(Array.from(t.dispatched.at(-1).detail.selected), ['verified']);
    assert.deepEqual(Array.from(t.api.getMusicState().playing), ['verified']);
    assert(!t.api.getMusicState().pending.includes('black'));
    assert.equal(keeper.stopped, undefined, 'Other loops continue unchanged');
    assert(Math.abs(bus.valueAt(20.2) - .4 * .8) < 1e-9, 'Headroom recovers after natural end');
    await t.api.setMusicSelection(['black', 'verified']);
    assert.equal(t.sources.length, 2, 'Stale selected UI resync must not retrigger a finished one-shot');
    assert(!t.api.getMusicState().selected.includes('black'));
    assert.equal(await t.api.loadTrack('black'), preview, 'Playback preserves the preview cache');
    await t.api.setMusicSelection(['verified']);
    await t.api.setMusicSelection(['black', 'verified']);
    assert.equal(t.sources.length, 3, 'Explicit omit then reselect rearms the one-shot');
    assert.equal(t.sources[2].started[1], 0);
    black.onended();
    assert(t.api.getMusicState().selected.includes('black'), 'Old end callback cannot remove the replacement');
  });

  await check('Black natural end does not cancel another pending track load', async t => {
    t.addBlack(); const asset = t.add('slow', 8, false);
    await t.api.setMusicSelection(['black']);
    const request = t.api.setMusicSelection(['black', 'slow']); await flush();
    t.contexts[0].currentTime = 17.56; t.sources[0].onended();
    t.api.registerAsset('slow', asset); t.scripts[0].onload(); await request;
    assert.deepEqual(Array.from(t.api.getMusicState().selected), ['slow']);
    assert.equal(t.sources.length, 2);
    assert.equal(t.sources[1].loop, true);
  });

  await check('All 19 production loops retain 100 BPM eight-beat playback alongside Black', async t => {
    const manifestContext = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'games-audio-manifest.js'), 'utf8'), manifestContext);
    const manifest = manifestContext.window.MoonAudioManifest;
    assert.equal(manifest.bpm, 100);
    const loops = Object.entries(manifest.tracks).filter(([, meta]) => meta.loopable !== false);
    assert.equal(loops.length, 19);
    for (const [id, meta] of loops) {
      assert.equal(meta.beats, 8);
      const asset = t.add(id, meta.beats, false, meta.loopEnd);
      Object.assign(asset, meta); t.api.registerAsset(id, asset);
    }
    t.addBlack();
    const ids = loops.map(([id]) => id);
    await t.api.setMusicSelection(ids);
    t.contexts[0].currentTime = .5;
    await t.api.setMusicSelection([...ids, 'black']);
    for (const node of t.sources.slice(0, 19)) {
      assert.equal(node.loop, true);
      assert.deepEqual(node.started, [.1, 0]);
      assert.equal(node.loopEnd - node.loopStart, 4.8);
      assert.equal(node.stopped, undefined);
    }
    t.contexts[0].currentTime = 19.96; t.sources[19].onended();
    assert.deepEqual(Array.from(t.api.getMusicState().playing), ids);
    assert.equal(t.sources.length, 20);
  });

  await check('Black alone finishes once and explicit stop resets selection intent', async t => {
    t.addBlack();
    await t.api.setMusicSelection(['black']);
    const black = t.sources[0];
    t.contexts[0].currentTime = 17.56; black.onended();
    assert.equal(t.api.getMusicState().selected.length, 0);
    assert.equal(t.api.getMusicState().playing.length, 0);
    assert.equal(t.api.getMusicState().pending.length, 0);
    for (let i = 0; i < 3; i++) await t.api.setMusicSelection(['black']);
    assert.equal(t.sources.length, 1);
    t.api.stopMusic(); await t.api.setMusicSelection(['black']);
    assert.equal(t.sources.length, 2, 'An explicit stop begins a new selection session');
    assert.equal(t.sources[1].started[1], 0);
  });

  for (const action of ['deselect', 'mute', 'hidden', 'dispose']) {
    for (const stage of ['loading', 'queued', 'playing']) {
      await check(`Black ${action} during ${stage} cannot resurrect or remove replacement`, async t => {
        const asset = t.addBlack(stage !== 'loading');
        const request = t.api.setMusicSelection(['black']); await flush();
        if (stage !== 'loading') await request;
        if (stage === 'playing') t.contexts[0].currentTime = 1;
        const old = t.sources[0];
        if (action === 'deselect') await t.api.setMusicSelection([]);
        else if (action === 'mute') t.api.suspend();
        else if (action === 'dispose') t.api.dispose();
        else { t.document.hidden = true; t.events.get('document:visibilitychange')(); }
        if (stage === 'loading') {
          t.api.registerAsset('black', asset); t.scripts[0].onload(); await request;
          assert.equal(t.sources.length, 0);
        }
        assert.equal(t.api.getMusicState().selected.length, 0);
        if (old) assert(Number.isFinite(old.stopped));
        if (old && action !== 'deselect') assert(old.disconnected);
        t.document.hidden = false;
        await t.api.setMusicSelection(['black']);
        const fresh = t.sources.at(-1);
        old?.onended();
        assert(t.api.getMusicState().selected.includes('black'));
        assert.equal(fresh.stopped, undefined);
        assert.equal(t.api.getMusicState().errors.length, 0);
      });
    }
  }

  await check('Rejected shared resume clears pending state and retries on the same context', async t => {
    t.add('a');
    const ctx = t.api.getContext(), attempt = deferred();
    ctx.resumeHook = () => attempt.promise;
    const first = t.api.unlock(), second = t.api.unlock();
    assert.equal(first, second, 'Concurrent unlocks share one attempt');
    const selection = t.api.setMusicSelection(['a']);
    const checked = [first, second, selection].map(promise => assert.rejects(promise, /resume-denied/));
    attempt.reject(new Error('resume-denied'));
    await Promise.all(checked);
    assert.equal(ctx.resumeCalls, 1);
    assert.equal(t.sources.length, 0);
    assert.equal(t.api.getMusicState().pending.length, 0);
    assert.equal(t.api.getMusicState().errors[0].message, 'resume-denied');
    ctx.resumeHook = null;
    await t.api.setMusicSelection(['a']);
    assert.equal(ctx.resumeCalls, 2);
    assert.equal(t.contexts.length, 1);
    assert.equal(t.sources.length, 1);
    assert.equal(t.api.getMusicState().errors.length, 0);
  });

  await check('Deselection during loading preserves only the newest selection', async t => {
    t.add('keep'); const slow = t.add('slow', 8, false);
    await t.api.setMusicSelection(['keep']);
    const keeper = t.sources[0];
    const pending = t.api.setMusicSelection(['keep', 'slow']);
    await flush();
    assert.equal(t.scripts.length, 1);
    await t.api.setMusicSelection(['keep']);
    t.api.registerAsset('slow', slow); t.scripts[0].onload();
    await pending;
    assert.equal(t.sources.length, 1);
    assert.equal(t.sources[0], keeper);
    assert.equal(keeper.stopped, undefined, 'Retained voice is not restarted or stopped');
    assert.deepEqual(Array.from(t.api.getMusicState().selected), ['keep']);
    await t.api.setMusicSelection(['keep', 'slow']);
    assert.equal(t.sources.length, 2, 'Explicit re-selection can use the loaded track');
    assert.equal(t.scripts.length, 1);
  });

  await check('Dispose while resume is pending cannot start old music or reset a new resume', async t => {
    t.add('a');
    const old = t.api.getContext(), gate = deferred();
    old.resumeHook = () => gate.promise;
    const oldSelection = t.api.setMusicSelection(['a']);
    const rejected = assert.rejects(oldSelection, /audio-cancelled/);
    t.api.dispose();
    const next = t.api.getContext(), nextGate = deferred();
    next.resumeHook = () => nextGate.promise;
    const nextUnlock = t.api.unlock();
    gate.resolve(); await rejected;
    assert.equal(t.api.unlock(), nextUnlock, 'Old finally cannot clear the newer in-flight resume');
    next.state = 'running'; nextGate.resolve();
    assert.equal(await nextUnlock, next);
    assert.equal(old.state, 'closed');
    assert.equal(t.sources.length, 0);
    await t.api.setMusicSelection(['a']);
    assert.equal(t.contexts.length, 2);
    assert.equal(t.sources.length, 1);
    assert.equal(t.sources[0].context, next);
  });

  await check('A deselected load failure cannot overwrite the new selection or its errors', async t => {
    t.add('slow', 8, false); t.add('new');
    const stale = t.api.setMusicSelection(['slow']); await flush();
    assert.equal(t.scripts.length, 1);
    await t.api.setMusicSelection(['new']);
    t.scripts[0].onerror(); await stale;
    assert.deepEqual(Array.from(t.api.getMusicState().selected), ['new']);
    assert.equal(t.api.getMusicState().errors.length, 0);
    assert.equal(t.sources.length, 1);
    const retry = t.api.setMusicSelection(['slow']); await flush();
    assert.equal(t.scripts.length, 2, 'Failed assets can be requested again');
    t.api.registerAsset('slow', t.add('slow'));
    t.scripts[1].onload(); await retry;
    assert.equal(t.sources.length, 2);
    assert.equal(t.api.getMusicState().errors.length, 0);
  });

  await check('Dispose during asset loading cannot resurrect the previous selection', async t => {
    const asset = t.add('slow', 8, false);
    const oldRequest = t.api.setMusicSelection(['slow']); await flush();
    t.api.dispose();
    const next = await t.api.unlock();
    t.api.registerAsset('slow', asset); t.scripts[0].onload(); await oldRequest;
    assert.equal(t.sources.length, 0);
    assert.equal(t.api.getMusicState().selected.length, 0);
    await t.api.setMusicSelection(['slow']);
    assert.equal(t.sources.length, 1);
    assert.equal(t.sources[0].context, next);
  });

  await check('Interruption clears retiring voices and requires an explicit restart', async t => {
    t.add('a'); t.add('b');
    let callbacks = 0; const unsubscribe = t.api.onSuspend(() => callbacks++);
    await t.api.setMusicSelection(['a', 'b']);
    await t.api.setMusicSelection(['b']);
    const ctx = t.contexts[0]; ctx.state = 'interrupted'; ctx.listeners.get('statechange')();
    assert(t.sources.every(voice => voice.disconnected), 'Includes a deselected voice awaiting its fade timer');
    assert.equal(t.timers.size, 0);
    assert.equal(callbacks, 1);
    assert.equal(t.api.getMusicState().selected.length, 0);
    unsubscribe(); t.api.suspend(); assert.equal(callbacks, 1);
    assert.equal(t.sources.length, 2);
    await t.api.setMusicSelection(['a']);
    assert.equal(t.sources.length, 3);
  });

  await check('Stale decode rejection cannot evict a successful post-dispose cache entry', async t => {
    t.add('a');
    const decode = deferred();
    t.decoderControl.hook = () => decode.promise;
    const stale = t.api.loadTrack('a');
    const checked = assert.rejects(stale, /old-decode-failed/);
    await flush();
    assert.equal(t.decoders.length, 1);
    assert.equal(t.decoders[0].decodeCalls, 1);
    t.api.dispose();
    t.decoderControl.hook = null;
    const fresh = await t.api.loadTrack('a');
    const calls = () => t.decoders.reduce((sum, decoder) => sum + decoder.decodeCalls, 0);
    assert.equal(calls(), 2);
    decode.reject(new Error('old-decode-failed')); await checked;
    const cached = await t.api.loadTrack('a');
    assert.equal(calls(), 2, 'Old rejection must not invalidate the new cache');
    assert.equal(cached, fresh);
  });
  if (failures.length) throw new AggregateError(failures.map(({ name, error }) => new Error(name, { cause: error })), failures.length + ' audio lifecycle regression(s)');
}

(async () => {
  const t = setup(), { api } = t;
  t.add('a'); t.add('b', 16);
  assert.equal(t.contexts.length, 0, 'Loading the engine never creates or unlocks audio');
  api.setVolumes({ music: .6, effects: .5, voice: .8 });
  assert.equal(t.contexts.length, 0, 'Settings changes never create audio');
  await api.setMusicSelection(['a']);
  const context = t.contexts[0], first = t.sources[0];
  assert.deepEqual(first.started, [.1, 0]);
  assert.equal(first.loop, true);
  context.currentTime = .5;
  await api.setMusicSelection(['a','b']);
  assert.equal(t.sources.length, 2, 'Joining does not replace an existing source');
  assert(Math.abs(t.sources[1].started[0] - 2.5) < 1e-10, 'Join on next 2.4s bar');
  assert(Math.abs(t.sources[1].started[1] - 2.4) < 1e-10, 'Join at shared phrase offset, not clip beginning');
  assert.deepEqual(first.started, [.1, 0]);
  assert.deepEqual(Array.from(api.getMusicState().pending), ['b']);
  context.currentTime = 2.51;
  assert.equal(api.getMusicState().playing.length, 2);
  await api.setMusicSelection(['b']);
  assert(Number.isFinite(first.stopped));
  assert.equal(t.sources.length, 2);
  api.setDucking(true); const quiet = api.output('music').gain.value;
  api.setDucking(false); assert(api.output('music').gain.value > quiet);
  api.setVolumes({ music: 500, voice: -1, effects: NaN });
  assert.deepEqual(JSON.parse(JSON.stringify(api.getVolumes())), { music: 1, effects: .5, voice: 0 });
  let stopped = 0; api.onSuspend(() => stopped++);
  t.document.hidden = true; t.events.get('document:visibilitychange')();
  assert.equal(stopped, 1); assert.equal(api.getMusicState().selected.length, 0);
  assert(t.sources.every(node => node.disconnected), 'Backgrounding disconnects voices even if their stop time cannot advance');
  await assert.rejects(api.unlock(), /page-hidden/);
  t.document.hidden = false;
  assert.equal(t.sources.length, 2, 'Foreground alone never restarts');
  await api.setMusicSelection(['a']); assert.equal(t.sources.length, 3);
  api.dispose(); assert.equal(context.state, 'closed');

  const race = setup(); race.add('a'); const delayed = race.add('slow', 8, false);
  const request = race.api.setMusicSelection(['a','slow']); await flush();
  assert.equal(race.scripts.length, 1);
  race.api.stopMusic(); race.api.registerAsset('slow', delayed); race.scripts[0].onload(); await request;
  assert.equal(race.sources.length, 0, 'Late decoded batch cannot resurrect stopped music');
  await race.api.setMusicSelection(['missing']);
  assert.equal(race.api.getMusicState().errors[0].id, 'missing');
  race.add('bad', 8, true, 5.1);
  await race.api.setMusicSelection(['bad']);
  assert.equal(race.api.getMusicState().errors[0].message, 'loop-not-on-beat', 'Unverified periods are not silently played out of sync');
  race.api.dispose();

  const long = setup(); long.add('short'); long.add('long', 16);
  await long.api.setMusicSelection(['short','long']);
  const start = long.sources[0].started[0];
  for (let second = 1; second <= 1800; second++) {
    long.contexts[0].currentTime = start + second;
    const phases = long.sources.map(node => {
      const duration = node.loopEnd - node.loopStart;
      return ((long.contexts[0].currentTime - node.started[0] + node.started[1]) % duration) % 2.4;
    });
    const distance = Math.abs(phases[0] - phases[1]);
    assert(Math.min(distance, 2.4 - distance) < 128 / 48000, 'No accumulated 30-minute clock drift');
  }
  long.api.dispose();
  await lifecycleChecks();
  console.log('PASS audio engine: next-bar/phrase join, no restarts, mute/background/dispose, late loads, invalid loops, optional storage, volume ducking, and 1800s clock model. Rendered audio tested separately.');
})().catch(error => { console.error(error); process.exitCode = 1; });
