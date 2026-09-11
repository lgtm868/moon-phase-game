'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const RATE = 48000;
const BPM = 100;
const BLACK_DURATION = 838147 / RATE;
const ids = 'oren raddy clukr funbot vineria gray brud garnold owakcx sky mrsun durple mrtree simon tunner mrfun wenda pinki jevin black'.split(' ');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// These decisions apply only to the inspected originals. A changed hash requires review.
const decisions = {
  oren: ['4fe337e4a079455c04b82513c227497073fec5ce8f59e47981b1fd272f0115b3', 'Kick attacks on the 0.15 s grid; final attack at 4.5 s, negligible export tail.'],
  raddy: ['da34b144dabca0366e675eacae169b0efb34c15be909a117f2b45d41ec870ac9', 'Keep the 0.6 s opening rest; backbeats and final 4.65 s hit precede a decaying tail.'],
  clukr: ['711d493d8c6d63859d4f5755229506054ec070bcea5e15646c1ede7f25c7cb87', 'Attacks every 0.6 s through 4.2 s; remaining material is decay.'],
  funbot: ['f10af7fb9ed16fcf4d92618b2e8c7108a8289efe18a5161ab7881822904f7e08', '0.15 s subdivision attacks repeat across two bars; exported trailing silence.'],
  vineria: ['19b2125774bf2d0fb5d303626cca47cbfa590ac1209946d6e25602a1c95f750d', 'Subdivision attacks through 4.65 s; quiet decay beyond the two-bar boundary.'],
  gray: ['c1663a051b4223fc32f074c57e057317551a4a57753f7181891acb6fcb365e6d', 'Sustained bass, internal rests, release at 4.8 s; wrap the short release, not an onset trim.'],
  brud: ['7f40c4ec53ab29318988973d892cb0e8f8df77619d286d0ccf11da22b9b540e2', '0.15 s attacks through 4.65 s; silence after 4.8 s.'],
  garnold: ['d3b45937c2b3e8cb207853ce96a20de265c1f0c61aa5c2d0611ad0830c85114a', 'Continuous phrase ending before 4.8 s, then exact silence; musical meter is provisional without audition.'],
  owakcx: ['aded5b7877561d17bb65c39e8c2f3e1859294bf3f758f687d898e486deedf3b2', 'Early attacks on the shared grid; long diminishing decay, no later phrase detected.'],
  sky: ['a4210458091e9d6a1ad74d0037fa99e7ef504c6a3737e371cf2fc79fcd9ec8ad', 'Phrase attacks before 4.8 s with a sustained final note and decay to 6.14 s; tail classification provisional.'],
  mrsun: ['467a6def73cb6454849d760cec9d27b556861a7e15bf8ee03ff312f19547b64a', 'Active phrase through 4.8 s followed by rapid decay; no new phrase established in tail.'],
  durple: ['27dbb510a246b203f5e000766f7cc22e895abf80d6c30876873bdd6fb044cc3f', 'Keep 2.7 s opening rest; attacks at 2.7, 3.0, 3.9, 4.2, 4.5 s.'],
  mrtree: ['1ebb52bd31d591f180a5d8444934f2506941630615c597495d13d219ccadfdcb', 'Sustained material through 4.8 s followed by release to 5.28 s; meter provisional without audition.'],
  simon: ['adb683c15852f94dc3d3cc16102515e34f3c4d60506f044ba364cd5d472f7e93', 'Existing roster selects WAV, not the alternate MP3; repeating figures and release at 4.8 s.'],
  tunner: ['99602abd610d2145dcb87e81f7eab0950710ba4fd1d4f29d3048e5e53e061716', 'Keep opening attack envelope and internal rests; final note release continues about 36 ms beyond 4.8 s.'],
  mrfun: ['37e0a38b4fedfe0f78feb4986a4f32276132e9c258a984b4ea13b890be146aae', 'Two-bar vocal activity with brief release beyond 4.8 s; no leading-silence removal.'],
  wenda: ['109d4242854796fac473278b57a9dc172ab508b486a1a8b2e3a8dda8a08a1b35', 'Four repeated bursts at 0.6, 1.8, 3.0, 4.2 s; keep intentional opening rest.'],
  pinki: ['2c102391c055dcc018d45532d9d4c5f70a051813513863a50c6de0a746a6670c', 'Strong activity ends near 4.2 s; half-second RMS then decays monotonically through 9.67 s. Not evidence of a four-bar phrase.'],
  jevin: ['9f6df9ed113de03dd719c99ff1fdcd2c3fa048630c9848062d93f9a72cc8eb66', 'Sustained voice releases around 4.8 s; subsequent RMS decays through 8.49 s, not a new phrase.'],
  black: ['4757e4a2fbbad5a404cbcdcea0d77ceac55c37a2ec947d34b3e474ba79230f4b', 'BLOCKED: decoded 17.461396 s, onset 0.332813 s, sustained non-grid material. No defensible 100 BPM phrase boundary; do not stretch, truncate, or pad into a fabricated loop.']
};

function readWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid RIFF/WAVE');
  let fmt, pcm;
  for (let p = 12; p < bytes.length;) {
    if (p + 8 > bytes.length) throw new Error('Truncated chunk');
    const n = bytes.readUInt32LE(p + 4), tag = bytes.toString('ascii', p, p + 4);
    if (p + 8 + n > bytes.length) throw new Error('Truncated chunk data');
    if (tag === 'fmt ') {
      if (n < 16) throw new Error('Short format');
      fmt = { codec: bytes.readUInt16LE(p + 8), channels: bytes.readUInt16LE(p + 10), rate: bytes.readUInt32LE(p + 12), align: bytes.readUInt16LE(p + 20), bits: bytes.readUInt16LE(p + 22) };
    }
    if (tag === 'data') pcm = bytes.subarray(p + 8, p + 8 + n);
    p += 8 + n + (n % 2);
  }
  if (!fmt || !pcm || fmt.codec !== 1 || fmt.bits !== 16 || ![1, 2].includes(fmt.channels) || ![44100, 48000].includes(fmt.rate) || fmt.align !== 2 * fmt.channels || pcm.length % fmt.align) throw new Error('Unsupported PCM format');
  const data = Array.from({ length: fmt.channels }, () => new Float32Array(pcm.length / fmt.align));
  for (let i = 0; i < data[0].length; i++) for (let c = 0; c < fmt.channels; c++) data[c][i] = pcm.readInt16LE(i * fmt.align + c * 2) / 32768;
  return { rate: fmt.rate, data };
}

// Sample-rate conversion, not time stretching: timestamps and pitch are unchanged.
function resample(source, rate = RATE) {
  if (source.rate === rate) return source;
  if (source.rate > rate) throw new Error('Downsampling requires an anti-alias filter');
  const count = Math.round(source.data[0].length * rate / source.rate);
  const data = source.data.map(channel => {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = i * source.rate / rate, center = Math.floor(x);
      let value = 0, weight = 0;
      for (let k = center - 23; k <= center + 24; k++) {
        const d = x - k;
        if (Math.abs(d) >= 24) continue;
        const w = (Math.abs(d) < 1e-12 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)) * (0.5 + 0.5 * Math.cos(Math.PI * d / 24));
        value += (channel[k] || 0) * w;
        weight += w;
      }
      out[i] = value / weight;
    }
    return out;
  });
  return { rate, data };
}

async function browserDecoder() {
  const playwright = require(process.env.AUDIO_PLAYWRIGHT || 'playwright');
  const browser = await playwright.chromium.launch({ headless: true, ...(process.env.AUDIO_BROWSER ? { executablePath: process.env.AUDIO_BROWSER } : { channel: 'msedge' }) });
  const page = await browser.newPage();
  return {
    version: browser.version(),
    close: () => browser.close(),
    async decode(bytes) {
      const result = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const ctx = new OfflineAudioContext(2, 1, 48000);
        const buffer = await ctx.decodeAudioData(bytes.buffer);
        return { rate: buffer.sampleRate, data: Array.from({ length: buffer.numberOfChannels }, (_, c) => Array.from(buffer.getChannelData(c))) };
      }, bytes.toString('base64'));
      return { rate: result.rate, data: result.data.map(c => Float32Array.from(c)) };
    }
  };
}

function metrics(source) {
  const { rate, data } = source, frames = data[0].length, hop = Math.round(rate * 0.005);
  let peak = 0, energy = 0, first = frames, last = -1;
  const envelope = [];
  for (let i = 0; i < frames; i += hop) {
    let sum = 0;
    for (let j = i; j < Math.min(i + hop, frames); j++) for (const c of data) {
      const a = Math.abs(c[j]);
      peak = Math.max(peak, a); sum += a * a;
      if (a >= 0.001) { first = Math.min(first, j); last = Math.max(last, j); }
    }
    energy += sum;
    envelope.push(Math.sqrt(sum / (Math.min(hop, frames - i) * data.length)));
  }
  const attacks = [];
  for (let i = 2; i < envelope.length - 2; i++) {
    const rise = envelope[i] - Math.min(envelope[i - 1], envelope[i - 2]);
    const time = i * hop / rate;
    if (rise > 0.008 && envelope[i] >= envelope[i + 1] && envelope[i] >= envelope[i - 1] && (!attacks.length || time - attacks.at(-1) > .065)) attacks.push(time);
  }
  const sectionRms = (start, end) => {
    let sum = 0, n = 0;
    for (let i = Math.max(0, Math.round(start * rate)); i < Math.min(frames, Math.round(end * rate)); i++) for (const c of data) { sum += c[i] ** 2; n++; }
    return n ? Math.sqrt(sum / n) : 0;
  };
  return { frames, rate, channels: data.length, seconds: frames / rate, peak, rms: Math.sqrt(energy / (frames * data.length)), firstAboveMinus60dB: first === frames ? null : first / rate, lastAboveMinus60dB: last < 0 ? null : last / rate, attacks, halfSecondRms: Array.from({ length: Math.ceil(frames / rate * 2) }, (_, i) => Number(sectionRms(i / 2, (i + 1) / 2).toFixed(5))), tailAfter4_8Rms: sectionRms(4.8, frames / rate), end20msRms: sectionRms(frames / rate - .02, frames / rate) };
}

function normalize(source, beats) {
  if (!Number.isInteger(beats) || beats < 4 || beats % 4) throw new Error('Expected whole-bar phrase');
  source = resample(source);
  const frames = RATE * 60 / BPM * beats;
  if (!Number.isInteger(frames) || source.data[0].length < frames) throw new Error('Refuse to invent missing phrase samples');
  const tailFrames = source.data[0].length - frames;
  let bridgeMax = 0, peak = 0;
  const data = source.data.map(channel => {
    const out = new Float32Array(frames);
    // Circular overlap-add preserves every tail at its original modulo-period time.
    // Only the final 5 ms of a tail is tapered; no beat is moved or time-compressed.
    const fade = Math.min(240, tailFrames);
    for (let i = 0; i < channel.length; i++) {
      const remaining = channel.length - 1 - i;
      const weight = i >= frames && remaining < fade ? (1 - Math.cos(Math.PI * remaining / fade)) / 2 : 1;
      out[i % frames] += channel[i] * weight;
    }
    // A 2 ms endpoint correction reaches the unchanged first sample, without
    // shortening the loop or fading the opening transient. This is not a splice.
    const delta = out[0] - out[frames - 1];
    bridgeMax = Math.max(bridgeMax, Math.abs(delta));
    for (let i = 0; i < 96; i++) out[frames - 96 + i] += delta * (1 - Math.cos(Math.PI * i / 95)) / 2;
    for (const value of out) peak = Math.max(peak, Math.abs(value));
    return out;
  });
  if (peak >= 0.999) throw new Error('Tail overlap clips; requires manual gain review');
  const result = { rate: RATE, data };
  const measured = metrics(result);
  const gain = Number(Math.min(2, 0.04 / measured.rms, 0.8 / peak).toFixed(6));
  if (!Number.isFinite(gain) || gain <= 0) throw new Error('Invalid gain');
  return { ...result, beats, loopStart: 0, loopEnd: frames / RATE, gain, tailFrames, bridgeMax };
}

function writeWav(source) {
  const { data, rate } = source, channels = data.length, frames = data[0].length;
  const bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    if (!Number.isFinite(data[c][i]) || Math.abs(data[c][i]) >= 1) throw new Error('Invalid PCM');
    bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[c][i] * 32768))), 44 + (i * channels + c) * 2);
  }
  return bytes;
}

function loadOriginal(id) {
  const file = `sounds/${id}.${id === 'black' ? 'mp3' : 'wav'}`;
  const bytes = fs.readFileSync(path.join(root, file));
  if (hash(bytes) !== decisions[id][0]) throw new Error(`${file}: unreviewed source change`);
  return { file, bytes };
}

function build() {
  const manifest = { bpm: BPM, beatsPerBar: 4, tracks: {} }, rows = [], files = [];
  // Validate every source before creating any output. Originals are never written.
  const originals = new Map(ids.map(id => [id, loadOriginal(id)]));
  for (const id of ids.filter(id => id !== 'black')) {
    const { bytes } = originals.get(id), source = readWav(bytes), normalized = normalize(source, 8);
    const wav = writeWav(normalized);
    const entry = { file: `sounds/packed/${id}.js`, loopable: true, beats: normalized.beats, loopStart: normalized.loopStart, loopEnd: normalized.loopEnd, gain: normalized.gain };
    manifest.tracks[id] = entry;
    const { file, ...metadata } = entry;
    files.push([file, `/* Generated by tools/build-audio-assets.cjs; waveform-reviewed, not audition-certified. */\nwindow.MoonAudio.registerAsset(${JSON.stringify(id)},${JSON.stringify({ data: wav.toString('base64'), type: 'audio/wav', ...metadata })});\n`]);
    rows.push({ id, source: metrics(source), normalized: metrics(readWav(wav)), tailFrames: normalized.tailFrames, bridgeMax: normalized.bridgeMax, gain: normalized.gain, packBytes: Buffer.byteLength(files.at(-1)[1]), wavSha256: hash(wav) });
  }
  const black = { file: 'sounds/packed/black.js', loopable: false, beats: null, loopStart: 0, loopEnd: BLACK_DURATION, gain: 0.2 };
  manifest.tracks.black = black;
  const { file: blackFile, ...blackMetadata } = black;
  files.push([blackFile, `/* Original MP3, byte-preserved. Preview only: no verified musical loop. */\nwindow.MoonAudio.registerAsset("black",${JSON.stringify({ data: originals.get('black').bytes.toString('base64'), type: 'audio/mpeg', ...blackMetadata })});\n`]);
  files.push(['games-audio-manifest.js', `/* Generated. Black is preview-only (loopable:false). See AUDIO-ASSETS.md. */\nwindow.MoonAudioManifest = ${JSON.stringify(manifest, null, 2)};\n`]);
  fs.mkdirSync(path.join(root, 'sounds', 'packed'), { recursive: true });
  for (const [file, contents] of files) fs.writeFileSync(path.join(root, file), contents);
  fs.writeFileSync(path.join(root, 'AUDIO-ASSETS.md'), documentation(rows));
  return { manifest, rows, generatedFiles: [...files.map(([file]) => file), 'AUDIO-ASSETS.md'] };
}

function documentation(rows) {
  const lines = [
    '# Offline Audio Assets', '',
    '## Status and Limits', '',
    '19 waveform-reviewed candidate loops, not audition-certified or independently authenticated recordings. All 20 roster originals were inspected; Black was actually decoded with Edge Web Audio (48 kHz mono, 838147 frames, 17.461396 s). No audible monitoring or reliable listening interface was available. Envelope peaks are not note transcription: sustained sounds can produce false attacks. Garnold, Sky, Mr. Tree and other melodic/vocal phrase interpretations remain provisional pending human listening. Structural tests do not establish musical correctness.', '',
    '**Black is preview-only and excluded from synchronized looping.** Its pack contains the original MP3 bytes, unchanged, with `loopable:false`, `beats:null`, `loopStart:0`, `loopEnd:838147/48000` (17.461395833333334 s) and conservative `gain:0.2`. The decoded onset is 0.332813 s; substantial energy continues to about 15 s with decay to 17.46 s. A 100 BPM phrase boundary is not verified. The parent engine should allow `loadTrack` to decode it for one-shot previews, but reject it from `setMusicSelection` with `loop-unverified`. Never enable source.loop or infer a beat count for Black. This deliverable does not claim 20 verified synchronized tracks.', '',
    'The existing roster selects `simon.wav`. The alternate `sounds/simon.mp3` is untouched and unused. No sources were downloaded, replaced, renamed, or authenticated against an external reference.', '',
    '## Rebuild and Analysis', '',
    'Run `node tools/build-audio-assets.cjs` to rebuild packs, manifest and this report, offline with Node built-ins. Source SHA-256 pins reject unreviewed changes before writing outputs. Run `node tools/build-audio-assets.cjs --analyze` for full source metrics and real MP3 decode; this requires installed Playwright plus Edge (or `AUDIO_BROWSER` executable). Set `NODE_PATH` to the installed package directory or `AUDIO_PLAYWRIGHT` to its module path. No install/download is performed. Run `node tests/audio-assets-check.cjs`; additionally run `node tests/audio-assets-browser-check.cjs` with Playwright configured for file/HTTP script-loading and browser decode tests.', '',
    '## Timing and Processing', '',
    '100 BPM, 4 beats/bar. Each supported phrase uses 8 beats, exactly 230400 frames at 48000 Hz (4.8 s); shared beat = 28800 frames. No justified longer musical phrase was established in these 19 WAVs. Pinki and Jevin have long decreasing tails, not duration-derived 16-beat assignments. A future longer verified phrase must use its actual whole-bar beat count, not be cut to eight beats.', '',
    '44.1 kHz originals use deterministic 48-tap Hann-windowed sinc sample-rate conversion to 48 kHz; existing 48 kHz PCM is retained before tail treatment. Playback rate must remain 1. No pitch shift, time stretch, onset alignment, or leading-rest removal. Stereo remains stereo. Sample-rate conversion is rounded to the nearest output frame (at most half a sample).', '',
    'Samples after the phrase boundary are circularly overlap-added at their original modulo-4.8 s positions, including tails longer than one cycle. Only the final 5 ms of exported tail are cosine-tapered to suppress the export endpoint; no tail is simply discarded. A final 2 ms cosine endpoint correction matches the unchanged first sample exactly, without shortening the period or moving beat positions. This also places previous-cycle reverb at the first playback, an intentional steady-state loop approximation, not a pristine first entrance. Listen to isolated loops and combinations before declaring musical sign-off.', '',
    'Output is 16-bit PCM WAV, rounded without random dither for reproducible builds. Clipping is rejected. Metadata gain targets RMS 0.04, capped at 2x and peak 0.8, and is not baked into PCM. It is not LUFS normalization or a multi-track limiter: the engine must supply master headroom for summed tracks.', '',
    '## Integration Contract', '',
    'Load `games-audio-manifest.js` as a classic script, then load a selected relative `file` with a script element after `window.MoonAudio.registerAsset` exists. Each pack makes exactly one synchronous registration with base64 data, MIME type, loopable, beats, loopStart, loopEnd and gain. The 19 candidate loops use WAV and loopable:true; Black uses original MP3 and loopable:false. No fetch, module import, eval, network library, or game/engine edits are included. Manifest and pack metadata agree. Schedule loopable tracks using their beat count, not source export duration.', '',
    '**Decode contract:** use `new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes)` and retain the resulting 48000 Hz AudioBuffer for the playback source. The output context can then resample during playback. Edge direct `decodeAudioData` into 44100 Hz returned 211679 frames instead of 211680, so decoding straight into an arbitrary device-rate context is NOT sample-exact. Do not derive the transport period from that shortened buffer or compensate by changing playbackRate. The browser test checks the recommended 48 kHz buffer playing at both 48 and 44.1 kHz.', '',
    '## Measured Metrics', '',
    'Source threshold times use sample magnitude >= 0.001 (-60 dBFS); RMS is unweighted across channels. Tail RMS is measured after 4.8 s. Bridge is the maximum absolute endpoint correction before gain. Onset time is diagnostic only and is never trimmed.', '',
    '| ID | Source s | Hz/ch | First/last >-60dB s | Source RMS | Tail RMS | Wrapped frames | Output peak | Gain | Bridge |',
    '|---|---:|---|---|---:|---:|---:|---:|---:|---:|'
  ];
  for (const r of rows) {
    const s = r.source;
    lines.push(`| ${r.id} | ${s.seconds.toFixed(6)} | ${s.rate}/${s.channels} | ${s.firstAboveMinus60dB.toFixed(6)} / ${s.lastAboveMinus60dB.toFixed(6)} | ${s.rms.toFixed(6)} | ${s.tailAfter4_8Rms.toFixed(6)} | ${r.tailFrames} | ${r.normalized.peak.toFixed(6)} | ${r.gain} | ${r.bridgeMax.toFixed(6)} |`);
  }
  lines.push('', 'Black (preview-only): RMS 0.162238; peak 0.823391; first/last >-60dB 0.332813 / 17.414917 s. After gain 0.2: RMS about 0.032448, peak about 0.164678. MP3 decoder details can vary slightly with browser version; re-run analysis for current values.', '', '## Per-Track Decisions', '');
  for (const id of ids) lines.push(`- **${id}:** ${decisions[id][1]}`);
  lines.push('', '## Source Integrity and Output Digests', '', '| ID | Original SHA-256 | Packed audio SHA-256 |', '|---|---|---|');
  for (const id of ids) lines.push(`| ${id} | ${decisions[id][0]} | ${rows.find(r => r.id === id)?.wavSha256 || decisions.black[0]} |`);
  const blackBytes = fs.statSync(path.join(root, 'sounds/packed/black.js')).size;
  lines.push('', '## Generated Files', '', '- `tools/build-audio-assets.cjs` (build/analysis implementation)', '- `games-audio-manifest.js`', '- `AUDIO-ASSETS.md` (this generated report)', ...rows.map(r => `- \`sounds/packed/${r.id}.js\` (${r.packBytes} bytes)`), `- \`sounds/packed/black.js\` (${blackBytes} bytes, original MP3 preview only)`, '', `Total pack bytes: ${rows.reduce((n, r) => n + r.packBytes, 0) + blackBytes}. Each pack is separate for on-demand loading.`, '');
  return lines.join('\n');
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--analyze')) throw new Error('Usage: node tools/build-audio-assets.cjs [--analyze]');
  if (!process.argv.includes('--analyze')) {
    const result = build();
    console.log(JSON.stringify({ generatedFiles: result.generatedFiles, tracks: result.rows.map(r => ({ id: r.id, frames: r.normalized.frames, tailFrames: r.tailFrames, peak: r.normalized.peak, gain: r.gain, bridgeMax: r.bridgeMax })), previewOnly: { black: result.manifest.tracks.black } }, null, 2));
    return;
  }
  const decoder = await browserDecoder();
  try {
    for (const id of ids) {
      const { file, bytes } = loadOriginal(id);
      const source = file.endsWith('.wav') ? readWav(bytes) : await decoder.decode(bytes);
      console.log(JSON.stringify({ id, file, sha256: hash(bytes), ...metrics(source) }));
    }
  } finally { await decoder.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { ids, RATE, BPM, root, hash, readWav, writeWav, resample, normalize, metrics, browserDecoder, loadOriginal, decisions, build };
