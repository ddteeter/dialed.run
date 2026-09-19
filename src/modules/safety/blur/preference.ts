/**
 * Whether this device wants faces blurred.
 *
 * **On by default** — that is W3, and it is the whole point: a privacy
 * default that has to be switched on is one most people never switch on.
 *
 * **Off is remembered, on is not.** The only state worth storing is the
 * refusal, because the refusal is what saves the download: MediaPipe is
 * ~2.6 MB brotli and ~11.9 MB instantiated, and someone who has told us
 * they do not want this should never pay it again. Storing the default
 * would mean writing to every runner's browser to record that nothing
 * unusual happened.
 *
 * **A read that fails means on.** Private windows, cleared site data and
 * blocked storage all throw or come back empty, and the safe direction is
 * unambiguous: failing to read a preference must not silently stop
 * blurring someone's face.
 */

const KEY = "dialed.blurFaces";
const OFF = "off";

/**
 * Reads the stored choice. `true` unless this device has explicitly said
 * otherwise.
 */
export function shouldBlurFaces(storage?: Storage): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    return store.getItem(KEY) !== OFF;
  } catch {
    // Every way this can go wrong lands here and means the same thing:
    // no stored refusal, so blur is on. A private window, cleared site
    // data, blocked storage, and an environment with no localStorage at
    // all (the Worker, during SSR) are four causes of one answer, and
    // guarding them separately made three branches that no input could
    // tell apart.
    return true;
  }
}

/**
 * Records the choice, removing the key when blur is back on so the
 * default is expressed by absence rather than by a second stored value.
 */
export function setBlurPreference(isOn: boolean, storage?: Storage): void {
  try {
    const store = storage ?? globalThis.localStorage;
    if (isOn) {
      store.removeItem(KEY);
      return;
    }
    store.setItem(KEY, OFF);
  } catch {
    // A device that cannot remember the refusal will ask again next
    // time, which is a smaller failure than an exception thrown out of a
    // photo picker.
  }
}
