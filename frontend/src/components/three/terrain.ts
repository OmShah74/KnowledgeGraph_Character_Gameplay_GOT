/**
 * Procedural terrain for the Known World, generated from the hand-authored geography.
 *
 * Pipeline (all on the CPU, once, cached):
 *   1. rasterise coastlines → blur → add fbm noise → threshold   = organic coastlines
 *   2. rasterise mountain strokes → blur → ridged noise            = mountain ranges
 *   3. carve rivers and lakes below sea level
 *   4. colour: biomes (radial blends) + beaches + rock + snowline + hill-shading + rivers + roads
 * Output: a colour texture, a height field (for mesh displacement & object placement) and a sampler.
 */
import * as THREE from "three";
import { BIOMES, ESSOS, ISLANDS, LAKES, MOUNTAINS, RIVERS, ROADS, WESTEROS, type Pt } from "@/lib/westeros-geo";

export const N = 1024;          // raster resolution
export const SEA = 0.42;         // sea level in normalised height
export const HEIGHT_SCALE = 3.2; // world units for normalised height 1.0 above sea

export type Terrain = {
  colorTexture: THREE.CanvasTexture;
  heights: Float32Array; // N*N, normalised 0..1
  heightAt: (mx: number, my: number) => number; // world Y at map coords
  isLand: (mx: number, my: number) => boolean;
};

let cache: Terrain | null = null;

// ------------------------------------------------------------------ noise
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * valueNoise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
function ridged(x: number, y: number): number {
  let s = 0, a = 0.55, f = 1;
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(valueNoise(x * f, y * f) * 2 - 1);
    s += a * n * n;
    f *= 2.1;
    a *= 0.5;
  }
  return s;
}

// ------------------------------------------------------------------ raster helpers
const px = (u: number) => (u / 100) * N;

function ctx2d(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable");
  return [c, ctx];
}

function smoothPoly(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  const n = pts.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(px(start[0]), px(start[1]));
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(px(p[0]), px(p[1]), px(m[0]), px(m[1]));
  }
  ctx.closePath();
  ctx.fill();
}

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[], width: number) {
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(px(pts[0][0]), px(pts[0][1]));
  for (let i = 1; i < pts.length - 1; i++) {
    const m: Pt = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    ctx.quadraticCurveTo(px(pts[i][0]), px(pts[i][1]), px(m[0]), px(m[1]));
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(px(last[0]), px(last[1]));
  ctx.stroke();
}

function blurred(draw: (ctx: CanvasRenderingContext2D) => void, blurPx: number): Uint8ClampedArray {
  const [src, sctx] = ctx2d();
  sctx.fillStyle = "#000";
  sctx.fillRect(0, 0, N, N);
  sctx.fillStyle = "#fff";
  sctx.strokeStyle = "#fff";
  draw(sctx);
  const [dst, dctx] = ctx2d();
  dctx.fillStyle = "#000";
  dctx.fillRect(0, 0, N, N);
  dctx.filter = `blur(${blurPx}px)`;
  dctx.drawImage(src, 0, 0);
  dctx.filter = "none";
  void dst;
  return dctx.getImageData(0, 0, N, N).data;
}

// ------------------------------------------------------------------ generation
export function getTerrain(): Terrain {
  if (cache) return cache;
  const land = blurred((c) => {
    smoothPoly(c, WESTEROS);
    smoothPoly(c, ESSOS);
    ISLANDS.forEach((i) => smoothPoly(c, i.pts));
  }, 7);
  const mountains = blurred((c) => {
    for (const m of MOUNTAINS) {
      c.globalAlpha = Math.min(1, m.height);
      stroke(c, m.pts, px(m.width));
    }
    c.globalAlpha = 1;
  }, 12);
  const water = blurred((c) => {
    for (const r of RIVERS) stroke(c, r.pts, px(0.45 * (r.width ?? 1)));
    for (const l of LAKES) {
      c.beginPath();
      c.ellipse(px(l.c[0]), px(l.c[1]), px(l.r * 1.25), px(l.r * 0.85), 0.3, 0, Math.PI * 2);
      c.fill();
    }
  }, 2);
  const roads = blurred((c) => {
    c.setLineDash([px(0.6), px(0.45)]);
    for (const r of ROADS) stroke(c, r.pts, px(0.16));
  }, 0.6);

  const heights = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const nx = x / N * 18, ny = y / N * 18;
      const l = land[i * 4] / 255;
      const coastNoise = (fbm(nx * 1.7, ny * 1.7, 4) - 0.5) * 0.42;
      const h = l + coastNoise; // > 0.5 is land
      let height: number;
      if (h < 0.5) {
        height = SEA - (0.5 - h) * 0.5; // sea floor
      } else {
        const inland = Math.min(1, (h - 0.5) * 2.2);
        height = SEA + 0.02 + inland * 0.12 + fbm(nx * 3, ny * 3, 4) * 0.08 * inland;
        const m = mountains[i * 4] / 255;
        if (m > 0.02) height += m * (0.18 + ridged(nx * 2.6, ny * 2.6) * 0.42);
        const w = water[i * 4] / 255;
        if (w > 0.2) height = Math.min(height, SEA - 0.01 * w);
      }
      heights[i] = height;
    }
  }

  // ---------------------------------------------------------------- colour
  const [cc, cctx] = ctx2d();
  const img = cctx.createImageData(N, N);
  const d = img.data;
  const biome = (mx: number, my: number): [number, number, number] => {
    let r = 120, g = 142, b = 92, wsum = 1;
    for (const bm of BIOMES) {
      const dx = mx - bm.c[0], dy = my - bm.c[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      const w = Math.max(0, 1 - dist / bm.r) ** 1.6 * bm.strength * 3;
      if (w > 0) {
        r += bm.color[0] * w; g += bm.color[1] * w; b += bm.color[2] * w; wsum += w;
      }
    }
    return [r / wsum, g / wsum, b / wsum];
  };
  const hAt = (x: number, y: number) => heights[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const h = heights[i];
      const mx = (x / N) * 100, my = (y / N) * 100;
      let r: number, g: number, b: number;
      if (h < SEA) {
        const depth = Math.min(1, (SEA - h) * 8);
        r = 30 - depth * 18; g = 70 - depth * 40; b = 92 - depth * 40;
      } else {
        [r, g, b] = biome(mx, my);
        const alt = (h - SEA) / 0.6;
        if (h - SEA < 0.025) { r = r * 0.4 + 196 * 0.6; g = g * 0.4 + 180 * 0.6; b = b * 0.4 + 132 * 0.6; } // beaches
        if (alt > 0.42) { const k = Math.min(1, (alt - 0.42) * 3); r = r * (1 - k) + 112 * k; g = g * (1 - k) + 106 * k; b = b * (1 - k) + 100 * k; } // rock
        const snowLine = 0.62 - Math.max(0, (30 - my) / 30) * 0.45; // snow lower in the north
        if (alt > snowLine) { const k = Math.min(1, (alt - snowLine) * 4); r = r * (1 - k) + 240 * k; g = g * (1 - k) + 244 * k; b = b * (1 - k) + 248 * k; }
        const noise = (fbm(x / 22, y / 22, 3) - 0.5) * 26;
        r += noise; g += noise; b += noise * 0.7;
        // hill shading (light from the north-west)
        const dzx = hAt(x + 1, y) - hAt(x - 1, y), dzy = hAt(x, y + 1) - hAt(x, y - 1);
        const shade = 1 + (-dzx - dzy) * 22;
        r *= shade; g *= shade; b *= shade;
        const road = roads[i * 4] / 255;
        if (road > 0.35) { r = r * 0.5 + 150 * 0.5; g = g * 0.5 + 120 * 0.5; b = b * 0.5 + 80 * 0.5; }
      }
      d[i * 4] = Math.max(0, Math.min(255, r));
      d[i * 4 + 1] = Math.max(0, Math.min(255, g));
      d[i * 4 + 2] = Math.max(0, Math.min(255, b));
      d[i * 4 + 3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
  // river glints on top
  cctx.strokeStyle = "rgba(70,130,170,0.9)";
  for (const r of RIVERS) stroke(cctx, r.pts, px(0.28 * (r.width ?? 1)));

  const colorTexture = new THREE.CanvasTexture(cc);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.anisotropy = 8;

  const sample = (mx: number, my: number) => {
    const fx = Math.min(N - 1.001, Math.max(0, (mx / 100) * N));
    const fy = Math.min(N - 1.001, Math.max(0, (my / 100) * N));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const a = heights[y0 * N + x0], b = heights[y0 * N + x0 + 1], c = heights[(y0 + 1) * N + x0], e = heights[(y0 + 1) * N + x0 + 1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
  };
  cache = {
    colorTexture,
    heights,
    heightAt: (mx, my) => (sample(mx, my) - SEA) * HEIGHT_SCALE,
    isLand: (mx, my) => sample(mx, my) >= SEA,
  };
  return cache;
}

/** Displace a plane geometry (already rotated to XZ) using the terrain heights. */
export function buildTerrainGeometry(t: Terrain, size = 60, segments = 320): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(size, size, segments, segments);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const wx = p.getX(i), wz = p.getZ(i);
    const mx = (wx / size + 0.5) * 100, my = (wz / size + 0.5) * 100;
    p.setY(i, Math.max(-1.2, t.heightAt(mx, my)));
  }
  g.computeVertexNormals();
  return g;
}
