import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/page/LegalDoc";

export const metadata: Metadata = {
  title: "Cookie notice",
  description: "Spica uses no advertising or tracking cookies. Only what is needed to keep you signed in.",
};

export default function CookiesPage() {
  return (
    <LegalDoc
      title="Cookie notice"
      lead="No advertising or tracking cookies, so there is no cookie banner."
      updated="16 November 2026"
      sections={[
        {
          id: "website",
          title: "This website",
          body: (
            <p>
              This website sets no cookies and uses no analytics or advertising tools. Its fonts are served from this website itself. If you send a
              demo request, the details you type are sent to Edstellar so that we can reply.
            </p>
          ),
        },
        {
          id: "app",
          title: "The Spica app",
          body: (
            <p>
              When you sign in to Spica, we use only the cookies and browser storage needed to keep you signed in and to remember your settings, such
              as your language. We do not use advertising or tracking cookies. Spica&apos;s fonts are served from Spica&apos;s own servers, so no
              font service receives your IP address.
            </p>
          ),
        },
        {
          id: "choices",
          title: "Your choices",
          body: (
            <p>
              You can clear cookies and browser storage in your browser settings at any time. If you do, you will be signed out of Spica.
            </p>
          ),
        },
        {
          id: "more",
          title: "More information",
          body: (
            <p>
              See the <Link href="/legal">privacy notices</Link> for how Spica uses personal data.
            </p>
          ),
        },
      ]}
    />
  );
}
