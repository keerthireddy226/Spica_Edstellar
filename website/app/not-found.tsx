import Link from "next/link";
import { Header } from "@/components/Header";

export default function NotFound() {
  return (
    <div className="site">
      <Header />
      <section className="section">
        <div className="wrap" style={{ maxWidth: 720, textAlign: "center" }}>
          <p className="eyebrow">Page not found</p>
          <h1>We couldn&apos;t find that page</h1>
          <p className="lead" style={{ margin: "16px auto 0" }}>
            The link may be old or mistyped. These pages are a good place to start.
          </p>
          <div className="actions" style={{ justifyContent: "center" }}>
            <Link className="btn primary" href="/">
              Go to the home page
            </Link>
            <Link className="btn ghost" href="/tests">
              See the tests
            </Link>
            <Link className="btn ghost" href="/certificate-check">
              Check a certificate
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
