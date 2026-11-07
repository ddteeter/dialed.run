import { rowsReadOf } from "./query-tally";

/**
 * Statements that report each run (design 182): the one counter behind
 * both the scaling tests' spy (`test/d1-spy.ts`) and a tallied request
 * scope (`d1-session.ts`), so the two cannot count differently.
 *
 * `run()`, `all()` and `batch()` hand back `meta.rows_read`; `raw()` and
 * `first()` carry no meta, and drizzle reads every query with fields
 * through `raw()`. So for a read through either, the statement is run once
 * more with `all()` for its meta, uncounted. A select cannot change
 * anything, so the second run changes nothing but the rows read; a write
 * read through `raw()` (`.returning()`) reports no rows read, since running
 * it twice would write twice.
 */
export type OnRun = (rowsRead: number) => void;

/**
 * `real`, reporting each run to `onRun`. `isRead` says whether a `raw()` or
 * `first()` may be run again to meter it. A Proxy rather than a class:
 * `raw` and `first` are overloaded generics no class can restate.
 *
 * Those four and `bind` are all the methods a D1 statement has (workerd's
 * `D1PreparedStatement`); what else it carries is data (`statement`,
 * `params`), read through from the real one. That is also why a batch can
 * take counted statements as they are: it reads only that data.
 */
export function countedStatement(
  real: D1PreparedStatement,
  isRead: boolean,
  onRun: OnRun,
): D1PreparedStatement {
  return new Proxy(real, {
    get(target, property) {
      switch (property) {
        case "bind": {
          return (...values: unknown[]) =>
            countedStatement(target.bind(...values), isRead, onRun);
        }
        case "run":
        case "all": {
          return async () => {
            const result = await target[property]();
            onRun(rowsReadOf(result));
            return result;
          };
        }
        case "raw":
        case "first": {
          return async (...args: unknown[]) => {
            const method = target[property].bind(target);
            const result: unknown = await Reflect.apply(method, target, args);
            onRun(isRead ? rowsReadOf(await target.all()) : 0);
            return result;
          };
        }
        default: {
          const value: unknown = Reflect.get(target, property, target);
          return value;
        }
      }
    },
  });
}

/**
A batch's results, each statement's reported to `onRun`.
*/
export async function countedBatch<T>(
  running: Promise<D1Result<T>[]>,
  onRun: OnRun,
): Promise<D1Result<T>[]> {
  const results = await running;
  for (const result of results) onRun(rowsReadOf(result));
  return results;
}
