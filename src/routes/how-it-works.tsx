import { createFileRoute } from "@tanstack/react-router";

import { howItWorksPageLoader } from "../modules/account/functions";
import { HowItWorksPage } from "../modules/account/terms/components/HowItWorksPage";
import { NotificationBell } from "../modules/notifications/components/NotificationBell";

/**
 * How it works (M4; Round 53 · 163; #523): the owner's copy on the legal
 * reading layout, for anyone, signed in or not. Settings › Privacy's "How
 * the guides are made" lands on `#totals`.
 */
export const Route = createFileRoute("/how-it-works")({
  loader: () => howItWorksPageLoader(),
  component: () => (
    <HowItWorksPage {...Route.useLoaderData()} bell={NotificationBell} />
  ),
});
