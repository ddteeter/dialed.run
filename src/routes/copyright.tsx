import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "../modules/account/components/LegalPage";
import { legalPageLoader } from "../modules/account/functions";
import { NotificationBell } from "../modules/notifications/components/NotificationBell";

/**
 * The copyright and DMCA notice (task 126, ACC-13; round 27 #12; D-52):
 * the owner's text from `docs/legal/copyright.md`, on `/privacy`'s
 * reading page, for anyone, signed in or not. X1 until the owner marks the
 * text published (`account/legal.ts`; D-81: the links show meanwhile).
 */
export const Route = createFileRoute("/copyright")({
  loader: () => legalPageLoader("copyright"),
  component: () => (
    <LegalPage {...Route.useLoaderData()} bell={NotificationBell} />
  ),
});
