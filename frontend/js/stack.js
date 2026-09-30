// "What Land Stack connects": ONE PARCEL -> ULPIN -> connected record families -> services.
// Every card is built from the live source coverage (/analytics/data-quality + /reports/summary),
// so a record family only shows as connected for a state when that state's data actually has it.
import { api } from "./api.js";
import { recentParcel } from "./context.js";
import { t } from "./i18n.js";
import { REGION, STATES } from "./states.js";
import { esc, icon, pct, skeleton } from "./ui.js";

export const CONCEPTS = [
  { k: "land_record", tier: 0, ic: "register", tkey: "secLand", dkey: "cd_land", section: "land" },
  { k: "ownership", tier: 0, ic: "user", tkey: "cOwnership", dkey: "cd_owner", section: "land" },
  { k: "mutation", tier: 0, ic: "swap", tkey: "secMutation", dkey: "cd_mutation", section: "mutation" },
  { k: "registration", tier: 0, ic: "audit", tkey: "secRegistration", dkey: "cd_reg", section: "registration" },
  { k: "geometry", tier: 1, ic: "area", tkey: "secGis", dkey: "cd_gis", section: "gis" },
  { k: "land_use", tier: 1, ic: "layers", tkey: "secLandUse", dkey: "cd_landuse", section: "landuse" },
  { k: "planning", tier: 1, ic: "map", tkey: "secPlanning", dkey: "cd_planning", section: "planning" },
  { k: "building_permission", tier: 1, ic: "building", tkey: "secBuilding", dkey: "cd_building", section: "building" },
  { k: "encumbrance", tier: 2, ic: "lock", tkey: "secEncumbrance", dkey: "cd_enc", section: "encumbrance" },
  { k: "litigation", tier: 2, ic: "gavel", tkey: "cLitigation", dkey: "cd_lit", section: "encumbrance" },
  { k: "property_tax", tier: 2, ic: "rupee", tkey: "secTax", dkey: "cd_tax", section: "tax" },
  { k: "utilities", tier: 2, ic: "bolt", tkey: "secUtilities", dkey: "cd_util", section: "utilities" },
  { k: "environmental_restriction", tier: 2, ic: "leaf", tkey: "secEnvironment", dkey: "cd_env", section: "environment" },
];
const TIERS = ["tierRights", "tierSurvey", "tierLiabilities"];

/** Render the connected-stack diagram into `el`. Returns nothing; all handlers are scoped to `el`. */
export function mountStack(el) {
  el.innerHTML = skeleton(6);
  let filter = "", open = null, data = null;

  Promise.all([api.dataQuality(), api.reports()]).then(([dq, rep]) => {
    const cov = new Map(rep.coverage.map((c) => [`${c.state_code}:${c.source_table}`, c]));
    data = {};
    for (const c of CONCEPTS) {
      data[c.k] = {};
      for (const code of Object.keys(STATES)) {
        const rows = (dq.source_coverage[code] || []).filter((r) => r.concepts.includes(c.k) && r.source_table !== "core.parcel_registry");
        data[c.k][code] = rows.map((r) => ({ type: r.native_record_type, table: r.source_table, ...(cov.get(`${code}:${r.source_table}`) || {}) }));
      }
    }
    const tables = Object.values(dq.source_coverage).reduce((n, r) => n + r.length, 0);
    draw({ parcels: dq.registry.ulpins, tables, rules: dq.by_rule.length });
  }).catch(() => { el.innerHTML = `<div class="empty-state">${icon.alert}<b>${esc(t("dataUnavailable"))}</b></div>`; });

  function draw(fig) {
    const card = (c) => {
      const states = Object.keys(STATES).filter((code) => data[c.k][code].length);
      const on = !filter || states.includes(filter);
      const names = filter ? [...new Set(data[c.k][filter].map((x) => x.type))] : [];
      return `<button class="ls-card ${on ? "" : "off"} ${open === c.k ? "open" : ""}" data-c="${c.k}" aria-expanded="${open === c.k}">
        <span class="ls-ic">${icon[c.ic]}</span>
        <span class="ls-t"><b>${esc(t(c.tkey))}</b><small>${esc(t(c.dkey))}</small></span>
        ${filter ? `<span class="ls-native">${on ? names.map(esc).join(" · ") : esc(t("hubNotConnected"))}</span>` : ""}
      </button>`;
    };
    el.innerHTML = `
      <div class="lstack">
        <div class="ls-top">
          <div class="ls-node n-ulpin">${icon.register}<span><b>ULPIN</b><small>${esc(t("storyUlpinD"))}</small></span></div>
          <span class="ls-arrow" aria-hidden="true"></span>
          <div class="ls-node n-parcel">${icon.area}<span><b>${esc(t("storyParcel"))}</b><small>${esc(t("storyParcelD"))}</small></span></div>
        </div>
        <div class="ls-tiers">${TIERS.map((tk, i) => `
          <div class="ls-tier"><div class="ls-tier-h"><i>${i + 1}</i>${esc(t(tk))}</div>
            <div class="ls-cards">${CONCEPTS.filter((c) => c.tier === i).map(card).join("")}</div></div>`).join("")}
        </div>
        <div class="ls-detail" id="ls-detail" ${open ? "" : "hidden"}>${open ? detail(open) : ""}</div>
      </div>`;
    el.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(fig); });
    el.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => {
      open = open === b.dataset.c ? null : b.dataset.c;
      draw(fig);
      if (open) el.querySelector("#ls-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    el.querySelector("[data-close]")?.addEventListener("click", () => { open = null; draw(fig); });
  }

  function detail(k) {
    const c = CONCEPTS.find((x) => x.k === k);
    const recent = recentParcel();
    const rows = Object.keys(STATES).filter((code) => !filter || code === filter).map((code) => {
      const items = data[k][code];
      const R = REGION[code];
      const rec = R.records.find((r) => r.connected !== false && items.some((x) => x.type === r.native));
      return `<div class="lsd-row" style="--sc:${R.accent}">
        <div class="lsd-state"><b>${esc(STATES[code].name)}</b><small>${esc(STATES[code].system)}</small></div>
        <div class="lsd-items">${items.length ? items.map((x) => `<div class="lsd-item"><span><b>${esc(x.type)}</b><code>${esc(x.table)}</code></span>
          ${x.parcels ? `<span class="lsd-bar" title="${x.linked}/${x.parcels}"><i style="width:${pct(x.linked, x.parcels)}%"></i></span><small>${x.linked}/${x.parcels} ULPIN</small>` : ""}</div>`).join("")
          : `<span class="muted">${esc(t("hubNotConnected"))}</span>`}</div>
        <div class="lsd-act">${rec ? `<a class="btn sm" href="#/state/${code}/${rec.key}">${esc(rec.en)} ${icon.right}</a>` : items.length ? `<a class="btn sm" href="#/state/${code}">${esc(t("landRecords"))} ${icon.right}</a>` : ""}</div>
      </div>`;
    }).join("");
    return `<div class="lsd-head"><span class="ls-ic">${icon[c.ic]}</span><div><b>${esc(t(c.tkey))}</b><p>${esc(t(c.dkey))}</p></div>
        <button class="icon-btn" data-close aria-label="${esc(t("close"))}">${icon.close}</button></div>
      <div class="lsd-rows">${rows}</div>
      <div class="lsd-foot"><span class="fine">${esc(t("lsLinkage"))}</span>
        ${recent ? `<a class="btn sm primary" href="#/parcel/${recent.ulpin}/${c.section}">${esc(t("lsOpenRecent"))}: ${esc(recent.native_label)}</a>` : `<a class="btn sm primary" href="#/explore">${esc(t("svcPickParcel"))}</a>`}</div>`;
  }
}
