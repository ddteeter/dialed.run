/**
 * A2b: the condition-filtered item picker shown when there is no
 * confident prefill. Groups the user's non-retired items by UI group with
 * a per-group match count; "match" means the item's own estimated temp
 * range (`est_temp_low_c`/`est_temp_high_c`) contains the run's feels-like
 * temperature. Items with no range recorded are `[UNTESTED]` — shown, not
 * hidden, per the packet.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { env } from "../../env";
import type { Conditions } from "./conditions";
import type { UiGroup } from "./groups";
import { uiGroupFor } from "./groups";

interface PickerItem {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  layer: string | null;
  matches: boolean;
  untested: boolean;
}

export interface PickerGroup {
  group: UiGroup;
  items: PickerItem[];
  matchCount: number;
  hiddenByFilterCount: number;
}

export async function pickerGroups(
  userId: string,
  conditions: Conditions | undefined,
): Promise<PickerGroup[]> {
  const database = drizzle(env.DIALED_CORE);
  const items = await database
    .select()
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.userId, userId), eq(wardrobeItems.retired, 0)));

  const byGroup = new Map<UiGroup, PickerItem[]>();
  for (const item of items) {
    const group = uiGroupFor(item.category, item.layer);
    const { estTempLowC, estTempHighC } = item;
    const hasRange = estTempLowC !== null && estTempHighC !== null;
    const isMatches =
      conditions === undefined || estTempLowC === null || estTempHighC === null
        ? true
        : estTempLowC <= conditions.tempC && conditions.tempC <= estTempHighC;
    const list = byGroup.get(group) ?? [];
    list.push({
      id: item.id,
      name: item.name,
      brand: item.brand,
      category: item.category,
      layer: item.layer,
      matches: isMatches,
      untested: !hasRange,
    });
    byGroup.set(group, list);
  }

  return [...byGroup].map(([group, groupItems]) => {
    const matching = groupItems.filter((i) => i.matches);
    const nonMatching = groupItems.filter((i) => !i.matches);
    return {
      group,
      items: [...matching, ...nonMatching],
      matchCount: matching.length,
      hiddenByFilterCount: nonMatching.length,
    };
  });
}
