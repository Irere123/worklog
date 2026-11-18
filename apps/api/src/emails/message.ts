import { render } from "@react-email/render";
import type { ReactElement } from "react";

import type { Email } from "#lib/mailer";

/**
 * An email ready for the mailer but for its recipient. The text part is written, not derived
 * from the HTML: a readable plain-text twin is one of the things spam filters weigh.
 */
export async function message({
  subject,
  element,
  text,
  headers,
}: {
  subject: string;
  element: ReactElement;
  text: string[];
  headers?: Record<string, string>;
}) {
  return {
    subject,
    html: await render(element),
    text: text.join("\n"),
    headers,
  } satisfies Omit<Email, "to">;
}
