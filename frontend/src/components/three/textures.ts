import * as THREE from "three";
import { HERALDRY } from "@/lib/heraldry-icons";

/** Extract the SVG path data of a heraldic glyph (game-icons bodies are <path d="..."/> elements). */
export function glyphPaths(name: string): string[] {
  const icon = HERALDRY[name];
  if (!icon) return [];
  return Array.from(icon.body.matchAll(/\sd="([^"]+)"/g)).map((m) => m[1]);
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.needsUpdate = true;
  return t;
}

/** Draw a glyph centred in a box, used to engrave coins, medallions and banners. */
export function drawGlyph(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, size: number, fill: string) {
  const icon = HERALDRY[name];
  if (!icon) return;
  const s = size / Math.max(icon.w, icon.h);
  ctx.save();
  ctx.translate(cx - (icon.w * s) / 2, cy - (icon.h * s) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = fill;
  for (const d of glyphPaths(name)) ctx.fill(new Path2D(d));
  ctx.restore();
}

/** The face of an iron coin of Braavos: rim, "VALAR MORGHULIS", a hooded Faceless Man. */
export function ironCoinTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S / 2);
  g.addColorStop(0, "#5b5853");
  g.addColorStop(0.75, "#3b3935");
  g.addColorStop(1, "#24221f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // pitting
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "20,18,16" : "120,110,95"},${Math.random() * 0.25})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  ctx.strokeStyle = "#8d8576";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 70, 0, Math.PI * 2);
  ctx.stroke();
  // circular legend
  const text = "VALAR MORGHULIS · VALAR DOHAERIS · ";
  ctx.font = "bold 30px Georgia, serif";
  ctx.fillStyle = "#b9ad97";
  const radius = S / 2 - 46;
  const step = (Math.PI * 2) / text.length;
  for (let i = 0; i < text.length; i++) {
    const a = -Math.PI / 2 + i * step;
    ctx.save();
    ctx.translate(S / 2 + Math.cos(a) * radius, S / 2 + Math.sin(a) * radius);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(text[i], -8, 10);
    ctx.restore();
  }
  drawGlyph(ctx, "hooded-figure", S / 2, S / 2 + 6, 250, "#9b917f");
  return toTexture(c);
}

/** Damascus-like ripples of Valyrian steel. */
export function valyrianTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#2b2d33";
  ctx.fillRect(0, 0, S, S);
  for (let band = 0; band < 70; band++) {
    const y0 = (band / 70) * S;
    const light = band % 2 === 0;
    ctx.strokeStyle = light ? "rgba(170,178,192,0.55)" : "rgba(15,16,20,0.75)";
    ctx.lineWidth = 3 + Math.random() * 3;
    ctx.beginPath();
    for (let x = 0; x <= S; x += 6) {
      const y = y0 + Math.sin(x * 0.03 + band * 0.7) * 9 + Math.sin(x * 0.011 + band) * 14;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c);
}

/** Overlapping scale pattern for dragon eggs. */
export function scaleTexture(base: string, edge: string, glow: string): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const r = 26;
  for (let row = -1; row < S / (r * 0.8) + 1; row++) {
    for (let col = -1; col < S / (r * 2) + 2; col++) {
      const x = col * r * 2 + (row % 2 ? r : 0);
      const y = row * r * 0.8;
      const gr = ctx.createRadialGradient(x, y + r * 0.2, 2, x, y, r);
      gr.addColorStop(0, glow);
      gr.addColorStop(0.7, base);
      gr.addColorStop(1, edge);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  return toTexture(c, 3);
}

/** Bark of the weirwood: pale with faint vertical grain. */
export function barkTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#e9e4d8";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(150,140,120,${0.15 + Math.random() * 0.25})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 8, S * 0.3, x - 8, S * 0.6, x + 4, S);
    ctx.stroke();
  }
  return toTexture(c, 2);
}

/** Heraldic banner cloth: house colour with the sigil glyph. */
export function bannerTexture(color: string, glyph: string, glyphColor = "#f5ecd7"): THREE.CanvasTexture {
  const W = 256;
  const [c, ctx] = canvas(W);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, W);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "rgba(0,0,0,0.35)");
  g.addColorStop(0.5, "rgba(255,255,255,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, W);
  drawGlyph(ctx, glyph, W / 2, W / 2, 170, glyphColor);
  return toTexture(c);
}
