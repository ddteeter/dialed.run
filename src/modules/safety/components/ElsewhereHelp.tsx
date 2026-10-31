import type { JSX } from "react";

/**
 * The two hash-sharing services the FTC points people to, by the age of
 * whoever is in the image when it was taken: StopNCII for adults, NCMEC's
 * Take It Down for minors. Each fingerprints the image on the person's own
 * device and shares only the fingerprint with the platforms that take part.
 */
const SERVICES = [
  {
    name: "StopNCII.org",
    href: "https://stopncii.org/",
    who: "if the person in it was 18 or over when it was taken",
  },
  {
    name: "Take It Down",
    href: "https://takeitdown.ncmec.org/",
    who: "if they were under 18",
  },
] as const;

/**
 * Where else to go (D-147, round 41 #85): a removal here covers this site
 * only, and a person asking for one may have the image on others. The age
 * is the person's in the image, when it was taken — not the reader's.
 *
 * Last in a receipt's body, after a --hairline, so the decision we owe
 * comes first: TYPE.small, --quiet. On the `/takedown` receipt,
 * `/takedown/confirm`'s DONE, and W1's intimate-image receipt (round 42).
 * External, so anchors rather than the router's `Link`, in the inline-link
 * style (round 42), opened in a new tab so the receipt stays where it was,
 * and saying so to a screen reader.
 */
export function ElsewhereHelp(): JSX.Element {
  const [adults, minors] = SERVICES;
  return (
    <p
      data-part="elsewhere-help"
      className="m-0 border-t border-hairline pt-4 text-small text-quiet"
    >
      If it&apos;s on other sites too, these free services can help stop it
      spreading: <Service service={adults} />, <Service service={minors} />.
      Each makes a fingerprint of the image on your own device; the image never
      leaves it.
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
        <span className="sr-only"> (opens in a new tab)</span>
      </a>{" "}
      {service.who}
    </>
  );
}
