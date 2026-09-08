/**
 * dialed.run — form primitives (the whole §Forms & Failure contract)
 *
 * One schema, run twice. One live region, one sentence per outcome.
 * Errors are marked, not reddened, and they do not animate — see motion.ts,
 * "Offline / error: nothing, deliberately static".
 *
 * No new dependency: React + zod, both already here.
 */

import * as React from 'react';
import { z } from 'zod';
import { DURATION } from './motion';

/* ------------------------------------------------------------------ tokens */

const INK = '#0B0B0E';
const PAPER = '#F4F3EF';
const RULE = '#DCDBD2';
const RULE_INK = '#2A2A31';
const MUTE = '#7A7A70';
const MARK = '#F5FF3D'; // the error band. never #FF2D8A — pink is action.

type Surface = 'paper' | 'ink';
const SurfaceCtx = React.createContext<Surface>('paper');

const sans = 'Archivo, Helvetica, sans-serif';
const black = "'Archivo Black', Helvetica, sans-serif";

/* ------------------------------------------------------------------- types */

export type FieldErrors = Record<string, string>;

export type FormFailure =
  | { kind: 'network'; message: string }
  | { kind: 'server'; message: string }
  | { kind: 'session'; message: string };

/** The only shape a server function may return. Form-level trouble throws. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: FieldErrors };

/** First issue per field. A field shows one message, never a stack. */
export function toFieldErrors(err: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.');
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

function isZodError(e: unknown): e is z.ZodError {
  return !!e && typeof e === 'object' && 'issues' in (e as any) && Array.isArray((e as any).issues);
}

function classifyFailure(e: unknown): FormFailure {
  const msg = String((e as any)?.message ?? '');
  if (!navigator.onLine || /fetch|network|load failed/i.test(msg))
    return { kind: 'network', message: 'Your connection dropped.' };
  if (/401|403|session|unauthenticated/i.test(msg))
    return { kind: 'session', message: 'You were signed out.' };
  return { kind: 'server', message: 'Our end failed. Nothing changed.' };
}

/* -------------------------------------------------------------- useFormSubmit */

type UseFormSubmit<T> = {
  schema: z.ZodTypeAny;
  /** Server function. Validates with the SAME schema at the trust boundary. */
  action: (values: any) => Promise<ActionResult<T>>;
  onSuccess?: (data: T) => void;
  /** Live-region sentence on success, e.g. "Run logged." */
  successMessage?: string;
  /** Field name -> human label, for the summary rows. */
  labels?: Record<string, string>;
};

export function useFormSubmit<T>({ schema, action, onSuccess, successMessage, labels }: UseFormSubmit<T>) {
  const [pending, setPending] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [failure, setFailure] = React.useState<FormFailure | null>(null);
  const [status, setStatus] = React.useState('');
  const summaryRef = React.useRef<HTMLDivElement>(null);
  const retryRef = React.useRef<HTMLButtonElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const inFlight = React.useRef(false);
  const lastValues = React.useRef<any>(null);

  const focusField = React.useCallback((name: string) => {
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`);
    el?.focus({ preventScroll: false });
  }, []);

  const land = React.useCallback(
    (errors: FieldErrors) => {
      const names = Object.keys(errors);
      setFieldErrors(errors);
      setFailure(null);
      setStatus(
        names.length === 1
          ? 'Nothing saved. One field needs a fix.'
          : `Nothing saved. ${names.length} fields need a fix.`
      );
      // Announce, then move. Never move without announcing.
      window.setTimeout(() => {
        if (names.length === 1) focusField(names[0]);
        else summaryRef.current?.focus();
      }, DURATION.instant);
    },
    [focusField]
  );

  const submit = React.useCallback(
    async (values: any) => {
      if (inFlight.current) return; // double-submit dies here, not on a disabled attr
      inFlight.current = true;
      lastValues.current = values;
      setFailure(null);
      setStatus('');

      // Courtesy pre-check. Same schema object as the server's gate.
      const pre = schema.safeParse(values);
      if (!pre.success) {
        inFlight.current = false;
        land(toFieldErrors(pre.error));
        return;
      }

      setPending(true);
      try {
        const res = await action(pre.data);
        if (res.ok) {
          setFieldErrors({});
          setStatus(successMessage ?? 'Saved.');
          onSuccess?.(res.data);
        } else {
          land(res.fieldErrors);
        }
      } catch (e) {
        // A thrown ZodError is still a field failure — the server is the gate.
        if (isZodError(e)) {
          land(toFieldErrors(e));
        } else {
          const f = classifyFailure(e);
          setFieldErrors({});
          setFailure(f);
          setStatus(`Nothing saved. ${f.message}`);
          window.setTimeout(() => retryRef.current?.focus(), DURATION.instant);
        }
      } finally {
        setPending(false);
        inFlight.current = false;
      }
    },
    [schema, action, onSuccess, successMessage, land]
  );

  /** Errors clear on input, never on blur, with no re-validation. */
  const clearField = React.useCallback((name: string) => {
    setFieldErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  /** Spread onto the control. Carries invalid state, description and readOnly. */
  const field = React.useCallback(
    (name: string) => ({
      name,
      readOnly: pending,
      'aria-invalid': fieldErrors[name] ? (true as const) : undefined,
      'aria-describedby': fieldErrors[name] ? `${name}-message` : undefined,
      onInput: () => clearField(name),
    }),
    [pending, fieldErrors, clearField]
  );

  const summaryRows = Object.keys(fieldErrors).map((name) => ({
    name,
    label: labels?.[name] ?? name,
    message: fieldErrors[name],
  }));

  return {
    formRef,
    submit,
    pending,
    fieldErrors,
    failure,
    status,
    summaryRows,
    summaryRef,
    retryRef,
    field,
    focusField,
    retry: () => lastValues.current && submit(lastValues.current),
  };
}

/* ------------------------------------------------------------------ FormStatus */

/** Exactly one per form. Permanently mounted, or it announces nothing. */
export function FormStatus({ children }: { children?: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- FormField */

export function FormField({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const surface = React.useContext(SurfaceCtx);
  const onInk = surface === 'ink';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label
        htmlFor={name}
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: onInk ? '#8B8B93' : MUTE,
        }}
      >
        {label}
      </label>

      {/* The mark is border WEIGHT, not hue. Never color-only. */}
      <div
        data-invalid={error ? 'true' : undefined}
        style={{
          border: error
            ? `2px solid ${onInk ? PAPER : INK}`
            : `1px solid ${onInk ? RULE_INK : RULE}`,
          borderRadius: 8,
          padding: error ? '11px 13px' : '12px 14px',
          background: onInk ? INK : PAPER,
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {children}
      </div>

      {hint && !error ? (
        <span style={{ fontFamily: sans, fontSize: 12, lineHeight: 1.4, color: onInk ? '#8B8B93' : MUTE }}>
          {hint}
        </span>
      ) : null}

      {/* Not a live region — FormStatus does the announcing. No transition. */}
      {error ? (
        <span
          id={`${name}-message`}
          style={{
            background: MARK,
            color: INK,
            fontFamily: sans,
            fontSize: 13,
            lineHeight: 1.35,
            padding: '7px 10px',
            alignSelf: 'flex-start',
          }}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ FormErrorSummary */

/** Renders only at 2+ field errors. One error focuses its field instead. */
export function FormErrorSummary({
  rows,
  onFocusField,
  summaryRef,
}: {
  rows: { name: string; label: string; message: string }[];
  onFocusField: (name: string) => void;
  summaryRef: React.RefObject<HTMLDivElement>;
}) {
  const onInk = React.useContext(SurfaceCtx) === 'ink';
  if (rows.length < 2) return null;
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      style={{
        border: `1px solid ${onInk ? PAPER : INK}`,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        outline: 'none',
      }}
    >
      <span style={{ fontFamily: black, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        Nothing saved
      </span>
      <span style={{ fontFamily: sans, fontSize: 15, lineHeight: 1.4 }}>
        {rows.length} fields need a fix.
      </span>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <li key={r.name}>
            <button
              type="button"
              onClick={() => onFocusField(r.name)}
              style={{
                appearance: 'none',
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                fontFamily: sans,
                fontSize: 14,
                color: 'inherit',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {r.label} — {r.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------ FormFailureBand */

/** Sits directly above the submit button. No yellow: the fix is not in the form. */
export function FormFailureBand({
  failure,
  onRetry,
  retryRef,
}: {
  failure: FormFailure | null;
  onRetry: () => void;
  retryRef?: React.RefObject<HTMLButtonElement>;
}) {
  const onInk = React.useContext(SurfaceCtx) === 'ink';
  if (!failure) return null;
  return (
    <div
      style={{
        border: `1px solid ${onInk ? PAPER : INK}`,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <span style={{ fontFamily: black, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        Nothing saved
      </span>
      <span style={{ fontFamily: sans, fontSize: 15, lineHeight: 1.4 }}>{failure.message}</span>
      <button
        ref={retryRef}
        type="button"
        onClick={onRetry}
        style={{
          appearance: 'none',
          border: `1px solid ${onInk ? PAPER : INK}`,
          background: onInk ? PAPER : INK,
          color: onInk ? INK : PAPER,
          fontFamily: sans,
          fontWeight: 700,
          fontSize: 14,
          padding: '10px 16px',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- SubmitButton */

/**
 * Never `disabled` — aria-disabled + the handler guard. Never resizes: both
 * labels occupy one grid cell. Pending = brackets breathing, the one waiting
 * device in the product.
 */
export function SubmitButton({
  label,
  pendingLabel,
  pending,
  onClick,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="submit"
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={onClick}
      style={{
        appearance: 'none',
        border: 'none',
        borderRadius: 10,
        background: '#FF2D8A',
        color: INK,
        fontFamily: black,
        fontSize: 16,
        letterSpacing: '-0.01em',
        textTransform: 'uppercase',
        padding: '16px 24px',
        minHeight: 52,
        cursor: pending ? 'default' : 'pointer',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {/* Both labels stacked in one cell so width never jumps. */}
      <span style={{ display: 'grid', placeItems: 'center' }}>
        <span style={{ gridArea: '1 / 1', visibility: pending ? 'hidden' : 'visible' }}>{label}</span>
        <span
          style={{ gridArea: '1 / 1', visibility: pending ? 'visible' : 'hidden', display: 'flex', gap: '0.4em' }}
        >
          <span className="dr-breathe" aria-hidden="true">[</span>
          {pendingLabel}
          <span className="dr-breathe" aria-hidden="true">]</span>
        </span>
      </span>
    </button>
  );
}

/**
 * Global CSS this file needs. Inject once at app root.
 * Reduced motion: brackets go static, per motion.ts REDUCED_MOTION.
 */
export const FORM_CSS = `
@keyframes dr-breathe { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
.dr-breathe { animation: dr-breathe 900ms linear infinite; }
@media (prefers-reduced-motion: reduce) { .dr-breathe { animation: none; opacity: 1 } }
`;

export function FormSurface({ surface, children }: { surface: Surface; children: React.ReactNode }) {
  return <SurfaceCtx.Provider value={surface}>{children}</SurfaceCtx.Provider>;
}
