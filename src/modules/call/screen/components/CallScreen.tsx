import type { JSX, ReactNode } from "react";

import { Mono, Spoken } from "../../../../ui";
import type { B2Header, B2View, Line } from "../../evidence";
import type { ScreenFacts } from "../facts";
import { SCREEN_WORDS } from "../words";
import { CallCount } from "./CallCount";
import { DrawnLine, WhenLine } from "./DrawnLine";
import { KitParagraph, KitPieces } from "./KitPieces";
import { WhyNots } from "./WhyNots";

/**
 * What the route puts into the screen, since the Call's view model cannot.
 */
export interface CallScreenSlots {
  /**
   * The hour line: "TOMORROW · 6:10 AM · STEADY". See `WhenLine`.
   */
  when?: ReactNode;
  /**
   * B2's "RUNNERS IN THESE CONDITIONS" block. It is the feed's component
   * (Round 62, 367), so the route renders it and hands it in; absent, as
   * under five runners, nothing is drawn in its place.
   */
  sameConditions?: ReactNode;
}

type CallHeader = Extract<B2Header, { kind: "call" }>;

/**
 * Screen B2, the Call's answer, in its four states, over the view model
 * (`b2View`) and the facts the boards need beside it (`screenFacts`):
 *
 * - **the Call**, confident or probable (Round 62, "B2 probable"): the
 *   hour line, the verb, the confidence chip, the kit, the hi-viz
 *   paragraph, the feed's block, the why-nots;
 * - **a borrowed Call at home** (C1b, 363.3): the BORROWED CALL field
 *   over the verb, and no chip;
 * - **no forecast** (C0a, 366.3): the card over the verb, and the chip
 *   with no "IN BAND";
 * - **below the threshold** (C0b): the count alone.
 *
 * It formats nothing and decides no wording: every string is the view's
 * or a Round 62 ruling's (`SCREEN_WORDS`). Each part is absent when the
 * view has nothing for it; none is hidden by state. So C1b and C0a carry
 * no paragraph because the engine has no sentence there, and why-nots show
 * wherever the view offers one.
 *
 * Pure: no server function, loader, clock or binding. No route mounts it
 * yet. The feed's block sits between the paragraph and the why-nots, as
 * the Call Epic's B2 orders them (a guess: QUESTIONS.md, A6).
 */
export function CallScreen({
  view,
  facts,
  slots = {},
  verdictsLogged,
}: Readonly<{
  view: B2View;
  facts: ScreenFacts;
  slots?: CallScreenSlots | undefined;
  verdictsLogged?: number | undefined;
}>): JSX.Element {
  const { header } = view;
  if (header.kind === "count") {
    return <CallCount header={header} verdictsLogged={verdictsLogged} />;
  }
  return (
    <div data-part="call" className="flex flex-col gap-6">
      <CallTop
        header={header}
        noForecast={facts.noForecast}
        when={slots.when}
      />
      <KitPieces pieces={view.pieces} />
      <KitParagraph text={view.paragraph} />
      {slots.sameConditions}
      <WhyNots rows={facts.whyNots} />
    </div>
  );
}

/**
 * What stands over the kit, by state. With no forecast the hour line moves
 * onto the card and the chip is the one over all the runner's runs. A
 * header with a body is the borrowed Call: its title and body are the
 * field, so no chip repeats the title, and C1b draws no hour line.
 */
function CallTop({
  header,
  noForecast,
  when,
}: Readonly<{
  header: CallHeader;
  noForecast: Line | undefined;
  when: ReactNode;
}>): JSX.Element {
  if (noForecast !== undefined) {
    return (
      <>
        <NoForecastCard when={when} />
        <CallHeading verb={header.verb} chip={noForecast} />
      </>
    );
  }
  if (header.body !== undefined) {
    return (
      <>
        <BorrowedField title={header.title} body={header.body} />
        <CallHeading verb={header.verb} />
      </>
    );
  }
  return <CallHeading verb={header.verb} chip={header.title} when={when} />;
}

/**
 * The verb the kit is introduced with, as the screen's one `h1`
 * (Accessibility Contract 04: the Archivo Black headline), under the hour
 * line and over the confidence chip.
 *
 * The chip is ink on paper for PROBABLE as for CONFIDENT (Round 62,
 * 363.1): a MONO.xs line in a hairline-weight ink box that hugs it.
 */
function CallHeading({
  verb,
  chip,
  when,
}: Readonly<{
  verb: string;
  chip?: Line | undefined;
  when?: ReactNode;
}>): JSX.Element {
  return (
    <div data-part="heading" className="flex flex-col gap-2">
      <WhenLine when={when} />
      <h1 className="m-0 font-display text-display">{verb}</h1>
      <ConfidenceChip line={chip} />
    </div>
  );
}

function ConfidenceChip({
  line,
}: Readonly<{ line: Line | undefined }>): JSX.Element | undefined {
  if (line === undefined) return undefined;
  return (
    <Mono step="xs" className="self-start border border-ink px-2 py-1">
      <DrawnLine line={line} />
    </Mono>
  );
}

/**
 * C1b's BORROWED CALL field (Round 62, 363.1 and 363.3): the one header
 * that is hi-viz on ink, because it is the app saying whose runs the Call
 * leans on. The title in MONO.xs, then the body's sentence; the body names
 * a band, so it is drawn one way and said another. No place, altitude or
 * UV: the Call is at home.
 */
function BorrowedField({
  title,
  body,
}: Readonly<{ title: Line; body: Line }>): JSX.Element {
  return (
    <div
      data-ground="ink"
      data-part="borrowed"
      className="flex flex-col gap-2 bg-ground p-4 text-hiviz-text"
    >
      <Mono step="xs">
        <DrawnLine line={title} />
      </Mono>
      <p className="m-0 text-body">
        <Spoken shown={body.shown} said={body.said} />
      </p>
    </div>
  );
}

/**
 * C0a with no forecast (Round 62, 366.3): a card saying so, the hour line
 * on it, NO FORECAST FOR THIS HOUR in MONO.sm and the one sentence. It
 * holds no forecast and no reading, so it carries no weather credit.
 */
function NoForecastCard({ when }: Readonly<{ when?: ReactNode }>): JSX.Element {
  return (
    <div
      data-part="no-forecast"
      className="flex flex-col gap-2 rounded-card border border-hairline bg-panel p-4"
    >
      <WhenLine when={when} />
      <Mono step="sm">{SCREEN_WORDS.noForecast}</Mono>
      <p className="m-0 text-small text-quiet">{SCREEN_WORDS.noForecastBody}</p>
    </div>
  );
}
