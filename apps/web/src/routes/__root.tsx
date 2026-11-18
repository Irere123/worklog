import monoLatinUrl from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";
import interLatinUrl from "@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url";
import * as stylex from "@stylexjs/stylex";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { NotFound, RouteError } from "#features/shell/fallbacks";
import { BOOT_SCRIPT } from "#lib/boot";
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
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
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
      { property: "og:title", content: "Worklog · Your team’s logbook" },
      {
        property: "og:description",
        content:
          "GitHub, Slack, Discord and your agents write it as they work. See what needs you, and ask anyone’s assistant.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      ...[interLatinUrl, monoLatinUrl].map((href) => ({
        rel: "preload",
        href,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
      })),
      { rel: "stylesheet", href: globalUrl },
      { rel: "stylesheet", href: interUrl },
      { rel: "stylesheet", href: monoUrl },
      ...(import.meta.env.DEV
        ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }]
        : []),
    ],
    scripts: [
      { children: THEME_SCRIPT },
      { children: BOOT_SCRIPT },
      ...(import.meta.env.DEV
        ? [{ type: "module", src: "/@id/virtual:stylex:runtime" }]
        : []),
    ],
  }),
  component: Root,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

const Feedback = import.meta.env.DEV
  ? lazy(async () => {
      const { Agentation } = await import("agentation");
      return { default: Agentation };
    })
  : null;

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
      {Feedback && (
        <Suspense fallback={null}>
          <Feedback />
        </Suspense>
      )}
    </Document>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
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
