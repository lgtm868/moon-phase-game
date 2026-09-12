'use strict';

// Source-only regression: no generated assets, browser, or human audition.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scoreModule = require('../tools/anpanman-score.cjs');
const { RATE, BPM, BEATS, FRAMES, scores, renderTracks } = scoreModule;
const ids = 'anpanman baikinman dokinchan shokupanman currypanman melonpanna rollpanna creampanda jamojisan batakosan'.split(' ');
const pcmHash = track => {
  const hash = createHash('sha256');
  for (const channel of track.data) hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
  return hash.digest('hex');
};

function checkTrack(track) {
  assert.equal(track.rate, 48000, track.id + ': sample rate');
  assert.equal(track.data.length, 2, track.id + ': stereo');
  for (const channel of track.data) {
    assert.ok(channel instanceof Float32Array);
    assert.equal(channel.length, 230400, track.id + ': exact frame count');
    assert.equal(channel.length / track.rate, 4.8, track.id + ': exact duration');
    let power = 0;
    for (const sample of channel) {
      assert.ok(Number.isFinite(sample), track.id + ': finite samples');
      power += sample * sample;
    }
    assert.ok(power / channel.length > 1e-8, track.id + ': non-silent channel');
  }
}

async function checkRevisionUrls() {
  const root = path.resolve(__dirname, '..');
  const node = () => ({ gain: { value: 0 }, connect() {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
  class AudioContext {
    constructor() { this.state = 'suspended'; this.destination = {}; }
    createGain() { return node(); }
    createDynamicsCompressor() { return node(); }
  }
  for (const base of ['https://example.test/moon/games-audio.js', 'file:///game/games-audio.js']) {
    const requested = [];
    const window = { AudioContext, addEventListener() {}, dispatchEvent() {} };
    const document = {
      currentScript: { src: base }, readyState: 'loading', addEventListener() {},
      createElement() { return { remove() {} }; },
      head: { append(script) { requested.push(script.src); queueMicrotask(() => script.onerror()); } }
    };
    const context = vm.createContext({ window, document, URL, setTimeout, clearTimeout,
      location: { href: base }, localStorage: { getItem() { return null; } } });
    vm.runInContext(fs.readFileSync(path.join(root, 'games-audio-manifest.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'games-audio.js'), 'utf8'), context);
    for (const id of [...ids, 'oren']) {
      const meta = window.MoonAudioManifest.tracks[id];
      if (ids.includes(id)) {
        const wav = fs.readFileSync(path.join(root, 'sounds', id + '.wav'));
        assert.equal(meta.revision, createHash('sha256').update(wav).digest('hex').slice(0, 16), id + ': WAV content revision');
      }
      // Fail deliberately after URL capture: this probes the real loader, not decoding.
      await assert.rejects(window.MoonAudio.loadTrack(id), /audio-load-failed/);
      const actual = new URL(requested.at(-1));
      const expected = new URL(meta.file, base);
      assert.equal(actual.origin, expected.origin);
      assert.equal(actual.pathname, expected.pathname, id + ': query must not change pathname');
      assert.equal(actual.searchParams.get('v'), ids.includes(id) ? meta.revision : null);
      assert.equal(actual.hash, '');
    }
    assert.equal(requested.length, 11);
  }
  console.log('PASS HTTP/file revision URLs: ten WAV SHA prefixes, unchanged pathname, canonical URL unchanged (mock transport)');
}

async function main() {
  assert.equal(RATE, 48000);
  assert.equal(BPM, 100);
  assert.equal(BEATS, 8);
  assert.equal(FRAMES, 230400);
  assert.deepEqual(scores.map(score => score.id).sort(), [...ids].sort());
  for (const score of scores) {
    assert.ok(typeof score.instrument === 'string' && score.instrument.trim());
    assert.ok(Array.isArray(score.notes) && score.notes.length > 0, score.id + ': events');
    for (const event of score.notes) {
      assert.ok(Number.isFinite(event.beat) && event.beat >= 0 && event.beat < BEATS, score.id + ': beat');
      assert.ok(Number.isFinite(event.midi) && event.midi >= 0 && event.midi <= 127, score.id + ': MIDI');
      assert.ok(Number.isFinite(event.length) && event.length > 0, score.id + ': length');
      assert.ok(Number.isFinite(event.velocity) && event.velocity > 0 && event.velocity <= 1, score.id + ': velocity');
      if (event.instrument !== undefined) assert.ok(typeof event.instrument === 'string' && event.instrument.trim());
    }
  }
  const original = structuredClone(scores);
  const first = renderTracks(), second = renderTracks();
  assert.deepEqual(scores, original, 'Rendering must not mutate source scores');
  assert.deepEqual(first.map(track => track.id), scores.map(score => score.id));
  assert.deepEqual(second.map(track => track.id), first.map(track => track.id));
  first.forEach((track, index) => {
    checkTrack(track);
    assert.equal(pcmHash(track), pcmHash(second[index]), track.id + ': deterministic PCM');
  });
  assert.equal(new Set(first.map(pcmHash)).size, 10, 'Ten distinct scores');
  console.log('PASS source scores: 10 distinct deterministic non-silent stereo loops, exactly 4.8 seconds');

  const eventInstruments = [...new Set(scores.flatMap(score => score.notes.map(event => event.instrument)).filter(value => value !== undefined))];
  if (!eventInstruments.length) {
    console.log('SKIP per-event instrument dispatch: no production event overrides introduced');
    return;
  }
  // Replace only the in-memory export temporarily to isolate instrument dispatch.
  const saved = scores.slice();
  const probe = (instrument, eventInstrument) => {
    const event = { beat: 1, midi: 60, length: .5, velocity: .7 };
    if (eventInstrument !== undefined) event.instrument = eventInstrument;
    scores.splice(0, scores.length, { id: 'probe', title: 'Dispatch probe', instrument, notes: [event] });
    const [track] = renderTracks();
    checkTrack(track);
    return pcmHash(track);
  };
  try {
    for (const instrument of eventInstruments) {
      const fallback = saved.find(score => score.instrument !== instrument)?.instrument;
      assert.ok(fallback, 'A different fallback instrument is required for dispatch coverage');
      const expected = probe(instrument);
      assert.notEqual(expected, probe(fallback), instrument + ': distinct probe timbre');
      assert.equal(probe(fallback, instrument), expected, instrument + ': event instrument overrides score default');
    }
  } finally {
    scores.splice(0, scores.length, ...saved);
  }
  assert.deepEqual(scores, original, 'Probe must restore scores');
  console.log('PASS per-event instrument dispatch: ' + eventInstruments.join(', '));
  if (process.argv.includes('--assets')) await checkRevisionUrls();
}

module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
