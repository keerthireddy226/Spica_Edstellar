# Recruitment

Spica has two products. An organization buys one or both:

| Product | For | Paid by |
|---|---|---|
| Employee skills (`skills`) | Measuring and training employees' English: licenses, batches, Managers, placement, roadmap, practice. | License-months, by plan tier. |
| Recruitment (`recruitment`) | One proctored English test per job candidate, results for the recruiter. | Assessment credits: one per invited candidate. |

`tenants.products` holds the choice. Edstellar staff set it when onboarding an
organization and change it later in the organization window (**Products &
recruitment**). Each console shows only the products the organization has;
the API refuses employee-skills changes (batches, Managers, learners, license
actions) for a recruitment-only organization.

## Roles

- **Org Admin**: everything for their organization, including recruitment, recruiters and both proctoring policies.
- **Recruiter** (new): job openings, candidates, decisions, and integrity reviews of candidates only. Never sees employees. Signs in on the organization login page.
- **Candidate** (new): no password. The emailed link signs them in for six hours to their one assessment; every other page redirects back to it.

## Flow

1. A recruiter creates a **job opening**: title, the test (adaptive level test or one of the four fixed tests), an optional minimum CEFR level, how long links stay valid, and whether candidates see their level.
2. They **invite** people one by one or by pasting a list. Each invitation uses one credit; duplicates for the same job are skipped. The candidate gets an email in the organization's language.
3. The candidate opens the link, sees what the test needs (camera, microphone, screen, ID), and starts. The candidates' **proctoring policy** applies: separate from the employees' policy and strict by default. The ID selfie (or the first clear snapshot) becomes their face reference.
4. On finishing, the result is stored on the assessment, the Org Admin and the inviting recruiter are notified, and the `assessment.completed` webhook fires. The candidate sees a thank-you screen (and their level only if the job allows it).
5. The recruiter compares candidates per job (best result first), opens a **report** (level per skill or per section, integrity status, ID check, timeline), prints it or saves it as PDF for the hiring manager, and records **shortlisted / hired / rejected** (`assessment.decided` webhook). CSV export per job.

## Credits

Ledger in `recruitment_credit_events`; the balance is the sum. Staff add
credits (purchased, free/trial, adjustment) with a note. Invitations cancelled
or expired before they were started are refunded automatically; resending an
expired link charges again. Price per assessment: the rate card in
`src/recruitment/service.ts` or a contract price per organization. Org Admins
see their balance on the Plan and Recruitment pages and can request more
credits, which notifies their Edstellar contact.

## Data

An hourly job expires links, refunds unused credits, sends a reminder two
days before a link expires, and erases candidates a set number of days
(default 180, chosen by the Org Admin) after the hiring decision. Results stay
as anonymous numbers.

## Left for later

| Item | What it needs |
|---|---|
| Buying credits online | Card payment for credits through the existing checkout, once payment keys are configured. Today staff add credits against an invoice. |
| Native ATS connectors (Workday, Greenhouse, Lever) | Today results reach an ATS through webhooks and CSV. Native connectors need each vendor's partner API access. |
| Translations | Spanish is complete; 14 more languages still need the new screens. |
