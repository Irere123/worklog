import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  CompassIcon,
  LockSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import {
  Link,
  useCanGoBack,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { createContext, use } from "react";
import type { ReactNode } from "react";

import { ApiError } from "#api/client";
import { Button, styles as button } from "#ui/button";
import { Kbd } from "#ui/chip";
import { Logo } from "#ui/logo";
import {
  color,
  font,
  leading,
  radius,
  space,
  text,
  weight,
} from "#ui/tokens.stylex";

import newsreaderUrl from "@fontsource-variable/newsreader/opsz.css?url";

/**
 * True inside the app's main panel. A fallback there keeps the sidebar and speaks as a page of
 * the app; outside it (signed out, the public pages, or the shell itself failing) it stands alone
 * with the brand, as the sign-in screen does.
 */
export const InShell = createContext(false);

/** A route that threw. Gone and forbidden aren't broken, so they get a way on, not a retry. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  if (error instanceof ApiError && error.status === 404) {
    return <NotFound />;
  }
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Fallback
        icon={<LockSimpleIcon size={20} />}
        title="This isn’t shared with you"
        actions={<WayOut primary />}
      >
        Your account can’t open it. Ask someone in the workspace who can to
        share it with you.
      </Fallback>
    );
  }
  const said =
    error instanceof ApiError && error.status < 500 ? error.message : null;
  return (
    <Fallback
      tone="danger"
      icon={<WarningCircleIcon size={20} />}
      title="This page didn’t load"
      detail={
        said === null && error instanceof Error ? error.message : undefined
      }
      actions={
        <>
          <Button
            variant="primary"
            icon={<ArrowsClockwiseIcon size={14} />}
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            Try again
          </Button>
          <WayOut />
        </>
      }
    >
      {said ??
        "Check your connection, then try again. If it keeps happening, Worklog’s server may be down."}
    </Fallback>
  );
}

export function NotFound() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const inShell = use(InShell);
  return (
    <Fallback
      icon={<CompassIcon size={20} />}
      title="Nothing lives at this address"
      detail={pathname}
      actions={<WayOut primary />}
      hint={
        inShell && (
          <>
            Looking for something? <Kbd>⌘ K</Kbd> searches boards, cards and
            people.
          </>
        )
      }
    >
      The link may be old, or what it pointed to was deleted or archived.
    </Fallback>
  );
}

function WayOut({ primary = false }: { primary?: boolean }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const inShell = use(InShell);
  return (
    <>
      {canGoBack && (
        <Button
          variant={primary ? "primary" : "secondary"}
          icon={<ArrowLeftIcon size={14} />}
          onClick={() => {
            router.history.back();
          }}
        >
          Go back
        </Button>
      )}
      <Link
        to={inShell ? "/home" : "/"}
        {...stylex.props(
          button.base,
          button.md,
          primary && !canGoBack ? button.primary : button.secondary
        )}
      >
        {inShell ? "Go to Home" : "Go to Worklog"}
      </Link>
    </>
  );
}

function Fallback({
  icon,
  title,
  children,
  detail,
  actions,
  hint,
  tone,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  detail?: string;
  actions: ReactNode;
  hint?: ReactNode;
  tone?: "danger";
}) {
  const inShell = use(InShell);
  const body = (
    <div
      role={tone === "danger" ? "alert" : undefined}
      {...stylex.props(
        styles.column,
        inShell ? styles.columnApp : styles.columnAlone
      )}
    >
      <span {...stylex.props(styles.icon, tone === "danger" && styles.danger)}>
        {icon}
      </span>
      <h1 {...stylex.props(inShell ? styles.title : styles.display)}>
        {title}
      </h1>
      <p {...stylex.props(styles.body)}>{children}</p>
      {detail !== undefined && detail !== "" && (
        <code {...stylex.props(styles.detail)}>{detail}</code>
      )}
      <div {...stylex.props(styles.actions)}>{actions}</div>
      {hint !== undefined && hint !== false && (
        <p {...stylex.props(styles.hint)}>{hint}</p>
      )}
    </div>
  );
  if (inShell) {
    return <div {...stylex.props(styles.app)}>{body}</div>;
  }
  return (
    <main {...stylex.props(styles.alone)}>
      <link rel="stylesheet" href={newsreaderUrl} precedence="default" />
      <a href="/" {...stylex.props(styles.brand)}>
        <Logo size={22} />
        Worklog
      </a>
      {body}
    </main>
  );
}

const styles = stylex.create({
  app: {
    flexGrow: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflowY: "auto",
    paddingInline: { default: space.x3, "@media (max-width: 640px)": space.lg },
    paddingBottom: "8dvh",
  },
  alone: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100dvh",
    paddingBlock: space.x3,
    paddingInline: space.x3,
    backgroundColor: color.surface,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.md,
    color: color.fg,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textDecoration: "none",
    borderRadius: radius.sm,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 3,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.md,
    width: "100%",
  },
  columnApp: { maxWidth: 440, paddingBlock: space.x5 },
  columnAlone: {
    maxWidth: 400,
    marginInline: "auto",
    marginBlock: "auto",
    paddingBlock: space.x5,
  },
  icon: {
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
    marginBottom: space.sm,
    borderRadius: radius.md,
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
  danger: { color: color.redFg, backgroundColor: color.redSubtle },
  title: {
    margin: 0,
    fontSize: text.titleLg,
    lineHeight: leading.titleLg,
    fontWeight: 600,
    letterSpacing: "-0.015em",
    color: color.fg,
    textWrap: "balance",
  },
  display: {
    margin: 0,
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: "40px",
    fontWeight: weight.display,
    fontOpticalSizing: "none",
    fontVariationSettings: "'opsz' 18",
    letterSpacing: "-0.025em",
    color: color.fg,
    textWrap: "balance",
  },
  body: {
    margin: 0,
    fontSize: 15,
    lineHeight: "23px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
  detail: {
    maxWidth: "100%",
    paddingBlock: space.xs,
    paddingInline: space.sm,
    borderRadius: radius.xs,
    fontFamily: font.mono,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
    backgroundColor: color.ui,
    overflowWrap: "anywhere",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.md,
  },
  hint: {
    margin: 0,
    marginTop: space.lg,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
  },
});
