import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "../modules/account/components/LegalPage";
import { legalPageLoader } from "../modules/account/functions";
import { NotificationBell } from "../modules/notifications/components/NotificationBell";

/**
 * The privacy policy (task 126, ACC-13; round 26 #14; D-52, R-105): the
 * owner's text from `docs/legal/privacy-policy.md`, for anyone, signed in
 * or not. X1 until that text is finished (`account/legal.ts`).
 */
export const Route = createFileRoute("/privacy")({
  loader: () => legalPageLoader("privacy"),
  component: () => (
    <LegalPage {...Route.useLoaderData()} bell={NotificationBell} />
  ),
});
