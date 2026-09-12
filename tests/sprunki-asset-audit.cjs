const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const expectedIds = 'oren raddy clukr funbot vineria gray brud garnold owakcx sky mrsun durple mrtree simon tunner mrfun wenda pinki jevin black'.split(' ');
const anpanIds = 'anpanman baikinman dokinchan shokupanman currypanman melonpanna rollpanna creampanda jamojisan batakosan'.split(' ');
const modIds = ['acid', 'tox', 'sulfur', 'mard', 'mrbear'];
const runtime = process.env.CODEX_NODE_RUNTIME || 'C:/Users/shohe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node';

function extractCharacters(source, rosterSource = fs.readFileSync(path.join(root, 'sprunki-roster.js'), 'utf8')) {
  assert(source.length <= 2 * 1024 * 1024 && rosterSource.length <= 64 * 1024, 'Roster input exceeds size limit');
  const declarations = [...source.matchAll(/\bconst\s+sprunkiCharacters\s*=\s*/g)];
  assert.equal(declarations.length, 1, 'Expected exactly one sprunkiCharacters array');
  const start = declarations[0].index + declarations[0][0].length;
  const candidate = source.slice(start, start + 64 * 1024);
  // The known declaration ends on its own line. Never evaluate the game IIFE.
  const end = /^[ \t]*\];[ \t]*\r?$/m.exec(candidate);
  assert(candidate.startsWith('[') && end, 'Missing bounded roster array terminator');
  const literal = candidate.slice(0, end.index + end[0].indexOf(']') + 1);
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate'
  });
  vm.runInContext(rosterSource, context, { timeout: 250, filename: 'sprunki-roster.js' });
  // Serialization stays inside the timeout too, including any getters/toJSON.
  const result = vm.runInContext(`JSON.stringify((${literal}))`, context, { timeout: 250 });
  const characters = JSON.parse(result);
  assert(Array.isArray(characters) && characters.length <= 64, 'Invalid roster size');
  assert(characters.every(c => c && !Array.isArray(c) && typeof c === 'object' &&
    Object.entries(c).every(([key, value]) => typeof value === 'string' ||
      (key === 'originalMusic' && anpanIds.includes(c.id) && value === true))), 'Roster records must have string values except approved generated-original marker');
  return characters;
}

function classifyCharacters(characters) {
  const ids = characters.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate roster IDs');
  assert.deepEqual(ids, [...expectedIds, ...anpanIds, ...modIds], 'Expected canonical twenty, ten Anpanman and five MOD entries in order');
  const canonical = characters.slice(0, expectedIds.length), extras = characters.slice(expectedIds.length);
  for (const c of canonical) {
    assert.equal(c.file, `sprunki-${c.id}.png`, c.id + ': canonical image path');
    assert.equal(c.audio, `sounds/${c.id}.${c.id === 'black' ? 'mp3' : 'wav'}`, c.id + ': canonical audio path');
  }
  for (const c of extras) {
    const anpan = anpanIds.includes(c.id);
    assert.equal(c.file, `assets/${anpan ? 'anpanman' : 'sprunki-mods'}/${c.id}.png`);
    if (anpan) {
      assert.equal(c.sprite, c.id);
      assert.equal(c.audio, `sounds/${c.id}.wav`, c.id + ': generated original audio path');
      assert.equal(c.originalMusic, true, c.id + ': game-original provenance marker');
    }
    else {
      assert(!Object.hasOwn(c, 'audio'), c.id + ': no invented MOD recording');
      assert.equal(c.sourceGroup, ['acid', 'tox', 'sulfur'].includes(c.id) ? 'Pyramixed' : 'Retake');
      assert(!Object.hasOwn(c, 'music'), c.id + ': no invented MOD music');
    }
  }
  return { canonical, extras };
}

function parserChecks(source, rosterSource) {
  const characters = extractCharacters(source, rosterSource);
  classifyCharacters(characters);
  const fixture = expression => `const sprunkiCharacters = [\n${expression}\n];\nthrow Error('Game must not execute');`;
  assert.deepEqual(extractCharacters(fixture('...globalThis.SprunkiRoster.modCharacters.map(c => ({ ...c }))'), rosterSource).map(c => c.id), modIds);
  assert.throws(() => extractCharacters(fixture('not valid javascript'), rosterSource));
  assert.throws(() => extractCharacters(fixture('(()=>{while(true){}})()'), rosterSource), /timed out/);
  assert.throws(() => extractCharacters(fixture('{get id(){while(true){}}}'), rosterSource), /timed out/);
  assert.throws(() => extractCharacters(fixture('') + fixture(''), rosterSource), /exactly one/);
  assert.throws(() => extractCharacters('x'.repeat(2 * 1024 * 1024 + 1), rosterSource), /size limit/);
  for (const mutate of [cs => cs[0].id = 'invented', cs => delete cs[0].audio,
    cs => cs[0].file = 'wrong.png', cs => cs[20].audio = 'fake.wav', cs => delete cs[20].audio,
    cs => delete cs[20].originalMusic, cs => cs[20].originalMusic = false,
    cs => cs[30].audio = 'fake.wav', cs => cs.pop()]) {
    const copy = structuredClone(characters); mutate(copy);
    assert.throws(() => classifyCharacters(copy));
  }
  console.log('PASS bounded roster extraction, MOD spread, malformed/timeout cases and strict classification negative controls');
}

function readAsset(relative) {
  assert.equal(typeof relative, 'string', 'Asset path is missing');
  assert(relative.length > 0 && !path.isAbsolute(relative), 'Expected relative asset path');
  const absolute = path.resolve(root, relative);
  const resolved = path.relative(root, fs.realpathSync(absolute));
  assert(!resolved.startsWith('..') && !path.isAbsolute(resolved), 'Asset escapes workspace');
  assert(fs.statSync(absolute).isFile(), `${relative}: not a file`);
  const data = fs.readFileSync(absolute);
  assert(data.length > 0, `${relative}: empty asset`);
  return data;
}

function checkSharedRoster(source, moonCharacters) {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }
  });
  vm.runInContext(source, context, { timeout: 1000, filename: 'sprunki-roster.js' });
  const shared = vm.runInContext('globalThis.SprunkiRoster', context, { timeout: 1000 });
  assert(shared && Array.isArray(shared.characters), 'Missing SprunkiRoster.characters array');
  assert.equal(createHash('sha256').update(JSON.stringify(shared.characters)).digest('hex'),
    '005bc96e14506a2eb2e5a55ca73fca4e190cd3773fd7120ad448cca745c5afc6', 'Original twenty records changed');
  assert.equal(shared.characters.length, moonCharacters.length, 'Shared roster count differs from moon');
  const fields = ['id', 'name', 'file', 'audio', 'color', 'music'];
  for (const [index, character] of moonCharacters.entries()) {
    for (const field of fields) {
      assert.equal(shared.characters[index][field], character[field],
        `Shared roster index ${index} (${character.id}) differs in ${field}`);
    }
  }
  return { count: shared.characters.length, fields, orderMatches: true };
}

function checkPng(data) {
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Not PNG content');
  assert(data.length >= 45, 'Truncated PNG');
  assert.equal(data.toString('ascii', 12, 16), 'IHDR', 'Missing PNG IHDR');
  assert(data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0, 'Empty PNG dimensions');
  assert.equal(data.subarray(-12).toString('hex'), '0000000049454e44ae426082', 'Missing PNG IEND');
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

function checkAudio(data, extension) {
  if (extension === '.wav') {
    assert(data.length >= 44, 'Truncated WAV');
    assert.equal(data.toString('ascii', 0, 4), 'RIFF', 'Not RIFF content');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE', 'Not WAVE content');
    assert.equal(data.readUInt32LE(4) + 8, data.length, 'RIFF size mismatch');
    let format = false, samples = false;
    for (let offset = 12; offset < data.length;) {
      assert(offset + 8 <= data.length, 'Truncated WAV chunk header');
      const size = data.readUInt32LE(offset + 4);
      const end = offset + 8 + size;
      assert(end <= data.length, 'Truncated WAV chunk');
      const type = data.toString('ascii', offset, offset + 4);
      if (type === 'fmt ') {
        assert(size >= 16, 'Invalid WAV format chunk');
        assert(data.readUInt16LE(offset + 10) > 0, 'No WAV channels');
        assert(data.readUInt32LE(offset + 12) > 0, 'No WAV sample rate');
        format = true;
      }
      if (type === 'data' && size > 0) samples = true;
      offset = end + (size % 2);
    }
    assert(format && samples, 'Missing WAV format or nonempty sample data');
    return 'RIFF/WAVE';
  }
  assert.equal(extension, '.mp3', 'Unexpected audio extension');
  let offset = 0;
  if (data.toString('ascii', 0, 3) === 'ID3') {
    assert(data.length >= 10, 'Truncated ID3 header');
    const sizes = [...data.subarray(6, 10)];
    assert(sizes.every(n => n < 128), 'Invalid ID3 synchsafe size');
    offset = 10 + sizes.reduce((size, n) => size * 128 + n, 0);
    if (data[3] === 4 && (data[5] & 16)) offset += 10;
  }
  assert(offset + 4 < data.length, 'No MP3 audio after metadata');
  assert(data[offset] === 255 && (data[offset + 1] & 224) === 224, 'Missing MPEG audio frame');
  assert((data[offset + 1] & 24) !== 8 && (data[offset + 1] & 6) !== 0, 'Invalid MPEG version/layer');
  assert((data[offset + 2] >> 4) > 0 && (data[offset + 2] >> 4) < 15, 'Invalid MPEG bitrate');
  assert((data[offset + 2] & 12) !== 12, 'Invalid MPEG sample rate');
  return 'MPEG audio frame (signature only)';
}

function optionalSharp() {
  try {
    return require(process.env.SPRUNKI_AUDIT_SHARP || 'sharp');
  } catch (error) {
    if (process.env.SPRUNKI_AUDIT_SHARP || error.code !== 'MODULE_NOT_FOUND') throw error;
    try { return require(path.join(runtime, 'node_modules/sharp')); }
    catch (fallback) { if (fallback.code !== 'MODULE_NOT_FOUND') throw fallback; return null; }
  }
}

async function main() {
  const source = fs.readFileSync(path.join(root, 'moon-phase-game.html'), 'utf8');
  const rosterSource = fs.readFileSync(path.join(root, 'sprunki-roster.js'), 'utf8');
  parserChecks(source, rosterSource);
  const characters = extractCharacters(source, rosterSource);
  const { canonical: rasterCharacters, extras } = classifyCharacters(characters);
  console.log(`Roster: ${characters.length} unique IDs; 20 canonical image/audio pairs; 15 additional images.`);
  const sharedRoster = checkSharedRoster(rosterSource, rasterCharacters);
  console.log(`Shared roster: ${sharedRoster.count} entries match moon in order and ${sharedRoster.fields.join('/')}.`);

  const failures = [], warnings = [], rows = [], extraRows = [], hashes = new Map(), composites = [];
  const sharp = optionalSharp();
  for (const [index, character] of rasterCharacters.entries()) {
    const row = { id: character.id, image: character.file, audio: character.audio };
    for (const kind of ['file', 'audio']) {
      try {
        const data = readAsset(character[kind]);
        const digest = createHash('sha256').update(data).digest('hex');
        const hashKey = `${kind}:${digest}`;
        if (hashes.has(hashKey)) warnings.push(`${character.id}: identical ${kind} content to ${hashes.get(hashKey)}`);
        hashes.set(hashKey, character.id);
        row[`${kind}Sha256`] = digest;
        row[`${kind}Bytes`] = data.length;
        if (kind === 'file') {
          assert.equal(path.extname(character.file).toLowerCase(), '.png');
          row.dimensions = checkPng(data);
          if (sharp) {
            // Decode all source pixels before making audit-only thumbnails.
            await sharp(data, { failOn: 'warning' }).raw().toBuffer();
            const input = await sharp(data).resize(200, 180, { fit: 'contain', background: '#eeeeee' }).png().toBuffer();
            const left = (index % 5) * 220 + 10, top = Math.floor(index / 5) * 220 + 8;
            composites.push({ input, left, top });
            const label = await sharp({ text: { text: `${index + 1}. ${character.id}`, font: 'sans 16', rgba: true } }).png().toBuffer();
            composites.push({ input: label, left, top: top + 187 });
          }
        } else {
          row.audioSignature = checkAudio(data, path.extname(character.audio).toLowerCase());
        }
      } catch (error) {
        failures.push(`${character.id} ${kind}: ${error.message}`);
      }
    }
    rows.push(row);
    console.log(`${character.id}: ${row.dimensions || 'IMAGE FAIL'}; ${row.audioSignature || 'AUDIO FAIL'}`);
  }
  for (const character of extras) {
    const row = { id: character.id, image: character.file, audio: character.audio || null };
    try {
      if (anpanIds.includes(character.id)) {
        const audio = readAsset(character.audio);
        row.audioSignature = checkAudio(audio, '.wav');
        row.audioSha256 = createHash('sha256').update(audio).digest('hex');
        row.audioBytes = audio.length;
        assert(!hashes.has(`audio:${row.audioSha256}`), character.id + ': generated audio must be distinct');
        hashes.set(`audio:${row.audioSha256}`, character.id);
        const { readPack } = require('./audio-assets-check.cjs');
        const { readWav } = require('../tools/build-audio-assets.cjs');
        const pack = readPack(character.id);
        assert.equal(pack.type, 'audio/wav'); assert.equal(pack.loopable, true);
        assert.equal(pack.provenance, 'game-original'); assert.equal(pack.gain, .26);
        const decoded = readWav(audio);
        assert.equal(decoded.rate, 48000); assert.equal(decoded.data.length, 2);
        assert(decoded.data.every(channel => channel.length === 230400));
        assert(Buffer.from(pack.data, 'base64').equals(audio), character.id + ': pack preserves generated source bytes');
      } else assert(!fs.existsSync(path.join(root, 'sounds/packed', character.id + '.js')), character.id + ': unexpected MOD audio pack');
      const data = readAsset(character.file);
      row.dimensions = checkPng(data);
      row.fileSha256 = createHash('sha256').update(data).digest('hex');
      row.fileBytes = data.length;
      assert(sharp, 'sharp required to verify additional image pixels/alpha');
      const { data: pixels, info } = await sharp(data, { failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert(info.width >= 256 && info.height >= 256, 'Image below 256px');
      let transparent = 0, visible = 0, left = info.width, top = info.height, right = -1, bottom = -1;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const alpha = pixels[(y * info.width + x) * info.channels + info.channels - 1];
        if (alpha < 8) transparent++;
        if (alpha > 32) { visible++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      }
      row.transparent = transparent / (info.width * info.height);
      row.bounds = { left, top, right, bottom };
      assert(row.transparent > .15 && visible / (info.width * info.height) > .08, 'Expected nonempty sprite with real alpha');
      assert(left > 1 && top > 1 && right < info.width - 2 && bottom < info.height - 2, 'Sprite touches image edge');
      console.log(`${character.id}: ${row.dimensions}; alpha verified; ${row.audioSignature || 'silent MOD'}`);
    } catch (error) { failures.push(`${character.id} file: ${error.message}`); }
    extraRows.push(row);
  }
  const output = path.join(root, 'output', 'sprunki-asset-audit');
  fs.mkdirSync(output, { recursive: true });
  if (sharp) {
    const sheet = path.join(output, 'contact-sheet.png');
    await sharp({ create: { width: 1100, height: 880, channels: 4, background: '#ffffff' } })
      .composite(composites).png().toFile(sheet);
    console.log(`Contact sheet: ${sheet}`);
  } else {
    warnings.push('sharp unavailable: raster decode/contact sheet skipped; set NODE_PATH or SPRUNKI_AUDIT_SHARP to an installed package');
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({
    source: 'moon-phase-game.html', rosterCount: characters.length, sharedRoster,
    additionalImageIds: extras.map(character => character.id),
    rasterDecode: sharp ? 'performed; see failures' : 'skipped',
    visualIdentity: 'Requires human inspection; signatures do not establish character identity or audio authenticity',
    rows, extraRows, warnings, failures
  }, null, 2) + '\n');
  warnings.forEach(message => console.warn(`WARN: ${message}`));
  failures.forEach(message => console.error(`FAIL: ${message}`));
  console.log(`${failures.length ? 'FAIL' : 'PASS'}: 20 canonical image/audio pairs + 10 generated original audio/image pairs + 5 silent MOD images; ${failures.length} failures; ${warnings.length} warnings.`);
  process.exitCode = failures.length ? 1 : 0;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { extractCharacters, classifyCharacters, parserChecks, checkSharedRoster, checkPng, checkAudio };
