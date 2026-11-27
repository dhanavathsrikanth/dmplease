import { describe, expect, it } from "vitest";

import {
  buildDmVars,
  findDmVariables,
  missingDmVariables,
  renderDmTemplate,
} from "@/lib/dm-variables";
import { personalizeMessage } from "@/lib/meta/dm-template";
import { makeVoucherCode } from "@/lib/vouchers";

describe("DM variable engine", () => {
  it("discovers both single and double brace syntax", () => {
    expect(findDmVariables("Hi {NAME}, your {code} and {{voucher}}")).toEqual([
      "name",
      "voucher",
    ]);
  });

  it("renders all supported variables", () => {
    const vars = buildDmVars({
      username: "alex",
      name: "Alex",
      email: "alex@example.com",
      phone: "+91 98765 43210",
      keyword: "GUIDE",
      link: "https://example.com/guide",
      voucher: "ALEX-7K2M9Q",
      voucher_url: "https://example.com/guide?voucher=ALEX-7K2M9Q",
    });
    const text = renderDmTemplate(
      "{name} ({username}) wants {keyword}. Email {email}, phone {phone}. {voucher} → {voucher_url}",
      vars
    );
    expect(text).toContain("Alex (alex) wants GUIDE");
    expect(text).toContain("alex@example.com");
    expect(text).toContain("ALEX-7K2M9Q");
    expect(text).toContain("voucher=ALEX-7K2M9Q");
  });

  it("keeps unknown tokens visible so typos are obvious", () => {
    expect(renderDmTemplate("Hi {nmae}", buildDmVars())).toBe("Hi {nmae}");
  });

  it("uses safe fallbacks for missing values", () => {
    const text = renderDmTemplate(
      "Hey {name}, grab {link} for {keyword} — code {voucher}",
      buildDmVars()
    );
    expect(text).toBe("Hey there, grab  for  — code ");
  });

  it("reports variables used without a value", () => {
    expect(
      missingDmVariables("Hi {name} and {username}", { username: "alex" })
    ).toEqual(["name"]);
  });

  it("keeps the legacy personalise helper working", () => {
    expect(
      personalizeMessage("Hi {USERNAME}, your {keyword} is {Link}", {
        username: "alice",
        keyword: "GUIDE",
        link: "https://example.com",
      })
    ).toBe("Hi alice, your GUIDE is https://example.com");
  });
});

describe("voucher codes", () => {
  it("is stable for the same person and different for another", () => {
    const first = makeVoucherCode("auto:1", "recipient-1");
    expect(makeVoucherCode("auto:1", "recipient-1")).toBe(first);
    expect(makeVoucherCode("auto:1", "recipient-2")).not.toBe(first);
  });

  it("uses the prefix and avoids ambiguous characters", () => {
    const code = makeVoucherCode("auto:1", "recipient-1", "guide offer");
    expect(code).toMatch(/^GUIDEO-[2-9A-HJ-NP-Z]{8}$/);
  });
});
