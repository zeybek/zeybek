#!/usr/bin/env node
/**
 * Generates the zeybek.dev "City at Night" contribution SVGs (Gruvbox Dark & Light)
 * for the GitHub profile README.
 *
 * Ports `night-city.ts` and `ContributionsMode.tsx` from zeybek.dev so the
 * profile README and the personal site share the exact same visual language.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USERNAME = process.env.GITHUB_USERNAME || "zeybek";
const TOKEN = process.env.GITHUB_TOKEN || "";

/** Each building is two windows wide. */
const COL_WIDTH = 2;
/** Rows of sky kept over the tallest building, for roofs and the moon. */
const HEADROOM = 4;
/** The tallest building, in floors. */
const HEIGHT = 15;
/** One window cell in the drawing's own units. */
const CELL_W = 10;
const CELL_H = 13;
/** The month names under the street. */
const LABEL_H = 24;
/** A lamp stands in front of every this many weeks. */
const LAMP_EVERY = 5;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const LEVEL_MAP = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

/**
 * Gruvbox Dark & Gruvbox Light palettes, with oklab-mixed building shades
 * matching `ContributionsMode.tsx` and `themes.css` in `@zeybek/ui`.
 */
const THEMES = {
  dark: {
    id: "dark",
    bg: "#282828",
    fg: "#ebdbb2",
    muted: "#504945",
    mutedFg: "#a89984",
    border: "#535353",
    borderHairline: "rgba(168, 153, 132, 0.22)",
    hatchStroke: "rgba(168, 153, 132, 0.16)",
    far: "#302f2d",
    ground: "#343330",
    wallA: "#3a3834",
    wallB: "#423f3a",
    wallLit: "#59544c",
    trim: "#535353",
    windowOff: "#555049",
    light: "#fabd2f",
    lightDim: "#fe8019",
    lightHot: "#f4ca68",
    beacon: "#fb4934",
    moon: "#ebdbb2",
    star: "#a89984",
    lane: "#a89984",
    brand: "#b8bb26",
    orange: "#fe8019",
    cyan: "#5cc498",
    levelTints: [
      "rgba(80, 73, 69, 0.45)",
      "rgba(146, 131, 116, 0.28)",
      "rgba(92, 196, 152, 0.24)",
      "rgba(184, 187, 38, 0.24)",
      "rgba(254, 128, 25, 0.30)",
    ],
  },
  light: {
    id: "light",
    bg: "#fbf1c7",
    fg: "#3c3836",
    muted: "#d5c4a1",
    mutedFg: "#7c6f64",
    border: "#bdae93",
    borderHairline: "rgba(124, 111, 100, 0.28)",
    hatchStroke: "rgba(124, 111, 100, 0.20)",
    far: "#efe5bd",
    ground: "#e9dfc5",
    wallA: "#e1d6b2",
    wallB: "#d8cda9",
    wallLit: "#c2b695",
    trim: "#bdae93",
    windowOff: "#c6ba99",
    light: "#b57614",
    lightDim: "#d65d0e",
    lightHot: "#8f5f1a",
    beacon: "#cc241d",
    moon: "#3c3836",
    star: "#7c6f64",
    lane: "#7c6f64",
    brand: "#79740e",
    orange: "#d65d0e",
    cyan: "#427b58",
    levelTints: [
      "rgba(213, 196, 161, 0.55)",
      "rgba(146, 131, 116, 0.28)",
      "rgba(66, 123, 88, 0.22)",
      "rgba(121, 116, 14, 0.22)",
      "rgba(214, 93, 14, 0.28)",
    ],
  },
};

/** A small deterministic mixer, so the dressing stays put between renders. */
function cityHash(a, b, c) {
  let h = 2166136261;
  for (const v of [a, b, c]) {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

function floorsFor(total, max, height) {
  if (total <= 0 || max <= 0) return 1;
  const scaled = Math.log1p(total) / Math.log1p(max);
  return 1 + Math.round(scaled * (height - 1));
}

function litFor(total, max, windows) {
  if (total <= 0 || max <= 0 || windows <= 0) return 0;
  return Math.min(
    windows,
    Math.max(1, Math.round(windows * Math.sqrt(total / max))),
  );
}

function keyOf(week, fallback) {
  const first = week[0];
  if (!first) return fallback;
  const time = Date.parse(`${first.date}T00:00:00Z`);
  return Number.isNaN(time) ? fallback : Math.floor(time / 86_400_000);
}

function roofFor(floors, height, record, h) {
  if (record) return "spire";
  const pick = h % 8;
  if (floors >= Math.ceil(height * 0.7)) {
    if (pick < 3) return "antenna";
    if (pick < 5) return "tank";
    return pick < 7 ? "ledge" : "flat";
  }
  if (floors >= 4) {
    if (pick < 2) return "tank";
    return pick < 5 ? "ledge" : "flat";
  }
  return pick < 3 ? "ledge" : "flat";
}

function monthLabels(weeks, width) {
  const labels = [];
  let free = 0;
  let previous = -1;
  weeks.forEach((week, i) => {
    const first = week[0];
    if (!first) return;
    const month = new Date(`${first.date}T00:00:00Z`).getUTCMonth();
    if (Number.isNaN(month) || month === previous) return;
    previous = month;
    const x = i * COL_WIDTH;
    const text = MONTHS[month];
    if (i === 0 || x < free || x + text.length > width) return;
    labels.push({ x, text });
    free = x + text.length + 1;
  });
  return labels;
}

function buildCity(weeks, { height: requested }) {
  const height = Math.max(3, Math.floor(requested));
  const width = weeks.length * COL_WIDTH;
  const ground = height + HEADROOM;

  const totals = weeks.map((week) =>
    week.reduce((sum, day) => sum + day.count, 0),
  );
  let record = -1;
  totals.forEach((total, i) => {
    if (total > 0 && (record === -1 || total > totals[record])) record = i;
  });
  const max = record === -1 ? 0 : totals[record];

  const buildings = weeks.map((days, i) => {
    const key = keyOf(days, i);
    const floors = floorsFor(totals[i], max, height);
    const h = cityHash(key, 1, 0);
    const setback =
      floors >= 5 && h % 3 === 0 ? (h % 2 === 0 ? "left" : "right") : null;

    const slots = [];
    for (let floor = 0; floor < floors; floor++) {
      for (let col = 0; col < COL_WIDTH; col++) {
        const stepped = setback !== null && floor === floors - 1;
        if (stepped && col !== (setback === "left" ? 0 : 1)) continue;
        slots.push([floor, col]);
      }
    }

    const order = slots
      .map(([floor, col]) => ({ floor, col, rank: cityHash(key, floor, col) }))
      .sort((a, b) => a.rank - b.rank);
    const lit = Array.from({ length: floors }, () =>
      Array.from({ length: COL_WIDTH }, () => false),
    );
    for (const slot of order.slice(0, litFor(totals[i], max, slots.length))) {
      lit[slot.floor][slot.col] = true;
    }

    return {
      week: i,
      x: i * COL_WIDTH,
      floors,
      lit,
      roof: roofFor(floors, height, i === record, cityHash(key, 2, 0)),
      setback,
      record: i === record,
      total: totals[i],
      days,
    };
  });

  const far = [];
  for (let x = 0; x < width; ) {
    const h = cityHash(x, 3, 0);
    const span = 3 + (h % 3);
    far.push({
      x,
      width: Math.min(span, width - x),
      floors: 2 + (cityHash(x, 4, 0) % Math.max(1, Math.round(height * 0.75))),
    });
    x += span;
  }

  const stars = [];
  for (let y = 0; y < Math.ceil(ground / 2); y++) {
    for (let x = 0; x < width; x++) {
      const h = cityHash(x, y, 7);
      if (h % 53 === 0) stars.push({ x, y, bright: true });
      else if (h % 19 === 0) stars.push({ x, y, bright: false });
    }
  }

  return {
    buildings,
    far,
    stars,
    labels: monthLabels(weeks, width),
    width,
    ground,
    height,
    weeks,
    record,
  };
}

function groupContributionsIntoWeeks(contributions) {
  const weeks = [];
  for (let i = 0; i < contributions.length; i += 7) {
    weeks.push(contributions.slice(i, i + 7));
  }
  return weeks;
}

async function fetchViaGraphQL(username) {
  if (!TOKEN) return null;
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
                contributionLevel
              }
            }
          }
        }
      }
    }`;

  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "zeybek-night-city",
      },
      body: JSON.stringify({ query, variables: { login: username } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const weeks =
      json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
    if (!Array.isArray(weeks)) return null;

    const contributions = [];
    for (const week of weeks) {
      for (const day of week.contributionDays ?? []) {
        contributions.push({
          date: day.date,
          count: day.contributionCount ?? 0,
          level: LEVEL_MAP[day.contributionLevel] ?? 0,
        });
      }
    }
    return contributions;
  } catch {
    return null;
  }
}

async function fetchViaProxy(username) {
  const res = await fetch(
    `https://github-contributions-api.jogruber.de/v4/${username}?y=last`,
  );
  if (!res.ok) {
    throw new Error(`Proxy error: ${res.status}`);
  }
  const data = await res.json();
  return data.contributions;
}

async function fetchContributions(username) {
  const official = await fetchViaGraphQL(username);
  if (official && official.length > 0) return official;
  return fetchViaProxy(username);
}

function computeStreaks(contributions) {
  let current = 0;
  let longest = 0;
  let running = 0;
  for (const day of contributions) {
    if (day.count > 0) {
      running++;
      if (running > longest) longest = running;
    } else {
      running = 0;
    }
  }
  // Current streak: walk backwards from the end (skip trailing today if 0)
  let idx = contributions.length - 1;
  if (idx >= 0 && contributions[idx].count === 0) idx--;
  while (idx >= 0 && contributions[idx].count > 0) {
    current++;
    idx--;
  }
  return { current, longest };
}

const shortFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatShortDate(dateStr) {
  return shortFmt.format(new Date(`${dateStr}T00:00:00Z`));
}

function renderNightCitySvg(contributions, theme) {
  const weeks = groupContributionsIntoWeeks(contributions);
  const city = buildCity(weeks, { height: HEIGHT });
  const total = contributions.reduce((sum, d) => sum + d.count, 0);
  const { current: streak, longest } = computeStreaks(contributions);

  const cityW = city.width * CELL_W; // 1060
  const panelH = (city.ground + 1) * CELL_H; // 260
  const cityH = panelH + LABEL_H; // 284

  const padX = 28;
  const headerH = 74;
  const hatchH = 8;
  const bottomPad = 16;
  const totalW = cityW + padX * 2;
  const totalH = hatchH + headerH + cityH + bottomPad;

  const lights = [
    theme.lightHot,
    theme.light,
    theme.light,
    theme.lightDim,
    theme.lightDim,
  ];

  // Record building for the header pill summary
  const featuredBuilding =
    city.record >= 0
      ? city.buildings[city.record]
      : city.buildings[city.buildings.length - 1];

  // Render buildings
  const buildingParts = city.buildings.map((b) => {
    const left = b.x * CELL_W;
    const width = COL_WIDTH * CELL_W - 1;
    const top = (city.ground - b.floors) * CELL_H;
    const wall = b.record
      ? theme.wallLit
      : b.week % 2
        ? theme.wallB
        : theme.wallA;
    const key = b.days[0]
      ? Math.floor(Date.parse(`${b.days[0].date}T00:00:00Z`) / 86_400_000)
      : b.week;

    const capLeft = b.setback === "right" ? left + CELL_W : left;
    const capWidth = b.setback ? CELL_W - 1 : width;
    const centre = capLeft + capWidth / 2;

    const parts = [];
    if (b.setback) {
      parts.push(
        `<rect x="${left}" y="${top + CELL_H}" width="${width}" height="${(b.floors - 1) * CELL_H}" fill="${wall}" />`,
        `<rect x="${capLeft}" y="${top}" width="${capWidth}" height="${CELL_H}" fill="${wall}" />`,
      );
    } else {
      parts.push(
        `<rect x="${left}" y="${top}" width="${width}" height="${b.floors * CELL_H}" fill="${wall}" />`,
      );
    }

    if (b.roof === "ledge") {
      parts.push(
        `<rect x="${capLeft - 1}" y="${top - 2}" width="${capWidth + 2}" height="2" fill="${theme.trim}" />`,
      );
    } else if (b.roof === "tank") {
      parts.push(
        `<rect x="${centre - 3.5}" y="${top - 9}" width="7" height="6" rx="1" fill="${wall}" />`,
        `<rect x="${centre - 3}" y="${top - 3}" width="1" height="3" fill="${wall}" />`,
        `<rect x="${centre + 2}" y="${top - 3}" width="1" height="3" fill="${wall}" />`,
      );
    } else if (b.roof === "antenna") {
      parts.push(
        `<rect x="${centre - 0.5}" y="${(top - 2.4 * CELL_H).toFixed(1)}" width="1" height="${(2.4 * CELL_H).toFixed(1)}" fill="${theme.trim}" />`,
        `<circle cx="${centre}" cy="${(top - 2.4 * CELL_H).toFixed(1)}" r="1.3" fill="${theme.beacon}" opacity="0.7" />`,
      );
    } else if (b.roof === "spire") {
      parts.push(
        `<polygon points="${capLeft + 2},${top} ${capLeft + capWidth - 2},${top} ${centre},${(top - 2.6 * CELL_H).toFixed(1)}" fill="${wall}" />`,
        `<circle cx="${centre}" cy="${(top - 2.6 * CELL_H).toFixed(1)}" r="2.2" fill="${theme.beacon}" class="night-beacon" />`,
      );
    }

    for (let floor = 0; floor < b.floors; floor++) {
      for (let col = 0; col < COL_WIDTH; col++) {
        const stepped = b.setback !== null && floor === b.floors - 1;
        if (stepped && col !== (b.setback === "left" ? 0 : 1)) continue;
        const on = b.lit[floor][col];
        const h = cityHash(key, floor, col + 11);
        const flicker = on && h % 11 === 0;
        const cx = left + col * CELL_W + 4.75;
        const cy = (city.ground - floor - 1) * CELL_H + CELL_H / 2;
        const fill = on ? lights[h % lights.length] : theme.windowOff;
        const attrs = flicker
          ? ` class="night-flicker" style="animation-delay:-${(h % 70) / 10}s"`
          : "";
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="2.6" fill="${fill}"${attrs} />`,
        );
      }
    }

    return `<g>${parts.join("")}</g>`;
  });

  // Render stars
  const starParts = city.stars.map((s) => {
    const h = cityHash(s.x, s.y, 31);
    const cx = s.x * CELL_W + 5;
    const cy = s.y * CELL_H + 6;
    const r = s.bright ? 1.3 : 0.75;
    const fill = s.bright ? theme.moon : theme.star;
    const opacity = s.bright ? 0.85 : 0.5;
    const dur = 3 + (h % 60) / 10;
    const delay = ((h >>> 8) % 90) / 10;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}" class="night-twinkle" style="animation-duration:${dur}s;animation-delay:-${delay}s" />`;
  });

  // Render far silhouette towers
  const farParts = city.far.map(
    (t) =>
      `<rect x="${t.x * CELL_W}" y="${(city.ground - t.floors) * CELL_H}" width="${t.width * CELL_W - 2}" height="${t.floors * CELL_H}" fill="${theme.far}" />`,
  );

  // Render road dashes
  const dashCount = Math.floor(city.width / 3);
  const dashParts = Array.from({ length: dashCount }, (_, k) => {
    const x = k * 3 * CELL_W + 8;
    const y = city.ground * CELL_H + CELL_H / 2;
    return `<rect x="${x}" y="${y}" width="12" height="1" fill="${theme.lane}" opacity="0.6" />`;
  });

  // Render street lamps
  const lampParts = city.buildings
    .filter((b) => b.week % LAMP_EVERY === LAMP_EVERY - 1)
    .map((b) => {
      const x = (b.x + COL_WIDTH) * CELL_W - 0.5;
      const y = city.ground * CELL_H;
      return `<g><ellipse cx="${x}" cy="${y}" rx="16" ry="9" fill="url(#glow-${theme.id})" /><rect x="${x - 0.5}" y="${y - 9}" width="1" height="9" fill="${theme.trim}" /><circle cx="${x}" cy="${y - 9.5}" r="1.4" fill="${theme.lightHot}" /></g>`;
    });

  // Render month labels
  const labelParts = city.labels.map(
    (label) =>
      `<text x="${label.x * CELL_W}" y="${panelH + 17}" font-size="13" fill="${theme.mutedFg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${label.text}</text>`,
  );

  // Render record week pills in header (right-aligned)
  let recordPillsSvg = "";
  if (featuredBuilding && featuredBuilding.days.length > 0) {
    const firstDay = featuredBuilding.days[0];
    const lastDay = featuredBuilding.days[featuredBuilding.days.length - 1];
    const rangeLabel = `${formatShortDate(firstDay.date)} – ${formatShortDate(lastDay.date)} · peak ${featuredBuilding.total}`;
    const pillW = 48;
    const pillGap = 5;
    const daysCount = featuredBuilding.days.length;
    const totalPillsW = daysCount * pillW + (daysCount - 1) * pillGap;
    const pillsStartX = totalW - padX - totalPillsW;
    const pillsY = hatchH + 41;

    const pills = featuredBuilding.days.map((d, idx) => {
      const px = pillsStartX + idx * (pillW + pillGap);
      const dayDate = new Date(`${d.date}T00:00:00Z`);
      const wd = WEEKDAYS[dayDate.getUTCDay()] ?? "";
      const tint = theme.levelTints[d.level] ?? theme.levelTints[4];
      const op = d.count === 0 ? ` opacity="0.55"` : "";
      return `<g transform="translate(${px}, ${pillsY})"${op}>
        <rect width="${pillW}" height="18" rx="9" fill="${tint}" />
        <text x="7" y="12.5" font-size="9.5" fill="${theme.mutedFg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${wd}</text>
        <text x="${pillW - 7}" y="12.5" font-size="9.5" text-anchor="end" fill="${theme.fg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${d.count}</text>
      </g>`;
    });

    recordPillsSvg = `
      <text x="${pillsStartX - 10}" y="${pillsY + 12.5}" font-size="11.5" text-anchor="end" fill="${theme.mutedFg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${rangeLabel}</text>
      ${pills.join("\n      ")}
    `;
  }

  const streakText =
    streak > 0
      ? `streak ${streak}d · longest ${longest}d`
      : `longest streak ${longest}d`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" role="img" aria-label="${total.toLocaleString("en-US")} contributions in the last year, drawn as a city at night">
  <style>
    @keyframes night-flicker {
      0%, 100% { opacity: 1; }
      61% { opacity: 0.25; }
      63% { opacity: 1; }
      66% { opacity: 0.4; }
      69% { opacity: 1; }
    }
    @keyframes night-twinkle {
      0%, 100% { opacity: 0.35; }
      44% { opacity: 0.35; }
      50% { opacity: 1; }
      58% { opacity: 0.35; }
    }
    @keyframes night-beacon {
      0%, 12% { opacity: 1; }
      18%, 100% { opacity: 0.15; }
    }
    .night-flicker {
      animation: night-flicker 7s steps(1) infinite;
    }
    .night-twinkle {
      animation: night-twinkle 4s ease-in-out infinite;
    }
    .night-beacon {
      animation: night-beacon 2.4s ease-out infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .night-flicker, .night-twinkle, .night-beacon {
        animation: none;
      }
    }
  </style>

  <defs>
    <radialGradient id="glow-${theme.id}">
      <stop offset="0" stop-color="${theme.light}" stop-opacity="0.3" />
      <stop offset="1" stop-color="${theme.light}" stop-opacity="0" />
    </radialGradient>
    <mask id="crescent-${theme.id}">
      <rect width="${cityW}" height="${panelH}" fill="white" />
      <circle cx="${(cityW * 0.86 + 4).toFixed(1)}" cy="${(1.6 * CELL_H - 2.5).toFixed(1)}" r="6.5" fill="black" />
    </mask>
    <pattern id="hatch-${theme.id}" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="8" stroke="${theme.hatchStroke}" stroke-width="2" />
    </pattern>
    <clipPath id="card-clip-${theme.id}">
      <rect width="${totalW}" height="${totalH}" rx="10" />
    </clipPath>
  </defs>

  <g clip-path="url(#card-clip-${theme.id})">
    <!-- Background -->
    <rect width="${totalW}" height="${totalH}" fill="${theme.bg}" />

    <!-- Top zeybek.dev hatch separator -->
    <rect x="0" y="0" width="${totalW}" height="${hatchH}" fill="url(#hatch-${theme.id})" />
    <line x1="0" y1="${hatchH}" x2="${totalW}" y2="${hatchH}" stroke="${theme.borderHairline}" stroke-width="1" />

    <!-- Spotlight Header (.contributions) -->
    <text x="${padX}" y="${hatchH + 31}" font-size="22" font-weight="500" fill="${theme.fg}" font-family="Georgia, 'Times New Roman', ui-serif, serif" letter-spacing="-0.02em">
      <tspan fill="${theme.orange}">.</tspan>contributions
    </text>
    <text x="${totalW - padX}" y="${hatchH + 28}" font-size="11.5" text-anchor="end" fill="${theme.mutedFg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">zeybek.dev</text>
    <text x="${padX}" y="${hatchH + 54}" font-size="12" fill="${theme.mutedFg}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">
      <tspan fill="${theme.fg}" font-weight="500">${total.toLocaleString("en-US")}</tspan> contributions in the last year · <tspan fill="${theme.brand}">${streakText}</tspan>
    </text>

    ${recordPillsSvg}

    <!-- The City at Night -->
    <g transform="translate(${padX}, ${hatchH + headerH})">
      <circle cx="${(cityW * 0.86).toFixed(1)}" cy="${(1.6 * CELL_H).toFixed(1)}" r="7" fill="${theme.moon}" mask="url(#crescent-${theme.id})" />
      ${starParts.join("\n      ")}
      ${farParts.join("\n      ")}
      ${buildingParts.join("\n      ")}
      <rect y="${city.ground * CELL_H}" width="${cityW}" height="${CELL_H}" fill="${theme.ground}" />
      ${dashParts.join("\n      ")}
      ${lampParts.join("\n      ")}
      ${labelParts.join("\n      ")}
    </g>
  </g>

  <!-- Outer card border -->
  <rect x="0.5" y="0.5" width="${totalW - 1}" height="${totalH - 1}" rx="10" fill="none" stroke="${theme.borderHairline}" stroke-width="1" />
</svg>
`;
}

async function main() {
  const contributions = await fetchContributions(USERNAME);
  if (!Array.isArray(contributions) || contributions.length === 0) {
    throw new Error("No contributions returned from GitHub.");
  }

  const outDir = resolve(process.cwd(), "dist");
  mkdirSync(dirname(resolve(outDir, "night-city-dark.svg")), {
    recursive: true,
  });

  const darkSvg = renderNightCitySvg(contributions, THEMES.dark);
  const lightSvg = renderNightCitySvg(contributions, THEMES.light);

  writeFileSync(resolve(outDir, "night-city-dark.svg"), darkSvg, "utf8");
  writeFileSync(resolve(outDir, "night-city-light.svg"), lightSvg, "utf8");
  // Keep snake.svg as an alias to night-city-dark.svg so any cached reference still resolves
  writeFileSync(resolve(outDir, "night-city.svg"), darkSvg, "utf8");

  console.log(
    `Generated night-city-dark.svg (${darkSvg.length} bytes) and night-city-light.svg (${lightSvg.length} bytes) for @${USERNAME} (${contributions.length} days).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
