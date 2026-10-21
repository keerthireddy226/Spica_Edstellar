import { api } from "@/lib/api";

// What a learner owns: Full access (a licence or the Plus plan), preparation
// for one test, and real-test attempts.
export type ProductKind = "full" | "prep" | "assessment" | "level";

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
}

export interface MyAccess {
  full: { endsAt: string | null } | null;
  prepTests: string[];
  owned: Owned[];
  attempts: Owned[];
  // Practice Modules question types open to the learner (null = all).
  itemTypes: string[] | null;
}

export function getMyAccess(): Promise<MyAccess> {
  return api("/access/me");
}

// Owns something, but not Full access: only what they bought is open.
export const isNarrowed = (a: MyAccess | null | undefined): boolean => !!a && !a.full && a.owned.length > 0;

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
