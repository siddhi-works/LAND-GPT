// Services (#/services): eight government land services. Each card has its own state selector and opens
// that state's official service in a new browser tab.
import { setContext } from "./context.js";
import { t } from "./i18n.js";
import { STATES } from "./states.js";
import { bindLang, citizenHeader, esc, icon, siteFooter } from "./ui.js";

// Official destinations per service and state; the second value lists what that state's service covers.
const SERVICES = [
  { key: "records", title: "View Land Records", ic: "register", links: {
    MH: ["https://bhulekh.mahabhumi.gov.in/", "7/12 · 8A · Ferfar · Property Card"],
    UP: ["https://upbhulekh.gov.in/", "Khatauni · Khasra"],
    GJ: ["https://anyror.gujarat.gov.in/", "VF 7/12 · VF 8A"] } },
  { key: "search", title: "Search Property", ic: "search", links: {
    MH: ["https://mahabhumi.gov.in/Mahabhumilink/", "Search by survey / Gat number · Property Card"],
    UP: ["https://upbhulekh.gov.in/", "Search by Khasra / Gata or Khata number"],
    GJ: ["https://anyror.gujarat.gov.in/", "Search by survey number or owner name"] } },
  { key: "mutation", title: "Mutation Services", ic: "swap", links: {
    MH: ["https://ehakk.mahabhumi.gov.in/pdemis/frm_UserDashboard.aspx", "e-Hakk application · Ferfar status"],
    UP: ["https://upbhulekh.gov.in/", "Namantaran (नामान्तरण) status"],
    GJ: ["https://iora.gujarat.gov.in/", "VF 6 mutation entry · iORA application"] } },
  { key: "map", title: "View Land Map", ic: "map", links: {
    MH: ["https://mahabhumi.gov.in/Mahabhumilink/", "Village maps · Bhu-Naksha"],
    UP: ["https://upbhunaksha.gov.in/", "BhuNaksha village maps"],
    GJ: ["https://revenuedepartment.gujarat.gov.in/iora-service", "Village maps · iORA services"] } },
  { key: "registration", title: "Property Registration", ic: "building", links: {
    MH: ["https://igrmaharashtra.gov.in/", "IGR Maharashtra · deed registration"],
    UP: ["https://igrsup.gov.in/", "IGRSUP · deed registration"],
    GJ: ["https://revenuedepartment.gujarat.gov.in/iora-service", "Registration services · Revenue Department"] } },
  { key: "documents", title: "Registered Documents", ic: "audit", links: {
    MH: ["https://igrmaharashtra.gov.in/", "Search registered documents · IGR"],
    UP: ["https://igrsup.gov.in/", "Registered document search · IGRSUP"],
    GJ: ["https://revenuedepartment.gujarat.gov.in/iora-service", "Registered document services"] } },
  { key: "disputes", title: "Disputes & Cases", ic: "gavel", links: {
    MH: ["https://mahabhumi.gov.in/Mahabhumilink/", "Revenue case services"],
    UP: ["https://vaad.up.nic.in/", "Revenue court cases (वाद)"],
    GJ: ["https://revenuedepartment.gujarat.gov.in/iora-service", "Revenue appeals and cases"] } },
  { key: "valuation", title: "Valuation Rates", ic: "rupee", links: {
    MH: ["https://igrmaharashtra.gov.in/", "Ready Reckoner (ASR) rates"],
    UP: ["https://igrsup.gov.in/", "Circle rates"],
    GJ: ["https://revenuedepartment.gujarat.gov.in/iora-service", "Jantri rates"] } },
];

const chosen = {};                                  // remembered state per card while the app is open

function card(s) {
  // No state is pre-selected: details and the link appear only once the user picks a state.
  const code = chosen[s.key] || "";
  const [url, desc] = code ? s.links[code] : [];
  return `<section class="gsvc" data-k="${s.key}">
    <h2>${icon[s.ic]}${esc(t("sv_" + s.key))}</h2>
    <select class="select" id="st-${s.key}" data-st="${s.key}" aria-label="${esc(t("svSelectState"))}">
      <option value="" ${code ? "" : "selected"} disabled>${esc(t("svSelectState"))}</option>${Object.entries(STATES).map(([c, st]) =>
        `<option value="${c}" ${c === code ? "selected" : ""}>${esc(st.name)} · ${esc(st.native)}</option>`).join("")}</select>
    <div class="gsvc-avail">${code ? `<small>${esc(t("svAvail"))}</small><b>${esc(STATES[code].name)}</b><span>${esc(t(`svd_${s.key}_${code}`))}</span>`
      : `<span class="muted">${esc(t("svPick"))}</span>`}</div>
    ${code ? `<a class="btn gsvc-go" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t("svOpen"))} ${icon.right}</a>`
      : `<button class="btn gsvc-go" type="button" disabled>${esc(t("svOpen"))} ${icon.right}</button>`}
  </section>`;
}

export function renderServices(root, rerender) {
  setContext({ page: "services" }, { replace: true });
  root.innerHTML = `<div class="page services-page">
    ${citizenHeader("services")}
    <main class="region-main">
      <div class="wrap">
        <div class="svc-head"><h1>${esc(t("digitalServices"))}</h1></div>
        <div class="gsvc-grid" id="gsvc">${SERVICES.map(card).join("")}</div>
      </div>
    </main>
    ${siteFooter()}</div>`;
  bindLang(root, rerender);
  root.querySelector("#gsvc").addEventListener("change", (e) => {
    const k = e.target.dataset.st;
    if (!k) return;
    chosen[k] = e.target.value;
    root.querySelector(`.gsvc[data-k="${k}"]`).outerHTML = card(SERVICES.find((s) => s.key === k));
    root.querySelector(`#st-${k}`).focus();
  });
}
