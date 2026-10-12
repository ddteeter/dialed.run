import { z } from "zod";

/**
 * Settings › Region (round 30 data requirement (d); D-108 A): a country,
 * plus a state or province where it applies. Optional and off by default,
 * used only to group anonymous totals ("what runners in Minnesota wear"),
 * and never shown on a profile or an entry.
 *
 * In `lib/contracts/` because both sides read it: the Settings form offers
 * these choices, and the writer parses what arrives against the same list.
 *
 * **Stored as ISO codes**: a country as ISO 3166-1 alpha-2 (`US`), a
 * subdivision as ISO 3166-2 (`US-MN`), so the subdivision names its own
 * country and a guide job can group on either without a lookup.
 *
 * **The tables are text, one `CODE Name` per line**, parsed once at load.
 * That is one literal for a reader to scan rather than five hundred, and
 * the names are the English short names (CLDR's), in the order the select
 * shows them.
 */

/**
One choice a region select offers: the stored code and the name shown.
*/
export interface RegionOption {
  readonly code: string;
  readonly name: string;
}

function table(lines: string): readonly RegionOption[] {
  return lines
    .trim()
    .split("\n")
    .map((line) => {
      const gap = line.indexOf(" ");
      return { code: line.slice(0, gap), name: line.slice(gap + 1) };
    });
}

/**
Every ISO 3166-1 country, by name.
*/
export const COUNTRIES: readonly RegionOption[] = table(`
AF Afghanistan
AX Åland Islands
AL Albania
DZ Algeria
AS American Samoa
AD Andorra
AO Angola
AI Anguilla
AQ Antarctica
AG Antigua & Barbuda
AR Argentina
AM Armenia
AW Aruba
AU Australia
AT Austria
AZ Azerbaijan
BS Bahamas
BH Bahrain
BD Bangladesh
BB Barbados
BY Belarus
BE Belgium
BZ Belize
BJ Benin
BM Bermuda
BT Bhutan
BO Bolivia
BA Bosnia & Herzegovina
BW Botswana
BV Bouvet Island
BR Brazil
IO British Indian Ocean Territory
VG British Virgin Islands
BN Brunei
BG Bulgaria
BF Burkina Faso
BI Burundi
KH Cambodia
CM Cameroon
CA Canada
CV Cape Verde
BQ Caribbean Netherlands
KY Cayman Islands
CF Central African Republic
TD Chad
CL Chile
CN China
CX Christmas Island
CC Cocos (Keeling) Islands
CO Colombia
KM Comoros
CG Congo - Brazzaville
CD Congo - Kinshasa
CK Cook Islands
CR Costa Rica
CI Côte d’Ivoire
HR Croatia
CU Cuba
CW Curaçao
CY Cyprus
CZ Czechia
DK Denmark
DJ Djibouti
DM Dominica
DO Dominican Republic
EC Ecuador
EG Egypt
SV El Salvador
GQ Equatorial Guinea
ER Eritrea
EE Estonia
SZ Eswatini
ET Ethiopia
FK Falkland Islands
FO Faroe Islands
FJ Fiji
FI Finland
FR France
GF French Guiana
PF French Polynesia
TF French Southern Territories
GA Gabon
GM Gambia
GE Georgia
DE Germany
GH Ghana
GI Gibraltar
GR Greece
GL Greenland
GD Grenada
GP Guadeloupe
GU Guam
GT Guatemala
GG Guernsey
GN Guinea
GW Guinea-Bissau
GY Guyana
HT Haiti
HM Heard & McDonald Islands
HN Honduras
HK Hong Kong SAR China
HU Hungary
IS Iceland
IN India
ID Indonesia
IR Iran
IQ Iraq
IE Ireland
IM Isle of Man
IL Israel
IT Italy
JM Jamaica
JP Japan
JE Jersey
JO Jordan
KZ Kazakhstan
KE Kenya
KI Kiribati
KW Kuwait
KG Kyrgyzstan
LA Laos
LV Latvia
LB Lebanon
LS Lesotho
LR Liberia
LY Libya
LI Liechtenstein
LT Lithuania
LU Luxembourg
MO Macao SAR China
MG Madagascar
MW Malawi
MY Malaysia
MV Maldives
ML Mali
MT Malta
MH Marshall Islands
MQ Martinique
MR Mauritania
MU Mauritius
YT Mayotte
MX Mexico
FM Micronesia
MD Moldova
MC Monaco
MN Mongolia
ME Montenegro
MS Montserrat
MA Morocco
MZ Mozambique
MM Myanmar (Burma)
NA Namibia
NR Nauru
NP Nepal
NL Netherlands
NC New Caledonia
NZ New Zealand
NI Nicaragua
NE Niger
NG Nigeria
NU Niue
NF Norfolk Island
KP North Korea
MK North Macedonia
MP Northern Mariana Islands
NO Norway
OM Oman
PK Pakistan
PW Palau
PS Palestinian Territories
PA Panama
PG Papua New Guinea
PY Paraguay
PE Peru
PH Philippines
PN Pitcairn Islands
PL Poland
PT Portugal
PR Puerto Rico
QA Qatar
RE Réunion
RO Romania
RU Russia
RW Rwanda
WS Samoa
SM San Marino
ST São Tomé & Príncipe
SA Saudi Arabia
SN Senegal
RS Serbia
SC Seychelles
SL Sierra Leone
SG Singapore
SX Sint Maarten
SK Slovakia
SI Slovenia
SB Solomon Islands
SO Somalia
ZA South Africa
GS South Georgia & South Sandwich Islands
KR South Korea
SS South Sudan
ES Spain
LK Sri Lanka
BL St. Barthélemy
SH St. Helena
KN St. Kitts & Nevis
LC St. Lucia
MF St. Martin
PM St. Pierre & Miquelon
VC St. Vincent & Grenadines
SD Sudan
SR Suriname
SJ Svalbard & Jan Mayen
SE Sweden
CH Switzerland
SY Syria
TW Taiwan
TJ Tajikistan
TZ Tanzania
TH Thailand
TL Timor-Leste
TG Togo
TK Tokelau
TO Tonga
TT Trinidad & Tobago
TN Tunisia
TR Türkiye
TM Turkmenistan
TC Turks & Caicos Islands
TV Tuvalu
UM U.S. Outlying Islands
VI U.S. Virgin Islands
UG Uganda
UA Ukraine
AE United Arab Emirates
GB United Kingdom
US United States
UY Uruguay
UZ Uzbekistan
VU Vanuatu
VA Vatican City
VE Venezuela
VN Vietnam
WF Wallis & Futuna
EH Western Sahara
YE Yemen
ZM Zambia
ZW Zimbabwe
`);

/**
 * The subdivisions offered, by country: the drawn "state or province".
 * A country absent here takes a country alone. The US list includes the
 * District of Columbia, which ISO 3166-2 lists beside the states; Puerto
 * Rico and the other territories are countries of their own in 3166-1.
 */
const SUBDIVISIONS: ReadonlyMap<string, readonly RegionOption[]> = new Map([
  [
    "US",
    table(`
US-AL Alabama
US-AK Alaska
US-AZ Arizona
US-AR Arkansas
US-CA California
US-CO Colorado
US-CT Connecticut
US-DE Delaware
US-DC District of Columbia
US-FL Florida
US-GA Georgia
US-HI Hawaii
US-ID Idaho
US-IL Illinois
US-IN Indiana
US-IA Iowa
US-KS Kansas
US-KY Kentucky
US-LA Louisiana
US-ME Maine
US-MD Maryland
US-MA Massachusetts
US-MI Michigan
US-MN Minnesota
US-MS Mississippi
US-MO Missouri
US-MT Montana
US-NE Nebraska
US-NV Nevada
US-NH New Hampshire
US-NJ New Jersey
US-NM New Mexico
US-NY New York
US-NC North Carolina
US-ND North Dakota
US-OH Ohio
US-OK Oklahoma
US-OR Oregon
US-PA Pennsylvania
US-RI Rhode Island
US-SC South Carolina
US-SD South Dakota
US-TN Tennessee
US-TX Texas
US-UT Utah
US-VT Vermont
US-VA Virginia
US-WA Washington
US-WV West Virginia
US-WI Wisconsin
US-WY Wyoming
`),
  ],
  [
    "CA",
    table(`
CA-AB Alberta
CA-BC British Columbia
CA-MB Manitoba
CA-NB New Brunswick
CA-NL Newfoundland and Labrador
CA-NT Northwest Territories
CA-NS Nova Scotia
CA-NU Nunavut
CA-ON Ontario
CA-PE Prince Edward Island
CA-QC Quebec
CA-SK Saskatchewan
CA-YT Yukon
`),
  ],
]);

/**
 * A list as a select takes it: the codes in order, and each code's name.
 */
export function choicesOf(options: readonly RegionOption[]): {
  codes: readonly string[];
  names: Readonly<Record<string, string>>;
} {
  return {
    codes: options.map((option) => option.code),
    names: Object.fromEntries(
      options.map((option) => [option.code, option.name]),
    ),
  };
}

/**
The subdivisions a country offers, or none.
*/
export function subdivisionsOf(country: string): readonly RegionOption[] {
  // A Map, not an index into the object: `country` can be anything a
  // request sends, and "constructor" or "__proto__" would read
  // Object.prototype's members rather than missing (review of PR #183).
  return SUBDIVISIONS.get(country) ?? [];
}

function nameIn(
  options: readonly RegionOption[],
  code: string,
): string | undefined {
  return options.find((option) => option.code === code)?.name;
}

/**
 * Error copy lives in the schema (§Forms & failure). The form only offers
 * the list's choices, so these are what the server says to anything else.
 */
export const REGION_COUNTRY_UNKNOWN = "Pick a country from the list.";
export const REGION_SUBDIVISION_ALONE =
  "Pick a country before a state or province.";
export const REGION_SUBDIVISION_ELSEWHERE =
  "Pick a state or province in that country.";

/**
 * Nothing chosen: the select's empty option (`""`), or the field left out.
 * Both read as undefined, which the writer stores as NULL.
 */
function blankAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

/**
 * What Settings › Region writes. Neither field clears the region; a
 * country alone is a full answer; a subdivision needs its own country.
 */
export const regionInput = z
  .object({
    country: z.preprocess(
      blankAsUnset,
      z
        .string()
        .refine((code) => nameIn(COUNTRIES, code) !== undefined, {
          message: REGION_COUNTRY_UNKNOWN,
        })
        .optional(),
    ),
    subdivision: z.preprocess(blankAsUnset, z.string().optional()),
  })
  .refine(
    ({ country, subdivision }) =>
      subdivision === undefined || country !== undefined,
    { path: ["subdivision"], message: REGION_SUBDIVISION_ALONE },
  )
  .refine(
    ({ country, subdivision }) =>
      subdivision === undefined ||
      country === undefined ||
      nameIn(subdivisionsOf(country), subdivision) !== undefined,
    { path: ["subdivision"], message: REGION_SUBDIVISION_ELSEWHERE },
  );
export type Region = z.output<typeof regionInput>;

/**
 * The region in words, for Settings' row: "Minnesota, United States", the
 * country alone, or undefined when none is set. A stored code the list no
 * longer holds is shown as the code rather than dropped.
 */
export function regionLabel(region: Region): string | undefined {
  if (region.country === undefined) return undefined;
  const country = nameIn(COUNTRIES, region.country) ?? region.country;
  if (region.subdivision === undefined) return country;
  const subdivision =
    nameIn(subdivisionsOf(region.country), region.subdivision) ??
    region.subdivision;
  return `${subdivision}, ${country}`;
}
