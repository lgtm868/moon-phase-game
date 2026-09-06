(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BaibainModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // SI units. Bun dimensions, mass, packing and repose angle are assumptions,
  // not measured properties of the fictional food. No crushing or gravity model.
  // Story timing: https://www.tv-asahi.co.jp/doraemon/story/0135/
  const DEFAULTS = Object.freeze({
    width: 0.05, depth: 0.04, height: 0.035, mass: 0.05,
    packing: 0.64, interval: 300, maxTime: 86400
  });
  // NASA/JPL Earth mean radius and mass, rounded: https://ssd.jpl.nasa.gov/planets/phys_par.html
  const EARTH_RADIUS = 6371000;
  const EARTH_MASS = 5.9722e24;
  const EARTH_VOLUME = 4 * Math.PI * Math.pow(EARTH_RADIUS, 3) / 3;
  const REPOSE_ANGLE = 32 * Math.PI / 180;
  const SLOPE = Math.tan(REPOSE_ANGLE);
  const LIGHT_YEAR = 299792458 * 31557600;
  const AU = 149597870700;
  // Extents are comparison widths, not solid bodies or predictions of filling space.
  const SPACE_REFERENCES = Object.freeze([
    { id: 'earth', label: '地球', diameter: EARTH_RADIUS * 2, kind: 'body',
      description: '地球の平均直径。まんじゅう本体と同じ体積の球の直径を比較します。',
      sourceUrl: 'https://ssd.jpl.nasa.gov/planets/phys_par.html' },
    { id: 'sun', label: '太陽', diameter: 1.4e9, kind: 'body',
      description: '太陽の直径を約140万 kmとして比較。太陽の質量・密度になるという意味ではありません。',
      sourceUrl: 'https://www.nasa.gov/learning-resources/how-does-the-sun-behave-grades-5-8/' },
    { id: 'solar-system', label: '海王星の軌道', diameter: 9e12, kind: 'extent',
      description: '太陽から海王星までの平均距離約45億 kmの2倍。海王星軌道の直径で、太陽系全体の境界ではありません。',
      sourceUrl: 'https://science.nasa.gov/neptune/neptune-facts/' },
    { id: 'milky-way', label: '天の川銀河', diameter: 100000 * LIGHT_YEAR, kind: 'extent',
      description: '天の川銀河の幅を約10万光年として比較。銀河の物質を詰めた球や、銀河を埋める予測ではありません。',
      sourceUrl: 'https://www.nasa.gov/science-research/astrophysics/how-big-is-space-we-asked-a-nasa-expert-episode-61/' },
    { id: 'observable-universe', label: '観測可能な宇宙', diameter: 92e9 * LIGHT_YEAR, kind: 'extent',
      description: '観測可能な領域の現在の直径を約920億光年として比較。宇宙全体の大きさや、宇宙が埋まる時刻を表しません。',
      sourceUrl: 'https://www.nasa.gov/science-research/astrophysics/how-big-is-space-we-asked-a-nasa-expert-episode-61/' }
  ].map(Object.freeze));

  function spaceReference(state) {
    const diameter = state && Number.isFinite(state.equivalentRadius) ? 2 * state.equivalentRadius : 0;
    let selected = SPACE_REFERENCES[0];
    for (const reference of SPACE_REFERENCES) {
      if (diameter >= reference.diameter) selected = reference;
      else break;
    }
    return selected;
  }

  function parameters(options) {
    const source = options && typeof options === 'object' ? options : {};
    const out = {};
    for (const key of ['width', 'depth', 'height', 'mass']) {
      // Keep the complete 24-hour calculation finite even for malformed inputs.
      out[key] = Number.isFinite(source[key]) && source[key] >= 1e-9 && source[key] <= 1e9
        ? source[key] : DEFAULTS[key];
    }
    out.packing = Number.isFinite(source.packing) && source.packing >= 0.01 && source.packing <= 1
      ? source.packing : DEFAULTS.packing;
    return out;
  }

  function clampTime(seconds) {
    if (seconds === Infinity) return DEFAULTS.maxTime;
    if (!Number.isFinite(seconds)) return 0;
    return Math.min(DEFAULTS.maxTime, Math.max(0, seconds));
  }

  function snapshot(seconds, options) {
    const p = parameters(options);
    const time = clampTime(seconds);
    const generations = Math.floor(time / DEFAULTS.interval);
    const count = 1n << BigInt(generations);
    const numericCount = Math.pow(2, generations);
    const solidVolume = numericCount * Math.PI * p.width * p.depth * p.height / 6;
    const bulkVolume = solidVolume / p.packing;
    // V = pi r²h/3, h = r tan(theta). Valid only as an idealized loose pile.
    const pileRadius = Math.cbrt(3 * bulkVolume / (Math.PI * SLOPE));
    const massKg = numericCount * p.mass;
    return {
      seconds: time,
      generations,
      count,
      log10Count: generations * Math.LOG10E * Math.LN2,
      massKg,
      solidVolume,
      bulkVolume,
      pileRadius,
      pileHeight: pileRadius * SLOPE,
      equivalentRadius: Math.cbrt(3 * solidVolume / (4 * Math.PI)),
      earthVolumeRatio: solidVolume / EARTH_VOLUME,
      earthMassRatio: massKg / EARTH_MASS,
      // At an exact doubling the next doubling is a full interval away.
      nextIn: DEFAULTS.interval - time % DEFAULTS.interval
    };
  }

  function concise(value) {
    return Number(value.toPrecision(3)).toLocaleString('ja-JP', { maximumSignificantDigits: 3 });
  }

  function formatCount(count) {
    if (typeof count !== 'bigint') {
      if (!Number.isFinite(count) || count < 0) return '—';
      count = BigInt(Math.floor(count));
    }
    if (count < 0n) return '—';
    if (count < 10000n) return count.toLocaleString('ja-JP');
    const units = [[10000000000000000n, '京'], [1000000000000n, '兆'], [100000000n, '億'], [10000n, '万']];
    if (count < 100000000000000000000n) {
      for (const [size, unit] of units) {
        if (count >= size) return '約' + concise(Number(count) / Number(size)) + unit;
      }
    }
    // Use the decimal string so no integer precision is lost to Number conversion.
    const digits = count.toString();
    let exponent = digits.length - 1;
    // Round to three significant digits using only the leading four digits.
    const roundedLeading = Math.floor((Number(digits.slice(0, 4)) + 5) / 10);
    let mantissa = (roundedLeading / 100).toFixed(2);
    if (roundedLeading >= 1000) { mantissa = '1.00'; exponent++; }
    return '約' + mantissa + ' × 10^' + exponent;
  }

  function formatMass(kg) {
    if (!Number.isFinite(kg) || kg < 0) return '—';
    if (kg < 1) return concise(kg * 1000) + ' g';
    if (kg < 1000) return concise(kg) + ' kg';
    if (kg < 1e12) return concise(kg / 1000) + ' t';
    return kg.toExponential(2).replace('e+', ' × 10^') + ' kg';
  }

  function formatLength(m) {
    if (!Number.isFinite(m) || m < 0) return '—';
    if (m < 0.01) return concise(m * 1000) + ' mm';
    if (m < 1) return concise(m * 100) + ' cm';
    if (m < 1000) return concise(m) + ' m';
    if (m < 1e12) return concise(m / 1000) + ' km';
    return (m / 1000).toExponential(2).replace('e+', ' × 10^') + ' km';
  }

  function formatCosmicLength(m) {
    if (!Number.isFinite(m) || m < 0) return '—';
    if (m < AU) return formatLength(m);
    if (m < LIGHT_YEAR) return concise(m / AU) + ' AU';
    const ly = m / LIGHT_YEAR;
    if (ly < 10000) return concise(ly) + ' 光年';
    if (ly < 1e8) return concise(ly / 10000) + ' 万光年';
    if (ly < 1e12) return concise(ly / 1e8) + ' 億光年';
    return concise(ly / 1e12) + ' 兆光年';
  }

  function formatTime(seconds) {
    const whole = Math.floor(clampTime(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor(whole % 3600 / 60);
    const sec = whole % 60;
    return (hours ? hours + '時間' : '') + (minutes || hours ? minutes + '分' : '') + sec + '秒';
  }

  function milestones(options) {
    const initial = snapshot(0, options);
    const targets = [
      { id: 'plate', label: 'お皿の幅', metric: 'pileRadius', threshold: 0.15,
        description: '仮の円すいの山の直径が30 cm以上。お皿の縁や個々の形は計算しません。' },
      { id: 'table', label: 'テーブルの幅', metric: 'pileRadius', threshold: 0.75,
        description: '仮の円すいの山の直径が1.5 m以上。テーブルから落ちる動きは含みません。' },
      { id: 'room', label: '部屋の容積', metric: 'bulkVolume', threshold: 30,
        description: 'すき間込みの容積が、3 m × 4 m × 高さ2.5 mの部屋と同じ30 m³以上。' },
      { id: 'city', label: '街の幅', metric: 'pileRadius', threshold: 1000,
        description: '仮の円すいの山の直径が2 km以上。圧縮・建物・地形・地球の曲率は無視した規模比較です。' },
      { id: 'earth-volume', label: '地球の体積', metric: 'earthVolumeRatio', threshold: 1,
        description: 'まんじゅう本体の体積の合計が地球の体積以上。すき間を含まず、破壊を予測する時刻ではありません。' },
      { id: 'earth-mass', label: '地球の質量', metric: 'earthMassRatio', threshold: 1,
        description: '質量の単純な合計が地球の質量以上。重力・圧縮・熱・相対論は計算していません。' }
    ];
    for (const reference of SPACE_REFERENCES.slice(1)) {
      targets.push({ id: reference.id + '-diameter', label: reference.label,
        metric: 'equivalentRadius', threshold: reference.diameter / 2,
        description: 'まんじゅう本体と同じ体積の球の直径が、この比較対象の幅以上。' + reference.description });
    }
    return targets.map(target => {
      // Length grows by 2^(n/3), volumes and mass by 2^n.
      const exponent = ['pileRadius', 'equivalentRadius'].includes(target.metric) ? 3 : 1;
      let generation = Math.max(0, Math.ceil(exponent * Math.log2(target.threshold / initial[target.metric])));
      // Correct roundoff if a target falls exactly on a doubling boundary.
      while (generation > 0 && snapshot((generation - 1) * DEFAULTS.interval, options)[target.metric] >= target.threshold) generation--;
      while (generation <= DEFAULTS.maxTime / DEFAULTS.interval && snapshot(generation * DEFAULTS.interval, options)[target.metric] < target.threshold) generation++;
      return {
        id: target.id, label: target.label,
        seconds: generation <= DEFAULTS.maxTime / DEFAULTS.interval ? generation * DEFAULTS.interval : null,
        description: target.description
      };
    });
  }

  return Object.freeze({ DEFAULTS, EARTH_RADIUS, EARTH_MASS, EARTH_VOLUME, REPOSE_ANGLE, LIGHT_YEAR, AU, SPACE_REFERENCES,
    snapshot, spaceReference, formatCount, formatMass, formatLength, formatCosmicLength, formatTime, milestones });
});
