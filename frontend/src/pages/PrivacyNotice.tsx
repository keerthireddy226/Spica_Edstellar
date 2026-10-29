import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/constants/routes";

// The Privacy Notice people agree to at sign-up (version = last updated date,
// PRIVACY_NOTICE_VERSION in backend/src/auth/schemas.ts). One page for every
// country: the same promises everywhere, plus the extra rights some laws give.
// English only until it has had a legal review; then it can be translated.
const LAST_UPDATED = "29 October 2026";
// To be confirmed before publishing.
const CONTACT_EMAIL = "[privacy contact email]";
const GRIEVANCE_OFFICER = "[name of the Grievance Officer]";
const COMPANY = "Edstellar";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
      <div className="flex flex-col gap-2 text-sm text-ink leading-relaxed">{children}</div>
    </section>
  );
}

export function PrivacyNotice() {
  return (
    <div className="min-h-screen bg-paper-warm px-4 py-10">
      <article className="mx-auto max-w-3xl bg-surface border border-rule rounded-card shadow-sm p-6 md:p-10 flex flex-col gap-7">
        <header className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Spica by {COMPANY}</p>
          <h1 className="font-display font-bold text-2xl text-ink">Privacy Notice</h1>
          <p className="text-sm text-muted">Last updated {LAST_UPDATED}. This notice applies to everyone who uses Spica, in every country.</p>
        </header>

        <div className="rounded-input bg-paper-warm p-4 flex flex-col gap-1.5 text-sm text-ink">
          <p className="font-semibold">In short</p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>We collect what we need to run your English practice and tests: your account details, your answers, and, for proctored tests, camera, microphone and screen recordings.</li>
            <li>Your spoken and written answers are marked by AI. Face and voice matching run on our own server.</li>
            <li>We never sell your data or use it for advertising.</li>
            <li>Test recordings are deleted automatically: after 30 days if nothing needed checking, or later if a test was flagged for review.</li>
            <li>You can download or delete your data at any time, and withdraw your agreement to face and voice checks.</li>
          </ul>
        </div>

        <Section title="1. Who we are">
          <p>
            Spica is an English learning and assessment service run by {COMPANY}. {COMPANY} decides how your data is used (in data protection terms, the "data controller" or
            "data fiduciary"). If your employer, university or a recruiter gave you access, they also receive your results; see section 5.
          </p>
          <p>Contact us about privacy at {CONTACT_EMAIL}.</p>
        </Section>

        <Section title="2. What we collect">
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li><b>Account details:</b> name, email address, password (stored only in scrambled form), language and voice choices.</li>
            <li><b>Optional details</b>, only if you choose to give them: country, city, job role, gender and age range.</li>
            <li><b>Your learning and test data:</b> answers, spoken answers (audio recordings), written answers, scores, levels, certificates and progress.</li>
            <li><b>Proctoring data, for proctored tests only:</b> camera photos during the test (kept only when something looks wrong, plus an occasional sample), a room scan, screen recording, a voice sample, a photo of your ID and a selfie, and events such as leaving the test tab. You are told exactly what a test collects before it starts, and you agree on that screen.</li>
            <li><b>Face and voice "templates"</b> (number patterns made from your face and voice) to check that the same person takes the whole test. These are only made if you agree, and you can withdraw at any time.</li>
            <li><b>Payment details</b>, if you buy something: handled by our payment providers. We do not see or store your card number.</li>
            <li><b>Technical data:</b> IP address, browser type and login times, used for security.</li>
          </ul>
        </Section>

        <Section title="3. Why we use it">
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>To give you the service: practice, lessons, tests, scores, certificates and reports.</li>
            <li>To keep tests fair: proctoring and identity checks. Nothing fails you automatically; anything unusual is checked by a person.</li>
            <li>To keep accounts secure and prevent misuse.</li>
            <li>To send you emails you need: account confirmation, password reset, test invitations and results.</li>
            <li>To improve Spica, using combined statistics that do not identify you.</li>
          </ul>
          <p>
            Where the law requires a legal basis, we rely on: carrying out our agreement with you (or your organization); your consent (for face and voice checks, optional details, and
            proctoring); and our legitimate interest in keeping tests fair and the service secure.
          </p>
        </Section>

        <Section title="4. AI marking">
          <p>
            Your spoken and written answers are sent to AI platforms to be marked. We use their paid business services, whose terms do not allow them to use your answers to
            train their models. Scores can be reviewed by a person, and you can ask for a review by contacting us.
          </p>
        </Section>

        <Section title="5. Who receives your data">
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li><b>Your organization</b> (employer, university or recruiter), if it gave you access: your results, reports and, for proctored tests, the review of your test.</li>
            <li><b>Service providers</b> that work for us under contract and only on our instructions: cloud hosting and storage, AI marking, email delivery and payment processing.</li>
            <li><b>Authorities</b>, only when the law requires it.</li>
          </ul>
          <p>We do not sell your data and do not share it for advertising.</p>
        </Section>

        <Section title="6. Where your data is stored">
          <p>
            Your data is stored on secure cloud servers, which may be outside your country. When data leaves your country, we rely on the safeguards the law requires, such as
            standard contractual clauses with our providers.
          </p>
        </Section>

        <Section title="7. How long we keep it">
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>Proctoring recordings, photos and ID images: 30 days after the test if nothing was flagged. A flagged test keeps them for 90 days or the period your organization sets, and up to 1 year while it is still under review.</li>
            <li>Proctoring event logs: 1 year.</li>
            <li>Job candidates' data: deleted when the recruiter's retention period ends.</li>
            <li>Your account, answers and results: while your account is open. When you delete your account or data, it is erased.</li>
            <li>Data download files: 7 days.</li>
          </ul>
        </Section>

        <Section title="8. Your rights">
          <p>Wherever you live, you can:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>See and download your data (Profile → Download my data).</li>
            <li>Correct your details.</li>
            <li>Delete your account and data (Profile → Delete my account).</li>
            <li>Withdraw your agreement to face and voice checks at any time. Withdrawing doesn't affect what was done before.</li>
            <li>Ask us questions or complain, at {CONTACT_EMAIL}. We reply within 30 days.</li>
          </ul>
          <p className="font-semibold mt-1">Extra rights in some countries</p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>
              <b>India (Digital Personal Data Protection Act, 2023):</b> you can contact our Grievance Officer, {GRIEVANCE_OFFICER}, at {CONTACT_EMAIL}. If you are not satisfied
              with our reply, you can complain to the Data Protection Board of India. You can also name a person to use your rights if you die or cannot act yourself.
            </li>
            <li>
              <b>European Union, EEA and United Kingdom (GDPR):</b> you can also object to our use of your data, ask us to limit it, and receive it in a portable format. You can
              complain to your local data protection authority.
            </li>
            <li>
              <b>United States, including California:</b> we do not sell or share personal information for advertising. You can ask what we hold and ask us to delete it, and we will
              not treat you differently for asking.
            </li>
            <li><b>Other countries:</b> we honour the rights your local law gives you. Contact us and we will help.</li>
          </ul>
        </Section>

        <Section title="9. Children">
          <p>
            Spica is for people aged 18 and over. When you agree to this notice, you confirm that you are 18 or older. If you believe someone younger has given us data, contact
            us and we will delete it.
          </p>
        </Section>

        <Section title="10. Security">
          <p>
            We use encrypted connections, scrambled passwords, optional two-step login, access limited by role, and an audit log of who does what. If a data breach affects you, we
            will tell you and the authorities as the law requires.
          </p>
        </Section>

        <Section title="11. Cookies">
          <p>We use only the cookies needed to keep you logged in and remember your settings. We do not use advertising or tracking cookies.</p>
        </Section>

        <Section title="12. Changes to this notice">
          <p>If we change this notice, we will ask you to read and agree to the new version the next time you use Spica.</p>
        </Section>

        <p className="text-sm text-muted border-t border-rule pt-4">
          Questions? Email {CONTACT_EMAIL}.{" "}
          <Link to={ROUTES.SIGNUP} className="underline">
            Back to sign up
          </Link>
        </p>
      </article>
    </div>
  );
}
