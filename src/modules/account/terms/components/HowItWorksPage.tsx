import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import type { ComponentType, JSX } from "react";

import { ACTION_PILL, Mono, Wordmark } from "../../../../ui";
import type { BellState } from "../../../notifications";
import {
  COMING_NEXT,
  GUIDES,
  GUIDES_LEAD,
  INVITE_ONLY,
  LEAD,
  LOOP_CLOSE,
  OTHERS,
  PAGE_TITLE,
  QUESTIONS,
  SECTIONS,
  STEPS,
  WORDMARK,
} from "../how-it-works-copy";
import type { Inline } from "../how-it-works-copy";
import { ReadingFrame, ReadingSection, ReadingShell } from "./ReadingFrame";

/**
 * `/how-it-works` (M4; Round 53 · 163a–e; #523): the owner's copy on the
 * legal reading layout, for anyone, signed in or not. Settings › Privacy's
 * "How the guides are made" lands on `#totals`.
 */
export function HowItWorksPage({
  bellState,
  bell,
}: Readonly<{
  /**
  The bell's counts for a signed-in reader; absent for a signed-out one.
  */
  bellState: BellState | undefined;
  /**
  The bell for the signed-in shell, given its counts (the route's to wire).
  */
  bell: ComponentType<BellState>;
}>): JSX.Element {
  const [loop, others, inviteOnly, totals, questions] = SECTIONS;
  return (
    <ReadingShell bellState={bellState} bell={bell}>
      <ReadingFrame title={PAGE_TITLE} contents={SECTIONS}>
        <p className="m-0">
          <Inlines inlines={LEAD} />
        </p>
        <ReadingSection id={loop.id} heading={loop.title} ruled>
          <Loop />
        </ReadingSection>
        <ReadingSection id={others.id} heading={others.title} ruled>
          <p className="m-0">{OTHERS}</p>
        </ReadingSection>
        <ReadingSection id={inviteOnly.id} heading={inviteOnly.title} ruled>
          <p className="m-0">{INVITE_ONLY}</p>
        </ReadingSection>
        <ReadingSection id={totals.id} heading={totals.title} ruled>
          <p className="m-0">{GUIDES_LEAD}</p>
          <Guides />
        </ReadingSection>
        <ReadingSection id={questions.id} heading={questions.title} ruled>
          <Questions />
        </ReadingSection>
        <ClosingAsk />
      </ReadingFrame>
    </ReadingShell>
  );
}

/**
 * 163a: an ordered list under an ink rule, MONO 01–04 in a 56 column (36
 * below the desk), each bold lead running into its sentence, hairlines
 * between. The number is drawn, not said: the list already counts.
 */
function Loop(): JSX.Element {
  return (
    <>
      <ol
        data-part="loop"
        className="m-0 flex list-none flex-col border-t border-ink p-0"
      >
        {STEPS.map((step, index) => (
          <li key={step.lead} className={STEP_CLASS}>
            <Mono step="md" className="text-muted">
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
            </Mono>
            <p className="m-0">
              <strong>{step.lead}</strong> {step.body}
            </p>
          </li>
        ))}
      </ol>
      <p className="m-0">{LOOP_CLOSE}</p>
      {/* 163a: a promise reads apart from what is built today. */}
      <p data-part="coming-next" className="m-0 bg-panel px-4 py-3">
        <strong>Coming next:</strong> <Inlines inlines={COMING_NEXT} />
      </p>
    </>
  );
}

const STEP_CLASS =
  "grid grid-cols-[36px_minmax(0,1fr)] items-baseline gap-x-3 border-b border-hairline py-3 desk:grid-cols-[56px_minmax(0,1fr)]";

/**
 * 163b: a description list under the same rules, its terms MONO.xs
 * capitals in a 160 column on the desk, stacked above their definitions
 * on the phone.
 */
function Guides(): JSX.Element {
  return (
    <dl
      data-part="guides"
      className="m-0 flex flex-col border-t border-ink p-0"
    >
      {GUIDES.map((entry) => (
        <div key={entry.term} className={GUIDE_ROW_CLASS}>
          <dt>
            <Mono step="xs" className="text-ink uppercase">
              {entry.term}
            </Mono>
          </dt>
          <dd className="m-0">{entry.definition}</dd>
        </div>
      ))}
    </dl>
  );
}

const GUIDE_ROW_CLASS =
  "flex flex-col gap-1 border-b border-hairline py-3 desk:grid desk:grid-cols-[160px_minmax(0,1fr)] desk:gap-x-4";

/**
 * 163c: each question an h3 with its answer always open, no disclosure.
 */
function Questions(): JSX.Element {
  return (
    <>
      {QUESTIONS.map((entry) => (
        <div key={entry.question} className="flex flex-col gap-2">
          <h3 className="m-0 font-display text-heading">{entry.question}</h3>
          <p className="m-0">
            <Inlines inlines={entry.answer} />
          </p>
        </div>
      ))}
    </>
  );
}

/**
 * 163d: the page ends on the pink pill (R61·334.1's one size, which
 * supersedes 163d's 52), as wide as the column below the desk; below 720
 * the bar holds only the pill, so Log in sits under it.
 */
function ClosingAsk(): JSX.Element {
  return (
    <div data-part="closing-ask" className="mt-8 flex flex-col gap-3">
      <Link to="/account/request-access" className={CLOSING_PILL_CLASS}>
        Request access
      </Link>
      <p className="m-0 text-body text-quiet wide:hidden">
        Have an account?{" "}
        <Link
          data-target="inline"
          to="/auth/login"
          className="font-bold text-ink underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

const CLOSING_PILL_CLASS = `target ${ACTION_PILL} self-stretch no-underline desk:self-start`;

/**
A run of copy: text, with its wordmarks drawn, or an underlined ink link.
*/
function Inlines({
  inlines,
}: Readonly<{ inlines: readonly Inline[] }>): JSX.Element {
  return (
    <>
      {inlines.map((inline, index) =>
        typeof inline === "string" ? (
          <WithWordmarks key={index} text={inline} />
        ) : (
          <a
            key={index}
            href={inline.href}
            data-target="inline"
            className="text-ink underline underline-offset-4"
          >
            {inline.text}
          </a>
        ),
      )}
    </>
  );
}

/**
Text with each written `[dialed.run]` drawn as the bracketed lockup.
*/
function WithWordmarks({ text }: Readonly<{ text: string }>): JSX.Element {
  return (
    <>
      {text.split(WORDMARK).map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <Wordmark />}
          {part}
        </Fragment>
      ))}
    </>
  );
}
