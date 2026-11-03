import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { startVitalsReporter } from "../lib/browser/vitals";

/**
 * Starts the speed reporter (design 165, `lib/browser/vitals`) once the
 * page is live, and stops it if the router is replaced. Renders nothing:
 * an effect never runs on the server, so nothing is measured there.
 */
export function VitalsReporter(): undefined {
  const router = useRouter();
  useEffect(() => startVitalsReporter(router), [router]);
}
