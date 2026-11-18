import newsreaderLatinUrl from "@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2?url";

import newsreaderUrl from "@fontsource-variable/newsreader/opsz.css?url";

export const DISPLAY_FONT = [
  {
    rel: "preload",
    href: newsreaderLatinUrl,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous" as const,
  },
  { rel: "stylesheet", href: newsreaderUrl },
];
