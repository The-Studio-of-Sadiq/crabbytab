import { describe, expect, it } from "vitest";
import { nameWithPronoun, personLastName } from "./person";
import { lastNamesCodeName, withoutRealNameCodeName } from "@/lib/codeNames";

describe("person fields", () => {
  it("pre-prints a pronoun after the name", () => {
    expect(nameWithPronoun({ name: "Alex Kim", pronoun: " they/them " })).toBe("Alex Kim (they/them)");
    expect(nameWithPronoun({ name: "Alex Kim" })).toBe("Alex Kim");
    expect(nameWithPronoun({ name: "Alex Kim", pronoun: "" })).toBe("Alex Kim");
  });

  it("uses the stored last name, else the last word of the name", () => {
    expect(personLastName({ name: "Maria de la Cruz", lastName: "de la Cruz" })).toBe("de la Cruz");
    expect(personLastName({ name: "Maria de la Cruz" })).toBe("Cruz");
  });

  it("builds last-name code names from stored last names", () => {
    expect(
      lastNamesCodeName({
        speakers: [
          { id: "1", name: "Maria de la Cruz", lastName: "de la Cruz" },
          { id: "2", name: "Ben Smith" },
        ],
      })
    ).toBe("de la Cruz & Smith");
  });
});

describe("code names that are only a real name", () => {
  it("clears a code name equal to the current or previous team name", () => {
    expect(withoutRealNameCodeName({ name: "Alpha", codeName: "Alpha" }).codeName).toBeUndefined();
    expect(withoutRealNameCodeName({ name: "Beta", codeName: " Alpha " }, "Alpha").codeName).toBeUndefined();
    expect(withoutRealNameCodeName({ name: "Beta", codeName: "" }).codeName).toBeUndefined();
  });

  it("keeps a genuine code name and leaves teams without one untouched", () => {
    expect(withoutRealNameCodeName({ name: "Beta", codeName: "Fox" }, "Alpha").codeName).toBe("Fox");
    const plain = { name: "Beta" };
    expect(withoutRealNameCodeName(plain)).toBe(plain);
  });
});
