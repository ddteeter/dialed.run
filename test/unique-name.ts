/**
 * A brand or model name no other test makes: `prefix` and twenty random
 * digits. A garment's name is read for listed words before it links
 * (design 232), and a random ULID's letters spell one now and then
 * (`xx`, say), which would leave that garment unlinked. A run of digits
 * is read as one word, and no listed word is twenty letters of what
 * digits read back as, so a name from here always links.
 */
export function uniqueName(prefix: string): string {
  const [high = 0n, low = 0n] = crypto.getRandomValues(new BigUint64Array(2));
  return `${prefix}${String(high % 10n ** 10n).padStart(10, "0")}${String(low % 10n ** 10n).padStart(10, "0")}`;
}
