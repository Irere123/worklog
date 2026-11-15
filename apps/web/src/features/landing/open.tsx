import { LightbulbIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";

import { Avatar } from "#ui/avatar";
import { color, font, radius, space, text } from "#ui/tokens.stylex";

import { useInView, useReducedMotion, useReveal, useScript } from "./script";
import { page, reveal, type } from "./styles";
import { ada } from "./team";

// Broken at its own flags and fields, so a narrow terminal never has to split a word.
const COMMAND = `curl $WORKLOG/v1/logs \\
  -H "authorization: Bearer $KEY" \\
  -d '{"kind":"decision",
    "text":"Agreed on FHIR R4 for referrals"}'`;

type State = { typed: number; answered: boolean; logged: boolean };

const START: State = { typed: 0, answered: false, logged: false };
const END: State = { typed: COMMAND.length, answered: true, logged: true };

/**
 * The server is the product: one contract for every client. A command in a terminal becomes a line
 * in the team's record, which is the whole of the integration story.
 */
export function Open() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [s, setS] = useState(START);
  const set = (next: Partial<State>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(500);
      for (let typed = 0; typed <= COMMAND.length; typed += 3) {
        set({ typed });
        // oxlint-disable-next-line no-await-in-loop -- typed a few characters at a time
        await a.wait(16);
      }
      set({ typed: COMMAND.length });
      await a.wait(500);
      set({ answered: true });
      await a.wait(700);
      set({ logged: true });
    },
    { running: inView && !reduced, paused: false }
  );

  const panel = useRef<HTMLDivElement>(null);
  const on = useReveal(panel);
  const rise = (ms: number) => [reveal.line, reveal.delay(ms), on && reveal.on];
  const shown = reduced ? END : s;
  return (
    <section id="open" {...stylex.props(page.wide, page.section)}>
      <div ref={panel} {...stylex.props(page.tile, styles.panel, rise(0))}>
        <div {...stylex.props(styles.words)}>
          <h2 {...stylex.props(type.heading, rise(50))}>
            Open source, open API.
          </h2>
          <p {...stylex.props(type.lede, rise(100))}>
            Every line of Worklog is on GitHub. One OpenAPI contract and a
            resumable event stream serve the web app, your scripts and your
            agents alike.
          </p>
          <ul {...stylex.props(styles.chips, rise(180))}>
            <li {...stylex.props(styles.chip)}>OpenAPI 3.1</li>
            <li {...stylex.props(styles.chip)}>Resumable event stream</li>
          </ul>
        </div>

        <div ref={ref} aria-hidden {...stylex.props(styles.scene)}>
          <div {...stylex.props(styles.terminal)}>
            <div {...stylex.props(styles.termBar)}>
              <span {...stylex.props(styles.light, styles.close)} />
              <span {...stylex.props(styles.light, styles.minimise)} />
              <span {...stylex.props(styles.light, styles.zoom)} />
              <span {...stylex.props(styles.termTitle)}>~/referrals</span>
            </div>
            <pre {...stylex.props(styles.code)}>
              <span {...stylex.props(styles.prompt)}>$ </span>
              {COMMAND.slice(0, shown.typed)}
              {!shown.answered && <span {...stylex.props(styles.cursor)} />}
              {"\n"}
              <span
                {...stylex.props(
                  styles.reply,
                  shown.answered && styles.replyOn
                )}
              >
                <span {...stylex.props(styles.ok)}>201</span> Created · log_7Qe2
              </span>
            </pre>
          </div>

          <div {...stylex.props(styles.line, shown.logged && styles.lineOn)}>
            <span {...stylex.props(styles.kind)}>
              <LightbulbIcon size={14} weight="fill" />
            </span>
            <span {...stylex.props(styles.lineText)}>
              <span {...stylex.props(styles.lineHead)}>
                <Avatar person={ada} size={16} />
                <span {...stylex.props(styles.strong)}>Ada Mukamana</span>
                <span>Agreed on FHIR R4 for referrals</span>
              </span>
              <span {...stylex.props(styles.lineMeta)}>
                Decision · through the API
              </span>
            </span>
            <span {...stylex.props(styles.lineWhen)}>Now</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const styles = stylex.create({
  panel: {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: {
      default: 80,
      "@media (max-width: 640px)": 56,
    },
    paddingInline: {
      default: space.x5,
      "@media (max-width: 640px)": space.xl,
    },
  },
  words: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xxl,
    maxWidth: 560,
    textAlign: "center",
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.md,
    margin: 0,
    marginTop: space.xs,
    padding: 0,
    listStyle: "none",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    height: 28,
    paddingInline: space.lg,
    borderRadius: radius.full,
    backgroundColor:
      "light-dark(oklch(0.2 0.01 80 / 0.05), oklch(1 0 0 / 0.07))",
    color: "light-dark(oklch(0.22 0.01 80 / 0.7), oklch(0.94 0.004 80 / 0.75))",
    fontSize: 13,
    fontWeight: 500,
  },
  scene: {
    position: "relative",
    width: "100%",
    maxWidth: 720,
    marginTop: space.x5,
    paddingBottom: {
      default: 0,
      "@media (max-width: 640px)": 0,
    },
  },
  // Always dark, as a terminal is, in either theme; it runs off the panel's foot.
  terminal: {
    marginBottom: -24,
    overflow: "hidden",
    borderRadius: `${radius.lg} ${radius.lg} 0 0`,
    // A step above the dark page's panel, or the two would read as one surface.
    backgroundColor: "light-dark(oklch(0.2 0.006 80), oklch(0.24 0.006 80))",
    boxShadow:
      "0 0 0 1px light-dark(oklch(0 0 0 / 0.2), oklch(1 0 0 / 0.12)), 0 24px 48px light-dark(oklch(0.2 0.02 60 / 0.22), oklch(0 0 0 / 0.5))",
    color: "oklch(0.9 0.004 80)",
  },
  termBar: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    height: 38,
    paddingInline: space.lg,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "oklch(1 0 0 / 0.08)",
  },
  light: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
  },
  close: { backgroundColor: "#ff5f57" },
  minimise: { backgroundColor: "#febc2e" },
  zoom: { backgroundColor: "#28c840" },
  termTitle: {
    marginLeft: space.md,
    fontFamily: font.mono,
    fontSize: text.meta,
    color: "oklch(0.7 0.006 80)",
  },
  code: {
    margin: 0,
    paddingTop: space.xl,
    // Room under the reply for the line it writes, which lands over this empty foot.
    paddingBottom: 128,
    paddingInline: space.xxl,
    overflowX: "hidden",
    fontFamily: font.mono,
    fontSize: {
      default: 13,
      "@media (max-width: 640px)": 10,
    },
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    overflowWrap: "normal",
    textAlign: "start",
  },
  prompt: {
    color: "oklch(0.72 0.12 152)",
  },
  dim: {
    color: "oklch(0.62 0.006 80)",
  },
  cursor: {
    display: "inline-block",
    width: "1ch",
    height: "1.2em",
    verticalAlign: "text-bottom",
    backgroundColor: "oklch(0.9 0.004 80 / 0.7)",
  },
  reply: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "300ms",
    color: "oklch(0.72 0.006 80)",
  },
  replyOn: {
    opacity: 1,
  },
  ok: {
    color: "oklch(0.78 0.14 152)",
  },
  line: {
    position: "absolute",
    // Straddles the terminal's edge, half over the panel, so it reads as arriving from outside.
    right: {
      default: -110,
      "@media (max-width: 1100px)": -40,
      "@media (max-width: 860px)": 0,
    },
    left: {
      default: "auto",
      "@media (max-width: 860px)": 0,
    },
    bottom: 28,
    display: "flex",
    alignItems: "flex-start",
    gap: space.lg,
    width: {
      default: 360,
      "@media (max-width: 860px)": "auto",
    },
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow:
      "0 0 0 1px light-dark(oklch(0.2 0.01 80 / 0.08), oklch(1 0 0 / 0.1)), 0 16px 40px light-dark(oklch(0.2 0.02 60 / 0.2), oklch(0 0 0 / 0.55))",
    color: color.fg,
    fontSize: text.label,
    lineHeight: "20px",
    textAlign: "start",
    opacity: 0,
    transform: "translateY(16px)",
    transitionProperty: "opacity, transform",
    transitionDuration: "700ms",
    transitionTimingFunction: "cubic-bezier(0.25, 0.8, 0.25, 1)",
  },
  lineOn: {
    opacity: 1,
    transform: "none",
  },
  kind: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: radius.sm,
    backgroundColor: color.goldSubtle,
    color: color.goldFg,
  },
  lineText: {
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
    minWidth: 0,
    flexGrow: 1,
  },
  lineHead: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.sm,
  },
  strong: {
    fontWeight: 600,
  },
  lineMeta: {
    fontSize: text.meta,
    color: color.fgMuted,
  },
  lineWhen: {
    flexShrink: 0,
    fontSize: text.meta,
    color: color.fgMuted,
  },
});
