import { api } from "@/lib/api";

// What a learner owns: Full access (a licence or the Plus plan), preparation
// for one test, and real-test attempts.
export type ProductKind = "full" | "prep" | "assessment" | "level" | "pack" | "final";

export interface Owned {
  id: string;
  productId: string;
  kind: ProductKind;
  name: string;
  testTypeId: string | null;
  level: string | null;
  attemptsLeft: number;
  startsAt: string;
  endsAt: string;
  // Preparation can still be switched to another test until this time.
  canSwitchUntil: string | null;
}

export interface MyAccess {
  full: { endsAt: string | null } | null;
  prepTests: string[];
  // A practice pack: every Practice Modules question type (no tests).
  practicePack: boolean;
  owned: Owned[];
  attempts: Owned[];
  // Practice Modules question types open to the learner (null = all).
  itemTypes: string[] | null;
}

export function getMyAccess(): Promise<MyAccess> {
  return api("/access/me");
}

// Owns a preparation or a practice pack, but not Full access: only what they
// bought is open. A level test or a real test alone takes nothing away (the
// free plan's rules apply, as on the server).
export const isNarrowed = (a: MyAccess | null | undefined): boolean => !!a && !a.full && (a.prepTests.length > 0 || a.practicePack);

export interface Product {
  id: string;
  kind: ProductKind;
  testTypeId: string | null;
  testTypeName: string | null;
  name: string;
  description: string;
  pricePaise: number;
  credits: number | null;
  durationDays: number;
  attempts: number;
  active: boolean;
  sortOrder: number;
}

export function getProducts(): Promise<{ products: Product[] }> {
  return api("/access/products");
}
