import { describe, expect, it } from "vitest";
import { peopleFromRows } from "./peopleSheet";

describe("peopleFromRows", () => {
  it("finds the columns by their headings, in any order", () => {
    const r = peopleFromRows([
      ["Last Name", "Email Address", "First Name", "Phone"],
      ["Rao", "asha@example.com", "Asha", "999"],
      ["Iyer", "meera@example.com", "Meera", ""],
    ]);
    expect(r.people).toEqual([
      { email: "asha@example.com", firstName: "Asha", lastName: "Rao" },
      { email: "meera@example.com", firstName: "Meera", lastName: "Iyer" },
    ]);
    expect(r.badRows).toEqual([]);
  });

  it("splits a single Name column, and reports rows without a valid email by spreadsheet row", () => {
    const r = peopleFromRows([
      ["Name", "Email"],
      ["Ravi Kumar Singh", "ravi@example.com"],
      ["No Email", ""],
      ["Bad", "not-an-email"],
    ]);
    expect(r.people).toEqual([{ email: "ravi@example.com", firstName: "Ravi", lastName: "Kumar Singh" }]);
    expect(r.badRows).toEqual([3, 4]);
  });

  it("with no heading row: email, first name, last name; duplicates kept once", () => {
    const r = peopleFromRows([
      ["a@example.com", "A", "One"],
      ["A@example.com", "A", "Again"],
      ["b@example.com"],
    ]);
    expect(r.people.map((p) => p.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(r.duplicates).toBe(1);
  });
});
