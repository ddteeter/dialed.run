/**
 * What the diagram generator needs from a source's syntax, read with the
 * TypeScript compiler rather than a pattern over the text (design 229):
 * the handlers and exports of `main`, whether a file creates a server
 * function, and the dynamic imports whose target no resolver can follow.
 * The imports themselves are dependency-cruiser's (`sources.ts`).
 *
 * Pure: text in, facts out. Tested in the `node` project, because the
 * workers pool cannot load the compiler.
 */
import ts from "typescript";

export function parse(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
Whether a statement carries a modifier: `export`, `default`.
*/
export function hasModifier(
  statement: ts.Statement,
  kind: ts.SyntaxKind,
): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === kind,
    )
  );
}

function hasExport(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

/**
 * An export as its first line (`export const handle = …`), or for a
 * class or function `export class Room`, so a list can name each.
 */
function describeExport(statement: ts.Statement, file: ts.SourceFile): string {
  if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
    return `export class ${statement.name.text}`;
  }
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    return `export function ${statement.name.text}`;
  }
  return statement.getText(file).split("\n", 1)[0] ?? "";
}

/**
The names of an object literal's members: methods, properties, shorthands.
*/
function memberNames(
  object: ts.ObjectLiteralExpression,
  file: ts.SourceFile,
): string[] {
  return object.properties.map((member) =>
    member.name === undefined
      ? member.getText(file)
      : member.name.getText(file),
  );
}

/**
 * The value under `satisfies`, `as` and parentheses: `export default { … }
 * satisfies ExportedHandler` exports the object.
 */
function withoutTypeAssertions(expression: ts.Expression): ts.Expression {
  return ts.isSatisfiesExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isParenthesizedExpression(expression)
    ? withoutTypeAssertions(expression.expression)
    : expression;
}

/**
 * The entries of the Worker's `main`: each handler on its default export
 * object (`fetch`, `queue`, …) by name, and every other export, described.
 * A default export that is not an object literal is one entry, its text,
 * so a closed list of handlers throws on it rather than reading nothing.
 */
export function mainEntries(path: string, text: string): string[] {
  const file = parse(path, text);
  return file.statements.flatMap((statement) => {
    if (ts.isExportAssignment(statement)) {
      const value = withoutTypeAssertions(statement.expression);
      return ts.isObjectLiteralExpression(value)
        ? memberNames(value, file)
        : [`export default ${value.getText(file).split("\n", 1)[0] ?? ""}`];
    }
    return ts.isExportDeclaration(statement) || hasExport(statement)
      ? [describeExport(statement, file)]
      : [];
  });
}

/**
 * What a file's syntax says that its imports do not: whether it calls
 * `createServerFn`, and each `import(…)` whose argument is not a plain
 * string, which no resolver can follow.
 */
export interface FileSyntax {
  readonly createsServerFunction: boolean;
  readonly computedImports: readonly string[];
}

function isLiteral(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

export function fileSyntax(path: string, text: string): FileSyntax {
  const file = parse(path, text);
  let isCreatesServerFunction = false;
  const computedImports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "createServerFn") {
        isCreatesServerFunction = true;
      }
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      if (isDynamic && !isLiteral(node.arguments[0])) {
        computedImports.push(node.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { createsServerFunction: isCreatesServerFunction, computedImports };
}
