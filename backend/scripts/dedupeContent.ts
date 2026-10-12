// One-off content-dedup pass. Three problems found by direct DB audit:
//  1. The ENTIRE placement pool (270/270 approved items) was a verbatim
//     content copy of practice-pool items — a learner who'd done Modules
//     practice had already seen every Placement question.
//  2. 116 exam-pool (mocktest/Practice Tests) items repeat identical
//     content across different sets of the same product.
//  3. 4 practice-pool items repeat identical content against each other.
// This rewrites every affected row with fresh, level-appropriate content,
// then clears stale item_audio rows for any audio-first type touched (the
// old audio would no longer match the new text) so generate-item-audio can
// regenerate just those.
//
// Usage: npm run dedupe-content          (dry run, prints what would change)
// Usage: npm run dedupe-content -- --apply  (writes it)
import "dotenv/config";
import { pool } from "../src/db.js";

type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

interface Row {
  content: Record<string, unknown>;
  answerSet: Record<string, unknown> | null;
}

const textAnswer = (text: string): Row => ({ content: { text }, answerSet: { exact: text } });
const plainText = (text: string): Row => ({ content: { text }, answerSet: null });
const prompt = (p: string): Row => ({ content: { prompt: p }, answerSet: null });
const story = (s: string): Row => ({ content: { story: s }, answerSet: null });
const shortAnswer = (question: string, answers: string[]): Row => ({
  content: { question },
  answerSet: { acceptable_answers: answers },
});
const sentenceCompletion = (sentence: string, answers: string[]): Row => ({
  content: { sentence, hint_word: "" },
  answerSet: { acceptable_answers: answers },
});
const conversation = (dialogue: string, question: string, answers: string[]): Row => ({
  content: { dialogue, question },
  answerSet: { acceptable_answers: answers },
});
const sentenceBuild = (correct: string, groups: string[]): Row => {
  if (groups.join(" ").toLowerCase() === correct.toLowerCase().replace(/[.?]$/, "")) {
    throw new Error(`sentence_builds groups not actually shuffled: "${correct}"`);
  }
  return { content: { groups }, answerSet: { correct } };
};
const readingComprehension = (passage: string, question: string, options: string[], correctIndex: number): Row => ({
  content: { passage, question, options },
  answerSet: { correctIndex },
});
const responseSelection = (text: string, options: string[], correctIndex: number): Row => ({
  content: { text, options },
  answerSet: { correctIndex },
});

// ---------------------------------------------------------------------------
// PLACEMENT POOL — 9 types x 6 levels x 5 items = 270. Full replacement.
// ---------------------------------------------------------------------------

const PLACEMENT_DICTATION: Record<Level, string[]> = {
  A1: [
    "The dog is sleeping on the bed.",
    "My brother works in a bank.",
    "We clean the house every Saturday.",
    "She is wearing a blue dress.",
    "The children are playing in the park.",
  ],
  A2: [
    "He missed the bus this morning.",
    "They moved to a new apartment last month.",
    "I usually walk to work when it's sunny.",
    "The library closes early on Fridays.",
    "She forgot her umbrella at the office.",
  ],
  B1: [
    "The meeting was postponed because the manager was travelling.",
    "He has been studying English for almost three years.",
    "We need to confirm the booking before Friday.",
    "The new policy will take effect next month.",
    "She asked her colleague to cover her shift.",
  ],
  B2: [
    "The proposal was revised after the client raised several concerns.",
    "Profit margins narrowed despite a rise in overall sales.",
    "The committee will review the budget before any changes are approved.",
    "Staff were reassigned once the merger was finalized.",
    "The report highlighted inconsistencies in the quarterly figures.",
  ],
  C1: [
    "The findings suggest that the policy has had little measurable effect.",
    "Had the warning been taken seriously, the outage could have been avoided.",
    "The board remains divided over how the funds should be allocated.",
    "Analysts attributed the downturn to a combination of external pressures.",
    "The firm's reputation was undermined by a series of avoidable errors.",
  ],
  C2: [
    "The committee's reluctance to act decisively only compounded the uncertainty it was meant to resolve.",
    "Far from resolving the dispute, the ruling merely postponed its inevitable resurgence.",
    "What the report omits is, in many respects, more telling than what it includes.",
    "The policy's ostensible neutrality masked a clear bias toward incumbent firms.",
    "Seldom has a single decision had such far-reaching and unintended consequences.",
  ],
};

const PLACEMENT_REPEATS: Record<Level, string[]> = {
  A1: [
    "The cat is under the table.",
    "I have two brothers and one sister.",
    "She drinks milk every morning.",
    "The sun is very bright today.",
    "He is wearing a yellow shirt.",
  ],
  A2: [
    "I need to buy some bread and milk.",
    "He broke his arm while skiing last winter.",
    "The restaurant was fully booked on Friday night.",
    "She is learning how to play the guitar.",
    "We changed our flight because of the storm.",
  ],
  B1: [
    "The company decided to hire three new engineers.",
    "She has been working on this project for months.",
    "He couldn't attend the meeting because he was travelling.",
    "The hotel offered a discount for early bookings.",
    "They postponed the wedding until next summer.",
  ],
  B2: [
    "The merger was approved despite strong opposition from shareholders.",
    "She's been negotiating this contract for several weeks now.",
    "Had the team acted sooner, the delay could have been avoided.",
    "The report raised concerns that management had largely overlooked.",
    "He was reluctant to commit to a deadline he couldn't guarantee.",
  ],
  C1: [
    "Rarely has a decision been met with such universal criticism.",
    "Not until the audit concluded did the extent of the losses become clear.",
    "The settlement, while legally sound, left many questioning its fairness.",
    "Far from resolving the dispute, the ruling merely delayed it.",
    "Only after considerable pressure did the executives agree to the review.",
  ],
  C2: [
    "What the inquiry ultimately exposed was not negligence but a culture of quiet complacency.",
    "The settlement, however pragmatic, did little to restore the trust it had squandered.",
    "Rarely has an institution's credibility been so thoroughly, and so needlessly, eroded.",
    "The policy's apparent even-handedness belied a far more selective enforcement in practice.",
    "Only in retrospect did the full magnitude of the oversight become apparent.",
  ],
};

const PLACEMENT_READING: Record<Level, string[]> = {
  A1: ["My name is Laura.", "I live in a small town.", "Today is a sunny day.", "This is my favorite book.", "We have a new puppy."],
  A2: [
    "I usually go for a run before breakfast.",
    "The weather was nice, so we went for a walk.",
    "She works at a bakery near her house.",
    "We watched a movie together last night.",
    "He plays basketball with his friends on Saturdays.",
  ],
  B1: [
    "Although the forecast predicted rain, the match went ahead as planned.",
    "She decided to take a course in digital marketing.",
    "The restaurant has become popular since it opened last year.",
    "He spent the weekend fixing the roof of his house.",
    "They're planning to visit three countries during their trip.",
  ],
  B2: [
    "Although the merger was announced months ago, staff remain uncertain about its impact.",
    "The company's quarterly results exceeded analysts' expectations.",
    "Despite the setbacks, the project was completed ahead of schedule.",
    "The new regulations are intended to improve workplace safety standards.",
    "Investors reacted cautiously to the announcement of the leadership change.",
  ],
  C1: [
    "The committee's reluctance to intervene drew criticism from several stakeholders.",
    "Although the evidence was circumstantial, it proved sufficient to prompt an inquiry.",
    "The firm's expansion into overseas markets has not been without setbacks.",
    "Critics argue that the reform addresses symptoms rather than root causes.",
    "The negotiations, though protracted, ultimately produced a workable compromise.",
  ],
  C2: [
    "The report's understated tone belies the gravity of its conclusions.",
    "What distinguishes this proposal from its predecessors is its unflinching candor.",
    "The institution's credibility rests less on its achievements than on its restraint.",
    "Few policies have been so widely praised and so inconsistently applied.",
    "The dissent, though narrowly outvoted, articulated concerns the majority chose to ignore.",
  ],
};

const PLACEMENT_READING_COMPREHENSION: Record<Level, [string, string, string[], number][]> = {
  A1: [
    ["It is Monday today.", "What day is it?", ["Monday", "Tuesday", "Sunday", "Friday"], 0],
    ["The ball is red.", "What color is the ball?", ["Blue", "Red", "Green", "Black"], 1],
    ["Tom has three cats.", "How many cats does Tom have?", ["Two", "Three", "Four", "One"], 1],
    ["The shop opens at nine.", "When does the shop open?", ["At nine", "At ten", "At eight", "At noon"], 0],
    ["Anna is seven years old.", "How old is Anna?", ["Six", "Seven", "Eight", "Nine"], 1],
  ],
  A2: [
    ["Notice: The pool is closed for cleaning on Mondays.", "When is the pool closed?", ["Every day", "On Mondays", "On weekends", "Never"], 1],
    [
      "Sign: Please use the side entrance after 6pm.",
      "Which entrance should you use after 6pm?",
      ["The main entrance", "The side entrance", "The back entrance", "Any entrance"],
      1,
    ],
    [
      "Memo: The office will close early on Friday for the holiday.",
      "Why will the office close early?",
      ["For a holiday", "For repairs", "For a meeting", "For cleaning"],
      0,
    ],
    [
      "Label: Keep refrigerated after opening.",
      "What should you do after opening it?",
      ["Keep it refrigerated", "Keep it frozen", "Leave it outside", "Keep it in the sun"],
      0,
    ],
    ["Notice: Parking is free on Sundays.", "When is parking free?", ["On Sundays", "On Mondays", "Every day", "Never"], 0],
  ],
  B1: [
    [
      "Memo: All visitors must sign in at reception before entering the building.",
      "What must visitors do before entering?",
      ["Pay a fee", "Sign in at reception", "Call ahead", "Wear a badge"],
      1,
    ],
    [
      "Email excerpt: The workshop has been moved from Tuesday to Thursday.",
      "When is the workshop now?",
      ["Tuesday", "Wednesday", "Thursday", "Friday"],
      2,
    ],
    [
      "Announcement: Due to maintenance, the lift will be out of service until Friday.",
      "What is out of service?",
      ["The stairs", "The lift", "The entrance", "The parking lot"],
      1,
    ],
    [
      "Notice: Staff are reminded to submit expense reports by the end of the month.",
      "What must staff submit?",
      ["Time sheets", "Expense reports", "Vacation requests", "Sick notes"],
      1,
    ],
    [
      "Memo: The printer on the third floor is being replaced next week.",
      "What is happening next week?",
      ["The printer is being replaced", "The office is moving", "The lift is closing", "A meeting is scheduled"],
      0,
    ],
  ],
  B2: [
    [
      "Annual Report Summary: Revenue grew 6% while operating costs grew 11%, narrowing overall profit margins.",
      "What happened to profit margins?",
      ["They widened", "They narrowed", "They stayed the same", "They doubled"],
      1,
    ],
    [
      "Memo: All expense reports over $300 now require director approval before reimbursement.",
      "What requires director approval?",
      ["All expense reports", "Reports over $300", "Reports under $300", "No reports"],
      1,
    ],
    [
      "Press release: The company will cut 5% of its workforce as part of a restructuring plan.",
      "What is the company doing?",
      ["Hiring more staff", "Cutting 5% of its workforce", "Closing permanently", "Merging with a competitor"],
      1,
    ],
    [
      "Report excerpt: Customer complaints rose sharply after the new system was introduced.",
      "What rose after the new system was introduced?",
      ["Sales", "Customer complaints", "Staff numbers", "Profits"],
      1,
    ],
    [
      "Memo: The marketing budget has been frozen until the next fiscal quarter.",
      "What has been frozen?",
      ["Hiring", "The marketing budget", "Office renovations", "Travel approvals"],
      1,
    ],
  ],
  C1: [
    [
      "Analyst note: The firm's apparent recovery owes more to one-off asset sales than to any underlying improvement in performance.",
      "What does the recovery mainly owe to?",
      ["Underlying performance", "One-off asset sales", "New products", "Lower costs"],
      1,
    ],
    [
      "Editorial excerpt: Critics contend that the reform tackles symptoms while leaving the root causes untouched.",
      "What do critics say about the reform?",
      ["It addresses root causes", "It tackles symptoms only", "It has no effect", "It is too costly"],
      1,
    ],
    [
      "Internal memo: The board remains split on whether the expansion should proceed before the audit concludes.",
      "What is the board split on?",
      ["Whether to proceed before the audit concludes", "Whether to fire the auditor", "Whether to cancel the expansion entirely", "Whether to relocate headquarters"],
      0,
    ],
    [
      "Research summary: The data suggest a correlation, though not necessarily a causal link, between the two variables.",
      "What does the data suggest?",
      ["A causal link", "A correlation, not necessarily causal", "No relationship at all", "A guaranteed outcome"],
      1,
    ],
    [
      "Statement: The settlement resolves the immediate dispute but leaves the broader regulatory question unanswered.",
      "What does the settlement leave unanswered?",
      ["The immediate dispute", "The broader regulatory question", "The legal fees", "The company's name"],
      1,
    ],
  ],
  C2: [
    [
      "Commentary: The ruling, while narrow in scope, sets a precedent whose implications will likely outlast the case itself.",
      "What will likely outlast the case?",
      ["The narrow scope", "The precedent's implications", "The legal fees", "The original dispute"],
      1,
    ],
    [
      "Review: The report's restraint is, paradoxically, what lends its conclusions their weight.",
      "What lends the report's conclusions their weight?",
      ["Its length", "Its restraint", "Its illustrations", "Its popularity"],
      1,
    ],
    [
      "Analysis: The policy's neutrality is more apparent than real, favoring incumbents in subtle ways.",
      "What does the policy actually favor?",
      ["New entrants", "Incumbents", "No one", "Foreign firms"],
      1,
    ],
    [
      "Commentary: The dissent, though outvoted, raised questions the majority opinion never addressed.",
      "What did the dissent do?",
      ["Agreed with the majority", "Raised unaddressed questions", "Had no impact on the case", "Was later withdrawn"],
      1,
    ],
    [
      "Editorial: The institution's caution, often mistaken for indecision, has in fact preserved its credibility.",
      "What has preserved the institution's credibility?",
      ["Its indecision", "Its caution", "Its size", "Its public statements"],
      1,
    ],
  ],
};

const PLACEMENT_RESPONSE_SELECTION: Record<Level, [string, string[], number][]> = {
  A1: [
    ["Do you like apples?", ["Yes, I do.", "It is Monday.", "I am a teacher."], 0],
    ["What is your name?", ["I am ten.", "My name is Sam.", "It is red."], 1],
    ["Is this your bag?", ["Yes, it is.", "I like tea.", "He is my brother."], 0],
    ["Where is the cat?", ["It is five o'clock.", "The cat is under the table.", "I am happy."], 1],
    ["Can you swim?", ["Yes, I can.", "It is a book.", "She is a doctor."], 0],
  ],
  A2: [
    ["I missed the bus this morning.", ["That's too bad, what happened?", "I like coffee.", "The sky is blue."], 0],
    ["Would you like some tea or coffee?", ["Coffee, please.", "It's raining today.", "I live near the park."], 0],
    ["Can you help me carry these bags?", ["Sure, no problem.", "The movie starts at eight.", "I bought a new phone."], 0],
    ["How was your weekend?", ["It was great, thanks.", "I have two brothers.", "The shop is closed."], 0],
    ["Do you know what time the train leaves?", ["At noon, I think.", "I like dogs.", "She is my neighbor."], 0],
  ],
  B1: [
    ["The flight has been delayed by two hours.", ["Okay, I'll let them know.", "I enjoy hiking on weekends.", "The printer needs more paper."], 0],
    ["I think we should reschedule the meeting.", ["That makes sense, when works for you?", "The coffee machine is broken.", "I prefer tea over coffee."], 0],
    ["Can you send me the report before noon?", ["Sure, I'll have it ready.", "The weather looks nice today.", "I forgot my umbrella."], 0],
    ["We're thinking of moving to a bigger office.", ["That sounds like a good idea.", "I had pasta for lunch.", "The train was late again."], 0],
    ["Did you manage to fix the printer?", ["Yes, it's working now.", "I'm going on vacation soon.", "The meeting room is upstairs."], 0],
  ],
  B2: [
    ["The client wants to push back the deadline again.", ["Let's discuss the implications first.", "I had a great lunch today.", "The office is on the fifth floor."], 0],
    ["Sales dropped significantly this quarter.", ["We should look into why.", "The new logo looks great.", "I'll book the conference room."], 0],
    ["The numbers in this report don't add up.", ["Let me check them again.", "The weather is nice today.", "I completely agree, no issues at all."], 0],
    ["We lost our biggest client last week.", ["That's concerning, what happened?", "I love this new software.", "The parking lot is full."], 0],
    ["The board rejected the proposal.", ["We'll need to revise it then.", "The coffee here is excellent.", "I'm taking Friday off."], 0],
  ],
  C1: [
    ["The audit uncovered several irregularities in the accounts.", ["That's concerning — who's investigating it?", "The office plants need watering.", "I'll be out Thursday afternoon."], 0],
    ["The merger talks have stalled over valuation disagreements.", ["Not surprising, given how far apart they were.", "I prefer working from home.", "The elevator is out of service."], 0],
    ["Regulators are questioning the firm's disclosure practices.", ["That could have serious implications.", "The cafeteria menu changed again.", "I'm attending a conference next week."], 0],
    ["The forecast turned out to be overly optimistic.", ["We should revisit our assumptions, then.", "The new intern starts Monday.", "I enjoy reading in the evenings."], 0],
    ["Shareholders are pushing for a change in leadership.", ["That's a significant development.", "The office relocated last year.", "I'm learning a new language."], 0],
  ],
  C2: [
    ["The ruling could set an uncomfortable precedent for the industry.", ["Indeed, its implications may outlast the case itself.", "I booked a table for two.", "The printer is out of toner."], 0],
    ["The committee's silence has only fueled speculation.", ["Their restraint seems deliberate rather than accidental.", "I'm switching to a new provider.", "The meeting room needs a projector."], 0],
    ["Critics say the reform is more cosmetic than substantive.", ["That assessment seems fair, given what's unchanged.", "The weather's been unusually mild.", "I'll forward the invoice shortly."], 0],
    ["The dissenting opinion raised points the majority never addressed.", ["It's a compelling rebuttal, in fairness.", "The courier arrives at noon.", "I'm rescheduling the call."], 0],
    ["The institution's caution is often mistaken for indecision.", ["A fair point — restraint isn't the same as hesitation.", "The building reopens next week.", "I'll check the inventory."], 0],
  ],
};

const PLACEMENT_SENTENCE_BUILDS: Record<Level, [string, string[]][]> = {
  A1: [
    ["They have a dog.", ["a dog", "they", "have"]],
    ["Is this your pen?", ["your pen", "is", "this"]],
    ["We watch TV at night.", ["TV at night", "we", "watch"]],
    ["Is she your teacher?", ["your teacher", "is", "she"]],
    ["He needs to wash his hands.", ["wash his hands", "he", "needs to"]],
  ],
  A2: [
    ["She is learning how to drive.", ["how to drive", "she", "is learning"]],
    ["They went to the market yesterday.", ["yesterday", "they went", "to the market"]],
    ["He forgot to bring his umbrella.", ["his umbrella", "he forgot", "to bring"]],
    ["We are going to visit our grandparents.", ["our grandparents", "we", "are going to visit"]],
    ["She didn't finish her homework last night.", ["last night", "she didn't finish", "her homework"]],
  ],
  B1: [
    ["The meeting was moved to a later time.", ["to a later time", "the meeting", "was moved"]],
    ["He has been working here for five years.", ["for five years", "he has been working", "here"]],
    ["She decided to take a different route home.", ["home", "she decided", "to take a different route"]],
    ["They were told about the schedule change.", ["the schedule change", "they", "were told about"]],
    ["We need to confirm the reservation by Friday.", ["by Friday", "we need to confirm", "the reservation"]],
  ],
  B2: [
    ["The proposal was rejected due to budget concerns.", ["due to budget concerns", "the proposal", "was rejected"]],
    ["Attitude is more important than talent.", ["than talent", "attitude", "is more important"]],
    ["A recent survey revealed widespread dissatisfaction.", ["widespread dissatisfaction", "a recent survey", "revealed"]],
    ["The firm struggled to keep up with demand.", ["demand", "the firm", "struggled to keep up with"]],
    ["Management decided to postpone the launch.", ["the launch", "management", "decided to postpone"]],
  ],
  C1: [
    ["Rarely has a product launch been so poorly timed.", ["so poorly timed", "rarely", "has a product launch been"]],
    ["Little could have prepared the team for such a backlash.", ["for such a backlash", "little", "could have prepared the team"]],
    ["Only after the audit did the discrepancies emerge.", ["emerge", "only after the audit", "did the discrepancies"]],
    ["Not only was the plan approved, but it was also praised.", ["praised", "but it was also", "not only was the plan approved"]],
    ["Far from solving the problem, the policy made it worse.", ["made it worse", "far from solving the problem", "the policy"]],
  ],
  C2: [
    ["Seldom has a ruling been so widely contested.", ["so widely contested", "seldom", "has a ruling been"]],
    ["What the report omits is more telling than what it includes.", ["than what it includes", "what the report omits", "is more telling"]],
    ["Only in hindsight did the risks become fully apparent.", ["become fully apparent", "only in hindsight", "did the risks"]],
    ["The policy's neutrality was more apparent than real.", ["than real", "the policy's neutrality", "was more apparent"]],
    ["Not a single warning sign went unnoticed in hindsight.", ["in hindsight", "not a single warning sign", "went unnoticed"]],
  ],
};

const PLACEMENT_SENTENCE_COMPLETION: Record<Level, [string, string[]][]> = {
  A1: [
    ["She ___ a red car.", ["has", "drives"]],
    ["He ___ to school every day.", ["goes", "walks"]],
    ["They ___ in a big house.", ["live"]],
    ["I ___ my homework now.", ["do"]],
    ["We ___ breakfast at eight.", ["eat", "have"]],
  ],
  A2: [
    ["He ___ to the gym twice a week.", ["goes"]],
    ["She ___ her keys yesterday.", ["lost"]],
    ["They ___ moving to a new flat next month.", ["are"]],
    ["I ___ never been to Japan.", ["have"]],
    ["We ___ already finished the project.", ["have"]],
  ],
  B1: [
    ["He ___ to finish the report before leaving.", ["needs", "has"]],
    ["___ she was tired, she kept working.", ["although", "even though"]],
    ["She would have called ___ she had your number.", ["if"]],
    ["He has worked here ___ he graduated.", ["since"]],
    ["They cancelled the trip ___ the bad weather.", ["because of", "due to"]],
  ],
  B2: [
    ["The merger went ahead ___ opposition from shareholders.", ["despite", "notwithstanding"]],
    ["___ the budget cuts, the project continued as planned.", ["despite", "notwithstanding"]],
    ["The report was criticized ___ its lack of detail.", ["for"]],
    ["He was promoted ___ having joined the firm recently.", ["despite"]],
    ["The negotiations stalled ___ disagreements over pricing.", ["because of", "due to", "over"]],
  ],
  C1: [
    ["___ the warning signs been heeded, the crisis might have been averted.", ["had"]],
    ["___ until the audit concluded did the extent of the losses become clear.", ["not"]],
    ["The settlement, ___ pragmatic, did little to restore confidence.", ["while", "though"]],
    ["___ considerable pressure, the executives agreed to the review.", ["under", "following"]],
    ["The firm's recovery, ___ gradual, was nonetheless notable.", ["while", "though"]],
  ],
  C2: [
    ["___ a single warning sign went unnoticed in hindsight.", ["not"]],
    ["The ruling, ___ narrow, set a far-reaching precedent.", ["while", "though", "however"]],
    ["___ had the committee acted so decisively.", ["rarely", "seldom"]],
    ["The policy's neutrality was, ___ practice, more apparent than real.", ["in"]],
    ["___ from resolving the dispute, the ruling merely postponed it.", ["far"]],
  ],
};

const PLACEMENT_SHORT_ANSWER: Record<Level, [string, string[]][]> = {
  A1: [
    ["Sam has a dog. Does Sam have a cat or a dog?", ["a dog", "dog"]],
    ["The ball is under the chair. Where is the ball?", ["under the chair"]],
    ["Mia is reading a book. What is Mia doing?", ["reading a book", "reading"]],
    ["It is raining outside. Is it sunny or raining?", ["raining", "it is raining"]],
    ["Tom has two sisters. How many sisters does Tom have?", ["two", "2"]],
  ],
  A2: [
    ["Lisa missed her train this morning. Did she catch the train or miss it?", ["she missed it", "missed it"]],
    ["The shop closes at six on Sundays. What time does the shop close on Sundays?", ["at six", "six o'clock", "6"]],
    ["Jake forgot his umbrella at home. What did Jake forget?", ["his umbrella", "umbrella"]],
    ["The meeting starts at nine tomorrow. When does the meeting start?", ["at nine tomorrow", "nine tomorrow", "9am tomorrow"]],
    ["Ana bought a new laptop yesterday. What did Ana buy?", ["a new laptop", "a laptop"]],
  ],
  B1: [
    ["Maria was offered a promotion but turned it down. Did she accept it or turn it down?", ["she turned it down", "turned it down"]],
    ["The flight was delayed by three hours. By how long was the flight delayed?", ["three hours", "3 hours"]],
    ["The company hired five new engineers last month. How many engineers did they hire?", ["five", "5"]],
    ["The client asked for a full refund. What did the client ask for?", ["a full refund", "a refund"]],
    ["The team missed the deadline by two days. By how many days did they miss the deadline?", ["two days", "2 days"]],
  ],
  B2: [
    ["The firm decided to outsource its customer support. Did they keep it in-house or outsource it?", ["outsource it", "outsourced it"]],
    ["The company decided to let go of twenty staff. Did they hire them or let them go?", ["let them go", "fire them", "fired them"]],
    ["Sales dropped by twelve percent this quarter. By how much did sales drop?", ["twelve percent", "12 percent", "12%"]],
    ["The board rejected the proposal unanimously. Did the board approve or reject the proposal?", ["reject it", "rejected it", "reject"]],
    ["The firm lost its biggest client last month. What did the firm lose?", ["its biggest client", "their biggest client", "a client"]],
  ],
  C1: [
    ["The audit uncovered discrepancies in three separate accounts. How many accounts had discrepancies?", ["three", "3"]],
    ["Despite the setbacks, the merger was ultimately approved. Was the merger approved or rejected?", ["approved", "it was approved"]],
    ["The committee postponed its decision pending further review. What did the committee do with its decision?", ["postponed it", "delayed it"]],
    ["Analysts attributed the downturn to weak consumer demand. What did analysts blame for the downturn?", ["weak consumer demand", "consumer demand"]],
    [
      "The firm's reputation suffered after the recall, despite a swift response. Did the response prevent the reputational damage?",
      ["no", "no, it didn't"],
    ],
  ],
  C2: [
    ["The ruling, though narrow, is expected to shape future cases. Is the ruling expected to have lasting influence?", ["yes", "yes, it is"]],
    ["The dissent was outvoted but raised questions the majority never addressed. Did the majority address those questions?", ["no", "no, they didn't"]],
    ["The institution's caution has often been mistaken for indecision. What is the caution often mistaken for?", ["indecision"]],
    ["The reform was praised for its ambition but criticized for its vagueness. What was it criticized for?", ["its vagueness", "vagueness"]],
    ["The committee's silence only fueled further speculation. What did the silence do?", ["fueled further speculation", "fueled speculation"]],
  ],
};

const PLACEMENT_EMAIL_WRITING: Record<Level, string[]> = {
  A1: [
    "Write a short email to a friend inviting them to your birthday party.",
    "Write an email to your teacher saying you will be absent tomorrow.",
    "Write a short email to your mother saying you arrived home safely.",
    "Write an email to a friend asking them to meet for lunch.",
    "Write a short email to your neighbor asking to borrow a ladder.",
  ],
  A2: [
    "Write an email to a hotel asking about their check-in time.",
    "Write an email to a colleague asking them to reschedule a call.",
    "Write an email to a shop asking if an item is in stock.",
    "Write an email to your landlord reporting a broken window.",
    "Write an email to a friend suggesting a weekend trip.",
  ],
  B1: [
    "Write an email to your manager requesting two days of vacation next month.",
    "Write an email to a supplier asking about a delayed shipment.",
    "Write an email to a colleague explaining why a report will be late.",
    "Write an email to a client confirming a meeting time and location.",
    "Write an email to your team announcing a change in the project schedule.",
  ],
  B2: [
    "You are the manager of a logistics firm trying to win new clients, especially in retail and manufacturing. Write an email to potential clients explaining this and proposing they: review your service rates, schedule a site visit, and discuss a trial contract.",
    "Write an email to a vendor whose invoice doesn't match the quoted estimate. Ask them to clarify the discrepancy.",
    "Write an email to staff reminding them of the updated expense reporting policy.",
    "Write an email to a client explaining a delay in project delivery and proposing a revised timeline.",
    "Write an email to your department outlining the results of the recent customer satisfaction survey.",
  ],
  C1: [
    "Write an email to the board summarizing the key findings of the quarterly audit and recommending next steps.",
    "Write an email to a partner organization proposing a joint initiative to reduce operating costs.",
    "Write an email to senior management explaining the risks associated with the proposed restructuring.",
    "Write an email to a client addressing their concerns about a recent service disruption and outlining corrective measures.",
    "Write an email to stakeholders explaining the rationale behind a significant change in company policy.",
  ],
  C2: [
    "Write an email to the board addressing concerns about the company's handling of a recent public controversy.",
    "Write an email to regulators responding to an inquiry into the firm's disclosure practices.",
    "Write an email to shareholders explaining the implications of a recent court ruling for the company's operations.",
    "Write an email to senior leadership proposing a fundamental shift in the organization's long-term strategy.",
    "Write an email to an industry body responding to criticism of the sector's self-regulation practices.",
  ],
};

const PLACEMENT_OPEN_QUESTIONS: Record<Level, string[]> = {
  A1: [
    "What is your favorite color? Please explain why.",
    "What is your favorite food? Please explain why.",
    "Who is your best friend? Please describe them.",
    "What games do you like to play?",
    "What is your favorite animal? Please explain why.",
  ],
  A2: [
    "What did you do last weekend?",
    "What is your favorite place to visit? Please explain why.",
    "How do you usually get to work or school?",
    "What kind of music do you like?",
    "What do you usually do in the evenings?",
  ],
  B1: [
    "Should students be given homework every day? Please explain your answer.",
    "What is the best way to learn a new language?",
    "Do you prefer living in a city or a small town? Please explain why.",
    "What would you do if you won a large amount of money?",
    "Is it better to work in a team or alone? Please explain your answer.",
  ],
  B2: [
    "Should companies allow employees to work from home permanently? Please explain your answer and give examples.",
    "Is social media more harmful or helpful to society? Please explain your answer.",
    "Should university education be free for everyone? Please explain your answer and give examples.",
    "Do you think technology has made people more or less productive? Please explain your answer.",
    "Should governments regulate how much screen time children have? Please explain your answer.",
  ],
  C1: [
    "To what extent should companies be held responsible for their environmental impact? Please explain your answer.",
    "Should employees be paid based on performance or seniority? Please explain your answer and give examples.",
    "Is economic growth always beneficial for a society? Please explain your answer.",
    "Should governments intervene in failing industries? Please explain your answer and give examples.",
    "Is it ethical for companies to use customer data to personalize advertising? Please explain your answer.",
  ],
  C2: [
    "Can regulation ever keep pace with technological change, or is it destined to always lag behind? Please explain your answer.",
    "Does the pursuit of shareholder value conflict with a company's broader social responsibilities? Please explain your answer.",
    "Is transparency always in the public interest, or can it sometimes do more harm than good? Please explain your answer.",
    "Should institutions be judged more by their outcomes or by their processes? Please explain your answer.",
    "Can a free press remain truly independent when reliant on commercial funding? Please explain your answer.",
  ],
};

// ---------------------------------------------------------------------------
// EXAM POOL (mocktest / Practice Tests) — extra items for duplicate rows
// found repeating across different sets of the same product.
// ---------------------------------------------------------------------------

const EXAM_CONVERSATIONS: Partial<Record<Level, [string, string, string[]][]>> = {
  A2: [
    ["A: The bus is late again. B: Let's just walk instead.", "What does B suggest?", ["walking instead", "walk instead", "to walk"]],
    ["A: I can't find my keys. B: Did you check your bag?", "What does B ask?", ["if she checked her bag", "to check the bag"]],
    ["A: The shop is closed today. B: Oh, I forgot it's a holiday.", "Why is the shop closed?", ["it's a holiday", "because of the holiday"]],
    ["A: Can you help me move this table? B: Sure, give me a second.", "What does B agree to do?", ["help move the table", "help with the table"]],
    ["A: I'm going to the gym later. B: Can I come with you?", "What does B want to do?", ["go to the gym with A", "come along"]],
    ["A: We ran out of milk. B: I'll pick some up after work.", "What will B do after work?", ["buy milk", "pick up milk"]],
    ["A: The movie starts at eight. B: Great, let's leave by seven thirty.", "What time will they leave?", ["seven thirty", "7:30"]],
    ["A: My phone battery died. B: You can use my charger.", "What does B offer?", ["a charger", "his charger", "her charger"]],
  ],
  B1: [
    ["A: The client called about the invoice. B: I'll look into it right away.", "What will B do?", ["look into the invoice", "check the invoice", "look into it"]],
    ["A: The elevator is out of service. B: Should we use the stairs? A: Yes, it's only two floors.", "How many floors do they need to climb?", ["two floors", "two"]],
    ["A: I have a cold. B: Did you see a doctor? A: Not yet, I will tomorrow.", "When will A see a doctor?", ["tomorrow"]],
    ["A: Did you buy travel insurance? B: Not yet. A: You should, just in case.", "What does A recommend?", ["buying travel insurance", "getting insurance"]],
    ["A: The invoice hasn't arrived yet. B: Did you contact accounting? A: Yes, they're sending it today.", "When will the invoice arrive?", ["today"]],
    ["A: The parking lot was full again. B: Did you find a spot? A: Yes, just down the street.", "Where did A park?", ["down the street"]],
    ["A: My suitcase didn't arrive. B: Did you report it? A: Yes, right at the counter.", "Where did A report it?", ["at the counter", "the counter"]],
    ["A: The internet's been down all morning. B: Did you call support? A: Yes, they're working on it.", "What is support doing?", ["working on it", "fixing it"]],
    ["A: Our team won! B: That's fantastic! A: Yes, I'm thrilled.", "How does A feel?", ["thrilled", "happy", "excited"]],
    ["A: I got a refund! B: That's great! A: Yes, I'm relieved.", "How does A feel?", ["relieved"]],
    ["A: I missed my connecting flight. B: Did they rebook you? A: Yes, for tomorrow morning.", "When is A's new flight?", ["tomorrow morning"]],
    ["A: The printer's out of toner again. B: I just ordered more. A: Thanks, that's good timing.", "What did B do?", ["ordered more toner", "ordered toner"]],
  ],
  B2: [
    ["A: Sales dropped this quarter. B: By how much? A: About fourteen percent.", "By how much did sales drop?", ["fourteen percent", "14%"]],
    ["A: The board approved the budget. B: With any changes? A: Just a small cut to travel expenses.", "What was changed in the budget?", ["travel expenses were cut", "a cut to travel expenses"]],
    ["A: The vendor missed the delivery date again. B: Should we switch suppliers? A: Let's give them one more chance.", "What does A want to do?", ["give the vendor one more chance", "give them another chance"]],
    ["A: The client pushed back on the price. B: Did we lose the deal? A: No, we agreed on a small discount.", "How was the issue resolved?", ["with a small discount", "they agreed on a discount"]],
    ["A: The audit found a few discrepancies. B: Anything serious? A: No, mostly minor paperwork errors.", "What kind of discrepancies were found?", ["minor paperwork errors", "paperwork errors"]],
  ],
  C1: [
    ["A: The merger talks stalled again. B: Over what this time? A: Valuation, same as before.", "What is the sticking point in the merger talks?", ["valuation"]],
    ["A: The regulator opened an inquiry. B: Into what exactly? A: Our disclosure practices.", "What is the inquiry about?", ["disclosure practices"]],
    ["A: The forecast missed badly this quarter. B: By how much? A: Nearly twenty percent.", "By roughly how much did the forecast miss?", ["nearly twenty percent", "about 20%"]],
    ["A: Shareholders are pushing for new leadership. B: Is the board responding? A: They've agreed to a review.", "What has the board agreed to?", ["a review", "a leadership review"]],
  ],
};

const EXAM_DICTATION: Partial<Record<Level, string[]>> = {
  B1: ["The delivery was delayed due to bad weather.", "They renovated the office over the weekend."],
  C1: ["The ambiguity in the contract left both parties open to dispute.", "Executives were reluctant to comment until the audit was complete."],
};

const EXAM_REPEATS: Partial<Record<Level, string[]>> = {
  A1: [
    "The dog is under the table.",
    "I have two brothers.",
    "She drinks juice every morning.",
    "The moon is very bright tonight.",
    "He is wearing a green shirt.",
    "We live near the bus stop.",
    "My mother is baking bread now.",
    "The girl is riding her scooter.",
    "I brush my teeth before bed.",
    "The shop is closed on Sundays.",
    "She has a small blue bag.",
  ],
  A2: [
    "He left his wallet at the restaurant.",
    "They are planning a trip to the mountains.",
    "She usually studies at a cafe on weekends.",
    "The train was late because of the snow.",
    "I need to buy some eggs and butter.",
    "He sprained his ankle while jogging last week.",
    "The cafe was fully booked on Saturday morning.",
    "She is learning how to bake bread.",
    "We changed our plans because of the rain.",
    "He always reads the news before lunch.",
    "The children built a snowman in the yard.",
    "She returned the umbrella she borrowed last week.",
    "They repainted the gate over the weekend.",
    "I left my notebook at my cousin's house.",
    "The teacher gave us an extra assignment today.",
  ],
  B1: [
    "The company decided to open a new branch.",
    "She has been researching this topic for weeks.",
    "He couldn't join the call because he was driving.",
    "The hotel offered free breakfast for long stays.",
    "They postponed the launch until next spring.",
    "I would have joined you if I had known sooner.",
    "The manager asked everyone to update their files by Monday.",
    "She's thinking about switching departments next quarter.",
    "We were delayed at the airport for almost three hours.",
    "He apologized for missing the deadline.",
    "The airline rebooked the flight due to a technical issue.",
    "She negotiated a better rate for the venue.",
    "They have already completed the first phase.",
    "He's been saving up to start his own business.",
    "The doctor suggested she take a few days off.",
    "I wasn't sure whether to take the new role.",
    "The team celebrated after closing the deal.",
    "She explained the delay clearly to the client.",
  ],
  B2: [
    "The acquisition was finalized despite last-minute objections.",
    "He's been reviewing this contract for several days now.",
    "Had the issue been reported sooner, it could have been fixed.",
    "The memo raised issues that staff had long suspected.",
    "She was hesitant to approve a budget she couldn't justify.",
    "The layoffs affected nearly every branch of the company.",
    "He persuaded the committee to revisit the earlier decision.",
    "The basement flooded after a pipe burst during the storm.",
    "They introduced new protocols after the safety review.",
    "The director admitted the launch had been rushed.",
    "Clients complained that the new interface was confusing.",
    "She was transferred despite having only recently started.",
    "The review uncovered several inconsistencies in the ledger.",
    "He insisted that the timeline was simply too tight.",
    "The plant had to halt operations for inspection.",
    "They grudgingly accepted the amended agreement.",
    "The agency struggled to attract investors during the slump.",
    "She was asked to explain the unexpected rise in spending.",
    "The panel delayed its verdict pending more information.",
    "He stayed composed despite the growing scrutiny.",
    "The brand's image took a hit after the scandal broke.",
    "They misjudged how disruptive the upgrade would be.",
  ],
  C1: [
    "Rarely has a verdict drawn such widespread condemnation.",
    "Not until the review was complete did the scale of the error emerge.",
    "The agreement, though contentious, was ultimately binding.",
    "Far from easing tensions, the statement only inflamed them.",
    "Only under sustained pressure did the directors reconsider.",
    "The vagueness of the clause allowed for conflicting readings.",
    "Nothing had prepared the staff for a reaction of that scale.",
    "The review, though limited in scope, proved unexpectedly consequential.",
    "Few had anticipated how swiftly the situation would unravel.",
  ],
};

const EXAM_RESPONSE_SELECTION: Partial<Record<Level, [string, string[]][]>> = {
  B2: [["The server went down during the demo.", ["That's unfortunate, is it fixed now?", "I prefer the window seat.", "The cafeteria closes at three."]]],
};

const EXAM_SENTENCE_COMPLETION: Partial<Record<Level, [string, string[]][]>> = {
  B1: [["She stayed late ___ she could finish the report.", ["so that", "because"]]],
  B2: [
    ["The launch was delayed ___ unresolved technical issues.", ["because of", "due to"]],
    ["___ the setbacks, the team met the deadline.", ["despite", "notwithstanding"]],
  ],
  C1: [
    ["___ only after the inquiry did the full picture emerge.", ["it was"]],
    ["The ruling, ___ narrow in scope, set an important precedent.", ["while", "though"]],
  ],
};

const EXAM_STORY_RETELLING: Partial<Record<Level, string[]>> = {
  B2: [
    "The rollout had been delayed twice due to supplier issues, but the team worked through the weekend to launch on the revised date, impressing both clients and senior management.",
    "After months of declining sales, the store introduced a loyalty program and revamped its layout, which gradually brought customers back and reversed the downward trend by the end of the quarter.",
  ],
};

// ---------------------------------------------------------------------------
// PRACTICE POOL — specific extra items for the 4 duplicate rows found.
// ---------------------------------------------------------------------------

const PRACTICE_READING_A1_EXTRA = ["Her name is Maria.", "I have a green bike.", "The bag is on the chair."];
const PRACTICE_TYPING_C2_EXTRA = ["The committee's apparent indifference was, on closer inspection, a calculated strategy to avoid premature commitment."];

// ---------------------------------------------------------------------------
async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode — writing changes." : "DRY RUN — pass --apply to write.");

  const updates: { id: string; row: Row }[] = [];

  // --- Placement: every row gets replaced, matched by (item_type_id, cefr_level), ordered by id ---
  const placementRows = await pool.query<{ id: string; item_type_id: string; cefr_level: Level }>(
    `SELECT id, item_type_id, cefr_level FROM items WHERE status='approved' AND pool='placement' ORDER BY item_type_id, cefr_level, id`,
  );
  const placementByBucket = new Map<string, string[]>();
  for (const r of placementRows.rows) {
    const key = `${r.item_type_id}:${r.cefr_level}`;
    if (!placementByBucket.has(key)) placementByBucket.set(key, []);
    placementByBucket.get(key)!.push(r.id);
  }
  function consumePlacement(type: string, level: Level, make: (idx: number) => Row) {
    const ids = placementByBucket.get(`${type}:${level}`) ?? [];
    ids.forEach((id, i) => updates.push({ id, row: make(i) }));
  }
  for (const level of LEVELS) {
    consumePlacement("dictation", level, (i) => textAnswer(PLACEMENT_DICTATION[level][i]));
    consumePlacement("repeats", level, (i) => textAnswer(PLACEMENT_REPEATS[level][i]));
    consumePlacement("reading", level, (i) => plainText(PLACEMENT_READING[level][i]));
    consumePlacement("reading_comprehension", level, (i) => readingComprehension(...PLACEMENT_READING_COMPREHENSION[level][i]));
    consumePlacement("response_selection", level, (i) => responseSelection(...PLACEMENT_RESPONSE_SELECTION[level][i]));
    consumePlacement("sentence_builds", level, (i) => sentenceBuild(...PLACEMENT_SENTENCE_BUILDS[level][i]));
    consumePlacement("sentence_completion", level, (i) => sentenceCompletion(...PLACEMENT_SENTENCE_COMPLETION[level][i]));
    consumePlacement("short_answer", level, (i) => shortAnswer(...PLACEMENT_SHORT_ANSWER[level][i]));
    consumePlacement("email_writing", level, (i) => prompt(PLACEMENT_EMAIL_WRITING[level][i]));
    consumePlacement("open_questions", level, (i) => prompt(PLACEMENT_OPEN_QUESTIONS[level][i]));
  }

  // --- Exam pool: keep the earliest row per duplicate-content group, rewrite the rest ---
  const examDupRows = await pool.query<{ id: string; item_type_id: string; cefr_level: Level; rn: number }>(
    `WITH dup AS (
       SELECT i.id, i.item_type_id, i.cefr_level, i.content::text AS c, i.created_at,
              row_number() OVER (PARTITION BY i.content::text ORDER BY i.created_at ASC) rn
       FROM items i JOIN exam_parts ep ON ep.id = i.exam_part_id
       WHERE i.status='approved' AND i.pool='exam'
         AND i.content::text IN (
           SELECT content::text FROM items WHERE status='approved' AND pool='exam'
           GROUP BY content::text HAVING count(*) > 1
         )
     )
     SELECT id, item_type_id, cefr_level, rn FROM dup WHERE rn > 1 ORDER BY item_type_id, cefr_level, id`,
  );
  const examByBucket = new Map<string, string[]>();
  for (const r of examDupRows.rows) {
    const key = `${r.item_type_id}:${r.cefr_level}`;
    if (!examByBucket.has(key)) examByBucket.set(key, []);
    examByBucket.get(key)!.push(r.id);
  }
  function consumeExam(type: string, level: Level, make: (idx: number) => Row) {
    const ids = examByBucket.get(`${type}:${level}`) ?? [];
    ids.forEach((id, i) => updates.push({ id, row: make(i) }));
  }
  for (const level of LEVELS) {
    const conv = EXAM_CONVERSATIONS[level];
    if (conv) consumeExam("conversations", level, (i) => conversation(...conv[i]));
    const dict = EXAM_DICTATION[level];
    if (dict) consumeExam("dictation", level, (i) => textAnswer(dict[i]));
    const rep = EXAM_REPEATS[level];
    if (rep) consumeExam("repeats", level, (i) => textAnswer(rep[i]));
    const rs = EXAM_RESPONSE_SELECTION[level];
    if (rs) consumeExam("response_selection", level, (i) => responseSelection(...rs[i]));
    const sc = EXAM_SENTENCE_COMPLETION[level];
    if (sc) consumeExam("sentence_completion", level, (i) => sentenceCompletion(...sc[i]));
    const sr = EXAM_STORY_RETELLING[level];
    if (sr) consumeExam("story_retelling", level, (i) => story(sr[i]));
  }

  // --- Practice pool: the 4 specific duplicate rows ---
  const practiceDupRows = await pool.query<{ id: string; item_type_id: string; cefr_level: Level; rn: number }>(
    `WITH dup AS (
       SELECT id, item_type_id, cefr_level, content::text AS c, created_at,
              row_number() OVER (PARTITION BY content::text ORDER BY created_at ASC) rn
       FROM items
       WHERE status='approved' AND pool='practice'
         AND content::text IN (
           SELECT content::text FROM items WHERE status='approved' AND pool='practice'
           GROUP BY content::text HAVING count(*) > 1
         )
     )
     SELECT id, item_type_id, cefr_level, rn FROM dup WHERE rn > 1 ORDER BY item_type_id, cefr_level, id`,
  );
  let readingA1Idx = 0;
  let typingC2Idx = 0;
  for (const r of practiceDupRows.rows) {
    if (r.item_type_id === "reading" && r.cefr_level === "A1") {
      updates.push({ id: r.id, row: plainText(PRACTICE_READING_A1_EXTRA[readingA1Idx++]) });
    } else if (r.item_type_id === "typing" && r.cefr_level === "C2") {
      updates.push({ id: r.id, row: plainText(PRACTICE_TYPING_C2_EXTRA[typingC2Idx++]) });
    } else {
      console.error(`Unexpected practice-pool duplicate row not handled: ${r.id} (${r.item_type_id}, ${r.cefr_level})`);
    }
  }

  console.log(`Planned ${updates.length} content rewrites.`);

  // --- Global uniqueness guard: compare each new content against the full
  // existing approved bank (minus the rows being replaced) and against each
  // other, using JS-side JSON re-stringification so comparison is stable
  // regardless of Postgres's own jsonb key ordering. ---
  const existing = await pool.query<{ id: string; content: Record<string, unknown> }>(
    `SELECT id, content FROM items WHERE status='approved'`,
  );
  const replacedIds = new Set(updates.map((u) => u.id));
  const seen = new Set<string>();
  for (const row of existing.rows) {
    if (replacedIds.has(row.id)) continue;
    seen.add(JSON.stringify(row.content));
  }
  let collisions = 0;
  for (const u of updates) {
    const key = JSON.stringify(u.row.content);
    if (seen.has(key)) {
      console.error(`COLLISION: new content for ${u.id} already exists elsewhere: ${key}`);
      collisions++;
    }
    seen.add(key);
  }
  if (collisions > 0) {
    console.error(`${collisions} collision(s) found — fix the content arrays before applying.`);
    process.exit(1);
  }
  console.log("Uniqueness check passed: no collisions against the existing bank or among the new content.");

  if (!apply) {
    await pool.end();
    return;
  }

  // --- Apply, tracking which audio-first types need their stale audio cleared ---
  const AUDIO_FIRST_TYPES = new Set(["repeats", "short_answer", "sentence_builds", "story_retelling", "dictation", "conversations", "response_selection"]);
  const touchedAudioIds: string[] = [];
  const touchedAudioTypes = new Set<string>();

  const typeById = new Map<string, string>();
  for (const r of [...placementRows.rows, ...examDupRows.rows, ...practiceDupRows.rows]) typeById.set(r.id, r.item_type_id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const u of updates) {
      await client.query(`UPDATE items SET content = $1::jsonb, answer_set = $2::jsonb WHERE id = $3`, [
        JSON.stringify(u.row.content),
        u.row.answerSet ? JSON.stringify(u.row.answerSet) : null,
        u.id,
      ]);
      const type = typeById.get(u.id);
      if (type && AUDIO_FIRST_TYPES.has(type)) {
        touchedAudioIds.push(u.id);
        touchedAudioTypes.add(type);
      }
    }
    if (touchedAudioIds.length > 0) {
      await client.query(`DELETE FROM item_audio WHERE item_id = ANY($1::uuid[])`, [touchedAudioIds]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`Applied ${updates.length} content rewrites.`);
  console.log(`Cleared stale audio for ${touchedAudioIds.length} items across types: ${[...touchedAudioTypes].join(", ")}`);
  console.log("Next: regenerate audio for those types, e.g.:");
  for (const t of touchedAudioTypes) console.log(`  npm run generate-item-audio -- --type=${t}`);

  await pool.end();
}

main().catch((err) => {
  console.error("dedupeContent: fatal error:", err);
  process.exit(1);
});
