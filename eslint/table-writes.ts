/**
 * `dialed/table-writes`: a module writes only the tables the owner map
 * (`eslint/table-owners.ts`) lists for it (design 261 ruling 5, design 263).
 *
 * A write is `.insert(t)`, `.update(t)` or `.delete(t)` where `t`'s type is
 * a drizzle table, so an R2 bucket's or a `Set`'s `delete` is not one. The
 * table is read from that type, never from a name, so an alias, a schema
 * namespace or an array of tables (a union) are all read the same way.
 *
 * A helper that takes the table as a parameter (`didClaim`, `setOnSubject`)
 * is checked where it is called: the rule follows the parameter, through
 * any number of helpers and object properties, to the argument that names
 * the table, and checks that call's module. An update's columns are
 * followed the same way to the object its `.set()` is given.
 *
 * What it cannot read it reports rather than passes: a write whose table no
 * type names (a `SQLiteTable` annotation erases it), a column-limited
 * writer's update whose columns it cannot see, and a writing helper handed
 * on as a value, whose calls it cannot find.
 */
import type { Rule } from "eslint";
import ts from "typescript";

import { tableOwners, type OwnersEntry } from "./table-owners.ts";

type Kind = "insert" | "update" | "delete";

const KINDS: ReadonlySet<string> = new Set(["insert", "update", "delete"]);

/**
Where a value comes from inside a helper: which parameter, then which properties.
*/
interface Origin {
  readonly index: number;
  readonly path: readonly string[];
}

/**
A value at a site: an expression, then which properties of it.
*/
interface Located {
  readonly expression: ts.Expression;
  readonly path: readonly string[];
}

/**
 * An update's columns: named, at a value (a site), from a parameter (a
 * helper), or unknown (undefined). Inserts and deletes name none.
 */
type Columns =
  | { readonly names: readonly string[] }
  | { readonly at: Located }
  | { readonly from: Origin }
  | undefined;

/**
A write found at one call, or one a helper makes with its parameters.
*/
interface Site {
  readonly kind: Kind;
  readonly table: Located;
  readonly columns: Columns;
}

interface HelperWrite {
  readonly kind: Kind;
  readonly table: Origin;
  readonly columns: Columns;
}

type FunctionLike = ts.SignatureDeclaration & { readonly body?: ts.Node };

type Report = (
  node: ts.Node,
  messageId: string,
  data?: Record<string, string>,
) => void;

const NO_COLUMNS: Columns = { names: [] };

const owners: ReadonlyMap<string, OwnersEntry> = new Map(
  Object.entries(tableOwners),
);

function isKind(name: string): name is Kind {
  return KINDS.has(name);
}

function isProgram(value: unknown): value is ts.Program {
  return (
    typeof value === "object" &&
    value !== null &&
    "getTypeChecker" in value &&
    typeof value.getTypeChecker === "function"
  );
}

function programOf(services: unknown): ts.Program | undefined {
  if (
    typeof services !== "object" ||
    services === null ||
    !("program" in services)
  )
    return undefined;
  return isProgram(services.program) ? services.program : undefined;
}

/**
 * The module a file is in: `src/modules/<name>/…`, or else the folder of
 * `src/` it sits in (`src/db`).
 */
export function areaOf(filename: string): string {
  const path = filename.replaceAll("\\", "/");
  const inModule = /\/src\/modules\/([^/]+)\//u.exec(path)?.[1];
  if (inModule !== undefined) return inModule;
  const inSrc = /\/src\/([^/]+)\//u.exec(path)?.[1];
  return inSrc === undefined ? "src" : `src/${inSrc}`;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isFunctionLike(node);
}

/**
 * A function a caller can be found for: declared, a method, or a function
 * held in a variable. A callback written in place is called by whatever it
 * is handed to, which this rule cannot follow.
 */
function isNamedHelper(fn: FunctionLike): boolean {
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) return true;
  const isExpression = ts.isArrowFunction(fn) || ts.isFunctionExpression(fn);
  return isExpression && ts.isVariableDeclaration(fn.parent);
}

/**
The identifier a property chain starts from, and the chain.
*/
function rootOf(located: Located) {
  let expression = unwrap(located.expression);
  const path = [...located.path];
  while (ts.isPropertyAccessExpression(expression)) {
    path.unshift(expression.name.text);
    expression = unwrap(expression.expression);
  }
  return ts.isIdentifier(expression)
    ? { identifier: expression, path }
    : undefined;
}

function createChecks(checker: ts.TypeChecker) {
  const helperCache = new WeakMap<ts.Node, readonly HelperWrite[]>();
  const inProgress = new WeakSet<ts.Node>();

  function typeAt(located: Located): ts.Type | undefined {
    let type: ts.Type = checker.getTypeAtLocation(located.expression);
    for (const name of located.path) {
      const property = checker.getPropertyOfType(
        checker.getApparentType(type),
        name,
      );
      if (property === undefined) return undefined;
      type = checker.getTypeOfSymbolAtLocation(property, located.expression);
    }
    return type;
  }

  function literalProperty(type: ts.Type, name: string): string | undefined {
    const property = checker.getPropertyOfType(type, name);
    if (property === undefined) return undefined;
    const value = checker.getTypeOfSymbol(property);
    return value.isStringLiteral() ? value.value : undefined;
  }

  /**
   * A drizzle table's `_`, which carries `brand: "Table"` and its name, or
   * undefined when the type is not a table.
   */
  function tableMeta(type: ts.Type): ts.Type | undefined {
    const underscore = checker.getPropertyOfType(
      checker.getApparentType(type),
      "_",
    );
    if (underscore === undefined) return undefined;
    const meta = checker.getTypeOfSymbol(underscore);
    return literalProperty(meta, "brand") === "Table" ? meta : undefined;
  }

  function partsOf(type: ts.Type): readonly ts.Type[] {
    return type.isUnion() ? type.types : [type];
  }

  function isTable(type: ts.Type): boolean {
    return partsOf(type).every((part) => tableMeta(part) !== undefined);
  }

  /**
  Every table the value can be, or undefined if one of them has no name.
  */
  function tableNames(located: Located): readonly string[] | undefined {
    const type = typeAt(located);
    if (type === undefined) return undefined;
    const names: string[] = [];
    for (const part of partsOf(type)) {
      const meta = tableMeta(part);
      const name = meta && literalProperty(meta, "name");
      if (name === undefined) return undefined;
      names.push(name);
    }
    return names;
  }

  function parameterOf(identifier: ts.Identifier) {
    const declaration =
      checker.getSymbolAtLocation(identifier)?.valueDeclaration;
    return declaration === undefined || !ts.isParameter(declaration)
      ? undefined
      : declaration;
  }

  /**
  The parameter of `fn` a value comes from, if it does.
  */
  function originIn(located: Located, fn: FunctionLike): Origin | undefined {
    const root = rootOf(located);
    if (root === undefined) return undefined;
    const parameter = parameterOf(root.identifier);
    return parameter?.parent === fn
      ? { index: fn.parameters.indexOf(parameter), path: root.path }
      : undefined;
  }

  /**
  The function whose parameter a value comes from, if any.
  */
  function parameterOwner(located: Located): FunctionLike | undefined {
    const root = rootOf(located);
    const parameter = root && parameterOf(root.identifier);
    if (parameter === undefined) return undefined;
    return isFunctionLike(parameter.parent) ? parameter.parent : undefined;
  }

  function columnNames(located: Located): readonly string[] | undefined {
    const type = typeAt(located);
    if (type === undefined) return undefined;
    const names = checker.getPropertiesOfType(type).map((p) => p.name);
    return names.length > 0 ? names : undefined;
  }

  /**
  The object an `.update(t)` is `.set()` with, if the chain shows it.
  */
  function setArgument(call: ts.CallExpression): Columns {
    const access = call.parent;
    if (!ts.isPropertyAccessExpression(access) || access.name.text !== "set")
      return undefined;
    const chained = access.parent;
    if (!ts.isCallExpression(chained)) return undefined;
    const argument = chained.arguments[0];
    return argument && { at: { expression: argument, path: [] } };
  }

  function directSite(call: ts.CallExpression): Site | undefined {
    const callee = call.expression;
    const argument = call.arguments[0];
    if (argument === undefined || !ts.isPropertyAccessExpression(callee)) {
      return undefined;
    }
    const kind = callee.name.text;
    if (!isKind(kind) || !isTable(checker.getTypeAtLocation(argument)))
      return undefined;
    return {
      kind,
      table: { expression: argument, path: [] },
      columns: kind === "update" ? setArgument(call) : NO_COLUMNS,
    };
  }

  function argumentAt(
    call: ts.CallExpression,
    origin: Origin,
  ): Located | undefined {
    const argument = call.arguments[origin.index];
    return argument && { expression: argument, path: origin.path };
  }

  function declarationOf(call: ts.CallExpression): FunctionLike | undefined {
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (declaration === undefined || !isFunctionLike(declaration)) {
      return undefined;
    }
    return declaration.getSourceFile().isDeclarationFile
      ? undefined
      : declaration;
  }

  /**
  A helper's columns, seen from one call of it.
  */
  function columnsAtCall(call: ts.CallExpression, columns: Columns): Columns {
    if (columns === undefined || !("from" in columns)) return columns;
    const at = argumentAt(call, columns.from);
    return at && { at };
  }

  function helperSites(call: ts.CallExpression): readonly Site[] {
    const declaration = declarationOf(call);
    if (declaration === undefined) return [];
    const sites: Site[] = [];
    for (const write of helperWrites(declaration)) {
      const table = argumentAt(call, write.table);
      if (table === undefined) continue;
      const columns = columnsAtCall(call, write.columns);
      sites.push({ kind: write.kind, table, columns });
    }
    return sites;
  }

  function sitesAt(call: ts.CallExpression): readonly Site[] {
    const direct = directSite(call);
    return direct === undefined ? helperSites(call) : [direct];
  }

  /**
  A site's columns, seen from inside helper `fn`.
  */
  function columnsInHelper(columns: Columns, fn: FunctionLike): Columns {
    if (columns === undefined || !("at" in columns)) return columns;
    const from = originIn(columns.at, fn);
    if (from !== undefined) return { from };
    const names = columnNames(columns.at);
    return names && { names };
  }

  function writesOfCall(
    call: ts.CallExpression,
    fn: FunctionLike,
  ): readonly HelperWrite[] {
    const writes: HelperWrite[] = [];
    for (const site of sitesAt(call)) {
      if (tableNames(site.table) !== undefined) continue;
      const table = originIn(site.table, fn);
      if (table === undefined) continue;
      const columns = columnsInHelper(site.columns, fn);
      writes.push({ kind: site.kind, table, columns });
    }
    return writes;
  }

  /**
  What `fn` writes with its parameters, through any helpers it calls.
  */
  function helperWrites(fn: FunctionLike): readonly HelperWrite[] {
    const cached = helperCache.get(fn);
    if (cached !== undefined) return cached;
    if (inProgress.has(fn) || fn.body === undefined) return [];
    inProgress.add(fn);
    const writes: HelperWrite[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) writes.push(...writesOfCall(node, fn));
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
    inProgress.delete(fn);
    helperCache.set(fn, writes);
    return writes;
  }

  /**
  The columns a site's update sets, when they can be read at the call.
  */
  function siteColumns(site: Site): readonly string[] | undefined {
    const { columns } = site;
    if (columns === undefined || "from" in columns) return undefined;
    return "names" in columns ? columns.names : columnNames(columns.at);
  }

  /**
  A function that writes, named somewhere other than a call's callee.
  */
  function isWritingHelperValue(node: ts.Identifier): boolean {
    const parent = node.parent;
    const isArgument =
      ts.isCallExpression(parent) && parent.expression !== node;
    if (!isArgument && !ts.isArrayLiteralExpression(parent)) return false;
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    const fn =
      declaration && ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : declaration;
    const isOurs =
      fn !== undefined &&
      isFunctionLike(fn) &&
      !fn.getSourceFile().isDeclarationFile;
    return isOurs && helperWrites(fn).length > 0;
  }

  return {
    sitesAt,
    tableNames,
    siteColumns,
    parameterOwner,
    isWritingHelperValue,
  };
}

type Checks = ReturnType<typeof createChecks>;

interface Write {
  readonly area: string;
  readonly table: string;
  readonly kind: Kind;
  readonly columns: () => readonly string[] | undefined;
}

/**
 * One write the map allowed through an `others` entry: which table, which
 * module, which kind and, for an update, which listed columns it set.
 * `test/eslint/table-owners-used.node.test.ts` collects these to find an
 * entry nothing uses.
 */
export interface Use {
  readonly table: string;
  readonly area: string;
  readonly kind: Kind;
  readonly columns: readonly string[];
}

export type OnUse = (use: Use) => void;

/**
An update by a column-limited writer: its columns must all be listed.
*/
function checkColumns(
  write: Write,
  allowed: readonly string[],
  data: Record<string, string>,
  report: (messageId: string, extra?: Record<string, string>) => void,
  onUse: OnUse,
): void {
  const columns = write.columns();
  if (columns === undefined) {
    report("columnsUnknown");
    return;
  }
  const { area, table, kind } = write;
  const listed = columns.filter((column) => allowed.includes(column));
  onUse({ area, table, kind, columns: listed });
  const missing = columns.filter((column) => !allowed.includes(column));
  if (missing.length > 0) {
    report("columnsNotListed", { ...data, columns: missing.join(", ") });
  }
}

/**
Whether `write.area` may make this write; reports at `node` if not.
*/
function checkWrite(
  write: Write,
  node: ts.Node,
  report: Report,
  onUse: OnUse,
): void {
  const { area, table, kind } = write;
  const entry = owners.get(table);
  if (entry === undefined) {
    report(node, "noEntry", { table });
    return;
  }
  if (entry.owner === area) return;
  const data = { area, table, kind, owner: entry.owner };
  const at = (messageId: string, extra?: Record<string, string>) => {
    report(node, messageId, extra ?? data);
  };
  const writer = Object.entries(entry.others ?? {}).find(
    ([name]) => name === area,
  )?.[1];
  if (writer === undefined) {
    at("notListed");
  } else if (kind !== "update") {
    if (writer[kind] === true) onUse({ area, table, kind, columns: [] });
    else at("kindNotListed");
  } else if (writer.update === undefined) {
    at("kindNotListed");
  } else {
    checkColumns(write, writer.update, data, at, onUse);
  }
}

function checkCall(
  checks: Checks,
  call: ts.CallExpression,
  area: string,
  report: Report,
  onUse: OnUse,
): void {
  for (const site of checks.sitesAt(call)) {
    const names = checks.tableNames(site.table);
    if (names === undefined) {
      const fn = checks.parameterOwner(site.table);
      if (fn === undefined || !isNamedHelper(fn)) {
        report(call, "unnamedTable", { kind: site.kind });
      }
      continue;
    }
    const columns = () => checks.siteColumns(site);
    for (const table of names) {
      checkWrite(
        { area, table, kind: site.kind, columns },
        call,
        report,
        onUse,
      );
    }
  }
}

const meta: Rule.RuleMetaData = {
  type: "problem",
  docs: {
    description:
      "A module writes only the tables the owner map lists for it (design 263).",
  },
  schema: [],
  messages: {
    noTypes:
      "dialed/table-writes needs type information: run it with typed linting.",
    noEntry:
      "`{{table}}` has no entry in the owner map (eslint/table-owners.ts).",
    notListed:
      "`{{area}}` writes `{{table}}` ({{kind}}), which the owner map gives to `{{owner}}`. Call a function `{{owner}}` exports, or list the write in eslint/table-owners.ts with its reason.",
    kindNotListed:
      "`{{area}}` makes a {{kind}} on `{{table}}` (owned by `{{owner}}`), and the owner map lists no {{kind}} for it.",
    columnsNotListed:
      "`{{area}}` updates `{{table}}`.{{columns}}, which the owner map does not list for it (`{{owner}}` owns the table).",
    columnsUnknown:
      "`{{area}}` may update only some columns of `{{table}}`, and this update's columns cannot be read here. Pass `.set()` an object whose type names them.",
    unnamedTable:
      "Which table this {{kind}} writes cannot be read from its type. Let the type name it (drop a `SQLiteTable` annotation, or use `as const`), or take it as a parameter of a named function.",
    helperAsValue:
      "This function writes a table it is passed, and is handed on here as a value, so the table it writes cannot be checked. Call it.",
  },
};

function ignoreUse(): void {
  // The lint run keeps no record; only the stale-entry test does.
}

/**
 * The rule, telling `onUse` of each write an `others` entry let through.
 */
export function createTableWrites(onUse: OnUse = ignoreUse): Rule.RuleModule {
  return { meta, create: (context) => createListener(context, onUse) };
}

export const tableWrites = createTableWrites();

function createListener(
  context: Rule.RuleContext,
  onUse: OnUse,
): Rule.RuleListener {
  const program = programOf(context.sourceCode.parserServices);
  const sourceFile = program?.getSourceFile(context.filename);
  return {
    Program(node) {
      if (program === undefined || sourceFile === undefined) {
        context.report({ node, messageId: "noTypes" });
        return;
      }
      const checks = createChecks(program.getTypeChecker());
      const area = areaOf(context.filename);
      const report: Report = (at, messageId, data) => {
        context.report({
          loc: {
            start: context.sourceCode.getLocFromIndex(at.getStart(sourceFile)),
            end: context.sourceCode.getLocFromIndex(at.getEnd()),
          },
          messageId,
          ...(data !== undefined && { data }),
        });
      };
      const visit = (current: ts.Node): void => {
        if (ts.isCallExpression(current)) {
          checkCall(checks, current, area, report, onUse);
        } else if (
          ts.isIdentifier(current) &&
          checks.isWritingHelperValue(current)
        ) {
          report(current, "helperAsValue");
        }
        ts.forEachChild(current, visit);
      };
      visit(sourceFile);
    },
  };
}
