// Hand-rolled "restated constant set" detector, TypeScript compiler API only.
import ts from "typescript";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const SKIP = /routeTree\.gen\.ts$|\/db\/schema|\/routes\/auth\/|\.test\.|\.spec\./;

function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !SKIP.test(p)) out.push(p);
  }
  return out;
}

const files = walk(root);
const program = ts.createProgram(files, {
  allowJs: false, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, noResolve: true,
});

/** literal value of a node, or undefined */
function lit(n) {
  if (!n) return undefined;
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isNumericLiteral(n)) return n.text;
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand))
    return "-" + n.operand.text;
  if (ts.isLiteralTypeNode(n)) return lit(n.literal);
  return undefined;
}

const sites = []; // {key, kind, file, line}
function add(node, kind, values, sf) {
  const set = [...new Set(values.filter((v) => v !== undefined))].sort();
  if (set.length < 3) return;
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  sites.push({ key: set.join("|"), kind, file: sf.fileName.slice(root.length + 1), line: line + 1 });
}

for (const sf of program.getSourceFiles()) {
  if (!files.includes(sf.fileName)) continue;
  const visit = (n) => {
    // array of literals — z.enum([...]), `as const` arrays, new Set([...])
    if (ts.isArrayLiteralExpression(n)) {
      const vals = n.elements.map(lit);
      if (vals.every((v) => v !== undefined)) add(n, "array", vals, sf);
      // array of objects keyed by a shared property — [{value:-2,label:..},..]
      if (n.elements.length && n.elements.every(ts.isObjectLiteralExpression)) {
        const props = new Set(n.elements[0].properties.filter(ts.isPropertyAssignment)
          .map((p) => p.name.getText(sf)));
        for (const p of props) {
          const vs = n.elements.map((o) => lit(o.properties.find(
            (q) => ts.isPropertyAssignment(q) && q.name.getText(sf) === p)?.initializer));
          if (vs.every((v) => v !== undefined)) add(n, `array-prop:${p}`, vs, sf);
        }
      }
      // array whose elements each wrap one z.literal("x")
      const nested = n.elements.map((el) => {
        let found;
        const dig = (m) => {
          if (ts.isCallExpression(m) && m.expression.getText(sf).endsWith(".literal"))
            found ??= lit(m.arguments[0]);
          ts.forEachChild(m, dig);
        };
        dig(el);
        return found;
      });
      if (nested.every((v) => v !== undefined)) add(n, "array-nested-literal", nested, sf);
    }
    // object literal with QUOTED keys — Record<-2..2, X>
    if (ts.isObjectLiteralExpression(n)) {
      const quoted = n.properties.filter((p) => p.name && ts.isStringLiteralLike(p.name));
      if (quoted.length === n.properties.length)
        add(n, "quoted-keys", quoted.map((p) => p.name.text), sf);
    }
    // switch over literal cases
    if (ts.isSwitchStatement(n))
      add(n, "switch", n.caseBlock.clauses.filter(ts.isCaseClause).map((c) => lit(c.expression)), sf);
    // union of literal types
    if (ts.isUnionTypeNode(n)) {
      const vals = n.types.map(lit);
      if (vals.every((v) => v !== undefined)) add(n, "uniontype", vals, sf);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}


const groups = new Map();
for (const s of sites) (groups.get(s.key) ?? groups.set(s.key, []).get(s.key)).push(s);

// --- exact restatement ------------------------------------------------------
let n = 0;
for (const [key, g] of groups) {
  const uniq = [...new Map(g.map((s) => [s.file + ":" + s.line, s])).values()];
  if (uniq.length < 2) continue;
  n++;
  console.log(`* RESTATED {${key}}  x${uniq.length}`);
  for (const s of uniq) console.log(`    ${s.file}:${s.line} [${s.kind}]`);
}

// --- DRIFTED: near-identical but not equal sets ------------------------------
const keys = [...groups.keys()].map((k) => [k, new Set(k.split("|"))]);
let d = 0;
for (let i = 0; i < keys.length; i++)
  for (let j = i + 1; j < keys.length; j++) {
    const [ka, A] = keys[i], [kb, B] = keys[j];
    const inter = [...A].filter((v) => B.has(v)).length;
    const jac = inter / (A.size + B.size - inter);
    if (jac >= 0.7 && jac < 1 && Math.min(A.size, B.size) >= 3) {
      d++;
      const only = (X, Y) => [...X].filter((v) => !Y.has(v)).join(",") || "-";
      console.log(`! DRIFTED (jaccard ${jac.toFixed(2)}): +[${only(A, B)}] vs +[${only(B, A)}]`);
      for (const s of [...groups.get(ka), ...groups.get(kb)])
        console.log(`    ${s.file}:${s.line} [${s.kind}]`);
    }
  }
console.log(`\ngroups: ${n}  drifted-pairs: ${d}  (files: ${files.length})`);
