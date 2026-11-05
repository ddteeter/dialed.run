-- Link shorteners and redirectors, denied from the start (R-176, design 171).
-- Data, not code: the owner's list, answered 2026-11-05.
--
-- A link through one of these goes wherever its owner points it, and the
-- denylist checks only the link as typed and the page enrichment landed
-- on, so a runner's link through one is refused rather than trusted to
-- land somewhere allowed. Hosts like l.facebook.com deny that subdomain
-- only: the suffix rule denies what is under a row, never what is above it.
--
-- Left off on purpose: amzn.to and a.co (runners paste them for real
-- products, and enrichment checks where they land), linktr.ee (a page of
-- links, not a redirect) and google.com (its /url redirect cannot be
-- denied without denying Google).
--
-- INSERT OR IGNORE on the primary key makes it re-runnable, and leaves a
-- domain an operator already denied as they wrote it.
INSERT OR IGNORE INTO domain_denylist (domain, added_by, reason, created_at) VALUES
  ('bit.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('bitly.com', 'seed', 'link shortener (R-176)', 1793836800),
  ('tinyurl.com', 'seed', 'link shortener (R-176)', 1793836800),
  ('t.co', 'seed', 'link shortener (R-176)', 1793836800),
  ('goo.gl', 'seed', 'link shortener (R-176)', 1793836800),
  ('ow.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('buff.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('is.gd', 'seed', 'link shortener (R-176)', 1793836800),
  ('v.gd', 'seed', 'link shortener (R-176)', 1793836800),
  ('rebrand.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('cutt.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('shorturl.at', 'seed', 'link shortener (R-176)', 1793836800),
  ('rb.gy', 'seed', 'link shortener (R-176)', 1793836800),
  ('tiny.cc', 'seed', 'link shortener (R-176)', 1793836800),
  ('s.id', 'seed', 'link shortener (R-176)', 1793836800),
  ('t.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('bl.ink', 'seed', 'link shortener (R-176)', 1793836800),
  ('shorte.st', 'seed', 'link shortener (R-176)', 1793836800),
  ('adf.ly', 'seed', 'link shortener (R-176)', 1793836800),
  ('lnkd.in', 'seed', 'link shortener (R-176)', 1793836800),
  ('fb.me', 'seed', 'link shortener (R-176)', 1793836800),
  ('qr.ae', 'seed', 'link shortener (R-176)', 1793836800),
  ('l.facebook.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('lm.facebook.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('l.instagram.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('out.reddit.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('l.messenger.com', 'seed', 'link redirector (R-176)', 1793836800),
  ('href.li', 'seed', 'link redirector (R-176)', 1793836800),
  ('anon.to', 'seed', 'link redirector (R-176)', 1793836800),
  ('dereferer.org', 'seed', 'link redirector (R-176)', 1793836800),
  ('nullrefer.com', 'seed', 'link redirector (R-176)', 1793836800);
