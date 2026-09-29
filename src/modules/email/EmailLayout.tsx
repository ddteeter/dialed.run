import { Body } from "@react-email/body";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Hr } from "@react-email/hr";
import { Html } from "@react-email/html";
import { Link } from "@react-email/link";
import { Preview } from "@react-email/preview";
import { Text } from "@react-email/text";
import type { CSSProperties, JSX } from "react";

import type { EmailContent } from "./content";
import { EMAIL_PALETTE } from "./palette";

/**
 * The one email layout (round 26: "THE EMAILS · PLAIN, ONE BUTTON"): the
 * bracket wordmark, the body, one pink button, a quiet foot, and a footer
 * that always links the privacy policy (decision D-52).
 *
 * React Email's components, because an email client is not a browser:
 * they emit the table layout and Outlook's button padding hacks that a
 * plain `<a>` loses. Every style is inline for the same reason — most
 * clients strip `<style>`, and none reads a CSS custom property, which is
 * why the colours are `EMAIL_PALETTE`'s literals.
 *
 * The type is the brand's families with the web-safe fallbacks a client
 * without them will use; no size here is a new step, each is the nearest
 * of `tokens.css`'s (body 16, small 14, micro 12).
 */

const SANS = "Archivo, Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace";

const BODY_STYLE: CSSProperties = {
  backgroundColor: EMAIL_PALETTE.ground,
  color: EMAIL_PALETTE.ink,
  fontFamily: SANS,
  margin: 0,
  padding: "24px 0",
};

const CARD_STYLE: CSSProperties = {
  backgroundColor: EMAIL_PALETTE.panel,
  maxWidth: "480px",
  padding: "24px",
};

const WORDMARK_STYLE: CSSProperties = {
  fontFamily: MONO,
  fontSize: "14px",
  margin: "0 0 24px",
};

const BRACKET_STYLE: CSSProperties = { color: EMAIL_PALETTE.action };
const RUN_STYLE: CSSProperties = { color: EMAIL_PALETTE.muted };

const TEXT_STYLE: CSSProperties = {
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 24px",
};

/**
 * Pink is action (CLAUDE.md §Forms), and text on it is always ink
 * (T1's `--action` row).
 */
const BUTTON_STYLE: CSSProperties = {
  backgroundColor: EMAIL_PALETTE.action,
  borderRadius: "999px",
  color: EMAIL_PALETTE.ink,
  fontSize: "16px",
  fontWeight: 600,
  padding: "12px 24px",
};

const FOOT_STYLE: CSSProperties = {
  color: EMAIL_PALETTE.quiet,
  fontSize: "14px",
  lineHeight: "20px",
  margin: "24px 0 0",
};

const RULE_STYLE: CSSProperties = {
  borderColor: EMAIL_PALETTE.hairline,
  margin: "24px 0",
};

const FOOTER_STYLE: CSSProperties = {
  color: EMAIL_PALETTE.muted,
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};

/**
 * Legal and settings links are underlined inline, like the privacy page's
 * (round 26 #14: "legal cross-references have to be findable").
 */
const FOOTER_LINK_STYLE: CSSProperties = {
  color: EMAIL_PALETTE.quiet,
  textDecoration: "underline",
};

export function EmailLayout({
  content,
}: Readonly<{ content: EmailContent }>): JSX.Element {
  return (
    <Html lang="en">
      <Head />
      <Preview>{content.body}</Preview>
      <Body style={BODY_STYLE}>
        <Container style={CARD_STYLE}>
          <Text style={WORDMARK_STYLE}>
            <span style={BRACKET_STYLE}>[</span> dialed
            <span style={RUN_STYLE}>.run</span>{" "}
            <span style={BRACKET_STYLE}>]</span>
          </Text>
          <Text style={TEXT_STYLE}>{content.body}</Text>
          {content.button === undefined ? undefined : (
            <Button href={content.button.href} style={BUTTON_STYLE}>
              {content.button.label}
            </Button>
          )}
          <Text style={FOOT_STYLE}>{content.foot}</Text>
          <Hr style={RULE_STYLE} />
          {content.reason === undefined ? undefined : (
            <Text style={FOOTER_STYLE}>{content.reason}</Text>
          )}
          <Text style={FOOTER_STYLE}>
            dialed.run
            {content.footer.map((link) => (
              <span key={link.label}>
                {" · "}
                <Link href={link.href} style={FOOTER_LINK_STYLE}>
                  {link.label}
                </Link>
              </span>
            ))}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
