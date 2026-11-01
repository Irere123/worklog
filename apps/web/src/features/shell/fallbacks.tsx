import { CompassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Button } from "#ui/button";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

/** A route that threw: say so plainly, and offer the two ways out that usually work. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div {...stylex.props(styles.page)}>
      <span {...stylex.props(styles.icon, styles.danger)}>
        <WarningCircleIcon size={20} />
      </span>
      <h1 {...stylex.props(styles.title)}>This page hit a snag</h1>
      <p {...stylex.props(styles.body)}>
        {error instanceof Error ? error.message : "The page couldn’t load."}
      </p>
      <div {...stylex.props(styles.actions)}>
        <Button
          variant="primary"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Try again
        </Button>
        <Link to="/home" {...stylex.props(styles.link)}>
          Go home
        </Link>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div {...stylex.props(styles.page)}>
      <span {...stylex.props(styles.icon)}>
        <CompassIcon size={20} />
      </span>
      <h1 {...stylex.props(styles.title)}>Nothing lives at this address</h1>
      <p {...stylex.props(styles.body)}>
        The link may be old, or the thing it pointed to was archived.
      </p>
      <div {...stylex.props(styles.actions)}>
        <Link to="/home" {...stylex.props(styles.link)}>
          Go home
        </Link>
      </div>
    </div>
  );
}

const styles = stylex.create({
  page: {
    flexGrow: 1,
    minHeight: "60dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    padding: space.x4,
    textAlign: "center",
  },
  icon: {
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 44,
    marginBottom: space.sm,
    borderRadius: radius.lg,
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
  danger: { color: color.redFg, backgroundColor: color.redSubtle },
  title: {
    fontSize: text.title,
    lineHeight: leading.title,
    fontWeight: 600,
    color: color.fg,
  },
  body: {
    maxWidth: 420,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    marginTop: space.md,
  },
  link: {
    fontSize: text.label,
    fontWeight: 500,
    color: color.accentFg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
});
