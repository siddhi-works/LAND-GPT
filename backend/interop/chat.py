"""BhuSamhita Assistant: the conversational endpoint behind the portal's chat window.

Frontend -> POST /v1/chat -> provider (Anthropic | OpenAI | Gemini | demo) -> reply.

* The provider is chosen on the server from environment variables; API keys never reach the browser.
    LANDSTACK_CHAT_PROVIDER   anthropic | openai | gemini   (optional; default: anthropic when a key is set)
    ANTHROPIC_API_KEY         Anthropic (model: LANDSTACK_ASSISTANT_MODEL, see assistant.py)
    OPENAI_API_KEY            OpenAI  (model: LANDSTACK_CHAT_MODEL, required)
    GEMINI_API_KEY            Gemini  (model: LANDSTACK_CHAT_MODEL, required)
* With no configured provider the assistant answers from a fixed knowledge base (API mode "demo"):
  land-record terms, offices and where to find records, plus facts read from the open parcel's
  records. It never generates free text and never invents parcel facts.
* Grounding is built server-side from the ULPIN / location the page reports; client-sent record data
  is never trusted.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from . import assistant, portal
from .assistant import AssistantUnavailable
from .service import LandStackService

STATES = {"MH": "Maharashtra", "UP": "Uttar Pradesh", "GJ": "Gujarat"}
LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "gu": "Gujarati"}
PROVIDERS = ("anthropic", "openai", "gemini")

SYSTEM_PROMPT = """You are the BhuSamhita Assistant inside BhuSamhita ("Bharat's Land. One Connected System."), a citizen land-information portal for Maharashtra, Uttar Pradesh and Gujarat. It connects each state's existing land systems (records of rights, registration, mutation, survey/GIS, planning, tax, utilities) through a common parcel identifier, the ULPIN.

You are first a general land-information assistant: explain land terms (Gat, survey number, 7/12, 8A, Khatauni, Khasra, VF 7/12, VF 6, mutation, encumbrance), where a citizen can find a record, and which department or office handles a land service. Keep answers practical and simple.

Each user turn may start with <app_context> JSON describing what the user is looking at: the page, the selected state/district/taluka or tehsil/village, and - when a parcel is open - that parcel's connected records and cross-record validation findings retrieved from Land Stack.

Rules:
- For facts about a specific parcel, place or record use ONLY <app_context>. If it is not there, say it is not available in the connected records. Never guess owners, areas, dates, amounts or outcomes.
- You may explain general land-record concepts (ULPIN, 7/12, 8A, Property Card, Ferfar, Khatauni, Khasra, Namantaran, BhuNaksha, VF 6, VF 7/12, VF 8A, mutation, encumbrance). Be accurate and say when practice varies by state.
- Verification here means consistency checks across connected records, not legal certification. Give no legal advice; name the office that handles a process instead.
- To help the user navigate, you may point to portal pages: Land Map, the state land-information pages, a parcel's Unified Land Profile, and Government Officer Login.
- Reply in {language}. Keep state terms (7/12, Khatauni, VF 6 ...) as they are. Be concise: short paragraphs or a short list."""


class ChatError(ValueError):
    """Bad request to the chat endpoint (400)."""


# ---------------------------------------------------------------------------------------------
# provider selection
# ---------------------------------------------------------------------------------------------

def _provider_config() -> dict[str, Any]:
    wanted = os.environ.get("LANDSTACK_CHAT_PROVIDER", "").strip().lower()
    if wanted and wanted not in PROVIDERS:
        return {"provider": wanted, "configured": False, "reason": f"Unknown LANDSTACK_CHAT_PROVIDER '{wanted}'. Use one of: {', '.join(PROVIDERS)}."}
    name = wanted or ("anthropic" if assistant.configured() else "")
    if not name:
        return {"provider": None, "configured": False, "reason": "No AI provider is configured on the server."}
    if name == "anthropic":
        ok = assistant.configured()
        return {"provider": name, "model": assistant.model(), "configured": ok,
                "reason": None if ok else "Set ANTHROPIC_API_KEY on the server."}
    key_env = {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}[name]
    m = os.environ.get("LANDSTACK_CHAT_MODEL", "").strip()
    missing = [e for e, v in ((key_env, os.environ.get(key_env)), ("LANDSTACK_CHAT_MODEL", m)) if not v]
    return {"provider": name, "model": m or None, "configured": not missing,
            "reason": f"Set {' and '.join(missing)} on the server." if missing else None}


def status() -> dict[str, Any]:
    c = _provider_config()
    return {"mode": "ai" if c["configured"] else "demo", "provider": c["provider"] if c["configured"] else "demo",
            "model": c.get("model") if c["configured"] else None, "reason": c.get("reason"),
            "providers": list(PROVIDERS)}


def _openai(system: str, messages: list[dict[str, str]], model: str) -> str:
    body = {"model": model, "messages": [{"role": "system", "content": system}, *messages]}
    data = _post_json("https://api.openai.com/v1/chat/completions", body,
                      {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"})
    return (data["choices"][0]["message"].get("content") or "").strip()


def _gemini(system: str, messages: list[dict[str, str]], model: str) -> str:
    body = {"systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages]}
    data = _post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", body,
                      {"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts).strip()


def _post_json(url: str, body: dict, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise AssistantUnavailable(f"The AI provider returned an error ({e.code}).") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise AssistantUnavailable("The AI provider could not be reached.") from e


# ---------------------------------------------------------------------------------------------
# grounding
# ---------------------------------------------------------------------------------------------

def _clean(v: Any, n: int = 80) -> str | None:
    return str(v).strip()[:n] or None if v not in (None, "") else None


def build_context(svc: LandStackService, ctx: dict[str, Any] | None) -> dict[str, Any]:
    """Resolve what the user is looking at, from the registries only."""
    ctx = ctx or {}
    out: dict[str, Any] = {"page": _clean(ctx.get("page"), 40)}
    ulpin = _clean(ctx.get("ulpin"), 20)
    if ulpin:
        out["parcel"] = assistant.context(svc, ulpin)          # raises UlpinError (404) if unknown
        j = out["parcel"]["jurisdiction"]
        out["location"] = {"state": out["parcel"]["state"], "district": j.get("district"),
                           "sub_district": j.get("sub_district"), "sub_district_type": j.get("sub_district_type"),
                           "village": j.get("village")}
        return out
    code = (_clean(ctx.get("state"), 4) or "").upper()
    if code in STATES:
        st = next((s for s in portal.hierarchy(svc)["states"] if s["code"] == code), None)
        loc: dict[str, Any] = {"state": STATES[code], "state_code": code, "sub_district_type": st["sub_district_type"] if st else None}
        d = next((x for x in (st or {}).get("districts", []) if x["name"] == ctx.get("district")), None)
        s = next((x for x in (d or {}).get("sub_districts", []) if x["name"] == ctx.get("sub_district")), None)
        v = next((x for x in (s or {}).get("villages", []) if x["name"] == ctx.get("village")), None)
        node = v or s or d or st
        if d: loc["district"] = d["name"]
        if s: loc["sub_district"] = s["name"]
        if v: loc["village"] = v["name"]
        if st:
            loc["districts_in_state"] = len(st["districts"])
        if d and not v:
            loc["sub_districts"] = [x["name"] for x in d["sub_districts"]] if not s else None
            loc["villages"] = [x["name"] for x in (s["villages"] if s else [vv for ss in d["sub_districts"] for vv in ss["villages"]])]
        if node:
            loc["ulpin_parcels"] = _count_ulpins(node)
        if d:
            rep = portal.reports(svc, code, d["name"])
            loc["parcels_with_findings"] = rep["parcels_with_findings"]
        out["location"] = {k: val for k, val in loc.items() if val is not None}
    return out


def _count_ulpins(node: dict) -> int:
    if "ulpins" in node:
        return len(node["ulpins"])
    return sum(_count_ulpins(c) for key in ("districts", "sub_districts", "villages") for c in node.get(key, []))


# ---------------------------------------------------------------------------------------------
# endpoint logic
# ---------------------------------------------------------------------------------------------

def reply(svc: LandStackService, messages: list[dict[str, str]], ctx: dict[str, Any] | None, lang: str = "en") -> dict[str, Any]:
    msgs = [{"role": m.get("role"), "content": str(m.get("content", "")).strip()[:2000]} for m in messages][-20:]
    if not msgs or msgs[-1]["role"] != "user" or not msgs[-1]["content"]:
        raise ChatError("The last message must be a non-empty user message.")
    if any(m["role"] not in ("user", "assistant") for m in msgs):
        raise ChatError("Message roles must be 'user' or 'assistant'.")
    while msgs and msgs[0]["role"] != "user":          # providers require the conversation to open with the user
        msgs.pop(0)
    lang = lang if lang in LANG_NAMES else "en"
    grounding = build_context(svc, ctx)
    info = _grounding_info(grounding)
    cfg = _provider_config()

    if not cfg["configured"]:
        out = demo_answer(msgs[-1]["content"], grounding)
        return {"mode": "demo", "provider": "demo", "model": None, "lang": "en", **out, "grounding": info}

    system = SYSTEM_PROMPT.replace("{language}", LANG_NAMES[lang])
    ctx_json = json.dumps(grounding, ensure_ascii=False, sort_keys=True, default=str)
    turns = msgs[:-1] + [{"role": "user", "content": f"<app_context>\n{ctx_json}\n</app_context>\n\n{msgs[-1]['content']}"}]
    if cfg["provider"] == "anthropic":
        r = assistant.anthropic_complete(system, turns, effort="low")
        text, used = r["text"], r["model"]
    elif cfg["provider"] == "openai":
        text, used = _openai(system, turns, cfg["model"]), cfg["model"]
    else:
        text, used = _gemini(system, turns, cfg["model"]), cfg["model"]
    if not text:
        raise AssistantUnavailable("The AI provider returned an empty answer.")
    return {"mode": "ai", "provider": cfg["provider"], "model": used, "lang": lang, "reply": text,
            "links": _links(grounding), "suggestions": [], "grounding": info}


def _grounding_info(g: dict) -> dict[str, Any]:
    p = g.get("parcel")
    return {"page": g.get("page"), "location": g.get("location"),
            "ulpin": p["ulpin"] if p else None,
            "records": [r["source"] for r in p["records"]] if p else [],
            "rules": [f["rule"] for f in p["validation"]["findings"]] if p else []}


def _links(g: dict) -> list[dict[str, str]]:
    p = g.get("parcel")
    if p:
        return [{"label": "Open Unified Land Profile", "href": f"#/parcel/{p['ulpin']}"},
                {"label": "View on Land Map", "href": f"#/map/{p['ulpin']}"}]
    loc = g.get("location") or {}
    if loc.get("state_code"):
        return [{"label": f"{loc['state']} land information", "href": f"#/state/{loc['state_code']}"}]
    return []


# ---------------------------------------------------------------------------------------------
# demo mode: deterministic, sourced answers
# ---------------------------------------------------------------------------------------------

KB: list[tuple[str, tuple[str, ...], str]] = [
    ("department", ("department", "which office", "what office", "who handles", "who deals", "whom to contact", "who to contact",
                    "which authority", "विभाग", "कार्यालय", "कचेरी", "વિભાગ", "કચેરી"),
     "**Who handles what** (office names differ by state):\n"
     "- **Record of rights and mutation** (7/12 & 8A · Khatauni & Khasra · VF 7/12, VF 8A & VF 6): the state **Revenue "
     "Department**. Maharashtra: Talathi (village), Mandal Adhikari / Circle Officer, Tahsildar. Uttar Pradesh: Lekhpal, "
     "Revenue Inspector, Tehsildar, under the Board of Revenue. Gujarat: Talati-cum-Mantri and the e-Dhara Kendra at the "
     "Mamlatdar office.\n"
     "- **Survey, maps and boundaries:** the land records / survey office - Maharashtra: Settlement Commissioner & Director "
     "of Land Records (City Survey office for Property Cards); Uttar Pradesh: Revenue Department (BhuNaksha village maps); "
     "Gujarat: District Inspector of Land Records (City Survey office for Property Cards).\n"
     "- **Registration of sale, gift or mortgage deeds:** the **Registration & Stamps Department** - the Sub-Registrar office.\n"
     "- **Property tax and water connection:** the municipal corporation / council, or the gram panchayat in villages.\n"
     "- **Building permission and zoning:** the planning or development authority, or the municipal body.\n\n"
     "Open a parcel's Unified Land Profile to see which of these records are connected for that land."),
    ("gat", ("what is gat", "what is a gat", "gat mean", "meaning of gat", "gat no", "gat number mean", "गट क्रमांक", "गट नंबर",
             "गट म्हणजे", "गट क्या", "ગટ શું", "ગટ નંબર"),
     "**Gat number** (गट क्रमांक) is the parcel number used in Maharashtra's village land records after consolidation of "
     "holdings: old survey numbers were regrouped into gats. It identifies the land on the 7/12 extract and the village map.\n\n"
     "Other areas use a **survey number** (with a hissa / part), Uttar Pradesh uses the **khasra / gata** number and Gujarat "
     "the **survey number** (with sub-division); towns use a City Survey (CTS) number.\n\n"
     "In BhuSamhita, choose the village and then the Gat / Survey / Khasra number, or type the number in the search box."),
    ("survey", ("what is survey number", "what is a survey number", "survey number mean", "survey no mean", "what is hissa",
                "सर्वे क्रमांक म्हणजे", "सर्वे नंबर क्या", "સર્વે નંબર શું"),
     "A **survey number** identifies a piece of land in the village land records and on the village map; a sub-division "
     "(hissa / part) splits it further. Maharashtra often uses a **Gat** number instead, Uttar Pradesh a **khasra / gata** "
     "number, and Gujarat the survey number with sub-division. Towns use City Survey (CTS) numbers on Property Cards."),
    ("ulpin", ("ulpin", "bhu-aadhaar", "bhu aadhaar", "unique land parcel", "land parcel identification"),
     "**ULPIN** (Unique Land Parcel Identification Number) is a 14-digit alphanumeric identifier for a land parcel, "
     "introduced by the Department of Land Resources under DILRMP. It is generated from the geo-coordinates of the "
     "parcel's boundary vertices on georeferenced cadastral maps, with the state revenue administration generating it.\n\n"
     "In BhuSamhita every parcel is looked up by its ULPIN. The ULPIN registry maps it to the state, jurisdiction and the "
     "state's own parcel number (Survey/Gat, Khasra, Survey No.), so records held by different departments can be read "
     "together."),
    ("712", ("7/12", "7-12", "712", "७/१२", "सातबारा", "satbara", "saat baara", "record of rights maharashtra"),
     "The **7/12 extract** (सातबारा उतारा) is Maharashtra's record of rights for land. It combines Village Form VII "
     "(occupants and rights) and Village Form XII (cultivation and crop details) for a survey or gat number: area, "
     "holders, tenure, encumbrance notes and crops.\n\nChanges of ownership are first entered as a mutation (Ferfar) "
     "and reflected on the 7/12 after certification.\n\nOn the Maharashtra land-information page, choose **7/12**, then "
     "district → taluka → village → survey/gat number."),
    ("8a", ("8a", "8-a", "८अ", "८ अ", "khata extract", "holding extract"),
     "The **8A extract** (८अ, holding / khata extract) lists every survey or gat number held by one account holder "
     "(khatedar) in a village, with the area of each holding.\n\nWhere 7/12 is organised by parcel, 8A is organised by "
     "account. On the Maharashtra land-information page, choose **8A** and select the parcel."),
    ("propertycard", ("property card", "मालमत्ता पत्रक", "malmatta", "city survey", "cts"),
     "A **Property Card** (मालमत्ता पत्रक) is the record of rights for land in City Survey (urban) areas, maintained by "
     "the land records department's City Survey office. It is identified by a City Survey / CTS number rather than a "
     "survey or gat number. Maharashtra and Gujarat both maintain property cards.\n\nNot every parcel has a property card: "
     "rural land is recorded on the 7/12 (Maharashtra) or VF 7/12 (Gujarat)."),
    ("kprat", ("k-prat", "kprat", "k prat", "क-प्रत", "क प्रत"),
     "K-Prat appears as a record type on Maharashtra's land-record portal, but it is **not yet connected to BhuSamhita**, "
     "so BhuSamhita cannot show its contents. The connected Maharashtra records are 7/12, 8A, Ferfar, Property Card and "
     "registration documents."),
    ("ferfar", ("ferfar", "फेरफार", "e-ferfar", "mutation entry maharashtra"),
     "**Ferfar** (फेरफार) is Maharashtra's mutation entry: when rights change (sale, inheritance, mortgage), the Talathi "
     "records the entry and serves notice, objections go to the register of disputed cases, and the Mandal Adhikari "
     "(Circle Officer) certifies it under the Maharashtra Land Revenue Code, 1966, s.150. The 7/12 and 8A are then updated."),
    ("khatauni", ("khatauni", "खतौनी"),
     "**Khatauni** (खतौनी) is Uttar Pradesh's record of rights: an account-wise (khata) register listing the tenure "
     "holders of each account and the plots (khasra numbers) it contains. It is published through UP Bhulekh."),
    ("khasra", ("khasra", "खसरा"),
     "**Khasra** (खसरा) is the plot-wise field register in Uttar Pradesh: for each plot number it records area, land "
     "class and cultivation details. The khasra number identifies the plot on the village map (BhuNaksha)."),
    ("namantaran", ("namantaran", "नामांतरण", "नामान्तरण", "dakhil kharij"),
     "**Namantaran** (नामान्तरण) is mutation in Uttar Pradesh's revenue records - updating the Khatauni after a transfer "
     "or succession. It is decided at the tehsil under the UP Revenue Code, 2006 (s.34), after the Lekhpal / Revenue "
     "Inspector report and the Tehsildar's order."),
    ("bhunaksha", ("bhunaksha", "bhu naksha", "भू नक्शा", "cadastral map"),
     "**BhuNaksha** is the digitised cadastral (village) map system: it shows plot boundaries with their plot numbers. "
     "In BhuSamhita the parcel boundary is compared with the recorded area; a difference above 5% is flagged (rule GIS-001)."),
    ("vf6", ("vf 6", "vf6", "vf-6", "hakk patrak", "હક્ક પત્રક", "ferfar gujarat"),
     "**VF 6** (Village Form 6, હક્ક પત્રક) is Gujarat's mutation register. An entry made at the e-Dhara Kendra is "
     "verified, a 135-D notice is served (30 days), and after certification VF 7/12 and VF 8A are updated."),
    ("vf712", ("vf 7/12", "vf7/12", "vf 7-12", "anyror", "gujarat 7/12", "e-dhara"),
     "**VF 7/12** is Gujarat's record of rights for a survey number (area, holders, rights and crops), maintained through "
     "e-Dhara and viewable on AnyROR. **VF 8A** lists all survey numbers held by one account holder."),
    ("encumbrance", ("encumbrance", "mortgage", "loan", "charge", "बोजा", "litigation", "court case"),
     "An **encumbrance** is a charge on land such as a mortgage, lien or court attachment. In BhuSamhita, encumbrance "
     "records come from the rights-and-liabilities source, and the validation engine flags active charges and litigation "
     "(rules ENC-* and LIT-*). Open a parcel's Unified Land Profile → *Encumbrance / Mortgage*."),
    ("mutation", ("mutation", "transfer of ownership", "change owner", "name change", "ફેરફાર"),
     "A **mutation** updates the record of rights after ownership changes (sale, gift, inheritance, mortgage). Each state "
     "names it differently: **Ferfar** in Maharashtra, **Namantaran** in Uttar Pradesh, **VF 6** entries in Gujarat.\n\n"
     "Where to find mutation information:\n"
     "- **In BhuSamhita:** open the parcel's Unified Land Profile → *Mutation* for each entry, its status and the deed it is based on.\n"
     "- **Maharashtra:** the Talathi office keeps the Ferfar register; entries and their status are online through Mahabhumi / e-Ferfar.\n"
     "- **Uttar Pradesh:** Namantaran cases are decided at the tehsil (Tehsildar); the updated Khatauni is on UP Bhulekh.\n"
     "- **Gujarat:** VF 6 entries are made at the e-Dhara Kendra in the Mamlatdar office; VF 6 details can be seen on AnyROR.\n\n"
     "A registered sale whose mutation is still pending is flagged in the parcel's verification."),
    ("verify", ("verify", "verification", "verified", "consistent", "discrepancy", "flag", "validate", "सत्याप", "पडताळ", "ચકાસ"),
     "Each parcel's **Unified Land Profile** runs cross-record checks, for example:\n"
     "- the holder on the record of rights matches the buyer on the latest registration\n"
     "- recorded area agrees with the GIS polygon area (5% tolerance)\n"
     "- a registration has a matching mutation\n"
     "- active encumbrances or litigation\n\n"
     "Open a parcel and see *Cross-record verification*. These are consistency checks across connected records, not a "
     "legal certification of title."),
    ("find", ("find my", "find a parcel", "find parcel", "find land", "search", "survey number", "gat number", "khasra number", "how to search", "look up",
              "खोज", "शोध", "શોધ"),
     "To find a parcel:\n"
     "- **By place:** on the home page or a state's land-information page, choose state → district → taluka/tehsil → "
     "village, then pick the survey / gat / khasra number.\n"
     "- **By number:** type a ULPIN, or a survey / gat / khasra number, in the search box. Results show the village so you "
     "can pick the right one.\n"
     "- **On the map:** open Land Map, zoom in until parcel boundaries appear, and click a parcel.\n\n"
     "Then open its Unified Land Profile to see all connected records."),
    ("map", ("map", "gis", "zoom", "layer", "measure", "basemap", "satellite", "मानचित्र", "नकाशा", "નકશ"),
     "Using **Land Map**:\n"
     "- Pick state → district → taluka/tehsil → village in the *Navigate* panel, or search by ULPIN / survey number.\n"
     "- Land parcels appear when you reach a village (zoom 14); plot numbers from zoom 17. Click a parcel for its summary.\n"
     "- *Layers* toggles cadastral parcels, village plots, identifiers and village boundaries.\n"
     "- *Tools* measures distance/area and jumps to coordinates. Basemaps: map, satellite, hybrid, terrain."),
    ("services", ("service", "what can you do", "help", "features", "options", "सेवा", "સેવા"),
     "BhuSamhita offers:\n"
     "- **State land information** - Maharashtra (7/12, 8A, Property Card), Uttar Pradesh (Khatauni, Khasra), Gujarat "
     "(VF 7/12, VF 8A, VF 6)\n"
     "- **Land Map** - GIS navigation to any parcel\n"
     "- **Unified Land Profile** - all connected records for one ULPIN, with verification\n"
     "- **Government Officer Login** - mutation work queues and reports\n\n"
     "Ask me about any of these terms, or open a parcel and ask \"Explain this parcel\"."),
]

EXPLAIN_KEYS = ("explain this", "this parcel", "this land", "summar", "tell me about", "about this",
                "समझा", "समजाव", "સમજાવ", "इस भू-खंड", "या भूखंड", "આ જમીન")

PARCEL_INTENTS: list[tuple[str, tuple[str, ...]]] = [
    ("verified", ("verified", "verify", "consistent", "flag", "discrepanc", "problem", "issue", "risk", "सत्याप", "पडताळ", "ચકાસ")),
    ("records", ("records", "connected", "sources", "systems", "अभिलेख", "जुड़े", "जोडलेले", "રેકર્ડ", "જોડાયેલ")),
    ("owner", ("owner", "holder", "who owns", "khatedar", "खातेदार", "मालक", "ખાતેદાર", "માલિક")),
    ("area", ("area", "size", "hectare", "acre", "gis", "क्षेत्र", "ક્ષેત્રફળ")),
    ("mutation", ("mutation", "ferfar", "namantaran", "vf 6", "pending", "फेरफार", "नामांतरण", "नामान्तरण")),
    ("encumbrance", ("encumbrance", "mortgage", "loan", "litigation", "court", "बोजा", "गहाण", "बंधक", "બોજો")),
    ("explain", EXPLAIN_KEYS),
]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


def demo_answer(question: str, g: dict) -> dict[str, Any]:
    q = _norm(question)
    p = g.get("parcel")
    # General questions ("what is ...", "which department ...") get the general answer even with a parcel open.
    if re.match(r"^(what is|what's|what are|what does|meaning|define|which department|which office|who handles|where can i find)", q):
        for key, keys, text in KB:
            if any(k in q for k in keys):
                return {"reply": text, "links": _kb_links(key, g), "suggestions": _kb_follow(key)}
    if p:
        for intent, keys in PARCEL_INTENTS:
            if any(k in q for k in keys):
                return {"reply": _parcel_answer(intent, p), "links": _links(g),
                        "suggestions": ["Is this parcel verified?", "What records are connected to this parcel?", "Who is the recorded holder?"]}
    if any(k in q for k in ("where am i", "this district", "this village", "this taluka", "this tehsil", "selected")) and g.get("location"):
        return {"reply": _location_answer(g["location"]), "links": _links(g), "suggestions": ["How can I find my land parcel?"]}
    if any(k in q for k in EXPLAIN_KEYS):
        return {"reply": "No parcel is open, so there is nothing to explain yet. Select a parcel on Land Map or search by "
                         "ULPIN / survey number, then ask again.",
                "links": [{"label": "Open Land Map", "href": "#/map"}], "suggestions": ["How can I find my land parcel?"]}
    for key, keys, text in KB:
        if any(k in q for k in keys):
            return {"reply": text, "links": _kb_links(key, g), "suggestions": _kb_follow(key)}
    if g.get("location") and any(k in q for k in ("district", "village", "taluka", "tehsil", "state")):
        return {"reply": _location_answer(g["location"]), "links": _links(g), "suggestions": []}
    return {"reply": "I can help with common land-record questions: what Gat, survey number, ULPIN, 7/12, 8A, Property Card, "
                     "Ferfar, Khatauni, Khasra, Namantaran, VF 7/12 or VF 6 mean; where to find mutation or encumbrance "
                     "information; which department handles a land service; how to find a parcel or use the map - and, "
                     "when a parcel is open, what its connected records say.\n\nTry asking one of these, in a few words.",
            "links": [], "suggestions": ["What is Gat?", "Which department handles land records?", "How can I find my land parcel?"]}


def _kb_links(key: str, g: dict) -> list[dict[str, str]]:
    state_for = {"712": "MH", "8a": "MH", "propertycard": "MH", "ferfar": "MH", "kprat": "MH",
                 "khatauni": "UP", "khasra": "UP", "namantaran": "UP", "vf6": "GJ", "vf712": "GJ"}
    if key in state_for:
        code = state_for[key]
        return [{"label": f"{STATES[code]} land information", "href": f"#/state/{code}"}]
    if key in ("find", "map"):
        return [{"label": "Open Land Map", "href": "#/map"}]
    return _links(g)


def _kb_follow(key: str) -> list[str]:
    return {"department": ["Where can I find mutation information?", "What is a 7/12 record?"],
            "gat": ["What is a 7/12 record?", "How can I find my land parcel?"],
            "mutation": ["Which department handles land records?", "What is Ferfar?"],
            "ulpin": ["How can I find my land parcel?", "What is a 7/12 record?"],
            "712": ["What is 8A?", "What is Ferfar?"], "8a": ["What is a 7/12 record?"],
            "khatauni": ["What is Khasra?", "What is Namantaran?"], "vf712": ["What is VF 6?"],
            "find": ["How do I use the map?", "What is ULPIN?"], "verify": ["Explain this parcel"]}.get(key, [])


def _loc_line(j: dict) -> str:
    sub = "Tehsil" if j.get("sub_district_type") == "tehsil" else "Taluka"
    return ", ".join(x for x in (j.get("village"), f"{sub} {j.get('sub_district')}" if j.get("sub_district") else None, j.get("district")) if x)


def _location_answer(loc: dict) -> str:
    parts = [f"You are viewing **{_loc_line(loc) or loc.get('state')}**{', ' + loc['state'] if loc.get('district') else ''}."]
    if loc.get("ulpin_parcels") is not None:
        parts.append(f"The connected records have {loc['ulpin_parcels']} ULPIN-linked parcel(s) here"
                     + (f", {loc['parcels_with_findings']} with verification findings." if loc.get("parcels_with_findings") is not None else "."))
    if loc.get("villages"):
        parts.append("Villages with connected records: " + ", ".join(loc["villages"]) + ".")
    return " ".join(parts)


def _holders(p: dict) -> list[str]:
    for r in p["records"]:
        if r["concept"] == "land_record" and r.get("holders"):
            return r["holders"]
    return []


def _parcel_answer(intent: str, p: dict) -> str:
    j, reg, v = p["jurisdiction"], p["registry"], p["validation"]
    head = f"**{p['native_identifier']}**, {_loc_line(j)}, {p['state']} (ULPIN {p['ulpin']})"
    findings = [f for f in v["findings"] if f["severity"] in ("critical", "high", "medium")]
    chk = v["checks"]
    by_concept: dict[str, list[str]] = {}
    for r in p["records"]:
        by_concept.setdefault(r["concept"], []).append(r["record_type"])

    def fline(f):
        return f"- [{f['rule']}] {f['message']}" + (" *(explained by a pending mutation)*" if f.get("status") == "explained" else "")

    if intent == "verified":
        if not findings:
            return (f"{head}: the cross-record checks found no medium or high findings "
                    f"({chk['pass']} passed, {chk['fail']} failed, risk level *{v['risk_level']}*).\n\n"
                    "This is a consistency check across connected records, not a legal certification.")
        return (f"{head} needs attention - risk level *{v['risk_level']}*, {chk['pass']} checks passed and {chk['fail']} failed:\n"
                + "\n".join(fline(f) for f in findings[:5]))
    if intent == "records":
        lines = [f"- {c.replace('_', ' ')}: {', '.join(sorted(set(t)))}" for c, t in by_concept.items()]
        return f"{head} has {len(p['records'])} connected record(s):\n" + "\n".join(lines)
    if intent == "owner":
        h = _holders(p)
        return (f"The recorded holder(s) of {head}: {', '.join(h)}." if h
                else f"No holder is recorded for {head} in the connected land records.")
    if intent == "area":
        rec, gis = reg.get("land_record_area_ha"), next((r.get("computed_area_ha") for r in p["records"] if r.get("computed_area_ha")), None)
        s = f"{head}: recorded area {rec if rec is not None else 'not available'} ha"
        if gis:
            s += f"; computed GIS polygon area {gis:.4f} ha"
            if rec:
                d = (gis - rec) / rec * 100
                s += f" ({d:+.1f}%{', above the 5% tolerance - flagged by GIS-001' if abs(d) > 5 else ', within the 5% tolerance'})"
        return s + "."
    if intent == "mutation":
        ms = [r for r in p["records"] if r["concept"] == "mutation"]
        if not ms:
            return f"No mutation record is connected for {head}."
        return f"Mutations for {head}:\n" + "\n".join(
            f"- {m['register']} {m['mutation_no']}: {m.get('kind_label') or m['kind']} - **{m['status']}** (applied {m['application_date']})" for m in ms)
    if intent == "encumbrance":
        es = [r for r in p["records"] if r["concept"] == "encumbrance"]
        if not es:
            return f"No encumbrance record is connected for {head}."
        return f"Encumbrances on {head}:\n" + "\n".join(
            f"- {e['type']} {e['reference']} - {e['status']}" + (f", litigation case {e['court_case']}" if e.get("litigation_flag") else "") for e in es)
    # explain
    h = _holders(p)
    lu = next((r.get("land_use") for r in p["records"] if r["concept"] == "land_record" and r.get("land_use")), None)
    out = [f"{head}."]
    out.append(f"- Recorded area: {reg['land_record_area_ha']} ha" if reg.get("land_record_area_ha") is not None else "- Recorded area: not available")
    if lu:
        out.append(f"- Land use: {lu.replace('_', ' ')}")
    out.append(f"- Recorded holder(s): {', '.join(h)}" if h else "- Recorded holder: not available")
    out.append(f"- Connected records: {len(p['records'])} ({', '.join(sorted(by_concept))})".replace("_", " "))
    out.append(f"- Verification: risk *{v['risk_level']}*, {chk['pass']} checks passed, {chk['fail']} failed")
    s = "\n".join(out)
    if findings:
        s += "\n\nMain findings:\n" + "\n".join(fline(f) for f in findings[:3])
    return s
