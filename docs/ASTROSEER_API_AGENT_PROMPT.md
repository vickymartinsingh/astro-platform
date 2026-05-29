# Paste this entire message into the AstroSeer API agent chat

---

Hi. I work on the **AstroSeer customer + astrologer + admin apps** (separate
repo). I need you to extend the AstroSeer API at
`https://astroseer-api.onrender.com` to match the AstroTalk free-kundli flow,
which the product owner shared as the reference design. Match the **layout
and data shape**, not the brand.

The complete kundli viewer is **7 main top-tabs**, each with sub-sections.
For each, I list:
- the exact data fields to return (matching every column and row visible in
  the AstroTalk reference)
- the API endpoint signature with request + response JSON
- any SVG rendering required
- interactive behaviour (toggles, drilldowns, breadcrumbs, LEVEL UP buttons)

Build the endpoints in order (Tab 1 → Tab 7), one commit per endpoint.

Once an endpoint is live on Render, reply with:
- commit hash
- endpoint URL
- sample response payload for the standard test birth (see Acceptance Test
  at the bottom)

I'll probe it from the client and integrate immediately.

---

## Top tab strip

The customer always sees these 7 tabs across the top, always in this order:
**Basic | Kundli | KP | Ashtakvarga | Charts | Dasha | Free Report**

The currently selected tab gets a yellow filled background and bold label.
Inactive tabs are white with a thin border.

---

# Tab 1: Basic

## Layout
Two columns on desktop, stacked on mobile. Heading "Basic Details" on the
left column, "Avakhada Details" on the right. Below the left column, a
third boxed section titled "Panchang Details".

## Left column - Basic Details

| Field | Format / source |
|---|---|
| Name | Profile name as entered (e.g. `Vicky Martin Singh`) |
| Date | `DD/MM/YYYY` (e.g. `01/11/1995`) |
| Time | `HH:MM AM/PM` (e.g. `12:20 AM`) |
| Place | `City, State, Country` (e.g. `Hyderabad, Telangana, India`) |
| Latitude | 2 decimal places, no degree symbol in JSON (e.g. `17.38`) |
| Longitude | 2 decimal places (e.g. `78.46`) |
| Timezone | `GMT±N.N` (e.g. `GMT+5.5`, never `IST`) |
| Sunrise | `H:MM:SS` (e.g. `6:14:22`) |
| Sunset | `HH:MM:SS` (e.g. `17:44:58`) |
| Ayanamsha | Decimal degrees, 5 decimals (e.g. `23.79886`) |

## Left column - Panchang Details (below Basic Details)

| Field |
|---|
| Tithi |
| Karan |
| Yog |
| Nakshatra |

## Right column - Avakhada Details

| Field | Notes |
|---|---|
| Varna | e.g. `Shudra` |
| Vashya | e.g. `Jalchar` |
| Yoni | e.g. `Simha` |
| Gan | e.g. `Rakshasa` |
| Nadi | e.g. `Madhya` |
| Sign | Moon sign (e.g. `Capricorn`) |
| Sign Lord | Moon sign's ruling planet (e.g. `Saturn`) |
| Nakshatra-Charan | e.g. `Dhanishta` (just the nakshatra name shown) |
| Yog | Same as Panchang Yog |
| Karan | Same as Panchang Karan |
| Tithi | e.g. `ShuklaNavami` (CamelCase: no space) |
| Yunja | e.g. `Antya` |
| Tatva | e.g. `Earth` |
| Name alphabet | e.g. `Gaa` |
| Paya | e.g. `Copper` |

## Endpoint
```
GET /api/kundli/basic?year=&month=&day=&hour=&minute=&tz_offset=&latitude=&longitude=&name=
→ {
  basic: {
    name, date, time, place, latitude, longitude,
    timezone, sunrise, sunset, ayanamsha
  },
  panchang: {
    tithi, karan, yog, nakshatra,
    sunrise, sunset, moonrise, moonset, paksha,
    rahu_kaal, gulika_kaal, yamaganda,
    day_of_birth, hindu_weekday
  },
  avakhada: {
    varna, vashya, yoni, gan, nadi,
    sign, sign_lord, nakshatra_charan,
    yog, karan, tithi,
    yunja, tatva, name_alphabet, paya
  }
}
```

---

# Tab 2: Kundli

## Layout
- **North Indian | South Indian** toggle pill at top, centred. Default
  selection: North Indian (filled gold). User's choice saved on the user
  profile (`users/{uid}.chartStyle`).
- Below the toggle: two square chart cards side-by-side, each with a label
  above:
  - Left: **Lagna / Ascendant / Basic Birth Chart**
  - Right: **Navamsa**
- Below the charts: a single "Planets" header centred.
- Below that: the Planets table.

## Chart rendering (both North and South)
- Each chart is a square SVG, ~400×400px, with cream/parchment background
  (`#F8F4ED`) and dark gold border (`#7F2020` 2px).
- Planets inside each house use **2-letter codes**:
  - `Su` Sun, `Mo` Moon, `Ma` Mars, `Me` Mercury, `Ju` Jupiter,
    `Ve` Venus, `Sa` Saturn, `Ra` Rahu, `Ke` Ketu,
    `Ne` Neptune, `Ur` Uranus, `Pl` Pluto, `Asc` Ascendant
- Each planet shown with degree appended: `Su-14.07°`, `Sa-24.58°®`
  (the `®` = retrograde, registered-trademark style superscript R).
- House numbers `1` through `12` shown small inside each house (8-9pt,
  grey).
- Tiny `@astroseer.in` watermark bottom-right, 8pt, 30% opacity.
- Per-planet colour map for the codes:
  - Sun (Su): orange `#F59E0B`
  - Moon (Mo): blue `#3B82F6`
  - Mars (Ma): red `#DC2626`
  - Mercury (Me): green `#10B981`
  - Jupiter (Ju): yellow-brown `#92400E`
  - Venus (Ve): pink `#EC4899`
  - Saturn (Sa): dark blue `#1E3A8A`
  - Rahu (Ra) + Ketu (Ke): grey `#6B7280`
  - Neptune (Ne): teal `#0EA5E9`
  - Uranus (Ur): cyan `#06B6D4`
  - Pluto (Pl): dark red `#991B1B`
  - Ascendant (Asc): maroon `#7F2020`

## Planets table - 11 columns

| Planet | Sign | Sign Lord | Nakshatra | Naksh Lord | Degree | Retro(R) | Combust | Avastha | House | Status |
|---|---|---|---|---|---|---|---|---|---|---|

Rows must include **13 entries** in this exact order:
1. **Ascendant** - House 1, Degree shown, Retro/Combust/Avastha/Status as `--`
2. **Sun**
3. **Moon**
4. **Mercury**
5. **Venus**
6. **Mars**
7. **Jupiter**
8. **Saturn**
9. **Rahu**
10. **Ketu**
11. **Neptune**
12. **Uranus**
13. **Pluto**

### Field rules
- **Degree** column: arc-minutes/seconds format `14°4'22"`
- **Retro(R)**: `Direct` or `Retro` (do NOT use just `R` - full word)
- **Combust**: `Yes` or `No`
- **Avastha**: one of `Bala`, `Kumara`, `Yuva`, `Mrita`, `Vridha` (age
  state from degree position)
- **Status**: one of `Exalted`, `Debilitated`, `Mooltrikona`, `Owned`,
  `Friendly`, `Enemy`, `Neutral`, or `--` for Ascendant + outer planets

## Endpoint
```
GET /api/kundli/chart?...&style=north|south
→ {
  d1_north_svg: "<svg…>",
  d1_south_svg: "<svg…>",
  d9_north_svg: "<svg…>",
  d9_south_svg: "<svg…>",
  planets: [{
    planet,            // "Ascendant", "Sun", ...
    sign,              // "Cancer", "Libra", ...
    sign_lord,         // "Moon", "Venus", ...
    nakshatra,         // "Ashlesha", "Swati", ...
    naksh_lord,        // "Mercury", "Rahu", ...
    degree,            // "19°42'9\""
    degree_decimal,    // 19.7025
    retro,             // "Direct" | "Retro"
    combust,           // "Yes" | "No"
    avastha,           // "Bala" | "Kumara" | "Yuva" | "Mrita" | "Vridha"
    house,             // 1..12
    status             // "Debilitated" | "Friendly" | "--" | ...
  }]
}
```

---

# Tab 3: KP (Krishnamurti Paddhati)

## Layout
- **Top-left:** Bhav Chalit Chart (square North-style SVG, planets placed
  by KP cusp, NOT by sign).
- **Top-right:** Ruling Planets table.
- **Below:** Planets table (KP-specific).
- **Below that:** Cusps table (12 rows for cusps 1-12).

## Ruling Planets table

| | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|
| **Mo** | Mercury | Moon | RAHU |
| **Asc** | Venus | Sun | Saturn |

Row below the table, spanning the full width:
| | |
|---|---|
| **Day Lord** | Mars |

## KP Planets table

| Planets | Cusp | Sign | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|---|---|

Rows: Sun, Moon, Mars, Rahu, Jupiter, Saturn, Mercury, Ketu, Venus,
Neptune, Uranus, Pluto (12 entries).

## Cusps table - 12 rows

| Cusp | Degree | Sign | Sign Lord | Star Lord | Sub Lord |
|---|---|---|---|---|---|

Rows 1 through 12. `Degree` is decimal (e.g. `109.7`, `136.86`).

## Floating CTA at the bottom
> Connect with an Astrologer on Call or Chat for more personalised
> detailed predictions.
> [ Talk to Astrologer ] [ Chat with Astrologer ]

## Endpoint
```
GET /api/kundli/kp?...
→ {
  chalit_svg: "<svg…>",
  ruling_planets: {
    moon: { sign_lord, star_lord, sub_lord },
    asc:  { sign_lord, star_lord, sub_lord },
    day_lord: "Mars"
  },
  kp_planets: [{
    planet, cusp, sign, sign_lord, star_lord, sub_lord
  }],
  cusps: [{
    cusp,             // 1..12
    degree,           // decimal e.g. 109.7
    sign, sign_lord, star_lord, sub_lord
  }]
}
```

---

# Tab 4: Ashtakvarga

## Layout
- Title centred: **Ashtakvarga Chart**
- Explainer paragraph below the title (full width):

  > Ashtakvarga is used to assess the strength and patterns that are
  > present in a birth chart. The Ashtakavarga is a numerical
  > quantification or score of each planet placed in the chart with
  > reference to the other 7 planets and the Lagna. In Sarva Ashtaka Varga
  > the total scores of all the BAVs are overlaid and then totalled. This
  > makes the SAV of the chart. The total of all the scores should be 337.

- **9 charts in a 3×3 grid**, each with a label above. Order, row by row:
  1. **Sav** (Sarvashtakavarga totals)
  2. **Asc** (Ascendant BAV)
  3. **Jupiter**
  4. **Mars**
  5. **Mercury**
  6. **Moon**
  7. **Saturn**
  8. **Sun**
  9. **Venus**

- Each chart is a North-Indian style diamond. Each of the 12 houses
  contains a single number (the score for that house). No planet codes - just numbers.
- Floating "Connect with an Astrologer" CTA below the grid (same wording
  as KP tab).

## Endpoint
```
GET /api/kundli/ashtakvarga?...
→ {
  explainer: "Ashtakvarga is used to assess …",
  sav: {
    houses: [35, 29, 28, 28, 27, 26, 31, 26, 30, 36, 25, 16],  // 12 vals
    total: 337
  },
  bavs: {
    ascendant: { houses: [4, 2, 4, 5, 3, 6, 4, 2, 4, 5, 4, 4], total: 47 },
    jupiter:   { houses: [...], total: ... },
    mars:      { houses: [...], total: ... },
    mercury:   { houses: [...], total: ... },
    moon:      { houses: [...], total: ... },
    saturn:    { houses: [...], total: ... },
    sun:       { houses: [...], total: ... },
    venus:     { houses: [...], total: ... }
  },
  svgs: {
    sav:       "<svg…>",
    ascendant: "<svg…>",
    jupiter:   "<svg…>",
    mars:      "<svg…>",
    mercury:   "<svg…>",
    moon:      "<svg…>",
    saturn:    "<svg…>",
    sun:       "<svg…>",
    venus:     "<svg…>"
  }
}
```

---

# Tab 5: Charts (12 divisional charts)

## Layout
- **North Indian | South Indian** toggle at top (same component as Tab 2).
  Applies to ALL 12 charts simultaneously.
- **12 charts in a 3-column grid**, 4 rows. Order is fixed:

| Row | Col 1 | Col 2 | Col 3 |
|---|---|---|---|
| 1 | Chalit | Sun | Moon |
| 2 | Lagna / Ascendant / Basic Birth Chart | Hora (Wealth / Income Chart) | Drekkana (Relationship with siblings) |
| 3 | Chaturthamsa (Assets) | Saptamsa (Progeny) | Navamsa (Prospects of marriage) |
| 4 | Dasamsa (Profession) | Dwadasamsa (Native parents / Ancestors) | Shodasamsa (Travel) |

- Each chart card shows a label above the chart with the descriptive
  parenthetical (e.g. "Hora (Wealth / Income Chart)").
- Same chart rendering rules as Tab 2 (planet 2-letter codes coloured per
  planet, retrograde `®`, watermark).

## Endpoint
```
GET /api/kundli/divisional?...&style=north|south
→ {
  chalit:          "<svg…>",
  sun_chart:       "<svg…>",
  moon_chart:      "<svg…>",
  d1_lagna:        "<svg…>",
  d2_hora:         "<svg…>",
  d3_drekkana:     "<svg…>",
  d4_chaturthamsa: "<svg…>",
  d7_saptamsa:     "<svg…>",
  d9_navamsa:      "<svg…>",
  d10_dasamsa:     "<svg…>",
  d12_dwadasamsa:  "<svg…>",
  d16_shodasamsa:  "<svg…>"
}
```

Optional: ship `d24`, `d30`, `d60` if your engine produces them.

---

# Tab 6: Dasha (4-level interactive drilldown)

## Layout

### Top sub-toggle
**Vimshottari | Yogini** pill, default Vimshottari. User's choice saved on
the profile. Note line below the toggle (only visible in Yogini view):

> Note: MAN: Mangala, PIN: Pingala, DHA: Dhanya, BHR: Bhramari,
> BHA: Bhadrika, ULK: Ulka, SID: Siddha, SAN: Sankata

### Stepper (always visible)
Horizontal stepper showing 4 numbered circles connected by lines:

```
1 Mahadasha ───── 2 Antardasha ───── 3 Pratyantardasha ───── 4 Sookshmadasha
```

- The current level's circle is filled with the brand accent (gold/yellow
  `#E2A21F`).
- Levels NOT yet reached have a faint outline.
- Levels already passed have a thin gold outline.

### Breadcrumb (visible when below Maha level)
Shown directly above the table on levels 2, 3, 4:
```
Pingala > Sankata > Bhadrika
```
or for Vimshottari:
```
Jupiter > Mercury > Saturn
```

### Table at current level
Three columns plus a chevron at the end of every row:

| Planet | Start Date | End Date | (chevron ›) |
|---|---|---|---|

- **Planet column** shows the path code, NOT just the lord:
  - At Mahadasha level: `Mars`, `Rahu`, `Jupiter`, … (full names)
  - At Antardasha: `JU-JU`, `JU-SA`, `JU-ME`, … (parent-child 2-letter codes)
  - At Pratyantar: `JU-KE-KE`, `JU-KE-VE`, …
  - At Sookshma: `JU-KE-KE-KE`, `JU-KE-KE-VE`, …
  - For Yogini: `SAN-BHA-BHA`, `SAN-BHA-ULK`, etc (3-letter codes)
- **Start Date** and **End Date** format: `DD-MMM-YYYY` (e.g. `10-Aug-2019`).
  At Maha level, the very first period's start date can be the word `Birth`
  instead of a date.
- Each row has a clickable chevron `›` at the right that drills ONE level
  deeper.

### LEVEL UP button (visible at levels 2, 3, 4)
Full-width yellow button below the table:
```
[                       LEVEL UP                       ]
```
Disabled / hidden at Mahadasha level (you can't go up from root).

## Vimshottari math (deterministic)
Sequence (in order): **Ketu 7, Venus 20, Sun 6, Moon 10, Mars 7, Rahu 18,
Jupiter 16, Saturn 19, Mercury 17** - total 120 years.

For each level:
- Sub-periods run in the SAME 9-planet sequence starting from the parent
  period's lord.
- Sub-period length = `(parent_years × sub_lord_years) / 120`.
- Recursive: pratyantar uses antar as parent; sookshma uses pratyantar as
  parent.

## Yogini math
8-planet cycle (in order): **Mangala 1, Pingala 2, Dhanya 3, Bhramari 4,
Bhadrika 5, Ulka 6, Siddha 7, Sankata 8** - total 36 years.

Same recursive sub-period formula.

## Endpoint (preferred: single fat endpoint, client computes sub-levels)
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

Yogini variant returns 8 periods totalling 36 years.

The client computes Antar/Pratyantar/Sookshma client-side from the maha
periods using the formula above. No API call per drill-click.

### Bonus: Rashi Chart visible in Yogini view
At the bottom of the Yogini view, ALSO render the Rashi (D1) chart (the
same SVG as Tab 2). This is shown directly below the drill table for
reference while reading dashas.

---

# Tab 7: Free Report

## Layout
- **Three top sub-tabs:** General | Remedies | Dosha (General active by
  default).
- Below each top sub-tab: **four sub-pills** (these are different per top
  tab). For General, they are:
  **General | Planetary | Vimshottari Dasha | Yoga**

### Section: General → General
A series of titled paragraph cards in this order:

| Title | Content |
|---|---|
| **Description** | "Ascendant is one of the most sought concepts in astrology when it comes to predicting the minute events in your life. At the time of birth, the sign that rises in the sky is the person's ascendant. It helps in making predictions about the minute events, unlike your Moon or Sun sign that help in making weekly, monthly or yearly predictions for you." Then a line below: "Your ascendant is {Sign}" |
| **Personality** | Paragraph describing personality traits for the ascendant sign (5-7 sentences) |
| **Physical** | Paragraph describing physical features (5-6 sentences) |
| **Health** | Paragraph describing health tendencies (5-6 sentences) |
| **Career** | Paragraph describing career strengths (4-5 sentences) |
| **Relationship** | Paragraph describing relationship style for both genders (5-6 sentences) |

### Section: General → Planetary
One titled paragraph card per planet (9 cards). Each card has a title and
TWO paragraphs (first paragraph: the planet's house placement effect;
second paragraph: planet + sign combination effect):

| Title |
|---|
| **Sun Consideration** |
| **Moon Consideration** |
| **Mercury Consideration** |
| **Venus Consideration** |
| **Mars Consideration** |
| **Jupiter Consideration** |
| **Saturn Consideration** |
| **Rahu Consideration** |
| **Ketu Consideration** |

### Section: General → Vimshottari Dasha
One card per Mahadasha (9 cards in birth-to-death order). Header shows
the date range on the right:

```
| Mars Mahadasha                          (10-08-1994 - 10-08-2001) |
| The planet Mars is in the fifth house … |
|                                                                   |
| The planet Mars is camping with the Scorpio sign … |
```

Each card has TWO paragraphs (planet+house effect, then planet+sign
effect). Cards listed in order:
1. Mars Mahadasha
2. Rahu Mahadasha
3. Jupiter Mahadasha
4. Saturn Mahadasha
5. Mercury Mahadasha
6. Ketu Mahadasha
7. Venus Mahadasha
8. Sun Mahadasha
9. Moon Mahadasha

### Section: General → Yoga
One card per detected yoga. Each card has: name, formation rule (1 line in
muted text), prediction paragraph (3-4 sentences). Examples:

| Title | Rule line | Prediction paragraph |
|---|---|---|
| **Sunapha Yoga** | Any planets, except Sun, in the second house from the Moon. | "Sunapha Yoga indicates that you will be the proud owner of several properties …" |
| **Vasumathi Yoga** | Benefics occupy the upachayas 3, 6, 10, or 11 either from the ascendant or from the Moon. | "Vasumathi Yoga hints at your hard-working nature. Your diligence …" |
| **Budha-Aditya Yoga** | Mercury combines with the Sun. | "Budha-Aditya Yoga suggests that you will be highly intelligent. You will persevere …" |
| **Kahala Yoga** | Lords of fourth and ninth houses in Kendras from each other. | "If you have Kahala Yoga, there are most chances that you are stubborn …" |

Include every yoga the chart actually qualifies for (Mahapurusha 5,
Gajakesari, Raj Yogas, Dhana Yogas, Vipreet Raj, Neechabhanga, Adhi,
Chandra Mangala etc - about 20-40 yogas total in a typical chart).

### Section: Remedies sub-pills
Suggested sub-pills (mirror screenshot if possible):
**General | Lifestyle | Gemstone | Mantra | Donation | Fasting**

Each is a list of remedy cards tailored to:
- Weak planets (low shadbala)
- Active doshas
- Difficult dasha periods
- Malefic house placements

### Section: Dosha sub-pills
Suggested sub-pills:
**General | Mangal | Kalsarp | Sade Sati | Pitra | Kemadruma | Grahan**

Each shows:
- Title
- Presence (Yes/No)
- Severity (Low/Medium/High) when present
- Explanation paragraph
- Activation windows (start/end dates)
- Remedies list

## Floating CTA at the bottom of every Free Report sub-tab
> Connect with an Astrologer on Call or Chat for more personalised
> detailed predictions.
> [ Talk to Astrologer ] [ Chat with Astrologer ]

## Bottom strip (always visible at the very bottom of the page)
Full-width gold band with a small icon on the left and big white text:
```
            Download and share your kundli report
                  [ Download Kundli PDF ]
```

## Endpoint
```
GET /api/kundli/report?...&section=general|remedies|dosha&sub=general|planetary|vimshottari|yoga|...
→ {
  section, sub,
  blocks: [
    {
      title: "Description",
      header_right: "",        // optional date range etc
      paragraphs: ["Ascendant is one of the most sought …",
                   "Your ascendant is Cancer"]
    },
    {
      title: "Personality",
      paragraphs: ["Those born with the Cancer ascendant are …"]
    },
    …
  ]
}
```

Each `paragraphs` is an array of cleanly-written sentences (no markdown,
no em-dashes). Cache per `(birthSig, section, sub)` so the second view is
instant.

## PDF download endpoint
```
POST /api/kundli/pdf
body: { birth, kind: 'free'|'forecast12'|'careerFinance'|'lifetime' }
→ application/pdf bytes  (or JSON { pdf_url, file_name, size_bytes })
```

---

# Visual / brand rules

## Colour palette (white-paper modern look)
- Background: `#FFFFFF`. Subtle bands `#F8F4ED` for table headers and chart
  backgrounds
- Primary maroon: `#7F2020`
- Gold accent: `#E2A21F` (used for: active stepper circle, "LEVEL UP" button,
  bottom PDF strip, active top tab pill)
- Text body: `#1A1A2E`
- Text sub: `#6B7280`
- Success: `#1B6B2F`
- Warning: `#E67E22`
- Danger: `#C0392B`

## Typography
- Body: Inter or Source Sans Pro 14px
- Headings: Lora or Source Serif Pro
- Numbers in tables: `font-variant-numeric: tabular-nums`

## Chart SVG rules
- Cream/parchment background `#F8F4ED`
- 2px maroon border, 1px internal divider lines same colour
- Planet codes coloured per the per-planet map in Tab 2
- House numbers in 9pt grey `#9CA3AF`
- Retrograde marker: superscript `®` (or `(R)` if `®` is not feasible)
- Combust marker: superscript `©` (or `(C)`)
- Watermark: tiny `@astroseer.in` bottom-right, 8pt, 30% opacity

## Layout
- Max width 1200px centred
- Cards: 1px border `#E5E7EB`, 8px rounded, white fill, no drop shadow
- Spacing scale: 4, 8, 12, 16, 24, 32px

## Mobile breakpoints
- < 768px: two-column sections (Basic, KP) stack vertically
- < 640px: 12-chart grid goes to 1 column
- Tabs: horizontal scroll on mobile, pill style

---

# Hard copy rules (strict, brand voice)

1. **No em-dashes ( - ) or en-dashes (-) ANYWHERE** in user-visible text.
   Use commas, periods, parentheses, "and" instead.
2. **No colourful emojis** (🪐 🕉️ ⚠️ 📊 etc). Numbered pills (1, 2, 3) and
   plain text. A small `·` separator dot is fine.
3. **Indian English spellings**: colour, behaviour, favourable, organisation
4. **Title Case** for section titles ("Planet Positions" not "PLANET
   POSITIONS")
5. **Dates as DD-MMM-YYYY** (e.g. `10-Aug-2019`)
6. **Time zones as `GMT+5.5`**, not `IST`
7. **Degrees with arc-minutes/seconds** in tables: `14°04'22"`. Decimal
   degrees only inside JSON for downstream math.

---

# Interactivity contract the client expects

- **Tab switching**: instant, no network call. Client should call ONE fat
  endpoint `/api/kundli/full?...` once when the profile opens, then render
  slices per tab.
- **North/South toggle**: client-side swap. Both SVGs already in the
  initial payload.
- **Dasha drilldown**: instant client-side computation from the 9 Maha
  periods.
- **Free Report sub-pill switching**: client-side; all sub-pill data
  already in the initial payload.
- **PDF download**: client converts response bytes to a Blob URL because
  Chrome blocks navigation to large data: URLs.

## Optional: fat single endpoint (highly recommended)
```
GET /api/kundli/full?...&style=north|south
→ {
  basic:        { … },
  panchang:     { … },
  avakhada:     { … },
  chart:        { d1_north_svg, d1_south_svg, d9_north_svg, d9_south_svg,
                  planets: [...] },
  kp:           { chalit_svg, ruling_planets, kp_planets, cusps },
  ashtakvarga:  { explainer, sav, bavs, svgs },
  divisional:   { chalit, sun_chart, moon_chart, d1_lagna, d2_hora, …,
                  d16_shodasamsa },
  dasha: {
    vimshottari: { periods, current },
    yogini:      { periods, current }
  },
  report: {
    general: {
      general:     { blocks: [...] },
      planetary:   { blocks: [...] },
      vimshottari: { blocks: [...] },
      yoga:        { blocks: [...] }
    },
    remedies: { general: {...}, lifestyle: {...}, gemstone: {...}, mantra: {...}, donation: {...}, fasting: {...} },
    dosha:    { general: {...}, mangal: {...}, kalsarp: {...}, sade_sati: {...}, pitra: {...}, kemadruma: {...}, grahan: {...} }
  }
}
```

This is the single payload the client requests. Each per-tab endpoint
above is its own debuggable thing but the client mostly hits `/full`.

---

# Auth note

Right now the relay (push-relay.vercel.app) handles auth via `X-API-Key`.
We just shipped a 401 fallback: if the relay gets 401 from your API, it
retries without the key. So feel free to enforce auth strictly when you're
ready - the customer flow won't break during the transition.

When you DO enforce auth, please document:
- key generation flow (UI link or curl example)
- key rotation procedure
- header name (`X-API-Key` confirmed?)

---

# Acceptance test

Standard test birth used throughout this spec:
**Hyderabad, India · 01-11-1995 · 00:20 IST · lat 17.385, lng 78.4867,
tz +5.5**

Every value below must populate correctly:

## Tab 1: Basic
| Field | Expected |
|---|---|
| Date | 01/11/1995 |
| Time | 12:20 AM |
| Latitude | 17.38 |
| Longitude | 78.46 |
| Timezone | GMT+5.5 |
| Sunrise | 6:14:22 |
| Sunset | 17:44:58 |
| Ayanamsha | 23.79886 |
| Avakhada Varna | Shudra |
| Avakhada Vashya | Jalchar |
| Avakhada Yoni | Simha |
| Avakhada Gan | Rakshasa |
| Avakhada Nadi | Madhya |
| Avakhada Sign | Capricorn |
| Avakhada Sign Lord | Saturn |
| Avakhada Nakshatra-Charan | Dhanishta |
| Avakhada Tatva | Earth |
| Avakhada Name alphabet | Gaa |
| Avakhada Paya | Copper |
| Panchang Tithi | ShuklaNavami |
| Panchang Yog | Ganda |
| Panchang Karan | Baalav |
| Panchang Nakshatra | Dhanishta |

## Tab 2: Kundli
| Field | Expected |
|---|---|
| Ascendant | Cancer, House 1, 19°42'9", Sign Lord Moon, Nakshatra Ashlesha, Naksh Lord Mercury |
| Sun | Libra, House 4, 14°4'22", Direct, Combust No, Avastha Yuva, Status Debilitated |
| Moon | Capricorn, House 7, 25°39'59", Direct, Avastha Bala, Status Enemy |
| Mercury | Libra, House 4, 0°23'24", Direct, Combust Yes, Avastha Bala, Status Friendly |
| Venus | Scorpio, House 5, 2°54'31", Direct, Avastha Mrita, Status Friendly |
| Mars | Scorpio, House 5, 14°4'4", Direct, Avastha Yuva, Status Owned |
| Jupiter | Scorpio, House 5, 22°10'21", Direct, Avastha Kumara, Status Friendly |
| Saturn | Aquarius, House 8, 24°34'44", Retro, Avastha Mrita, Status Mooltrikona |
| Rahu | Libra, House 4, 1°52'45", Retro, Avastha Bala |
| Ketu | Aries, House 10, 1°52'45", Retro, Avastha Bala |
| Neptune | Sagittarius, House 6, 29°10'14", Direct, Avastha Mrita |
| Uranus | Capricorn, House 7, 2°59'44", Direct, Avastha Mrita |
| Pluto | Scorpio, House 5, 5°48'54", Direct, Avastha Mrita |

## Tab 6: Dasha - Vimshottari
| Field | Expected |
|---|---|
| Current Mahadasha | Jupiter, 10-Aug-2019 to 10-Aug-2035 |
| Previous Maha | Rahu, 10-Aug-2001 to 10-Aug-2019 |
| First Maha | Mars, Birth to 10-Aug-2001 |
| Current Antardasha | Mercury, 10-Apr-2024 to 17-Jul-2026 |
| Current Pratyantar | Saturn (around mid-2026) |
| Click Jupiter Maha shows | JU-JU, JU-SA, JU-ME, JU-KE, JU-VE, JU-SU, JU-MO, JU-MA, JU-RA in order |
| Click JU-KE Antar shows | JU-KE-KE, JU-KE-VE, JU-KE-SU, JU-KE-MO, JU-KE-MA, JU-KE-RA, JU-KE-JU, JU-KE-SA, JU-KE-ME |
| Click JU-KE-KE Pratyantar shows | JU-KE-KE-KE, JU-KE-KE-VE, JU-KE-KE-SU, JU-KE-KE-MO, JU-KE-KE-MA, JU-KE-KE-RA, JU-KE-KE-JU, JU-KE-KE-SA, JU-KE-KE-ME |

## Tab 7: Free Report - General
- Description card shows "Your ascendant is Cancer" line
- Personality card mentions Cancer ascendant traits (flexible, loyal, emotional, sensitive)
- Career card mentions careers suited to Cancer ascendant

Anything blank or `null` for the above is a bug.

---

# Build order (one commit per row)

1. `GET /api/kundli/basic` - Tab 1
2. `GET /api/kundli/chart?style=` - Tab 2 (D1 + D9 + 11-col planets table)
3. `GET /api/kundli/kp` - Tab 3
4. `GET /api/kundli/ashtakvarga` - Tab 4
5. `GET /api/kundli/divisional?style=` - Tab 5 (12 SVGs)
6. `GET /api/dasha?system=` - Tab 6 (just the 9 mahas; client does the rest)
7. `GET /api/kundli/report?section=&sub=` - Tab 7 (one section at a time)
8. `POST /api/kundli/pdf` - bottom strip download
9. `GET /api/kundli/full` - convenience fat endpoint that wraps all 7 in
   one call

Reply after each commit with **hash + endpoint URL + sample payload for
the acceptance-test birth** and I'll verify within an hour.

---

# Repo / contact

The full kundli spec (longer reference version of this prompt) is at
`docs/KUNDLI_API_SPEC.md` in repo `vickymartinsingh/astro-platform` if
you want the deeper architectural notes. This file you're reading is the
operational version with every screenshot detail spelled out.

Thanks. Ping me when Tab 1 is live.
