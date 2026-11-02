// Checks the colour tokens against WCAG 2 contrast, in light and dark. Every text pair needs 4.5:1,
// faint metadata included: times, counts and captions are read too. Run after changing
// src/ui/tokens.stylex.ts: bun run contrast
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/ui/tokens.stylex.ts", import.meta.url),
  "utf-8"
);
const tokens = new Map<string, [string, string]>();
for (const m of source.matchAll(
  /(?<name>\w+): "light-dark\((?<light>oklch\([^)]*\)), (?<dark>oklch\([^)]*\))\)"/gu
)) {
  const { name, light, dark } = m.groups ?? {};
  if (name && light && dark) {
    tokens.set(name, [light, dark]);
  }
}
tokens.set("fgOnSolid", ["oklch(0.99 0 0)", "oklch(0.99 0 0)"]);

const PAIRS: [string, string, number][] = [
  ["fg", "bg", 4.5],
  ["fgMuted", "bg", 4.5],
  ["fgMuted", "surface", 4.5],
  ["fgMuted", "raised", 4.5],
  ["fgMuted", "sidebar", 4.5],
  ["fgFaint", "bg", 4.5],
  ["fgFaint", "surface", 4.5],
  ["fgFaint", "sidebar", 4.5],
  ["fgFaint", "raised", 4.5],
  ["accentFg", "bg", 4.5],
  ["accentFg", "accentSubtle", 4.5],
  ["fgOnSolid", "accent", 4.5],
  ["amberFg", "amberSubtle", 4.5],
  ["redFg", "redSubtle", 4.5],
  ["greenFg", "greenSubtle", 4.5],
  ["violetFg", "violetSubtle", 4.5],
  ["blueFg", "blueSubtle", 4.5],
  ["goldFg", "goldSubtle", 4.5],
];

// OKLCH → linear sRGB (Björn Ottosson's matrices), clamped to the gamut.
function linear(value: string) {
  const [l = 0, c = 0, h = 0] = (value.match(/[\d.]+/gu) ?? []).map(Number);
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map((v) => Math.min(1, Math.max(0, v)));
}

function luminance(value: string) {
  const [r = 0, g = 0, b = 0] = linear(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let failed = 0;
for (const [theme, index] of [
  ["light", 0],
  ["dark", 1],
] as const) {
  for (const [fg, bg, needed] of PAIRS) {
    const a = tokens.get(fg)?.[index];
    const b = tokens.get(bg)?.[index];
    if (!a || !b) {
      console.error(`missing token ${a ? bg : fg}`);
      failed += 1;
      continue;
    }
    const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
    const ratio = ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    if (ratio < needed) {
      failed += 1;
      console.error(
        `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${needed}:1`
      );
    }
  }
}
if (failed > 0) {
  process.exit(1);
}
console.log(
  `All ${PAIRS.length * 2} colour pairs meet their contrast targets.`
);
