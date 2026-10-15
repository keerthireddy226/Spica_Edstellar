import { BRITISH_TO_AMERICAN } from "./spellingVariants.js";

const VARIANTS = new Map(Object.entries(BRITISH_TO_AMERICAN));

// One spelling for words English varieties spell differently, so a British,
// Indian or American spelling of the same word compares equal: "organisation"
// and "organization" both become "organization". Applied to the answer key
// and the learner's answer alike. Expects lowercase text.
export function canonicalSpelling(text: string): string {
  return text.replace(/[a-z]+/g, (word) => VARIANTS.get(word) ?? word);
}
