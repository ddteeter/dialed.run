/**
 * O1's chosen-city chip names a place as R55·228 rules: "city, region,
 * country. The region is its postal abbreviation where one exists
 * ('MINNEAPOLIS, MN, UNITED STATES') and its name otherwise. County and
 * district are always dropped."
 *
 * The provider answers with one comma-separated string and nothing more
 * (`ResolvedPlace.address`, Visual Crossing's resolved address): sometimes
 * "Minneapolis, MN, United States", sometimes "Minneapolis, Hennepin
 * County, Minnesota, United States". So the parts are read by position —
 * the first is the city, the last the country, the one before the country
 * the region — once any county or district is out of the way, and a
 * region's name becomes its postal abbreviation from the tables below,
 * for the countries that have them.
 *
 * Only the chip's words: what is saved, and what Your conditions shows,
 * stay the provider's.
 */

/**
A county, a district, or the like: never part of the chip's name.
*/
const DROPPED_PART = /\b(?:county|district)\b/iu;

const US_STATES: Readonly<Record<string, string>> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  // No District of Columbia: a district is dropped before a region is
  // read, so Washington, DC reads "Washington, United States".
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "puerto rico": "PR",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const CANADIAN_PROVINCES: Readonly<Record<string, string>> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  "northwest territories": "NT",
  "nova scotia": "NS",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  québec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

const AUSTRALIAN_STATES: Readonly<Record<string, string>> = {
  "australian capital territory": "ACT",
  "new south wales": "NSW",
  "northern territory": "NT",
  queensland: "QLD",
  "south australia": "SA",
  tasmania: "TAS",
  victoria: "VIC",
  "western australia": "WA",
};

/**
Which table a country's regions are abbreviated from, by the country's name.
*/
const POSTAL_REGIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "united states": US_STATES,
  "united states of america": US_STATES,
  usa: US_STATES,
  canada: CANADIAN_PROVINCES,
  australia: AUSTRALIAN_STATES,
};

/**
 * The region as the chip says it: its postal abbreviation where the
 * country has one for it, and its own name otherwise (an abbreviation the
 * provider already gave is a name no table holds, so it stays).
 */
function regionFor(region: string, country: string): string {
  const table = POSTAL_REGIONS[country.toLowerCase()];
  return table?.[region.toLowerCase()] ?? region;
}

/**
 * "Minneapolis, Hennepin County, Minnesota, United States" → "Minneapolis,
 * MN, United States". A name with no region keeps what it has.
 */
export function chipPlaceName(address: string): string {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !DROPPED_PART.test(part));
  if (parts.length < 3) return parts.join(", ");
  const country = parts.slice(-1).join("");
  return [
    ...parts.slice(0, 1),
    ...parts.slice(-2, -1).map((region) => regionFor(region, country)),
    country,
  ].join(", ");
}
