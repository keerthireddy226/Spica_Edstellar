// Extra content for the "Who it's for" pages (17 Nov 2026): what each audience
// gains and its common questions. Every statement matches what Spica does today.

export const SOLUTION_EXTRAS: Record<string, { benefits: [string, string][]; faq: [string, string][] }> = {
  companies: {
    benefits: [
      ["See every level at a glance", "Each person's level in every skill, by batch and team, in one dashboard."],
      ["Training people actually do", "A study plan for every level, reminders, and managers who see who is practising."],
      ["Proof that it worked", "The same 10–90 scale before and after, and a proctored final assessment with a certificate."],
    ],
    faq: [
      ["How do people join?", "By email invitation or file upload. On Enterprise, accounts can be created from your HR system (SCIM) and people sign in with your company login (SSO)."],
      ["Can managers see only their own people?", "Yes. Managers see only the batches given to them; admins see everyone."],
      ["What does a licence include?", "One learner, Full access, for one month: the main tests, practice, mock tests and progress reports."],
      ["Do unused licences go to waste?", "No. Licences sit in a shared pool: assign them to people, take them back, and give them to someone else."],
    ],
  },
  recruiters: {
    benefits: [
      ["Interview only people who fit", "Set a minimum level for each job opening and see at once who meets it."],
      ["No test centre, no install", "Candidates take one proctored test online, from an email link or your public job link."],
      ["Decide with evidence", "Each report has the level, scores, recordings of spoken answers and suggested interview questions."],
    ],
    faq: [
      ["Do candidates need an account?", "No. Each candidate gets a personal link by email, or applies through the job's public link."],
      ["How do you stop cheating?", "Camera snapshots, ID and face checks, screen sharing and a timeline of the test. People review every flag; nothing fails anyone automatically."],
      ["What if a candidate never starts?", "Credits for invitations that expire unused go back to your balance."],
      ["Can hiring managers see the results?", "Yes. Share a candidate's report with a hiring manager by link."],
    ],
  },
  universities: {
    benefits: [
      ["Admissions without the paperwork", "Applicants test online; you see levels by intake and record a decision for each."],
      ["Ready for placement week", "Classes practise toward a target level, and the placement office sees who is ready."],
      ["Proof students can show", "A certificate employers can check online, with a QR code and a public check page."],
    ],
    faq: [
      ["Who can take Spica?", "Students aged 18 and over."],
      ["Is there an education price?", "Yes: 15% off licences for universities and colleges."],
      ["Can applicants be tested before they join?", "Yes. Admissions lets you create intakes, invite applicants or share a public link, and confirm each level before deciding."],
      ["Can we export results?", "Yes: class reports by skill, with exports for the placement office."],
    ],
  },
  "training-providers": {
    benefits: [
      ["Before and after, on one scale", "Test at the start and end of each course on the same 10–90 scale."],
      ["Reports clients understand", "Progress by learner, group and skill, ready to share with the client."],
      ["Your brand in the app", "Your logo and colour, and certificates learners can share."],
    ],
    faq: [
      ["How do we show a course worked?", "Test before and after on the same scale, then share each learner's and each group's change."],
      ["Can learners practise between sessions?", "Yes. Licences give Practice Modules, practice tests and mock tests, and you see who is practising."],
      ["How is it priced?", "Licences per learner-month, with the same volume prices as companies."],
    ],
  },
  individuals: {
    benefits: [
      ["Know your real level", "A free placement test gives your level in each skill."],
      ["Practice that feels like the test", "Every question type, timed mock tests and feedback on every answer."],
      ["Proof employers can check", "A certificate with a QR code and a public check page, ready for LinkedIn."],
    ],
    faq: [
      ["Is it really free to start?", "Yes: a placement test, practice every week, and 2 practice tests and 1 mock test a month."],
      ["How long is a certificate valid?", "12 months. You can extend it, or make it valid for life."],
      ["Can I ask for my score to be checked?", "Yes. You can ask for a person to review your score."],
      ["Which test should I take?", "Start with the free placement test. Each test page explains who it is for, so you can pick the one that fits your goal."],
    ],
  },
};
