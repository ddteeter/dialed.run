import { createFileRoute } from "@tanstack/react-router";

import { joinSearch, onToSignUp } from "../modules/auth/sign-in-search";

/**
 * `/join?code=` (task 126, ACC-5; round 26 #20): the invite email's
 * "Create your account" and D7's Copy link land here, and go on to Au2
 * with the code filled in.
 */
export const Route = createFileRoute("/join")({
  validateSearch: joinSearch,
  beforeLoad: ({ search }) => {
    onToSignUp(search);
  },
});
