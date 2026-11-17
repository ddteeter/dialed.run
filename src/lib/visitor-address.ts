/**
 * A visitor's address as a count keys it (SA-M11): an IPv4 address as it
 * is, an IPv6 address by its /64, the network one line is routed. Better
 * Auth's own limiter keys the same header the same way.
 *
 * Only for a count's key. Turnstile's `remoteip` wants the address itself.
 * Text that is not an IPv6 address in hex groups is kept as it is,
 * lowercased: it can only be finer than a /64, never coarser.
 */

const GROUP = /^[0-9a-f]{1,4}$/u;
const GROUPS = 8;
const PREFIX_GROUPS = 4;

/**
The eight groups of an IPv6 address, `::` filled in; `undefined` for text that is not one.
*/
function ipv6Groups(text: string): readonly string[] | undefined {
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const [head = [], tail] = halves.map((half) =>
    half === "" ? [] : half.split(":"),
  );
  const given = [...head, ...(tail ?? [])];
  if (given.some((group) => !GROUP.test(group))) return undefined;
  const missing = GROUPS - given.length;
  const isFits = tail === undefined ? missing === 0 : missing > 0;
  return isFits
    ? [...head, ...Array.from({ length: missing }, () => "0"), ...(tail ?? [])]
    : undefined;
}

export function visitorAddress(address: string): string {
  const text = address.trim().toLowerCase();
  const groups = ipv6Groups(text);
  if (groups === undefined) return text;
  const prefix = groups
    .slice(0, PREFIX_GROUPS)
    .map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}
