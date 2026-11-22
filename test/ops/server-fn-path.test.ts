import { describe, expect, it } from "vitest";

import {
  isServerFnWithoutId,
  serverFnIdOf,
} from "../../src/modules/ops/edge/server-fn-path";

const at = (path: string): URL => new URL(path, "https://dialed.run");

describe("a server-function path with no function id", () => {
  it.each([
    "/_serverFn/",
    "/_serverFn//abc",
    "/%5FserverFn/",
    "/_server%46n/",
    "/_serverFn/%20",
    "/%5FserverFn/%20%20",
  ])("%s names no function", (path) => {
    expect(isServerFnWithoutId(at(path))).toBe(true);
  });

  it.each(["/_serverFn/abc", "/_serverFn/abc/", "/feed", "/_serverFnx/", "/"])(
    "%s is left to the framework",
    (path) => {
      expect(isServerFnWithoutId(at(path))).toBe(false);
    },
  );
});

describe("the id a server-function path names", () => {
  it("is the first segment after the prefix, whatever follows it", () => {
    expect(serverFnIdOf(at("/_serverFn/abc/anything/else?x=1"))).toBe("abc");
  });

  it("is read after decoding, as the framework reads it", () => {
    expect(serverFnIdOf(at("/%5FserverFn/abc"))).toBe("abc");
  });

  it("is empty for the bare prefix", () => {
    expect(serverFnIdOf(at("/_serverFn/"))).toBe("");
  });

  it("is absent for a path that is not a server function's", () => {
    expect(serverFnIdOf(at("/kit/abc"))).toBeUndefined();
  });
});
