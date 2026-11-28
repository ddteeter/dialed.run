/**
 * `account/purge`: deleting an account's data once its grace runs out
 * (design 240). Its own door, never re-exported by `account/index.ts`: the
 * purge imports `feed`, which imports `account`.
 */
export { livePurgeDeps, purgeDueAccounts } from "./purge";
