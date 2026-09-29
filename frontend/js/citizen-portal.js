// Citizen Portal: #/citizen -> choose a state (#/citizen/<slug>) or look up a parcel directly.
// Everything here reuses the registry-backed pieces: discovery form, state pages, map, profile, services.
import { setContext, recentParcel } from "./context.js";
import { mountDiscovery, parcelCardHtml } from "./discovery.js";
import { LANGS, getLang, setLang, t } from "./i18n.js";
import { SLUG, mountStateMinis, stateCardsHtml } from "./region.js";
import { REGION, STATES } from "./states.js";
import { bindLang, citizenHeader, disclaimer, emptyState, esc, icon, siteFooter, toast } from "./ui.js";

export function renderCitizenPortal(root, rerender) {
  setContext({ page: "citizen" }, { replace: true });
  const recent = recentParcel();
  const svc = [
    ["map", "landMap", "cpMapD", "#/map"],
    ["register", "landRecords", "cpRecordsD", "#/state"],
    ["search", "svcUlpinSearch", "cpUlpinD", "#cp-find"],
    ["chart", "navDashboard", "cpDashD", "#/dashboard"],
    ["grid", "digitalServices", "cpHubD", "#/services"],
    ["spark", "chatTitle", "svcAskD", "chat"],
  ];
  root.innerHTML = `<div class="page citizen-portal">
    ${citizenHeader("citizen")}
    <main class="region-main">
      <section class="cp-hero">
        <div class="wrap cp-hero-in">
          <div>
            <div class="eyebrow">${esc(t("brand"))}</div>
            <h1>${esc(t("citizenPortal"))}</h1>
            <p>${esc(t("cpIntro"))}</p>
          </div>
          <div class="cp-lang" role="group" aria-label="${esc(t("cpLanguage"))}">
            <span class="eyebrow">${esc(t("cpLanguage"))}</span>
            <div class="seg">${LANGS.map(([k, n]) => `<button data-lang="${k}" class="${getLang() === k ? "on" : ""}" lang="${k}">${esc(n)}</button>`).join("")}</div>
            <small>${Object.entries(REGION).map(([c, r]) => `${esc(STATES[c].name)} → ${esc(LANGS.find(([k]) => k === r.lang)[1])}`).join(" · ")}</small>
          </div>
        </div>
      </section>

      <div class="wrap">
        <section class="cp-block">
          <div class="sec-intro"><h2>${esc(t("cpChooseState"))}</h2><p>${esc(t("cpChooseStateD"))}</p></div>
          ${stateCardsHtml((code) => `#/citizen/${SLUG[code]}`)}
        </section>

        <section class="cp-block" id="cp-find">
          <div class="sec-intro"><h2>${esc(t("cpLookup"))}</h2><p>${esc(t("exploreLandInfoD"))}</p></div>
          <div class="explore-grid">
            <div class="panel explore-form"><div class="body"><div id="disc"></div></div></div>
            <div class="panel explore-result" id="xresult">${recent
              ? `<div class="sel-parcel"><div class="eyebrow">${esc(t("recentParcel"))}</div><div class="sp-head"><b>${esc(recent.native_label)}</b></div>
                 <p class="muted">${esc(recent.village)}, ${esc(recent.district)} · ${esc(STATES[recent.state_code]?.name || "")}</p>
                 <div class="res-actions"><a class="btn primary" href="#/parcel/${recent.ulpin}">${esc(t("openProfile"))}</a><a class="btn" href="#/map/${recent.ulpin}">${esc(t("viewOnMap"))}</a></div></div>`
              : emptyState(t("selectParcelHint"), t("selectParcelHintD"), icon.pin)}</div>
          </div>
        </section>

        <section class="cp-block">
          <div class="sec-intro"><h2>${esc(t("cpServices"))}</h2><p>${esc(t("cpServicesD"))}</p></div>
          <div class="svc-grid">${svc.map(([ic, tk, dk, href]) => {
            const attrs = href === "chat" ? `href="#" data-chat=""` : href.startsWith("#cp-") ? `href="#" data-jump="${href.slice(1)}"` : `href="${href}"`;
            return `<a class="svc-card" ${attrs}><span class="svc-ic">${icon[ic]}</span><span class="svc-t"><b>${esc(t(tk))}</b></span>
              <span class="svc-d">${esc(t(dk))}</span><span class="svc-tag ${href === "chat" ? "" : "live"}">${esc(t(href === "chat" ? "badgeDemo" : "available"))}</span></a>`;
          }).join("")}</div>
        </section>
      </div>
    </main>
    ${siteFooter()}${disclaimer()}</div>`;

  bindLang(root, rerender);
  root.querySelectorAll("[data-lang]").forEach((b) => b.onclick = () => { setLang(b.dataset.lang); rerender(); });
  root.querySelectorAll("[data-jump]").forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    root.querySelector("#" + a.dataset.jump).scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => root.querySelector('[data-kind="ULPIN"]')?.click(), 400);
  });

  mountDiscovery(root.querySelector("#disc"), {
    onChange: (sel) => setContext({ page: "citizen", state: sel.state, district: sel.district, sub_district: sel.sub, village: sel.village, ulpin: sel.ulpin || null }, { replace: true }),
    onParcel: (p) => {
      const box = root.querySelector("#xresult");
      box.innerHTML = parcelCardHtml(p) + `<div class="cp-more"><a href="#/citizen/${SLUG[p.state_code]}">${esc(REGION[p.state_code].titleEn)} ${icon.right}</a></div>`;
      box.classList.add("filled");
      toast(t("parcelSelected"), "ok");
    },
  });

  let minis = () => {};
  mountStateMinis(root).then((c) => { minis = c; });
  return () => minis();
}
