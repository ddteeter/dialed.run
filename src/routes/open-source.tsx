import { createFileRoute } from "@tanstack/react-router";

import { OpenSourcePage } from "../modules/account/components/OpenSourcePage";
import { openSourcePageLoader } from "../modules/account/functions";
import { NotificationBell } from "../modules/notifications/components/NotificationBell";

/**
 * The open-source notices (plan C9; round 29 #9; D-137): every package and
 * typeface the app ships, grouped by licence, and the third-party notices,
 * on the legal reading page, for anyone, signed in or not. The marketing
 * site links here.
 */
export const Route = createFileRoute("/open-source")({
  loader: () => openSourcePageLoader(),
  component: () => (
    <OpenSourcePage {...Route.useLoaderData()} bell={NotificationBell} />
  ),
});
