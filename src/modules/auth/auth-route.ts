/**
 * `/api/auth/*`'s handler: Better Auth, for a path it serves
 * (`./auth-paths`, SA-M36). The paths are read from the instance's own
 * endpoints once, on the first request, not restated, and a
 * parameterised path's values from its options.
 */
import {
  answerAuthRequest,
  authPathMatcher,
  endpointPaths,
  providerSegments,
} from "./auth-paths";
import { auth } from "./instance";

const matcher: { isAuthPath?: (path: string) => boolean } = {};

export function authRequest(request: Request): Promise<Response> {
  matcher.isAuthPath ??= authPathMatcher(
    endpointPaths(auth.api),
    providerSegments(auth.options),
  );
  return answerAuthRequest(request, matcher.isAuthPath, (served) =>
    auth.handler(served),
  );
}
