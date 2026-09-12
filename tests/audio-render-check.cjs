'use strict';

// Independent real-PCM QA, not a test double or a 30-minute live-playback claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const { chromium } = require(process.env.AUDIO_PLAYWRIGHT || runtime);
const canonicalIds = ['oren', 'raddy', 'clukr', 'funbot', 'vineria', 'gray', 'brud', 'garnold', 'owakcx', 'sky', 'mrsun', 'durple', 'mrtree', 'simon', 'tunner', 'mrfun', 'wenda', 'pinki', 'jevin'];
const anpanIds = ['anpanman', 'baikinman', 'dokinchan', 'shokupanman', 'currypanman', 'melonpanna', 'rollpanna', 'creampanda', 'jamojisan', 'batakosan'];
const loopIds = [...canonicalIds, ...anpanIds];
const busCounts = [1, 5, 19, 29];

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', ...(process.env.AUDIO_BROWSER ? { executablePath: process.env.AUDIO_BROWSER } : {}) });
  // Sequential renders only; bound the whole suite without allocating long live audio.
  const deadline = setTimeout(() => { console.error('FAIL: audio QA exceeded 10-minute bound'); void browser.close(); }, 600000);
  deadline.unref();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => {
      window.qaAssets = {};
      window.MoonAudio = { registerAsset(id, asset) { window.qaAssets[id] = asset; } };
    });
    await page.addScriptTag({ path: path.join(root, 'games-audio-manifest.js') });
    const entries = await page.evaluate(() => Object.entries(MoonAudioManifest.tracks));
    assert.equal(entries.length, 30, 'Manifest must contain 29 loops and Black');
    assert.deepEqual(entries.filter(([, meta]) => meta.loopable === true).map(([id]) => id).sort(), [...loopIds].sort());
    assert.deepEqual(entries.filter(([, meta]) => meta.loopable !== true).map(([id]) => id), ['black']);
    assert.equal(entries.find(([id]) => id === 'black')[1].loopable, false);
    for (const [id, meta] of entries) {
      assert(/^[a-z0-9-]+$/.test(id));
      assert(/^sounds\/packed\/[a-z0-9-]+\.js$/.test(meta.file));
      await page.addScriptTag({ path: path.join(root, meta.file) });
    }
    const report = await page.evaluate(async ({ canonicalIds, anpanIds, loopIds }) => {
      const sampleRate = 48000, manifest = window.MoonAudioManifest;
      const tracks = [];
      const decoder = new OfflineAudioContext(2, 1, sampleRate);
      for (const [id, entry] of Object.entries(manifest.tracks)) {
        const asset = qaAssets[id], meta = { ...entry, ...asset };
        if (id === 'black' || meta.loopable === false) continue;
        const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
        const buffer = await decoder.decodeAudioData(bytes.buffer);
        tracks.push({ id, meta, buffer });
      }
      const period = tracks[0].meta.beats * 60 / manifest.bpm;
      const frames = Math.round(period * sampleRate), seconds = period * 2 + .1;
      const length = Math.round(seconds * sampleRate);
      const modulo = (value, modulus) => ((value % modulus) + modulus) % modulus;
      const select = ids => ids.map(id => tracks.find(track => track.id === id));
      const groups = select(loopIds).map(track => ({ name: track.id, tracks: [track] }));
      for (const count of [1, 5, 19]) groups.push({ name: `ensemble-${count}`, tracks: select(canonicalIds.slice(0, count)) });
      groups.push({ name: 'ensemble-anpan-10', tracks: select(anpanIds) });
      groups.push({ name: 'ensemble-29', tracks: select(loopIds) });
      const rows = [], mixRows = [];
      function scaleFor(selected, strategy) {
        const denominator = strategy === 'L2' ? Math.sqrt(selected.reduce((sum, track) => sum + track.meta.gain ** 2, 0)) : Math.max(1, selected.reduce((sum, track) => sum + track.meta.gain, 0));
        return Math.min(.8, .9 / denominator);
      }
      function graph(context, selected, mode, strategy) {
        if (mode === 'raw') return context.destination;
        // Independent reconstruction of the documented gain chain, not engine coverage.
        const bus = context.createGain(), compressor = context.createDynamicsCompressor(), master = context.createGain();
        bus.gain.value = (mode === 'maximum' ? 1 : .65) * scaleFor(selected, strategy);
        compressor.threshold.value = -12; compressor.knee.value = 12;
        compressor.ratio.value = 8; compressor.attack.value = .003; compressor.release.value = .15;
        master.gain.value = .8;
        bus.connect(compressor); compressor.connect(master); master.connect(context.destination);
        return bus;
      }
      async function render(selected, elapsed, oracle, mode = 'raw', strategy = 'L1') {
        const context = new OfflineAudioContext(2, length, sampleRate);
        const output = graph(context, selected, mode, strategy);
        for (const track of selected) {
          const source = context.createBufferSource(), gain = context.createGain();
          const startFrame = Math.round(track.meta.loopStart * sampleRate);
          const periodFrames = Math.round((track.meta.loopEnd - track.meta.loopStart) * sampleRate);
          if (oracle) {
            // Integer-frame circular indexing is independent of floating-point seconds modulo.
            const rotated = context.createBuffer(track.buffer.numberOfChannels, periodFrames, sampleRate);
            const offsetFrames = modulo(Math.round(elapsed * sampleRate), periodFrames);
            for (let c = 0; c < rotated.numberOfChannels; c++) {
              const input = track.buffer.getChannelData(c), data = rotated.getChannelData(c);
              for (let i = 0; i < periodFrames; i++) data[i] = input[startFrame + modulo(i + offsetFrames, periodFrames)];
            }
            source.buffer = rotated; source.loop = true; source.loopEnd = periodFrames / sampleRate;
          } else {
            source.buffer = track.buffer; source.loop = true;
            source.loopStart = track.meta.loopStart; source.loopEnd = track.meta.loopEnd;
          }
          gain.gain.value = track.meta.gain;
          source.connect(gain); gain.connect(output);
          const offset = oracle ? 0 : track.meta.loopStart + modulo(elapsed, track.meta.beats * 60 / manifest.bpm);
          source.start(0, offset);
        }
        return context.startRendering();
      }
      function compare(actual, expected) {
        let maxError = 0, energy = 0, steadyEnergy = 0, peak = 0, repeatError = 0, clipped = 0;
        const lagErrors = Array(5).fill(0);
        for (let c = 0; c < 2; c++) {
          const a = actual.getChannelData(c), b = expected.getChannelData(c);
          for (let i = 0; i < a.length; i++) {
            maxError = Math.max(maxError, Math.abs(a[i] - b[i]));
            peak = Math.max(peak, Math.abs(a[i])); energy += a[i] * a[i];
            if (i >= frames && i < frames * 2) steadyEnergy += a[i] * a[i];
            if (Math.abs(a[i]) >= 1) clipped++;
            if (i + frames < a.length) repeatError = Math.max(repeatError, Math.abs(a[i] - a[i + frames]));
            if (i >= 2 && i < a.length - 2) for (let lag = -2; lag <= 2; lag++) lagErrors[lag + 2] += (a[i] - b[i + lag]) ** 2;
          }
        }
        const bestLagSamples = lagErrors.indexOf(Math.min(...lagErrors)) - 2;
        const rms = Math.sqrt(energy / (length * 2)), steadyRms = Math.sqrt(steadyEnergy / (frames * 2));
        return { maxError, bestLagSamples, repeatError, peak, headroomDb: -20 * Math.log10(peak), rms, rmsDbfs: 20 * Math.log10(rms), steadyRms, steadyRmsDbfs: 20 * Math.log10(steadyRms), clippedSamples: clipped };
      }
      for (const group of groups) {
        for (const epochSeconds of [0, 600, 1800]) for (const phaseSeconds of [0, period / 2]) {
          const elapsed = epochSeconds + phaseSeconds;
          const actual = await render(group.tracks, elapsed, false);
          const reference = await render(group.tracks, elapsed, true);
          rows.push({ group: group.name, epochSeconds, phaseSeconds, ...compare(actual, reference) });
        }
        if (group.name.startsWith('ensemble-')) {
          for (const strategy of ['L1', 'L2']) for (const mode of ['nominal', 'maximum']) {
            const actual = await render(group.tracks, 1800, false, mode, strategy);
            const reference = await render(group.tracks, 1800, true, mode, strategy);
            mixRows.push({ group: group.name, ids: group.tracks.map(track => track.id), strategy, scale: scaleFor(group.tracks, strategy), mode, ...compare(actual, reference) });
          }
        }
      }
      return {
        method: 'Real packed PCM; bounded OfflineAudioContext segments with integer-frame oracle. No synthetic impulses, no live 30-minute run, no full 30-minute allocation.',
        scope: '30 manifest tracks: 19 canonical + 10 Anpan game-original loops, Black one-shot. Moon roster 35 is outside this PCM test. PCM periodicity does not certify musical phrasing or source authenticity.',
        groups: groups.map(group => ({ name: group.name, ids: group.tracks.map(track => track.id) })),
        sampleRate, secondsPerRender: seconds, maxFramesPerRender: length,
        epochSeconds: [0, 600, 1800], tracks: tracks.map(t => ({ id: t.id, gain: t.meta.gain, frames: t.buffer.length, channels: t.buffer.numberOfChannels, loopFrames: Math.round((t.meta.loopEnd - t.meta.loopStart) * sampleRate) })),
        blackManifest: manifest.tracks.black ? { loopable: manifest.tracks.black.loopable } : null,
        rows, mixRows
      };
    }, { canonicalIds, anpanIds, loopIds });
    report.browser = browser.version();
    report.engineDecode = [];
    for (const deviceRate of [44100, 48000]) {
      const enginePage = await browser.newPage();
      enginePage.on('pageerror', error => errors.push(error.message));
      await enginePage.goto(require('node:url').pathToFileURL(path.join(root, 'tests/audio-assets-fixture.html')).href);
      await enginePage.evaluate(rate => {
        delete window.MoonAudio;
        const NativeAudioContext = window.AudioContext, NativeOfflineAudioContext = window.OfflineAudioContext;
        window.qaNativeOffline = NativeOfflineAudioContext;
        window.qaContexts = { realtime: 0, offline: [] };
        // Real browser contexts: only request the output sample rate, never fake PCM or timing.
        window.AudioContext = class extends NativeAudioContext {
          constructor(options) { super({ ...options, sampleRate: rate }); qaContexts.realtime++; }
        };
        window.OfflineAudioContext = class extends NativeOfflineAudioContext {
          constructor(...args) { super(...args); qaContexts.offline.push({ sampleRate: this.sampleRate, length: this.length }); }
        };
      }, deviceRate);
      await enginePage.addScriptTag({ path: path.join(root, 'games-audio-manifest.js') });
      await enginePage.addScriptTag({ path: path.join(root, 'games-audio.js') });
      const before = await enginePage.evaluate(() => structuredClone(qaContexts));
      for (const [id, meta] of entries) {
        if (id !== 'black' && meta.loopable !== false) await enginePage.addScriptTag({ path: path.join(root, meta.file) });
      }
      const decoded = await enginePage.evaluate(async ({ rate, loopIds, busCounts }) => {
        const actualDeviceRate = MoonAudio.getContext().sampleRate, rows = [];
        for (const [id, entry] of Object.entries(MoonAudioManifest.tracks)) {
          if (id === 'black' || entry.loopable === false) continue;
          const { buffer, meta } = await MoonAudio.loadTrack(id);
          const cached = await MoonAudio.loadTrack(id);
          const periodFrames = Math.round(4.8 * rate);
          const epochRows = [];
          for (const elapsed of [0, 600, 1800]) {
          const renderer = new qaNativeOffline(2, periodFrames * 3, rate);
          const source = renderer.createBufferSource();
          source.buffer = buffer; source.loop = true;
          source.loopStart = meta.loopStart; source.loopEnd = meta.loopEnd;
          source.connect(renderer.destination); source.start(0, meta.loopStart + ((elapsed % 4.8) + 4.8) % 4.8);
          const output = await renderer.startRendering();
          const referenceContext = new qaNativeOffline(2, periodFrames * 3, rate);
          const rotated = referenceContext.createBuffer(buffer.numberOfChannels, 230400, 48000);
          const offsetFrames = Math.round(elapsed * 48000) % 230400;
          for (let c = 0; c < buffer.numberOfChannels; c++) {
            const input = buffer.getChannelData(c), data = rotated.getChannelData(c);
            for (let i = 0; i < data.length; i++) data[i] = input[(i + offsetFrames) % 230400];
          }
          const referenceSource = referenceContext.createBufferSource();
          referenceSource.buffer = rotated; referenceSource.loop = true; referenceSource.loopEnd = 4.8;
          referenceSource.connect(referenceContext.destination); referenceSource.start(0);
          const reference = await referenceContext.startRendering();
          let repeatError = 0, maxError = 0;
          // Ignore initial resampler startup: compare complete second and third periods.
          for (let c = 0; c < 2; c++) {
            const data = output.getChannelData(c);
            const expected = reference.getChannelData(c);
            for (let i = periodFrames; i < data.length; i++) maxError = Math.max(maxError, Math.abs(data[i] - expected[i]));
            for (let i = 0; i < periodFrames; i++) repeatError = Math.max(repeatError, Math.abs(data[periodFrames + i] - data[2 * periodFrames + i]));
          }
          epochRows.push({ simulatedElapsedSeconds: elapsed, repeatError, maxError });
          }
          rows.push({ id, sampleRate: buffer.sampleRate, frames: buffer.length, duration: buffer.duration, loopStart: meta.loopStart, loopEnd: meta.loopEnd, cachedIdentity: cached.buffer === buffer, epochRows, repeatError: Math.max(...epochRows.map(row => row.repeatError)) });
        }
        const busRows = [], ids = loopIds;
        // Keep the bus in a rendered graph so AudioParam.value advances, with a silent sink.
        const bus = MoonAudio.output('music'), silent = MoonAudio.getContext().createGain();
        silent.gain.value = 0; bus.disconnect(); bus.connect(silent); silent.connect(MoonAudio.getContext().destination);
        MoonAudio.setDucking(false);
        for (const count of busCounts) for (const volume of [.65, 1]) {
          MoonAudio.stopMusic();
          MoonAudio.setVolumes({ music: volume });
          await MoonAudio.setMusicSelection(ids.slice(0, count));
          const deadline = performance.now() + 5000;
          while (MoonAudio.getMusicState().playing.length !== count && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
          await new Promise(resolve => setTimeout(resolve, 250));
          busRows.push({ count, ids: ids.slice(0, count), volume, gain: bus.gain.value, state: MoonAudio.getMusicState() });
        }
        const contexts = structuredClone(qaContexts);
        MoonAudio.dispose();
        return { actualDeviceRate, contexts, rows, busRows };
      }, { rate: deviceRate, loopIds, busCounts });
      report.engineDecode.push({ requestedDeviceRate: deviceRate, before, ...decoded });
      await enginePage.close();
    }
    if (process.argv.includes('--live')) {
      const live = await browser.newPage();
      // Use the existing local fixture, then replace its registration stub with the real engine.
      const { pathToFileURL } = require('node:url');
      await live.goto(pathToFileURL(path.join(root, 'tests/audio-assets-fixture.html')).href);
      await live.evaluate(() => {
        delete window.MoonAudio;
        window.qaStarts = [];
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (when, offset, ...rest) {
          window.qaStarts.push({ when, offset, requestedAt: this.context.currentTime, frames: this.buffer.length });
          return start.call(this, when, offset, ...rest);
        };
      });
      await live.addScriptTag({ path: path.join(root, 'games-audio.js') });
      // Register the two real packs explicitly; this check isolates scheduling from loading.
      for (const id of ['oren', 'raddy']) await live.addScriptTag({ path: path.join(root, 'sounds', 'packed', `${id}.js`) });
      await live.evaluate(async () => {
        MoonAudio.setVolumes({ music: 0 });
        await MoonAudio.setMusicSelection(['oren']);
      });
      await live.waitForTimeout(650);
      await live.evaluate(() => MoonAudio.setMusicSelection(['oren', 'raddy']));
      await live.waitForTimeout(4600);
      report.live = await live.evaluate(() => ({ starts: qaStarts, state: MoonAudio.getMusicState(), time: MoonAudio.now() }));
      await live.evaluate(() => MoonAudio.dispose());
      await live.close();
    }
    const outputDirectory = path.join(root, 'output', 'audio-polish');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const output = path.join(outputDirectory, 'audio-render-report.json');
    report.generatedAt = new Date().toISOString();
    report.status = 'assertions-pending';
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`Report: ${output}`);
    for (const device of report.engineDecode) {
      assert.equal(device.actualDeviceRate, device.requestedDeviceRate, 'Real output context rate');
      assert.deepEqual(device.before, { realtime: 0, offline: [] }, 'Contexts must be lazy');
      assert.equal(device.contexts.realtime, 1, 'Only one real output context');
      assert.deepEqual(device.contexts.offline, [{ sampleRate: 48000, length: 1 }], 'One lazy shared 48 kHz decoder');
      assert.equal(device.rows.length, loopIds.length);
      assert.deepEqual(device.rows.map(row => row.id).sort(), [...loopIds].sort());
      for (const row of device.rows) {
        assert.equal(row.sampleRate, 48000, `${device.requestedDeviceRate}/${row.id}: decoded buffer rate`);
        assert.equal(row.frames, 230400, `${device.requestedDeviceRate}/${row.id}: no frame truncation`);
        assert.equal(row.duration, 4.8, row.id);
        assert.equal(row.loopStart, 0, row.id);
        assert.equal(row.loopEnd, 4.8, `${row.id}: preserve exact metadata end, do not clamp`);
        assert(row.cachedIdentity, `${row.id}: cache decoded buffer`);
        assert.deepEqual(row.epochRows.map(epoch => epoch.simulatedElapsedSeconds), [0, 600, 1800]);
        for (const epoch of row.epochRows) {
          assert(epoch.maxError < 1e-5, `${device.requestedDeviceRate}/${row.id}/${epoch.simulatedElapsedSeconds}: epoch PCM error ${epoch.maxError}`);
          assert(epoch.repeatError < 1e-5, `${device.requestedDeviceRate}/${row.id}/${epoch.simulatedElapsedSeconds}: repeat error ${epoch.repeatError}`);
        }
        assert(row.repeatError < 1e-5, `${device.requestedDeviceRate}/${row.id}: resampled loop period error ${row.repeatError}`);
      }
      assert.deepEqual(device.busRows.map(row => [row.count, row.volume]), busCounts.flatMap(count => [[count, .65], [count, 1]]));
      for (const row of device.busRows) {
        assert.deepEqual(row.ids, loopIds.slice(0, row.count));
        const power = row.ids.reduce((sum, id) => sum + report.tracks.find(track => track.id === id).gain ** 2, 0);
        row.expectedL2 = row.volume * Math.min(.8, .9 / Math.sqrt(Math.max(1, power)));
        row.absoluteError = Math.abs(row.gain - row.expectedL2);
        assert.equal(row.state.playing.length, row.count);
        assert.deepEqual([...row.state.playing].sort(), [...row.ids].sort());
        assert.deepEqual(row.state.errors, []);
        assert.deepEqual(row.state.pending, []);
        assert(row.absoluteError < 1e-6, `Actual engine music bus ${device.actualDeviceRate}/${row.count}/${row.volume}: ${row.gain} expected L2 ${row.expectedL2}`);
      }
      console.log(`PASS real engine loadTrack: output=${device.actualDeviceRate} Hz, all ${loopIds.length} buffers=48000 Hz/230400 frames, duration/loopEnd=4.8 exactly; epochs 0/600/1800 PCM error <= ${Math.max(...device.rows.flatMap(row => row.epochRows.map(epoch => epoch.maxError)))}; output-rate repeat error <= ${Math.max(...device.rows.map(row => row.repeatError))}.`);
      console.log(`PASS actual engine L2 music bus: ${device.busRows.length} cases at ${device.actualDeviceRate} Hz; ${busCounts.join('/')} stems, nominal/maximum; settled AudioParam error <= ${Math.max(...device.busRows.map(row => row.absoluteError))}.`);
    }
    if (report.live) {
      assert.equal(report.live.starts.length, 2, 'Joining must not restart the existing stem');
      const [first, joined] = report.live.starts;
      const bar = 2.4;
      assert(joined.when > joined.requestedAt, 'Join must be scheduled in the future');
      assert(Math.abs((joined.when - first.when) / bar - Math.round((joined.when - first.when) / bar)) < 1e-7, 'Join aligns to original epoch bar');
      assert(Math.abs(joined.offset - ((joined.when - first.when) % 4.8)) < 1e-7, 'Join offset preserves original phrase phase');
      assert.deepEqual(report.live.state.playing.sort(), ['oren', 'raddy']);
      assert.deepEqual(report.live.state.errors, []);
      console.log(`PASS real-clock join: observed ${report.live.time.toFixed(2)} s; ${report.live.starts.length} starts, epoch-preserving bar offset ${joined.offset.toFixed(6)} s. Scheduling history only, muted output.`);
    }
    assert.deepEqual(errors, []);
    assert.equal(report.tracks.length, loopIds.length);
    assert.deepEqual(report.tracks.map(track => track.id).sort(), [...loopIds].sort());
    const ensembleGroups = [
      ...[1, 5, 19].map(count => ({ name: `ensemble-${count}`, ids: canonicalIds.slice(0, count) })),
      { name: 'ensemble-anpan-10', ids: anpanIds },
      { name: 'ensemble-29', ids: loopIds }
    ];
    assert.deepEqual(report.groups, [...loopIds.map(id => ({ name: id, ids: [id] })), ...ensembleGroups]);
    assert.deepEqual(report.rows.map(row => [row.group, row.epochSeconds, row.phaseSeconds]),
      report.groups.flatMap(group => [0, 600, 1800].flatMap(epoch => [0, 2.4].map(phase => [group.name, epoch, phase]))));
    assert.deepEqual(report.mixRows.map(row => [row.group, row.ids, row.strategy, row.mode]),
      ensembleGroups.flatMap(group => ['L1', 'L2'].flatMap(strategy => ['nominal', 'maximum'].map(mode => [group.name, group.ids, strategy, mode]))));
    for (const track of report.tracks) assert.equal(track.loopFrames, 230400, track.id);
    for (const row of [...report.rows, ...report.mixRows]) {
      for (const key of ['maxError', 'repeatError', 'peak', 'rms', 'rmsDbfs', 'headroomDb']) assert(Number.isFinite(row[key]), `${row.group}: finite ${key}`);
      assert(row.rms > 0, `${row.group}: non-silent PCM`);
    }
    const failures = report.rows.filter(row => row.maxError > 1e-5 || row.bestLagSamples !== 0 || row.repeatError > 1e-5);
    for (const row of report.mixRows) {
      console.log(`${row.group}/${row.strategy}/${row.mode}: peak=${row.peak.toFixed(6)}, RMS=${row.rms.toFixed(6)} (${row.rmsDbfs.toFixed(2)} dBFS), headroom=${row.headroomDb.toFixed(2)} dB, lag=${row.bestLagSamples}, PCM error=${row.maxError}`);
      if (row.clippedSamples || row.maxError > 1e-5 || row.bestLagSamples !== 0) failures.push(row);
    }
    for (const group of ensembleGroups) console.log(`Raw ${group.name} peak: ${Math.max(...report.rows.filter(r => r.group === group.name).map(r => r.peak)).toFixed(6)} (before gain-chain headroom control)`);
    assert.deepEqual(failures, [], 'PCM phase/repeat/headroom failures; report retained. Do not infer musical certification.');
    report.status = 'passed';
    report.currentEngineScaling = 'L2: volume * min(.8, .9 / sqrt(max(1, sum(gain ** 2)))); actual settled music-bus AudioParam verified, not full engine PCM.';
    report.scalingComparison = ['nominal', 'maximum'].map(mode => {
      const find = (count, strategy) => report.mixRows.find(row => row.group === `ensemble-${count}` && row.mode === mode && row.strategy === strategy);
      return { mode, ensembles: busCounts.map(count => {
        const l1 = find(count, 'L1'), l2 = find(count, 'L2');
        return { count, rmsImprovementDb: l2.rmsDbfs - l1.rmsDbfs, l1RmsRelativeToSoloDb: l1.rmsDbfs - find(1, 'L1').rmsDbfs, l2RmsRelativeToSoloDb: l2.rmsDbfs - find(1, 'L2').rmsDbfs, l2Peak: l2.peak, l2HeadroomDb: l2.headroomDb };
      }) };
    });
    report.passCounts = {
      realPcmEpochPhaseCases: report.rows.length,
      independentlyModeledGainChainCases: report.mixRows.length,
      actualEngineDecodeAndOutputRepeatCases: report.engineDecode.reduce((sum, device) => sum + device.rows.length, 0),
      actualEngineOutputEpochComparisons: report.engineDecode.reduce((sum, device) => sum + device.rows.reduce((total, row) => total + row.epochRows.length, 0), 0),
      actualEngineL2BusCases: report.engineDecode.reduce((sum, device) => sum + device.busRows.length, 0),
      realClockJoinCases: report.live ? 1 : 0,
      uncaughtBrowserErrors: errors.length
    };
    report.limits = [
      '29 candidate synchronized music loops: preserved 19 canonical and 10 Anpan game-original loops, checked individually and in canonical 1/5/19, Anpan-only 10 and combined 29 groups. Black remains preview-only, not loop-certified; the Moon UI roster is outside this PCM test.',
      'Epoch comparisons use bounded real-PCM OfflineAudioContext renders at 48 kHz for 0, 600 and 1800 seconds plus half-period phase.',
      'Gain-chain PCM is independently modeled, NOT captured from the actual engine mixed-output graph.',
      'Actual engine L2 bus checks read settled music-bus AudioParam values for 1/5/19/29 stems at .65/1 volume on 44.1/48 kHz contexts; the real bus feeds a zero-gain sink so browser processing continues silently. Not a transition or full-output PCM measurement.',
      'L1 versus L2 gain comparison uses canonical 1/5/19, Anpan-only 10 and combined 29 stems at shared phase and music volume .65/1, the same compressor and master .8. Not every subset, transition, or simultaneous sound-effect case is tested; low peak alone is not quality evidence.',
      'Actual engine coverage is all 29 loadTrack buffers decoding/cache/lazy contexts at requested 44.1/48 kHz output rates, with exact 4.8-second duration and loop end; decoded buffers are independently rendered for output-rate repeat and integer-frame oracle comparisons at simulated epochs 0/600/1800. Initial resampler startup is excluded from device-rate comparisons.',
      'Optional real-clock join verifies source scheduling history with muted output, not actual engine full PCM.',
      'No 30-minute live run, full 30-minute RAM render, synthetic-impulse clock test, audible assessment, musical-phrase certification, or source authentication.',
      'Peak is sampled PCM peak, not oversampled true peak or LUFS. Seven-game/84-combination UI QA is outside this report.'
    ];
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    const summary = [
      '# Independent Audio Render QA', '',
      `Status: PASS. Generated: ${report.generatedAt}. Browser: ${report.browser}.`,
      `Current engine scaling: ${report.currentEngineScaling}`,
      `Command: \`node tests/audio-render-check.cjs${report.live ? ' --live' : ''}\` (real-clock join is optional).`,
      '[Machine-readable measurements](audio-render-report.json)', '',
      '## Passed Cases', '',
      ...Object.entries(report.passCounts).map(([name, count]) => `- ${name}: ${count}`), '',
      `Maximum epoch PCM error: ${Math.max(...report.rows.map(row => row.maxError))}. Best phase lag: 0 samples in all epoch cases.`,
      ...ensembleGroups.map(group => `Raw ${group.name} sum peak: ${Math.max(...report.rows.filter(row => row.group === group.name).map(row => row.peak))} (before modeled headroom control).`), '',
      '## Independently Modeled Gain Chain', '',
      'These are NOT actual-engine mixed-output PCM measurements.', '',
      'L1 historical comparison: `min(.8, .9 / max(1, sum(gain)))`. Current L2: `min(.8, .9 / sqrt(max(1, sum(gain ** 2))))`; equivalent to the tested proposal under the .8 cap.', '',
      '| Ensemble | Scaling | Volume mode | Sample peak | RMS | RMS dBFS | Headroom dB |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...report.mixRows.map(row => `| ${row.group} | ${row.strategy} | ${row.mode} | ${row.peak.toFixed(6)} | ${row.rms.toFixed(6)} | ${row.rmsDbfs.toFixed(2)} | ${row.headroomDb.toFixed(2)} |`), '',
      '## Scaling Comparison', '',
      'The parent adopted L2 in the engine. Settled engine bus gains match L2; independent modeled PCM improves RMS consistency in these measured ensembles without sampled clipping. This is not a claim that quieter audio is higher quality or that all combinations are safe.', '',
      '| Volume mode | Stems | L2 RMS gain over L1 dB | L1 vs solo dB | L2 vs solo dB |',
      '| --- | --- | --- | --- | --- |',
      ...report.scalingComparison.flatMap(result => result.ensembles.map(row => `| ${result.mode} | ${row.count} | ${row.rmsImprovementDb.toFixed(2)} | ${row.l1RmsRelativeToSoloDb.toFixed(2)} | ${row.l2RmsRelativeToSoloDb.toFixed(2)} |`)), '',
      'Before full audio sign-off, test simultaneous effects, join/leave gain ramps, correlated subsets and audible compressor behavior. The QA task did not edit the engine; the parent owns its implementation.', '',
      '## Actual Engine Decode', '',
      ...report.engineDecode.map(device => `- Output ${device.actualDeviceRate} Hz: ${device.rows.length} real loadTrack buffers, all 48000 Hz / 230400 frames / exact loopEnd 4.8; independent output-rate repeat error <= ${Math.max(...device.rows.map(row => row.repeatError))}.`),
      ...report.engineDecode.map(device => `- Actual L2 bus at ${device.actualDeviceRate} Hz: ${device.busRows.length} settled AudioParam checks passed; maximum absolute gain error ${Math.max(...device.busRows.map(row => row.absoluteError))}.`),
      ...(report.live ? [`- Real-clock observation: ${report.live.time.toFixed(3)} s; ${report.live.starts.length} source starts; joining offset ${report.live.starts[1].offset.toFixed(6)} s; existing stem not restarted.`] : ['- Real-clock join: not run.']), '',
      '## Limits', '', ...report.limits.map(limit => `- ${limit}`), ''
    ].join('\n');
    fs.writeFileSync(path.join(outputDirectory, 'audio-render-summary.md'), summary);
    console.log(`PASS ${report.rows.length} real-PCM epoch/phase checks; ${report.mixRows.length} independently modeled gain-chain renders; max PCM error=${Math.max(...report.rows.map(r => r.maxError))}.`);
    console.log('LIMIT: 29 candidate music loops (19 canonical + 10 Anpan), including Anpan-only and combined groups. Black excluded. Epoch PCM comparisons at 0/600/1800 simulated seconds; actual engine decode and independent output-loop checks at 44.1/48 kHz. No audible, live 30-minute or synthetic-clock verification. Optional live check covers scheduling history, not engine mixed-output PCM.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
