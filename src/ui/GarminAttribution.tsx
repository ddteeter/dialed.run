/**
 * The credit a run's data owes Garmin when it came through Garmin's API
 * (plan 152; design G1): "Garmin {device model}", or "Garmin" alone while
 * the model is unknown, which is always so in phase 1. Text, never the
 * tag logo; sentence case, never caps or mono.
 *
 * It is the first line under the view's title, wherever a Garmin run is
 * shown, and it draws nothing for any other run: a file the runner
 * uploaded themselves is theirs, whatever device wrote it. The weather
 * credit stays with the conditions and never shares this line.
 *
 * G1 draws it at weight 500; the type contract has no 500 in text
 * (`design/tokens.js` WEIGHT), so it collapses to the normal weight.
 * `--ink-2` on the board is the `--quiet` token.
 *
 * In `ui/` for `WeatherAttribution`'s reason: it is a rule about every
 * screen that shows a run, across modules.
 */
export function GarminAttribution({
  deviceName,
}: Readonly<{ deviceName: string | undefined }>) {
  if (deviceName === undefined) return;
  return (
    <p data-part="garmin-attribution" className="m-0 text-small text-quiet">
      {deviceName}
    </p>
  );
}
