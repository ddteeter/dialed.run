/**
 * Turnstile's action name for each in-app form (SA-L07): the widget sends
 * it, Cloudflare's answer carries it back, and the server refuses a token
 * solved for another form. One list, so the widget and the check cannot
 * name two different things.
 */
export const TURNSTILE_ACTIONS = {
  signUp: "sign-up",
  requestAccess: "request-access",
  takedown: "takedown",
} as const;

export type TurnstileAction =
  (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
