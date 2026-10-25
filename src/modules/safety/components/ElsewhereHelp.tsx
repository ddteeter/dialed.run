import type { JSX } from "react";

/**
 * The two hash-sharing services the FTC points people to, by the age of
 * whoever is in the image: StopNCII for adults, NCMEC's Take It Down for
 * minors. Each fingerprints the image on the person's own device and
 * shares only the fingerprint with the platforms that take part.
 */
const SERVICES = [
  { name: "StopNCII.org", href: "https://stopncii.org/", who: "18 and over" },
  {
    name: "Take It Down",
    href: "https://takeitdown.ncmec.org/",
    who: "under 18",
  },
] as const;

/**
 * Where else to go (D-147, design 152): a removal here covers this site
 * only, and a person asking for one may have the image on others. Shown on
 * the `/takedown` receipts and on the report sheet's intimate-image branch.
 *
 * **Undesigned copy** (design deltas item 78): one quiet line, the names
 * as plain links. External, so anchors rather than the router's `Link`,
 * opened in a new tab so the receipt stays where it was.
 */
export function ElsewhereHelp(): JSX.Element {
  const [adults, minors] = SERVICES;
  return (
    <p data-part="elsewhere-help" className="m-0 text-small text-muted">
      If it may be on other sites too, <Service service={adults} /> or{" "}
      <Service service={minors} /> can help stop it spreading there. They
      fingerprint the image on your own device; the image never leaves it.
    </p>
  );
}

function Service({
  service,
}: Readonly<{ service: (typeof SERVICES)[number] }>): JSX.Element {
  return (
    <>
      <a
        data-target="inline"
        href={service.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-bold text-ink underline underline-offset-4"
      >
        {service.name}
      </a>{" "}
      ({service.who})
    </>
  );
}
