#### Platform checks at the first deploy

- **The lock on `dialed-media`'s `quarantine/` prefix**, before friends. With
  the bucket lock rule in place (`docs/deployment.md`, "Lock
  `quarantine/`"), put one test object under `quarantine/` through the
  Worker's `MEDIA` binding (a one-off `wrangler dev --remote` script), then
  through the same binding delete it and put it again. Note what each
  answers: whether it throws, and its message. The test object stays for
  the lock's 365 days.
