import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Devtools, areDevtoolsOff } from "../../src/ui/Devtools";

/**
 * The devtools panel is the one thing in the app a build turns off, and
 * the decision used to be a ternary in `__root.tsx` — the one kind of file
 * no test can import.
 *
 * The real `TanStackDevtools` builds its panel lazily into a shadow root,
 * so the config and plugins we pass it are not observable in the rendered
 * DOM. Rather than declaring that unobservable and suppressing the mutants
 * on those literals, mock both third-party components so the props we hand
 * them land somewhere a query can see — that is what makes the config
 * object, the plugin list and their literals killable instead of merely
 * equivalent.
 */
vi.mock("@tanstack/react-devtools", () => ({
  TanStackDevtools: (props: {
    config?: { position?: string };
    plugins?: { name: string; render: ReactElement }[];
  }) => (
    <div
      data-testid="devtools-mock"
      data-position={props.config?.position ?? ""}
    >
      {(props.plugins ?? []).map((plugin) => (
        <div
          key={plugin.name}
          data-testid="devtools-plugin"
          data-name={plugin.name}
        >
          {plugin.render}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@tanstack/react-router-devtools", () => ({
  TanStackRouterDevtoolsPanel: () => <span data-testid="router-panel" />,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("areDevtoolsOff", () => {
  it("is off only for exactly `off`", () => {
    expect(areDevtoolsOff("off")).toBe(true);
  });

  it("is on for anything else, including nothing at all", () => {
    // The flag is unset in development, which is where devtools are most
    // wanted — so absence has to mean on.
    expect(areDevtoolsOff(undefined)).toBe(false);
    expect(areDevtoolsOff("")).toBe(false);
    expect(areDevtoolsOff("OFF")).toBe(false);
    expect(areDevtoolsOff("false")).toBe(false);
  });
});

describe("Devtools", () => {
  it("renders nothing when the build turned them off", () => {
    vi.stubEnv("VITE_DEVTOOLS", "off");
    const { container } = render(<Devtools />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the panel, positioned bottom-right, with the router plugin wired in", () => {
    vi.stubEnv("VITE_DEVTOOLS", "");
    const { getByTestId } = render(<Devtools />);

    expect(getByTestId("devtools-mock").dataset.position).toBe(
      "bottom-right",
    );
    expect(getByTestId("devtools-plugin").dataset.name).toBe(
      "Tanstack Router",
    );
    expect(getByTestId("router-panel")).toBeInTheDocument();
  });
});
