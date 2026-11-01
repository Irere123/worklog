/** "1 card", "4 cards": copy people read never says "card(s)". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
