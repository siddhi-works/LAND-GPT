// State administration context, from the official systems (verified):
//  MH — Mahabhumi (Settlement Commissioner & Director of Land Records), e-Ferfar mutation register under
//       MLRC 1966 s.150: Talathi enters & serves notice, objections to the register of disputed cases,
//       Mandal Adhikari (Circle Officer) certifies; e-Hakk / ePSIT citizen applications.
//  UP — UP Bhulekh, Board of Revenue: Board of Revenue Report Login, District Administrative Login,
//       Tehsil Administrative / Mutation / Report Login; Namantaran (UP Revenue Code 2006 s.34, RCCMS).
//  GJ — e-Dhara Kendra at the Taluka Mamlatdar office: operator entry, e-Dhara Dy. Mamlatdar biometric
//       verification, VF 6 entry, 135-D notice served by Talati (30 days), certification, S-form, VF 7/12 & VF 8A.
export const STATES = {
  MH: {
    name: "Maharashtra", native: "महाराष्ट्र", sub: "taluka", lang: "mr",
    system: "Mahabhumi · e-Ferfar", department: "Revenue & Forest Department · Settlement Commissioner & Director of Land Records",
    ror: "7/12 (सातबारा)", holding: "8A", mutation: "Ferfar (फेरफार)", mutationRegister: "Ferfar register",
    statute: "MLRC 1966, s.150", hierarchy: ["Talathi (Saza)", "Mandal Adhikari (Circle)", "Tahsildar (Taluka)", "Collector (District)", "Settlement Commissioner & DLR (State)"],
    stages: [
      { key: "entry", label: "Ferfar entry recorded", by: "Talathi" },
      { key: "notice", label: "Notice served · objection period (15 days)", by: "Talathi" },
      { key: "certify", label: "Certification", by: "Mandal Adhikari" },
      { key: "ror", label: "7/12 & 8A updated", by: "e-Ferfar" },
    ],
    queues: [["pending", "Pending Ferfar (notice period)"], ["ready", "Ready for certification"], ["disputed", "Disputed (तक्रारी नोंद)"], ["done", "Certified / Disposed"]],
  },
  UP: {
    name: "Uttar Pradesh", native: "उत्तर प्रदेश", sub: "tehsil", lang: "hi",
    system: "UP Bhulekh · Board of Revenue", department: "Revenue Department · Board of Revenue (राजस्व परिषद)",
    ror: "Khatauni (खतौनी)", holding: "Khasra (खसरा)", mutation: "Namantaran (नामान्तरण)", mutationRegister: "Namantaran (धारा 34) cases",
    statute: "UP Revenue Code 2006, s.34", hierarchy: ["Lekhpal (Village)", "Revenue Inspector (Kanungo)", "Tehsildar (Tehsil)", "SDM", "District Magistrate / ADM (F/R)", "Board of Revenue (State)"],
    stages: [
      { key: "entry", label: "Application registered", by: "Tehsil" },
      { key: "report", label: "Lekhpal / Revenue Inspector report", by: "Lekhpal · RI" },
      { key: "order", label: "Tehsildar order", by: "Tehsildar" },
      { key: "ror", label: "Khatauni updated", by: "Bhulekh" },
    ],
    queues: [["pending", "Namantaran pending"], ["ready", "Awaiting Tehsildar order"], ["disputed", "Returned / objection"], ["done", "Disposed (निस्तारित)"]],
  },
  GJ: {
    name: "Gujarat", native: "ગુજરાત", sub: "taluka", lang: "gu",
    system: "e-Dhara · AnyROR", department: "Revenue Department, Government of Gujarat",
    ror: "VF 7/12", holding: "VF 8A", mutation: "VF 6 (હક્ક પત્રક)", mutationRegister: "VF 6 mutation entries",
    statute: "Gujarat Land Revenue Code, s.135-D", hierarchy: ["Talati-cum-Mantri (Village)", "Circle Officer", "Deputy Mamlatdar (e-Dhara)", "Mamlatdar (Taluka)", "Collector (District)"],
    stages: [
      { key: "entry", label: "Entry at e-Dhara Kendra · Dy. Mamlatdar verification", by: "e-Dhara Dy. Mamlatdar" },
      { key: "notice", label: "135-D notice served (30 days)", by: "Talati" },
      { key: "certify", label: "Certification · S-form approval", by: "Mamlatdar / competent authority" },
      { key: "ror", label: "VF 7/12 & VF 8A updated", by: "e-Dhara" },
    ],
    queues: [["pending", "135-D notice period"], ["ready", "Ready for certification"], ["disputed", "Returned / objection"], ["done", "Certified"]],
  },
};

// Regional land-information pages. Labels follow the state's own portal language (shown with English, as
// the state portals do). `records[].native` must equal a native_record_type in the connected data;
// `connected: false` marks a record the state publishes that is not part of this demo's connected sources.
export const REGION = {
  MH: {
    accent: "#e07a1f", lang: "mr", title: "महाराष्ट्र भूमी माहिती", titleEn: "Maharashtra Land Information", switchLang: "मराठीत पहा", officerTitle: "अधिकारी प्रवेश — महाराष्ट्र",
    labels: { district: "जिल्हा", sub: "तालुका", village: "गाव", parcel: "सर्वे / गट क्रमांक", record: "अधिकार अभिलेखाचा प्रकार", search: "शोधा", map: "जिल्हा नकाशा" },
    records: [
      { key: "712", native: "7/12", label: "७/१२", en: "7/12 extract" },
      { key: "8a", native: "8A", label: "८अ", en: "8A holding" },
      { key: "pc", native: "Property Card", label: "मालमत्ता पत्रक", en: "Property Card" },
      { key: "ferfar", native: "Ferfar", label: "फेरफार", en: "Ferfar (mutation)" },
      { key: "kprat", native: null, label: "क-प्रत", en: "K-Prat", connected: false },
    ],
  },
  UP: {
    accent: "#1d5fa8", lang: "hi", title: "उत्तर प्रदेश भूमि सूचना", titleEn: "Uttar Pradesh Land Information", switchLang: "हिन्दी में देखें", officerTitle: "अधिकारी प्रवेश — उत्तर प्रदेश",
    labels: { district: "जनपद", sub: "तहसील", village: "ग्राम", parcel: "खसरा / गाटा संख्या", record: "अभिलेख का प्रकार", search: "खोजें", map: "जनपद मानचित्र" },
    records: [
      { key: "khatauni", native: "Khatauni", label: "खतौनी", en: "Khatauni" },
      { key: "khasra", native: "Khasra", label: "खसरा", en: "Khasra" },
      { key: "namantaran", native: "Namantaran", label: "नामान्तरण", en: "Namantaran (mutation)" },
      { key: "bhunaksha", native: "BhuNaksha map record", label: "भू-नक्शा", en: "BhuNaksha map" },
    ],
  },
  GJ: {
    accent: "#15803d", lang: "gu", title: "ગુજરાત જમીન માહિતી", titleEn: "Gujarat Land Information", switchLang: "ગુજરાતીમાં જુઓ", officerTitle: "અધિકારી પ્રવેશ — ગુજરાત",
    labels: { district: "જિલ્લો", sub: "તાલુકો", village: "ગામ", parcel: "સર્વે નંબર", record: "રેકર્ડનો પ્રકાર", search: "શોધો", map: "જિલ્લા નકશો" },
    records: [
      { key: "vf712", native: "VF 7/12", label: "ગા.ન.નં. 7/12", en: "VF 7/12" },
      { key: "vf8a", native: "VF 8A", label: "ગા.ન.નં. 8અ", en: "VF 8A" },
      { key: "vf6", native: "VF 6", label: "ગા.ન.નં. 6 (હક્ક પત્રક)", en: "VF 6 (mutation)" },
      { key: "pc", native: "Property Card", label: "પ્રોપર્ટી કાર્ડ", en: "Property Card" },
    ],
  },
};

// Categorical colours for districts on the regional maps (muted map tones; cycled).
export const DISTRICT_COLORS = ["#2f6fd6", "#e07a1f", "#15803d", "#9333ea", "#b45309", "#0f766e", "#be123c", "#4d7c0f", "#1e40af", "#a16207", "#0e7490", "#7c2d12", "#6d28d9", "#166534"];

export const ACTION_LABEL = {
  record_note: "Record mutation note", issue_notice: "Issue notice", register_objection: "Register objection (disputed)",
  certify: "Certify", reject: "Reject", return: "Return for correction", forward: "Forward",
  verify_discrepancy: "Mark discrepancy reviewed", call_report: "Call Lekhpal / RI report", order_mutation: "Pass mutation order",
  verify_entry: "Verify entry (biometric)", generate_135d: "Generate 135-D notice", approve_s_form: "Approve S-form",
  serve_notice: "Record notice served", record_acknowledgement: "Record acknowledgement",
};
export const STATUS_LABEL = {
  pending: ["warn", "Pending"], completed: ["ok", "Disposed / Certified"], certified: ["ok", "Certified / Ordered"], rejected: ["bad", "Rejected"],
  returned: ["bad", "Returned"], forwarded: ["info", "Forwarded"], reviewed: ["ok", "Reviewed"], disputed: ["bad", "Disputed"],
  notice_served: ["info", "Notice served"], notice_generated: ["info", "135-D generated"], entry_verified: ["info", "Entry verified"],
  s_form_approved: ["info", "S-form approved"], report_called: ["info", "Report called"], in_process: ["info", "In process"],
};
export const FORWARD_TO = {
  MH: ["Mandal Adhikari (Circle Officer)", "Tahsildar", "Sub-Registrar Office", "District Superintendent of Land Records"],
  UP: ["Lekhpal", "Revenue Inspector", "Tehsildar", "SDM", "ADM (F/R)"],
  GJ: ["Talati-cum-Mantri", "Circle Officer", "Mamlatdar", "District Inspector of Land Records"],
};

/** Map a work item to the state's queue bucket. */
export function queueOf(item) {
  if (item.type !== "mutation") return null;
  if (["completed", "certified", "rejected"].includes(item.status)) return "done";
  if (["disputed", "returned"].includes(item.status)) return "disputed";
  if (/Certification|order/i.test(item.stage)) return "ready";
  return "pending";
}
