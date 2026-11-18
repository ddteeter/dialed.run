/**
 * The primitives' `no-restricted-syntax` selectors (#793, #794), fed real
 * snippets. They land at zero hits, and a selector whose regex fails open
 * also reports zero, so a clean `npm run lint` proves nothing about them.
 * This asks ESLint for the composed rule a given file actually gets (the
 * replace-not-merge trap at the top of `eslint.config.js` is exactly how a
 * selector goes quietly missing) and lints each snippet with it.
 *
 * In the `node` project because ESLint reads the config from disk.
 */
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const eslint = new ESLint();

const restriction = z.object({ selector: z.string(), message: z.string() });

const ruleEntry = z.tuple([z.literal(2)]).rest(restriction);

const restrictionsSchema = z.object({
  rules: z.object({ "no-restricted-syntax": ruleEntry }),
});

/**
 * The `no-restricted-syntax` entry the config gives `path`.
 */
async function restrictionsFor(path: string): Promise<Linter.RuleEntry> {
  const config: unknown = await eslint.calculateConfigForFile(path);
  return restrictionsSchema.parse(config).rules["no-restricted-syntax"];
}

/**
 * The messages `code` draws from the restrictions `path` gets.
 */
async function messagesIn(path: string, code: string): Promise<string[]> {
  const linter = new Linter();
  return linter
    .verify(
      code,
      {
        files: ["**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { "no-restricted-syntax": await restrictionsFor(path) },
      },
      { filename: "probe.tsx" },
    )
    .map((message) => message.message);
}

const FEED = "src/modules/feed/components/Feed.tsx";
const AUTH = "src/modules/auth/components/Landing.tsx";

const BRACKETS = /Draw bracket notation with <Bracketed>/u;
const ARBITRARY = /No arbitrary values/u;

describe("the bracket selectors", () => {
  it.each([
    ["typed as text", "const a = <span>[reports]</span>;"],
    ["opened as text", "const a = <span>[</span>;"],
    ["a template tag", "const a = <span>{`[${tag}]`}</span>;"],
    ["a string tag", 'const a = <span>{"[reports]"}</span>;'],
  ])("say no to a bracket %s", async (_kind, code) => {
    expect(await messagesIn(FEED, code)).toStrictEqual([
      expect.stringMatching(BRACKETS),
    ]);
  });

  it.each([
    ["Bracketed", "const a = <Bracketed>reports</Bracketed>;"],
    ["a template that is not a tag", "const a = <span>{`${n} [km]`}</span>;"],
    ["an attribute", 'const a = <input pattern="[a-z]+" />;'],
  ])("leave %s alone", async (_kind, code) => {
    expect(await messagesIn(FEED, code)).toStrictEqual([]);
  });

  it("reach the auth module, which skips the cross-lane rules", async () => {
    expect(
      await messagesIn(AUTH, "const a = <span>[reports]</span>;"),
    ).toStrictEqual([expect.stringMatching(BRACKETS)]);
    expect(
      await messagesIn(AUTH, 'const a = <span className="text-[11px]" />;'),
    ).toStrictEqual([]);
  });

  it("spare an exempt file, and keep every other rule there", async () => {
    // form.tsx is exempt from the brackets alone: the arbitrary-value
    // rule still reaches it, which a second exemption block replacing
    // the first would have silently undone.
    const form = "src/ui/form.tsx";
    expect(await messagesIn(form, "const a = <span>[</span>;")).toStrictEqual(
      [],
    );
    expect(
      await messagesIn(form, 'const a = <span className="text-[11px]" />;'),
    ).toStrictEqual([expect.stringMatching(ARBITRARY)]);
  });
});
