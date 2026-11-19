/**
 * `account/terms`: which terms a runner accepted, and the legal and
 * open-source pages (design 240). The rest of `account` reaches these files
 * through this door; components import the files directly.
 */
export {
  currentTermsVersion,
  latestAcceptanceOf,
  signUpAcceptances,
  termsStanding,
  termsStandingOf,
} from "./terms-acceptance";
