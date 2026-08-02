/**
 * KSDMA daily dam bulletins — the official source for Kerala reservoir levels.
 *
 * KSDMA publishes two date-stamped PDFs every day at
 * https://sdma.kerala.gov.in/dam-water-level/ :
 *   - "KSEB-SITE-*.pdf"  — power-generation dams (KSEB Dam Safety Org data)
 *   - "IRR-SITE-*.pdf"   — irrigation dams (Water Resources Department data)
 *
 * There is no API; the page is scraped for the newest PDF links and the PDFs
 * are text-extracted with unpdf. The row grammar (verified against the live
 * bulletins of 02/08/2026):
 *
 *   <n> <ml name> (<English name>) <ml district> (<District>)
 *   <FRL> [m|ft] <today's level> [m|ft] [<rule level>]
 *   <blue> <orange> <red>            ← official alert levels (when defined)
 *   <gross storage> <live storage> <pct>% <spill|_|-> <remarks…>
 *
 * Parsing is anchor-based (per-dam name search) and validated per value —
 * a row that fails validation is dropped so the caller falls back to the
 * rainfall model for that dam rather than showing garbage. PDF layouts drift;
 * everything here must fail soft.
 */

const KSDMA_PAGE_URL = "https://sdma.kerala.gov.in/dam-water-level/";

export interface OfficialDamRow {
  /** Our dam id (existing DAMS id, or a new official-only id). */
  id: string;
  name: string;
  district: string;
  river: string;
  lat: number | null;
  lng: number | null;
  unit: "m" | "ft";
  frl: number;
  currentLevel: number;
  capacityPct: number | null;
  /** Official staged alert levels, ascending — present when the bulletin defines them. */
  alertLevels: { blue: number; orange: number; red: number } | null;
  spillCumecs: number | null;
  remarks: string;
  spilling: boolean;
}

export interface OfficialDamBulletin {
  date: string | null;
  rows: OfficialDamRow[];
}

interface DamAlias {
  id: string;
  /** Anchor strings searched in the PDF text (English names as printed). */
  anchors: string[];
  name: string;
  district: string;
  river: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Official bulletin names → dashboard dams.
 * The first group maps onto the existing DAMS list (marker coordinates come
 * from there); the rest are official-only dams shown in the list panel. Only
 * dams with confidently-known coordinates get lat/lng — a wrong pin on a
 * rescue map is worse than no pin.
 */
const DAM_ALIASES: DamAlias[] = [
  // ── Dams already in the dashboard's static list ─────────────────────────
  { id: "idukki", anchors: ["(Idukki)"], name: "Idukki Arch Dam", district: "Idukki", river: "Periyar River", lat: 9.8458, lng: 76.9736 },
  { id: "idamalayar", anchors: ["(Idamalayar)"], name: "Idamalayar Dam", district: "Ernakulam", river: "Periyar River", lat: 10.2183, lng: 76.7022 },
  { id: "banasurasagar", anchors: ["(Banasurasagar)"], name: "Banasurasagar Dam", district: "Wayanad", river: "Kabini River", lat: 11.6706, lng: 75.9556 },
  { id: "kakki", anchors: ["(Kakki", "Kakki (Anathode)"], name: "Kakki Dam", district: "Pathanamthitta", river: "Pamba River", lat: 9.3172, lng: 77.1408 },
  { id: "sholayar", anchors: ["(Sholayar)"], name: "Lower Sholayar Dam", district: "Thrissur", river: "Chalakkudy River", lat: 10.2989, lng: 76.7725 },
  { id: "peringalkuthu", anchors: ["(Poringalkuthu", "(Peringalkuthu"], name: "Peringalkuthu Dam", district: "Thrissur", river: "Chalakkudy River", lat: 10.3117, lng: 76.6358 },
  { id: "neyyar", anchors: ["Neyyar"], name: "Neyyar Dam", district: "Thiruvananthapuram", river: "Neyyar River", lat: 8.5358, lng: 77.1481 },
  { id: "peechi", anchors: ["Peechi"], name: "Peechi Dam", district: "Thrissur", river: "Manali River", lat: 10.5317, lng: 76.3683 },
  { id: "malampuzha", anchors: ["Malampuzha"], name: "Malampuzha Dam", district: "Palakkad", river: "Bharatapuzha River", lat: 10.8322, lng: 76.6853 },
  { id: "walayar", anchors: ["Walayar"], name: "Walayar Dam", district: "Palakkad", river: "Walayar River", lat: 10.8406, lng: 76.8406 },
  { id: "kanjirapuzha", anchors: ["Kanjirappuzha", "Kanjirapuzha"], name: "Kanjirapuzha Dam", district: "Palakkad", river: "Kanjirapuzha River", lat: 10.9786, lng: 76.5414 },

  // ── Official-only dams (from the bulletins; listed, mapped when coords known) ──
  { id: "pamba_dam", anchors: ["(Pamba)"], name: "Pamba Dam", district: "Pathanamthitta", river: "Pamba River", lat: null, lng: null },
  { id: "moozhiyar", anchors: ["(Moozhiyar)"], name: "Moozhiyar Dam", district: "Pathanamthitta", river: "Pamba Basin", lat: null, lng: null },
  { id: "madupetty", anchors: ["(Madupetty)", "(Mattupetty)"], name: "Mattupetty Dam", district: "Idukki", river: "Periyar Basin", lat: 10.1063, lng: 77.1238 },
  { id: "kundala", anchors: ["(Kundala)"], name: "Kundala Dam", district: "Idukki", river: "Periyar Basin", lat: 10.1436, lng: 77.1953 },
  { id: "anayirankal", anchors: ["(Anayirankal)"], name: "Anayirankal Dam", district: "Idukki", river: "Periyar Basin", lat: null, lng: null },
  { id: "ponmudi_dam", anchors: ["(Ponmudi", "(Ponmudi )"], name: "Ponmudi Dam", district: "Idukki", river: "Periyar Basin", lat: null, lng: null },
  { id: "kallarkutty", anchors: ["(Kallarkutty)"], name: "Kallarkutty Dam", district: "Idukki", river: "Periyar Basin", lat: null, lng: null },
  { id: "erattayar", anchors: ["(Erattayar)"], name: "Erattayar Dam", district: "Idukki", river: "Periyar Basin", lat: null, lng: null },
  { id: "lower_periyar", anchors: ["(Lower Periyar)"], name: "Lower Periyar Dam", district: "Idukki", river: "Periyar River", lat: null, lng: null },
  { id: "kallar_dam", anchors: ["(Kallar)"], name: "Kallar Dam", district: "Idukki", river: "Periyar Basin", lat: null, lng: null },
  { id: "kuttiyadi", anchors: ["(Kuttiyadi)", "Kuttiyadi"], name: "Kuttiyadi (Kakkayam) Dam", district: "Kozhikode", river: "Kuttiyadi River", lat: 11.551, lng: 75.925 },
  { id: "kallada", anchors: ["Kallada"], name: "Kallada (Thenmala) Dam", district: "Kollam", river: "Kallada River", lat: 8.96, lng: 77.062 },
  { id: "maniyar", anchors: ["Maniyar"], name: "Maniyar Barrage", district: "Pathanamthitta", river: "Pamba River", lat: null, lng: null },
  { id: "malankara", anchors: ["Malankara"], name: "Malankara Dam", district: "Idukki", river: "Muvattupuzha River", lat: null, lng: null },
  { id: "bhoothathankettu", anchors: ["Bhoothathankettu"], name: "Bhoothathankettu Barrage", district: "Ernakulam", river: "Periyar River", lat: 10.118, lng: 76.66 },
  { id: "vazhani", anchors: ["Vazhani"], name: "Vazhani Dam", district: "Thrissur", river: "Keecheri River", lat: null, lng: null },
  { id: "chimoni", anchors: ["Chimoni"], name: "Chimoni Dam", district: "Thrissur", river: "Karuvannur River", lat: 10.442, lng: 76.474 },
  { id: "siruvani", anchors: ["Siruvani"], name: "Siruvani Dam", district: "Palakkad", river: "Siruvani River", lat: null, lng: null },
  { id: "meenkara", anchors: ["Meenkara"], name: "Meenkara Dam", district: "Palakkad", river: "Bharatapuzha Basin", lat: null, lng: null },
  { id: "chulliyar", anchors: ["Chulliyar"], name: "Chulliyar Dam", district: "Palakkad", river: "Bharatapuzha Basin", lat: null, lng: null },
  { id: "mangalam", anchors: ["Mangalam"], name: "Mangalam Dam", district: "Palakkad", river: "Mangalam River", lat: null, lng: null },
  { id: "pothundy", anchors: ["Pothundy"], name: "Pothundy Dam", district: "Palakkad", river: "Bharatapuzha Basin", lat: null, lng: null },
  { id: "moolathara", anchors: ["Moolathara"], name: "Moolathara Regulator", district: "Palakkad", river: "Chitturpuzha River", lat: null, lng: null },
  { id: "karapuzha", anchors: ["Karapuzha"], name: "Karapuzha Dam", district: "Wayanad", river: "Karapuzha River", lat: null, lng: null },
  { id: "pazhassi", anchors: ["Pazhassi"], name: "Pazhassi Barrage", district: "Kannur", river: "Valapattanam River", lat: null, lng: null },
];

/** Newest bulletin PDF link of a given kind from the KSDMA page HTML. */
function findLatestPdf(html: string, marker: "KSEB-SITE" | "IRR-SITE"): string | null {
  const re = new RegExp(
    `href="([^"]*\\/wp-content\\/uploads\\/(\\d{4})\\/(\\d{2})\\/[^"]*${marker}[^"]*\\.pdf)"`,
    "gi"
  );
  let best: { url: string; key: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = `${m[2]}-${m[3]}`; // sort by /YYYY/MM/ upload path
    if (!best || key > best.key) best = { url: m[1], key };
  }
  if (!best) return null;
  return best.url.startsWith("http") ? best.url : `https://sdma.kerala.gov.in${best.url}`;
}

/** Numbers (with % markers) in reading order within a text window. */
function extractNumbers(window: string): { value: number; isPct: boolean }[] {
  const out: { value: number; isPct: boolean }[] = [];
  const re = /(\d+(?:\.\d+)?)(\s*%)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    // Skip date fragments like 02/08/2026 or 29.06.'26
    const before = window[m.index - 1];
    const after = window[m.index + m[0].length];
    if (before === "/" || after === "/" || before === "'") continue;
    out.push({ value: parseFloat(m[1]), isPct: Boolean(m[2]) });
  }
  return out;
}

function asciiRemarks(window: string): string {
  let text = window
    // Malayalam glyphs come out as mojibake — keep the readable Latin part.
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop the leading spill/outflow column value (or its nil placeholder).
  text = text.replace(/^(?:\d+(?:\.\d+)?|[_\-])\s*/, "");
  // The 420-char window can bleed into the next row; cut at what looks like
  // the next serial number + dam name ("… 9 Siruvani (…", "… 5 (Madupetty…").
  const boundary = text.search(/(^|\s)\d{1,2}\s+\(?[A-Z]/);
  if (boundary >= 0) text = text.slice(0, boundary);
  return text.trim().slice(0, 110);
}

function parseDamWindow(
  alias: DamAlias,
  window: string,
  spillColumnIsAuthoritative: boolean
): OfficialDamRow | null {
  const numbers = extractNumbers(window);
  if (numbers.length < 3) return null;

  const frl = numbers[0]?.value;
  const today = numbers[1]?.value;
  if (!Number.isFinite(frl) || !Number.isFinite(today)) return null;
  if (frl <= 0 || frl > 3000) return null;
  // Level can slightly exceed FRL during spill events; beyond 5% it's a
  // misparse. A level below half of FRL elevation is equally implausible for
  // these reservoirs (today's live bulletin bottoms out around 0.70×FRL) and
  // catches column-shift artifacts in the source PDF itself.
  if (today > frl * 1.05 || today < frl * 0.5) return null;

  const unit: "m" | "ft" = /\bft\b/.test(window.slice(0, 80)) ? "ft" : "m";

  const pctIdx = numbers.findIndex((n) => n.isPct);
  const capacityPct =
    pctIdx >= 0 && numbers[pctIdx].value >= 0 && numbers[pctIdx].value <= 101
      ? numbers[pctIdx].value
      : null;

  // Official staged alert levels sit exactly 5..3 numbers before the pct token
  // (blue, orange, red, gross storage, live storage, pct). Validate hard.
  let alertLevels: OfficialDamRow["alertLevels"] = null;
  if (pctIdx >= 5) {
    const blue = numbers[pctIdx - 5].value;
    const orange = numbers[pctIdx - 4].value;
    const red = numbers[pctIdx - 3].value;
    const inRange = (v: number) => v > frl * 0.5 && v <= frl * 1.02;
    if (blue < orange && orange < red && inRange(blue) && inRange(red)) {
      alertLevels = { blue, orange, red };
    }
  }

  // Token right after the pct is the spill/outflow column (number, or _/-).
  let spillCumecs: number | null = null;
  if (pctIdx >= 0 && pctIdx + 1 < numbers.length) {
    const next = numbers[pctIdx + 1].value;
    if (Number.isFinite(next) && next >= 0 && next < 100000) spillCumecs = next;
  }

  const pctPos = window.indexOf("%");
  const remarks = asciiRemarks(pctPos >= 0 ? window.slice(pctPos + 1) : window.slice(-160));
  // "Shutters/gates opened" in the remarks is a spill signal in both
  // bulletins. The KSEB bulletin's numeric column is explicitly "Current
  // Spillway Release (cumecs)", so a positive value there is authoritative
  // too (catches vent releases described without the word "open"). The IRR
  // bulletin's column is generic outflow — drinking water and turbines count
  // in it — so the number alone must NOT flag a spill there.
  const spilling =
    (/open(ed|ing)/i.test(remarks) && !/re-?closed/i.test(remarks)) ||
    (spillColumnIsAuthoritative && spillCumecs !== null && spillCumecs > 0);

  return {
    id: alias.id,
    name: alias.name,
    district: alias.district,
    river: alias.river,
    lat: alias.lat,
    lng: alias.lng,
    unit,
    frl,
    currentLevel: today,
    capacityPct,
    alertLevels,
    spillCumecs,
    remarks,
    spilling,
  };
}

function parseBulletinText(
  text: string,
  seen: Set<string>,
  spillColumnIsAuthoritative: boolean
): OfficialDamRow[] {
  const rows: OfficialDamRow[] = [];
  for (const alias of DAM_ALIASES) {
    if (seen.has(alias.id)) continue;
    let idx = -1;
    for (const anchor of alias.anchors) {
      idx = text.indexOf(anchor);
      if (idx >= 0) break;
    }
    if (idx < 0) continue;

    const window = text.slice(idx, idx + 420);
    const row = parseDamWindow(alias, window, spillColumnIsAuthoritative);
    if (row) {
      rows.push(row);
      seen.add(alias.id);
    }
  }
  return rows;
}

function extractBulletinDate(text: string): string | null {
  const m = text.match(/(\d{2}\/\d{2}\/\d{4})\s*[-–]?\s*(\d{1,2}\.\d{2}\s*(?:AM|PM))/i);
  return m ? `${m[1]} ${m[2]}` : null;
}

async function fetchPdfText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/**
 * Fetch and parse today's official KSDMA dam bulletins.
 * Returns null when the page itself is unreachable; a bulletin with zero rows
 * means the PDFs changed shape (callers must fall back to the model).
 */
export async function fetchOfficialDamBulletin(): Promise<OfficialDamBulletin | null> {
  try {
    const pageRes = await fetch(KSDMA_PAGE_URL, { next: { revalidate: 1800 } });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const ksebUrl = findLatestPdf(html, "KSEB-SITE");
    const irrUrl = findLatestPdf(html, "IRR-SITE");
    if (!ksebUrl && !irrUrl) return null;

    const [ksebText, irrText] = await Promise.all([
      ksebUrl ? fetchPdfText(ksebUrl) : Promise.resolve(null),
      irrUrl ? fetchPdfText(irrUrl) : Promise.resolve(null),
    ]);

    const seen = new Set<string>();
    const rows: OfficialDamRow[] = [];
    // KSEB text is parsed first: its "(English)" anchors are more specific
    // than the IRR bulletin's bare names.
    if (ksebText) rows.push(...parseBulletinText(ksebText, seen, true));
    if (irrText) rows.push(...parseBulletinText(irrText, seen, false));

    const date =
      (ksebText && extractBulletinDate(ksebText)) ||
      (irrText && extractBulletinDate(irrText)) ||
      null;

    return { date, rows };
  } catch {
    return null;
  }
}
