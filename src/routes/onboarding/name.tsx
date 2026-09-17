import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { requireSession } from "../../modules/auth/functions";
import { NamePieces } from "../../modules/onboarding/components/NamePieces";
import {
  nameGarmentFn,
  namingOfferQuery,
  namingSuggestionsQuery,
} from "../../modules/onboarding/functions";
import { Page } from "../../ui";

/**
 * Screen P2.5 — "make them real" (design §AC), between the tap list and
 * P3. Skippable, never blocking, and it never reappears: the closet nudge
 * is the only follow-up.
 */
// fallow-ignore-next-line code-duplication -- two signed-in routes of one flow are the same shape by mandate: createFileRoute + requireSession + one loader call + Page + a component is exactly what server-functions-are-glue requires a route to be, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/onboarding/name")({
  loader: async () => {
    await requireSession();
    return { offer: await namingOfferQuery() };
  },
  component: NamePage,
});

function NamePage() {
  const { offer } = Route.useLoaderData();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<{
    brands: string[];
    models: string[];
  }>({ brands: [], models: [] });

  return (
    <Page title="Which ones do you actually reach for?" width="narrow">
      <NamePieces
        offer={offer}
        nameGarment={nameGarmentFn}
        brandOptions={suggestions.brands}
        modelOptions={suggestions.models}
        onBrandInput={(brand) => {
          void namingSuggestionsQuery({ data: { brand } }).then(setSuggestions);
        }}
        onDone={() => {
          void navigate({ to: "/onboarding/done" });
        }}
      />
    </Page>
  );
}
