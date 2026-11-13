/**
 * Visual Crossing's licence requires attribution wherever its data, or
 * anything derived from it, is shown: *"prominently display the message
 * 'Weather Data Provided by Visual Crossing' in a legible manner near the
 * data … with a clickable link to https://www.visualcrossing.com/"*, and
 * not on a separate credits page. The owner chose the sentence-case
 * wording below (D-144); the link is the licence's own address.
 *
 * External, so a plain anchor rather than the router's `Link` (which only
 * takes the typed route tree), opened in a new tab so the conditions the
 * runner was reading stay where they were.
 *
 * **In `ui/` rather than in `modules/weather/`, for a structural reason
 * rather than a taste one.** It imports nothing from that module — it is
 * an anchor and a sentence — but reaching it meant importing the weather
 * *barrel*, and that barrel exports `attachObservation`, which reaches
 * `src/env`, which is a bare re-export of `cloudflare:workers`. Rolldown
 * cannot strip a module-scope import it must keep, so one attribution
 * line in a component broke `npm run build` outright (CLAUDE.md
 * §Architecture rules: "what it imports at module scope must be reachable
 * without env"). Deep-importing past the barrel is not the alternative —
 * dependency-cruiser forbids it.
 *
 * "Wherever conditions are shown" is a rule about every screen, which is
 * what `ui/` is for. Moved by task 115; `docs/architecture.md` records the
 * boundary change.
 */
/**
The licence's sentence (D-144): the words, or the name a shorter form is heard by.
*/
const CREDIT = "Weather data provided by Visual Crossing";

/**
 * The card's label (Round 54 · 170): the provider's name, the end of the
 * sentence it is heard by. Exported so a card can keep room for it.
 */
export const CREDIT_LABEL = "Visual Crossing";

export function WeatherAttribution({
  isRepeat = false,
  isCompact = false,
}: Readonly<{
  /**
   * The same credit again, on a list where an earlier item already says
   * it: still drawn, and kept out of the accessibility tree and the Tab
   * order, so a screen reader hears it once rather than once a card
   * (R-179). The licence asks for the credit to be *displayed* near the
   * data, and it is; nothing visible changes.
   */
  isRepeat?: boolean;
  /**
   * The card's form (Round 54 · 170): "VISUAL CROSSING", MONO.xs, muted
   * and underlined, the last item on a card's conditions strip, in a 44
   * target. It is heard by the sentence, so D-144's words are kept for
   * anyone who hears it; the drawn words are the end of that name.
   */
  isCompact?: boolean;
}>) {
  return (
    <a
      data-target={isCompact ? undefined : "inline"}
      href="https://www.visualcrossing.com/"
      target="_blank"
      rel="noopener noreferrer"
      aria-hidden={isRepeat ? true : undefined}
      tabIndex={isRepeat ? -1 : undefined}
      aria-label={isCompact && !isRepeat ? CREDIT : undefined}
      className={
        isCompact ? COMPACT_CLASS : "text-micro text-muted no-underline"
      }
    >
      {isCompact ? CREDIT_LABEL : CREDIT}
    </a>
  );
}

const COMPACT_CLASS =
  "target inline-flex items-center font-mono text-mono-xs whitespace-nowrap text-muted uppercase underline underline-offset-4";
