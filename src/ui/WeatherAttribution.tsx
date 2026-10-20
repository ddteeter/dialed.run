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
export function WeatherAttribution() {
  return (
    <a
      data-target="inline"
      href="https://www.visualcrossing.com/"
      target="_blank"
      rel="noopener noreferrer"
      className="text-micro text-muted no-underline"
    >
      Weather data provided by Visual Crossing
    </a>
  );
}
