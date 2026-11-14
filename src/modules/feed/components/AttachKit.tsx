import { Link, useNavigate } from "@tanstack/react-router";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";

import type { Units } from "../../../lib/contracts";
import { dayLabel } from "../../../lib/dates";
import { newUlid } from "../../../lib/ids";
import { measuredLine } from "../../../lib/contracts/measures";
import {
  maxPhotosPerEntry,
  photoAcceptAttribute,
  photoProblem,
} from "../../../lib/photo-constraints";
import {
  bandFloorC,
  formatTemp,
  precipClassOf,
} from "../../../lib/contracts/temperature";
import { toggledIn } from "../../../lib/toggled-in";
import {
  ControlFailureBand,
  DeskSplit,
  FlowStep,
  FormStatus,
  GarminAttribution,
  inFlight,
  LOG_FLOW,
  Mono,
  PendingLabel,
  PhoneBell,
  PhotoRow,
  Spoken,
  useControlAction,
  usePhotoPick,
  WeatherAttribution,
} from "../../../ui";
import type { PhotoStep } from "../../../ui";
import type { AttachContext } from "../attach-context";
import type { BandRun } from "../band-runs";
import { BackToRun } from "./BackToRun";
import { BandRunsCard } from "./BandRunsCard";
import { kitChoice, PHOTO_NOT_SENT } from "../attach-rules";
import type { UiGroup } from "../groups";
import { isAtDesk } from "../kit-push";
import type { PrefillCandidate } from "../prefill";
import { isProvidersReading } from "../strip";
import { KitList, KitPage, KitSheet, conditionsWords } from "./KitPicker";
import { PushBack, PushFrame } from "./PushPage";
import { ThisRunCard } from "./ThisRunCard";

/**
 * Attach the kit (screen A2), built to round 22's two frames and round
 * 20's rules.
 *
 * **Only most-likely waits.** *"The picker, the photo row and the button
 * are A2 at rest, from the first frame"* — the closet comes with the route,
 * and the suggestion is the one thing fetched after it, because it is the
 * one read that scans the runner's history. It used to hide the whole
 * screen behind a skeleton until the browser had been asked for a position
 * and answered, and a denied prompt meant nothing at all.
 *
 * **A kit is required.** The header counts it ("· 0 PIECES" is how "nothing
 * yet" is said), the button never changes its label, and pressing it with
 * nothing chosen marks the picker "Pick at least one piece." — the round-13
 * "Attach 0 items" is superseded.
 *
 * **The photos are here now** (round 20 moved them from A3): the photo row
 * (Round 56 · 249), each photo through W3's blur, held until the attach
 * has made the entry they belong to. They go up only after the attach
 * has landed, and a failed upload is the row's, not the attach's: the
 * entry exists, so the band never says "Nothing attached" about it, and
 * the runner can go on without the photo (law 5 — the secondary thing
 * never fails the primary one).
 *
 * **A failed attach is a control failure** (round 23, item 9): no
 * optimistic step forward, the in-flight label while it waits, and the band
 * under the button saying what is still true — nothing attached.
 */

type Suggestion = PrefillCandidate | "none" | undefined;

/**
 * A picked photo, the key its upload is retried under (law 8b), and the
 * object URL its preview is drawn from — minted with the photo, so there
 * is never a photo without its preview or a preview without its photo.
 */
interface HeldPhoto {
  file: File;
  key: string;
  url: string;
}

/**
"1 piece", "3 pieces" — and "0 pieces", which is the point.
*/
function piecesWords(count: number): string {
  return `${String(count)} ${count === 1 ? "piece" : "pieces"}`;
}

/**
 * The header's sub-line: "6.2 MI · 41°F DAMP · 0 PIECES". With no
 * conditions *"the header sub-line loses its temperature cell"*. A line
 * of measures (round 52 #158): drawn, and said in words.
 */
function subLine(
  context: AttachContext,
  units: Units,
  pieces: number,
): { shown: string; said: string } {
  const { conditions } = context;
  return measuredLine(
    [
      [{ kind: "distance", distanceM: context.distanceM, spaced: true }],
      ...(conditions === undefined ? [] : [readingOf(conditions)]),
      [{ kind: "word", word: piecesWords(pieces) }],
    ],
    units,
  );
}

/**
The run's reading as A2 draws it: "41°F damp".
*/
function readingOf(conditions: NonNullable<AttachContext["conditions"]>) {
  return [
    { kind: "temp", tempC: conditions.tempC, withLetter: true },
    { kind: "word", word: precipClassOf(conditions.precipMm) },
  ] as const;
}

/**
 * The server functions, handed in rather than imported, in their own
 * shapes — a component never reaches `../functions` (CLAUDE.md). Named
 * rather than inline, `UploadFormProps`' convention.
 */
interface AttachKitProps {
  runId: string;
  /**
  The viewer's own units — every number on this screen is theirs.
  */
  units: Units;
  /**
  The run, its conditions and the closet, from the route's loader.
  */
  context: AttachContext;
  /**
   * What the run's summary adds for the rail's This run card (Round 55 ·
   * 242) and the Garmin credit (D2-12): when it started, how long it
   * took, and who to credit for its data.
   */
  run: {
    startedAt: number;
    durationS: number;
    deviceName: string | undefined;
    /**
     * The clock the run reads on (P2a-02): its own zone, else its
     * runner's home zone, as the run summary resolves it.
     */
    clockZone: string | undefined;
  };
  /**
   * The category A2b has pushed to at the desk (Round 54 · 164.3), from
   * A2's URL, or none: A2 itself.
   */
  pushed: UiGroup | undefined;
  /**
  Push to a category's page — the route's, since it owns the URL.
  */
  onPush: (group: UiGroup) => void;
  /**
  Come back from it to A2, with the picks it made.
  */
  onPushDone: () => void;
  prefillFor: (input: {
    data: { runId: string };
  }) => Promise<PrefillCandidate | undefined>;
  /**
  The desk rail's band history (round 25), fetched after the screen is drawn
  as the suggestion is: it is a second read over the runner's history.
  */
  bandRunsFor: (input: {
    data: { bandFloorC: number };
  }) => Promise<readonly BandRun[]>;
  attachKit: (input: {
    data: { runId: string; itemIds: string[] };
  }) => Promise<{ entryId: string }>;
  uploadPhoto: (input: { data: FormData }) => Promise<{ key: string }>;
  /**
   * W3's step between picking a photo and keeping it — a render slot,
   * because this module may not reach `modules/safety`. Absent, a picked
   * photo is kept as it is.
   */
  renderPhotoStep?: PhotoStep | undefined;
}

/**
The most-likely read, fetched after the route has drawn the screen.
*/
function useSuggestion(
  prefillFor: AttachKitProps["prefillFor"],
  runId: string,
): Suggestion {
  const [suggestion, setSuggestion] = useState<Suggestion>();

  // The one read the screen waits on. A failure is no suggestion: the
  // picker is already there, and a suggestion is never the only way on.
  useEffect(() => {
    async function load(): Promise<void> {
      try {
        setSuggestion((await prefillFor({ data: { runId } })) ?? "none");
      } catch {
        setSuggestion("none");
      }
    }
    void load();
  }, [prefillFor, runId]);

  return suggestion;
}

/**
 * The photo well's half of the screen: the held photo and its preview, W3's
 * step between picking and keeping, and the upload once the entry exists.
 */
function useHeldPhoto({
  renderPhotoStep,
  uploadPhoto,
}: Pick<AttachKitProps, "renderPhotoStep" | "uploadPhoto">) {
  // Design 252 (#668): up to `maxPhotosPerEntry`, in the order picked.
  const [photos, setPhotos] = useState<readonly HeldPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);
  // W3, in the sheet the closet's photo uses too (round 28 #5). It closes
  // back onto the add box it opened from: Use this photo, Cancel and Esc
  // all return focus there rather than dropping it on the page.
  const pick = usePhotoPick({ renderPhotoStep, onReady: keep });
  useReleasedPreviews(photos);

  /**
   * The held photos, sent in order to the entry the attach made. `false`
   * when one failed, and the screen then goes nowhere.
   *
   * Each photo leaves the row once it is sent, so a failure leaves only
   * the unsent ones held: the runner either presses Next again, which
   * sends each under its own key (law 8b — one photo, however many
   * tries), or removes them and goes on without them.
   */
  async function didSend(entryId: string): Promise<boolean> {
    if (photos.length === 0) return true;
    setIsSendingPhoto(true);
    setPhotoError(undefined);
    try {
      for (const photo of photos) {
        const upload = new FormData();
        upload.append("entryId", entryId);
        upload.append("photo", photo.file);
        upload.append("idempotencyKey", photo.key);
        await uploadPhoto({ data: upload });
        setPhotos((held) => held.filter((each) => each !== photo));
      }
      return true;
    } catch {
      setPhotoError(PHOTO_NOT_SENT);
      return false;
    } finally {
      setIsSendingPhoto(false);
    }
  }

  function keep(ready: File): void {
    const photo = {
      file: ready,
      key: newUlid(),
      url: URL.createObjectURL(ready),
    };
    setPhotos((held) => [...held, photo]);
  }

  function onPhotoFiles(files: FileList | null): void {
    // No list, or an empty one — the picker was dismissed: nothing to keep.
    const file = files?.[0];
    if (file === undefined) return;
    const problem = photoProblem(file);
    setPhotoError(problem);
    if (problem !== undefined) return;
    pick.pick(file);
  }

  return {
    pick,
    photoError,
    isSendingPhoto,
    isBusy: pick.stepping || isSendingPhoto,
    photos: photos.map((photo) => ({ src: photo.url, alt: "Your outfit" })),
    remove: (index: number) => {
      setPhotos((held) => held.filter((_, at) => at !== index));
    },
    didSend,
    onPhotoFiles,
  };
}

/**
 * Each preview is its held file's own bytes, released once that photo
 * leaves the row, whether removed or sent, and all of them on unmount.
 */
function useReleasedPreviews(photos: readonly HeldPhoto[]): void {
  const shown = useRef<readonly string[]>([]);
  useEffect(() => {
    const now = photos.map((photo) => photo.url);
    for (const url of shown.current) {
      if (!now.includes(url)) URL.revokeObjectURL(url);
    }
    shown.current = now;
  }, [photos]);
  useEffect(
    () => () => {
      for (const url of shown.current) URL.revokeObjectURL(url);
    },
    [],
  );
}

export function AttachKit(props: Readonly<AttachKitProps>): JSX.Element {
  const { runId, units, context, run, attachKit } = props;
  const navigate = useNavigate();
  const suggestion = useSuggestion(props.prefillFor, runId);
  const [isCardOpen, setIsCardOpen] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [kitError, setKitError] = useState<string | undefined>();
  const [said, setSaid] = useState("");
  const held = useHeldPhoto(props);
  // The entry the attach made, once it has. From then on Next only sends
  // the photo and goes on: attaching again would be answered with this same
  // entry and the kit it already has.
  const [attached, setAttached] = useState<string | undefined>();

  /**
   * The held photo, sent to the entry the attach made — then on to A3.
   * A failed upload goes nowhere; see `useHeldPhoto`'s `didSend`.
   */
  async function sendPhotoThenGo(entryId: string): Promise<void> {
    if (!(await held.didSend(entryId))) return;
    await navigate({ to: "/feed/verdict/$entryId", params: { entryId } });
  }

  const attach = useControlAction({
    kicker: "Nothing attached",
    // The picks are what a terms refusal loses (D-102).
    isSave: true,
    action: async (itemIds: string[]) => {
      // The entry, and only the entry: this is what "Nothing attached" is
      // about. The photo belongs to an entry and there is none until this
      // returns, so it goes after, and its failure is its own.
      const { entryId } = await attachKit({ data: { runId, itemIds } });
      setAttached(entryId);
      await sendPhotoThenGo(entryId);
    },
  });

  /**
   * Send this kit, or say why not. The rule is the schema's; the sentence
   * lands on the picker, where the fix is.
   */
  function next(itemIds: readonly string[]): void {
    if (attached !== undefined) {
      if (!held.isSendingPhoto) void sendPhotoThenGo(attached);
      return;
    }
    const parsed = kitChoice.safeParse(itemIds);
    if (!parsed.success) {
      // The schema's own sentence. An empty kit breaks one rule, so there
      // is one issue; the list is written out whole rather than indexed,
      // so no guard stands in for an issue a failed parse always has.
      setKitError(String(parsed.error.issues.map((issue) => issue.message)));
      return;
    }
    setKitError(undefined);
    void attach.run(parsed.data);
  }

  function toggle(itemId: string): void {
    setSelected((previous) => toggledIn(previous, itemId));
    setKitError(undefined);
  }

  const conditions = context.conditions;
  // A2b pushed at the desk, when the URL names a category the closet has.
  const pushedGroup = context.groups.find(
    (group) => group.group === props.pushed,
  );
  const names = new Map(
    context.groups.flatMap((group) =>
      group.items.map((item) => [item.id, item.name] as const),
    ),
  );

  return (
    <FlowStep step={LOG_FLOW.attach}>
      <DeskSplit
        rail={
          <AttachRail
            context={context}
            run={run}
            units={units}
            bandRunsFor={props.bandRunsFor}
          />
        }
      >
        <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-5 pt-6 pb-8 wide:max-w-column">
          <PushFrame
            pushed={
              pushedGroup === undefined ? undefined : (
                <KitPage
                  group={pushedGroup}
                  conditions={conditions}
                  units={units}
                  selected={selected}
                  onToggle={toggle}
                  back={<PushBack>What did you wear?</PushBack>}
                  onDone={props.onPushDone}
                />
              )
            }
          >
            <AttachHeader
              run={{ runId, deviceName: run.deviceName }}
              context={context}
              units={units}
              count={selected.size}
            />
            <FormStatus>
              {attach.status === "" ? said : attach.status}
            </FormStatus>

            <MostLikely
              suggestion={suggestion}
              isOpen={isCardOpen}
              conditions={conditions}
              units={units}
              names={names}
              onAccept={next}
              onChange={(itemIds) => {
                setSelected(new Set(itemIds));
                setIsCardOpen(false);
              }}
            />

            <KitChooser
              context={context}
              units={units}
              isOr={suggestion !== "none"}
              picks={{ selected, onToggle: toggle, error: kitError }}
              onStatus={setSaid}
              onPush={props.onPush}
            />

            {/* Design 252 (#668): up to the cap, each sent in order.
                Design 253 (#669): no dashed well, only the add box. */}
            <PhotoRow
              kicker="Outfit photo · optional"
              photos={held.photos}
              add={{
                max: maxPhotosPerEntry,
                accept: photoAcceptAttribute,
                pending: held.isBusy,
                error: held.photoError,
                onFiles: held.onPhotoFiles,
                inputRef: held.pick.wellRef,
              }}
              onRemove={held.remove}
            />
            {held.pick.step(setSaid)}

            <div className="flex flex-col gap-3">
              <button
                type="button"
                data-slot="primary-action"
                {...inFlight(attach.pending)}
                onClick={() => {
                  next([...selected]);
                }}
                className="target grid min-h-13 place-items-center rounded-card border-none bg-action px-6 py-4 font-display text-body uppercase text-accent-ink"
              >
                <PendingLabel
                  label="Next — did it work?"
                  pendingLabel="Attaching"
                  pending={attach.pending}
                />
              </button>
              <ControlFailureBand
                failure={attach.failure}
                onRetry={attach.retry}
                retryRef={attach.retryRef}
              />
              <p className="m-0 text-center text-small text-muted">
                Not now —{" "}
                <Link
                  to="/runs"
                  data-target="inline"
                  className="font-semibold text-cold-text"
                >
                  leave it in the queue
                </Link>
                .
              </p>
            </div>
          </PushFrame>
        </div>
      </DeskSplit>
    </FlowStep>
  );
}

/**
 * A2's header: the question, and the sub-line counting the kit so far.
 */
function AttachHeader({
  run,
  context,
  units,
  count,
}: Readonly<{
  /**
  The run's id for the way back, and who to credit for its data.
  */
  run: { runId: string; deviceName: string | undefined };
  context: AttachContext;
  units: Units;
  count: number;
}>): JSX.Element {
  return (
    <header
      data-slot="header"
      // Ink on the phone, the title line from `wide` (DS0 bend 4) —
      // see `ground-ink` in ui/tokens.css. `--dialed-text` rather
      // than `teal`: it is teal on ink and the paper teal on paper,
      // where the surface teal would not clear as text.
      data-ground="ink-until-wide"
      className="-mx-5 -mt-6 flex flex-col gap-1 bg-ground px-5 py-5 text-ink wide:mx-0 wide:mt-0 wide:px-0 wide:py-0"
    >
      {/* "← Back" above the title at both widths, sharing its row with
          the phone's bell (Round 55 · 242; Design 169.1). */}
      <div className="flex items-center justify-between gap-3">
        <BackToRun runId={run.runId} />
        <PhoneBell />
      </div>
      <h1 className="m-0 font-display text-heading wide:text-title">
        What did you wear?
      </h1>
      {/* The run came through Garmin's API: its credit is the first line
          under the title (G1; D2-12), once on the screen. */}
      <GarminAttribution deviceName={run.deviceName} />
      <Mono step="xs" className="text-dialed-text">
        <Spoken {...subLine(context, units, count)} />
      </Mono>
      {/* The sub-line carries the provider's reading, and the
          picker's filter and MOST LIKELY repeat it below: one credit
          under the first place it shows (D-144). */}
      {isProvidersReading(context.conditions) ? (
        <WeatherAttribution />
      ) : undefined}
    </header>
  );
}

/**
 * The picker and the sheet a group opens into, with the filter and the
 * open group they share. What is picked is the screen's, so it comes in.
 */
function KitChooser({
  context,
  picks,
  units,
  isOr,
  onStatus,
  onPush,
}: Readonly<{
  context: AttachContext;
  picks: {
    selected: ReadonlySet<string>;
    onToggle: (itemId: string) => void;
    error: string | undefined;
  };
  units: Units;
  isOr: boolean;
  onStatus: (sentence: string) => void;
  onPush: (group: UiGroup) => void;
}>): JSX.Element {
  const { conditions } = context;
  const [isFiltered, setIsFiltered] = useState(conditions !== undefined);
  const [sheetGroup, setSheetGroup] = useState<UiGroup | undefined>();
  const openGroup = context.groups.find((group) => group.group === sheetGroup);

  return (
    <>
      <KitList
        groups={context.groups}
        conditions={conditions}
        units={units}
        isFiltered={isFiltered}
        onFilter={setIsFiltered}
        isOr={isOr}
        selected={picks.selected}
        onToggle={picks.onToggle}
        // A list that can grow pushes at the desk (Round 54 · 164.3);
        // below it the sheet stays as it is.
        onOpen={(group) => {
          if (isAtDesk()) onPush(group);
          else setSheetGroup(group);
        }}
        error={picks.error}
        onStatus={onStatus}
      />
      <KitSheet
        group={openGroup}
        conditions={conditions}
        units={units}
        selected={picks.selected}
        onToggle={picks.onToggle}
        onClose={() => {
          setSheetGroup(undefined);
        }}
      />
    </>
  );
}

/**
 * A2's rail at the desk (round 25): the run the kit is for, and beneath it
 * the runner's last runs in the band, with their kit and verdict — *"the
 * evidence behind MOST LIKELY"*. Read-only: *"Tapping a row does nothing,
 * so 'That's it' stays the one way to take a suggestion."*
 *
 * The history is the second read over the runner's history, so it is
 * fetched once the screen is drawn, as the suggestion is. Until it lands,
 * and if it fails (law 5), the rail is the run alone. A run with no
 * conditions has no band, and nothing to fetch.
 */
function AttachRail({
  context,
  run,
  units,
  bandRunsFor,
}: Readonly<{
  context: AttachContext;
  run: AttachKitProps["run"];
  units: Units;
  bandRunsFor: AttachKitProps["bandRunsFor"];
}>): JSX.Element {
  const { conditions } = context;
  const history = useBandRuns(bandRunsFor, conditions);
  return (
    <>
      <ThisRunCard
        run={{ ...run, distanceM: context.distanceM, conditions }}
        units={units}
      />
      {history === undefined ? undefined : (
        <BandRunsCard
          lead={lastRunsLead}
          bandFloor={history.band.floor}
          precipMm={history.band.precipMm}
          runs={history.runs}
          units={units}
        />
      )}
    </>
  );
}

/**
`LAST 3 IN 38–46° DAMP`, as many as there are; with none, `IN 38–46° DAMP`.
*/
function lastRunsLead(count: number): string {
  return count === 0 ? "In" : `Last ${String(count)} in`;
}

interface RailBand {
  floor: number;
  precipMm: number;
}

/**
The band history for the rail, with the band it is for, once it has come;
nothing before, on failure, or for a run with no conditions and so no band.
*/
function useBandRuns(
  bandRunsFor: AttachKitProps["bandRunsFor"],
  conditions: AttachContext["conditions"],
): { band: RailBand; runs: readonly BandRun[] } | undefined {
  const [history, setHistory] = useState<
    { band: RailBand; runs: readonly BandRun[] } | undefined
  >();
  const feelsLikeC = conditions?.feelsLikeC;
  const precipMm = conditions?.precipMm ?? 0;
  useEffect(() => {
    if (feelsLikeC === undefined) return;
    async function load(band: RailBand): Promise<void> {
      try {
        const runs = await bandRunsFor({ data: { bandFloorC: band.floor } });
        setHistory({ band, runs });
      } catch {
        // Law 5: the evidence is a courtesy; the rail keeps the run.
      }
    }
    void load({ floor: bandFloorC(feelsLikeC), precipMm });
  }, [bandRunsFor, feelsLikeC, precipMm]);
  return history;
}

/**
 * The most-likely region, in its three states (round 22, "A2 Waiting" and
 * "A2 No suggestion"), each named on `data-state` for the harness:
 *
 * - **waiting** — a hairline card whose line is the breathing brackets:
 *   "[ Checking what you wore at 41° ]".
 * - **suggestion** — the hi-viz card: where it is from, the pieces, "That's
 *   it" to send them and "Change" to take them into the picker.
 * - **none** — *"One line, no card: an empty card is a promise we're not
 *   keeping."* With no conditions the line says why and the sub-line drops.
 */
function MostLikely({
  suggestion,
  isOpen,
  conditions,
  units,
  names,
  onAccept,
  onChange,
}: Readonly<{
  suggestion: Suggestion;
  isOpen: boolean;
  conditions: AttachContext["conditions"];
  units: Units;
  names: ReadonlyMap<string, string>;
  onAccept: (itemIds: readonly string[]) => void;
  onChange: (itemIds: readonly string[]) => void;
}>): JSX.Element | undefined {
  const temp =
    conditions === undefined
      ? undefined
      : formatTemp(conditions.tempC, units.temp);

  if (suggestion === undefined) {
    return (
      <div
        data-slot="most-likely"
        data-state="waiting"
        aria-busy="true"
        className="flex flex-col gap-2 rounded-card border border-hairline p-4"
      >
        <Mono step="xs" className="text-muted">
          Most likely
        </Mono>
        {/* Left-aligned, with the board's pink brackets (Round 55 · 240). */}
        <span className="text-body font-semibold [&_.breathe]:text-action">
          <PendingLabel
            align="start"
            label=""
            pendingLabel={
              temp === undefined
                ? "Checking what you wore"
                : `Checking what you wore at ${temp}`
            }
            pending
          />
        </span>
      </div>
    );
  }

  if (suggestion === "none") {
    return (
      <div
        data-slot="most-likely"
        data-state="none"
        className="flex flex-col gap-1 border-b border-hairline pb-4"
      >
        <span className="text-body font-semibold">
          {temp === undefined
            ? "No weather on this run, so no suggestion."
            : `No usual kit at ${temp} yet.`}
        </span>
        {temp === undefined ? undefined : (
          <span className="text-small text-label">
            Pick what you wore. After a few runs here, we&rsquo;ll suggest it.
          </span>
        )}
      </div>
    );
  }

  if (!isOpen) return undefined;

  // Only what the card shows: a piece the picker no longer has — retired
  // since, or gone — is not drawn, so it is not sent either. The server
  // refuses a retired one regardless.
  const shown = suggestion.itemIds.filter((itemId) => names.has(itemId));

  return (
    <div
      data-slot="most-likely"
      data-state="suggestion"
      className="flex flex-col gap-3 rounded-card bg-hi-viz p-4 text-accent-ink"
    >
      <Mono step="xs">
        Most likely · from {conditionsWords(suggestion.conditions, units)},{" "}
        {dayLabel(suggestion.createdAt, suggestion.conditions.timeZone)}
      </Mono>
      {/* The pieces as outlined mono pills, and Change as the outlined
          pill beside That's it (Round 55 · 240). */}
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {shown.map((itemId) => (
          <li
            key={itemId}
            className="rounded-pill border border-accent-ink px-2 py-1"
          >
            <Mono step="sm">{names.get(itemId)}</Mono>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onAccept(shown);
          }}
          className="target flex-1 rounded-pill bg-ink px-5 py-3 font-semibold text-ground"
        >
          That&rsquo;s it
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(shown);
          }}
          className="target rounded-pill border border-accent-ink bg-transparent px-4 py-3 font-semibold text-accent-ink"
        >
          Change
          {/* Round 52 #159: heard alone, "Change" did not say what. */}
          <span className="sr-only"> the kit</span>
        </button>
      </div>
    </div>
  );
}
