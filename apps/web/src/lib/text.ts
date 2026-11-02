/** `value` cut to at most `max` characters at a word end, so the ellipsis never splits a word. */
export function clip(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  const end = cut.lastIndexOf(" ");
  const kept = end > max / 2 ? cut.slice(0, end) : cut;
  return `${kept.replace(/[\s,.;:—–-]+$/u, "")}…`;
}
