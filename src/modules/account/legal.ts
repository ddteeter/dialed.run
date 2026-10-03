/**
 * The legal pages' texts (task 126, ACC-13; R-105, D-52): which exist,
 * and whether each is ready to be read by anyone.
 *
 * **The text is the file in `docs/legal/`**, bundled as a string at build
 * time and parsed here on the server, so the page and the file can never
 * say different things and the text never rides in the client bundle.
 *
 * **Only a text the owner has marked published is shown** (`PUBLISHED_MARK`
 * in ./legal-markdown). Each text is a draft for the owner to review, and
 * a legal page must not show a placeholder to the public. So a text
 * without the mark reads as absent, and its route answers X1, until the
 * owner marks the reviewed text; then it is live with no code change.
 */
import copyright from "../../../docs/legal/copyright.md?raw";
import privacyPolicy from "../../../docs/legal/privacy-policy.md?raw";
import terms from "../../../docs/legal/terms.md?raw";
import { unreadNotificationCount } from "../notifications";
import type { LegalSlug } from "./inputs";
import { parseLegalDoc, publishedText, type LegalDoc } from "./legal-markdown";

type Db = Parameters<typeof unreadNotificationCount>[0];

const LEGAL_TEXTS: Readonly<Record<LegalSlug, string>> = {
  privacy: privacyPolicy,
  terms,
  copyright,
};

/**
The text, parsed — or nothing, until the owner marks it published.
*/
export function legalDoc(
  slug: LegalSlug,
  texts: Readonly<Record<LegalSlug, string>> = LEGAL_TEXTS,
): LegalDoc | undefined {
  const text = publishedText(texts[slug]);
  return text === undefined ? undefined : parseLegalDoc(text);
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
