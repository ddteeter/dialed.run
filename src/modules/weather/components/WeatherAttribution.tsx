/**
 * Visual Crossing's free tier requires attribution wherever conditions are
 * shown (docs/tasks/103-weather.md). Lane 104 renders this next to any
 * displayed conditions.
 */
export function WeatherAttribution() {
  return (
    <a
      href="https://www.visualcrossing.com/weather-data"
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[10px] uppercase tracking-[0.08em] text-night/40 no-underline"
    >
      Weather by Visual Crossing
    </a>
  );
}
