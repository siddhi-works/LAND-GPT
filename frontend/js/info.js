// FAQs (#/faq) and Contact Us (#/contact). Contact details are sample placeholders for the portal helpdesk.
import { baseLayer } from "./map.js";
import { setContext } from "./context.js";
import { t } from "./i18n.js";
import { STATES } from "./states.js";
import { bindLang, citizenHeader, esc, icon, siteFooter } from "./ui.js";

const L = window.L;

const FAQS = Array.from({ length: 12 }, (_, i) => [`faq_q${i + 1}`, `faq_a${i + 1}`]);

export function renderFaq(root, rerender) {
  setContext({ page: "faq" }, { replace: true });
  root.innerHTML = `<div class="page info-page">${citizenHeader("faq")}
    <main class="region-main"><div class="wrap narrow">
      <div class="svc-head"><h1>${esc(t("faqTitle"))}</h1></div>
      <div class="faq-list">${FAQS.map(([q, a], i) => `<details class="faq" ${i === 0 ? "open" : ""}><summary>${esc(t(q))}${icon.right}</summary><p>${esc(t(a))}</p></details>`).join("")}</div>
      <p class="fine">${esc(t("faqMore"))} <a href="#/contact">${esc(t("faqContact"))}</a>.</p>
    </div></main>${siteFooter()}</div>`;
  bindLang(root, rerender);
}

// Sample helpdesk office in New Delhi.
const OFFICE = { lat: 28.5672, lon: 77.1765 };

export function renderContact(root, rerender) {
  setContext({ page: "contact" }, { replace: true });
  const row = (ic, label, value) => `<li>${icon[ic]}<span><small>${esc(label)}</small><b>${value}</b></span></li>`;
  root.innerHTML = `<div class="page info-page">${citizenHeader("contact")}
    <main class="region-main"><div class="wrap">
      <div class="svc-head"><h1>${esc(t("ct_title"))}</h1></div>
      <div class="contact-grid">
        <section class="panel"><header><h2>${icon.building} ${esc(t("ct_helpdesk"))}</h2></header><div class="body">
          <ul class="contact-list">
            ${row("pin", t("ct_address"), esc(t("ct_addressV")))}
            ${row("bell", t("ct_tollfree"), "1800-000-5263")}
            ${row("register", t("ct_phone"), "011-2600 0000")}
            ${row("link", t("ct_email"), "helpdesk@landgpt.example.in")}
            ${row("work", t("ct_hours"), esc(t("ct_hoursV")))}
          </ul>
          <h3 class="sec-title">${esc(t("ct_states"))}</h3>
          <table class="tbl"><thead><tr><th>${esc(t("state"))}</th><th>${esc(t("ct_helpline"))}</th><th>${esc(t("ct_email"))}</th></tr></thead><tbody>
            <tr><td>${esc(STATES.MH.name)}</td><td>1800-000-5264</td><td>mh.helpdesk@landgpt.example.in</td></tr>
            <tr><td>${esc(STATES.UP.name)}</td><td>1800-000-5265</td><td>up.helpdesk@landgpt.example.in</td></tr>
            <tr><td>${esc(STATES.GJ.name)}</td><td>1800-000-5266</td><td>gj.helpdesk@landgpt.example.in</td></tr>
          </tbody></table>
        </div></section>
        <section class="panel"><header><h2>${icon.map} ${esc(t("ct_location"))}</h2></header><div class="contact-map" id="cmap"></div>
          <p class="fine" style="padding:0 14px 12px">${esc(t("ct_place"))}. ${esc(t("ct_metro"))}</p></section>
      </div>
    </div></main>${siteFooter()}</div>`;
  bindLang(root, rerender);
  const m = L.map(root.querySelector("#cmap"), { scrollWheelZoom: false }).setView([OFFICE.lat, OFFICE.lon], 15);
  baseLayer("map").addTo(m);
  L.marker([OFFICE.lat, OFFICE.lon]).addTo(m).bindPopup(`<b>${esc(t("ct_helpdesk"))}</b><br>${esc(t("ct_place"))}`).openPopup();
  return () => m.remove();
}
