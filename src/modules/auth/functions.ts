import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "./index";

/**
Session for the current request; null when signed out.
*/
export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const headers = getRequestHeaders();
    return auth.api.getSession({ headers });
  },
);
