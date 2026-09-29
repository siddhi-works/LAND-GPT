// Digital Land Services hub (#/services). Every service either opens a working screen in this portal or
// says plainly that it needs a backend that does not exist yet (and which one). Parcel-based services
// use one shared parcel chooser: pick a parcel once, then open any of them for it.
import { api } from "./api.js";
import { openChat } from "./chat.js";
import { recentParcel, rememberParcel, setContext } from "./context.js";
import { mountDiscovery } from "./discovery.js";
import { t } from "./i18n.js";
import { SLUG } from "./region.js";
import { STATES } from "./states.js";
import { bindLang, citizenHeader, disclaimer, esc, fmtUlpin, icon, siteFooter, toast } from "./ui.js";

// status: live = works on the connected (demo) dataset · demo = prototype behaviour · soon / backend = not built
const CATS = [
  ["cat_records", "register", [
    { ic: "register", tk: "landRecords", dk: "svcRecordsD", st: "live", href: "#/state" },
    { ic: "search", tk: "svcParcelSearch", dk: "svcParcelSearchD", st: "live", parcel: "" },
    { ic: "search", tk: "svcUlpinSearch", dk: "cpUlpinD", st: "live", parcel: "", kind: "ULPIN" },
    { ic: "search", tk: "svcSurveySearch", dk: "svcSurveySearchD", st: "live", parcel: "", kind: "native" },
    { ic: "register", title: "7/12 · 8A · Property Card · Ferfar", sub: "Maharashtra", st: "live", href: `#/citizen/${SLUG.MH}` },
    { ic: "register", title: "Khatauni · Khasra · Namantaran", sub: "Uttar Pradesh", st: "live", href: `#/citizen/${SLUG.UP}` },
    { ic: "register", title: "VF 7/12 · VF 8A · VF 6", sub: "Gujarat", st: "live", href: `#/citizen/${SLUG.GJ}` },
    { ic: "register", title: "K-Prat", sub: "Maharashtra", st: "backend", need: "needKprat" },
  ]],
  ["cat_gis", "map", [
    { ic: "map", tk: "landMap", dk: "cpMapD", st: "live", href: "#/map" },
    { ic: "pin", tk: "svcParcelMap", dk: "svcParcelMapPD", st: "live", parcel: "@map" },
    { ic: "area", tk: "svcSurveyInfo", dk: "svcSurveyInfoD", st: "live", parcel: "gis" },
    { ic: "chart", tk: "navDashboard", dk: "cpDashD", st: "live", href: "#/dashboard" },
  ]],
  ["cat_owner", "user", [
    { ic: "user", tk: "svcOwnership", dk: "svcOwnershipD", st: "live", parcel: "land" },
    { ic: "register", tk: "svcRor", dk: "svcRorD", st: "live", parcel: "land" },
    { ic: "swap", tk: "svcMutation", dk: "svcMutationD", st: "live", parcel: "mutation" },
    { ic: "work", tk: "timeline", dk: "timelineD", st: "live", parcel: "timeline" },
  ]],
  ["cat_property", "building", [
    { ic: "audit", tk: "secRegistration", dk: "cd_reg", st: "live", parcel: "registration" },
    { ic: "lock", tk: "secEncumbrance", dk: "cd_enc", st: "live", parcel: "encumbrance" },
    { ic: "rupee", tk: "secTax", dk: "cd_tax", st: "live", parcel: "tax" },
    { ic: "map", tk: "secPlanning", dk: "cd_planning", st: "live", parcel: "planning" },
    { ic: "building", tk: "secBuilding", dk: "cd_building", st: "live", parcel: "building" },
    { ic: "bolt", tk: "secUtilities", dk: "cd_util", st: "live", parcel: "utilities" },
    { ic: "leaf", tk: "secEnvironment", dk: "cd_env", st: "live", parcel: "environment" },
  ]],
  ["cat_verify", "shield", [
    { ic: "shield", tk: "svcVerify", dk: "svcVerifyD", st: "live", parcel: "checks" },
    { ic: "link", tk: "connectedRecords", dk: "hubHint", st: "live", parcel: "records" },
    { ic: "spark", tk: "chatTitle", dk: "svcAskD", st: "assistant", chat: true },
    { ic: "lock", tk: "officerPortal", dk: "officerPortalD", st: "demo", href: "#/officer/login" },
  ]],
  ["cat_tx", "lock", [
    { ic: "swap", tk: "svcApplyMutation", dk: "svcApplyMutationD", st: "backend", need: "needMutation" },
    { ic: "register", tk: "svcCertifiedCopy", dk: "svcCertifiedCopyD", st: "backend", need: "needCopy" },
    { ic: "lock", tk: "svcEc", dk: "svcEcD", st: "soon", need: "needEc" },
    { ic: "rupee", tk: "svcPayment", dk: "svcPaymentD", st: "backend", need: "needPayment" },
  ]],
];
const BADGE = { live: ["live", "available"], demo: ["", "badgeDemo"], soon: ["soon", "badgeSoon"], backend: ["off", "badgeBackend"] };

export function renderServices(root, rerender) {
  setContext({ page: "services" }, { replace: true });
  let parcel = recentParcel();
  let pending = null;                       // service waiting for a parcel
  let assistant = { mode: "demo" };

  const svcName = (s) => s.tk ? t(s.tk) : s.title;
  const card = (s, ci, i) => {
    const [cls, label] = s.st === "assistant" ? (assistant.mode === "ai" ? ["live", "available"] : ["", "badgeDemo"]) : BADGE[s.st];
    const id = `${ci}:${i}`;
    return `<button class="svc-card ${s.st === "backend" || s.st === "soon" ? "off" : ""}" data-svc="${id}">
      <span class="svc-ic">${icon[s.ic]}</span>
      <span class="svc-t"><b>${esc(svcName(s))}</b>${s.sub ? `<small>${esc(s.sub)}</small>` : ""}</span>
      <span class="svc-d">${esc(s.dk ? t(s.dk) : "")}</span>
      <span class="svc-tag ${cls}">${esc(t(label))}</span>
      ${s.parcel != null ? `<span class="svc-needs">${icon.pin}${esc(t("svcNeedsParcel"))}</span>` : ""}
    </button>`;
  };

  root.innerHTML = `<div class="page services-page">
    ${citizenHeader("services")}
    <main class="region-main">
      <div class="wrap">
        <div class="sec-intro"><h1>${esc(t("digitalServices"))}</h1><p>${esc(t("svcHubD"))}</p></div>
        <div class="badge-key">${["live", "demo", "soon", "backend"].map((k) => `<span class="svc-tag ${BADGE[k][0]}">${esc(t(BADGE[k][1]))}</span><small>${esc(t("key_" + k))}</small>`).join("")}</div>
        <div class="svc-layout">
          <div class="svc-cats" id="cats"></div>
          <aside class="panel svc-parcel" id="sp"></aside>
        </div>
      </div>
    </main>
    ${siteFooter()}${disclaimer()}
    <dialog class="svc-dlg" id="dlg"></dialog></div>`;
  bindLang(root, rerender);
  const $ = (s) => root.querySelector(s);

  function drawCats() {
    $("#cats").innerHTML = CATS.map(([tk, ic, items], ci) => `<section class="svc-cat">
      <h2 class="svc-cat-h"><span class="svc-ic">${icon[ic]}</span>${esc(t(tk))}</h2>
      <div class="svc-grid">${items.map((s, i) => card(s, ci, i)).join("")}</div></section>`).join("");
    root.querySelectorAll("[data-svc]").forEach((b) => b.onclick = () => { const [ci, i] = b.dataset.svc.split(":").map(Number); open(CATS[ci][2][i]); });
  }

  function drawParcel(kind) {
    $("#sp").innerHTML = `<header><h2>${icon.pin} ${esc(t("yourParcel"))}</h2></header><div class="body">
      ${pending ? `<div class="notice info">${icon.info}<span>${esc(t("choosingFor"))} <b>${esc(svcName(pending))}</b></span></div>` : ""}
      ${parcel ? `<div class="sp-cur"><b>${esc(parcel.native_label)}</b><small class="mono">${fmtUlpin(parcel.ulpin)}</small>
          <small>${esc(parcel.village)}, ${esc(parcel.district)} · ${esc(STATES[parcel.state_code]?.name || "")}</small>
          <div class="res-actions"><a class="btn sm primary" href="#/parcel/${parcel.ulpin}">${esc(t("openProfile"))}</a><button class="btn sm ghost" id="sp-change">${esc(t("changeParcel"))}</button></div></div>`
        : `<p class="fine">${esc(t("svcPickOnce"))}</p><div id="sp-disc"></div>`}
    </div>`;
    $("#sp-change")?.addEventListener("click", () => { parcel = null; drawParcel(); });
    if (!parcel) {
      mountDiscovery($("#sp-disc"), {
        onChange: (sel) => setContext({ page: "services", state: sel.state, district: sel.district, sub_district: sel.sub, village: sel.village, ulpin: sel.ulpin || null }, { replace: true }),
        onParcel: (p) => {
          parcel = p; rememberParcel(p); toast(t("parcelSelected"), "ok");
          if (pending) { const s = pending; pending = null; go(s); } else drawParcel();
        },
      });
      if (kind) setTimeout(() => $(`#sp [data-kind="${kind}"]`)?.click(), 300);
    }
    if (parcel) setContext({ page: "services", ulpin: parcel.ulpin, state: parcel.state_code }, { replace: true });
  }

  function go(s) {
    if (s.parcel === "@map") location.hash = `#/map/${parcel.ulpin}`;
    else location.hash = `#/parcel/${parcel.ulpin}${s.parcel ? "/" + s.parcel : ""}`;
  }

  function open(s) {
    if (s.href) { location.hash = s.href; return; }
    if (s.chat) { openChat(); return; }
    if (s.need) { info(s); return; }
    if (s.parcel != null) {
      if (parcel && !s.kind) { go(s); return; }
      pending = s; if (s.kind) parcel = null;          // a search service always starts a fresh lookup
      drawParcel(s.kind);
      $("#sp").scrollIntoView({ behavior: "smooth", block: "start" });
      $("#sp").classList.add("pulse"); setTimeout(() => $("#sp")?.classList.remove("pulse"), 1200);
      toast(t("svcPickParcel"), "info");
    }
  }

  function info(s) {
    const d = $("#dlg");
    const [cls, label] = BADGE[s.st];
    d.innerHTML = `<form method="dialog">
      <header><span class="svc-ic">${icon[s.ic]}</span><div><b>${esc(svcName(s))}</b><span class="svc-tag ${cls}">${esc(t(label))}</span></div>
        <button class="icon-btn" aria-label="${esc(t("close"))}">${icon.close}</button></header>
      <p>${esc(t("notInPrototype"))}</p>
      <div class="notice info">${icon.info}<span><b>${esc(t("wouldNeed"))}</b> ${esc(t(s.need))}</span></div>
      <p class="fine">${esc(t("noFakeService"))}</p>
      <div class="res-actions"><button class="btn primary">${esc(t("close"))}</button></div></form>`;
    d.showModal();
  }

  drawCats();
  drawParcel();
  api.chatStatus().then((st) => { assistant = st; drawCats(); }).catch(() => {});
}
