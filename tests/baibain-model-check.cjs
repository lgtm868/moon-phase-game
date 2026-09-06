'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const model = require('../baibain-model.js');
const { snapshot, DEFAULTS } = model;
const close = (actual, expected, label) => assert.ok(Math.abs(actual / expected - 1) < 1e-12, `${label}: ${actual} vs ${expected}`);

// The fiction defines discrete five-minute doublings, never continuous growth.
for (const [time, generation] of [[-1, 0], [0, 0], [299.999, 0], [300, 1], [300.001, 1], [599.999, 1], [600, 2], [3600, 12], [86400, 288], [1e9, 288]]) {
  const state = snapshot(time);
  assert.equal(state.generations, generation, `generation at ${time}`);
  assert.equal(state.count, 1n << BigInt(generation));
}
assert.equal(snapshot(NaN).count, 1n);
assert.equal(snapshot(-Infinity).count, 1n);
assert.equal(snapshot(Infinity).generations, 288);
assert.equal(snapshot('300').count, 1n);
assert.equal(snapshot(300).nextIn, 300);
close(snapshot(299.5).nextIn, 0.5, 'time to next doubling');
assert.equal(snapshot(86400).seconds, 86400);
assert.equal(snapshot(86401).seconds, 86400);

const one = snapshot(0);
close(one.solidVolume, Math.PI * .05 * .04 * .035 / 6, 'ellipsoid volume');
close(one.massKg, .05, 'one bun mass');
for (let n = 0; n <= 288; n++) {
  const current = snapshot(n * 300);
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `finite ${key} at generation ${n}`);
  }
  close(current.bulkVolume * DEFAULTS.packing, current.solidVolume, 'packing conservation');
  close(Math.PI * current.pileRadius ** 2 * current.pileHeight / 3, current.bulkVolume, 'cone volume');
  close(current.pileHeight / current.pileRadius, Math.tan(model.REPOSE_ANGLE), 'repose slope');
  close(4 * Math.PI * current.equivalentRadius ** 3 / 3, current.solidVolume, 'solid-equivalent sphere');
  close(current.earthMassRatio * model.EARTH_MASS, current.massKg, 'Earth mass reference');
  close(current.earthVolumeRatio * model.EARTH_VOLUME, current.solidVolume, 'Earth volume reference');
  if (n > 0) {
    const previous = snapshot((n - 1) * 300);
    close(current.massKg / previous.massKg, 2, 'doubling mass');
    close(current.pileRadius / previous.pileRadius, Math.cbrt(2), 'length cube scaling');
  }
  for (const text of [model.formatCount(current.count), model.formatMass(current.massKg), model.formatLength(current.pileRadius), model.formatCosmicLength(current.equivalentRadius * 2)]) {
    assert.ok(!/NaN|Infinity|undefined/.test(text), `format at ${n}: ${text}`);
  }
}
assert.equal(snapshot(3600).count, 4096n);
assert.equal(snapshot(24 * 3600).count.toString(), (2n ** 288n).toString());
assert.equal(snapshot(24 * 3600).count.toString().length, 87);
const changed = snapshot(0, { width: .1, mass: .1, packing: .32 });
close(changed.solidVolume / one.solidVolume, 2, 'dimension option');
close(changed.massKg / one.massKg, 2, 'mass option');
close(changed.bulkVolume / one.bulkVolume, 4, 'packing option');
assert.deepEqual(snapshot(0, { width: NaN, height: Infinity, mass: -1, packing: 0 }), one);
assert.deepEqual(snapshot(0, null), one);
assert.equal(snapshot(300, { interval: .0001, maxTime: 1e300 }).count, 2n, 'fiction timing cannot be overridden');
for (const options of [{}, { width: .01, depth: .02, height: .02, mass: .01 }, { width: .1, depth: .1, height: .05, packing: .5 }]) {
  const metrics = { plate: ['pileRadius', .15], table: ['pileRadius', .75], room: ['bulkVolume', 30], city: ['pileRadius', 1000], 'earth-volume': ['earthVolumeRatio', 1], 'earth-mass': ['earthMassRatio', 1] };
  for (const reference of model.SPACE_REFERENCES.slice(1)) metrics[reference.id + '-diameter'] = ['equivalentRadius', reference.diameter / 2];
  const entries = model.milestones(options);
  assert.equal(entries.length, 10);
  for (const entry of entries) {
    const [metric, threshold] = metrics[entry.id];
    if (entry.seconds === null) {
      assert.ok(snapshot(DEFAULTS.maxTime, options)[metric] < threshold, `${entry.id} genuinely outside time range`);
      continue;
    }
    assert.equal(entry.seconds % 300, 0);
    assert.ok(snapshot(entry.seconds, options)[metric] >= threshold, `${entry.id} reaches threshold`);
    assert.ok(entry.seconds === 0 || snapshot(entry.seconds - 300, options)[metric] < threshold, `${entry.id} is earliest doubling`);
  }
}
assert.equal(model.formatCount(4096n), '4,096');
assert.ok(model.formatCount(2n ** 288n).endsWith('10^86'));
assert.equal(model.formatCount(2n ** 80n), '約1.21 × 10^24');
assert.equal(model.formatCount(999999999999999999999n), '約1.00 × 10^21');
assert.equal(model.formatCount(100500000000000000000n), '約1.01 × 10^20');
assert.equal(model.formatTime(3661), '1時間1分1秒');
assert.equal(model.formatTime(0), '0秒');
assert.equal(model.formatLength(.05), '5 cm');
assert.equal(model.formatMass(.05), '50 g');
assert.equal(model.LIGHT_YEAR, 9460730472580800);
assert.equal(model.formatCosmicLength(model.AU), '1 AU');
assert.equal(model.formatCosmicLength(model.LIGHT_YEAR), '1 光年');
assert.equal(model.formatCosmicLength(1e5 * model.LIGHT_YEAR), '10 万光年');
assert.equal(model.formatCosmicLength(92e9 * model.LIGHT_YEAR), '920 億光年');
assert.equal(model.formatCosmicLength(Infinity), '—');
assert.equal(model.spaceReference(snapshot(0)).id, 'earth');
assert.equal(model.spaceReference(null).id, 'earth');
assert.equal(model.spaceReference(snapshot(86400)).id, 'observable-universe');
const expectedCosmicTimes = { 'sun-diameter': 31500, 'solar-system-diameter': 42900, 'milky-way-diameter': 66900, 'observable-universe-diameter': 84900 };
for (const [id, seconds] of Object.entries(expectedCosmicTimes)) {
  assert.equal(model.milestones().find(entry => entry.id === id).seconds, seconds, `${id} documented default time`);
}
assert.ok(Object.isFrozen(model.SPACE_REFERENCES));
for (let i = 0; i < model.SPACE_REFERENCES.length; i++) {
  const reference = model.SPACE_REFERENCES[i];
  assert.ok(Object.isFrozen(reference));
  assert.ok(reference.diameter > 0 && ['body', 'extent'].includes(reference.kind));
  assert.equal(model.spaceReference({ equivalentRadius: reference.diameter / 2 }).id, reference.id, `${reference.id} exact threshold`);
  if (i > 0) {
    const previous = model.SPACE_REFERENCES[i - 1];
    assert.ok(reference.diameter > previous.diameter);
    assert.equal(model.spaceReference({ equivalentRadius: reference.diameter / 2 * (1 - 1e-12) }).id, previous.id, `${reference.id} cannot appear before reached`);
    const milestone = model.milestones().find(entry => entry.id === reference.id + '-diameter');
    assert.equal(model.spaceReference(snapshot(milestone.seconds)).id, reference.id);
    assert.equal(model.spaceReference(snapshot(milestone.seconds - .001)).id, previous.id);
  }
}

// The same implementation must load directly in the static browser page.
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../baibain-model.js'), 'utf8'), context);
assert.equal(context.BaibainModel.snapshot(600).count, 4n);
assert.ok(Object.isFrozen(model.DEFAULTS));
console.log('Baibain model: discrete boundaries, 289 generations, volume/mass conservation, 10 milestones, cosmic references and lengths, invalid inputs and browser export passed.');
