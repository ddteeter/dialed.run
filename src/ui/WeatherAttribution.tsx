/**
 * Visual Crossing's free tier requires attribution wherever conditions are
 * shown (docs/tasks/103-weather.md).
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
      href="https://www.visualcrossing.com/weather-data"
      target="_blank"
      rel="noreferrer"
      className="text-micro text-muted no-underline"
    >
      Weather by Visual Crossing
    </a>
  );
}
