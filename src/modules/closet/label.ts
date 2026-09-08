/**
 * How a garment is named on screen.
 *
 * One function because the closet grid and the item detail page each had
 * their own copy of `brand + name, unless generic` — and they had already
 * diverged: the detail page's photo `alt` used the bare name, so a screen
 * reader heard "Pegasus 41" where the heading said "Nike Pegasus 41". The
 * visible label and the accessible name disagreeing about what a thing is
 * called is exactly the drift worth preventing.
 */
export function garmentLabel(input: {
  name: string;
  brand: string | null;
  isGeneric: boolean;
}): string {
  return input.isGeneric || input.brand === null
    ? input.name
    : `${input.brand} ${input.name}`;
}
