import { esc } from "./ui.js";

/** Horizontal bars: [{label, value, color?, sub?}] */
export function bars(items, { max, unit = "" } = {}) {
  const m = max ?? Math.max(1, ...items.map(i => i.value));
  return `<div class="hbars">${items.map(i => `<div class="hbar"><span class="lbl">${esc(i.label)}${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span>
    <span class="trk"><i style="width:${(i.value / m) * 100}%;background:${i.color || "var(--blue)"}"></i></span><b>${i.value}${unit}</b></div>`).join("")}</div>`;
}

/** Stacked single bar: [{label, value, color}] */
export function stack(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return `<div class="stackbar">${parts.map(p => p.value ? `<i style="width:${(p.value / total) * 100}%;background:${p.color}" title="${esc(p.label)}: ${p.value}"></i>` : "").join("")}</div>
    <div class="legend">${parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${p.value}</b></span>`).join("")}</div>`;
}

/** Line chart for monthly series: series=[{name,color,values:[...]}], labels=[...] */
export function lines(series, labels, { height = 180, unit = "" } = {}) {
  const w = 560, h = height, pad = { l: 36, r: 12, t: 12, b: 26 };
  const all = series.flatMap(s => s.values);
  const maxV = Math.max(1, ...all) * 1.1;
  const x = (i) => pad.l + (i / (labels.length - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxV) * (h - pad.t - pad.b);
  const grid = [0, 0.5, 1].map(f => { const v = maxV * f; return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}${unit}</text>`; }).join("");
  const xl = labels.map((l, i) => i % 2 === 0 || labels.length < 8 ? `<text x="${x(i)}" y="${h - 8}" text-anchor="middle">${esc(l)}</text>` : "").join("");
  const paths = series.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="2.2" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>` +
    s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${s.color}"><title>${esc(s.name)} ${esc(labels[i])}: ${v}${unit}</title></circle>`).join("")).join("");
  return `<svg class="linechart" viewBox="0 0 ${w} ${h}" role="img">${grid}${xl}${paths}</svg>
    <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
}

/** Deterministic indicative monthly series ending at `end` (used where the dataset has no history). */
export function indicative(seed, end, n = 12, spread = 0.35) {
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
  const out = []; let v = end * (1 + spread);
  for (let i = 0; i < n - 1; i++) { out.push(Math.max(0, Math.round(v))); v = v - (v - end) / (n - i) + (rnd() - 0.5) * end * 0.25; }
  out.push(end);
  return out;
}
export const MONTHS = (() => { const out = []; const d = new Date(2026, 8, 1); for (let i = 11; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.toLocaleString("en-IN", { month: "short" })); } return out; })();
