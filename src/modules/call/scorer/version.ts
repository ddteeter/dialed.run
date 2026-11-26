/**
 * The scorer's version. The call log stores it with every served Call and
 * the replay harness keys on it (design 194, "Engine releases"), so it
 * changes whenever a change to this sub-module can change a result.
 */
export const ENGINE_VERSION = "scorer-1";
