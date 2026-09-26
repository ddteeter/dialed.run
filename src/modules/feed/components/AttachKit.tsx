import { Link, useNavigate } from "@tanstack/react-router";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import type { Units } from "../../../lib/contracts";
import { dayLabel } from "../../../lib/dates";
import { newUlid } from "../../../lib/ids";
import { distanceNumber } from "../../../lib/measures";
import { photoAcceptAttribute } from "../../../lib/photo-constraints";
import { formatTemp, precipClassOf } from "../../../lib/temperature";
import { toggledIn } from "../../../lib/toggled-in";
import {
  ControlFailureBand,
  DeskSplit,
  FileWell,
  FlowStep,
  FormStatus,
  inFlight,
  LOG_FLOW,
  Mono,
  PendingLabel,
  RailCard,
  useControlAction,
} from "../../../ui";
import type { PhotoStep } from "../../../ui";
import type { AttachContext } from "../attach-context";
import { kitChoice, PHOTO_NOT_SENT, photoProblem } from "../attach-rules";
import type { UiGroup } from "../groups";
import type { PrefillCandidate } from "../prefill";
import { KitList, KitSheet, conditionsWords } from "./KitPicker";

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
 * **The photo is here now** (round 20 moved it from A3): the one well, with
 * W3's blur, held until the attach has made the entry it belongs to. It
 * goes up only after the attach has landed, and a failed upload is the
 * well's, not the attach's: the entry exists, so the band never says
 * "Nothing attached" about it, and the runner can go on without the photo
 * (law 5 — the secondary thing never fails the primary one).
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
 * conditions *"the header sub-line loses its temperature cell"*.
 */
function subLine(context: AttachContext, units: Units, pieces: number): string {
  const distance = `${distanceNumber(context.distanceM, units.distance)} ${units.distance}`;
  const { conditions } = context;
  const cells =
    conditions === undefined
      ? [distance, piecesWords(pieces)]
      : [
          distance,
          `${formatTemp(conditions.tempC, units.temp)}${units.temp.toUpperCase()} ${precipClassOf(conditions.precipMm)}`,
          piecesWords(pieces),
        ];
  return cells.join(" · ");
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
  prefillFor: (input: {
    data: { runId: string };
  }) => Promise<PrefillCandidate | undefined>;
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

export function AttachKit({
  runId,
  units,
  context,
  prefillFor,
  attachKit,
  uploadPhoto,
  renderPhotoStep,
}: Readonly<AttachKitProps>): JSX.Element {
  const navigate = useNavigate();
  const [suggestion, setSuggestion] = useState<Suggestion>();
  const [isCardOpen, setIsCardOpen] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isFiltered, setIsFiltered] = useState(
    context.conditions !== undefined,
  );
  const [sheetGroup, setSheetGroup] = useState<UiGroup | undefined>();
  const [kitError, setKitError] = useState<string | undefined>();
  const [photo, setPhoto] = useState<HeldPhoto | undefined>();
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [photoStep, setPhotoStep] = useState<
    { file: File; step: PhotoStep } | undefined
  >();
  const [said, setSaid] = useState("");
  // The entry the attach made, once it has. From then on Next only sends
  // the photo and goes on: attaching again would be answered with this same
  // entry and the kit it already has.
  const [attached, setAttached] = useState<string | undefined>();
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);

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

  // The preview is the held file's own bytes, released when it goes.
  useEffect(() => {
    if (photo === undefined) return;
    const { url } = photo;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photo]);

  /**
   * The held photo, sent to the entry the attach made — then on to A3.
   *
   * A failure stays on the well, with the photo still held, and goes
   * nowhere: the runner either presses Next again, which sends it under the
   * same key (law 8b — one photo, however many tries), or removes it and
   * goes on without it.
   */
  async function sendPhotoThenGo(entryId: string): Promise<void> {
    if (photo !== undefined) {
      setIsSendingPhoto(true);
      setPhotoError(undefined);
      try {
        const upload = new FormData();
        upload.append("entryId", entryId);
        upload.append("photo", photo.file);
        upload.append("idempotencyKey", photo.key);
        await uploadPhoto({ data: upload });
      } catch {
        setPhotoError(PHOTO_NOT_SENT);
        return;
      } finally {
        setIsSendingPhoto(false);
      }
    }
    await navigate({ to: "/feed/verdict/$entryId", params: { entryId } });
  }

  const attach = useControlAction({
    kicker: "Nothing attached",
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
      if (!isSendingPhoto) void sendPhotoThenGo(attached);
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

  function keep(ready: File): void {
    setPhotoStep(undefined);
    setPhoto({
      file: ready,
      key: newUlid(),
      url: URL.createObjectURL(ready),
    });
  }

  function onPhotoFiles(files: FileList | null): void {
    // No list, or an empty one — the picker was dismissed: nothing to keep.
    const file = files?.[0];
    if (file === undefined) return;
    const problem = photoProblem(file);
    setPhotoError(problem);
    if (problem !== undefined) return;
    if (renderPhotoStep === undefined) {
      keep(file);
      return;
    }
    setPhotoStep({ file, step: renderPhotoStep });
  }

  const conditions = context.conditions;
  const names = new Map(
    context.groups.flatMap((group) =>
      group.items.map((item) => [item.id, item.name] as const),
    ),
  );
  const openGroup = context.groups.find((group) => group.group === sheetGroup);

  return (
    <FlowStep step={LOG_FLOW.attach}>
      <DeskSplit rail={<AttachRail context={context} units={units} />}>
        <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-5 pt-6 pb-8 wide:mx-0 wide:max-w-column">
          <header
            data-slot="header"
            data-ground="ink"
            className="-mx-5 -mt-6 flex flex-col gap-1 bg-ground px-5 py-5 text-ink"
          >
            <h1 className="m-0 font-display text-heading">
              What did you wear?
            </h1>
            <Mono step="xs" className="text-teal">
              {subLine(context, units, selected.size)}
            </Mono>
          </header>
          <FormStatus>{attach.status === "" ? said : attach.status}</FormStatus>

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

          <KitList
            groups={context.groups}
            conditions={conditions}
            units={units}
            isFiltered={isFiltered}
            onFilter={setIsFiltered}
            isOr={suggestion !== "none"}
            selected={selected}
            onToggle={toggle}
            onOpen={setSheetGroup}
            error={kitError}
          />
          <KitSheet
            group={openGroup}
            conditions={conditions}
            units={units}
            selected={selected}
            onToggle={toggle}
            onClose={() => {
              setSheetGroup(undefined);
            }}
          />

          <FileWell
            part="photo-well"
            copy={{
              kicker: "Outfit photo · optional",
              label: "Add a photo",
              wideLabel: "Drop a photo, or browse",
              overLabel: "Let go to add it",
              pendingLabel: "Adding",
              hint: "Flat on the floor works best.",
            }}
            pending={photoStep !== undefined || isSendingPhoto}
            accept={photoAcceptAttribute}
            error={photoError}
            preview={
              photo === undefined
                ? undefined
                : { src: photo.url, alt: "Your outfit" }
            }
            onRemove={() => {
              setPhoto(undefined);
            }}
            onFiles={onPhotoFiles}
          />
          {photoStep === undefined
            ? undefined
            : photoStep.step(photoStep.file, keep, setSaid)}

          <div className="flex flex-col gap-3">
            <button
              type="button"
              data-slot="primary-action"
              {...inFlight(attach.pending)}
              onClick={() => {
                next([...selected]);
              }}
              className="target grid min-h-13 place-items-center rounded-card border-none bg-action px-6 py-4 font-display text-body uppercase text-ink"
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
        </div>
      </DeskSplit>
    </FlowStep>
  );
}

/**
 * A2's rail at the desk (round 25): the run the kit is for, read-only.
 *
 * The board's A2 rail is the evidence behind MOST LIKELY — the runner's
 * last three runs in the band, with their kit and verdict. That history is
 * not loaded on this screen yet, so the rail carries the run itself until
 * it is, rather than a guess at the evidence.
 */
function AttachRail({
  context,
  units,
}: Readonly<{ context: AttachContext; units: Units }>): JSX.Element {
  const { conditions } = context;
  return (
    <RailCard title="This run">
      <Mono step="sm">
        {`${distanceNumber(context.distanceM, units.distance)} ${units.distance}`}
      </Mono>
      {conditions === undefined ? undefined : (
        <Mono step="sm" className="text-dialed-text">
          {`${formatTemp(conditions.tempC, units.temp)}${units.temp.toUpperCase()} ${precipClassOf(conditions.precipMm)}`}
        </Mono>
      )}
    </RailCard>
  );
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
        <span className="text-body font-semibold">
          <PendingLabel
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
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((itemId) => (
          <li key={itemId} className="text-body font-semibold">
            {names.get(itemId)}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            onAccept(shown);
          }}
          className="target rounded-pill bg-ink px-5 py-2 font-semibold text-ground"
        >
          That&rsquo;s it
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(shown);
          }}
          className="target font-semibold underline underline-offset-4"
        >
          Change
        </button>
      </div>
    </div>
  );
}
