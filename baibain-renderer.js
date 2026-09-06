/* Offline Canvas illustration. Pile geometry is a volume comparison, not a dynamics solver. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const mix = (a, b, t) => a + (b - a) * t;
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const scientific = n => {
    const [value, exponent] = n.toExponential(1).split('e+');
    return `${Number(value)} × 10${exponent.replace(/[0-9]/g, digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)])}`;
  };
  const measure = m => m >= 1e15 ? `${scientific(m / 1000)} km` : m >= 1e9 ? `${(m / 1e9).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} 百万 km` : m >= 1000 ? `${(m / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} km` : m >= 1 ? `${m.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} m` : `${(m * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} cm`;

  class BaibainScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.sprites = Array.from({ length: 5 }, (_, i) => this.makeBun(i));
      this.lastCount = null;
      this.newFrom = 0;
      this.burstTime = -100;
      this.cameraWidth = null;
      this.width = 0;
      this.height = 0;
      this.destroyed = false;
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.canvas.width !== Math.round(this.width * dpr) || this.canvas.height !== Math.round(this.height * dpr)) {
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
      }
      this.dpr = dpr;
    }

    makeBun(variant) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 192;
      const c = canvas.getContext('2d');
      c.save();
      c.translate(128, 89);
      // Thin irregular cream skirt, darker where the bun touches the surface.
      const base = c.createLinearGradient(0, 9, 0, 72);
      base.addColorStop(0, '#f8d69e');
      base.addColorStop(.65, '#e9bc79');
      base.addColorStop(1, '#a66531');
      c.fillStyle = base;
      c.beginPath();
      c.moveTo(-101, 18);
      c.bezierCurveTo(-112, 49, -89, 70, -48, 75);
      c.bezierCurveTo(8, 87, 81, 70, 98, 45);
      c.bezierCurveTo(111, 30, 106, 15, 99, 8);
      c.closePath();
      c.fill();
      const dome = new Path2D();
      dome.moveTo(-103, 23);
      dome.bezierCurveTo(-102, -29, -74, -69, -22, -75);
      dome.bezierCurveTo(24, -85, 81, -57, 100, -15);
      dome.bezierCurveTo(116, 18, 106, 47, 64, 56);
      dome.bezierCurveTo(13, 70, -73, 66, -99, 41);
      dome.closePath();
      const skin = c.createRadialGradient(-35, -40, 5, 14, 8, 122);
      skin.addColorStop(0, ['#ce8b3e', '#d39243', '#cc8538', '#d79649', '#c78037'][variant]);
      skin.addColorStop(.32, '#b86b28');
      skin.addColorStop(.7, '#88431c');
      skin.addColorStop(.92, '#532810');
      skin.addColorStop(1, '#422110');
      c.fillStyle = skin;
      c.fill(dome);
      c.save();
      c.clip(dome);
      // Baked speckling is seeded, so no shimmer while the camera moves.
      for (let i = 0; i < 650; i++) {
        const x = hash(i * 3 + variant * 993) * 220 - 110;
        const y = hash(i * 3 + 1 + variant * 993) * 165 - 82;
        const r = .4 + hash(i * 3 + 2) * 2.2;
        c.fillStyle = i % 3 ? 'rgba(62,24,5,.075)' : 'rgba(255,220,144,.105)';
        c.beginPath(); c.ellipse(x, y, r * 1.5, r, -.25, 0, TAU); c.fill();
      }
      const sheen = c.createRadialGradient(-38, -44, 1, -28, -36, 74);
      sheen.addColorStop(0, 'rgba(255,235,173,.55)');
      sheen.addColorStop(.27, 'rgba(255,213,128,.18)');
      sheen.addColorStop(.65, 'rgba(255,222,158,.03)');
      sheen.addColorStop(1, 'rgba(255,220,160,0)');
      c.fillStyle = sheen;
      c.fillRect(-120, -90, 250, 180);
      c.strokeStyle = 'rgba(255,227,170,.22)';
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(-30, -35, 47, 25, -.2, 3.7, 5.4); c.stroke();
      c.restore();
      c.strokeStyle = 'rgba(51,22,8,.18)'; c.lineWidth = 1; c.stroke(dome);
      c.restore();
      return canvas;
    }

    render(snapshot, options = {}) {
      if (this.destroyed) return;
      this.resize();
      const c = this.ctx, w = this.width, h = this.height;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const time = Number(options.time) || 0;
      const dt = clamp(Number(options.dt) || 1 / 60, 0, .15);
      const count = snapshot.count || 1n;
      if (count !== this.lastCount) {
        this.newFrom = this.lastCount === null ? 1 : Number(this.lastCount > 256n ? 256n : this.lastCount);
        this.burstTime = time;
        this.lastCount = count;
      }
      const radius = Math.max(.025, Number(snapshot.pileRadius) || .025);
      const equivalentRadius = Math.max(.02, Number(snapshot.equivalentRadius) || radius * .6);
      const jumped = this.lastGeneration !== undefined && Math.abs(Number(snapshot.generations) - this.lastGeneration) > 1;
      this.lastGeneration = Number(snapshot.generations);
      const naturalWidth = Math.max(.36, radius * (w < h ? 3.5 : 3.2));
      let targetWidth = options.view === 'close' ? .7 : options.view === 'wide' ? Math.max(30, naturalWidth) : naturalWidth;
      targetWidth = Math.min(targetWidth, 1e20);
      if (!this.cameraWidth || options.reducedMotion || options.snapCamera || jumped) this.cameraWidth = targetWidth;
      else this.cameraWidth = Math.exp(mix(Math.log(this.cameraWidth), Math.log(targetWidth), 1 - Math.exp(-dt * 6)));
      const cameraSettled = Math.abs(Math.log(this.cameraWidth / targetWidth)) < .0001;
      if (cameraSettled) this.cameraWidth = targetWidth;
      const animating = !options.reducedMotion && count <= 256n && time - this.burstTime < 1.2;
      const frameKey = [String(count), options.view, options.referenceId || 'auto', w, h, this.dpr, targetWidth, radius, snapshot.pileHeight, equivalentRadius, !!options.reducedMotion].join('|');
      // Still life scenes need no redraw once the camera and new buns have settled.
      // A size/view/physical-state change always invalidates the retained pixels.
      if (this.frameStable && this.frameKey === frameKey && cameraSettled && !animating) return;
      const explicitReference = options.view !== 'close' && options.referenceId && options.referenceId !== 'auto' &&
        window.BaibainModel?.SPACE_REFERENCES?.some(reference => reference.id === options.referenceId);
      this.referenceId = null;
      let worldWidth = this.cameraWidth;
      if (options.view === 'close' && radius > 1) {
        this.mode = 'surface';
        worldWidth = this.cameraWidth = .7;
        this.closeSurface(c, w, h, worldWidth);
      }
      else if ((worldWidth > 1e6 && options.view !== 'close') || explicitReference) {
        this.mode = 'space';
        this.space(c, w, h, equivalentRadius, snapshot, worldWidth, options);
      }
      else if (worldWidth > 2.2) {
        this.mode = 'landscape';
        this.landscape(c, w, h, snapshot, worldWidth, time, options);
      }
      else {
        this.mode = 'tabletop';
        this.tabletop(c, w, h, snapshot, worldWidth, time, options);
      }
      // Subtle lens shading grounds both the interior and landscape lighting.
      const vignette = c.createRadialGradient(w * .48, h * .4, Math.min(w, h) * .15, w * .5, h * .5, Math.max(w, h) * .73);
      vignette.addColorStop(0, 'rgba(5,10,15,0)'); vignette.addColorStop(1, 'rgba(5,10,15,.26)');
      c.fillStyle = vignette; c.fillRect(0, 0, w, h);
      this.scale(c, w, h, worldWidth, this.mode === 'space');
      this.frameKey = frameKey;
      this.frameStable = cameraSettled && !animating;
    }

    tabletop(c, w, h, s, worldWidth, time, options) {
      const horizon = h * .29;
      const wall = c.createLinearGradient(0, 0, 0, horizon + 50);
      wall.addColorStop(0, '#25363b'); wall.addColorStop(1, '#61716d');
      c.fillStyle = wall; c.fillRect(0, 0, w, h);
      // Blurred light from a real-size window, with a warm plaster reveal.
      c.fillStyle = '#a2b1a5'; c.fillRect(w * .08, -20, w * .2, horizon * .85);
      const light = c.createLinearGradient(0, 0, 0, horizon);
      light.addColorStop(0, '#f6edcf'); light.addColorStop(1, '#b4c9bc');
      c.fillStyle = light; c.fillRect(w * .085, 0, w * .19, horizon * .75);
      c.fillStyle = '#859289'; c.fillRect(w * .18, 0, 5, horizon * .8);
      c.fillRect(w * .085, horizon * .4, w * .19, 5);
      c.fillStyle = 'rgba(14,32,33,.28)'; c.fillRect(0, horizon - 6, w, 12);
      const wood = c.createLinearGradient(0, horizon, w * .8, h);
      wood.addColorStop(0, '#a88155'); wood.addColorStop(.4, '#bb9361'); wood.addColorStop(1, '#765038');
      c.fillStyle = wood; c.fillRect(0, horizon, w, h - horizon);
      c.save(); c.beginPath(); c.rect(0, horizon, w, h - horizon); c.clip();
      // Long perspective grain and joint lines keep a coherent surface beneath the buns.
      for (let i = 0; i < 85; i++) {
        const x = (i / 84) * w * 1.9 - w * .45;
        c.strokeStyle = i % 13 === 0 ? 'rgba(51,29,15,.20)' : `rgba(70,42,21,${.026 + hash(i) * .04})`;
        c.lineWidth = i % 13 === 0 ? 1.6 : .6;
        c.beginPath(); c.moveTo(w * .48 + (x - w * .48) * .57, horizon);
        c.bezierCurveTo(x * .8, h * .6, x + Math.sin(i) * 5, h * .8, x, h); c.stroke();
      }
      c.fillStyle = 'rgba(255,234,172,.14)';
      c.beginPath(); c.moveTo(w * .085, horizon); c.lineTo(w * .275, horizon); c.lineTo(w * .77, h); c.lineTo(w * .25, h); c.closePath(); c.fill();
      c.fillStyle = 'rgba(49,47,32,.12)';
      c.beginPath(); c.moveTo(w * .18, horizon); c.lineTo(w * .19, horizon); c.lineTo(w * .53, h); c.lineTo(w * .5, h); c.closePath(); c.fill();
      c.restore();
      const ppm = w / worldWidth;
      const cx = w * .5, cy = h * .70;
      const n = s.count > 256n ? 257 : Number(s.count);
      if (n <= 32) this.plate(c, cx, cy, ppm);
      if (n <= 256) this.exactBuns(c, cx, cy, ppm, n, time, options);
      else this.heap(c, cx, cy, ppm, Number(s.pileRadius), Number(s.pileHeight), time, options);
      if (worldWidth < 1.1) {
        this.pill(c, 22, 22, n <= 256 ? '卓上ビュー · 一つずつ描画' : '卓上ビュー · 表面を代表描画');
      } else this.pill(c, 22, 22, '卓上ビュー · 高さと体積の比較');
    }

    exactBuns(c, cx, cy, ppm, count, time, options) {
      const positions = [];
      if (count <= 8) {
        const spots = [[0, 0], [.052, 0], [-.052, 0], [0, -.055], [.052, -.055], [-.052, -.055], [0, .055], [.052, .055]];
        for (let i = 0; i < count; i++) {
          positions.push({ x: spots[i][0], z: spots[i][1], y: 0, i });
        }
      } else {
        // A close-packed stack: each higher layer has fewer buns and real occlusion.
        let remaining = count, layer = 0;
        const initial = Math.ceil(Math.cbrt(count * 2.5));
        while (remaining > 0) {
          const cols = Math.max(1, initial - layer);
          const layerCount = Math.min(remaining, cols * cols);
          const rows = Math.ceil(layerCount / cols);
          for (let i = 0; i < layerCount; i++) {
            const row = Math.floor(i / cols), col = i % cols;
            positions.push({ x: (col - (Math.min(cols, layerCount - row * cols) - 1) / 2) * .049 + (row % 2) * .006, z: (row - (rows - 1) / 2) * .052, y: layer * .023, i: count - remaining + i });
          }
          remaining -= layerCount; layer++;
        }
      }
      positions.sort((a, b) => a.y - b.y || a.z - b.z);
      const age = Math.max(0, time - this.burstTime);
      for (const p of positions) {
        const perspective = clamp(1 + p.z * .18, .8, 1.2);
        const size = ppm * .05 * perspective;
        let fall = 0;
        if (!options.reducedMotion && p.i >= this.newFrom && age < 1.2) {
          const phase = Math.max(0, age - hash(p.i) * .11);
          fall = Math.exp(-phase * 7) * Math.abs(Math.cos(phase * 13)) * Math.min(size * .9, 70);
        }
        const x = cx + p.x * ppm, y = cy + p.z * ppm * .43 - p.y * ppm;
        c.fillStyle = `rgba(40,20,9,${.25 / (1 + fall * .04)})`;
        c.beginPath(); c.ellipse(x + size * .16, y + size * .06, size * .55, size * .17, .06, 0, TAU); c.fill();
        c.drawImage(this.sprites[p.i % 5], x - size * .61, y - size * .75 - fall, size * 1.22, size * .915);
      }
    }

    plate(c, cx, cy, ppm) {
      const rx = .15 * ppm, ry = rx * .39;
      c.save();
      c.fillStyle = 'rgba(49,30,15,.24)';
      c.beginPath(); c.ellipse(cx + rx * .055, cy + ry * .2, rx * 1.01, ry, 0, 0, TAU); c.fill();
      c.fillStyle = '#929a88'; c.beginPath(); c.ellipse(cx, cy + 4, rx, ry, 0, 0, TAU); c.fill();
      const glaze = c.createLinearGradient(cx - rx * .5, cy - ry, cx + rx * .5, cy + ry);
      glaze.addColorStop(0, '#e6eadc'); glaze.addColorStop(.5, '#d1d9c7'); glaze.addColorStop(1, '#a6b4a1');
      c.fillStyle = glaze; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255,255,235,.75)'; c.lineWidth = Math.max(1, ppm * .001);
      c.beginPath(); c.ellipse(cx, cy - 1, rx * .985, ry * .985, 0, Math.PI, TAU); c.stroke();
      const well = c.createLinearGradient(0, cy - ry, 0, cy + ry);
      well.addColorStop(0, '#aebdab'); well.addColorStop(.32, '#d7decd'); well.addColorStop(1, '#e3e8d8');
      c.fillStyle = well; c.beginPath(); c.ellipse(cx, cy, rx * .78, ry * .76, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(86,112,96,.22)'; c.lineWidth = 1;
      c.beginPath(); c.ellipse(cx, cy, rx * .88, ry * .88, 0, 0, TAU); c.stroke();
      c.restore();
    }

    closeSurface(c, w, h, worldWidth) {
      c.fillStyle = '#634421'; c.fillRect(0, 0, w, h);
      const size = w / worldWidth * .05;
      const columns = Math.ceil(w / (size * .94)) + 2;
      const rows = Math.ceil(h / (size * .48)) + 2;
      // Fixed-size representative patch: geometry never grows with the total count.
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const id = row * columns + col;
          const x = (col - 1 + (row % 2) * .5) * size * .94;
          const y = (row - 1) * size * .48;
          c.fillStyle = 'rgba(37,20,8,.38)';
          c.beginPath(); c.ellipse(x + size * .12, y + size * .08, size * .55, size * .17, 0, 0, TAU); c.fill();
          c.drawImage(this.sprites[id % 5], x - size * .61, y - size * .73, size * 1.22, size * .915);
        }
      }
      const shade = c.createLinearGradient(0, 0, w, h);
      shade.addColorStop(0, 'rgba(255,223,164,.06)'); shade.addColorStop(1, 'rgba(19,21,16,.38)');
      c.fillStyle = shade; c.fillRect(0, 0, w, h);
      this.pill(c, 22, 22, '表面の接写 · 一部を代表描画');
    }

    heap(c, cx, cy, ppm, radius, height, time, options) {
      radius = Math.max(.04, radius || .1);
      height = Math.max(.04, height || radius * .7);
      const rx = radius * ppm, ry = rx * .24;
      const ph = height * ppm;
      c.save();
      c.fillStyle = 'rgba(22,22,17,.27)';
      c.beginPath(); c.ellipse(cx + rx * .15, cy + ry * .12, rx * 1.15, ry * 1.12, -.02, 0, TAU); c.fill();
      const silhouette = new Path2D();
      silhouette.moveTo(cx - rx, cy);
      silhouette.bezierCurveTo(cx - rx * .65, cy - ph * .39, cx - rx * .2, cy - ph * .97, cx, cy - ph);
      silhouette.bezierCurveTo(cx + rx * .12, cy - ph * .97, cx + rx * .61, cy - ph * .3, cx + rx, cy);
      silhouette.bezierCurveTo(cx + rx * .6, cy + ry, cx - rx * .6, cy + ry, cx - rx, cy);
      const fill = c.createLinearGradient(cx - rx, cy - ph * .8, cx + rx, cy);
      fill.addColorStop(0, '#dcaa64'); fill.addColorStop(.3, '#b87936'); fill.addColorStop(.64, '#865020'); fill.addColorStop(1, '#503720');
      c.fillStyle = fill; c.fill(silhouette);
      c.clip(silhouette);
      // Detail is bounded and becomes grain at distance; no giant symbolic buns.
      const bunPx = ppm * .05;
      const sampleStep = Math.max(2.7, bunPx * .85);
      const cols = Math.min(160, Math.ceil(2 * rx / sampleStep));
      const rows = Math.min(95, Math.ceil((ph + ry) / Math.max(2.5, sampleStep * .55)));
      for (let row = 0; row < rows; row++) {
        const py = cy - ph + row / Math.max(1, rows - 1) * (ph + ry);
        const slope = clamp((py - cy + ph) / ph, 0, 1);
        for (let col = 0; col < cols; col++) {
          const seed = row * 161 + col;
          const px = cx - rx + (col + (row % 2) * .5 + hash(seed) * .25) / Math.max(1, cols) * rx * 2;
          if (Math.abs(px - cx) > rx * (slope + .05) && py < cy) continue;
          const size = Math.min(30, Math.max(1.2, bunPx));
          if (bunPx > 3 && cols * rows < 13000) {
            c.drawImage(this.sprites[seed % 5], px - size * .6, py - size * .55, size * 1.25, size * .94);
          } else {
            c.fillStyle = hash(seed) > .5 ? 'rgba(251,192,107,.25)' : 'rgba(56,28,10,.24)';
            c.fillRect(px, py + hash(seed + 100) * 2, 1 + hash(seed) * 1.4, .8 + hash(seed + 3) * 1.4);
          }
        }
      }
      c.restore();
    }

    landscape(c, w, h, s, worldWidth, time, options) {
      const ppm = w / worldWidth, ground = h * .76;
      const sky = c.createLinearGradient(0, 0, 0, ground);
      sky.addColorStop(0, '#557d92'); sky.addColorStop(.65, '#adc4c8'); sky.addColorStop(1, '#d8d8be');
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      // A hazy horizon rather than infinitely repeating buildings.
      c.fillStyle = '#899e91'; c.beginPath(); c.moveTo(0, ground);
      for (let i = 0; i <= 20; i++) c.lineTo(w * i / 20, ground - h * (.025 + hash(i + 80) * .045));
      c.lineTo(w, h); c.lineTo(0, h); c.fill();
      const grass = c.createLinearGradient(0, ground, 0, h);
      grass.addColorStop(0, '#879174'); grass.addColorStop(1, '#545f43');
      c.fillStyle = grass; c.fillRect(0, ground, w, h - ground);
      const gridMeters = Math.pow(10, Math.floor(Math.log10(worldWidth / 6)));
      c.strokeStyle = 'rgba(217,223,190,.1)'; c.lineWidth = 1;
      for (let i = -8; i <= 8; i++) {
        c.beginPath(); c.moveTo(w / 2 + i * gridMeters * ppm, ground); c.lineTo(w / 2 + i * gridMeters * ppm * 2.4, h); c.stroke();
      }
      const radius = Number(s.pileRadius) || .05;
      const height = Number(s.pileHeight) || radius * .7;
      const center = w * .55;
      this.landmarks(c, w, h, ppm, ground, worldWidth);
      if (s.count <= 256n) this.exactBuns(c, center, ground, ppm, Number(s.count), time, options);
      else this.heap(c, center, ground, ppm, radius, height, time, options);
      const top = ground - height * ppm;
      if (top > 65 && radius * ppm > 40) {
        const x = Math.min(w - 35, center + radius * ppm + 25);
        c.strokeStyle = 'rgba(245,239,206,.72)'; c.lineWidth = 1;
        c.setLineDash([3, 5]); c.beginPath(); c.moveTo(x, top); c.lineTo(x, ground); c.stroke(); c.setLineDash([]);
        c.beginPath(); c.moveTo(x - 5, top); c.lineTo(x + 5, top); c.moveTo(x - 5, ground); c.lineTo(x + 5, ground); c.stroke();
        this.label(c, `高さ ${measure(height)}`, Math.min(w - 76, x), Math.max(78, top - 12), 'center');
      }
      this.pill(c, 22, 22, '屋外ビュー · 体積から求めた山');
    }

    landmarks(c, w, h, ppm, y, worldWidth) {
      const x = w * .16;
      if (worldWidth < 200 && 1.7 * ppm > 5) {
        const size = 1.7 * ppm;
        c.save(); c.translate(x, y);
        c.fillStyle = 'rgba(20,30,30,.23)'; c.beginPath(); c.ellipse(size * .23, 2, size * .34, size * .055, .08, 0, TAU); c.fill();
        c.fillStyle = '#26363c';
        c.beginPath(); c.arc(0, -size * .91, size * .065, 0, TAU); c.fill();
        c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#30494c'; c.lineWidth = size * .105;
        c.beginPath(); c.moveTo(0, -size * .78); c.lineTo(0, -size * .43); c.stroke();
        c.lineWidth = size * .06;
        c.beginPath(); c.moveTo(-size * .15, -size * .47); c.lineTo(-size * .1, -size * .72); c.lineTo(0, -size * .78); c.lineTo(size * .1, -size * .72); c.lineTo(size * .15, -size * .49); c.stroke();
        c.strokeStyle = '#29333a'; c.lineWidth = size * .065;
        c.beginPath(); c.moveTo(-size * .075, -size * .02); c.lineTo(-size * .06, -size * .24); c.lineTo(0, -size * .44); c.lineTo(size * .06, -size * .24); c.lineTo(size * .095, -size * .02); c.stroke();
        c.restore();
        this.label(c, '人 1.7 m', x, y + 22, 'center');
      } else if (worldWidth < 1800) {
        const bh = 10 * ppm, bw = 11 * ppm;
        c.fillStyle = '#bdc0af'; c.fillRect(x - bw / 2, y - bh * .7, bw, bh * .7);
        c.fillStyle = '#48585a'; c.beginPath(); c.moveTo(x - bw * .6, y - bh * .7); c.lineTo(x, y - bh); c.lineTo(x + bw * .6, y - bh * .7); c.fill();
        c.fillStyle = '#527078'; c.fillRect(x - bw * .32, y - bh * .52, bw * .2, bh * .18); c.fillRect(x + bw * .12, y - bh * .52, bw * .2, bh * .18);
        this.label(c, '建物 10 m', x, y + 22, 'center');
      } else if (worldWidth < 90000) {
        const bh = 300 * ppm, bw = 50 * ppm;
        c.fillStyle = '#697a79'; c.fillRect(x - bw / 2, y - bh, bw, bh);
        c.fillStyle = '#9badac'; c.fillRect(x - bw / 2, y - bh, bw * .35, bh);
        c.strokeStyle = 'rgba(212,220,208,.25)';
        for (let i = 1; i < 22; i++) { c.beginPath(); c.moveTo(x - bw / 2, y - bh + i * bh / 22); c.lineTo(x + bw / 2, y - bh + i * bh / 22); c.stroke(); }
        this.label(c, '高層ビル 300 m', x, y + 22, 'center');
      } else {
        const mh = 3776 * ppm, mw = 11000 * ppm;
        c.fillStyle = '#7c8c8a'; c.beginPath(); c.moveTo(x - mw / 2, y); c.lineTo(x, y - mh); c.lineTo(x + mw / 2, y); c.fill();
        c.fillStyle = '#e1e3d4'; c.beginPath(); c.moveTo(x - mw * .065, y - mh * .87); c.lineTo(x, y - mh); c.lineTo(x + mw * .065, y - mh * .87); c.fill();
        this.label(c, '富士山 3,776 m', x, y + 22, 'center');
      }
    }

    space(c, w, h, radius, s, worldWidth, options = {}) {
      const bg = c.createRadialGradient(w * .6, h * .5, 0, w * .5, h * .5, w);
      bg.addColorStop(0, '#152c3b'); bg.addColorStop(.5, '#0b1825'); bg.addColorStop(1, '#050c15');
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 100; i++) {
        c.fillStyle = `rgba(211,227,239,${.18 + hash(i) * .4})`;
        c.fillRect(hash(i + 20) * w, hash(i + 760) * h, i % 7 ? 1 : 1.5, i % 7 ? 1 : 1.5);
      }
      const model = window.BaibainModel;
      const references = model?.SPACE_REFERENCES || [{ id: 'earth', label: '地球', diameter: 12742000, kind: 'body' }];
      const reference = references.find(item => item.id === options.referenceId) || model?.spaceReference?.(s) || references[0];
      this.referenceId = reference.id;
      const refRadius = reference.diameter / 2;
      const top = w < 480 ? 116 : 88;
      const maxRadiusPx = Math.max(12, Math.min(w * .188, (h - top - 118) / 2));
      const ppm = maxRadiusPx / Math.max(radius, refRadius);
      const er = refRadius * ppm, br = radius * ppm;
      const cy = top + maxRadiusPx, ex = w * .265, bx = w * .745;
      if (reference.id === 'earth') {
      c.save(); c.translate(ex, cy);
      c.shadowBlur = Math.min(25, er * .12); c.shadowColor = '#65b4ef';
      const ocean = c.createRadialGradient(-er * .4, -er * .4, 0, 0, 0, er);
      ocean.addColorStop(0, '#6396ae'); ocean.addColorStop(.6, '#326681'); ocean.addColorStop(1, '#112c48');
      c.fillStyle = ocean; c.beginPath(); c.arc(0, 0, er, 0, TAU); c.fill(); c.shadowBlur = 0;
      c.save(); c.beginPath(); c.arc(0, 0, er, 0, TAU); c.clip();
      c.fillStyle = '#859770';
      for (let continent = 0; continent < 4; continent++) {
        c.beginPath();
        const ox = [-.4, .1, .35, -.2][continent] * er, oy = [-.3, .2, -.5, .62][continent] * er;
        for (let i = 0; i < 13; i++) {
          const a = i / 13 * TAU, r = er * (.14 + hash(i + continent * 40) * .17);
          const px = ox + Math.cos(a) * r, py = oy + Math.sin(a) * r * 1.35;
          if (!i) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath(); c.fill();
      }
      c.strokeStyle = 'rgba(235,241,232,.4)'; c.lineWidth = er * .07;
      for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(-er * .1, (i - 1.5) * er * .35, er * .8, er * .15, -.2, .5, 2.2); c.stroke(); }
      const night = c.createLinearGradient(-er, 0, er, 0); night.addColorStop(0, 'rgba(2,9,17,0)'); night.addColorStop(.5, 'rgba(2,9,17,.05)'); night.addColorStop(1, 'rgba(2,9,17,.8)');
      c.fillStyle = night; c.fillRect(-er, -er, er * 2, er * 2);
      c.restore(); c.restore();
      } else {
        this.cosmicReference(c, reference, ex, cy, er);
      }
      const bun = c.createRadialGradient(bx - br * .4, cy - br * .4, 0, bx, cy, Math.max(1, br));
      bun.addColorStop(0, '#d9a05a'); bun.addColorStop(.55, '#996028'); bun.addColorStop(1, '#382715');
      c.fillStyle = bun; c.beginPath(); c.arc(bx, cy, br, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.arc(bx, cy, br, 0, TAU); c.clip();
      for (let i = 0; i < 950; i++) {
        c.fillStyle = i % 2 ? 'rgba(243,199,116,.14)' : 'rgba(31,20,11,.17)';
        c.fillRect(bx + (hash(i) * 2 - 1) * br, cy + (hash(i + 1000) * 2 - 1) * br, 1.3, 1.3);
      }
      c.restore();
      const captionY = cy + maxRadiusPx + 19;
      for (const [x, r] of [[ex, er], [bx, br]]) {
        if (r < 1) {
          c.strokeStyle = 'rgba(227,235,231,.45)'; c.lineWidth = 1;
          c.beginPath(); c.moveTo(x, cy + 4); c.lineTo(x, captionY - 12); c.stroke();
        }
      }
      const captionWidth = w * .44;
      const fitCaption = (text, x, y, size = 11) => {
        c.font = `500 ${size}px system-ui, sans-serif`;
        const actualSize = Math.max(8, Math.min(size, size * captionWidth / Math.max(1, c.measureText(text).width)));
        this.label(c, text, x, y, 'center', actualSize);
      };
      fitCaption(reference.label, ex, captionY);
      fitCaption('同じ体積の球', bx, captionY);
      const detail = reference.id === 'solar-system' ? '軌道は実寸比・天体は記号' : reference.id === 'milky-way' ? '星の円盤の広がり・模式図' : reference.id === 'observable-universe' ? '観測できる範囲・模式図' : '直径を同じ縮尺で比較';
      fitCaption(er < 1 ? 'この縮尺では 1 px 未満' : detail, ex, captionY + 16, 9);
      fitCaption(br < 1 ? 'この縮尺では 1 px 未満' : 'まんじゅうの総体積を換算', bx, captionY + 16, 9);
      this.pill(c, 22, 22, `宇宙比較 · ${reference.label}`);
      this.spaceWorldWidth = w / ppm;
    }

    cosmicReference(c, reference, x, y, radius) {
      if (radius < 1) {
        // Do not enlarge a physically subpixel object into a misleading disk.
        c.fillStyle = '#d1dbe7'; c.beginPath(); c.arc(x, y, radius, 0, TAU); c.fill();
        return;
      }
      c.save(); c.translate(x, y);
      if (reference.id === 'sun') this.sun(c, radius);
      else if (reference.id === 'solar-system') this.solarSystem(c, radius);
      else if (reference.id === 'milky-way') this.galaxy(c, radius);
      else if (reference.id === 'observable-universe') this.observableUniverse(c, radius);
      c.restore();
    }

    sun(c, r) {
      const halo = c.createRadialGradient(0, 0, r * .8, 0, 0, r * 1.35);
      halo.addColorStop(0, 'rgba(255,155,49,.24)'); halo.addColorStop(.55, 'rgba(255,126,25,.10)'); halo.addColorStop(1, 'rgba(255,126,25,0)');
      c.fillStyle = halo; c.beginPath(); c.arc(0, 0, r * 1.35, 0, TAU); c.fill();
      const disk = c.createRadialGradient(-r * .28, -r * .28, r * .04, 0, 0, r);
      disk.addColorStop(0, '#fff2b4'); disk.addColorStop(.6, '#ffd364'); disk.addColorStop(.92, '#ed952b'); disk.addColorStop(1, '#cb6518');
      c.fillStyle = disk; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip();
      for (let i = 0; i < 1600; i++) {
        const px = (hash(i) * 2 - 1) * r, py = (hash(i + 2100) * 2 - 1) * r;
        c.fillStyle = i % 3 ? 'rgba(172,75,10,.075)' : 'rgba(255,250,188,.30)';
        c.fillRect(px, py, .7 + hash(i + 12) * r * .019, .6 + hash(i + 24) * r * .012);
      }
      c.fillStyle = 'rgba(124,59,17,.34)';
      for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse((hash(i + 13) - .5) * r * 1.4, (hash(i + 42) - .5) * r, r * .014, r * .011, -.4, 0, TAU); c.fill(); }
      c.restore();
    }

    solarSystem(c, r) {
      const au = [.387, .723, 1, 1.524, 5.203, 9.537, 19.191, 30.06];
      for (let i = 0; i < au.length; i++) {
        const orbit = r * au[i] / 30.06;
        c.strokeStyle = i === 7 ? 'rgba(141,186,224,.78)' : 'rgba(135,164,191,.29)';
        c.lineWidth = i === 7 ? 1.2 : .7;
        c.beginPath(); c.arc(0, 0, orbit, 0, TAU); c.stroke();
        const angle = hash(i + 280) * TAU;
        c.fillStyle = ['#b8aaa0', '#d7c18a', '#75abc7', '#c77957', '#cdb593', '#dac295', '#9ad0d5', '#6f9cde'][i];
        c.beginPath(); c.arc(Math.cos(angle) * orbit, Math.sin(angle) * orbit, i < 4 ? 1 : 1.8, 0, TAU); c.fill();
      }
      const glow = c.createRadialGradient(0, 0, 0, 0, 0, 10);
      glow.addColorStop(0, 'rgba(255,225,143,.9)'); glow.addColorStop(.2, 'rgba(255,209,104,.65)'); glow.addColorStop(1, 'rgba(255,195,82,0)');
      c.fillStyle = glow; c.beginPath(); c.arc(0, 0, 10, 0, TAU); c.fill();
    }

    galaxy(c, r) {
      c.save(); c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip();
      const haze = c.createRadialGradient(0, 0, 0, 0, 0, r);
      haze.addColorStop(0, 'rgba(247,224,184,.7)'); haze.addColorStop(.13, 'rgba(186,170,173,.36)'); haze.addColorStop(.5, 'rgba(94,112,171,.15)'); haze.addColorStop(1, 'rgba(61,86,143,0)');
      c.fillStyle = haze; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      // A face-on spiral disk, with its diameter indicated independently of its brightness.
      for (let arm = 0; arm < 4; arm++) {
        c.strokeStyle = 'rgba(144,158,208,.12)'; c.lineWidth = Math.max(1, r * .09);
        c.beginPath();
        for (let j = 0; j <= 80; j++) {
          const fraction = j / 80, a = fraction * 5.2 + arm * TAU / 4;
          const px = Math.cos(a) * r * fraction, py = Math.sin(a) * r * fraction;
          if (!j) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
      }
      for (let i = 0; i < 2400; i++) {
        const fraction = Math.sqrt(hash(i + 20)) * .97;
        const a = fraction * 5.2 + (i % 4) * TAU / 4 + (hash(i + 3000) - .5) * .6;
        const px = Math.cos(a) * r * fraction, py = Math.sin(a) * r * fraction;
        c.fillStyle = i % 9 === 0 ? 'rgba(237,203,172,.70)' : `rgba(169,190,227,${.15 + hash(i + 99) * .45})`;
        c.fillRect(px, py, .5 + hash(i + 400) * 1.1, .5 + hash(i + 401) * 1.1);
      }
      const core = c.createRadialGradient(0, 0, 0, 0, 0, r * .23);
      core.addColorStop(0, 'rgba(255,243,206,.92)'); core.addColorStop(.25, 'rgba(237,211,177,.63)'); core.addColorStop(1, 'rgba(229,201,183,0)');
      c.fillStyle = core; c.beginPath(); c.ellipse(0, 0, r * .27, r * .17, -.4, 0, TAU); c.fill();
      c.restore();
      this.extentRing(c, r);
    }

    observableUniverse(c, r) {
      const depth = c.createRadialGradient(-r * .2, -r * .3, 0, 0, 0, r);
      depth.addColorStop(0, 'rgba(72,81,114,.6)'); depth.addColorStop(.65, 'rgba(35,53,76,.5)'); depth.addColorStop(1, 'rgba(12,27,42,.18)');
      c.fillStyle = depth; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip();
      for (let i = 0; i < 420; i++) {
        const a = hash(i + 1200) * TAU, distance = Math.sqrt(hash(i + 1700)) * r;
        const px = Math.cos(a) * distance, py = Math.sin(a) * distance;
        const galaxySize = .5 + hash(i + 4600) * Math.max(1, r * .027);
        c.fillStyle = i % 3 ? 'rgba(167,190,222,.48)' : 'rgba(237,182,151,.57)';
        c.beginPath(); c.ellipse(px, py, galaxySize * 1.4, galaxySize * .44, hash(i + 6100) * TAU, 0, TAU); c.fill();
        c.fillStyle = 'rgba(242,229,208,.55)'; c.fillRect(px, py, .65, .65);
      }
      c.restore();
      // This ring marks the chosen observable extent, not a physical wall or the whole universe.
      this.extentRing(c, r);
    }

    extentRing(c, r) {
      c.strokeStyle = 'rgba(160,190,211,.55)'; c.lineWidth = 1; c.setLineDash([2, 4]);
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); c.setLineDash([]);
    }

    pill(c, x, y, text) {
      c.font = '500 11px system-ui, sans-serif';
      const width = c.measureText(text).width + 24;
      x = Math.max(14, this.width - width - 18);
      y = this.width < 480 ? 84 : 22;
      c.fillStyle = 'rgba(10,24,29,.64)';
      c.beginPath(); c.roundRect(x, y, width, 29, 14.5); c.fill();
      c.fillStyle = '#e5e6d5'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(text, x + 12, y + 14.5);
    }

    label(c, text, x, y, align = 'left', size = 11) {
      c.font = `500 ${size}px system-ui, sans-serif`;
      c.textAlign = align; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = 'rgba(12,26,28,.6)'; c.strokeText(text, x, y);
      c.fillStyle = '#f0eee0'; c.fillText(text, x, y);
    }

    scale(c, w, h, worldWidth, space) {
      if (space) worldWidth = this.spaceWorldWidth || worldWidth;
      const maxMeters = worldWidth * .2;
      const base = Math.pow(10, Math.floor(Math.log10(maxMeters)));
      const multiple = maxMeters / base >= 5 ? 5 : maxMeters / base >= 2 ? 2 : 1;
      const meters = base * multiple;
      const width = w * meters / worldWidth;
      const x = 25, y = h - 29;
      c.strokeStyle = '#e9e7d7'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x, y); c.lineTo(x + width, y); c.lineTo(x + width, y - 4); c.stroke();
      const scaleText = space && window.BaibainModel?.formatCosmicLength ? window.BaibainModel.formatCosmicLength(meters) : measure(meters);
      this.label(c, scaleText, x, y - 16, 'left', 10);
    }

    destroy() { this.destroyed = true; this.sprites = []; }
  }
  window.BaibainScene = BaibainScene;
})();
