const ACK =
  /^(?:ok(?:ay)?|k|thanks?(?: you)?|thx|ty|cool|nice|great|lol|haha|yes|yep|no|nope|sure|done|\+1|same|agreed|got it|on it|ack)[.!]*$/iu;
const NOISE_CHARS = /<[^>]+>|:[a-z0-9_+-]+:|[\p{Extended_Pictographic}️]/gu;
const SHORT_BUT_NEWS =
  /\b(?:blocked|unblocked|deployed|shipped|merged|released|fixed|reverted|rolled back|on call|down|outage)\b/iu;

/** Too short or too empty to be a work update: "ok", "thanks 🙏", an emoji. Short news isn't. */
export function isChatter(text: string) {
  const substance = text.replaceAll(NOISE_CHARS, "").trim();
  return (
    (substance.length < 12 && !SHORT_BUT_NEWS.test(substance)) ||
    ACK.test(substance)
  );
}

export const WL_REF = /\bWL-(?<number>\d+)\b/giu;

/** Card numbers a message names (WL-12). */
export function cardNumbersIn(text: string) {
  return [
    ...new Set([...text.matchAll(WL_REF)].map((m) => Number(m.groups?.number))),
  ];
}
