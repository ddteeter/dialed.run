/**
 * The names a door exports (design 240): a module's `index.ts`, or a
 * sub-module's. Read with the TypeScript compiler rather than a pattern
 * over the text, as `scripts/diagrams/syntax.ts` reads the Worker entry.
 *
 * **It throws on what it cannot count, rather than leaving it out.** A
 * bare `export * from` exports whatever the other file does, which only
 * following it would tell, and a destructured `export const` hides its
 * names in a pattern. Neither is in a door today; one that appears is
 * written as named exports, or counted here.
 *
 * Pure: text in, names out. Tested in the `node` project, because the
 * workers pool cannot load the compiler.
 */
import ts from "typescript";

import { hasModifier, parse } from "../diagrams/syntax";

function cannotCount(path: string, statement: ts.Statement): Error {
  const [line = ""] = statement.getText().split("\n", 1);
  return new Error(
    `${path} has an export the module shape cannot count: ${line}. ` +
      "Write it as named exports (scripts/modules/doors.ts).",
  );
}

/**
 * `export { a, b as c }`, with or without a `from`, and
 * `export * as all from`.
 */
function reExported(path: string, statement: ts.ExportDeclaration): string[] {
  const clause = statement.exportClause;
  if (clause === undefined) throw cannotCount(path, statement);
  return ts.isNamedExports(clause)
    ? clause.elements.map((element) => element.name.text)
    : [clause.name.text];
}

/**
`export const a = 1, b = 2`.
*/
function variables(path: string, statement: ts.VariableStatement): string[] {
  return statement.declarationList.declarations.map((declaration) => {
    if (!ts.isIdentifier(declaration.name)) throw cannotCount(path, statement);
    return declaration.name.text;
  });
}

/**
The name of a function, class, interface, type or enum declaration.
*/
function declarationName(statement: ts.Statement): ts.Identifier | undefined {
  const isNamed =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement);
  return isNamed ? statement.name : undefined;
}

/**
 * A declaration that carries `export`. `export default` of one is
 * `default`, whatever it is called.
 */
function declared(path: string, statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) return variables(path, statement);
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
    return ["default"];
  }
  const name = declarationName(statement);
  if (name === undefined) throw cannotCount(path, statement);
  return [name.text];
}

function namesOf(path: string, statement: ts.Statement): string[] {
  if (ts.isExportDeclaration(statement)) return reExported(path, statement);
  if (ts.isExportAssignment(statement)) return ["default"];
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ? declared(path, statement)
    : [];
}

/**
Every name the file at `path` exports, in the order it exports them.
*/
export function doorNames(path: string, text: string): string[] {
  const file = parse(path, text);
  return file.statements.flatMap((statement) => namesOf(path, statement));
}
