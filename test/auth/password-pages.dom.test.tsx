import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { CredentialFields } from "../../src/modules/auth/auth-page";
import type { FieldProps } from "../../src/ui";
import { AUTH_COPY } from "../../src/modules/auth/auth-copy";
import { ChangePassword } from "../../src/modules/auth/components/ChangePassword";
import { ForgotPassword } from "../../src/modules/auth/components/ForgotPassword";
import { ResetPassword } from "../../src/modules/auth/components/ResetPassword";
import { SignOutButton } from "../../src/modules/auth/components/SignOutButton";
import {
  AuthFieldError,
  ResetLinkExpired,
} from "../../src/modules/auth/credentials";

/**
 * ACC-4 and ACC-7 as a runner meets them: forgot, reset, change, and
 * signing out everywhere.
 */

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

/**
Not secrets: fixtures typed into a form under test.
*/
const LONG = ["a", "long", "passphrase"].join("-");
const OTHER = ["another", "long", "one"].join("-");

/**
A form's `field()` at rest: named, editable, nothing wrong.
*/
function atRest(name: string): FieldProps {
  return {
    name,
    readOnly: false,
    "aria-invalid": undefined,
    "aria-describedby": undefined,
    onInput: typing,
  };
}

function typing(): void {
  // a resting field has no error for input to clear
}

const RESTING_FORM = { field: atRest, fieldErrors: {} };

const passwordField = () => screen.getByLabelText("New password");
const current = () => screen.getByLabelText("Current password");
const next = passwordField;

describe("Au1's Forgot it?", () => {
  it("sits under Password on log-in only, and opens the request", async () => {
    const { rerender } = await renderWithRouter(
      <CredentialFields
        form={RESTING_FORM}
        email=""
        onEmail={vi.fn()}
        password=""
        onPassword={vi.fn()}
        passwordAutoComplete="current-password"
        hasForgotLink
      />,
    );
    const link = screen.getByRole("link", { name: "Forgot it?" });
    expect(link).toHaveAttribute("href", "/account/forgot");
    expect(link).toHaveClass("target");
    rerender(<></>);
  });

  it("is absent from sign-up", async () => {
    await renderWithRouter(
      <CredentialFields
        form={RESTING_FORM}
        email=""
        onEmail={vi.fn()}
        password=""
        onPassword={vi.fn()}
        passwordAutoComplete="new-password"
      />,
    );
    expect(screen.queryByRole("link", { name: "Forgot it?" })).toBeNull();
  });
});

describe("ForgotPassword", () => {
  it("asks for the address, then answers the same whatever it was", async () => {
    const request = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    await renderWithRouter(<ForgotPassword request={request} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Forgot your password?" }),
    ).toBeVisible();
    expect(
      screen.getByText("We'll email you a link to set a new one."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "maya@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send link" }));

    expect(request).toHaveBeenCalledWith({ email: "maya@example.com" });
    expect(
      await screen.findByRole("heading", { name: "Check your inbox" }),
    ).toBeVisible();
    expect(screen.getByText(/has a dialed\.run account/u)).toHaveTextContent(
      "If maya@example.com has a dialed.run account, a link to set a new password is on its way.",
    );
    expect(
      screen.getByText("It works once, for 1 hour. Not there? Check spam."),
    ).toBeVisible();
    const back = screen.getByRole("link", { name: "Back to log in" });
    expect(back).toHaveAttribute("href", "/auth/login");
    expect(back).toHaveClass("target");
  });

  it("checks the address in the field before sending", async () => {
    const request = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    await renderWithRouter(<ForgotPassword request={request} />);
    await user.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByText("Enter your email address.")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("bands a failed request as Not sent, and keeps the form", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderWithRouter(<ForgotPassword request={request} />);
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "maya@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send link" }));

    const band = await screen.findByText("Our end failed. Nothing changed.");
    expect(band.closest("[data-part=failure-band]")).toHaveTextContent(
      /^Not sent/u,
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Check your inbox" }),
    ).toBeVisible();
  });
});

describe("ResetPassword", () => {
  it("sets the new password with the link's token, then offers log-in", async () => {
    const reset = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    await renderWithRouter(<ResetPassword token="tok" reset={reset} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Set a new password" }),
    ).toBeVisible();
    expect(screen.getByText("At least 10 characters.")).toBeVisible();
    expect(passwordField()).toHaveAttribute("autocomplete", "new-password");
    await user.type(passwordField(), LONG);
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(reset).toHaveBeenCalledWith("tok", { password: LONG });
    expect(
      await screen.findByRole("heading", { name: "Password set" }),
    ).toBeVisible();
    expect(
      screen.getByText("Log in with it. Every other device was signed out."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
  });

  it("holds a short password to sign-up's floor, in the field", async () => {
    const reset = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    await renderWithRouter(<ResetPassword token="tok" reset={reset} />);
    await user.type(passwordField(), "short");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(
      await screen.findByText("Use at least 10 characters."),
    ).toBeVisible();
    expect(reset).not.toHaveBeenCalled();
  });

  it("says a spent or old link has run out, and offers another", async () => {
    const reset = vi.fn(() => Promise.reject(new ResetLinkExpired()));
    const user = userEvent.setup();
    await renderWithRouter(<ResetPassword token="tok" reset={reset} />);
    await user.type(passwordField(), LONG);
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(
      await screen.findByRole("heading", { name: "That link has run out" }),
    ).toBeVisible();
    expect(
      screen.getByText("Reset links work once, for 1 hour. Ask for another."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Send another" })).toHaveAttribute(
      "href",
      "/account/forgot",
    );
  });

  it("says so at once for a link with no token", async () => {
    await renderWithRouter(<ResetPassword token={undefined} reset={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "That link has run out" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("lands a breached password on its field, and a fault on the band", async () => {
    const reset = vi
      .fn()
      .mockRejectedValueOnce(
        new AuthFieldError("password", AUTH_COPY.passwordBreached),
      )
      .mockRejectedValueOnce(new Error("down"));
    const user = userEvent.setup();
    await renderWithRouter(<ResetPassword token="tok" reset={reset} />);
    await user.type(passwordField(), LONG);
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText(AUTH_COPY.passwordBreached)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Set password" }));
    const band = await screen.findByText("Our end failed. Nothing changed.");
    expect(band.closest("[data-part=failure-band]")).toHaveTextContent(
      /^Nothing saved/u,
    );
  });
});

describe("ChangePassword (ACC-7)", () => {
  it("changes it, says every other device was signed out, and clears both fields", async () => {
    const change = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<ChangePassword change={change} />);

    expect(current()).toHaveAttribute("autocomplete", "current-password");
    expect(current()).toHaveAttribute("name", "currentPassword");
    expect(next()).toHaveAttribute("autocomplete", "new-password");
    await user.type(current(), LONG);
    await user.type(next(), OTHER);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(change).toHaveBeenCalledWith({
      currentPassword: LONG,
      password: OTHER,
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Password changed. Every other device was signed out.",
      );
    });
    await waitFor(() => {
      expect(current()).toHaveValue("");
    });
    expect(next()).toHaveValue("");
  });

  it("lands a wrong current password on its own field", async () => {
    const change = vi.fn(() =>
      Promise.reject(
        new AuthFieldError("currentPassword", AUTH_COPY.currentPasswordWrong),
      ),
    );
    const user = userEvent.setup();
    render(<ChangePassword change={change} />);
    await user.type(current(), LONG);
    await user.type(next(), OTHER);
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      await screen.findByText("That password doesn't match your account."),
    ).toBeVisible();
    expect(current()).toHaveAttribute("aria-invalid", "true");
  });

  it("lists both fields when both are missing, by their labels", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<ChangePassword change={change} />);
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "2 fields need a fix.",
      );
    });
    // The summary names each by its label, as a way to it.
    expect(
      screen.getByRole("button", { name: /Current password/u }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /New password/u })).toBeVisible();
    expect(change).not.toHaveBeenCalled();
  });
});

describe("Sign out everywhere (ACC-7)", () => {
  it("says what it does, and what it is doing", async () => {
    const user = userEvent.setup();
    const done = Promise.withResolvers<undefined>();
    const signOut = vi.fn().mockReturnValue(done.promise);
    await renderWithRouter(<SignOutButton isEverywhere signOut={signOut} />);

    const button = screen.getByRole("button", { name: "Sign out everywhere" });
    await user.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button).toHaveTextContent("Signing out everywhere");
    done.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });
});
