import type { JSX } from "react";

import { Mono, WeatherAttribution } from "../../../ui";
import { ProductLink } from "../../../ui/ProductLink";
import type { PublicKit, PublicPiece } from "../public-kit-shape";

import { PhotoPager } from "./PhotoPager";
import {
  Invite,
  PieceSection,
  RunnerFrame,
  type OpenWebPageProps,
  VerdictChip,
} from "./PublicFrame";

/**
 * The open web's kit (round 41 #86c) and its not-public twin (#86f):
 * `/k/<id>`, for anyone, signed in or not, in the frame every public page
 * wears (`PublicFrame`). No Useful, follow or comment, signed in or not.
 */

/**
 * `/k/<id>` for a public kit (round 41 #86c). Order: who and which day,
 * the photo when it has one, conditions and verdict, the four stats, the
 * caption, the kit, the credit, the pitch, the foot. The photos are D's
 * pager, served from the public bucket (D-152, design 161 step 8), with
 * no delete: nobody owns anything on the open web's page.
 *
 * `origin` is where the page lives, for the link Report this kit hands
 * `/takedown`: the route's, so the server's page and the browser's agree.
 */
export function PublicKitPage({
  kit,
  ...frame
}: OpenWebPageProps<{ kit: PublicKit }>): JSX.Element {
  return (
    <RunnerFrame
      {...frame}
      page={{ entryId: kit.entryId }}
      handle={kit.handle}
      headingClassName="m-0 text-body font-semibold"
      beside={
        <Mono step="xs" className="text-muted">
          {kit.day}
        </Mono>
      }
    >
      {(isSignedIn) => (
        <>
          <PhotoPager
            photoKeys={kit.photos ?? []}
            deletePhoto={undefined}
            srcOf={servedAsIs}
          />
          <Conditions kit={kit} />
          <Stats kit={kit} />
          {kit.caption === undefined ? undefined : (
            <p data-part="caption" className="m-0 text-lead">
              {kit.caption}
            </p>
          )}
          <Pieces pieces={kit.pieces} />
          {kit.conditions?.isProviders === true ? (
            <WeatherAttribution />
          ) : undefined}
          {isSignedIn ? undefined : <Invite />}
        </>
      )}
    </RunnerFrame>
  );
}

/**
A public photo's URL is already where it is served.
*/
function servedAsIs(url: string): string {
  return url;
}

/**
 * Feels-like and sky in TYPE.display — the measured word teal, as teal
 * always means measured conditions — beside the verdict's chip in its T2
 * hue, captioned FEELS LIKE · SKY. A kit with no conditions shows the chip
 * alone; one with neither shows nothing.
 */
function Conditions({ kit }: Readonly<{ kit: PublicKit }>) {
  const { conditions, verdict } = kit;
  if (conditions === undefined && verdict === undefined) return;
  return (
    <div data-part="conditions" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {conditions === undefined ? undefined : (
          <span className="font-display text-display uppercase">
            {conditions.feelsLike}{" "}
            <span className="text-dialed-text">{conditions.sky}</span>
          </span>
        )}
        <VerdictChip verdict={verdict} />
      </div>
      {conditions === undefined ? undefined : (
        <Mono step="xs" className="text-muted">
          Feels like · Sky
        </Mono>
      )}
    </div>
  );
}

/**
 * The four stats as round 41 draws them: the number in MONO.lg, its word
 * under it in MONO.xs. Moving time is named for what it is: "moving" when
 * the file measured it, "time" when the run's own clock is all there is.
 */
function Stats({ kit }: Readonly<{ kit: PublicKit }>) {
  const stats = [
    kit.distance,
    {
      value: kit.time.value,
      unit: kit.time.isMoving ? "moving" : "time",
    },
    ...(kit.pace === undefined ? [] : [kit.pace]),
    ...(kit.gain === undefined
      ? []
      : [{ value: kit.gain.value, unit: `${kit.gain.unit} gain` }]),
  ];
  return (
    <dl data-part="stats" className="m-0 grid grid-cols-4 gap-3">
      {stats.map((stat) => (
        <div key={stat.unit} className="flex flex-col-reverse gap-1">
          <dt>
            <Mono step="xs" className="text-muted">
              {stat.unit}
            </Mono>
          </dt>
          <dd className="m-0">
            <Mono step="lg">{stat.value}</Mono>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * THE KIT · N: each piece by its closet name, a linked one opening its
 * product in a new tab through the one outbound product link (which shows
 * the domain beside it), and what kind of piece it is. Absent with none.
 */
function Pieces({ pieces }: Readonly<{ pieces: readonly PublicPiece[] }>) {
  return (
    <PieceSection
      title="The kit"
      level={2}
      pieces={pieces}
      itemClassName="flex items-baseline justify-between gap-3 border-b border-hairline pb-2 text-body"
      row={(piece) => (
        <>
          {piece.url === undefined ? (
            <span className="text-ink">{piece.name}</span>
          ) : (
            <ProductLink url={piece.url} label={piece.name} />
          )}
          <Mono step="xs" className="shrink-0 text-muted">
            {piece.kind}
          </Mono>
        </>
      )}
    />
  );
}
