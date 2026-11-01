import type { ReactNode } from "react";

/** React renders nothing for these, so a slot holding one gets no wrapper either. */
export function isShown(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}
