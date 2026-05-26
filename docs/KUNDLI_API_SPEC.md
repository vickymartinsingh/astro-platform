# AstroSeer Kundli — API + UI Specification

Paste this into a fresh agent to build the AstroSeer API endpoints + matching UI
that powers the kundli viewer in the AstroSeer customer app, astrologer app and
admin panel. The reference visual is AstroTalk's free kundli flow — match the
layout, NOT the brand. AstroSeer brand colours and copy rules apply (see end).

---

## High-level structure

A user opens their saved kundli profile and sees **7 main tabs** at the top:

1. **Basic** — birth + avakhada + panchang details
2. **Kundli** — Lagna + Navamsa charts (North/South toggle) + planets table
3. **KP** — Bhav Chalit chart + ruling planets + KP planets + cusps tables
4. **Ashtakvarga** — Sarvashtakavarga + 8 per-planet ashtakavarga charts
5. **Charts** — 12 divisional charts (D1, D2, D3, D4, D7, D9, D10, D12, D16, D24, D30, D60) with North/South toggle
6. **Dasha** — Vimshottari + Yogini, with 4-level interactive drilldown
7. **Free Report** — General / Remedies / Dosha sub-sections with full prediction text + Download PDF button

Each tab must work on web + bundled iOS/Android (no platform-specific code).
All copy must follow the brand rules at the end of this doc (no em-dashes, no
decorative emojis).

---

## Tab 1: Basic

Two columns on desktop, stacked on mobile.

**Left column — Basic Details**
| Field | Source |
|---|---|
| Name | profile.name |
| Date | profile.dob (DD/MM/YYYY) |
| Time | profile.tob + profile.ampm |
| Place | profile.place (City, State, Country) |
| Latitude | profile.lat (4 decimals) |
| Longitude | profile.lng (4 decimals) |
| Timezone | profile.tz (GMT±X.X) |
| Sunrise | panchang.sunrise (HH:MM:SS) |
| Sunset | panchang.sunset |
| Ayanamsha | calculation.ayanamsha (decimal degrees) |

**Left column — Panchang Details (below Basic)**
| Field | Source |
|---|---|
| Tithi | panchang.tithi |
| Karan | panchang.karana |
| Yog | panchang.yoga |
| Nakshatra | panchang.nakshatra |

**Right column — Avakhada Details**
| Field | Source |
|---|---|
| Varna | avakhada.varna |
| Vashya | avakhada.vashya |
| Yoni | avakhada.yoni |
| Gan | avakhada.gana |
| Nadi | avakhada.nadi |
| Sign | moon_sign.sign |
| Sign Lord | moon_sign.lord |
| Nakshatra-Charan | `${nakshatra} pada ${pada}` |
| Yog | panchang.yoga |
| Karan | panchang.karana |
| Tithi | panchang.tithi |
| Yunja | avakhada.yunja |
| Tatva | avakhada.tatva |
| Name alphabet | avakhada.name_alphabet |
| Paya | avakhada.paya |

### Required API endpoint
```
GET /api/kundli/basic?profileId=...
→ {
  basic: { name, date, time, place, latitude, longitude, timezone,
           sunrise, sunset, ayanamsha },
  panchang: { tithi, karana, yoga, nakshatra,
              sunrise, sunset, moonrise, moonset, paksha,
              rahu_kaal, gulika_kaal, yamaganda,
              day_of_birth, hindu_weekday },
  avakhada: { varna, vashya, yoni, gana, nadi, sign, sign_lord,
              nakshatra_charan, yunja, tatva, name_alphabet, paya }
}
```

---

## Tab 2: Kundli

**Toggle at top:** North Indian | South Indian (pill buttons, default North,
user choice saved to `users/{uid}.chartStyle`).

**Two charts side-by-side (stack on mobile):**
- Left: Lagna / Ascendant / Basic Birth Chart (D1 Rasi)
- Right: Navamsa (D9)

Each chart must render planets as 2-letter codes in the right house with the
degree appended (e.g. `Su 14.07°`, `Sa 24.58°R` where R = retrograde).

**Planets table below the charts** (11 columns):

| Planet | Sign | Sign Lord | Nakshatra | Naksh Lord | Degree | Retro(R) | Combust | Avastha | House | Status |
|---|---|---|---|---|---|---|---|---|---|---|

- **Avastha**: Bala / Kumara / Yuva / Mrita / Vridha (age state per degree band)
- **Status**: Exalted / Debilitated / Mooltrikona / Owned / Friendly / Enemy / Neutral / Yuva

### Required API endpoint
```
GET /api/kundli/chart?profileId=...&style=north|south
→ {
  d1_north_svg: "<svg…>",      // ready-to-render SVG
  d1_south_svg: "<svg…>",
  d9_north_svg: "<svg…>",
  d9_south_svg: "<svg…>",
  planets: [{
    name, sign, sign_lord, nakshatra, naksh_lord,
    degree,            // "14°04'22\""
    degree_decimal,    // 14.0729
    retrograde,        // bool
    combust,           // bool
    avastha,           // "Yuva" etc
    house,             // 1..12
    status,            // "Debilitated" etc
  }]
}
```

The SVG strings must be self-contained (inline fonts via web-safe stack;
fill colours follow brand palette below) so the client just sets
`dangerouslySetInnerHTML`.

---

## Tab 3: KP

**Top-left:** Bhav Chalit Chart (single North Indian style SVG, planets placed
by KP cusp not by sign).

**Top-right:** Ruling Planets table
| | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|
| Mo | Mercury | Moon | RAHU |
| Asc | Venus | Sun | Saturn |

| Day Lord | Mars |

**Below:** Planets table (KP-specific)
| Planets | Cusp | Sign | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|---|---|

Then **Cusps table** (12 rows):
| Cusp | Degree | Sign | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|---|---|

### Required API endpoint
```
GET /api/kundli/kp?profileId=...
→ {
  chalit_svg: "<svg…>",
  ruling_planets: {
    moon:  { sign_lord, star_lord, sub_lord },
    asc:   { sign_lord, star_lord, sub_lord },
    day_lord: "Mars"
  },
  kp_planets: [{ planet, cusp, sign, sign_lord, star_lord, sub_lord }],
  cusps: [{ cusp:1..12, degree, sign, sign_lord, star_lord, sub_lord }]
}
```

---

## Tab 4: Ashtakvarga

9 charts in a 3×3 grid:
1. **Sav** (Sarvashtakavarga) — totals
2. **Asc** (Ascendant)
3. **Jupiter**
4. **Mars**
5. **Mercury**
6. **Moon**
7. **Saturn**
8. **Sun**
9. **Venus**

Each chart is a North-style diamond with a single number per house. Above the
grid, render this explainer paragraph:

> Ashtakvarga is used to assess the strength and patterns that are present in
> a birth chart. The Ashtakavarga is a numerical quantification or score of
> each planet placed in the chart with reference to the other 7 planets and
> the Lagna. In Sarva Ashtaka Varga the total scores of all the BAVs are
> overlaid and then totalled. This makes the SAV of the chart. The total of
> all the scores should be 337.

### Required API endpoint
```
GET /api/kundli/ashtakvarga?profileId=...
→ {
  sav: { house_1: N, house_2: N, …, house_12: N, total: 337 },
  bavs: {
    sun:     { house_1: N, …, house_12: N, total: M },
    moon:    { …, total: M },
    mars:    { …, total: M },
    mercury: { …, total: M },
    jupiter: { …, total: M },
    venus:   { …, total: M },
    saturn:  { …, total: M },
    ascendant: { …, total: M }
  },
  svgs: {
    sav:       "<svg…>",
    sun:       "<svg…>",
    moon:      "<svg…>",
    mars:      "<svg…>",
    mercury:   "<svg…>",
    jupiter:   "<svg…>",
    venus:     "<svg…>",
    saturn:    "<svg…>",
    ascendant: "<svg…>"
  }
}
```

---

## Tab 5: Charts

12 divisional charts in a 3-column grid (1 row of 3, on each scroll). North /
South toggle at top applies to ALL 12.

| # | Divisional | Label |
|---|---|---|
| 1 | Chalit | Chalit |
| 2 | Sun chart | Sun |
| 3 | Moon chart | Moon |
| 4 | D1 | Lagna / Ascendant / Basic Birth Chart |
| 5 | D2 | Hora (Wealth / Income Chart) |
| 6 | D3 | Drekkana (Relationship with siblings) |
| 7 | D4 | Chaturthamsa (Assets) |
| 8 | D7 | Saptamsa (Progeny) |
| 9 | D9 | Navamsa (Prospects of marriage) |
| 10 | D10 | Dasamsa (Profession) |
| 11 | D12 | Dwadasamsa (Native parents / Ancestors) |
| 12 | D16 | Shodasamsa (Travel) |

### Required API endpoint
```
GET /api/kundli/divisional?profileId=...&style=north|south
→ {
  chalit:        "<svg…>",
  sun_chart:     "<svg…>",
  moon_chart:    "<svg…>",
  d1_lagna:      "<svg…>",
  d2_hora:       "<svg…>",
  d3_drekkana:   "<svg…>",
  d4_chaturthamsa: "<svg…>",
  d7_saptamsa:   "<svg…>",
  d9_navamsa:    "<svg…>",
  d10_dasamsa:   "<svg…>",
  d12_dwadasamsa:"<svg…>",
  d16_shodasamsa:"<svg…>"
}
```

Each SVG already shows planet positions; client renders 12 cards each with a
title and the SVG.

---

## Tab 6: Dasha (interactive drilldown)

**Top sub-toggle:** Vimshottari | Yogini (saved to a setting; default
Vimshottari).

**Stepper showing current depth:**
```
1 Mahadasha ─── 2 Antardasha ─── 3 Pratyantardasha ─── 4 Sookshmadasha
```
The current step is filled-accent, the rest are outlined.

**Table at current level:**
| Planet | Start Date | End Date | (chevron →) |
|---|---|---|---|

Click any row → drill ONE level down. Show breadcrumb above the table like
`Pingala > Sankata > Bhadrika` so the user knows where they are. A
**LEVEL UP** button below the table goes back one level.

**Vimshottari rules (deterministic, no API call needed for sub-levels):**
Sequence: Ketu(7), Venus(20), Sun(6), Moon(10), Mars(7), Rahu(18),
Jupiter(16), Saturn(19), Mercury(17). Total 120 years.
- Antardashas of a Maha period run in the SAME 9-planet sequence starting
  from the Maha lord. Each antar length = `(maha_years × antar_years) / 120`.
- Pratyantardashas of an Antar period use the same formula recursively on the
  antar length.
- Sookshma is one level deeper, same recursion.

**Yogini rules:** 8-planet cycle (MAN, PIN, DHA, BHR, BHA, ULK, SID, SAN)
totalling 36 years.

### Required API endpoints

Two options for the agent to choose from:

**Option A (recommended): single endpoint, client computes sub-levels**
```
GET /api/dasha?profileId=...&system=vimshottari|yogini
→ {
  system: "vimshottari",
  periods: [
    { lord: "Mars",    start: "ISO", end: "ISO", years: 5.775 },
    { lord: "Rahu",    start: "ISO", end: "ISO", years: 18 },
    …  // 9 mahas covering ~120 years from birth
  ],
  current: {                            // optional convenience
    maha:        { lord, start, end },
    antar:       { lord, start, end },
    pratyantar:  { lord, start, end },
    sookshma:    { lord, start, end }
  }
}
```

**Option B: explicit endpoint per level**
```
GET /api/dasha/maha?profileId=...
GET /api/dasha/antar?profileId=...&maha=Jupiter
GET /api/dasha/pratyantar?profileId=...&maha=Jupiter&antar=Mercury
GET /api/dasha/sookshma?profileId=...&maha=...&antar=...&pratyantar=...
```

Option A is preferred because computing sub-levels is deterministic and saves
a network round-trip per drill click.

---

## Tab 7: Free Report

Three sub-tabs at the top: **General | Remedies | Dosha**.

Under **General**, four pill sub-tabs:
- **General** — Description, Personality, Physical, Health, Career, Relationship
- **Planetary** — Sun Consideration, Moon, Mercury, Venus, Mars, Jupiter,
  Saturn, Rahu, Ketu Considerations (paragraph each)
- **Vimshottari Dasha** — Mars Mahadasha, Rahu Mahadasha … Moon Mahadasha
  (paragraph each with date range)
- **Yoga** — every detected yoga with name, condition rule, and prediction
  paragraph

Under **Remedies** and **Dosha** — similar nested structure (lifestyle,
gemstone, mantra, donation, fasting for Remedies; Mangal, Kalsarp, Sade Sati,
Pitra for Dosha).

**Floating CTA at the bottom of every Free Report sub-tab:**
> Connect with an Astrologer on Call or Chat for more personalised detailed
> predictions.
> [ Talk to Astrologer ] [ Chat with Astrologer ]

**Bottom strip:**
> Download & share your kundli report
> [ Download Kundli PDF ]

### Required API endpoint
```
GET /api/kundli/report?profileId=...&section=general|remedies|dosha
   &sub=general|planetary|vimshottari|yoga
→ {
  section, sub,
  blocks: [
    { title: "Description",  text: "Ascendant is one of …" },
    { title: "Personality",  text: "Those born with the Cancer …" },
    { title: "Physical",     text: "…" },
    …
  ]
}
```
Each `text` is a clean paragraph (no em-dashes, no markdown). The agent's
LLM-generation backend can write this from the chart data; cache the
generated text on the order doc so the second view is instant.

**Download Kundli PDF** call:
```
POST /api/kundli/pdf
body: { profileId, kind: 'free' | 'forecast12' | 'careerFinance' | 'lifetime' }
→ { pdf_url, file_name, size_bytes, valid_until }
```

---

## Visual / brand rules

**Colour palette** (white-paper modern look):
- Background: `#FFFFFF` with `#F8F4ED` muted bands for table headers / chart backgrounds
- Primary accent (maroon): `#7F2020`
- Secondary accent (gold): `#E2A21F` (used sparingly, e.g. step badge fill)
- Text: `#1A1A2E` (dark navy) for body, `#6B7280` for sub-text
- Success green: `#1B6B2F`
- Warning amber: `#E67E22`
- Danger red: `#C0392B`

**Typography**:
- Body: Inter or Source Sans Pro 14px
- Headings: Lora or Source Serif Pro for section titles
- Code / mono never used
- Numbers in tables: tabular-nums for clean alignment

**Layout**:
- Max width 1200px centred
- Cards have a subtle 1px border (`#E5E7EB`), rounded corners (`8px`), white
  fill, no drop shadow
- Spacing scale: 4, 8, 12, 16, 24, 32px (Tailwind 1/2/3/4/6/8)

**Hard rules on copy**:
- **NO em-dashes (—) or en-dashes (–) ANYWHERE** in user-visible text. Use
  commas, periods, parentheses, "and" instead. This is strict.
- **NO colourful emojis** (🪐 🕉️ ⚠️ 📊 etc). A small `·` separator dot is
  fine. Numbered pills are fine. Decorative emojis are not.
- Use Indian English spellings (colour, behaviour, favourable).
- Section titles in Title Case ("Planet Positions" not "PLANET POSITIONS").
- Date format DD-MMM-YYYY everywhere (e.g. 10-Aug-2019).
- Time zones written as `GMT+5.5`, not `IST` (more universal).

**Charts (SVG render rules)**:
- White paper background, maroon border 2px, internal divider lines 1px
  same colour
- Planet 2-letter codes use brand colours per planet (use a consistent
  palette: Sun=orange, Moon=blue, Mars=red, Mercury=green, Jupiter=yellow,
  Venus=pink, Saturn=dark blue, Rahu/Ketu=grey, Asc=maroon)
- House numbers in 9pt grey
- Retrograde marker: small `(R)` after the degree
- Combust marker: small `(C)`
- Watermark: tiny "@astroseer.in" bottom-right of each chart, 8pt, 30% opacity

---

## Interactivity behaviour

**Tab switching**: instant, no network call. All data for a profile loads in
one `/api/kundli/full?profileId=...` call when the page mounts (single round
trip, then the tabs just render slices). Cache for the session.

**North/South toggle**: client-side swap, no round trip (both SVGs already
loaded in the bundle response).

**Dasha drilldown**: instant client-side computation from the 9 Maha periods.

**Free Report Download PDF**: opens the existing `/api/kundli/pdf` flow,
returns a signed URL or base64 (whichever the operator configured), client
triggers download via Blob URL so Chrome's data-URL navigation block
doesn't break the click.

**Edit profile invalidates everything**: when the user edits dob/tob/place
on the profile, the relay drops the cached report (`deleteField()` on
`kundliProfiles/{id}.report`) and the next view re-fetches fresh data with
new birth signature.

---

## Mobile vs desktop

- Tabs: horizontal scroll on mobile (no wrap), pill style.
- Two-column sections (Basic, KP) stack vertically below 768px.
- Charts grid: 1 column below 640px, 2 columns at sm, 3 at md.
- Tables: horizontal scroll wrapper on mobile.
- Drilldown breadcrumb: truncates with `…` on narrow screens, full on
  desktop.

---

## Implementation order (for the agent)

Suggested commit cadence so each piece can be tested independently:

1. `/api/kundli/full?profileId` — returns ALL sections in one payload. Add
   the response-shape unit tests first.
2. Basic + Avakhada + Panchang tab (server already returns this; just
   render).
3. Kundli tab with North/South toggle + Lagna + Navamsa SVG + planets table.
4. Charts tab (12 divisionals).
5. Ashtakvarga tab (9 charts grid).
6. KP tab (Bhav Chalit + ruling + KP planets + cusps).
7. Dasha tab with stepper + drilldown + breadcrumb + LEVEL UP.
8. Free Report tab with all 3 sub-sections × all sub-pills.
9. Download Kundli PDF wired to existing relay endpoint.

Each step should ship a working slice (don't batch all of it into one
deploy).

---

## What's already in the AstroSeer relay today

Already wired (see push-relay/api/kundli.js + lib/kundliReport.js):
- `POST /api/kundli` returns kundli JSON (current shape: ascendant, planets,
  panchang, dashaRaw, dashaCurrentRaw, raw.avkahada_chakra, raw.yogas_detected,
  raw.doshas_full, raw.divisional_charts, raw.planetary_aspects,
  raw.friendship_tables, raw.jaimini_karakas, raw.special_lagnas,
  raw.chalit_table, raw.ghatak, raw.planet_interpretations,
  raw.planets_by_house, raw.transits).
- `POST /api/kundli` with `body.action='report'` returns a paid PDF (free
  Vedic, 12-month forecast, career, lifetime).
- 401 auto-recovery (retries without X-API-Key header when AstroSeer
  rotates keys).
- birthSig caching (same chart, same kind → same PDF, no re-bill).
- Inline base64 storage when no Vercel Blob token is set; Blob preferred
  when available.

What the agent still needs to add API-side:
- Split `/api/kundli` response into per-tab endpoints (or keep one fat
  payload and document the slice contract).
- Generate per-divisional SVGs server-side (D1, D2, D3, D4, D7, D9, D10,
  D12, D16, optionally D24/D30/D60) in both North and South styles.
- Ashtakvarga calculation and SVG rendering.
- KP cusps + ruling planets calculation.
- Yogini dasha endpoint (or computation if pure formula).
- Free Report text generation per planet / per dasha / per yoga / per
  remedy / per dosha — cached on the order doc so re-views are instant.

---

## Acceptance criteria

A junior dev should be able to copy a fresh kundli for a known birth
(Hyderabad, 01-11-1995, 00:20) and see EVERY field populated:

- Basic shows lat 17.3850, lng 78.4867, tz GMT+5.5, sunrise 06:14:22,
  ayanamsha 23.79886
- Avakhada shows Varna: Shudra, Yoni: Simha, Gan: Rakshasa, Nadi: Madhya,
  Sign Lord: Saturn (because Moon is in Capricorn)
- Kundli tab shows Asc Cancer 19.7° in House 1, Sun in Libra house 4 with
  status Debilitated
- Charts tab renders all 12 divisional grids with planets correctly placed
- Dasha shows Jupiter Maha 10-Aug-2019 to 10-Aug-2035, current Antar
  Mercury 10-Apr-2024 to 17-Jul-2026, current Pratyantar Saturn
- Drilling into Jupiter Maha shows JU-JU, JU-SA, JU-ME, JU-KE, JU-VE,
  JU-SU, JU-MO, JU-MA, JU-RA in that order with correct date math
- Free Report → General → General shows Cancer ascendant description
- Click Download Kundli PDF → file saves as `AstroSeer-Kundli-Vicky.pdf`,
  opens to a properly formatted PDF with the same data
