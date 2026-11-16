// "Who it's for" pages. Every feature named here exists in Spica today.

export interface Solution {
  slug: string;
  name: string;
  headline: string;
  problem: string;
  answer: string;
  steps: [string, string][];
  features: string[];
  tests: string[]; // test slugs that fit best
  example: string;
  cta: { label: string; href: string };
}

export const SOLUTIONS: Solution[] = [
  {
    slug: "companies",
    name: "Companies",
    headline: "Know who needs English training, and show that it worked",
    problem: "You don't know who needs English training, and courses rarely show whether people actually improved.",
    answer: "Place everyone with one test, give each person a study plan, track progress by team and certify the result with a proctored final assessment.",
    steps: [
      ["Place your people", "Invite staff by email or file upload, or add them automatically from your HR system. Each one takes a placement test."],
      ["Train with a plan", "Every learner gets a plan for their level. Managers see who is practising and who needs a reminder."],
      ["Measure and certify", "Programs set a target level and date. A proctored final assessment ends in a certificate anyone can check."],
    ],
    features: [
      "Licences per learner-month, assigned and taken back from a shared pool",
      "Batches and managers who see only their own teams",
      "Programs with a target level, planned mock tests and a final assessment",
      "Reports by person, batch and skill; exports to CSV and PDF",
      "Reminders that skip people reminded in the last 48 hours",
      "Company sign-in (SSO), automatic accounts (SCIM), API and webhooks on Enterprise",
    ],
    tests: ["english-4-skills-essentials", "professional-english", "level-tests"],
    example: "A customer support team of 40 takes the placement test, follows a 3-month program to B2 and finishes with the final assessment. The team leader sees weekly progress and who has stopped practising.",
    cta: { label: "Talk to us", href: "/contact" },
  },
  {
    slug: "recruiters",
    name: "Recruiters",
    headline: "Check candidates' English before the interview",
    problem: "Interviews waste time on candidates whose English isn't good enough for the role.",
    answer: "Send a proctored online test before the interview, then read each candidate's level, scores and report, and decide.",
    steps: [
      ["Create a job opening", "Choose the test and the minimum level the role needs."],
      ["Invite candidates", "One by one, from a spreadsheet of up to 200, or with a public link posted on job websites."],
      ["Read results and decide", "Compare candidates, confirm the level, check integrity and record your decision: shortlisted, hired or rejected."],
    ],
    features: [
      "Job openings with a minimum level",
      "Email invitations, spreadsheet upload or a public job link",
      "Candidate reports with a feedback report and interview questions",
      "Integrity review: snapshots, recordings and a timeline, judged by people",
      "Share a report with a hiring manager by link",
      "Credits returned for invitations that expire unused",
    ],
    tests: ["speaking-and-listening", "english-4-skills-essentials", "writing"],
    example: "A contact centre hiring 30 voice agents sends the Speaking & Listening test to 120 applicants and only interviews those at B2 or above.",
    cta: { label: "Talk to us", href: "/contact" },
  },
  {
    slug: "universities",
    name: "Universities and colleges",
    headline: "Admit, place and prepare students with one platform",
    problem: "Placement and exit testing take staff time, and students need proof of their English for placements and jobs.",
    answer: "Online admission and placement tests, preparation for placements with progress by class, and certificates students can share with employers.",
    steps: [
      ["Test applicants", "Create an intake, invite applicants or share a public link, and record admitted, waitlisted or declined."],
      ["Prepare students", "Batches for each class, programs with a target level, and reports for teaching staff."],
      ["Certify", "A proctored final assessment and a certificate students can add to LinkedIn and share with employers."],
    ],
    features: [
      "Admissions: intakes, invitations, public links and decisions",
      "Batches and programs by class or course",
      "Class reports by skill, exports for the placement office",
      "15% education discount on licences",
      "For students aged 18 and over",
    ],
    tests: ["english-placement", "english-4-skills-essentials", "level-tests"],
    example: "A business school tests every applicant for its MSc intake, then prepares admitted students for B2 before placement week.",
    cta: { label: "Talk to us", href: "/contact" },
  },
  {
    slug: "training-providers",
    name: "Training providers",
    headline: "Show clients that your English courses work",
    problem: "Clients want proof that a course improved their people's English.",
    answer: "Test before and after each course on the same scale, and show the gain by person and by group.",
    steps: [
      ["Place learners", "A placement test puts each learner in the right group."],
      ["Teach and practise", "Learners practise between classes with modules for every question type."],
      ["Show the gain", "A level test or final assessment at the end shows the improvement on the same scale."],
    ],
    features: [
      "Placement and Level Tests on one scale",
      "Progress reports by learner and group",
      "Your logo and colour in the app",
      "Certificates learners can share",
    ],
    tests: ["english-placement", "level-tests", "english-4-skills-essentials"],
    example: "A training company runs a 6-week Business English course for a bank and reports each participant's level before and after.",
    cta: { label: "Talk to us", href: "/contact" },
  },
  {
    slug: "individuals",
    name: "Individuals",
    headline: "Find your level, improve it and prove it",
    problem: "You need to know your real English level and show it to employers.",
    answer: "A free placement test, practice for every question type, practice and mock tests, and a certificate anyone can check.",
    steps: [
      ["Start free", "Sign up and take the free placement test. You get a level for each skill and a study plan."],
      ["Practise", "Practice Modules for every question type, practice tests you can pause, and timed mock tests."],
      ["Get certified", "Take the proctored real test. Share your certificate, add it to LinkedIn, or let people check it with its code."],
    ],
    features: [
      "Free placement test and weekly practice",
      "Full access by the month, or a single test",
      "Feedback after every answer, and progress reports",
      "Certificates valid 12 months, extendable or lifetime",
      "Ask for a person to review your score",
    ],
    tests: ["english-4-skills-essentials", "professional-english", "speaking-and-listening"],
    example: "A graduate applying for client-facing jobs practises for a month and adds a B2 certificate to their LinkedIn profile.",
    cta: { label: "Start free", href: "SIGNUP" },
  },
];
