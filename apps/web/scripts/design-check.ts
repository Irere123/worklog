// The design rules a reviewer kept catching by eye, checked on every lint run so agents and
// people building without a designer in the room hold the same line. docs/DESIGN.md says why.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Rule = { name: string; pattern: RegExp; why: string };

const RULES: Rule[] = [
  {
    name: "hover outside media.hover",
    pattern: /":hover":(?!\s*\{\s*default:\s*null,\s*\[media\.hover\])/gu,
    why: 'a tap on a phone leaves it stuck; write ":hover": { default: null, [media.hover]: value }',
  },
  {
    name: "font weight off the scale",
    pattern: /fontWeight:\s*(?!(?:400|500|600)\b)\d+/gu,
    why: "the type scale uses 400, 500 and 600 only",
  },
  {
    name: "icon that isn't Phosphor",
    pattern: /from\s+"(?:lucide-react|react-icons[^"]*|@heroicons[^"]*)"/gu,
    why: "icons are Phosphor, imported with the Icon suffix",
  },
  {
    name: "sparkles for AI",
    pattern: /\b(?:Sparkle|MagicWand|StarFour)\w*Icon\b/gu,
    why: "show what the feature does, not that a model is involved",
  },
  {
    name: "transition on everything",
    pattern: /transition(?:Property)?:\s*"all\b/gu,
    why: "name the properties: transform and opacity, or the one colour that changes",
  },
  {
    name: "copy that says nothing",
    pattern:
      /["'>](?:Oops|Whoops|Click here|Something went wrong|Are you sure)\b/giu,
    why: "say what happened and what to do next, in Worklog's voice",
  },
];

const root = new URL("../src", import.meta.url).pathname;
const failures: string[] = [];

for (const file of walk(root)) {
  const source = readFileSync(file, "utf-8");
  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      if (allowed(source, line)) {
        continue;
      }
      failures.push(
        `${path.relative(process.cwd(), file)}:${line}  ${rule.name}: ${rule.why}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(
    `\n${failures.length} design rule${failures.length === 1 ? "" : "s"} broken`
  );
  process.exit(1);
}
console.log("Design rules hold.");

/** A deliberate exception names itself on the line above: `// design-allow: <reason>`. */
function allowed(source: string, line: number) {
  const above = source.split("\n")[line - 2] ?? "";
  return /\/\/ design-allow: \S/u.test(above);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.tsx?$/u.test(entry.name) && !entry.name.endsWith(".gen.ts")) {
      yield full;
    }
  }
}
