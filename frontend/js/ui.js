import { LANGS, getLang, setLang, t } from "./i18n.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtHa = (v) => v == null ? "—" : `${Number(v).toFixed(v < 1 ? 3 : 2)} ha`;
export const fmtInr = (v) => v == null ? "—" : "₹ " + Math.round(v).toLocaleString("en-IN");
export const fmtUlpin = (u) => String(u || "").replace(/(\d{4})(\d{4})(\d{3})(\d{3})/, "$1 $2 $3 $4");
export const fmtDate = (d) => { if (!d || d === "None") return "—"; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };
export const title = (s) => String(s || "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
export const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

const svg = (d, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'), minus: svg('<path d="M5 12h14"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  back: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'), fwd: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  ruler: svg('<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>'), area: svg('<path d="M4 7 10 4l10 4-3 11-11 1z"/>'),
  pin: svg('<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'), tools: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
  nav: svg('<path d="M3 6h18M3 12h12M3 18h7"/>'), close: svg('<path d="M6 6l12 12M18 6 6 18"/>'), chevron: svg('<path d="m15 18-6-6 6-6"/>', 16),
  right: svg('<path d="m9 18 6-6-6-6"/>', 16), copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>', 15),
  alert: svg('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>', 16), check: svg('<path d="m5 12 5 5 9-10"/>', 16),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 16), clear: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  work: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'), map: svg('<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'), chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  audit: svg('<path d="M9 4h6l1 2h3v15H5V6h3z"/><path d="M9 12h6M9 16h4"/>'), logout: svg('<path d="M15 4h4v16h-4M10 16l4-4-4-4M14 12H3"/>'),
  home: svg('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'), register: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>'),
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
};

// A neutral parcel-in-ring mark (not an official emblem).
export const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="#fff"/><circle cx="16" cy="16" r="13" fill="none" stroke="#0b2545" stroke-width="1.6"/><path d="M8.5 20.5 11.5 9.5l10-1 3 8.5-7.5 6z" fill="#e8eef7" stroke="#0b2545" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.5 9.5 16 15l5.5-6.5M16 15l1 8" fill="none" stroke="#0b2545" stroke-width="1"/><circle cx="16" cy="15" r="1.7" fill="#e07a1f"/></svg>';

export function langSelect(id = "lang") {
  return `<select class="lang-select" id="${id}" aria-label="Language">${LANGS.map(([k, n]) => `<option value="${k}" ${k === getLang() ? "selected" : ""}>${n}</option>`).join("")}</select>`;
}

export function citizenHeader(active = "home") {
  return `<header class="site-header">
    <div class="gov-strip" aria-hidden="true"></div>
    <div class="bar">
      <a class="brand" href="#/"><span class="brand-mark">${MARK}</span>
        <span class="brand-text"><b>${esc(t("brand"))}</b><span>Maharashtra · Uttar Pradesh · Gujarat</span></span></a>
      <span class="grow"></span>
      <nav class="topnav" aria-label="Main">
        <a href="#/" class="${active === "home" ? "on" : ""}">${esc(t("home"))}</a>
        <a href="#/map" class="${active === "map" ? "on" : ""}">${esc(t("landMap"))}</a>
        <a href="#/officer/login">${esc(t("officerLogin"))}</a>
      </nav>
      ${langSelect()}
    </div>
  </header>`;
}

export function bindLang(root, rerender) {
  root.querySelector("#lang")?.addEventListener("change", (e) => { setLang(e.target.value); rerender(); });
}

export const disclaimer = () => `<div class="disclaimer" role="note">${esc(t("disclaimer"))}</div>`;

export function toast(msg, kind = "") {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast ${kind}`; el.textContent = msg; document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

export const SEV_RANK = { none: 0, info: 1, low: 2, medium: 3, high: 4, critical: 5 };
/** Citizen-facing status from the validation risk level. */
export function riskStatus(risk) {
  const r = SEV_RANK[risk] ?? 0;
  return r >= 4 ? "bad" : r === 3 ? "warn" : "ok";
}
export function statusBadge(risk) {
  const st = riskStatus(risk);
  const label = { ok: t("stConsistent"), warn: t("stAttention"), bad: t("stDiscrepancy") }[st];
  return `<span class="badge ${st}">${esc(label)}</span>`;
}
export const sev = (s) => s ? `<span class="sev ${s}">${esc(s)}</span>` : "";

export function loading(msg = "Loading…") { return `<div class="loading"><span class="spinner"></span>${esc(msg)}</div>`; }
export function errorBox(e) { return `<div class="notice bad">${icon.alert}<span>${esc(e?.message || String(e))}</span></div>`; }
