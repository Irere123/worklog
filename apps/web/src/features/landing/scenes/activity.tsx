import {
  CaretUpDownIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  StackIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactNode } from "react";

import { AppWindow } from "#features/landing/frame";
import { Collapse, Roll } from "#features/landing/motion";
import { useScript } from "#features/landing/script";
import { atlas, eric, grace, jean } from "#features/landing/team";
import { Avatar } from "#ui/avatar";
import { ProductMark } from "#ui/product-mark";
import { color, font, radius, space, text } from "#ui/tokens.stylex";

import { CardNumber, PaneHeader, parts } from "./parts";
import type { SceneProps } from "./parts";

type State = {
  merged: boolean;
  bot: "hidden" | "arrived" | "dropped";
  slack: boolean;
  agent: boolean;
  dropped: number;
};

const START: State = {
  merged: false,
  bot: "hidden",
  slack: false,
  agent: false,
  dropped: 21,
};

const END: State = {
  merged: true,
  bot: "dropped",
  slack: true,
  agent: true,
  dropped: 22,
};

/**
 * Activity: work arrives from where it happened, credited to whoever did it. A bot's version bump
 * comes in too, is struck through and folds away, and the count of what was left out ticks up:
 * the stream says what it filtered rather than hiding that it did.
 */
export function ActivityScene({ play, paused, still }: SceneProps) {
  const [s, setS] = useState(still ? END : START);
  const set = (next: Partial<State>) => setS((now) => ({ ...now, ...next }));

  useScript(
    async (a) => {
      await a.wait(1000);
      set({ merged: true });
      await a.wait(1500);
      set({ bot: "arrived" });
      await a.wait(1300);
      set({ bot: "dropped", dropped: 22 });
      await a.wait(1000);
      set({ slack: true });
      await a.wait(1500);
      set({ agent: true });
    },
    { running: play && !still, paused }
  );

  return (
    <AppWindow nav="activity" inbox={3}>
      <div {...stylex.props(styles.root)}>
        <PaneHeader
          title="Activity"
          end={
            <>
              <span {...stylex.props(parts.control, styles.search)}>
                <MagnifyingGlassIcon size={13} {...stylex.props(parts.faint)} />
                <span {...stylex.props(parts.faint)}>Search</span>
              </span>
              <span {...stylex.props(parts.control, styles.filter)}>
                <StackIcon size={13} /> All sources
                <CaretUpDownIcon size={12} {...stylex.props(parts.faint)} />
              </span>
            </>
          }
        />
        <div {...stylex.props(styles.feed)}>
          <div {...stylex.props(styles.day)}>
            <span>Today</span>
            <span {...stylex.props(styles.filtered)}>
              <FunnelSimpleIcon size={12} />
              Left out <Roll value={s.dropped} /> bot and CI events
            </span>
          </div>

          <Collapse open={s.agent}>
            <Line
              source={<Avatar person={atlas} size={22} />}
              who={atlas.name}
              card={16}
              title="Upgrade Postgres to 18"
              detail="Drafted the rollback plan · Asked Ada Mukamana for a decision"
              when="Now"
              agent
            />
          </Collapse>
          <Collapse open={s.slack}>
            <Line
              source={<ProductMark product="slack" size={16} />}
              who={grace.name}
              person={grace}
              title="in #referrals"
              detail="“Kibagabaga says the SMS fallback held through Friday’s outage.”"
              when="9:58"
            />
          </Collapse>
          <Collapse open={s.bot !== "dropped"}>
            <div
              {...stylex.props(
                styles.botWrap,
                s.bot === "arrived" && styles.botShown
              )}
            >
              <Line
                source={<ProductMark product="github" size={16} />}
                who="dependabot[bot]"
                title="bumped axios from 1.7.2 to 1.7.4"
                detail="referral-service · Bot"
                when="9:57"
                struck
              />
            </div>
          </Collapse>
          <Collapse open={s.merged}>
            <Line
              source={<ProductMark product="github" size={16} />}
              who={eric.name}
              person={eric}
              card={1}
              title="Referral form loses attachments on slow connections"
              detail="Merged #212 Retry uploads on slow connections · referral-service"
              when="9:51"
            />
          </Collapse>
          <Line
            source={<UserPlusIcon size={15} {...stylex.props(parts.muted)} />}
            who={jean.name}
            person={jean}
            card={8}
            title="Track referral turnaround per district"
            detail="Added this card · Moved to Maybe? · Assigned to Ada Mukamana"
            when="9:40"
          />
          <Line
            source={<ProductMark product="discord" size={16} />}
            who={eric.name}
            person={eric}
            title="in #platform-ops"
            detail="“Huye server is back after the power cut; sync caught up.”"
            when="8:15"
          />
          <Line
            source={<Avatar person={atlas} size={22} />}
            who={atlas.name}
            card={4}
            title="SMS fallback when the receiving clinic is offline"
            detail="Finished the prototype · Opened #209 for review"
            when="7:30"
            agent
          />
        </div>
      </div>
    </AppWindow>
  );
}

type Person = { id: string; name: string; avatarUrl?: string };

function Line({
  source,
  who,
  person,
  card,
  title,
  detail,
  when,
  agent = false,
  struck = false,
}: {
  source: ReactNode;
  who: string;
  person?: Person;
  card?: number;
  title: string;
  detail: string;
  when: string;
  agent?: boolean;
  struck?: boolean;
}) {
  return (
    <div {...stylex.props(styles.line, struck && styles.struck)}>
      <span {...stylex.props(styles.source, agent && styles.sourceAgent)}>
        {source}
      </span>
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.head)}>
          {person && <Avatar person={person} size={16} />}
          <span {...stylex.props(parts.strong)}>{who}</span>
          {card !== undefined && (
            <CardNumber sx={styles.number}>{card}</CardNumber>
          )}
          <span {...stylex.props(parts.ellipsis)}>{title}</span>
        </span>
        <span {...stylex.props(styles.detail)}>{detail}</span>
      </span>
      <span {...stylex.props(styles.when)}>{when}</span>
    </div>
  );
}

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  search: {
    width: 150,
    display: {
      default: "inline-flex",
      "@media (max-width: 1023px)": "none",
    },
  },
  filter: {
    display: {
      default: "inline-flex",
      "@media (max-width: 719px)": "none",
    },
  },
  feed: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: 720,
    marginInline: "auto",
    paddingTop: space.xl,
    paddingInline: space.xxl,
  },
  day: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingBottom: space.md,
    marginBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
    fontSize: text.meta,
    fontWeight: 600,
  },
  filtered: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    fontWeight: 400,
    color: color.fgMuted,
    whiteSpace: "nowrap",
  },
  line: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.lg,
    paddingBlock: space.md,
    transitionProperty: "opacity",
    transitionDuration: "300ms",
  },
  struck: {
    opacity: 0.6,
  },
  botWrap: {
    position: "relative",
    "::after": {
      content: '""',
      position: "absolute",
      left: 36,
      right: 40,
      top: 18,
      height: 1,
      backgroundColor: color.fgMuted,
      transformOrigin: "left",
      transform: "scaleX(0)",
      transitionProperty: "transform",
      transitionDuration: "420ms",
      transitionDelay: "500ms",
      transitionTimingFunction: "cubic-bezier(0.45, 0, 0.1, 1)",
    },
  },
  botShown: {
    "::after": {
      transform: "scaleX(1)",
    },
  },
  source: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: radius.sm,
    backgroundColor: color.raised,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  sourceAgent: {
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  text: {
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
    flexGrow: 1,
    minWidth: 0,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    minWidth: 0,
    whiteSpace: "nowrap",
  },
  number: {
    fontSize: text.label,
    fontFamily: font.mono,
  },
  detail: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: text.meta,
    lineHeight: "16px",
    color: color.fgMuted,
  },
  when: {
    flexShrink: 0,
    paddingTop: space.xxs,
    fontSize: text.meta,
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
});
