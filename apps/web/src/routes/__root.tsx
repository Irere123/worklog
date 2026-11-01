import * as stylex from "@stylexjs/stylex";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { NotFound, RouteError } from "#features/shell/fallbacks";
import { THEME_SCRIPT } from "#lib/theme";
import type { RouterContext } from "#router";
import { TooltipProvider } from "#ui/overlay";
import { color, font, leading, text } from "#ui/tokens.stylex";

import globalUrl from "#styles/global.css?url";
import monoUrl from "@fontsource-variable/geist-mono/index.css?url";
import interUrl from "@fontsource-variable/inter/opsz.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        // resizes-content: Android's keyboard shrinks the layout as iOS's does, so the composer
        // and quick log stay above it.
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      // The phone's status bar continues the mobile bar (the sidebar token) in each scheme.
      {
        name: "theme-color",
        media: "(prefers-color-scheme: light)",
        content: "#f7f5f3",
      },
      {
        name: "theme-color",
        media: "(prefers-color-scheme: dark)",
        content: "#0c0b09",
      },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Worklog" },
      { title: "Worklog" },
      {
        name: "description",
        content: "What your team and its agents are working on.",
      },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "stylesheet", href: globalUrl },
      { rel: "stylesheet", href: interUrl },
      { rel: "stylesheet", href: monoUrl },
      ...(import.meta.env.DEV
        ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }]
        : []),
    ],
    scripts: [
      { children: THEME_SCRIPT },
      // Routes load lazily, so their rules compile after the first stylesheet fetch; the runtime
      // refetches it whenever new rules appear.
      ...(import.meta.env.DEV
        ? [{ type: "module", src: "/@id/virtual:stylex:runtime" }]
        : []),
    ],
  }),
  component: Root,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

function Root() {
  return (
    <Document>
      <TooltipProvider delay={500} closeDelay={0}>
        <Outlet />
      </TooltipProvider>
      <Toaster
        position="bottom-right"
        gap={8}
        toastOptions={{ className: "wl-toast" }}
        theme="system"
      />
    </Document>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    // The theme script sets color-scheme before hydration, so the attribute differs on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body {...stylex.props(styles.body)}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const styles = stylex.create({
  body: {
    fontFamily: font.sans,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fg,
    backgroundColor: color.bg,
    accentColor: color.accent,
    "::selection": { backgroundColor: color.accentSubtle },
  },
});
