/**
 * The speed beacon (design 165, part 1): `POST /api/vitals` takes what the
 * browser measured and writes it to the `VITALS` dataset, one data point
 * per metric, in this layout:
 *
 * - index1: the route id, which is what Analytics Engine samples by, so a
 *   busy screen cannot crowd a quiet one out of the sample;
 * - blob1–4: metric, navigation type, device width, deploy version;
 * - double1: the value; double2–5: the metric's attribution parts, in
 *   `VITAL_METRICS`' order.
 *
 * `vitals-queries.ts` reads them back by these positions; the layout test
 * pins the two together.
 */
import { env } from "../../env";
import {
  vitalsPayloadSchema,
  type VitalsPayload,
} from "../../lib/contracts/vitals";
import { readCappedText } from "../../lib/read-capped";
import { captureException } from "./sentry";

export function toDataPoints(
  payload: VitalsPayload,
  version: string,
): AnalyticsEngineDataPoint[] {
  return payload.metrics.map((metric) => ({
    indexes: [payload.route],
    blobs: [metric.name, payload.navigationType, payload.device, version],
    doubles: [metric.value, ...metric.parts],
  }));
}

/**
 * The largest body read. Twenty metrics with their parts are about 1.5 KB.
 */
export const MAX_VITALS_BYTES = 4096;

/**
 * Why a beacon was dropped. Counted in a log line, never stored: the
 * endpoint is public, so this is how a flood or a broken client shows up
 * in Workers Logs without its contents reaching anything.
 */
export type VitalsRefusal =
  | "cross-site"
  | "too-large"
  | "not-json"
  | "invalid"
  | "unreadable"
  | "write-failed";

export interface VitalsRefusalLine {
  readonly kind: "vitals-refused";
  readonly reason: VitalsRefusal;
}

export interface VitalsDeps {
  readonly write: (point: AnalyticsEngineDataPoint) => void;
  /**
   * The running deploy, stamped by the server rather than claimed by the
   * client, so a regression can be pinned to the deploy that caused it.
   */
  readonly version: string;
  readonly log: (line: VitalsRefusalLine) => void;
  readonly report: (error: unknown) => void;
}

/**
 * Takes one beacon. Always answers 204, whatever happens, so a probe
 * learns nothing; what went wrong goes to the log instead.
 *
 * Only a same-origin request is read: `sendBeacon` from our own page
 * carries `Sec-Fetch-Site: same-origin`, and a form or script elsewhere
 * cannot forge it. A browser too old to send the header is not measured,
 * which costs a sliver of the sample and nothing else.
 */
export async function receiveVitals(
  request: Request,
  deps: VitalsDeps,
): Promise<Response> {
  const refusal = await recordVitals(request, deps);
  if (refusal !== undefined)
    deps.log({ kind: "vitals-refused", reason: refusal });
  return new Response(undefined, { status: 204 });
}

async function recordVitals(
  request: Request,
  deps: VitalsDeps,
): Promise<VitalsRefusal | undefined> {
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return "cross-site";
  }
  let payload: VitalsPayload;
  try {
    payload = await readPayload(request);
  } catch (error) {
    // Anything else is a body that broke while being read: a client gone
    // mid-send, which is the stranger's problem, not an alert.
    return error instanceof VitalsRefusedError ? error.reason : "unreadable";
  }
  try {
    for (const point of toDataPoints(payload, deps.version)) {
      deps.write(point);
    }
  } catch (error) {
    // A parsed payload always fits the dataset, so a throw here is the
    // binding itself failing: worth an alert, never worth a 500 (law 5).
    deps.report(error);
    return "write-failed";
  }
  return undefined;
}

/**
 * A beacon refused on its contents, carrying why. It never leaves this
 * file, `recordVitals` reads only `reason`, so it has no message.
 */
class VitalsRefusedError extends Error {
  readonly reason: VitalsRefusal;

  constructor(reason: VitalsRefusal) {
    super();
    this.reason = reason;
  }
}

/**
 * The body, read under the cap and parsed, or a `VitalsRefusedError`
 * naming the first rule it broke.
 */
async function readPayload(request: Request): Promise<VitalsPayload> {
  const body = await readCappedText(
    request,
    MAX_VITALS_BYTES,
    () => new VitalsRefusedError("too-large"),
  );
  const parsed = vitalsPayloadSchema.safeParse(parseJson(body));
  if (!parsed.success) throw new VitalsRefusedError("invalid");
  return parsed.data;
}

/**
 * Parsed JSON as `unknown`; the schema is what gives it a type.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new VitalsRefusedError("not-json");
  }
}

/**
 * The real dataset, deploy version, log and Sentry. `bindings` is a
 * parameter so the reading of each can be tested.
 */
export function vitalsDepsFromEnv(
  bindings: Readonly<{
    VITALS: Pick<AnalyticsEngineDataset, "writeDataPoint">;
    CF_VERSION_METADATA: Pick<WorkerVersionMetadata, "id">;
  }> = env,
): VitalsDeps {
  return {
    write: (point) => {
      bindings.VITALS.writeDataPoint(point);
    },
    version: bindings.CF_VERSION_METADATA.id,
    log: (line) => {
      console.log(line);
    },
    report: (error) => {
      captureException(error, { surface: "vitals" });
    },
  };
}
