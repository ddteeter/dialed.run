/**
 * The scorer's version. The call log stores it with every served Call and
 * the replay harness keys on it (design 194, "Engine releases"), so once
 * a version has served a Call, any change to this sub-module that can
 * change a result takes a new one. `scorer-1` is the first to ship.
 */
export const ENGINE_VERSION = "scorer-1";
