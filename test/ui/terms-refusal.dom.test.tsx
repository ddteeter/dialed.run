import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX, SyntheticEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { TERMS_NOT_ACCEPTED_CODE } from "../../src/lib/auth-signal";
import {
  forgetSession,
  isRememberedForSession,
} from "../../src/lib/browser/session-memo";
import { gateOnHandle } from "../../src/modules/account/route-decisions";
import type { HandleGateAnswer } from "../../src/modules/account/username";
import {
  FormStatus,
  TermsRefusalAnswer,
  useControlAction,
  useFormSubmit,
} from "../../src/ui";

/**
 * A stale tab behind on the terms (ACC-6; decision D-96): the server's
 * `TERMS_NOT_ACCEPTED` sends the runner straight to the prompt, from a
 * control or a form, with no band and nothing announced — and forgets the
 * root gate's has-handle memo, so an in-app navigation afterwards asks the
 * gate again rather than walking past it. Driven through a real router and
 * the real root gate: a `page.goto` would reload the page and empty the
 * memo, hiding exactly the bug this is about.
 */

/**
A server function's refusal, as it arrives: a plain object, cloned.
*/
async function refused(): Promise<never> {
  await Promise.resolve();
  throw Object.assign(new Error("Accept the current terms first."), {
    code: TERMS_NOT_ACCEPTED_CODE,
  });
}

/**
A server function failing for a reason that is not the terms.
*/
async function broke(): Promise<never> {
  await Promise.resolve();
  throw new Error("D1 down");
}

const RUNNER = "01RUNNER";

/**
 * What the pages below call: the terms refusal unless a test swaps it.
 */
const calls: { action: () => Promise<never> } = { action: refused };

beforeEach(() => {
  calls.action = refused;
});

function Saver({ isSave }: Readonly<{ isSave?: boolean }> = {}) {
  const save = useControlAction<[]>({
    action: () => calls.action(),
    kicker: "Not saved",
    isSave,
  });
  return (
    <>
      <FormStatus>{save.status}</FormStatus>
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

const nameSchema = z.object({ name: z.string() });

function NameForm() {
  const form = useFormSubmit({
    schema: nameSchema,
    action: () => calls.action(),
    successMessage: "Saved.",
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
 * The app in miniature: the root gate (memoised, as in the browser), the
 * provider the root mounts, the page making the refused call, the prompt,
 * and somewhere else to go.
 */
async function app(
  Page: () => JSX.Element,
  isAnswered = true,
  start = "/closet?tab=shoes",
) {
  const gate: { answer: Exclude<HandleGateAnswer["gate"], "signed-out"> } = {
    answer: "has-handle",
  };
  const ask = vi.fn((): Promise<HandleGateAnswer> =>
    Promise.resolve({ gate: gate.answer, userId: RUNNER }),
  );
  const rootRoute = createRootRoute({
    beforeLoad: async ({ location }) => {
      await gateOnHandle({
        ask,
        pathname: location.pathname,
        isInBrowser: true,
      });
    },
    // The page making the call sits above the outlet, so it is still
    // there once the prompt opens, and what it did or did not say can be
    // read.
    component: () =>
      isAnswered ? (
        <TermsRefusalAnswer>
          <Page />
          <Link to="/feed">Feed</Link>
          <Outlet />
        </TermsRefusalAnswer>
      ) : (
        <>
          <Page />
          <Outlet />
        </>
      ),
  });
  const closet = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet",
    component: () => <h1>Closet</h1>,
  });
  // A page whose name in the runner's words is not its heading (D-102).
  const newPiece = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet/new",
    staticData: { savedPage: "Add a piece" },
    component: () => <h1>Add a garment</h1>,
  });
  const edit = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet/edit/$itemId",
    component: () => <h1>Edit Harrier</h1>,
  });
  // A layout naming every page under it, as `/runs/new` and
  // `/runs/manual` could share "Log a run"; and a page with no heading.
  const logging = createRoute({
    getParentRoute: () => rootRoute,
    id: "logging",
    staticData: { savedPage: "Log a run" },
    component: () => <Outlet />,
  });
  const byHand = createRoute({
    getParentRoute: () => logging,
    path: "/runs/manual",
    component: () => <h1>Enter it by hand</h1>,
  });
  const blank = createRoute({
    getParentRoute: () => rootRoute,
    path: "/blank",
    component: () => <p>No heading</p>,
  });
  const feed = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed",
    component: () => <h1>Feed</h1>,
  });
  const prompt = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account/terms",
    component: () => <h1>Accept the terms</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      closet,
      newPiece,
      edit,
      logging.addChildren([byHand]),
      blank,
      feed,
      prompt,
    ]),
    history: createMemoryHistory({ initialEntries: [start] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { router, ask, gate };
}

beforeEach(() => {
  forgetSession();
});

describe("a refusal for being behind on the terms (D-96)", () => {
  it("opens the prompt from a control, carrying where the runner was, and announces nothing", async () => {
    const { router, gate } = await app(Saver);
    expect(isRememberedForSession("has-handle")).toBe(true);
    // A deploy publishes newer terms under the open tab.
    gate.answer = "needs-terms";

    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("heading", { name: "Accept the terms" });
    expect(router.state.location.pathname).toBe("/account/terms");
    // A plain control lost nothing typed, so nothing names the page.
    expect(router.state.location.search).toEqual({
      from: "/closet?tab=shoes",
    });
    expect(router.state.location.searchStr).not.toContain("save");
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByTestId("band")).toHaveTextContent("");
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("opens the prompt from a form, with no failure band and no sentence, naming the page by its heading", async () => {
    const { router, gate } = await app(NameForm);
    gate.answer = "needs-terms";

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Submit" }));

    await screen.findByRole("heading", { name: "Accept the terms" });
    expect(router.state.location.pathname).toBe("/account/terms");
    // A form's refusal is a save (D-102): `save` names the page it left.
    expect(router.state.location.search).toEqual({
      from: "/closet?tab=shoes",
      save: "Closet",
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByTestId("band")).toHaveTextContent("");
  });

  it.each([
    ["/closet/edit/01HARRIER", "Edit Harrier"],
    ["/closet/new", "Add a piece"],
    ["/runs/manual", "Log a run"],
  ])(
    "names the page a refused save left, from %s, as %s: the nearest route's own words before its heading",
    async (start, name) => {
      const { router, gate } = await app(NameForm, true, start);
      gate.answer = "needs-terms";

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Submit" }));

      await screen.findByRole("heading", { name: "Accept the terms" });
      expect(router.state.location.search).toEqual({
        from: start,
        save: name,
      });
    },
  );

  it("names no page that has neither words of its own nor a heading", async () => {
    const { router, gate } = await app(NameForm, true, "/blank");
    gate.answer = "needs-terms";

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Submit" }));

    await screen.findByRole("heading", { name: "Accept the terms" });
    expect(router.state.location.search).toEqual({ from: "/blank" });
    expect(router.state.location.searchStr).not.toContain("save");
  });

  it("names the page from a control that saves, as Attach does", async () => {
    const { router, gate } = await app(() => <Saver isSave />);
    gate.answer = "needs-terms";

    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("heading", { name: "Accept the terms" });
    expect(router.state.location.search).toEqual({
      from: "/closet?tab=shoes",
      save: "Closet",
    });
  });

  it("asks the gate again on the next in-app navigation, which comes back to the prompt", async () => {
    const { router, ask, gate } = await app(Saver);
    expect(ask).toHaveBeenCalledTimes(1);
    gate.answer = "needs-terms";
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Accept the terms" });
    const asked = ask.mock.calls.length;

    // Away from the prompt, in-app: the memo would have let this through.
    await user.click(screen.getByRole("link", { name: "Feed" }));

    await waitFor(() => {
      expect(ask.mock.calls.length).toBeGreaterThan(asked);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/account/terms");
    });
    expect(screen.queryByRole("heading", { name: "Feed" })).toBeNull();
  });

  it("leaves any other failure to the control's band, even with the answer above", async () => {
    calls.action = broke;
    const { router } = await app(Saver);

    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("band")).toHaveTextContent("Our end failed.");
    });
    expect(router.state.location.pathname).toBe("/closet");
    expect(isRememberedForSession("has-handle")).toBe(true);
  });

  it("leaves any other failure to the form's band, even with the answer above", async () => {
    calls.action = broke;
    const { router } = await app(NameForm);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Nothing saved. Our end failed. Nothing changed.",
      );
    });
    expect(router.state.location.pathname).toBe("/closet");
  });

  it("is the refusal's cause line where nothing above answers it", async () => {
    const { router } = await app(Saver, false);

    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("band")).toHaveTextContent(
        "Accept the current terms first.",
      );
    });
    expect(router.state.location.pathname).toBe("/closet");
  });

  it("is a form's failure band where nothing above answers it", async () => {
    await app(NameForm, false);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Nothing saved. Accept the current terms first.",
      );
    });
    expect(screen.getByTestId("band")).toHaveTextContent(
      "Accept the current terms first.",
    );
  });
});
