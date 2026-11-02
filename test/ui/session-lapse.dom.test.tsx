import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX, SyntheticEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AUTH_REQUIRED_CODE } from "../../src/lib/auth-signal";
import {
  CARRIED_EMAIL_KEY,
  readCarriedEmail,
  writeCarriedEmail,
} from "../../src/lib/browser/carried-email";
import type { CarriedForm } from "../../src/lib/carried-form";
import {
  FormStatus,
  SessionLapseAnswer,
  useControlAction,
  useFormSubmit,
} from "../../src/ui";

/**
 * Au7's sending half: a carrying form whose save is refused because the
 * session lapsed goes to log-in with the page it left, the form's noun and
 * the runner's address — no band, nothing announced. Driven through a real
 * router with the provider the root mounts.
 */

/**
A server function's lapsed-session refusal, as it arrives: cloned.
*/
async function lapsed(): Promise<never> {
  await Promise.resolve();
  throw Object.assign(new Error("Not signed in"), {
    code: AUTH_REQUIRED_CODE,
  });
}

const nameSchema = z.object({ name: z.string() });

/**
A failure that is not the session: the carry is for a lapse only.
*/
async function broke(): Promise<never> {
  await Promise.resolve();
  throw new Error("D1 down");
}

function NameForm({
  carry,
  action = lapsed,
}: Readonly<{ carry?: CarriedForm; action?: () => Promise<never> }>) {
  const form = useFormSubmit({
    schema: nameSchema,
    action,
    successMessage: "Saved.",
    carry,
  });
  return (
    <form
      onSubmit={(event: SyntheticEvent) => {
        event.preventDefault();
        void form.submit({ name: "dee" });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <button type="submit">Submit</button>
      <p data-testid="band">{form.failure?.message ?? ""}</p>
    </form>
  );
}

/**
A control never carries: a lapse there stays its own failure line.
*/
function Saver() {
  const save = useControlAction<[]>({ action: lapsed, kicker: "Not saved" });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void save.run();
        }}
      >
        Save
      </button>
      <p data-testid="band">{save.failure?.message ?? ""}</p>
    </>
  );
}

async function app(
  Page: () => JSX.Element,
  {
    isAnswered = true,
    rootData = { signedIn: true, email: "dana.k@hey.com" },
  }: Readonly<{ isAnswered?: boolean; rootData?: unknown }> = {},
) {
  const rootRoute = createRootRoute({
    // "unloaded" stands for a root whose loader handed nothing down.
    loader: () => (rootData === "unloaded" ? undefined : rootData),
    // The page sits above the outlet, so what it said can still be read
    // once log-in has opened.
    component: () =>
      isAnswered ? (
        <SessionLapseAnswer>
          <Page />
          <Outlet />
        </SessionLapseAnswer>
      ) : (
        <>
          <Page />
          <Outlet />
        </>
      ),
  });
  const runs = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/manual",
    component: () => <h1>Enter it by hand</h1>,
  });
  const login = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth/login",
    component: () => <h1>Log in</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([runs, login]),
    history: createMemoryHistory({ initialEntries: ["/runs/manual?at=7"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { router };
}

async function press(name: string): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("a carrying form's lapsed session (Au7)", () => {
  it("goes to log-in with the page it left and its noun, keeps the address, and shows no band", async () => {
    const { router } = await app(() => <NameForm carry="garment" />);

    await press("Submit");

    await screen.findByRole("heading", { name: "Log in" });
    expect(router.state.location.pathname).toBe("/auth/login");
    expect(router.state.location.search).toEqual({
      redirect: "/runs/manual?at=7",
      carried: "garment",
    });
    expect(readCarriedEmail()).toBe("dana.k@hey.com");
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByTestId("band")).toHaveTextContent("");
  });

  it.each([
    ["no address", { signedIn: true }],
    ["an address that is not one", { signedIn: true, email: "<script>" }],
    ["no loader data", "unloaded"],
  ])(
    "still goes to log-in with %s, and clears an older carried address",
    async (_case, rootData) => {
      sessionStorage.setItem(CARRIED_EMAIL_KEY, "someone.else@hey.com");
      const { router } = await app(() => <NameForm carry="run" />, {
        rootData,
      });

      await press("Submit");

      await screen.findByRole("heading", { name: "Log in" });
      expect(router.state.location.search).toEqual({
        redirect: "/runs/manual?at=7",
        carried: "run",
      });
      expect(sessionStorage.getItem(CARRIED_EMAIL_KEY)).toBeNull();
    },
  );

  it("is the band for a form that carries nothing", async () => {
    const { router } = await app(() => <NameForm />);

    await press("Submit");

    expect(await screen.findByTestId("band")).toHaveTextContent(
      "You were signed out.",
    );
    expect(router.state.location.pathname).toBe("/runs/manual");
    expect(sessionStorage.getItem(CARRIED_EMAIL_KEY)).toBeNull();
  });

  it("is the band, and stays put, when a carrying form fails for another reason", async () => {
    const { router } = await app(() => <NameForm carry="run" action={broke} />);

    await press("Submit");

    expect(await screen.findByTestId("band")).toHaveTextContent(
      "Our end failed. Nothing changed.",
    );
    expect(router.state.location.pathname).toBe("/runs/manual");
  });

  it("is the band with no provider above the form", async () => {
    const { router } = await app(() => <NameForm carry="run" />, {
      isAnswered: false,
    });

    await press("Submit");

    expect(await screen.findByTestId("band")).toHaveTextContent(
      "You were signed out.",
    );
    expect(router.state.location.pathname).toBe("/runs/manual");
  });

  it("leaves a control's lapse as its own failure line", async () => {
    const { router } = await app(Saver);

    await press("Save");

    expect(await screen.findByTestId("band")).not.toHaveTextContent(/^$/u);
    expect(router.state.location.pathname).toBe("/runs/manual");
  });
});

describe("the carried address in session storage", () => {
  it("is written and read back under the key log-in reads", () => {
    writeCarriedEmail("dana.k@hey.com");
    expect(sessionStorage.getItem(CARRIED_EMAIL_KEY)).toBe("dana.k@hey.com");
    expect(readCarriedEmail()).toBe("dana.k@hey.com");
  });

  it("reads nothing that is not an address", () => {
    sessionStorage.setItem(CARRIED_EMAIL_KEY, "<script>");
    expect(readCarriedEmail()).toBeUndefined();
  });

  it("never throws when storage is refused", () => {
    vi.spyOn(globalThis, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => {
      writeCarriedEmail("dana.k@hey.com");
    }).not.toThrow();
    expect(() => {
      writeCarriedEmail(undefined);
    }).not.toThrow();
    expect(readCarriedEmail()).toBeUndefined();
  });
});
