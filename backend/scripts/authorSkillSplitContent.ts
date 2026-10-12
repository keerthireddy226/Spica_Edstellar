// Authors genuinely NEW content for the "second" skill of each multi-skill
// item type, so e.g. Listening's "Conversations" and Speaking's
// "Conversations" are two separate 90-item tracks (3 sets x 6 levels x 5
// items each), not the same pool split in half. The ORIGINAL 90 items per
// type were already reassigned (via direct SQL) to keep their "primary"
// skill tag whole and untouched — this script only adds the missing side.
//
// Usage: npm run author-skill-split          (dry run)
// Usage: npm run author-skill-split -- --apply
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db.js";

type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const PER_LEVEL = 15; // 3 sets x 5 items, matching the existing side exactly

interface Row {
  content: Record<string, unknown>;
  answerSet: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
const textAnswer = (text: string): Row => ({ content: { text }, answerSet: { exact: text } });
const plainText = (text: string): Row => ({ content: { text }, answerSet: null });
const storyRow = (story: string): Row => ({ content: { story }, answerSet: null });
const passageRow = (passage: string): Row => ({ content: { passage }, answerSet: null });
const situationRow = (situation: string): Row => ({ content: { situation }, answerSet: null });
const shortAnswer = (question: string, answers: string[]): Row => ({
  content: { question },
  answerSet: { acceptable_answers: answers },
});
const conversation = (dialogue: string, question: string, answers: string[]): Row => ({
  content: { dialogue, question },
  answerSet: { acceptable_answers: answers },
});
const story = (storyText: string, question: string, answers: string[]): Row => ({
  content: { story: storyText, question },
  answerSet: { acceptable_answers: answers },
});
const readingSelective = (text: string, question: string, answers: string[]): Row => ({
  content: { text, question },
  answerSet: { acceptable_answers: answers },
});
const sentenceBuild = (correct: string, groups: string[]): Row => {
  if (groups.join(" ").toLowerCase() === correct.toLowerCase().replace(/[.?]$/, "")) {
    throw new Error(`sentence_builds groups not shuffled: "${correct}"`);
  }
  return { content: { groups }, answerSet: { correct } };
};

// Every slot-filled sentence below uses only singular, human, grammatically
// interchangeable subjects — any VERB_PHRASES entry can follow any SUBJECT.
const SUBJECTS = [
  "He", "She", "The manager", "The student", "My neighbor", "The teacher",
  "My colleague", "The driver", "The nurse", "The engineer", "My cousin", "The waiter",
];
// Tiered present-tense verb phrases (agree with 3rd-person singular).
const VERB_PHRASES: Record<Level, string[]> = {
  A1: [
    "reads a book every evening", "drinks tea in the morning", "walks to school",
    "likes the color blue", "plays with the dog", "cooks dinner at home",
    "wears a red jacket", "watches TV after lunch", "sleeps early at night",
    "cleans the kitchen", "waters the plants", "feeds the cat",
  ],
  A2: [
    "usually takes the bus to work", "forgot the umbrella this morning", "is learning to swim",
    "goes to the gym twice a week", "bought a new bicycle", "missed the early train",
    "is planning a short trip", "returned the library book late", "changed jobs last year",
    "visits her parents on Sundays", "is saving money for a holiday", "lost the house keys",
  ],
  B1: [
    "has been working here for three years", "decided to take an evening course", "negotiated a better price for the flat",
    "postponed the meeting until next week", "apologized for the late delivery", "is thinking about changing careers",
    "volunteers at the shelter on weekends", "struggled to find parking downtown", "explained the delay to the client",
    "agreed to split the bill evenly", "recommended a different supplier", "rescheduled the appointment twice",
  ],
  B2: [
    "was promoted despite joining recently", "raised concerns about the budget cuts", "convinced the board to reconsider",
    "was reluctant to commit to a deadline", "argued that the forecast was too optimistic", "struggled to justify the sudden cost increase",
    "underestimated how long the audit would take", "remained calm despite the mounting pressure", "acknowledged that the rollout was rushed",
    "was asked to revise the proposal", "pushed back on the vendor's new terms", "flagged several inconsistencies in the report",
  ],
  C1: [
    "was reluctant to intervene despite the backlash", "attributed the downturn to external pressures", "conceded that the timeline had been unrealistic",
    "questioned whether the settlement was genuinely fair", "was criticized for the vagueness of the proposal", "maintained that the review had been thorough",
    "disputed the committee's account of events", "warned that the policy could backfire", "remained unconvinced by the revised estimates",
    "pointed out a flaw the audit had missed", "cautioned against rushing the decision", "defended the decision despite mounting criticism",
  ],
  C2: [
    "dismissed the controversy as overblown", "conceded the point only after sustained pressure", "characterized the ruling as needlessly narrow",
    "was unmoved by the board's assurances", "quietly reversed an earlier, more confident claim", "declined to elaborate on the discrepancy",
    "remained skeptical of the committee's restraint", "attributed the lapse to institutional complacency", "downplayed the significance of the finding",
    "refused to be drawn on the speculation", "maintained a deliberate silence on the matter", "called the explanation unconvincing at best",
  ],
};

// Deterministic, non-overlapping index streams so 3 different tracks drawing
// from the same SUBJECTS x VERB_PHRASES space never produce the same pair.
function plainSentences(level: Level, trackOffset: number, count: number): string[] {
  const verbs = VERB_PHRASES[level];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = trackOffset * 97 + i * 7; // coprime-ish strides keep tracks disjoint
    const subj = SUBJECTS[idx % SUBJECTS.length];
    const verb = verbs[Math.floor(idx / SUBJECTS.length) % verbs.length];
    out.push(`${subj} ${verb}.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// sentence_builds/speaking — 3-part sentences, fixed non-trivial shuffle
// ---------------------------------------------------------------------------
const SB_PARTS: Record<Level, [string, string, string][]> = {
  A1: [
    ["He", "reads", "a book"], ["She", "drinks", "warm milk"], ["They", "have", "a small dog"],
    ["We", "watch", "cartoons"], ["He", "wears", "a blue cap"], ["She", "needs", "a pencil"],
    ["They", "play", "in the garden"], ["We", "eat", "rice and beans"], ["He", "likes", "cold juice"],
    ["She", "has", "a red bike"], ["They", "walk", "to the park"], ["We", "clean", "our room"],
    ["He", "feeds", "the fish"], ["She", "waters", "the plant"], ["They", "sing", "a song"],
  ],
  A2: [
    ["She", "is learning", "to dance"], ["He", "forgot", "his gloves"], ["They", "went", "to the market"],
    ["We", "are planning", "a picnic"], ["She", "missed", "her bus"], ["He", "is reading", "a long novel"],
    ["They", "returned", "the borrowed tent"], ["We", "changed", "our weekend plans"], ["She", "bought", "a warm coat"],
    ["He", "is saving", "for a laptop"], ["They", "visited", "their grandparents"], ["We", "repaired", "the old fence"],
    ["She", "joined", "a cooking class"], ["He", "cancelled", "his gym membership"], ["They", "organized", "a small party"],
  ],
  B1: [
    ["The team", "finished", "the report early"], ["She", "has been studying", "for the exam"], ["He", "decided", "to switch departments"],
    ["The company", "postponed", "the product launch"], ["They", "negotiated", "a lower rent"], ["We", "need to confirm", "the booking today"],
    ["The manager", "apologized", "for the delay"], ["She", "volunteered", "to lead the project"], ["He", "struggled", "to meet the deadline"],
    ["The client", "requested", "a full refund"], ["They", "rescheduled", "the training session"], ["We", "agreed", "on a fair price"],
    ["The firm", "hired", "two new interns"], ["She", "resolved", "the billing issue"], ["He", "proposed", "a new schedule"],
  ],
  B2: [
    ["The proposal", "was rejected", "due to cost concerns"], ["The board", "approved", "the revised budget"], ["Management", "decided", "to postpone the launch"],
    ["The audit", "uncovered", "several minor errors"], ["The firm", "struggled", "to meet rising demand"], ["The client", "pushed back", "on the new pricing"],
    ["The merger", "was finalized", "despite shareholder concerns"], ["The report", "highlighted", "a drop in margins"], ["The committee", "reconsidered", "its earlier decision"],
    ["The vendor", "missed", "the delivery deadline again"], ["The team", "underestimated", "the project's complexity"], ["Investors", "reacted cautiously", "to the announcement"],
    ["The policy", "was revised", "after public criticism"], ["The startup", "secured", "a new round of funding"], ["The factory", "suspended", "production for repairs"],
  ],
  C1: [
    ["Rarely", "has a decision", "drawn such criticism"], ["Little", "could have prepared", "the board for the backlash"], ["Only after the audit", "did the discrepancies", "come to light"],
    ["Not until the review concluded", "did the full extent", "become clear"], ["Far from resolving the dispute", "the ruling", "merely delayed it"], ["Only under pressure", "did the executives", "agree to the review"],
    ["The settlement", "while legally sound", "left many unconvinced"], ["Not only was the plan approved", "it was", "also praised"], ["The firm's recovery", "though gradual", "proved durable"],
    ["Seldom", "do mergers of this scale", "proceed smoothly"], ["The findings", "however preliminary", "point to a pattern"], ["What the proposal lacks in originality", "it makes up", "in practicality"],
    ["The ambiguity in the clause", "left both sides", "free to interpret it"], ["Analysts", "attributed the downturn", "to external pressures"], ["The committee", "remained divided", "over the funding allocation"],
  ],
  C2: [
    ["Seldom", "has a ruling", "been so widely contested"], ["What the report omits", "is more telling", "than what it includes"], ["Only in hindsight", "did the risks", "become fully apparent"],
    ["The policy's neutrality", "was, in practice", "more apparent than real"], ["Not a single warning sign", "went unnoticed", "in hindsight"], ["The institution's caution", "is often mistaken", "for indecision"],
    ["Far from settling the matter", "the verdict", "merely postponed it"], ["What distinguishes this proposal", "is its", "unflinching candor"], ["The dissent", "though outvoted", "raised unaddressed questions"],
    ["Rarely", "has an inquiry", "been so thoroughly contested"], ["The firm's apparent recovery", "owed more", "to one-off sales"], ["Few policies", "have been so widely praised", "and so unevenly applied"],
    ["The committee's silence", "only fueled", "further speculation"], ["Critics", "say the reform", "is more cosmetic than real"], ["The ruling", "sets a precedent", "whose reach may outlast the case"],
  ],
};

function sentenceBuildsForLevel(level: Level): Row[] {
  return SB_PARTS[level].map(([a, b, c]) => sentenceBuild(`${a} ${b} ${c}.`, [c, a, b]));
}

// ---------------------------------------------------------------------------
// Long-form single-text tracks: passage_reconstruction(writing), story_retelling(speaking),
// speaking_situations(reading), summary_and_opinion(reading) — each needs 90 distinct short texts.
// ---------------------------------------------------------------------------
const PASSAGE_RECONSTRUCTION_BANK: Record<Level, string[]> = {
  A1: [
    "Maya has a small garden. She grows tomatoes and flowers. Every morning she waters the plants before school.",
    "Sam has a pet rabbit named Coco. He feeds Coco carrots every day and lets it run in the yard.",
    "Leo likes drawing. He draws pictures of his family and his house. His mother puts them on the wall.",
    "Ana helps her grandmother cook on Sundays. They make soup together and eat it with bread.",
    "Ben collects stamps from different countries. He keeps them in a big book and shows his friends.",
    "Mia has three goldfish. She feeds them every morning and cleans their bowl once a week.",
    "Tom plays the drums after school. His neighbor doesn't mind because he only plays for one hour.",
    "Lily bakes cookies with her brother on weekends. They always share the cookies with their neighbors.",
    "Max walks his dog in the park every evening. The dog likes chasing the ball near the pond.",
    "Zoe grows herbs on her windowsill. She uses them to cook pasta for her family.",
    "Jack builds model airplanes. He has finished six so far and keeps them on a shelf in his room.",
    "Ruby reads one new book every week. Her favorite stories are about animals and adventures.",
    "Omar helps his father wash the car every Saturday morning before breakfast.",
    "Nina paints small pictures of flowers. She gives them to her friends as gifts.",
    "Eli feeds the birds in his garden every morning before school starts.",
  ],
  A2: [
    "Clara started a part-time job at a bakery last month. She enjoys learning how to decorate cakes and talking to customers.",
    "Diego joined a local football club this year. He practices twice a week and has made several new friends.",
    "Hana moved to a new apartment near the river. She likes the view, but the kitchen is smaller than her old one.",
    "Felix started learning to cook after watching cooking videos online. His first attempt at pasta wasn't great, but he kept trying.",
    "Grace volunteers at an animal shelter every weekend. She walks the dogs and helps clean their cages.",
    "Ivan began taking guitar lessons three months ago. He can now play a few simple songs for his friends.",
    "Jana switched to cycling to work after her car broke down. She says it's actually faster during rush hour.",
    "Kofi started a small vegetable garden behind his house. He grows peppers, onions, and herbs for cooking.",
    "Lara signed up for a photography class at the community center. She enjoys taking pictures of old buildings.",
    "Milo adopted a cat from a shelter last spring. The cat was shy at first but is friendly now.",
    "Nora began jogging every morning before work. She says it helps her feel more awake during the day.",
    "Theo started repairing old bicycles as a hobby. He sells the finished ones to neighbors for extra money.",
    "Wren joined a book club that meets once a month. They discuss a different novel each time.",
    "Yara started making her own bread at home. Her first loaves were too dense, but she's improving.",
    "Zack began recycling more carefully after watching a documentary about plastic waste.",
  ],
  B1: [
    "The company introduced a new scheduling system last quarter, but several employees found it confusing at first. After a short training session, most adapted quickly and reported it saved them time.",
    "A local cafe started offering a loyalty program for regular customers. Within two months, repeat visits increased noticeably, and the owner credited the simple point system.",
    "The city council approved a plan to add bike lanes along the main road. Some drivers complained about reduced space, but cyclists welcomed the change.",
    "A small publishing house decided to focus only on translated fiction. Sales were slow initially, but a surprise bestseller changed their fortunes within a year.",
    "The school introduced a mentorship program pairing older students with younger ones. Teachers noticed improved confidence among the younger students within a few months.",
    "A neighborhood association organized a monthly clean-up event. Participation was low at first, but steady promotion through social media eventually tripled attendance.",
    "The clinic switched to an online booking system to reduce waiting times. Patients adjusted well, though a few older visitors needed help with the website.",
    "A regional airline added a new route connecting two mid-sized cities. Demand exceeded expectations, prompting them to add extra flights within weeks.",
    "The library extended its weekend hours after receiving requests from students. Usage during those hours grew steadily over the following semester.",
    "A family-run restaurant began offering cooking classes on slow weeknights. The classes became unexpectedly popular and now require advance booking.",
    "The factory switched one production line to a new supplier after repeated delays. Output improved, though it took a few weeks to adjust to the new process.",
    "A community center started a free repair workshop for household appliances. Residents brought in everything from toasters to lamps, and the sessions quickly filled up.",
    "The hotel renovated its lobby to include a small co-working space. Business travelers responded well, and weekday bookings increased.",
    "A local farmer began selling produce directly through a weekly online order system. Customers appreciated the convenience, and sales grew steadily.",
    "The gym introduced early-morning classes to accommodate commuters. Attendance was modest at first but grew once word spread among regulars.",
  ],
  B2: [
    "The firm's decision to outsource its customer support drew criticism internally, with several managers arguing it would damage service quality. Six months later, satisfaction scores had barely changed, though costs had fallen significantly.",
    "After a prolonged dip in sales, the retailer redesigned its loyalty program entirely, shifting from points to tiered rewards. The change was met with skepticism at launch, but engagement rose substantially within a quarter.",
    "A mid-sized logistics company invested heavily in route-optimization software despite initial resistance from drivers used to their own routines. Delivery times improved, though adoption took longer than management expected.",
    "The university's decision to move several courses entirely online was controversial among faculty, who worried about reduced engagement. Enrollment in those courses actually increased the following year.",
    "A regional bank introduced stricter approval criteria for small-business loans after a rise in defaults. Loan volume dropped sharply, prompting debate over whether the policy had overcorrected.",
    "The manufacturer's shift to a four-day work week was initially framed as an experiment, but productivity metrics held steady, and the policy was made permanent after a year.",
    "A software company's attempt to simplify its pricing structure backfired at first, confusing long-time customers used to the old tiers. A revised rollout six weeks later addressed most complaints.",
    "The city's new recycling policy, which required stricter sorting, was unpopular initially but led to a measurable drop in contamination rates within its first year.",
    "An airline's decision to unbundle baggage fees drew public criticism, yet base fares dropped enough that overall bookings rose in the following quarters.",
    "The hospital's switch to electronic records faced resistance from longtime staff, who found the system slower at first. Error rates fell considerably once training was complete.",
    "A fashion retailer's move to reduce seasonal collections in favor of continuous smaller releases puzzled analysts initially, but inventory costs dropped and markdowns became less frequent.",
    "The telecom provider's rollout of a new customer app was delayed twice due to technical issues, frustrating users who had been promised faster support.",
    "A consulting firm's decision to cap client engagements at three months was unusual in the industry, but it helped reduce staff turnover considerably.",
    "The brewery's expansion into a new region was slower than projected, partly due to unexpected distribution costs that hadn't been factored into the original plan.",
    "A nonprofit's shift toward unrestricted donations, rather than project-specific funding, was risky but ultimately gave it more flexibility during an unexpected budget shortfall.",
  ],
  C1: [
    "The firm's apparent recovery, closely scrutinized by analysts, turned out to owe more to one-off asset sales than to any genuine improvement in its underlying operations — a distinction the annual report conspicuously glossed over.",
    "Although the regulator's inquiry was narrowly scoped, its findings exposed a pattern of disclosure failures that extended well beyond the single case under review, prompting calls for a broader audit.",
    "The committee's reluctance to act decisively on the matter was initially attributed to caution, but internal documents later suggested it stemmed from unresolved disagreements among its own members.",
    "What began as a routine compliance review escalated considerably once auditors discovered discrepancies that predated the current management team, complicating efforts to assign responsibility.",
    "The merger, long presented as a straightforward consolidation, proved far more contentious than either party had anticipated, with integration costs eventually exceeding the original estimate by a wide margin.",
    "Critics of the reform argued it addressed symptoms rather than root causes, a charge the ministry never directly rebutted, choosing instead to emphasize early, modest improvements in outcomes.",
    "The board's decision to proceed with the expansion despite an unfinished audit was defended as pragmatic, though several shareholders later characterized it as reckless in hindsight.",
    "Analysts had largely dismissed the company's warnings about weakening demand, assuming them to be overly cautious, until the subsequent quarter's results proved otherwise.",
    "The settlement, while resolving the immediate dispute, left unanswered the broader regulatory questions that had originally prompted the investigation, a gap several commentators found troubling.",
    "The firm's expansion into unfamiliar markets exposed weaknesses in its due-diligence process that had gone unnoticed during its more cautious, domestic-focused years.",
    "Internal resistance to the new reporting structure was more widespread than executives initially acknowledged, with several senior staff quietly raising objections before the rollout.",
    "The inquiry's conclusions, though framed as measured, implicitly rebuked the earlier review for failing to probe deeply enough into the original allegations.",
    "The firm's reputation, carefully built over decades, proved more fragile than anticipated once a single product recall drew sustained media scrutiny.",
    "Shareholders' growing impatience with the board's cautious pace eventually forced a change in leadership, though the new strategy differed less than many had expected.",
    "The regulator's decision not to pursue further action was interpreted by some as an implicit admission that the original case had been weaker than claimed.",
  ],
  C2: [
    "The institution's studied caution, long mistaken by outsiders for indecision, turned out on closer inspection to be a deliberate strategy — one that preserved its credibility precisely by declining to overreach.",
    "What the inquiry ultimately exposed was not outright negligence but something subtler: a culture of quiet complacency that had settled in gradually enough to escape any single moment of accountability.",
    "The ruling, narrow as it was in formal scope, set a precedent whose practical implications are likely to outlast the dispute that occasioned it by a considerable margin.",
    "Far from resolving the underlying tension, the settlement merely deferred it, trading an immediate crisis for a more diffuse and arguably more intractable one.",
    "The committee's silence on the matter, rather than suggesting indifference, appears in retrospect to have been a calculated refusal to lend the controversy more legitimacy than it already had.",
    "Critics who dismissed the reform as merely cosmetic underestimated how much of the sector's dysfunction had, in fact, been symbolic rather than structural to begin with.",
    "The firm's apparent stability, which reassured even skeptical analysts for years, rested on assumptions about liquidity that few had thought to question until it was too late.",
    "What distinguished this particular scandal from its many predecessors was not its severity but the unusual candor with which those responsible eventually acknowledged it.",
    "The dissenting opinion, though legally inconsequential, articulated concerns that the majority's reasoning never satisfactorily addressed, a gap later commentary returned to repeatedly.",
    "The policy's ostensible neutrality concealed a far more selective pattern of enforcement, one that only became visible once outcomes were examined across several years rather than a single cycle.",
    "Seldom has an organization's reputation proven so resilient to repeated controversy, a durability some attributed to genuine trust and others to simple public fatigue.",
    "The report's understated tone, which some read as evasive, was in fact precisely what lent its conclusions the weight they eventually carried.",
    "That the ambiguity in the original clause was never resolved says less about oversight than about a deliberate reluctance to force a politically awkward clarification.",
    "The board's belated acknowledgment of the forecast's flaws came only after external pressure made further equivocation untenable.",
    "What little prepared observers for the scale of the reversal was the institution's own, now evidently misplaced, confidence in its original assessment.",
  ],
};

// story_retelling/speaking — narrative "story" texts, distinct wording from
// the passage_reconstruction bank above (same register, different content).
const STORY_RETELLING_BANK: Record<Level, string[]> = {
  A1: [
    "Pip the dog buried a bone in the yard, but he forgot where it was. He looked all day until he found it under a bush.",
    "A little bird built a nest in a tree. One day the wind blew the nest down, so the bird built a new, stronger one.",
    "Kofi lost his toy car at the park. A kind girl found it and gave it back to him the next day.",
    "A cat climbed too high in a tree and could not come down. A firefighter came with a ladder and helped the cat down.",
    "Sara planted a seed in a pot. She watered it every day, and after two weeks a small flower grew.",
    "A boy dropped his ice cream on the ground. His sister shared her own ice cream with him so he wouldn't be sad.",
    "A duck family crossed a busy road. A kind driver stopped his car so all the ducklings could cross safely.",
    "Timmy couldn't find his shoes before school. He finally found them under his bed and arrived just in time.",
    "A mouse found a piece of cheese in a kitchen. He carried it all the way back to his family under the floor.",
    "A girl's kite got stuck in a tree. Her father climbed up carefully and brought it back down for her.",
    "A puppy chewed a hole in a blanket. His owner wasn't angry, she just gave him a chew toy instead.",
    "Two children built a sandcastle at the beach. When the tide came in, they quickly moved it further from the water.",
    "A rabbit hid from the rain under a big leaf. When the rain stopped, it hopped home to its burrow.",
    "A boy forgot his umbrella and got caught in the rain. A neighbor saw him and offered to share hers.",
    "A squirrel collected nuts all autumn and hid them in different spots to eat later in winter.",
  ],
  A2: [
    "Elena started volunteering at a community garden after seeing a flyer at her local cafe. At first she knew nothing about plants, but after a summer of help from other volunteers, she grew her own vegetables.",
    "Marco's bicycle was stolen outside the library. He reported it to the police, and a week later an officer called to say it had been found two streets away.",
    "A group of students organized a small fundraiser for a classmate whose house had caught fire. They raised enough money in two days to help the family buy new furniture.",
    "Priya's flight was cancelled due to weather, stranding her overnight at the airport. A stranger sitting nearby shared snacks and stories with her until her new flight the next morning.",
    "Dev forgot his wallet at a cafe but didn't realize until he got home. When he called, the owner said she had already set it aside for him.",
    "A new neighbor moved in next door to Lina and seemed shy at first. After Lina brought over some homemade bread, they became close friends within weeks.",
    "Yusuf's car broke down on a quiet country road at night. A passing farmer stopped, gave him a ride to the nearest town, and refused to accept any payment.",
    "A school choir practiced for months for a competition, but their bus broke down on the morning of the event. A local bus company lent them a replacement at the last minute.",
    "Camille's dog ran off during a thunderstorm and was missing for two days. A neighbor finally spotted it hiding under a porch three streets away.",
    "A tourist got lost looking for his hotel late at night. A shopkeeper closing up for the evening walked with him the whole way there.",
    "Noor's laptop crashed the night before an important assignment was due. A classmate stayed up with her over video call, helping her recover the file.",
    "A man dropped his groceries on a crowded sidewalk. Several strangers stopped immediately to help him gather everything back into the bags.",
    "Aiko's umbrella broke in strong wind on her way to work. A coworker she barely knew offered to share theirs for the rest of the walk.",
    "A child's balloon escaped at a fair and floated toward a tree. A stranger climbed partway up and managed to retrieve it for the crying child.",
    "Rafael missed the last bus home after a late shift. His manager, who was leaving at the same time, offered him a ride instead.",
  ],
  B1: [
    "A small bakery in town was struggling to attract customers until the owner started posting photos of her pastries online. Within a few months, word spread and the shop became a local favorite, with lines forming before opening time.",
    "A group of coworkers decided to carpool together after noticing how much they were all spending on parking. What started as a way to save money turned into a weekly tradition of catching up during the drive.",
    "After a storm knocked out power across the neighborhood, several families set up a shared barbecue using what was in their freezers before the food spoiled. The unexpected gathering ended up lasting well into the night.",
    "A retired teacher began tutoring neighborhood children for free after noticing how many were falling behind during school closures. Parents were so grateful that they eventually organized a small thank-you dinner in her honor.",
    "A local shop owner noticed an elderly customer struggling to carry groceries home each week and began offering to deliver them personally. The small gesture grew into a weekly routine neither of them wanted to stop.",
    "A office manager started a lost-and-found board after noticing how often small items went missing. Within weeks, it had reunited dozens of coworkers with lost umbrellas, chargers, and keys.",
    "A commuter train was delayed for hours one evening, and passengers began sharing snacks and stories to pass the time. Several strangers exchanged contact details and stayed in touch long after.",
    "A community center started offering free repair workshops after noticing how many broken appliances ended up in the trash. The sessions became so popular that volunteers now have a waiting list each month.",
    "A new employee struggled to find her way around the large office building during her first week. A security guard noticed and began greeting her each morning with directions until she learned the layout herself.",
    "A neighborhood noticed an increase in stray cats and organized a volunteer group to help feed and eventually find homes for them. Within a year, most of the cats had been adopted by local families.",
    "A man waiting at a bus stop struck up a conversation with a stranger about a shared hobby. They ended up starting a small weekend club that now meets regularly at the same cafe.",
    "A library noticed declining visits from teenagers and started a gaming club on weekends to draw them back in. Attendance grew steadily, and the club now runs its own small tournaments.",
    "A delivery driver noticed the same elderly customer was rarely home when deliveries arrived and began leaving a short note each time. Eventually they became friendly enough that she started leaving him tea.",
    "A small town's only cinema nearly closed due to low attendance, until residents organized a fundraiser to keep it open. The cinema now hosts a popular monthly community film night.",
    "A group of parents at a school noticed the playground equipment was outdated and organized a weekend of volunteer repairs. The project brought together families who had never spoken before.",
  ],
  B2: [
    "When a mid-sized manufacturer lost its main supplier overnight due to a factory fire overseas, the operations team scrambled to find an alternative within days. The replacement supplier turned out to be more reliable, and the company never returned to its original source.",
    "A regional airline's decision to add a budget tier was initially dismissed by competitors as a desperate move. Within two years, however, the tier had become the airline's most profitable segment, prompting rivals to launch similar offerings.",
    "A software firm's flagship product was quietly being outpaced by a smaller competitor's free alternative. Rather than compete on price, the firm pivoted to enterprise clients, a shift that ultimately saved the company.",
    "A city's public transport authority faced growing criticism over unreliable service, until an unexpected leadership change brought in a reformer with a background in logistics rather than politics. Punctuality improved markedly within a year.",
    "A boutique hotel chain nearly collapsed after a wave of negative reviews tied to renovation delays. The company's decision to personally contact every dissatisfied guest, rather than respond publicly, slowly rebuilt its reputation.",
    "A manufacturing plant's decision to automate a single production line was met with fierce resistance from the union, which feared job losses. Output rose as predicted, but so did headcount, as new roles emerged to maintain the equipment.",
    "A regional newspaper, long assumed to be dying, found new life after shifting entirely to a subscription model online. Within three years, digital subscribers outnumbered what print readership had ever reached.",
    "A consulting firm's reputation suffered after a high-profile project failure, prompting several major clients to quietly withdraw. The firm's response — an unusually candid public account of what went wrong — surprised the industry and ultimately restored much of its credibility.",
    "A retailer's attempt to eliminate physical stores entirely backfired when online-only sales failed to match projections. A partial retreat, reopening a smaller number of flagship locations, proved far more successful than either extreme.",
    "A tech startup's founders disagreed sharply over whether to accept an early acquisition offer. The decision to decline, made against the advice of several investors, was vindicated only years later when the company's valuation far exceeded the original bid.",
    "A logistics company's experiment with a four-day work week was initially framed internally as temporary, pending results. Productivity held steady, and what began as a trial quietly became permanent policy.",
    "A restaurant chain's decision to simplify its menu drastically was unpopular with longtime regulars at first. Sales actually rose once the kitchen could focus on fewer dishes done consistently well.",
    "A nonprofit's unconventional decision to publish its own internal failures in an annual report drew initial skepticism from donors. Transparency, rather than undermining confidence, ended up attracting more sustained funding than before.",
    "A manufacturer's recall of a faulty product, handled publicly and without deflection, became an unlikely case study in reputation management after sales rebounded faster than analysts expected.",
    "A regional bank's cautious, slow approach to digital banking was mocked by faster-moving competitors for years. When several of those competitors suffered security breaches, the bank's conservative pace was suddenly reframed as prudence.",
  ],
  C1: [
    "The firm's decision to walk away from a lucrative but ethically ambiguous contract was initially viewed internally as a costly overreaction to a single client complaint. Years later, as scrutiny of the industry intensified, the decision was credited with insulating the company from a scandal that engulfed several of its rivals.",
    "A mid-tier university's choice to reject a large corporate donation over governance concerns drew criticism from board members who saw it as needlessly principled. The institution's reputation for independence, strengthened by the episode, later proved decisive in attracting research partnerships that more compromised rivals could not secure.",
    "An airline's quiet decision to retire an aging aircraft model ahead of schedule, absorbing the cost rather than waiting for regulatory pressure, was framed internally as excessive caution. When a near-identical model suffered a high-profile incident at a competitor, the airline's early move was reassessed as foresight.",
    "A regulator's unusually narrow ruling in a landmark case was criticized at the time for failing to settle the broader questions at stake. In the years since, the narrowness has been reinterpreted as a deliberate strategy to avoid overreach that might have been challenged and overturned.",
    "A publisher's refusal to rush a controversial manuscript to print, despite competitive pressure, was initially seen as a missed commercial opportunity. The eventual, more carefully fact-checked edition avoided a defamation suit that befell a rival publisher who moved faster.",
    "A manufacturer's insistence on an unusually long product-testing phase delayed its entry into a competitive market by nearly a year. The delay, once seen as a strategic blunder, later appeared prescient when competitors' rushed products suffered costly recalls.",
    "A city planning board's rejection of a politically popular development proposal, citing unresolved environmental concerns, was deeply unpopular at the time. The subsequent discovery of serious site contamination vindicated the board's caution long after the initial backlash had faded.",
    "A firm's decision to maintain an unusually conservative balance sheet through a period of rapid industry growth drew criticism from analysts who saw it as overly cautious. When a downturn hit, the firm's reserves allowed it to acquire distressed competitors at a fraction of their earlier value.",
    "An insurer's unpopular decision to raise premiums ahead of a wave of claims it anticipated was criticized as needlessly aggressive. When the anticipated losses materialized industry-wide, the insurer's earlier adjustment left it in a markedly stronger position than its competitors.",
    "A broadcaster's refusal to air a sensational but unverified story, despite pressure from its own newsroom, was dismissed at the time as institutional timidity. The story's later debunking elsewhere spared the broadcaster a credibility crisis that damaged several competitors.",
    "A pharmaceutical company's decision to halt a promising trial over ambiguous safety signals was costly and widely second-guessed within the firm. External review years later confirmed the signals had in fact warranted the halt, reversing the internal narrative entirely.",
    "A law firm's decision to decline a high-profile client over a conflict-of-interest concern others considered manageable seemed overly cautious at the time. The client's later legal troubles made the firm's earlier caution look, in retrospect, like sound judgment rather than excessive risk-aversion.",
    "A museum's refusal to accept a donated collection without full provenance documentation drew accusations of bureaucratic rigidity. Subsequent revelations about the collection's disputed origins elsewhere spared the museum a reputational crisis faced by a rival institution that had accepted it.",
    "A telecom provider's decision to invest heavily in infrastructure years before demand justified it was criticized by shareholders as premature. When demand eventually surged, the early investment gave the company a decisive advantage over competitors scrambling to catch up.",
    "A government agency's insistence on an unusually lengthy public comment period for a new regulation was criticized as bureaucratic delay. The extended process ultimately surfaced a significant flaw in the original proposal that would have proven costly to correct after implementation.",
  ],
  C2: [
    "The firm's refusal to meet an activist investor's demands, dismissed at the time as obstinate and self-defeating, was later understood as a calculated wager on the investor's own limited patience — a wager that paid off only once the investor's attention, as anticipated, moved elsewhere.",
    "What the institution's critics characterized as paralysis during the crisis was, internal records later revealed, a deliberate strategy of visible inaction designed to avoid legitimizing a dispute that genuine engagement would have only prolonged.",
    "The committee's decision to withhold its findings pending further review, excoriated at the time as evasive, proved in retrospect to have spared several individuals from accusations that subsequent evidence would not have supported.",
    "A publisher's quiet decision to delay a prestigious prize announcement, framed publicly as a procedural formality, was in fact an attempt to avoid honoring a nominee whose conduct an unpublished internal inquiry had already begun to question.",
    "The regulator's studied ambiguity on a contentious point of law, widely read as institutional timidity, turned out to be a hedge against a legal challenge its own counsel had privately warned was likely to succeed.",
    "An institution's decision to forgo a seemingly unimpeachable endorsement, baffling to outside observers at the time, reflected private reservations about the endorser's judgment that would only be publicly vindicated years later.",
    "The board's refusal to comment on a widely reported controversy, derided as evasive by the press, was later revealed to stem from an ongoing confidential investigation that public comment would have jeopardized.",
    "A firm's decision to quietly unwind a seemingly successful partnership, inexplicable to analysts at the time, anticipated a reputational entanglement that only became public knowledge through a separate, unrelated disclosure years later.",
    "The agency's unusually cautious wording in a public advisory, mocked at the time as toothless, was calibrated precisely to avoid a legal overreach that a more assertive statement would almost certainly have invited.",
    "A university's rejection of a seemingly generous endowment, framed by critics as needless self-sabotage, reflected private concerns about the donor's intentions that would only be substantiated by an unrelated inquiry years afterward.",
    "The firm's decision to understate a genuinely promising result, baffling to its own investors at the time, was a deliberate hedge against raising expectations a still-uncertain regulatory process might not ultimately meet.",
    "A broadcaster's decision to bury a minor correction rather than issue it prominently, criticized as evasive, reflected an internal judgment — later proven accurate — that prominence would have disproportionately amplified a now largely forgotten error.",
    "The court's narrowly worded opinion, criticized for sidestepping the case's larger implications, was in fact a calculated attempt to resolve the dispute without inviting the broader legislative challenge a sweeping ruling would have provoked.",
    "An institution's decision to quietly settle rather than litigate a case it was widely expected to win reflected a private assessment that a public trial risked surfacing details more damaging than the settlement itself.",
    "The firm's uncharacteristic silence following a damaging leak, assumed by commentators to signal guilt, in fact reflected legal advice that any response risked confirming details that remained, at that point, unconfirmed.",
  ],
};

// summary_and_opinion/reading — passages to summarize + give an opinion on;
// distinct register and content from the two banks above.
const SUMMARY_AND_OPINION_BANK: Record<Level, string[]> = {
  A1: [
    "Many children like ice cream. It is cold and sweet. Some people think it is bad for your teeth.",
    "Dogs need walks every day. Walking is good exercise. Some people think dogs should stay inside more.",
    "Reading books helps children learn new words. Some people think watching TV teaches the same things.",
    "Vegetables are good for your body. Many children don't like the taste. Parents try different recipes to help.",
    "Riding a bike is fun and healthy. Some streets are not safe for bikes. Cities are building more bike paths.",
    "Sleeping early helps children feel good at school. Some children like staying up late to play games.",
    "Sharing toys with friends makes playing more fun. Some children find sharing difficult at first.",
    "Drinking water is important every day. Some children prefer sweet juice instead of water.",
    "Playing outside is good for children's health. Some parents worry about the weather or safety.",
    "Brushing teeth twice a day keeps them healthy. Some children forget to brush before bed.",
    "Helping with chores teaches children responsibility. Some children think chores are boring.",
    "Wearing a seatbelt keeps people safe in cars. Some people forget to wear one on short trips.",
    "Eating breakfast gives children energy for school. Some children skip breakfast because they are in a hurry.",
    "Saying please and thank you is polite. Some young children forget to say these words.",
    "Washing hands before eating stops germs from spreading. Some children forget to wash their hands.",
  ],
  A2: [
    "More people are working from home these days. Some say it saves time and money on travel. Others miss talking to coworkers in person every day.",
    "Many schools now give students tablets instead of books. Some teachers think this makes lessons more interesting. Others worry students spend too much time looking at screens.",
    "Some cities are building more parks in the city center. Supporters say parks make people happier and healthier. Critics say the land could be used for more housing instead.",
    "A growing number of people are choosing to cook at home instead of eating out. Some say it's cheaper and healthier. Others say they don't have time to cook after work.",
    "Many offices now allow casual clothing instead of formal suits. Supporters say it makes people more comfortable. Others think formal clothing looks more professional.",
    "Some towns have started banning cars from their main streets. Supporters say it makes the area quieter and safer. Shop owners worry it will reduce customers.",
    "More people are shopping online instead of visiting stores. Some say it's more convenient and saves time. Others miss seeing products in person before buying.",
    "A number of schools have started teaching cooking classes. Supporters say it teaches useful life skills. Critics think the time could be used for other subjects.",
    "Many people are choosing electric bikes over cars for short trips. Supporters say it's cheaper and better for the environment. Others say electric bikes are too expensive to buy.",
    "Some companies now let employees choose their own working hours. Supporters say it makes people more productive. Others worry it makes teamwork harder.",
    "More restaurants are offering smaller portion sizes at lower prices. Some customers like having more choice. Others feel the smaller portions aren't good value.",
    "Several libraries have started lending tools and equipment, not just books. Supporters say it saves people money. Others think libraries should focus only on books.",
    "A number of neighborhoods have introduced community gardens. Supporters say it brings neighbors together. Others worry about who is responsible for maintaining them.",
    "Many gyms now offer online fitness classes as well as in-person ones. Some people like the flexibility. Others say online classes feel less motivating.",
    "Several airlines have started charging extra for seat selection. Some travelers accept it as normal. Others feel it's an unfair additional cost.",
  ],
  B1: [
    "Several companies have introduced four-day work weeks on a trial basis. Supporters argue that productivity remains steady while employee wellbeing improves significantly. Critics worry that compressing the same workload into fewer days increases daily stress rather than reducing it overall.",
    "Some cities have begun charging drivers a fee to enter busy downtown areas during peak hours. Proponents claim it reduces traffic and pollution noticeably. Opponents argue it unfairly burdens lower-income commuters who have fewer transport alternatives.",
    "A growing number of universities now offer fully online degree programs at lower cost. Advocates say this makes education more accessible to people who couldn't otherwise attend. Skeptics argue that online learning lacks the personal interaction that enriches the university experience.",
    "Several supermarkets have started removing self-checkout machines after customer complaints. Supporters of the change say staffed checkouts offer better service and reduce theft. Others argue self-checkout is faster and prefer it for simple purchases.",
    "Some employers now require new graduates to complete a probation period before receiving full benefits. Companies argue this helps ensure new hires are a genuine fit. Employee advocates say it creates unnecessary job insecurity for people already facing a difficult market.",
    "A number of cities have introduced stricter noise regulations for late-night venues. Residents welcome the change, citing improved sleep and quality of life. Business owners argue it threatens nightlife and local tourism revenue.",
    "Several schools have replaced traditional exams with ongoing project-based assessment. Supporters believe this better reflects real-world skills. Critics worry it makes it harder to compare students fairly across different schools.",
    "Some airlines have begun offering significantly cheaper fares in exchange for no checked baggage allowance. Budget travelers appreciate the lower upfront cost. Frequent flyers argue the added baggage fees often end up costing more overall.",
    "A number of retailers have shifted entirely to digital receipts. Environmentally conscious customers support the change as a way to reduce paper waste. Others find digital receipts inconvenient for returns and record-keeping.",
    "Several local governments have introduced curbside composting programs. Supporters highlight the environmental benefits of reducing landfill waste. Critics point to the added cost and effort required from households.",
    "Some companies have begun requiring a short cooling-off period before accepting a resignation. Employers argue this reduces impulsive departures. Employees sometimes find it patronizing and unnecessary.",
    "A number of parks have introduced designated off-leash areas for dogs. Dog owners appreciate the freedom it gives their pets. Other park visitors worry about safety around unleashed animals.",
    "Several banks have closed physical branches in favor of online-only banking. The banks argue this reflects how most customers now prefer to manage their accounts. Older customers often feel left behind by the change.",
    "Some cities have started installing public water refill stations instead of selling bottled water. Environmental groups praise the move as reducing plastic waste. Vendors worry about the impact on their sales.",
    "A number of offices have begun hot-desking instead of assigning permanent desks. Management argues this saves space and encourages collaboration. Some employees feel it removes a sense of personal space at work.",
  ],
  B2: [
    "Several governments have begun experimenting with universal basic income pilot programs. Supporters argue that a guaranteed income reduces poverty and gives people the freedom to pursue better jobs or education. Critics contend that such programs are prohibitively expensive at scale and may reduce incentives to work.",
    "A number of tech companies have introduced mandatory 'right to disconnect' policies, discouraging after-hours emails. Advocates say this protects employee wellbeing and reduces burnout. Skeptics argue it simply shifts urgent work to earlier hours without actually reducing total workload.",
    "Some cities have banned short-term rental platforms in residential neighborhoods. Supporters argue this protects long-term housing availability and community character. Property owners and platform companies argue it unfairly limits how people can use their own property.",
    "Several retailers have begun using dynamic pricing that changes based on demand, similar to airline tickets. Companies argue this better matches supply with demand. Consumer advocates worry it disproportionately affects those unable to shop at off-peak times.",
    "A growing number of employers now use algorithmic tools to screen job applicants. Proponents claim this makes hiring faster and reduces human bias. Critics argue the algorithms can encode bias in less visible, harder-to-challenge ways.",
    "Some countries have introduced a 'right to repair' law requiring manufacturers to make spare parts available. Consumer groups argue this reduces waste and empowers buyers. Manufacturers argue it undermines product safety standards and intellectual property protections.",
    "Several cities have piloted congestion-based parking fees that rise during busy periods. Supporters say this better manages scarce parking resources. Critics argue it penalizes those with inflexible schedules, such as shift workers.",
    "A number of companies have begun publishing detailed pay-gap reports voluntarily. Supporters argue transparency drives accountability and faster progress on equity. Some executives worry it oversimplifies complex compensation structures and invites unfair comparisons.",
    "Several insurers have started offering usage-based car insurance that tracks driving habits. Supporters say it rewards safer drivers with lower premiums. Privacy advocates are uneasy about the extent of data collection involved.",
    "A growing number of universities have dropped standardized test requirements for admission. Supporters argue this reduces socioeconomic bias in the process. Critics worry it removes one of the few consistent benchmarks across very different schools.",
    "Some cities have introduced heavily subsidized public transport to reduce car dependency. Supporters point to lower emissions and congestion. Critics question whether the subsidies are financially sustainable in the long run.",
    "Several large employers have begun offering unlimited paid leave policies. Supporters argue this signals trust and improves morale. Studies suggest employees under such policies sometimes take less time off than under fixed-allowance systems.",
    "A number of streaming services have started cracking down on password sharing. Companies argue this protects revenue that funds new content. Subscribers argue the change effectively raises prices without adding value.",
    "Some governments have proposed taxing unhealthy food products more heavily. Public health advocates argue this could reduce diet-related illness. Critics say such taxes disproportionately affect lower-income households.",
    "Several cities have begun converting unused office space into residential housing. Supporters argue this addresses both vacancy and housing shortages simultaneously. Developers note the conversions are often more costly than new construction.",
  ],
  C1: [
    "The proliferation of algorithmic content moderation on social platforms has been defended as a necessary response to scale, yet its opacity raises legitimate concerns about accountability. Proponents argue that human moderation alone cannot keep pace with the volume of content generated daily, while critics contend that outsourcing such consequential decisions to largely unaccountable systems undermines meaningful recourse for those affected.",
    "Central banks' increasing willingness to use interest rates as a tool against asset bubbles, rather than solely inflation, marks a significant departure from prior orthodoxy. Supporters argue this broader mandate helps prevent destabilizing financial crises before they occur. Detractors warn that expanding the central bank's remit risks politicizing an institution whose credibility depends on narrow, predictable objectives.",
    "The expansion of non-compete clauses beyond senior executives to cover a much broader swath of the workforce has drawn growing regulatory scrutiny. Employers argue such agreements protect legitimate investments in training and proprietary knowledge. Labor advocates counter that their widespread use suppresses wage growth and mobility far beyond what is necessary to protect any genuine business interest.",
    "The growing reliance on private arbitration clauses in consumer contracts has shifted a substantial share of disputes away from public courts. Businesses argue arbitration is faster and less costly than litigation for all parties involved. Consumer advocates contend it systematically favors repeat corporate participants over individual claimants navigating the process for the first time.",
    "Several jurisdictions have begun requiring companies to disclose the carbon footprint of their supply chains, not just their direct operations. Supporters argue this closes a significant loophole that previously let companies outsource their emissions on paper. Industry groups warn that accurately measuring indirect emissions across complex global supply chains is far more difficult than regulators assume.",
    "The rise of subscription-based business models across industries once dominated by one-time purchases has reshaped consumer spending patterns considerably. Companies argue this provides more predictable revenue and funds continuous product improvement. Critics argue it has normalized a steady accumulation of recurring charges that many consumers struggle to track or justify.",
    "Growing scrutiny of academic publishing's reliance on unpaid peer review has prompted calls for structural reform. Defenders of the current system argue that peer review, whatever its flaws, remains essential to maintaining research quality. Reformers contend that an industry generating substantial profit from unpaid labor deserves a fundamentally different compensation model.",
    "The expansion of biometric surveillance in public spaces, often justified on security grounds, has outpaced the legal frameworks meant to govern its use. Proponents argue it deters crime and aids investigations measurably. Civil liberties advocates warn that normalizing pervasive surveillance erodes privacy protections that, once lost, are rarely fully restored.",
    "Some regulators have proposed requiring companies to justify algorithmic pricing decisions that result in different prices for similar customers. Businesses argue that personalized pricing reflects legitimate differences in cost-to-serve and willingness to pay. Consumer advocates argue it can entrench discriminatory outcomes that are difficult to detect without such disclosure.",
    "The growing use of non-disclosure agreements to settle workplace misconduct claims has drawn criticism even as it remains legally common. Employers argue such agreements provide privacy and finality that benefit all parties involved. Critics contend they frequently serve to shield repeat offenders from accountability at the expense of future victims.",
    "Several governments have begun taxing short-term capital gains more heavily than long-term holdings to discourage speculative trading. Supporters argue this encourages more stable, long-term investment behavior. Critics argue it penalizes legitimate traders providing market liquidity without meaningfully curbing genuine speculation.",
    "The rapid growth of buy-now-pay-later services has expanded access to credit for consumers who might not qualify for traditional cards. Providers argue this offers a more transparent, interest-free alternative to credit card debt. Consumer advocates worry it encourages overspending among those least able to absorb a financial shock.",
    "Increasing calls to regulate influencer marketing as a form of advertising have met resistance from platforms reluctant to impose stricter labeling requirements. Regulators argue consumers deserve clear disclosure regardless of the medium. Platforms argue that overly rigid rules could stifle a format whose appeal depends partly on its informal, personal tone.",
    "The trend toward shorter, more frequent product release cycles in consumer electronics has drawn criticism from environmental groups concerned about electronic waste. Manufacturers argue this pace reflects genuine technological progress and consumer demand. Critics argue much of the incremental improvement could easily be bundled into less frequent, more substantial updates.",
    "Growing adoption of remote hiring without in-person interviews has broadened access to talent across geographic boundaries considerably. Employers report being able to recruit from a far wider pool than before. Some hiring managers worry that remote-only assessment makes it harder to evaluate certain interpersonal qualities reliably.",
  ],
  C2: [
    "The quiet consolidation of market power among a handful of dominant technology firms has proceeded largely through acquisitions too small individually to trigger conventional antitrust scrutiny, raising the uncomfortable question of whether existing regulatory frameworks, built for an earlier era of commerce, remain fit for purpose at all.",
    "The increasing sophistication of synthetic media has outpaced not only the technical means of detecting it but also the public's intuitive trust in recorded evidence itself, a development whose long-term epistemic consequences may prove more consequential than any single instance of deception it enables.",
    "The growing practice among central banks of signaling policy intentions well in advance, ostensibly to reduce market volatility, has arguably transferred a measure of genuine decision-making power to the markets themselves, which now anticipate and partially pre-empt the very actions central banks have yet to formally announce.",
    "The steady erosion of tenure protections across academia, framed by administrators as a necessary response to fiscal pressure, has coincided with a measurable narrowing of the research questions scholars are willing to pursue publicly — a correlation that proponents of the changes have been notably reluctant to examine directly.",
    "The expansion of algorithmic decision-making into domains once reserved for human discretion — sentencing recommendations, loan approvals, hiring — has been defended as a means of reducing bias, even as mounting evidence suggests such systems frequently launder existing biases behind a veneer of mathematical neutrality.",
    "The normalization of perpetual beta releases in software development, once a stopgap born of resource constraints, has quietly redefined consumer expectations to the point where genuinely finished products are now the exception rather than the baseline assumption.",
    "The growing reliance of democratic institutions on privately owned digital infrastructure for public discourse has created a peculiar dependency in which the terms of civic participation are set, however indirectly, by entities with no formal accountability to the public they now help to constitute.",
    "The persistent gap between an organization's stated values and its measurable outcomes, often dismissed as an inevitable feature of institutional life, deserves closer scrutiny precisely because that very dismissal has become the mechanism by which the gap is allowed to persist.",
    "The rise of reputation-management as its own industry has subtly altered the incentive structure around public accountability, rewarding the appearance of contrition at least as reliably as it rewards the substantive changes contrition is meant to signal.",
    "The quiet financialization of previously non-market domains — healthcare, housing, even personal data — has proceeded less through any single decisive policy than through the cumulative effect of countless incremental choices, each individually defensible, whose aggregate consequences were rarely debated as a whole.",
    "The growing asymmetry between the speed of technological deployment and the deliberative pace of regulatory response has produced a de facto policy of permitting first and restricting later, a sequence whose costs are rarely distributed evenly across those affected.",
    "The institutionalization of whistleblower protections, however well-intentioned, has not meaningfully altered the calculus facing most potential whistleblowers, for whom the practical costs of disclosure remain stubbornly disproportionate to the formal guarantees on paper.",
    "The growing tendency of public institutions to outsource politically sensitive decisions to ostensibly independent expert panels functions, intentionally or not, as a means of diffusing accountability for outcomes the institutions themselves remain ultimately responsible for.",
    "The persistence of short-termism in corporate governance, repeatedly diagnosed and repeatedly left unaddressed, suggests the problem may lie less in any failure of analysis than in the fact that those positioned to fix it are rarely the ones bearing its long-term costs.",
    "The steady migration of public services onto digital-only platforms, justified on efficiency grounds, has quietly redefined access to basic civic functions as contingent on a level of digital literacy and connectivity that remains far from universally distributed.",
  ],
};

// speaking_situations/reading — SHORT "respond to this" prompts (distinct,
// much shorter register than the narrative banks above).
const SPEAKING_SITUATIONS_BANK: Record<Level, string[]> = {
  A1: [
    "A friend lends you their umbrella. What do you say?",
    "You are hungry at a friend's house. What do you say?",
    "Someone steps on your foot by accident. What do you say?",
    "You want to borrow a pencil from a classmate. What do you say?",
    "Your friend is sad. What do you say to them?",
    "You meet someone new. What do you say?",
    "You want some water. What do you say to your mother?",
    "A classmate lends you a crayon. What do you say?",
    "You are leaving a friend's house. What do you say?",
    "A classmate drops their books. What do you say?",
    "You want to play with a friend. What do you say?",
    "Someone gives up their seat for you. What do you say?",
    "You are late for class. What do you say to your teacher?",
    "A friend shares their lunch with you. What do you say?",
    "Someone asks how you are. What do you say?",
  ],
  A2: [
    "You ordered the wrong size online. Explain the situation to the shop and ask for an exchange.",
    "You arrived late for a class. Apologize to your teacher and explain why.",
    "A friend forgot your birthday. Tell them how you feel about it.",
    "Your neighbor's music is too loud at night. Politely ask them to turn it down.",
    "You found someone's wallet on the street. Explain what you will do with it.",
    "You want to cancel a reservation you made. Call the restaurant and explain.",
    "A friend invited you to an event you can't attend. Explain why and suggest another time.",
    "You received the wrong item in a delivery. Contact the shop and explain the problem.",
    "Your flight was delayed and you missed a connection. Explain the situation to an airline worker.",
    "You want to return a shirt that doesn't fit. Explain this to the shop assistant.",
    "A classmate borrowed your notes and hasn't returned them. Ask for them back politely.",
    "You need to reschedule a doctor's appointment. Call the clinic and explain why.",
    "Your package arrived damaged. Contact the seller and explain the situation.",
    "You want to join a gym but have questions about membership. Ask the staff.",
    "A friend wants to borrow money. Explain how you feel about lending it.",
  ],
  B1: [
    "Your coworker keeps interrupting you in meetings. Explain how this makes you feel and ask them to stop.",
    "You need to tell your manager you'll miss a deadline. Explain why and propose a new date.",
    "A client is unhappy with a delay in their order. Apologize and explain what you're doing to fix it.",
    "You disagree with a decision your team made. Explain your concerns respectfully.",
    "Your landlord hasn't fixed a broken heater. Explain the problem and ask for a timeline.",
    "A friend keeps cancelling plans at the last minute. Tell them how this affects you.",
    "You want to negotiate a lower price for a service. Explain your reasoning to the provider.",
    "Your team submitted a report with an error. Explain the situation to your manager.",
    "A colleague took credit for your idea in a meeting. Address the situation with them directly.",
    "You need more time to finish a project. Explain the delay to your supervisor.",
    "A client is upset about an incorrect invoice. Respond to them and offer a solution.",
    "You want to request a transfer to a different department. Explain your reasons to HR.",
    "Your subscription was renewed without your consent. Contact the company to resolve it.",
    "A neighbor's pet keeps damaging your garden. Address the issue with them calmly.",
    "You need to decline a work invitation due to a scheduling conflict. Explain politely.",
  ],
  B2: [
    "Your manager wants to implement a policy you believe will hurt team morale. Voice your concerns constructively.",
    "A long-term client is threatening to leave over a pricing dispute. Address their concerns and try to retain them.",
    "You discovered an error in a report your team already submitted. Explain the mistake to your supervisor.",
    "A vendor consistently misses agreed deadlines. Address the pattern directly and outline your expectations.",
    "Your team is divided over which approach to take on a project. Propose a way to reach a decision.",
    "You need to tell an employee their performance isn't meeting expectations. Deliver the feedback constructively.",
    "A colleague's behavior in meetings has become disruptive. Address it directly but diplomatically.",
    "Your request for additional budget was denied. Make the case again with stronger justification.",
    "A supplier's quality has declined recently. Raise the issue and ask for a corrective plan.",
    "You need to push back on an unreasonable deadline from a client. Explain the constraints clearly.",
    "Your team's workload has become unsustainable. Raise the issue with management and propose solutions.",
    "A business partner wants to change the terms of an agreement last minute. Respond to their request.",
    "You need to explain a significant delay to stakeholders without losing their confidence.",
    "A junior colleague keeps making the same mistake. Address it supportively but clearly.",
    "Your proposal was rejected, but you still believe in it. Make a case for reconsidering it.",
  ],
  C1: [
    "You need to inform the board that a major project will significantly exceed its budget. Explain the situation and your recommended next steps.",
    "A key client is unhappy about a confidentiality breach, however minor. Address their concerns and outline corrective measures.",
    "Your organization is considering a restructuring that will affect your department. Present your concerns to leadership.",
    "A regulatory body has raised questions about your company's compliance practices. Respond to their inquiry professionally.",
    "You need to challenge a decision made by senior management that you believe is flawed. Make your case respectfully.",
    "A long-standing partnership is at risk due to a disagreement over strategic direction. Address the tension directly.",
    "Your team's results have fallen short of targets for two consecutive quarters. Explain the situation to stakeholders.",
    "You need to communicate an unpopular but necessary policy change to your staff. Frame the explanation constructively.",
    "A colleague has raised an ethical concern about a current project. Respond to their concern thoughtfully.",
    "Your proposal was criticized for being too ambitious. Defend its merits while addressing the concerns raised.",
    "You need to deliver difficult news about layoffs to your team. Explain the situation with care.",
    "A major investor is questioning the company's long-term strategy. Respond with a clear, confident explanation.",
    "Your department is being asked to absorb additional responsibilities without additional resources. Raise this concern appropriately.",
    "A key supplier relationship is deteriorating due to repeated quality issues. Address the problem directly.",
    "You need to explain a reversal of an earlier public commitment. Frame the explanation credibly.",
  ],
  C2: [
    "You must explain to the board why a previously celebrated initiative is now being quietly discontinued, without undermining confidence in the broader strategy.",
    "A regulator has signaled informally that a formal inquiry is likely. Address this with legal counsel while preserving the organization's public position.",
    "You need to respond to a leaked internal memo that has drawn public criticism, without confirming or denying its authenticity prematurely.",
    "A founding partner wants to reverse a long-standing governance principle. Challenge this respectfully while defending the institution's original rationale.",
    "You must explain to shareholders why a competitor's failure does not indicate systemic risk to your own organization.",
    "A respected colleague's conduct has come under scrutiny, and you must address it without appearing to prejudge an ongoing review.",
    "You need to explain why an earlier public reassurance no longer holds, without appearing to have been dishonest at the time.",
    "A key ally within the organization has quietly withdrawn their support for your proposal. Address this shift tactfully in a group setting.",
    "You must justify a significant strategic reversal to a board that approved the original direction unanimously.",
    "A whistleblower's claims, though unverified, have gained public traction. Respond in a way that neither dismisses nor confirms them.",
    "You need to explain to a major client why a long-standing commitment is being renegotiated, without conceding fault.",
    "A internal audit has quietly flagged concerns that have not yet become public. Brief leadership on the risk without overstating it.",
    "You must address growing dissent within your own team about a direction you still privately support.",
    "A former employee has made public allegations that are only partially accurate. Respond without escalating the dispute.",
    "You need to explain to an industry body why your organization is withdrawing from a widely supported initiative.",
  ],
};

// ---------------------------------------------------------------------------
// Q&A-style tracks: conversations(listening), passage_comprehension(listening),
// short_answer(speaking), reading_selective(reading + listening)
// Each tuple: [promptText, question, answers]
// ---------------------------------------------------------------------------
const SHORT_ANSWER_BANK: Record<Level, [string, string[]][]> = {
  A1: [
    ["Mia has a yellow ball. Is Mia's ball yellow or green?", ["yellow"]],
    ["Leo is seven years old. How old is Leo?", ["seven", "7"]],
    ["The dog is sleeping. Is the dog running or sleeping?", ["sleeping"]],
    ["Ana has one brother. Does Ana have a brother or a sister?", ["a brother", "brother"]],
    ["It is cold outside. Is it hot or cold outside?", ["cold"]],
    ["Sam is reading a book. What is Sam doing?", ["reading a book", "reading"]],
    ["The box is empty. Is the box full or empty?", ["empty"]],
    ["Lily has two cats. How many cats does Lily have?", ["two", "2"]],
    ["Tom is wearing shoes. Is Tom wearing shoes or socks only?", ["shoes"]],
    ["The bus is late. Is the bus early or late?", ["late"]],
    ["Ruby likes apples. Does Ruby like apples or oranges?", ["apples"]],
    ["It is morning now. Is it morning or night?", ["morning"]],
    ["Max has a blue bike. What color is Max's bike?", ["blue"]],
    ["The cake is sweet. Is the cake sweet or sour?", ["sweet"]],
    ["Nina is tall. Is Nina tall or short?", ["tall"]],
  ],
  A2: [
    ["Jake missed his flight this morning. Did Jake catch his flight or miss it?", ["he missed it", "missed it"]],
    ["The cafe closes at five on weekends. What time does the cafe close on weekends?", ["at five", "five o'clock", "5"]],
    ["Clara forgot her wallet at the hotel. What did Clara forget?", ["her wallet", "wallet"]],
    ["The workshop starts at ten tomorrow. When does the workshop start?", ["at ten tomorrow", "ten tomorrow", "10am tomorrow"]],
    ["Diego bought a new jacket yesterday. What did Diego buy?", ["a new jacket", "a jacket"]],
    ["Hana's train was delayed by twenty minutes. By how long was the train delayed?", ["twenty minutes", "20 minutes"]],
    ["Felix lost his keys at the gym. Where did Felix lose his keys?", ["at the gym", "the gym"]],
    ["Grace adopted a dog last week. What did Grace adopt?", ["a dog"]],
    ["The store had a sale on Saturday. When did the store have a sale?", ["on Saturday", "Saturday"]],
    ["Ivan's phone battery died at noon. What time did Ivan's phone die?", ["at noon", "noon", "12pm"]],
    ["Jana planted tomatoes in her garden. What did Jana plant?", ["tomatoes"]],
    ["Kofi's bus arrives every fifteen minutes. How often does Kofi's bus arrive?", ["every fifteen minutes", "every 15 minutes"]],
    ["Lara returned the book two days late. How late was the book?", ["two days", "2 days"]],
    ["Milo's cat hid under the bed. Where did Milo's cat hide?", ["under the bed"]],
    ["Nora's class was moved to Thursday. Which day was the class moved to?", ["Thursday"]],
  ],
  B1: [
    ["The team finished the report two days early. How early did the team finish the report?", ["two days", "2 days"]],
    ["The client asked for a partial refund, not a full one. What did the client ask for?", ["a partial refund", "partial refund"]],
    ["The company hired four new interns this summer. How many interns did they hire?", ["four", "4"]],
    ["The flight was rebooked for the next morning. When was the flight rebooked for?", ["the next morning", "next morning"]],
    ["The manager approved the budget but cut the travel allowance. What did the manager cut?", ["the travel allowance", "travel allowance"]],
    ["The warehouse flooded after a pipe burst overnight. What caused the flooding?", ["a burst pipe", "a pipe burst"]],
    ["The meeting was moved from Monday to Wednesday. Which day is the meeting now?", ["Wednesday"]],
    ["The supplier missed the deadline by three days. By how many days did they miss it?", ["three days", "3 days"]],
    ["The clinic extended its hours only on weekdays, not weekends. When were the hours extended?", ["on weekdays", "weekdays"]],
    ["The committee postponed the vote until next quarter. When was the vote postponed to?", ["next quarter"]],
    ["The driver took a different route because of traffic. Why did the driver change routes?", ["because of traffic", "traffic"]],
    ["The hotel upgraded the room at no extra cost. Did the upgrade cost extra or not?", ["no", "it didn't cost extra"]],
    ["The school added an extra class on Fridays. Which day was the extra class added?", ["Friday", "Fridays"]],
    ["The vendor increased prices by six percent. By how much did prices increase?", ["six percent", "6%"]],
    ["The library replaced its old computers last month. What did the library replace?", ["its old computers", "old computers"]],
  ],
  B2: [
    ["The firm decided to outsource its support desk rather than expand it in-house. Did the firm expand in-house or outsource?", ["outsource it", "outsourced it"]],
    ["Sales fell by eleven percent after the price increase. By how much did sales fall?", ["eleven percent", "11%"]],
    ["The board rejected the first proposal but approved a revised version. Was the original proposal approved or rejected?", ["rejected", "it was rejected"]],
    ["The audit found the discrepancies were due to a software error, not fraud. What caused the discrepancies?", ["a software error", "software error"]],
    ["The startup secured funding after its third pitch, not its first. On which pitch did it secure funding?", ["the third", "third pitch"]],
    ["The factory resumed production a week after the inspection concluded. When did production resume?", ["a week after the inspection", "one week later"]],
    ["The client ultimately accepted the revised contract terms. Did the client reject or accept the new terms?", ["accepted them", "accepted"]],
    ["The merger talks stalled over valuation, not over leadership. What caused the talks to stall?", ["valuation"]],
    ["The regulator's inquiry focused on disclosure practices, not accounting fraud. What was the inquiry about?", ["disclosure practices"]],
    ["The vendor's delivery delay cost the project roughly two weeks. How much time did the delay cost?", ["about two weeks", "two weeks"]],
    ["The company's layoffs affected the marketing department most heavily. Which department was hit hardest?", ["marketing"]],
    ["The CEO admitted the rollout had been rushed, not poorly designed. What did the CEO admit?", ["it was rushed"]],
    ["The board's decision to expand was delayed, not cancelled. Was the expansion delayed or cancelled?", ["delayed"]],
    ["The review found the backlash was larger than expected, not smaller. Was the backlash bigger or smaller than expected?", ["bigger", "larger"]],
    ["The negotiation ended with a modest discount, not a full waiver. What did the client receive?", ["a modest discount", "a small discount"]],
  ],
  C1: [
    ["The audit traced the discrepancies to three separate accounts, not a single one. How many accounts were involved?", ["three", "3"]],
    ["Despite internal objections, the restructuring was ultimately approved. Was the restructuring approved or blocked?", ["approved"]],
    ["The committee deferred its decision rather than rejecting the proposal outright. Did the committee reject the proposal or defer it?", ["deferred it", "postponed it"]],
    ["Analysts blamed the downturn on weak demand, not on mismanagement. What did analysts blame for the downturn?", ["weak demand"]],
    ["The firm's reputation suffered despite a swift and well-handled response. Did the swift response prevent the reputational damage?", ["no", "no, it didn't"]],
    ["The regulator's findings were narrower than the original complaint had alleged. Were the findings broader or narrower than alleged?", ["narrower"]],
    ["The settlement addressed the immediate dispute but not the underlying policy question. What did the settlement leave unresolved?", ["the underlying policy question", "the policy question"]],
    ["The board's silence was later read as tacit disagreement, not indifference. How was the board's silence interpreted?", ["as disagreement", "tacit disagreement"]],
    ["The forecast missed by nearly twenty percent, not the five originally expected. By how much did the forecast actually miss?", ["nearly twenty percent", "about 20%"]],
    ["The merger was delayed by the audit, not blocked by regulators. What caused the delay?", ["the audit"]],
    ["The firm's recovery was attributed mainly to asset sales, not operational gains. What mainly drove the recovery?", ["asset sales"]],
    ["The dissent was outvoted but still formally recorded. Was the dissenting view recorded or dismissed entirely?", ["recorded", "it was recorded"]],
    ["The inquiry's scope expanded after new evidence emerged midway through. Did the inquiry's scope grow or shrink?", ["it grew", "expanded"]],
    ["The vendor's new terms were rejected twice before being accepted. How many times were the terms rejected?", ["twice", "2"]],
    ["The policy change was framed as voluntary, though compliance was effectively mandatory. Was compliance actually optional?", ["no", "no, it was mandatory"]],
  ],
  C2: [
    ["The ruling, though narrow, is expected to influence cases well beyond its original scope. Is its influence expected to stay narrow or spread further?", ["spread further", "it will spread further"]],
    ["The dissent raised questions the majority opinion never directly addressed. Did the majority address those questions?", ["no", "no, they didn't"]],
    ["The institution's caution was, on closer inspection, deliberate rather than accidental. Was the caution accidental or deliberate?", ["deliberate"]],
    ["The reform was praised for its ambition but criticized for its vagueness. What aspect drew the most criticism?", ["its vagueness", "vagueness"]],
    ["The committee's prolonged silence fueled speculation rather than settling it. Did the silence settle the speculation or fuel it?", ["fueled it", "it fueled speculation"]],
    ["The firm's stability rested on assumptions that went untested for years. Were those assumptions ever tested earlier?", ["no", "no, they weren't"]],
    ["The scandal was unusual chiefly for the candor of the eventual admission, not its severity. What made the scandal unusual?", ["the candor of the admission"]],
    ["The policy's neutral appearance concealed a selective pattern of enforcement. Was the enforcement actually even-handed?", ["no", "no, it was selective"]],
    ["The board acknowledged the forecast's flaws only once external pressure made silence untenable. What finally forced the acknowledgment?", ["external pressure"]],
    ["The report's restrained tone was ultimately what gave its findings credibility. Did a dramatic tone or a restrained one lend credibility?", ["a restrained tone", "restraint"]],
    ["The original ambiguity in the clause was left unresolved deliberately, not by oversight. Was the ambiguity accidental?", ["no", "no, it was deliberate"]],
    ["The institution's reputation proved resilient, which some attributed to genuine trust and others to public fatigue. Name one proposed explanation.", ["genuine trust", "public fatigue"]],
    ["The inquiry concluded the lapse stemmed from complacency rather than negligence. What did the inquiry conclude caused the lapse?", ["complacency"]],
    ["The verdict's practical reach is expected to outlast the dispute that produced it. Will its effects end when the dispute does?", ["no", "no, they will outlast it"]],
    ["The firm's recovery was real but narrower in scope than its own announcements suggested. Was the recovery as broad as announced?", ["no", "no, it was narrower"]],
  ],
};

const CONVERSATION_BANK: Record<Level, [string, string, string[]][]> = {
  A1: [
    ["A: Do you like milk? B: Yes, I do.", "Does B like milk?", ["yes"]],
    ["A: Is it cold today? B: No, it's warm.", "Is it cold or warm today?", ["warm"]],
    ["A: Where is the ball? B: It's under the table.", "Where is the ball?", ["under the table"]],
    ["A: Can you swim? B: Yes, I can.", "Can B swim?", ["yes"]],
    ["A: Is this your bag? B: Yes, it is.", "Whose bag is it?", ["B's", "it's B's"]],
    ["A: Do you have a pet? B: Yes, a cat.", "What pet does B have?", ["a cat", "cat"]],
    ["A: Is the shop open? B: No, it's closed.", "Is the shop open or closed?", ["closed"]],
    ["A: How old are you? B: I am nine.", "How old is B?", ["nine", "9"]],
    ["A: Do you like apples? B: Yes, very much.", "Does B like apples?", ["yes"]],
    ["A: Is your brother tall? B: Yes, very tall.", "Is B's brother tall or short?", ["tall"]],
    ["A: Can I help you? B: Yes, please.", "Does B want help?", ["yes"]],
    ["A: Is it your birthday? B: Yes, today!", "Whose birthday is it?", ["B's"]],
    ["A: Do you like tea or coffee? B: Tea, please.", "What does B prefer?", ["tea"]],
    ["A: Is the dog big? B: No, it's small.", "Is the dog big or small?", ["small"]],
    ["A: Are you hungry? B: Yes, a little.", "Is B hungry?", ["yes"]],
  ],
  A2: [
    ["A: I missed the bus. B: That's too bad, what happened?", "What did A miss?", ["the bus", "bus"]],
    ["A: Would you like tea or coffee? B: Coffee, please.", "What does B want?", ["coffee"]],
    ["A: Can you help me move this table? B: Sure, no problem.", "Does B agree to help?", ["yes"]],
    ["A: How was your weekend? B: It was great, thanks.", "How was B's weekend?", ["great"]],
    ["A: Do you know what time the train leaves? B: At noon, I think.", "What time does the train leave?", ["at noon", "noon"]],
    ["A: I forgot my umbrella. B: It's okay, you can borrow mine.", "What does B offer?", ["an umbrella", "to lend an umbrella"]],
    ["A: Is the shop still open? B: Yes, until nine.", "Until what time is the shop open?", ["until nine", "nine"]],
    ["A: Did you finish the homework? B: Not yet, almost done.", "Has B finished the homework?", ["no", "not yet"]],
    ["A: Can we meet tomorrow? B: Sure, what time works?", "Does B agree to meet?", ["yes"]],
    ["A: I lost my keys. B: Did you check your bag?", "What does B suggest?", ["checking the bag", "check the bag"]],
    ["A: Is this seat taken? B: No, go ahead.", "Is the seat free or taken?", ["free"]],
    ["A: Do you want to join us for lunch? B: Sure, what time?", "Does B want to join?", ["yes"]],
    ["A: My umbrella broke in the wind. B: You can share mine.", "What does B offer?", ["an umbrella", "to share an umbrella"]],
    ["A: Did you enjoy the movie? B: Yes, it was really good.", "Did B like the movie?", ["yes"]],
    ["A: Can I borrow your pen? B: Of course, here you go.", "Does B lend the pen?", ["yes"]],
  ],
  B1: [
    ["A: The customer called about a refund. B: I'll sort it out this afternoon.", "When will B sort out the refund?", ["this afternoon"]],
    ["A: I have a cold. B: Did you see a doctor? A: Not yet, tomorrow.", "When will A see a doctor?", ["tomorrow"]],
    ["A: Did you buy travel insurance? B: Not yet. A: You really should.", "What does A recommend?", ["buying travel insurance"]],
    ["A: My neighbor's dog keeps barking. B: Did you speak to them? A: Yes, they apologized.", "What did the neighbor do?", ["apologized"]],
    ["A: My card got declined. B: Did you check the balance? A: Yes, it was a glitch.", "What caused the issue?", ["a glitch"]],
    ["A: My suitcase didn't arrive. B: Did you report it? A: Yes, at the counter.", "Where did A report it?", ["at the counter"]],
    ["A: Rent went up this year. B: By how much? A: About six percent.", "By how much did rent rise?", ["six percent", "6%"]],
    ["A: We got the contract! B: That's great news! A: Yes, I'm thrilled.", "How does A feel?", ["thrilled", "happy"]],
    ["A: I missed my connecting flight. B: Did they rebook you? A: Yes, for tomorrow.", "When is A's new flight?", ["tomorrow"]],
    ["A: The printer's out of toner. B: I just ordered more. A: Good timing.", "What did B do?", ["ordered more toner", "ordered toner"]],
    ["A: Did the training go well? B: Yes, better than expected.", "How did the training go?", ["well", "better than expected"]],
    ["A: The venue changed last minute. B: Did you notify the guests? A: Yes, this morning.", "When did A notify the guests?", ["this morning"]],
    ["A: Our flight got delayed. B: By how long? A: About two hours.", "By how much was the flight delayed?", ["two hours"]],
    ["A: I need to reschedule. B: What day works for you? A: Thursday, if possible.", "Which day does A prefer?", ["Thursday"]],
    ["A: Did the shipment arrive? B: Yes, this morning. A: Finally!", "When did the shipment arrive?", ["this morning"]],
  ],
  B2: [
    ["A: Revenue slipped this quarter. B: By how much? A: About nine percent.", "By how much did revenue slip?", ["nine percent", "9%"]],
    ["A: The board approved the budget. B: With changes? A: Just a cut to travel.", "What was cut from the budget?", ["travel expenses", "travel"]],
    ["A: The vendor missed the date again. B: Switch suppliers? A: Let's give one more chance.", "What does A want to do?", ["give the vendor another chance"]],
    ["A: The client pushed back on price. B: Did we lose the deal? A: No, we discounted slightly.", "How was it resolved?", ["with a small discount"]],
    ["A: The audit found discrepancies. B: Anything serious? A: No, minor paperwork errors.", "What kind of discrepancies were found?", ["minor paperwork errors"]],
    ["A: The server crashed during the demo. B: Is it fixed? A: Yes, just now.", "Is the server fixed?", ["yes"]],
    ["A: We lost our biggest client. B: What happened? A: They switched to a cheaper provider.", "Why did the client leave?", ["a cheaper provider", "cost"]],
    ["A: The merger stalled again. B: Over what? A: Valuation, same as before.", "What is the sticking point?", ["valuation"]],
    ["A: The forecast missed badly. B: By how much? A: Nearly twenty percent.", "By roughly how much did it miss?", ["nearly twenty percent", "about 20%"]],
    ["A: The new hires start Monday. B: All five of them? A: Yes, all five.", "How many new hires start Monday?", ["five", "5"]],
    ["A: The launch slipped again. B: Why this time? A: A late vendor integration.", "What caused the latest delay?", ["a late vendor integration"]],
    ["A: Costs are up sharply. B: Any specific cause? A: Mostly shipping fees.", "What mainly drove the cost increase?", ["shipping fees"]],
    ["A: The review flagged an issue. B: Serious? A: No, just a labeling error.", "What kind of issue was flagged?", ["a labeling error"]],
    ["A: We beat the forecast. B: By how much? A: About eight percent.", "By how much did they beat the forecast?", ["eight percent", "8%"]],
    ["A: The rollout was rocky. B: Any lasting damage? A: Mostly reputational, not financial.", "What kind of damage resulted?", ["reputational damage"]],
  ],
  C1: [
    ["A: The merger talks stalled again. B: Over what this time? A: Valuation, as before.", "What is the sticking point?", ["valuation"]],
    ["A: The regulator opened an inquiry. B: Into what? A: Our disclosure practices.", "What is the inquiry about?", ["disclosure practices"]],
    ["A: The forecast missed badly. B: By how much? A: Nearly twenty percent.", "By how much did the forecast miss?", ["nearly twenty percent", "about 20%"]],
    ["A: The committee stayed quiet on it. B: Does that mean they agree? A: No, it's tacit disagreement.", "How is the committee's silence interpreted?", ["as disagreement"]],
    ["A: The settlement was reached. B: Does it resolve everything? A: No, the policy question remains.", "What remains unresolved?", ["the policy question"]],
    ["A: The audit expanded in scope. B: Why? A: New evidence surfaced midway.", "Why did the scope expand?", ["new evidence surfaced"]],
    ["A: The dissent was outvoted. B: Was it recorded anyway? A: Yes, formally.", "Was the dissent recorded?", ["yes"]],
    ["A: The vendor's terms were rejected again. B: How many times now? A: Twice.", "How many times were the terms rejected?", ["twice", "2"]],
    ["A: The policy change is framed as voluntary. B: Is it really? A: Not in practice.", "Is compliance actually optional?", ["no"]],
    ["A: The firm's recovery looks strong. B: Is it sustainable? A: Mostly from asset sales, so unclear.", "What mainly drove the recovery?", ["asset sales"]],
    ["A: The board stayed silent on it. B: Does that mean agreement? A: No, it was tacit disagreement.", "How was the silence interpreted?", ["as disagreement"]],
    ["A: The inquiry's findings were narrow. B: Narrower than alleged? A: Yes, considerably.", "Were the findings broader or narrower than alleged?", ["narrower"]],
    ["A: The reputational damage was swift. B: Did the quick response help? A: Not really, no.", "Did the swift response prevent the damage?", ["no"]],
    ["A: The restructuring faced objections. B: Was it approved anyway? A: Yes, ultimately.", "Was the restructuring approved?", ["yes"]],
    ["A: Analysts blamed the downturn on demand. B: Not mismanagement? A: No, they were clear about that.", "What did analysts blame for the downturn?", ["weak demand"]],
  ],
  C2: [
    ["A: The ruling is narrow in scope. B: Will its influence stay narrow? A: No, it'll likely spread further.", "Is the ruling's influence expected to stay narrow?", ["no"]],
    ["A: The dissent raised hard questions. B: Did the majority answer them? A: No, never directly.", "Did the majority address those questions?", ["no"]],
    ["A: The institution seems overly cautious. B: Is that accidental? A: No, quite deliberate.", "Is the caution accidental or deliberate?", ["deliberate"]],
    ["A: The reform drew mixed reviews. B: What was criticized most? A: Its vagueness, mainly.", "What drew the most criticism?", ["its vagueness"]],
    ["A: The committee stayed quiet for weeks. B: Did that calm things down? A: No, it fueled more speculation.", "Did the silence settle or fuel speculation?", ["it fueled speculation"]],
    ["A: The firm's stability looked solid. B: Was it ever tested? A: Not really, until now.", "Had the firm's assumptions been tested before?", ["no"]],
    ["A: The scandal surprised people. B: Was it the severity? A: No, the honesty of the admission.", "What made the scandal unusual?", ["the candor of the admission"]],
    ["A: The policy looks neutral on paper. B: Is enforcement even-handed? A: No, it's quite selective.", "Is the enforcement actually even-handed?", ["no"]],
    ["A: The board finally admitted the error. B: What forced that? A: Outside pressure, mostly.", "What finally forced the acknowledgment?", ["external pressure"]],
    ["A: The report's tone was very restrained. B: Did that hurt its impact? A: No, it's what gave it credibility.", "Did the restrained tone help or hurt credibility?", ["it helped"]],
    ["A: That clause was always vague. B: Was that an oversight? A: No, deliberately left that way.", "Was the ambiguity accidental?", ["no"]],
    ["A: The institution's reputation held up. B: Because of real trust? A: Partly, and partly fatigue.", "Name one proposed explanation for the resilience.", ["trust", "fatigue"]],
    ["A: The inquiry blamed complacency. B: Not negligence? A: No, they were careful to distinguish that.", "What did the inquiry conclude caused the lapse?", ["complacency"]],
    ["A: The verdict's reach seems long-lasting. B: Beyond this one case? A: Yes, considerably so.", "Will the verdict's effects end when the dispute does?", ["no"]],
    ["A: The recovery sounds impressive. B: As broad as announced? A: No, narrower in practice.", "Was the recovery as broad as announced?", ["no"]],
  ],
};

const PASSAGE_COMPREHENSION_BANK: Record<Level, [string, string, string[]][]> = {
  A1: [
    ["Ben's dog ran into the garden and found a ball. He brought it back to Ben.", "What did the dog find?", ["a ball"]],
    ["Mia's cake fell on the floor, so her mother made a new one.", "What did Mia's mother do?", ["made a new cake", "made another cake"]],
    ["It started to rain, so Leo took his umbrella to school.", "What did Leo take?", ["an umbrella"]],
    ["Ana's cat climbed the tree and could not get down. Her father helped it.", "Who helped the cat?", ["her father"]],
    ["Sam lost his pencil, so his friend gave him a new one.", "What did Sam's friend give him?", ["a pencil"]],
    ["The sun was very hot, so the children played inside instead.", "Where did the children play?", ["inside"]],
    ["Lily's balloon flew away, so her brother bought her a new one.", "Who bought Lily a new balloon?", ["her brother"]],
    ["Tom forgot his lunch, so his mother brought it to school.", "Who brought Tom's lunch?", ["his mother"]],
    ["The puppy was hungry, so Zoe gave it some food.", "What did Zoe give the puppy?", ["food"]],
    ["Max's bike had a flat tire, so his father fixed it.", "Who fixed the bike?", ["his father"]],
    ["Ruby's book was torn, so the teacher taped it back together.", "Who fixed Ruby's book?", ["the teacher"]],
    ["It was dark, so Omar turned on the light.", "What did Omar turn on?", ["the light"]],
    ["Nina's shoes were wet, so she changed into dry ones.", "What did Nina change into?", ["dry shoes"]],
    ["Eli was thirsty, so he drank a glass of water.", "What did Eli drink?", ["water"]],
    ["The window was open, so the cold wind came in.", "What came in through the window?", ["cold wind", "wind"]],
  ],
  A2: [
    ["Clara's shift ended late, so she missed her usual bus home.", "Why did Clara miss her bus?", ["her shift ended late"]],
    ["Diego's team won the match, so they celebrated at a cafe afterward.", "What did Diego's team do after winning?", ["celebrated at a cafe"]],
    ["Hana's flight was delayed, so she waited two extra hours at the airport.", "How long did Hana wait?", ["two extra hours", "two hours"]],
    ["Felix burned the first batch of bread, so he started over.", "What did Felix do after burning the bread?", ["started over", "made it again"]],
    ["Grace's shift at the shelter was extended, so she stayed an extra hour.", "How much longer did Grace stay?", ["an extra hour", "one hour"]],
    ["Ivan practiced the song all week, so he played it well at the show.", "How did Ivan play at the show?", ["well"]],
    ["Jana's bike had a flat tire, so she walked the rest of the way.", "How did Jana get the rest of the way?", ["she walked"]],
    ["Kofi's peppers didn't grow well, so he changed the soil.", "What did Kofi change?", ["the soil"]],
    ["Lara's camera broke, so she borrowed one from a friend.", "What did Lara borrow?", ["a camera"]],
    ["Milo's cat was scared of the vacuum, so he kept it in another room.", "Where did Milo keep the cat?", ["in another room"]],
    ["Nora overslept, so she skipped her morning run.", "What did Nora skip?", ["her morning run", "the run"]],
    ["Theo ran out of spare parts, so he ordered more online.", "What did Theo do?", ["ordered more parts online"]],
    ["Wren's book club chose a long novel, so they took two months to finish it.", "How long did it take to finish the novel?", ["two months"]],
    ["Yara's first loaves were too dense, so she added more yeast next time.", "What did Yara add next time?", ["more yeast"]],
    ["Zack's neighborhood started sorting plastics separately, so recycling improved.", "What improved in Zack's neighborhood?", ["recycling"]],
  ],
  B1: [
    ["The scheduling system confused staff at first, so the company held a short training session.", "What did the company do?", ["held a training session"]],
    ["The cafe's loyalty program was slow to catch on, but a simple point system eventually boosted visits.", "What boosted repeat visits?", ["the simple point system", "the point system"]],
    ["Some drivers complained about the new bike lanes, but cyclists welcomed them.", "How did cyclists react to the bike lanes?", ["they welcomed them"]],
    ["The publishing house struggled at first, until an unexpected bestseller changed its fortunes.", "What changed the publisher's fortunes?", ["an unexpected bestseller"]],
    ["The mentorship program paired older and younger students, improving the younger students' confidence.", "What improved for the younger students?", ["their confidence"]],
    ["The clean-up event had low turnout at first, but social media promotion tripled attendance.", "What tripled attendance?", ["social media promotion"]],
    ["A few older patients needed help with the clinic's new booking website.", "Who needed help with the website?", ["a few older patients", "older patients"]],
    ["The new airline route exceeded demand expectations, so extra flights were added.", "What did the airline add?", ["extra flights"]],
    ["The library's extended weekend hours grew more popular over the semester.", "What grew more popular?", ["the extended weekend hours"]],
    ["The restaurant's cooking classes became unexpectedly popular and now need advance booking.", "What do the classes now require?", ["advance booking"]],
    ["The factory's new supplier improved output after a short adjustment period.", "What improved after the adjustment?", ["output"]],
    ["The repair workshop quickly filled up as residents brought in broken appliances.", "What did residents bring in?", ["broken appliances"]],
    ["The hotel's new co-working space increased weekday bookings from business travelers.", "What increased?", ["weekday bookings"]],
    ["The farmer's online ordering system led to steadily growing sales.", "What grew steadily?", ["sales"]],
    ["The gym's early classes grew in attendance once regulars spread the word.", "How did attendance grow?", ["word spread among regulars"]],
  ],
  B2: [
    ["Outsourcing customer support cut costs sharply, though satisfaction scores barely moved.", "What barely changed after outsourcing?", ["satisfaction scores"]],
    ["The retailer's new tiered rewards program raised engagement despite early skepticism.", "What rose despite the skepticism?", ["engagement"]],
    ["Drivers resisted the route-optimization software, but delivery times still improved.", "What improved despite driver resistance?", ["delivery times"]],
    ["Faculty worried online courses would reduce engagement, but enrollment rose instead.", "What happened to enrollment?", ["it rose", "it increased"]],
    ["Stricter loan criteria caused a sharp drop in loan volume at the bank.", "What dropped sharply?", ["loan volume"]],
    ["The four-day work week held productivity steady, so it became permanent.", "What happened to the policy?", ["it became permanent"]],
    ["The simplified pricing confused long-time customers until a revised rollout fixed it.", "What fixed the confusion?", ["the revised rollout"]],
    ["Stricter recycling rules were unpopular but cut contamination rates within a year.", "What dropped within a year?", ["contamination rates"]],
    ["Unbundling baggage fees drew criticism, yet overall bookings rose due to lower base fares.", "What rose due to lower fares?", ["overall bookings"]],
    ["Staff found the new electronic records system slow at first, but error rates fell after training.", "What fell after training?", ["error rates"]],
    ["Smaller, continuous fashion releases puzzled analysts but reduced markdowns.", "What did the new approach reduce?", ["markdowns"]],
    ["The telecom app's rollout was delayed twice, frustrating users expecting faster support.", "How many times was the rollout delayed?", ["twice", "2"]],
    ["Capping engagements at three months reduced staff turnover at the consulting firm.", "What did the policy reduce?", ["staff turnover"]],
    ["The brewery's expansion was slower than planned due to distribution costs.", "What slowed the expansion?", ["distribution costs"]],
    ["Switching to unrestricted donations gave the nonprofit more flexibility during a shortfall.", "What did the switch give the nonprofit?", ["more flexibility"]],
  ],
  C1: [
    ["The firm's recovery was later found to owe more to asset sales than operational gains.", "What mainly drove the recovery?", ["asset sales"]],
    ["The regulator's narrow inquiry still exposed disclosure failures beyond the single case reviewed.", "What did the inquiry expose beyond the single case?", ["disclosure failures"]],
    ["Internal documents revealed the board's caution stemmed from unresolved internal disagreements.", "What caused the board's caution?", ["unresolved internal disagreements"]],
    ["Auditors found discrepancies predating current management, complicating accountability.", "What complicated assigning accountability?", ["discrepancies predating current management"]],
    ["Integration costs for the merger eventually exceeded the original estimate significantly.", "What exceeded the original estimate?", ["integration costs"]],
    ["The ministry never directly rebutted claims that the reform addressed only symptoms.", "Did the ministry rebut the criticism?", ["no"]],
    ["Several shareholders later called the board's expansion decision reckless in hindsight.", "How did shareholders later describe the decision?", ["reckless"]],
    ["Analysts had dismissed the company's demand warnings until the next quarter proved them right.", "What proved the warnings right?", ["the next quarter's results"]],
    ["The settlement resolved the dispute but left the broader regulatory question unanswered.", "What remained unanswered?", ["the broader regulatory question"]],
    ["The firm's due-diligence weaknesses only surfaced once it expanded into unfamiliar markets.", "When did the weaknesses surface?", ["once it expanded into unfamiliar markets"]],
    ["Senior staff quietly objected to the new reporting structure before its rollout.", "Who objected before the rollout?", ["senior staff"]],
    ["The inquiry's conclusions implicitly criticized an earlier, less thorough review.", "What did the inquiry's conclusions imply?", ["the earlier review wasn't thorough enough"]],
    ["A single product recall was enough to damage the firm's decades-long reputation.", "What damaged the firm's reputation?", ["a single product recall"]],
    ["Shareholder impatience eventually forced a leadership change, though strategy barely shifted.", "What forced the leadership change?", ["shareholder impatience"]],
    ["Some read the regulator's inaction as an implicit admission the case had been weak.", "What did some infer from the regulator's inaction?", ["the case had been weak"]],
  ],
  C2: [
    ["The institution's caution, mistaken for indecision, was in fact a deliberate strategy.", "Was the caution accidental or deliberate?", ["deliberate"]],
    ["The inquiry revealed not negligence but a culture of quiet, gradual complacency.", "What did the inquiry reveal?", ["a culture of complacency"]],
    ["The ruling's narrow scope belied implications likely to outlast the original dispute.", "What is expected to outlast the dispute?", ["the ruling's implications"]],
    ["The settlement deferred the underlying tension rather than resolving it.", "Did the settlement resolve or defer the tension?", ["it deferred it"]],
    ["The committee's silence was a calculated refusal to legitimize the controversy further.", "Why was the committee silent?", ["to avoid legitimizing the controversy"]],
    ["The reform's supposed dysfunction turned out to be more symbolic than structural.", "Was the dysfunction mainly structural?", ["no", "it was symbolic"]],
    ["The firm's reassuring stability rested on liquidity assumptions few had questioned.", "What had gone unquestioned?", ["the liquidity assumptions"]],
    ["This scandal stood out for the candor of its admission, not its severity.", "What made this scandal unusual?", ["the candor of the admission"]],
    ["The dissent raised concerns the majority opinion never satisfactorily addressed.", "Did the majority address the dissent's concerns?", ["no"]],
    ["The policy's selective enforcement only became visible over several years of data.", "When did the selective enforcement become visible?", ["after several years"]],
    ["The institution's resilience was attributed variously to genuine trust and public fatigue.", "Name one explanation offered for the resilience.", ["genuine trust", "public fatigue"]],
    ["The report's understated tone was precisely what gave its conclusions their weight.", "What gave the report's conclusions their weight?", ["its restrained tone"]],
    ["The clause's ambiguity was left unresolved by deliberate choice, not oversight.", "Was the ambiguity an oversight?", ["no"]],
    ["External pressure, not internal review, finally forced the board's admission.", "What forced the board's admission?", ["external pressure"]],
    ["The announced recovery proved narrower in practice than the public statements suggested.", "Was the recovery as broad as announced?", ["no"]],
  ],
};

const READING_SELECTIVE_BANK: Record<Level, [string, string, string[]][]> = {
  A1: [
    ["Open 9am to 6pm every day.", "Is the shop open at 7pm?", ["no"]],
    ["No shoes allowed inside.", "Can you wear shoes inside?", ["no"]],
    ["Free water for customers.", "Do customers pay for water?", ["no"]],
    ["Closed on Mondays.", "Is it open on Mondays?", ["no"]],
    ["Please keep the door shut.", "Should the door stay open or shut?", ["shut", "closed"]],
    ["Quiet please, baby sleeping.", "Should you be loud or quiet?", ["quiet"]],
    ["No photos in the museum.", "Can you take photos here?", ["no"]],
    ["Fresh bread every morning.", "When is the bread fresh?", ["every morning"]],
    ["Pull to open the door.", "Should you push or pull?", ["pull"]],
    ["Wet floor, be careful.", "Is the floor wet or dry?", ["wet"]],
    ["Buy one, get one free.", "How many do you pay for?", ["one"]],
    ["No pets allowed here.", "Can you bring a pet?", ["no"]],
    ["Lift out of order.", "Can you use the lift?", ["no"]],
    ["Ice cream half price today.", "Is ice cream full price today?", ["no"]],
    ["Please wait to be seated.", "Can you sit anywhere you like?", ["no"]],
  ],
  A2: [
    ["Notice: The gym pool is closed for cleaning on Tuesdays.", "When is the pool closed?", ["on Tuesdays", "Tuesdays"]],
    ["Sign: Staff entrance only after 8pm.", "Who can use the entrance after 8pm?", ["staff only", "staff"]],
    ["Memo: The office closes early on the last Friday of the month.", "Which day does the office close early?", ["the last Friday of the month"]],
    ["Label: Store in a cool, dry place.", "Where should this be stored?", ["in a cool, dry place"]],
    ["Notice: Parking is free after 6pm on weekdays.", "When is parking free?", ["after 6pm on weekdays"]],
    ["Sign: Please recycle bottles in the blue bin.", "Where should bottles go?", ["in the blue bin"]],
    ["Memo: The elevator will be serviced this Thursday morning.", "When will the elevator be serviced?", ["Thursday morning"]],
    ["Notice: Returns accepted within fourteen days with a receipt.", "How many days do you have to return an item?", ["fourteen days", "14 days"]],
    ["Label: Contains nuts, may cause allergic reaction.", "What might this product cause?", ["an allergic reaction"]],
    ["Sign: No entry after the show has started.", "Can you enter after the show starts?", ["no"]],
    ["Notice: Free delivery on orders over thirty dollars.", "When is delivery free?", ["on orders over thirty dollars"]],
    ["Memo: Visitors must wear a badge at all times.", "What must visitors wear?", ["a badge"]],
    ["Sign: Please use hand sanitizer before entering.", "What should you use before entering?", ["hand sanitizer"]],
    ["Notice: The cafe is closed for a private event today.", "Why is the cafe closed today?", ["a private event"]],
    ["Label: Best used within three months of opening.", "How long is this good for after opening?", ["three months"]],
  ],
  B1: [
    ["Memo: All visitors must sign in at reception before entering the building.", "What must visitors do before entering?", ["sign in at reception"]],
    ["Announcement: Due to maintenance, the lift will be out of service until Friday.", "Until when will the lift be out of service?", ["until Friday", "Friday"]],
    ["Notice: Staff are reminded to submit expense reports by the end of the month.", "What must staff submit?", ["expense reports"]],
    ["Memo: The printer on the third floor is being replaced next week.", "When is the printer being replaced?", ["next week"]],
    ["Email excerpt: The workshop has been moved from Tuesday to Thursday.", "When is the workshop now?", ["Thursday"]],
    ["Notice: The cafeteria will serve a special menu for the holiday.", "What will the cafeteria serve for the holiday?", ["a special menu"]],
    ["Memo: New hires must complete orientation within their first week.", "When must orientation be completed?", ["within the first week"]],
    ["Announcement: The fire drill is scheduled for Wednesday at 10am.", "When is the fire drill?", ["Wednesday at 10am"]],
    ["Notice: Guests are asked to park in the visitor lot only.", "Where should guests park?", ["the visitor lot"]],
    ["Memo: The quarterly meeting has been moved to the main hall.", "Where is the quarterly meeting now?", ["the main hall"]],
    ["Notice: The gym will be closed for renovations from Monday.", "From when will the gym be closed?", ["Monday"]],
    ["Memo: Please submit vacation requests at least two weeks in advance.", "How far in advance should requests be submitted?", ["two weeks"]],
    ["Announcement: The building's Wi-Fi will be upgraded this weekend.", "What is happening this weekend?", ["a Wi-Fi upgrade"]],
    ["Notice: Lost property can be collected from the front desk.", "Where can lost property be collected?", ["the front desk"]],
    ["Memo: The cafeteria now accepts card payments only.", "What payment method is now accepted?", ["card payments only", "card"]],
  ],
  B2: [
    ["Memo: All expense reports over $300 now require director approval before reimbursement.", "What requires director approval?", ["reports over $300"]],
    ["Press release: The company will cut 5% of its workforce as part of restructuring.", "What is the company doing?", ["cutting 5% of its workforce"]],
    ["Report excerpt: Customer complaints rose sharply after the new system was introduced.", "What rose after the new system?", ["customer complaints"]],
    ["Memo: The marketing budget has been frozen until the next fiscal quarter.", "What has been frozen?", ["the marketing budget"]],
    ["Annual Report Summary: Revenue grew 6% while operating costs grew 11%.", "What grew faster, revenue or costs?", ["costs", "operating costs"]],
    ["Internal notice: Remote work requests must be approved by both managers.", "Who must approve remote work requests?", ["both managers"]],
    ["Memo: The vendor contract will be renegotiated before year-end.", "When will the contract be renegotiated?", ["before year-end"]],
    ["Report excerpt: Employee turnover fell after the new benefits package launched.", "What fell after the new benefits launched?", ["employee turnover"]],
    ["Notice: The merger is expected to close within the next two quarters.", "When is the merger expected to close?", ["within the next two quarters"]],
    ["Memo: Travel expenses must now be submitted within 30 days of the trip.", "Within how many days must travel expenses be submitted?", ["30 days", "thirty days"]],
    ["Press release: The firm will relocate its headquarters next spring.", "When will headquarters relocate?", ["next spring"]],
    ["Memo: The IT department will migrate all data to the new server this weekend.", "What is IT migrating this weekend?", ["all data"]],
    ["Report excerpt: The product recall affected roughly 2% of units sold.", "What percentage of units were affected?", ["roughly 2%", "2%"]],
    ["Notice: Client meetings will move to a hybrid format starting next month.", "What format will meetings use starting next month?", ["hybrid"]],
    ["Memo: The compliance review will take approximately six weeks to complete.", "How long will the compliance review take?", ["approximately six weeks", "six weeks"]],
  ],
  C1: [
    ["Analyst note: The firm's apparent recovery owes more to one-off asset sales than to any underlying improvement.", "What does the recovery mainly owe to?", ["one-off asset sales"]],
    ["Editorial excerpt: Critics contend the reform tackles symptoms while leaving root causes untouched.", "What do critics say about the reform?", ["it tackles symptoms only"]],
    ["Internal memo: The board remains split on whether to proceed before the audit concludes.", "What is the board split on?", ["whether to proceed before the audit concludes"]],
    ["Research summary: The data suggest a correlation, not necessarily a causal link.", "What does the data suggest?", ["a correlation, not a causal link"]],
    ["Statement: The settlement resolves the dispute but leaves the regulatory question unanswered.", "What does the settlement leave unanswered?", ["the regulatory question"]],
    ["Memo: The restructuring proposal faces internal objections despite executive support.", "Does the proposal face internal objections?", ["yes"]],
    ["Analyst note: Discrepancies in the accounts predate the current management team.", "Do the discrepancies predate current management?", ["yes"]],
    ["Internal notice: Senior staff raised concerns about the new structure before rollout.", "When were concerns raised?", ["before the rollout"]],
    ["Statement: The inquiry's scope widened after new evidence emerged.", "Why did the inquiry's scope widen?", ["new evidence emerged"]],
    ["Memo: The vendor's revised terms were accepted only after two rejections.", "How many times were the terms rejected first?", ["two", "twice"]],
    ["Analyst note: The downturn was attributed to external pressures, not mismanagement.", "What was the downturn attributed to?", ["external pressures"]],
    ["Internal memo: The policy change is described as voluntary, though compliance is expected.", "Is compliance actually optional?", ["no"]],
    ["Statement: The board's silence was later interpreted as tacit disagreement.", "How was the board's silence interpreted?", ["as disagreement"]],
    ["Analyst note: The firm's due-diligence gaps surfaced only after overseas expansion.", "When did the gaps surface?", ["after overseas expansion"]],
    ["Memo: The settlement addressed the dispute but not the broader question raised.", "What question remained unaddressed?", ["the broader question"]],
  ],
  C2: [
    ["Commentary: The ruling, though narrow, sets a precedent likely to outlast the case itself.", "What will likely outlast the case?", ["the precedent"]],
    ["Review: The report's restraint is what lends its conclusions their weight.", "What lends the report's conclusions their weight?", ["its restraint"]],
    ["Analysis: The policy's neutrality is more apparent than real.", "Is the policy's neutrality genuine?", ["no"]],
    ["Commentary: The dissent raised questions the majority never addressed.", "Did the majority address the dissent's questions?", ["no"]],
    ["Editorial: The institution's caution has preserved its credibility.", "What has the caution preserved?", ["the institution's credibility"]],
    ["Analysis: The scandal's unusual feature was the candor of the admission.", "What was unusual about the scandal?", ["the candor of the admission"]],
    ["Commentary: The settlement deferred the tension rather than resolving it.", "Did the settlement resolve the tension?", ["no"]],
    ["Review: The firm's stability rested on long-untested assumptions.", "Had the assumptions been tested before?", ["no"]],
    ["Analysis: The enforcement pattern was selective despite the policy's neutral wording.", "Was the enforcement even-handed?", ["no"]],
    ["Commentary: External pressure, not internal review, forced the admission.", "What forced the admission?", ["external pressure"]],
    ["Editorial: The institution's resilience owed as much to fatigue as to trust.", "Name one cause of the institution's resilience.", ["fatigue", "trust"]],
    ["Analysis: The clause's ambiguity was deliberate, not an oversight.", "Was the ambiguity accidental?", ["no"]],
    ["Commentary: The announced recovery proved narrower than publicly claimed.", "Was the recovery as broad as announced?", ["no"]],
    ["Review: The inquiry attributed the lapse to complacency, not negligence.", "What did the inquiry blame for the lapse?", ["complacency"]],
    ["Analysis: The verdict's reach is expected to extend well past this dispute.", "Will the verdict's effects end with this dispute?", ["no"]],
  ],
};

const READING_SELECTIVE_BANK_2: Record<Level, [string, string, string[]][]> = {
  A1: [
    ["Elevator out of service.", "Can you use the elevator?", ["no"]],
    ["Children must be with an adult.", "Can a child be alone here?", ["no"]],
    ["Fresh fruit delivered daily.", "How often is fruit delivered?", ["daily", "every day"]],
    ["No running by the pool.", "Can you run by the pool?", ["no"]],
    ["Half price after 8pm.", "Is it full price after 8pm?", ["no"]],
    ["Please take a ticket and wait.", "What should you take first?", ["a ticket"]],
    ["This seat is reserved.", "Can anyone sit in this seat?", ["no"]],
    ["Cold drinks in the fridge.", "Where are the cold drinks?", ["in the fridge"]],
    ["No bikes past this point.", "Can you ride a bike past this point?", ["no"]],
    ["Open every day except Sunday.", "Is it open on Sunday?", ["no"]],
    ["Please switch off your phone.", "Should your phone be on or off?", ["off"]],
    ["New toys arriving next week.", "When do the new toys arrive?", ["next week"]],
    ["Push to open the gate.", "Should you push or pull the gate?", ["push"]],
    ["Keep off the grass.", "Can you walk on the grass?", ["no"]],
    ["Help yourself to coffee.", "Do you need to ask for coffee?", ["no"]],
  ],
  A2: [
    ["Notice: The library closes an hour early on public holidays.", "When does the library close early?", ["on public holidays"]],
    ["Sign: Please use the ramp for strollers and wheelchairs.", "Who should use the ramp?", ["strollers and wheelchairs"]],
    ["Memo: The cafe adds a new seasonal drink every month.", "How often does the cafe add a new drink?", ["every month"]],
    ["Label: Shake well before use.", "What should you do before using this?", ["shake it well"]],
    ["Notice: Lost items are kept for thirty days only.", "How long are lost items kept?", ["thirty days", "30 days"]],
    ["Sign: Please don't feed the ducks.", "Can you feed the ducks?", ["no"]],
    ["Memo: The office supplies cupboard is restocked every Friday.", "When is the cupboard restocked?", ["every Friday", "Friday"]],
    ["Notice: Group bookings need at least two days' notice.", "How much notice do group bookings need?", ["two days"]],
    ["Label: Keep away from direct sunlight.", "Where should this be kept away from?", ["direct sunlight"]],
    ["Sign: Please form a single line here.", "How should people line up?", ["in a single line"]],
    ["Notice: The pharmacy is open until midnight on weekends.", "Until when is the pharmacy open on weekends?", ["until midnight", "midnight"]],
    ["Memo: New employees receive a welcome pack on day one.", "When do new employees get a welcome pack?", ["on day one", "day one"]],
    ["Notice: The playground is for children under twelve.", "Who is the playground for?", ["children under twelve"]],
    ["Sign: Please remove your shoes before entering.", "What should you remove before entering?", ["your shoes"]],
    ["Label: Suitable for ages three and up.", "What is the minimum age for this?", ["three"]],
  ],
  B1: [
    ["Notice: Staff must badge in and out for every shift.", "What must staff do for every shift?", ["badge in and out"]],
    ["Memo: The new policy applies only to full-time employees.", "Who does the new policy apply to?", ["full-time employees"]],
    ["Announcement: Visitors are not permitted beyond the lobby without an escort.", "What do visitors need to go beyond the lobby?", ["an escort"]],
    ["Notice: The parking garage will raise its rates starting next month.", "When will parking rates rise?", ["next month"]],
    ["Memo: All laptops must be returned to IT before the last day.", "What must be returned before the last day?", ["laptops"]],
    ["Announcement: The cafeteria menu rotates every two weeks.", "How often does the cafeteria menu change?", ["every two weeks"]],
    ["Notice: Unattended bags will be removed by security.", "What will security do with unattended bags?", ["remove them"]],
    ["Memo: Overtime must be approved by a supervisor in advance.", "Who must approve overtime in advance?", ["a supervisor"]],
    ["Announcement: The building's main entrance will be closed for repairs.", "Which entrance will be closed?", ["the main entrance"]],
    ["Notice: New software updates are installed automatically overnight.", "When are software updates installed?", ["overnight"]],
    ["Memo: Desk assignments will be reviewed at the start of each quarter.", "When are desk assignments reviewed?", ["at the start of each quarter"]],
    ["Announcement: The shuttle bus runs every twenty minutes during rush hour.", "How often does the shuttle run during rush hour?", ["every twenty minutes"]],
    ["Notice: Conference rooms must be booked at least a day ahead.", "How far ahead must rooms be booked?", ["a day"]],
    ["Memo: The dress code is relaxed on Fridays only.", "Which day is the dress code relaxed?", ["Friday", "Fridays"]],
    ["Announcement: Package deliveries are held at the front desk.", "Where are package deliveries held?", ["the front desk"]],
  ],
  B2: [
    ["Memo: Remote employees must log billable hours weekly, not monthly.", "How often must remote employees log hours?", ["weekly"]],
    ["Press release: The firm will phase out its legacy software over eighteen months.", "How long will the phase-out take?", ["eighteen months"]],
    ["Report excerpt: Customer retention improved after the support team was expanded.", "What improved after the team expanded?", ["customer retention"]],
    ["Memo: Interdepartmental transfers require sign-off from both department heads.", "Who must sign off on transfers?", ["both department heads"]],
    ["Notice: The new compliance training is mandatory for all managers.", "Who must complete the new training?", ["all managers"]],
    ["Internal notice: Expense claims submitted late will not be reimbursed.", "What happens to late expense claims?", ["they won't be reimbursed"]],
    ["Memo: The data migration will proceed in three separate phases.", "How many phases will the migration have?", ["three"]],
    ["Report excerpt: Warehouse efficiency rose after the new layout was introduced.", "What rose after the new layout?", ["warehouse efficiency"]],
    ["Notice: Client-facing staff must complete the new product briefing by Friday.", "Who must complete the briefing?", ["client-facing staff"]],
    ["Memo: The vendor evaluation process now includes a sustainability score.", "What was added to the vendor evaluation?", ["a sustainability score"]],
    ["Press release: The company will open two new regional offices next year.", "How many new offices are planned?", ["two"]],
    ["Memo: Security badges will be reissued ahead of the office relocation.", "What is happening ahead of the relocation?", ["badges will be reissued"]],
    ["Report excerpt: Absenteeism dropped following the introduction of flexible hours.", "What dropped after flexible hours began?", ["absenteeism"]],
    ["Notice: The annual review cycle has been shortened to six months.", "How long is the new review cycle?", ["six months"]],
    ["Memo: All contractor invoices must reference a valid purchase order.", "What must contractor invoices reference?", ["a valid purchase order"]],
  ],
  C1: [
    ["Internal notice: The revised travel policy applies retroactively to this quarter.", "Does the new travel policy apply retroactively?", ["yes"]],
    ["Analyst note: The firm's cost-cutting measures preceded, rather than followed, the downturn.", "Did the cost-cutting happen before or after the downturn?", ["before"]],
    ["Memo: Approval thresholds have been raised to reduce procedural delays.", "Why were approval thresholds raised?", ["to reduce delays"]],
    ["Statement: The compliance overhaul was prompted by an external audit, not internal review.", "What prompted the compliance overhaul?", ["an external audit"]],
    ["Internal memo: The restructuring will affect support functions more than frontline roles.", "Which roles will be affected more?", ["support functions"]],
    ["Analyst note: The firm's guidance was revised downward for the second consecutive quarter.", "How many consecutive quarters has guidance been revised down?", ["two", "second"]],
    ["Memo: The new escalation process bypasses the usual departmental hierarchy.", "What does the new process bypass?", ["the departmental hierarchy"]],
    ["Statement: The board's revised mandate expands its oversight of acquisitions.", "What does the revised mandate expand?", ["oversight of acquisitions"]],
    ["Internal notice: Legacy contracts will be honored until their natural expiry.", "What will happen to legacy contracts?", ["they'll be honored until expiry"]],
    ["Analyst note: The firm's margins held steady despite rising input costs.", "What happened to margins despite rising costs?", ["they held steady"]],
    ["Memo: The pilot program will expand only if early metrics hold.", "Under what condition will the pilot expand?", ["if early metrics hold"]],
    ["Statement: The revised bylaws require a supermajority for future amendments.", "What do the revised bylaws require?", ["a supermajority"]],
    ["Internal memo: Vendor consolidation is expected to yield gradual, not immediate, savings.", "Will the savings be immediate?", ["no"]],
    ["Analyst note: The spin-off was structured to minimize tax exposure for shareholders.", "Why was the spin-off structured this way?", ["to minimize tax exposure"]],
    ["Memo: The new reporting line was introduced to reduce redundancy, not headcount.", "What was the new reporting line meant to reduce?", ["redundancy"]],
  ],
  C2: [
    ["Commentary: The revised framework was praised less for its content than its timing.", "What was the framework praised for?", ["its timing"]],
    ["Analysis: The firm's restraint in responding was itself a form of signaling.", "What did the firm's restraint signal?", ["a deliberate message", "intent"]],
    ["Review: The policy's ambiguity served incumbents more than it hindered them.", "Who benefited from the ambiguity?", ["incumbents"]],
    ["Commentary: The board's eventual concession came only after reputational costs mounted.", "What prompted the board's concession?", ["mounting reputational costs"]],
    ["Analysis: The firm's silence was read as confirmation by those already skeptical.", "How was the firm's silence interpreted by skeptics?", ["as confirmation"]],
    ["Review: The settlement's modest terms belied the scale of the original dispute.", "Did the settlement's terms match the dispute's scale?", ["no"]],
    ["Commentary: The inquiry's caution was mistaken by some for an admission of weakness.", "How was the inquiry's caution misread?", ["as weakness"]],
    ["Analysis: The firm's quiet compliance avoided scrutiny that open resistance would have invited.", "What did quiet compliance avoid?", ["scrutiny"]],
    ["Review: The ruling's deliberate narrowness was itself a political choice.", "Was the ruling's narrowness accidental?", ["no"]],
    ["Commentary: The firm's belated transparency only underscored how little had been volunteered earlier.", "What did the belated transparency reveal?", ["how little had been shared earlier"]],
    ["Analysis: The regulator's restraint reflected institutional caution more than any factual ambiguity.", "What did the regulator's restraint reflect?", ["institutional caution"]],
    ["Review: The firm's rebranding addressed perception more than the substance of past failures.", "What did the rebranding mainly address?", ["perception"]],
    ["Commentary: The committee's eventual report was notable for what it declined to say.", "What was notable about the report?", ["what it left unsaid"]],
    ["Analysis: The firm's apology was carefully worded to concede optics without admitting fault.", "Did the apology admit fault?", ["no"]],
    ["Review: The policy's revision was cosmetic enough to satisfy critics without altering outcomes.", "Did the revision change outcomes?", ["no"]],
  ],
};

// ---------------------------------------------------------------------------
async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode — writing changes." : "DRY RUN — pass --apply to write.");

  type Plan = { itemTypeId: string; skill: string; rowsForLevel: (level: Level) => Row[] };
  const plans: Plan[] = [
    { itemTypeId: "dictation", skill: "writing", rowsForLevel: (l) => plainSentences(l, 0, PER_LEVEL).map(textAnswer) },
    { itemTypeId: "reading", skill: "reading", rowsForLevel: (l) => plainSentences(l, 1, PER_LEVEL).map(plainText) },
    { itemTypeId: "repeats", skill: "speaking", rowsForLevel: (l) => plainSentences(l, 2, PER_LEVEL).map(textAnswer) },
    { itemTypeId: "sentence_builds", skill: "speaking", rowsForLevel: (l) => sentenceBuildsForLevel(l) },
    { itemTypeId: "passage_reconstruction", skill: "writing", rowsForLevel: (l) => PASSAGE_RECONSTRUCTION_BANK[l].map(passageRow) },
    { itemTypeId: "speaking_situations", skill: "reading", rowsForLevel: (l) => SPEAKING_SITUATIONS_BANK[l].map(situationRow) },
    { itemTypeId: "story_retelling", skill: "speaking", rowsForLevel: (l) => STORY_RETELLING_BANK[l].map(storyRow) },
    { itemTypeId: "summary_and_opinion", skill: "reading", rowsForLevel: (l) => SUMMARY_AND_OPINION_BANK[l].map(passageRow) },
    { itemTypeId: "conversations", skill: "listening", rowsForLevel: (l) => CONVERSATION_BANK[l].map(([d, q, a]) => conversation(d, q, a)) },
    { itemTypeId: "passage_comprehension", skill: "listening", rowsForLevel: (l) => PASSAGE_COMPREHENSION_BANK[l].map(([s, q, a]) => story(s, q, a)) },
    { itemTypeId: "short_answer", skill: "speaking", rowsForLevel: (l) => SHORT_ANSWER_BANK[l].map(([q, a]) => shortAnswer(q, a)) },
    { itemTypeId: "reading_selective", skill: "reading", rowsForLevel: (l) => READING_SELECTIVE_BANK[l].map(([t, q, a]) => readingSelective(t, q, a)) },
    { itemTypeId: "reading_selective", skill: "listening", rowsForLevel: (l) => READING_SELECTIVE_BANK_2[l].map(([t, q, a]) => readingSelective(t, q, a)) },
  ];

  // Fetch the 6 existing unit ids + their current max set order_index, per item type.
  const unitInfo = new Map<string, { unitId: string; level: Level; maxOrder: number }[]>();
  for (const plan of plans) {
    if (unitInfo.has(plan.itemTypeId)) continue;
    const result = await pool.query<{ unit_id: string; level: Level; max_order: number }>(
      `SELECT u.id AS unit_id, i.cefr_level AS level, max(s.order_index) AS max_order
       FROM units u JOIN sets s ON s.unit_id = u.id JOIN items i ON i.set_id = s.id
       WHERE u.item_type_id = $1
       GROUP BY u.id, i.cefr_level`,
      [plan.itemTypeId],
    );
    unitInfo.set(
      plan.itemTypeId,
      result.rows.map((r) => ({ unitId: r.unit_id, level: r.level, maxOrder: r.max_order })),
    );
  }

  // Global uniqueness guard against the ENTIRE existing bank.
  const existing = await pool.query<{ content: Record<string, unknown> }>(`SELECT content FROM items WHERE status='approved'`);
  const seen = new Set(existing.rows.map((r) => JSON.stringify(r.content)));

  let totalNew = 0;
  let collisions = 0;
  const client = await pool.connect();
  try {
    if (apply) await client.query("BEGIN");
    for (const plan of plans) {
      const units = unitInfo.get(plan.itemTypeId)!;
      let planCount = 0;
      for (const level of LEVELS) {
        const rows = plan.rowsForLevel(level);
        if (rows.length !== PER_LEVEL) {
          throw new Error(`${plan.itemTypeId}/${plan.skill}/${level}: expected ${PER_LEVEL} rows, got ${rows.length}`);
        }
        for (const row of rows) {
          const key = JSON.stringify(row.content);
          if (seen.has(key)) {
            console.error(`COLLISION: ${plan.itemTypeId}/${plan.skill}/${level}: ${key}`);
            collisions++;
            continue;
          }
          seen.add(key);
        }

        const unit = units.find((u) => u.level === level);
        if (!unit) throw new Error(`No unit found for ${plan.itemTypeId} at level ${level}`);

        // 3 new sets of 5 items each, continuing this unit's order_index.
        for (let setIdx = 0; setIdx < 3; setIdx++) {
          const setItems = rows.slice(setIdx * 5, setIdx * 5 + 5);
          const setId = randomUUID();
          const newOrder = unit.maxOrder + 1 + setIdx;
          if (apply) {
            await client.query(`INSERT INTO sets (id, unit_id, name, order_index) VALUES ($1, $2, $3, $4)`, [
              setId,
              unit.unitId,
              `${level} — ${plan.skill} ${setIdx + 1}`,
              newOrder,
            ]);
          }
          for (let itemIdx = 0; itemIdx < setItems.length; itemIdx++) {
            const row = setItems[itemIdx];
            planCount++;
            totalNew++;
            if (apply) {
              await client.query(
                `INSERT INTO items (id, item_type_id, pool, status, cefr_level, content, answer_set, skill_tag, set_id, set_order)
                 VALUES ($1, $2, 'practice', 'approved', $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
                [
                  randomUUID(),
                  plan.itemTypeId,
                  level,
                  JSON.stringify(row.content),
                  row.answerSet ? JSON.stringify(row.answerSet) : null,
                  plan.skill,
                  setId,
                  itemIdx,
                ],
              );
            }
          }
        }
      }
      console.log(`${plan.itemTypeId}/${plan.skill}: ${planCount} new items`);
    }

    if (collisions > 0) {
      console.error(`${collisions} collision(s) found — fix the content banks before applying.`);
      if (apply) await client.query("ROLLBACK");
      process.exit(1);
    }

    if (apply) {
      await client.query("COMMIT");
      console.log(`Applied: inserted ${totalNew} new items.`);
    } else {
      console.log(`Would insert ${totalNew} new items. Uniqueness check passed.`);
    }
  } catch (err) {
    if (apply) await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  console.error("authorSkillSplitContent: fatal error:", err);
  process.exit(1);
});
