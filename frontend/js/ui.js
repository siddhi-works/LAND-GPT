import { LANGS, getLang, setLang, t } from "./i18n.js";
import { accountHtml } from "./auth.js";

// ============================================================
// GENERAL HELPERS
// ============================================================

export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c])
  );

export const fmtHa = (v) =>
  v == null ? "—" : `${Number(v).toFixed(v < 1 ? 3 : 2)} ha`;

export const fmtInr = (v) =>
  v == null ? "—" : "₹ " + Math.round(v).toLocaleString("en-IN");

export const fmtUlpin = (u) =>
  String(u || "").replace(
    /(\d{4})(\d{4})(\d{3})(\d{3})/,
    "$1 $2 $3 $4"
  );

export const fmtDate = (d) => {
  if (!d || d === "None") return "—";

  const x = new Date(d);

  return isNaN(x)
    ? String(d)
    : x.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

export const title = (s) =>
  String(s || "")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);


// ============================================================
// SVG ICON HELPER
// ============================================================

const svg = (d, w = 18) =>
  `<svg width="${w}" height="${w}" viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true">${d}</svg>`;


// ============================================================
// ICONS
// ============================================================

export const icon = {

  search: svg(
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
  ),

  plus: svg('<path d="M12 5v14M5 12h14"/>'),

  minus: svg('<path d="M5 12h14"/>'),

  globe: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
  ),

  back: svg(
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'
  ),

  fwd: svg(
    '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'
  ),

  ruler: svg(
    '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>'
  ),

  area: svg(
    '<path d="M4 7 10 4l10 4-3 11-11 1z"/>'
  ),

  pin: svg(
    '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>'
  ),

  layers: svg(
    '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'
  ),

  tools: svg(
    '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'
  ),

  nav: svg(
    '<path d="M3 6h18M3 12h12M3 18h7"/>'
  ),

  close: svg(
    '<path d="M6 6l12 12M18 6 6 18"/>'
  ),

  chevron: svg(
    '<path d="m15 18-6-6 6-6"/>',
    16
  ),

  right: svg(
    '<path d="m9 18 6-6-6-6"/>',
    16
  ),

  copy: svg(
    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    15
  ),

  alert: svg(
    '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
    16
  ),

  check: svg(
    '<path d="m5 12 5 5 9-10"/>',
    16
  ),

  info: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    16
  ),

  clear: svg(
    '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  ),

  work: svg(
    '<path d="M4 6h16M4 12h16M4 18h10"/>'
  ),

  map: svg(
    '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>'
  ),

  shield: svg(
    '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'
  ),

  chart: svg(
    '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
  ),

  link: svg(
    '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
  ),

  audit: svg(
    '<path d="M9 4h6l1 2h3v15H5V6h3z"/><path d="M9 12h6M9 16h4"/>'
  ),

  logout: svg(
    '<path d="M15 4h4v16h-4M10 16l4-4-4-4M14 12H3"/>'
  ),

  home: svg(
    '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'
  ),

  register: svg(
    '<path d="M5 4h11l3 3v13H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>'
  ),

  spark: svg(
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'
  ),

  // Land Stack concepts (connected-records diagram, services hub).
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  swap: svg('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'),
  building: svg('<path d="M4 21V5l8-3 8 3v16"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4"/>'),
  rupee: svg('<path d="M7 5h10M7 9h10M8 5c5 0 7 1.5 7 4s-2 4-7 4l7 8"/>'),
  gavel: svg('<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8"/>'),
  leaf: svg('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5-6"/>'),
  bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),

  // Portal header: parcel boundary with surveyed vertices; map sheet with a located parcel.
  parcelLg: svg(
    '<path d="M4 8.5 10 4l10 3.5-2.5 11.5L6 20z"/><circle cx="4" cy="8.5" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="20" cy="7.5" r="1.4"/><circle cx="17.5" cy="19" r="1.4"/><circle cx="6" cy="20" r="1.4"/>',
    24
  ),

  mapLg: svg(
    '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/><path d="M12 13.5s-2-1.8-2-3.5a2 2 0 0 1 4 0c0 1.7-2 3.5-2 3.5z"/>',
    24
  ),
};


// ============================================================
// BHUSAMHITA MARK
// ============================================================

export const MARK = `<img class="bs-logo" src="./assets/bhusamhita-logo.svg" alt="" width="36" height="36">`;


// ============================================================
// LANGUAGE SELECT
// ============================================================

export function langSelect(id = "lang") {
  return `
    <select
      class="lang-select"
      id="${id}"
      aria-label="Language"
    >
      ${LANGS.map(
        ([k, n]) =>
          `<option value="${k}" ${
            k === getLang() ? "selected" : ""
          }>${n}</option>`
      ).join("")}
    </select>
  `;
}


// ============================================================
// CITIZEN HEADER
// Landing page: full portal header (government identity, Land
// Stack bar, navigation). Map and profile: the compact bar, so
// the GIS keeps the full viewport height.
// Navigation lists only routes that exist in app.js.
// ============================================================

function citizenNav(active, cls) {
  const link = (href, key, name) =>
    `<a href="${href}" class="${active === name ? "on" : ""}">${esc(t(key))}</a>`;

  return `
    <nav class="${cls}" aria-label="Main">
      ${link("#/", "home", "home")}
      ${link("#/map", "landMap", "map")}
      ${link("#/services", "navServices", "services")}
      <a href="#/faq" class="${active === "faq" ? "on" : ""}">${esc(t("navFaq"))}</a>
      <a href="#/contact" class="${active === "contact" ? "on" : ""}">${esc(t("navContact"))}</a>
    </nav>
  `;
}

export function citizenHeader(active = "home") {

  if (false) {   // one common government header on every page
    return `
      <header class="site-header">
        <div class="gov-strip" aria-hidden="true"></div>
        <div class="bar">
          <a class="brand" href="#/">
            <span class="brand-mark">${MARK}</span>
            <span class="brand-text">
              <b>${esc(t("brand"))}</b>
              <span>${esc(t("tagline"))}</span>
            </span>
          </a>
          <span class="grow"></span>
          ${citizenNav(active, "topnav")}
          ${langSelect()}
          <span class="acct-slot">${accountHtml()}</span>
        </div>
      </header>
    `;
  }

  return `
    <header class="portal-header">

      <div class="ph-strip">
        <div class="ph-strip-inner">
          <span>${esc(t("ministry"))}</span>
          <span class="ph-sep" aria-hidden="true">|</span>
          <span>${esc(t("govIndia"))}</span>
          <span class="ph-sep" aria-hidden="true">|</span>
          <span>${esc(t("dolr"))}</span>
        </div>
      </div>

      <div class="ph-brand ph-logos">
        <img class="ph-logo side mord" src="./assets/logo-mord.jpg" alt="Ministry of Rural Development, Government of India">
        <img class="ph-logo goi" src="./assets/logo-goi.svg" alt="Government of India">
        <img class="ph-logo side dolr" src="./assets/logo-dolr.jpg" alt="Department of Land Resources">
      </div>

      <div class="ph-tricolor" aria-hidden="true"></div>

      <div class="ph-navrow">
        <div class="ph-navrow-inner">
          <a class="bs-brand" href="#/">${MARK}<span>${esc(t("brand"))}</span></a>
          ${citizenNav(active, "ph-nav")}
          <span class="ph-right">${langSelect()}<span class="acct-slot">${accountHtml()}</span></span>
        </div>
      </div>

    </header>
  `;
}


// ============================================================
// LANGUAGE BINDING
// ============================================================

export function bindLang(root, rerender) {

  root
    .querySelector("#lang")
    ?.addEventListener("change", (e) => {

      setLang(e.target.value);

      rerender();

    });
}


// ============================================================
// DISCLAIMER
// ============================================================

// Kept as a no-op so every page's layout call stays the same; the product shows no environment banner.
export const disclaimer = () => "";


// ============================================================
// TOAST
// ============================================================

// Stacked notifications (max 3), kinds: "" | "ok" | "bad" | "info".
export function toast(msg, kind = "") {

  let stack = document.querySelector(".toast-stack");

  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    document.body.append(stack);
  }

  while (stack.children.length >= 3) stack.firstElementChild.remove();

  const el = document.createElement("div");

  el.className = `toast ${kind}`;

  el.innerHTML = `${kind === "bad" ? icon.alert : kind === "ok" ? icon.check : icon.info}<span>${esc(msg)}</span>`;

  stack.append(el);

  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, 3200);
}


// ============================================================
// SEVERITY / STATUS
// ============================================================

export const SEV_RANK = {
  none: 0,
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};


// Citizen-facing status from validation risk level.
export function riskStatus(risk) {

  const r = SEV_RANK[risk] ?? 0;

  return r >= 4
    ? "bad"
    : r === 3
      ? "warn"
      : "ok";
}


export function statusBadge(risk) {

  const st = riskStatus(risk);

  const label = {
    ok: t("stConsistent"),
    warn: t("stAttention"),
    bad: t("stDiscrepancy"),
  }[st];

  return `
    <span class="badge ${st}">
      ${esc(label)}
    </span>
  `;
}


export const sev = (s) =>
  s
    ? `<span class="sev ${s}">${esc(s)}</span>`
    : "";


// ============================================================
// LOADING
// ============================================================

export function loading(msg = "Loading…") {

  return `
    <div class="loading">
      <span class="spinner"></span>
      ${esc(msg)}
    </div>
  `;
}


// ============================================================
// ERROR BOX
// ============================================================

export function errorBox(e) {

  return `
    <div class="notice bad">
      ${icon.alert}
      <span>
        ${esc(e?.message || String(e))}
      </span>
    </div>
  `;
}


// ============================================================
// SKELETON / EMPTY STATE
// ============================================================

export const skeleton = (rows = 3) =>
  `<div class="skel" aria-busy="true" aria-label="Loading">${
    Array.from({ length: rows }, (_, i) => `<i style="width:${[92, 76, 84, 60, 70][i % 5]}%"></i>`).join("")
  }</div>`;

export const emptyState = (msg, sub = "", svgIcon = icon.info) =>
  `<div class="empty-state">${svgIcon}<b>${esc(msg)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>`;


// ============================================================
// FOOTER
// Elements with [data-chat] open the BhuSamhita Assistant (see chat.js).
// ============================================================

export function siteFooter() {

  const link = (href, key) => `<li><a href="${href}">${esc(t(key))}</a></li>`;

  return `
    <footer class="site-footer">
      <div class="sf-inner">
        <div class="sf-brand">
          <div class="sf-logo">${MARK}<b>${esc(t("brand"))}</b></div>
          <p>${esc(t("tagline"))}</p>
          <p class="sf-muted">${esc(t("footerAbout"))}</p>
        </div>
        <div>
          <h4>${esc(t("quickLinks"))}</h4>
          <ul>
            ${link("#/map", "landMap")}
            ${link("#/services", "digitalServices")}
            ${link("#/officer/login", "officerConsole")}
            <li><button class="sf-linkbtn" data-chat="${esc(t("qServices"))}">${esc(t("help"))}</button></li>
            <li><button class="sf-linkbtn" data-chat="">${esc(t("chatTitle"))}</button></li>
          </ul>
        </div>
      </div>
      <div class="sf-copy">© 2026 ${esc(t("brand"))} · Brought to you by <b>AIgniters</b></div>
    </footer>
  `;
}
/** Government identity rows (strip + logos + tricolour) shared by the officer portal header. */
export function govIdentity() {
  const h = citizenHeader("home");
  return h.slice(h.indexOf('<div class="ph-strip">'), h.indexOf('<div class="ph-navrow">'));
}
