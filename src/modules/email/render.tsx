import { convert } from "html-to-text";
import { renderToStaticMarkup } from "react-dom/server";

import type { EmailTemplate } from "../../lib/email";
import { emailContent, type EmailLinks } from "./content";
import { EmailLayout } from "./EmailLayout";

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * One email, as the two bodies every message carries: HTML for the
 * clients that show it, and plain text for the ones that do not (and for
 * the spam filters that score a message without one).
 *
 * `renderToStaticMarkup` rather than `@react-email/render`, which was
 * measured first: it renders fine in workerd, but it imports Prettier's
 * standalone build at module scope for an optional `pretty` flag, and
 * that is most of a megabyte in the Worker for a feature nothing here
 * uses. The text is derived from the same HTML, so the two bodies cannot
 * say different things.
 */
export function renderEmail(
  template: EmailTemplate,
  links: EmailLinks,
): RenderedEmail {
  const content = emailContent(template, links);
  const html = `<!DOCTYPE html>${renderToStaticMarkup(<EmailLayout content={content} />)}`;
  return {
    subject: content.subject,
    html,
    // The preview line is for the inbox list only: in the text body it
    // would say the body twice.
    text: convert(html, {
      selectors: [{ selector: "div[data-skip-in-text=true]", format: "skip" }],
    }),
  };
}
