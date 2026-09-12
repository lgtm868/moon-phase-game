'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { root, ids, hash, readWav, writeWav, normalize, resample, loadOriginal } = require('../tools/build-audio-assets.cjs');
const originalIds = 'oren raddy clukr funbot vineria gray brud garnold owakcx sky mrsun durple mrtree simon tunner mrfun wenda pinki jevin black'.split(' ');
const anpanIds = 'anpanman baikinman dokinchan shokupanman currypanman melonpanna rollpanna creampanda jamojisan batakosan'.split(' ');
const expectedIds = [...originalIds, ...anpanIds];

function readPack(id) {
  const calls = [];
  const context = vm.createContext({ window: { MoonAudio: { registerAsset: (...args) => calls.push(args) } } }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(fs.readFileSync(path.join(root, `sounds/packed/${id}.js`), 'utf8'), context, { timeout: 1000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], id);
  return calls[0][1];
}

function main() {
  const originals = fs.readdirSync(path.join(root, 'sounds')).filter(f => /\.(wav|mp3)$/.test(f));
  const originalHashes = originals.map(f => hash(fs.readFileSync(path.join(root, 'sounds', f))));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'games-audio-manifest.js'), 'utf8'), context, { timeout: 1000 });
  const manifest = context.window.MoonAudioManifest;
  assert.equal(manifest.bpm, 100); assert.equal(manifest.beatsPerBar, 4);
  assert.deepEqual(ids, originalIds, 'Canonical source hash validation remains scoped to the original twenty');
  assert.deepEqual(Object.keys(manifest.tracks), expectedIds);
  assert.deepEqual(fs.readdirSync(path.join(root, 'sounds/packed')).sort(), Object.keys(manifest.tracks).map(id => `${id}.js`).sort());
  for (const id of originalIds) loadOriginal(id);
  const sourceDigests = new Set(originalIds.map(id => hash(loadOriginal(id).bytes)));
  for (const [id, track] of Object.entries(manifest.tracks)) {
    const pack = readPack(id), pcm = Buffer.from(pack.data, 'base64');
    assert.equal(pack.data, pcm.toString('base64'), 'Canonical base64');
    const generated = anpanIds.includes(id);
    assert.deepEqual(Object.keys(pack).sort(), ['data', 'type', 'loopable', 'beats', 'loopStart', 'loopEnd', 'gain', ...(generated ? ['title', 'instrument', 'provenance', 'revision'] : [])].sort());
    for (const key of ['loopable', 'beats', 'loopStart', 'loopEnd', 'gain']) assert.equal(pack[key], track[key]);
    if (generated) {
      assert.equal(track.provenance, 'game-original');
      assert.equal(track.gain, .26);
      assert.equal(track.revision, hash(pcm).slice(0, 16));
      assert.equal(pack.revision, track.revision);
      for (const key of ['title', 'instrument', 'provenance']) {
        assert.equal(typeof track[key], 'string'); assert(track[key].trim().length > 0);
        assert.equal(pack[key], track[key]);
      }
    }
    assert.equal(track.file, `sounds/packed/${id}.js`);
    if (id === 'black') {
      assert.equal(pack.type, 'audio/mpeg'); assert.equal(pack.loopable, false);
      assert.equal(pack.beats, null); assert.equal(pack.loopStart, 0);
      assert.equal(pack.loopEnd, 838147 / 48000); assert.equal(pack.gain, .2);
      assert(pcm.equals(loadOriginal('black').bytes), 'Black preview must be original MP3 byte-for-byte');
      console.log('PASS black: original MP3, preview only, no fabricated beat count');
      continue;
    }
    const decoded = readWav(pcm);
    assert.equal(pack.type, 'audio/wav'); assert.equal(pack.loopable, true);
    assert.equal(decoded.rate, 48000); assert.equal(decoded.data[0].length, 230400);
    assert.equal(track.beats, 8); assert.equal(track.loopStart, 0);
    assert.equal(track.loopEnd * decoded.rate, decoded.data[0].length);
    assert.equal(track.loopEnd, track.beats * 60 / manifest.bpm);
    assert(track.gain > 0 && track.gain <= 2);
    const sourceBytes = anpanIds.includes(id)
      ? fs.readFileSync(path.join(root, `sounds/${id}.wav`)) : loadOriginal(id).bytes;
    if (anpanIds.includes(id)) {
      const digest = hash(sourceBytes);
      assert(!sourceDigests.has(digest), `${id}: distinct generated original, not a reused recording`);
      sourceDigests.add(digest);
    }
    const original = readWav(sourceBytes);
    assert.equal(decoded.data.length, original.data.length);
    if (generated) {
      assert.equal(original.rate, 48000); assert.equal(original.data.length, 2);
      assert.equal(original.data[0].length, 230400);
      assert(pcm.equals(sourceBytes), `${id}: generated source preserved byte-for-byte in pack`);
      assert(decoded.data.some(channel => channel.some(value => Math.abs(value) > .001)), `${id}: non-silent composition`);
    } else assert(pcm.equals(writeWav(normalize(original, 8))), `${id}: reproducible PCM`);
    for (const c of decoded.data) {
      assert.equal(c[0], c.at(-1), `${id}: sample-exact endpoint`);
      for (const v of c) { assert(Number.isFinite(v)); assert(Math.abs(v) < 0.999); assert(Math.abs(v * track.gain) <= 0.8001); }
    }
    console.log(`PASS ${id}: ${decoded.data[0].length} frames; channels ${decoded.data.length}; gain ${track.gain}`);
  }

  // Synthetic probes below exercise normalization independently of production sources.
  const silence = new Float32Array(230400 + 1200);
  silence[1000] = .2; silence[230400 + 400] = .3;
  const loop = normalize({ rate: 48000, data: [silence] }, 8);
  assert(Math.abs(loop.data[0][1000] - .2) < 1e-7, 'Original attack position');
  assert(Math.abs(loop.data[0][400] - .3) < 1e-7, 'Wrapped tail position');
  const multi = new Float32Array(460800 + 1000);
  multi[100] = .1; multi[230500] = .2; multi[460900] = .3;
  assert(Math.abs(normalize({ rate: 48000, data: [multi] }, 8).data[0][100] - .6) < 1e-7, 'Multiple-cycle tails preserved');
  const longer = new Float32Array(460800);
  longer[300000] = .25;
  const longLoop = normalize({ rate: 48000, data: [longer] }, 16);
  assert.equal(longLoop.data[0].length, 460800); assert.equal(longLoop.data[0][300000], .25);
  assert.throws(() => normalize({ rate: 48000, data: [new Float32Array(1000)] }, 8), /missing phrase/);
  assert.throws(() => normalize({ rate: 48000, data: [silence] }, 7), /whole-bar/);
  assert.throws(() => readWav(Buffer.alloc(44)), /Invalid/);
  const truncated = writeWav({ rate: 48000, data: [new Float32Array(100)] }).subarray(0, 48);
  assert.throws(() => readWav(truncated), /Invalid/);
  const tone = Float32Array.from({ length: 44100 }, (_, i) => .2 * Math.sin(2 * Math.PI * 440 * i / 44100));
  const converted = resample({ rate: 44100, data: [tone] }).data[0];
  assert.equal(converted.length, 48000);
  let error = 0;
  for (let i = 100; i < 47900; i++) error += (converted[i] - .2 * Math.sin(2 * Math.PI * 440 * i / 48000)) ** 2;
  assert(Math.sqrt(error / 47800) < .00001, 'Sample-rate conversion must preserve pitch and timestamps');
  const impulse = new Float32Array(44100); impulse[22050] = .5;
  const interpolated = resample({ rate: 44100, data: [impulse] }).data[0];
  assert.equal(interpolated.indexOf(Math.max(...interpolated)), 24000);
  for (const [id, rest] of [['wenda', .6], ['durple', 2.7]]) {
    const data = readWav(Buffer.from(readPack(id).data, 'base64')).data[0];
    assert(data.slice(0, rest * 48000 - 1).every(v => Math.abs(v) < .001), `${id}: intended rest retained`);
  }
  const generated = ['games-audio-manifest.js', 'AUDIO-ASSETS.md', ...Object.values(manifest.tracks).map(t => t.file)];
  const before = generated.map(f => hash(fs.readFileSync(path.join(root, f))));
  execFileSync(process.execPath, [path.join(root, 'tools/build-audio-assets.cjs')], { stdio: 'pipe' });
  assert.deepEqual(generated.map(f => hash(fs.readFileSync(path.join(root, f)))), before, 'Rebuild is byte-deterministic');
  assert.deepEqual(originals.map(f => hash(fs.readFileSync(path.join(root, 'sounds', f)))), originalHashes, 'Canonical and generated source files unchanged');
  console.log('PASS: 19 canonical loops + 10 distinct generated original loops + original Black preview; preserved rests/stereo/pitch; modulo tails; whole-bar lengths; deterministic rebuild; all sources unchanged. Black loop remains explicitly unverified.');
}

if (require.main === module) main();
module.exports = { readPack };
