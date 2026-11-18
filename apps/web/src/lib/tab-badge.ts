import { useEffect } from "react";

import { markMarkup } from "#ui/logo-mark";

const LOGO = `<svg width="32" height="32" viewBox="0 0 100 100">${markMarkup(16)}</svg>`;

/**
 * The tab says what needs you, the way a calendar's tab shows the date: the inbox count rides on
 * the favicon, so a pinned tab answers "anything for me?" without being opened.
 */
export function useTabBadge(count: number) {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = `data:image/svg+xml,${encodeURIComponent(badged(count))}`;
    const pin = () => {
      if (count > 0 && document.head.lastElementChild !== link) {
        document.head.append(link);
      }
    };
    pin();
    const watch = new MutationObserver(pin);
    watch.observe(document.head, { childList: true });
    return () => {
      watch.disconnect();
      link.remove();
    };
  }, [count]);
}

function badged(count: number) {
  const label =
    count <= 9
      ? `<text x="24" y="11.4" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="#2a1a00">${count}</text>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><mask id="m"><rect width="32" height="32" fill="#fff"/><circle cx="24" cy="8" r="10" fill="#000"/></mask><g mask="url(#m)">${LOGO}</g><circle cx="24" cy="8" r="8" fill="#f5a524"/>${label}</svg>`;
}
