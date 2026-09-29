/**
 * The legal pages' texts (task 126, ACC-13; D-105, D-52): which exist,
 * and whether each is ready to be read by anyone.
 *
 * **The text is the file in `docs/legal/`**, bundled as a string at build
 * time and parsed here on the server, so the page and the file can never
 * say different things and the text never rides in the client bundle.
 *
 * **Only a finished text is published.** The privacy text is the draft
 * PR #109 wrote for the owner — it opens with a DRAFT banner and carries
 * the owner's `[OWNER: …]` notes — and a legal page must not show a
 * placeholder to the public. So a text holding either mark reads as
 * absent, and its route answers X1, until the owner's reviewed text
 * replaces the file; then it is live with no code change. `/terms` and
 * `/copyright` have no text at all yet (the owner's), and join the table
 * when they do.
 */
import privacyPolicy from "../../../docs/legal/privacy-policy.md?raw";
import { unreadNotificationCount } from "../notifications";
import type { LegalSlug } from "./inputs";
import { isFinished, parseLegalDoc, type LegalDoc } from "./legal-markdown";

type Db = Parameters<typeof unreadNotificationCount>[0];

const LEGAL_TEXTS: Readonly<Record<LegalSlug, string>> = {
  privacy: privacyPolicy,
};

/**
The text, parsed — or nothing, while it is unfinished.
*/
export function legalDoc(
  slug: LegalSlug,
  texts: Readonly<Record<LegalSlug, string>> = LEGAL_TEXTS,
): LegalDoc | undefined {
  const text = texts[slug];
  return isFinished(text) ? parseLegalDoc(text) : undefined;
}

export interface LegalPage {
  readonly doc: LegalDoc | undefined;
  /**
   * The bell's count for a signed-in reader, who reads in the signed-in
   * shell; `undefined` for a signed-out one.
   */
  readonly unreadCount: number | undefined;
}

export async function legalPage(
  db: Db,
  slug: LegalSlug,
  userId: string | undefined,
  texts?: Readonly<Record<LegalSlug, string>>,
): Promise<LegalPage> {
  return {
    doc: legalDoc(slug, texts),
    unreadCount:
      userId === undefined
        ? undefined
        : await unreadNotificationCount(db, userId),
  };
}
