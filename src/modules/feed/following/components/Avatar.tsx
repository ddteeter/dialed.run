/**
 * A runner's first letter, upper-cased.
 */
export function initialOf(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

/**
 * Round 22's two sizes: a post's author row and a search row are small;
 * a profile's header is large.
 */
const SIZE: Readonly<Record<"small" | "large", string>> = {
  small: "size-9 text-body",
  large: "size-14 text-title",
};

/**
 * A runner's avatar until photos exist (round 22, G: *"The avatar is the
 * initial on --hairline … until a photo exists"*). Decorative: the name
 * beside it is what a screen reader reads.
 */
export function Avatar({
  name,
  size,
}: Readonly<{ name: string; size: "small" | "large" }>) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-pill bg-hairline font-display ${SIZE[size]}`}
    >
      {initialOf(name)}
    </span>
  );
}
