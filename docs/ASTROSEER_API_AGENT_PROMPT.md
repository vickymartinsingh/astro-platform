# Paste this entire message into the AstroSeer API agent chat

---

Hi. I work on the **AstroSeer customer + astrologer + admin apps** (separate
repo). I need you to extend the AstroSeer API at
`https://astroseer-api.onrender.com` to match the AstroTalk free-kundli flow,
which the product owner shared as the reference design. Match the **layout
and data shape**, not the brand.

The complete kundli viewer is 7 main tabs. For each tab I list:
- the data fields to return
- the API endpoint signature
- any SVG / chart rendering required
- visual + copy rules

Build the endpoints in order (Tab 1 → Tab 7). Ship each as its own commit so
I can test + integrate independently.

Once an endpoint is live on Render, reply with:
- the commit hash
- the endpoint URL
- a sample response payload for birth `Hyderabad, 01-11-1995, 00:20`,
  lat 17.385, lng 78.4867, tz +5.5

I'll probe it from my client and integrate immediately.

Acceptance test for the whole suite is at the bottom — every value listed
there must populate correctly for that exact birth before we ship to users.

---

## Tab 1: Basic

Two columns on desktop, stacked on mobile.

### Left column — Basic Details
| Field | Notes |
|---|---|
| Name | Profile name |
| Date | DD/MM/YYYY |
| Time | HH:MM AM/PM |
| Place | City, State, Country |
| Latitude | 4 decimals, no degree symbol in JSON |
| Longitude | 4 decimals |
| Timezone | `GMT+5.5` style, not `IST` |
| Sunrise | HH:MM:SS local time |
| Sunset | HH:MM:SS |
| Ayanamsha | Decimal degrees, e.g. `23.79886` |

### Left column — Panchang Details (below Basic)
| Field |
|---|
| Tithi |
| Karan |
| Yog |
| Nakshatra |

### Right column — Avakhada Details
| Field |
|---|
| Varna |
| Vashya |
| Yoni |
| Gan |
| Nadi |
| Sign (moon rasi) |
| Sign Lord |
| Nakshatra-Charan (`${nakshatra} pada ${pada}`) |
| Yog |
| Karan |
| Tithi |
| Yunja |
| Tatva |
| Name alphabet |
| Paya |

### Endpoint
```
GET /api/kundli/basic?year=&month=&day=&hour=&minute=&tz_offset=&latitude=&longitude=&name=
→ {
  basic: {
    name, date, time, place, latitude, longitude,
    timezone, sunrise, sunset, ayanamsha
  },
  panchang: {
    tithi, karana, yoga, nakshatra,
    sunrise, sunset, moonrise, moonset, paksha,
    rahu_kaal, gulika_kaal, yamaganda,
    day_of_birth, hindu_weekday
  },
  avakhada: {
    varna, vashya, yoni, gana, nadi,
    sign, sign_lord, nakshatra_charan,
    yunja, tatva, name_alphabet, paya
  }
}
```

---

## Tab 2: Kundli

**North Indian / South Indian** toggle at the top. Default is North.

**Two charts side-by-side** (stack on mobile):
- Left: **Lagna / Ascendant / Basic Birth Chart** (D1 Rasi)
- Right: **Navamsa** (D9)

Render planets as 2-letter codes in the right house with the degree appended:
e.g. `Su 14.07°`, `Sa 24.58°R` (R for retrograde).

**Planets table below the charts (11 columns):**
| Planet | Sign | Sign Lord | Nakshatra | Naksh Lord | Degree | Retro(R) | Combust | Avastha | House | Status |
|---|---|---|---|---|---|---|---|---|---|---|

- **Avastha**: Bala / Kumara / Yuva / Mrita / Vridha (age state per degree band)
- **Status**: Exalted / Debilitated / Mooltrikona / Owned / Friendly / Enemy / Neutral
- Include rows for Ascendant, Sun, Moon, Mars, Mercury, Jupiter, Venus,
  Saturn, Rahu, Ketu, Neptune, Uranus, Pluto

### Endpoint
```
GET /api/kundli/chart?...&style=north|south
→ {
  d1_north_svg: "<svg…>",
  d1_south_svg: "<svg…>",
  d9_north_svg: "<svg…>",
  d9_south_svg: "<svg…>",
  planets: [{
    name, sign, sign_lord, nakshatra, naksh_lord,
    degree,            // formatted: "14°04'22\""
    degree_decimal,    // 14.0729
    retrograde,        // bool
    combust,           // bool
    avastha,           // "Yuva"
    house,             // 1..12
    status             // "Debilitated"
  }]
}
```

SVG must be self-contained (inline web-safe fonts; brand colours; tiny
"@astroseer.in" watermark bottom-right at 8pt 30% opacity).

---

## Tab 3: KP (Krishnamurti Paddhati)

**Top-left:** Bhav Chalit Chart (North-style SVG, planets placed by KP cusp,
not by sign).

**Top-right:** Ruling Planets table
| | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|
| Mo | … | … | … |
| Asc | … | … | … |

| Day Lord | (single value) |

**Below:** KP Planets table
| Planets | Cusp | Sign | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|---|---|

**Then:** Cusps table (12 rows: cusp 1 through 12)
| Cusp | Degree | Sign | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|---|---|

### Endpoint
```
GET /api/kundli/kp?...
→ {
  chalit_svg: "<svg…>",
  ruling_planets: {
    moon: { sign_lord, star_lord, sub_lord },
    asc:  { sign_lord, star_lord, sub_lord },
    day_lord: "Mars"
  },
  kp_planets: [{ planet, cusp, sign, sign_lord, star_lord, sub_lord }],
  cusps: [{ cusp, degree, sign, sign_lord, star_lord, sub_lord }]
}
```

---

## Tab 4: Ashtakvarga

9 charts in a 3×3 grid. Above the grid, render this explainer paragraph:

> Ashtakvarga is used to assess the strength and patterns present in a birth
> chart. The Ashtakavarga is a numerical quantification or score of each
> planet placed in the chart with reference to the other 7 planets and the
> Lagna. In Sarva Ashtaka Varga the total scores of all the BAVs are
> overlaid and totalled. This makes the SAV of the chart. The total of all
> the scores should be 337.

The 9 charts:
1. **Sav** (Sarvashtakavarga — totals)
2. **Asc** (Ascendant BAV)
3. **Jupiter** BAV
4. **Mars** BAV
5. **Mercury** BAV
6. **Moon** BAV
7. **Saturn** BAV
8. **Sun** BAV
9. **Venus** BAV

Each chart is a North-style diamond with a single number per house (1..12).

### Endpoint
```
GET /api/kundli/ashtakvarga?...
→ {
  sav: { house_1: N, ..., house_12: N, total: 337 },
  bavs: {
    sun:       { house_1..12, total },
    moon:      { house_1..12, total },
    mars:      { house_1..12, total },
    mercury:   { house_1..12, total },
    jupiter:   { house_1..12, total },
    venus:     { house_1..12, total },
    saturn:    { house_1..12, total },
    ascendant: { house_1..12, total }
  },
  svgs: { sav, sun, moon, mars, mercury, jupiter, venus, saturn, ascendant }
}
```

---

## Tab 5: Charts (divisional)

**North Indian / South Indian toggle at top**, applied to ALL 12 charts.

12 charts in a 3-column grid:

| # | Code | Label |
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

Each is a North or South style SVG with planets placed in their sign for
that divisional chart.

### Endpoint
```
GET /api/kundli/divisional?...&style=north|south
→ {
  chalit:         "<svg…>",
  sun_chart:      "<svg…>",
  moon_chart:     "<svg…>",
  d1_lagna:       "<svg…>",
  d2_hora:        "<svg…>",
  d3_drekkana:    "<svg…>",
  d4_chaturthamsa:"<svg…>",
  d7_saptamsa:    "<svg…>",
  d9_navamsa:     "<svg…>",
  d10_dasamsa:    "<svg…>",
  d12_dwadasamsa: "<svg…>",
  d16_shodasamsa: "<svg…>"
}
```

Optional: also support D24, D30, D60 if your engine has them.

---

## Tab 6: Dasha (4-level interactive drilldown)

**Top sub-toggle:** Vimshottari / Yogini (default Vimshottari).

**Stepper across the top:**
```
1 Mahadasha ─── 2 Antardasha ─── 3 Pratyantardasha ─── 4 Sookshmadasha
```
The current depth is filled-accent (yellow/gold), the rest are outlined.

**Table at current level:**
| Planet | Start Date | End Date | (chevron ›) |
|---|---|---|---|

Clicking a row drills ONE level deeper. Above the table, show a breadcrumb
of the path so far:
```
Pingala > Sankata > Bhadrika
```

A **LEVEL UP** button below the table goes back one level. Disabled at
Mahadasha level (root).

Date format: `DD-MMM-YYYY` (e.g. `10-Aug-2019`).

### Vimshottari math (deterministic)
Sequence: **Ketu 7, Venus 20, Sun 6, Moon 10, Mars 7, Rahu 18, Jupiter 16,
Saturn 19, Mercury 17** — total 120 years.

For each level:
- Sub-periods run in the SAME 9-planet sequence starting from the parent
  period's lord
- Sub-period length = `(parent_years × sub_lord_years) / 120`
- Recursive: pratyantar uses antar as parent; sookshma uses pratyantar as
  parent

### Yogini math
8-planet cycle: **MAN(Mangala) 1, PIN(Pingala) 2, DHA(Dhanya) 3, BHR(Bhramari) 4,
BHA(Bhadrika) 5, ULK(Ulka) 6, SID(Siddha) 7, SAN(Sankata) 8** — total 36 years.
Sub-period same recursion rule.

### Endpoint (preferred: single fat endpoint, client computes sub-levels)
```
GET /api/dasha?...&system=vimshottari|yogini
→ {
  system: "vimshottari",
  periods: [
    { lord: "Mars",    start: "ISO", end: "ISO", years: 5.775 },
    { lord: "Rahu",    start: "ISO", end: "ISO", years: 18 },
    …  // 9 mahas covering ~120 years from birth
  ],
  current: {
    maha:       { lord, start, end },
    antar:      { lord, start, end },
    pratyantar: { lord, start, end },
    sookshma:   { lord, start, end }
  }
}
```

The client computes antar / pratyantar / sookshma client-side using the
deterministic formula above. No drill-click should round-trip to the
server.

---

## Tab 7: Free Report

Three sub-tabs at the top: **General | Remedies | Dosha**

Each section has its own set of sub-pills:

**General section sub-pills:**
- **General** — Description, Personality, Physical, Health, Career, Relationship
- **Planetary** — Sun Consideration, Moon, Mercury, Venus, Mars, Jupiter,
  Saturn, Rahu, Ketu Considerations (one paragraph each)
- **Vimshottari Dasha** — Mars Mahadasha, Rahu Mahadasha … Moon Mahadasha
  (one paragraph each with date range in the header)
- **Yoga** — every detected yoga with name, formation rule, prediction
  paragraph (Sunapha Yoga, Vasumathi Yoga, Budha-Aditya Yoga, Kahala Yoga,
  Gajakesari Yoga, Raj Yoga, Mahapurusha Yoga etc)

**Remedies section sub-pills:** Lifestyle, Gemstone, Mantra, Donation, Fasting
(each tailored to weak planets / active doshas in the chart)

**Dosha section sub-pills:** Mangal, Kalsarp, Sade Sati, Pitra
(each with: presence, severity, effect, remedies, current activation window)

**Floating CTA at the bottom of every Free Report sub-tab:**
> Connect with an Astrologer on Call or Chat for more personalised
> detailed predictions.
> [ Talk to Astrologer ] [ Chat with Astrologer ]

**Bottom strip:**
> Download and share your kundli report
> [ Download Kundli PDF ]

### Endpoint
```
GET /api/kundli/report?...&section=general|remedies|dosha&sub=general|planetary|vimshottari|yoga
→ {
  section, sub,
  blocks: [
    { title: "Description",  text: "Ascendant is one of the most …" },
    { title: "Personality",  text: "Those born with the Cancer ascendant …" },
    …
  ]
}
```

Each `text` is a clean paragraph — no markdown, no em-dashes. Cache the
generated text per `(profileId, section, sub)` so the second view is
instant.

### PDF download
```
POST /api/kundli/pdf
body: { birth, kind: 'free'|'forecast12'|'careerFinance'|'lifetime' }
→ application/pdf bytes (or JSON { pdf_url } if you stage to storage)
```

---

## Visual / brand rules

### Colour palette (white-paper modern look)
- Background: `#FFFFFF`. Subtle bands `#F8F4ED` for table headers and chart
  backgrounds
- Primary maroon: `#7F2020`
- Gold accent: `#E2A21F` (for stepper "current" pill, sparingly elsewhere)
- Text body: `#1A1A2E`
- Text sub: `#6B7280`
- Success: `#1B6B2F`
- Warning: `#E67E22`
- Danger: `#C0392B`

### Typography
- Body: Inter or Source Sans Pro 14px
- Headings: Lora or Source Serif Pro
- Numbers in tables: `font-variant-numeric: tabular-nums`

### Chart SVG rules
- White paper background, 2px maroon border, 1px internal divider lines
- Planet 2-letter codes coloured per planet:
  - Sun (Su): orange `#F59E0B`
  - Moon (Mo): blue `#3B82F6`
  - Mars (Ma): red `#DC2626`
  - Mercury (Me): green `#10B981`
  - Jupiter (Ju): yellow-brown `#92400E`
  - Venus (Ve): pink `#EC4899`
  - Saturn (Sa): dark blue `#1E3A8A`
  - Rahu (Ra) + Ketu (Ke): grey `#6B7280`
  - Ascendant (Asc): maroon `#7F2020`
- House numbers in 9pt grey `#9CA3AF`
- Retrograde marker: small `(R)` after the degree
- Combust marker: small `(C)`
- Watermark: tiny `@astroseer.in` bottom-right, 8pt, 30% opacity

### Layout
- Max width 1200px centred
- Cards: 1px border `#E5E7EB`, 8px rounded, white fill, no drop shadow
- Spacing scale: 4, 8, 12, 16, 24, 32px (Tailwind 1/2/3/4/6/8)

### Mobile breakpoints
- < 768px: two-column sections (Basic, KP) stack vertically
- < 640px: chart grids go 1-column
- Tabs: horizontal scroll on mobile, pill style

---

## Hard copy rules

These are strict — NO exceptions:

1. **No em-dashes (—) or en-dashes (–) ANYWHERE** in user-visible text.
   Use commas, periods, parentheses, "and" instead. This is brand voice.
2. **No colourful emojis** (🪐 🕉️ ⚠️ 📊 etc). Numbered pills (1, 2, 3) and
   plain text. A small `·` separator dot is fine. No decorative glyphs.
3. **Indian English spellings**: colour, behaviour, favourable, organisation
4. **Title Case** for section titles ("Planet Positions" not "PLANET
   POSITIONS")
5. **Dates as DD-MMM-YYYY** (e.g. 10-Aug-2019). Never `Aug 10, 2019` or
   `08/10/2019` (ambiguous).
6. **Time zones as `GMT+5.5`**, not `IST` (more universal).
7. **Degrees with arc-minutes/seconds** in tables: `14°04'22"`. Decimal
   degrees only inside JSON for downstream math.

---

## Interactivity behaviour the client expects

- **Tab switching**: instant, no network call. Client should call ONE fat
  endpoint `/api/kundli/full?...` once when the profile opens, then render
  slices per tab.
- **North/South toggle**: client-side swap. Both SVGs must be in the
  initial payload.
- **Dasha drilldown**: instant client-side computation from the 9 Maha
  periods.
- **PDF download**: returns bytes or a signed URL. Client converts to a Blob
  URL because Chrome blocks navigation to large data: URLs.

### Optional: fat single endpoint (highly recommended)
```
GET /api/kundli/full?...&style=north|south
→ {
  basic: { … },
  panchang: { … },
  avakhada: { … },
  chart: { d1_north_svg, d1_south_svg, d9_north_svg, d9_south_svg, planets: [...] },
  kp: { chalit_svg, ruling_planets, kp_planets, cusps },
  ashtakvarga: { sav, bavs, svgs },
  divisional: { chalit, sun_chart, moon_chart, d1_lagna, d2_hora, ..., d16_shodasamsa },
  dasha: { vimshottari: { periods, current }, yogini: { periods, current } },
  report: { general: {...}, remedies: {...}, dosha: {...} }
}
```
This is the single payload the client will request. Each per-tab endpoint
above is its own debuggable thing but the client mostly hits `/full`.

---

## Auth note

Right now the relay (push-relay.vercel.app) handles auth via `X-API-Key`.
We just shipped a fallback: if the relay gets 401 from your API, it retries
without the key. So feel free to enforce auth strictly when you're ready —
the customer flow won't break during the transition.

When you DO enforce auth, please document:
- key generation flow (UI link or curl example)
- key rotation procedure
- which header name (`X-API-Key` confirmed?)

---

## Acceptance test

For birth **Hyderabad, 01-11-1995, 00:20 IST, lat 17.385, lng 78.4867,
tz +5.5**:

| Tab | Field | Expected value |
|---|---|---|
| Basic | Latitude | 17.3850 |
| Basic | Longitude | 78.4867 |
| Basic | Timezone | GMT+5.5 |
| Basic | Sunrise | 06:14:22 |
| Basic | Ayanamsha | 23.79886 |
| Avakhada | Varna | Shudra |
| Avakhada | Yoni | Simha |
| Avakhada | Gan | Rakshasa |
| Avakhada | Nadi | Madhya |
| Avakhada | Sign | Capricorn (because Moon is in Capricorn) |
| Avakhada | Sign Lord | Saturn |
| Avakhada | Nakshatra-Charan | Dhanishta Pada 1 |
| Avakhada | Paya | Copper |
| Kundli | Ascendant | Cancer, 19°43'56", House 1, lord Moon |
| Kundli | Sun | Libra, house 4, 14°04'22", status Debilitated |
| Kundli | Moon | Capricorn, house 7, 25°39'59", status Enemy |
| Kundli | Mars | Scorpio, house 5, status Owned |
| Kundli | Saturn | Aquarius, house 8, status Mooltrikona, Retrograde |
| Dasha | Current Maha | Jupiter, 10-Aug-2019 to 10-Aug-2035 |
| Dasha | Current Antar | Mercury, 10-Apr-2024 to 17-Jul-2026 |
| Dasha | Current Pratyantar | Saturn, 08-Mar-2026 to 17-Jul-2026 |
| Dasha drill | Click Jupiter Maha | Should show JU-JU, JU-SA, JU-ME, JU-KE, JU-VE, JU-SU, JU-MO, JU-MA, JU-RA in that order |
| Free Report | General → Description | Mentions "Your ascendant is Cancer" |

All values above must populate. Anything blank or `null` is a bug.

---

## Build order (one commit per row)

1. `GET /api/kundli/basic` — Tab 1
2. `GET /api/kundli/chart?style=` — Tab 2 (D1 + D9 + planets table)
3. `GET /api/kundli/kp` — Tab 3
4. `GET /api/kundli/ashtakvarga` — Tab 4
5. `GET /api/kundli/divisional?style=` — Tab 5 (12 SVGs)
6. `GET /api/dasha?system=` — Tab 6 (just the 9 mahas; client computes
   sub-levels)
7. `GET /api/kundli/report?section=&sub=` — Tab 7
8. `POST /api/kundli/pdf` — bottom strip download
9. `GET /api/kundli/full` — convenience fat endpoint that wraps all 7
   results in one call (for instant tab switching on the client)

Reply after each commit with hash + endpoint URL + sample payload for the
acceptance-test birth and I'll verify within an hour.

---

## Repo / contact

I'm working in repo `vickymartinsingh/astro-platform`. The full kundli spec
(longer version of this prompt) is at `docs/KUNDLI_API_SPEC.md` in that
repo if you want a deeper reference.

Thanks. Ping me when Tab 1 is live.
