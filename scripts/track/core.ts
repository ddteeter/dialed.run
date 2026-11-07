/**
 * The pure half of `npm run track` (design 181): everything that can be
 * decided without a network, so a test can hold it against recorded `gh`
 * JSON. `scripts/track.ts` is the shell that runs `gh` and calls these.
 *
 * Nothing here hard-codes a Project field's opaque id. The ids, and the
 * status slugs agents type, are read from the Project itself on every run,
 * so renaming or adding a status in GitHub's UI needs no change here.
 */
import { z } from "zod";

/**
The one Project open work lives in (docs/agents/issue-tracker.md).
*/
export const PROJECT_OWNER = "ddteeter";
export const PROJECT_NUMBER = 2;

export const STATUS_FIELD = "Status";
export const LANE_FIELD = "Lane";

/**
"Needs Design" → "needs-design": what an agent types for a status.
*/
export function slugOf(name: string): string {
  return name.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

const optionSchema = z.object({ id: z.string(), name: z.string() });

const fieldNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  options: z.array(optionSchema).optional(),
});

/**
Every GraphQL answer is `{ data: { … } }`; an error answer has no `data`.
*/
function responseOf<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object({ data: z.object(shape) });
}

const fieldsSchema = z.object({ nodes: z.array(fieldNodeSchema) });
const projectNodeSchema = z.object({ id: z.string(), fields: fieldsSchema });
const projectResponseSchema = responseOf({
  user: z.object({ projectV2: projectNodeSchema }),
});

export interface StatusOption {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface ProjectMeta {
  readonly id: string;
  readonly statusFieldId: string;
  readonly laneFieldId: string;
  /**
  In the Project's own order.
  */
  readonly statuses: readonly StatusOption[];
}

export const PROJECT_QUERY = `query($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2FieldCommon { id name }
          ... on ProjectV2SingleSelectField { options { id name } }
        }
      }
    }
  }
}`;

/**
Parses the PROJECT_QUERY response into the ids the mutations need.
*/
export function parseProject(raw: unknown): ProjectMeta {
  const project = projectResponseSchema.parse(raw).data.user.projectV2;
  const byName = new Map(
    project.fields.nodes.map((field) => [field.name, field]),
  );
  const status = byName.get(STATUS_FIELD);
  if (status?.options === undefined) {
    throw new Error(`the Project has no single-select "${STATUS_FIELD}" field`);
  }
  const lane = byName.get(LANE_FIELD);
  if (lane === undefined) {
    throw new Error(`the Project has no "${LANE_FIELD}" field`);
  }
  const statuses = status.options.map((option) => ({
    ...option,
    slug: slugOf(option.name),
  }));
  return {
    id: project.id,
    statusFieldId: status.id,
    laneFieldId: lane.id,
    statuses,
  };
}

/**
The option for a typed slug, or an error that lists the valid ones.
*/
export function statusFor(meta: ProjectMeta, slug: string): StatusOption {
  const option = meta.statuses.find((status) => status.slug === slugOf(slug));
  if (option === undefined) {
    const valid = meta.statuses.map((status) => status.slug).join(", ");
    throw new Error(`unknown status "${slug}"; one of: ${valid}`);
  }
  return option;
}

export const ITEMS_QUERY = `query($id: ID!, $after: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          status: fieldValueByName(name: "${STATUS_FIELD}") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          lane: fieldValueByName(name: "${LANE_FIELD}") {
            ... on ProjectV2ItemFieldTextValue { text }
          }
          content {
            ... on Issue { number title state url }
          }
        }
      }
    }
  }
}`;

const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

/**
Draft items and pull requests match no fragment, so every field is optional.
*/
const contentSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    url: z.string(),
  })
  .partial();

const itemNodeSchema = z.object({
  id: z.string(),
  status: z.object({ name: z.string().optional() }).nullable(),
  lane: z.object({ text: z.string().optional() }).nullable(),
  content: contentSchema.nullable(),
});

const itemsSchema = z.object({
  pageInfo: pageInfoSchema,
  nodes: z.array(itemNodeSchema),
});
const itemsResponseSchema = responseOf({
  node: z.object({ items: itemsSchema }),
});

export interface TrackedIssue {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly url: string;
  /**
  The status's slug, or "" when the item has none (the inbox).
  */
  readonly status: string;
  readonly lane: string;
}

export interface ItemsPage {
  readonly issues: readonly TrackedIssue[];
  readonly next: string | undefined;
}

type ItemNode = z.infer<typeof itemNodeSchema>;

function trackedIssueOf(node: ItemNode): TrackedIssue | undefined {
  const content = node.content;
  if (
    content?.number === undefined ||
    content.title === undefined ||
    content.state === undefined ||
    content.url === undefined
  ) {
    return undefined;
  }
  return {
    number: content.number,
    title: content.title,
    state: content.state,
    url: content.url,
    status: slugOf(node.status?.name ?? ""),
    lane: node.lane?.text ?? "",
  };
}

/**
One page of ITEMS_QUERY. Draft items and pull requests are skipped.
*/
export function parseItemsPage(raw: unknown): ItemsPage {
  const { pageInfo, nodes } = itemsResponseSchema.parse(raw).data.node.items;
  const issues: TrackedIssue[] = [];
  for (const node of nodes) {
    const issue = trackedIssueOf(node);
    if (issue !== undefined) issues.push(issue);
  }
  const next = pageInfo.hasNextPage
    ? (pageInfo.endCursor ?? undefined)
    : undefined;
  return { issues, next };
}

/**
 * `all`, `inbox` (no status, or Inbox: the auto-add workflow leaves new
 * issues without one), or one status by slug.
 */
export function selectIssues(
  issues: readonly TrackedIssue[],
  meta: ProjectMeta,
  which: string,
): readonly TrackedIssue[] {
  if (which === "all") return issues;
  if (which === "inbox") {
    return issues.filter(
      (issue) => issue.status === "" || issue.status === "inbox",
    );
  }
  const wanted = slugOf(statusFor(meta, which).name);
  return issues.filter((issue) => issue.status === wanted);
}

const itemIdSchema = z.object({ item: z.object({ id: z.string() }) });
const itemAddedSchema = responseOf({ addProjectV2ItemById: itemIdSchema });

/**
The item id from addProjectV2ItemById, which also returns an existing item.
*/
export function parseAddedItem(raw: unknown): string {
  return itemAddedSchema.parse(raw).data.addProjectV2ItemById.item.id;
}

const createdIssueUrl = /\/issues\/(\d+)\s*$/;

/**
`gh issue create` prints the new issue's URL; this is its number.
*/
export function issueNumberFromUrl(output: string): number {
  const match = createdIssueUrl.exec(output.trim());
  if (match?.[1] === undefined) {
    throw new Error(
      `gh issue create did not print an issue URL: ${output.trim()}`,
    );
  }
  return Number(match[1]);
}

/**
 * The never-list's mechanical backstop (.claude/rules/publishing.md):
 * shapes that are never fine on a public issue. It cannot judge the rest
 * of the rule, which is why the rule exists; it only catches the things a
 * pattern can see.
 */
const NEVER_PATTERNS: readonly {
  readonly kind: string;
  readonly pattern: RegExp;
}[] = [
  { kind: "email address", pattern: /[\w+-]@[a-z\d-]+\.[a-z]{2,}/i },
  {
    kind: "phone number",
    pattern: /\+\d{10,15}\b|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/,
  },
  {
    kind: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z\d]{20,}|github_pat_\w{20,})/,
  },
  {
    kind: "API key",
    pattern: /\b(?:sk-[\w-]{20,}|AKIA[\dA-Z]{16}|xox[abprs]-[\w-]{10,})/,
  },
  { kind: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "JWT", pattern: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\./ },
];

export interface NeverHit {
  readonly kind: string;
  /**
  1-based. The match itself is never echoed: it may be the secret.
  */
  readonly line: number;
}

export function neverListHits(text: string): readonly NeverHit[] {
  const hits: NeverHit[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    for (const { kind, pattern } of NEVER_PATTERNS) {
      if (pattern.test(line)) hits.push({ kind, line: index + 1 });
    }
  }
  return hits;
}

/**
True when `gh` failed because GitHub is rate-limiting us, so a retry may help.
*/
export function isRateLimited(stderr: string): boolean {
  return /rate limit|abuse detection|was submitted too quickly/i.test(stderr);
}
