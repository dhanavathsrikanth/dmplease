/**
 * Personalisation variable engine for DM copy.
 *
 * Client-safe and pure: one catalogue, one renderer, one source of truth for
 * what `{name}`, `{voucher}`, `{email}` and friends mean. Both `{token}` and
 * `{{token}}` are accepted (case-insensitive), and unknown tokens are left
 * visible so a typo is obvious instead of silently disappearing.
 */

export const DM_VARIABLES = [
  {
    token: "username",
    label: "Instagram username",
    example: "alex",
    source: "context",
    description: "The person commenting or messaging you.",
  },
  {
    token: "name",
    label: "First name",
    example: "Alex",
    source: "contact",
    description: "Their name once you collect it with a lead form.",
  },
  {
    token: "email",
    label: "Email address",
    example: "alex@example.com",
    source: "contact",
    description: "Their email once you collect it with a lead form.",
  },
  {
    token: "phone",
    label: "Phone number",
    example: "+91 98765 43210",
    source: "contact",
    description: "Their phone once you collect it with a lead form.",
  },
  {
    token: "keyword",
    label: "Trigger keyword",
    example: "GUIDE",
    source: "context",
    description: "The keyword they commented or replied with.",
  },
  {
    token: "link",
    label: "Tracked link",
    example: "https://yourbrand.com/guide",
    source: "context",
    description: "Your destination URL with attribution added.",
  },
  {
    token: "voucher",
    label: "Unique voucher code",
    example: "ALEX-7K2M9Q",
    source: "voucher",
    description: "A stable, unique code generated per person. Just add the token.",
  },
  {
    token: "voucher_url",
    label: "Link with voucher",
    example: "https://yourbrand.com/guide?voucher=ALEX-7K2M9Q",
    source: "voucher",
    description: "Your tracked link with their voucher code attached.",
  },
] as const;

export type DmVariableToken = (typeof DM_VARIABLES)[number]["token"];
export type DmVariableSource = (typeof DM_VARIABLES)[number]["source"];

export type DmVars = Partial<Record<DmVariableToken, string>>;

const TOKEN_RE = /\{\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?\}/g;

const TOKENS = new Set<string>(DM_VARIABLES.map((variable) => variable.token));

/** Fallbacks keep a message readable even when a value was never collected. */
const FALLBACKS: Record<DmVariableToken, string> = {
  username: "there",
  name: "there",
  email: "",
  phone: "",
  keyword: "",
  link: "",
  voucher: "",
  voucher_url: "",
};

export function isDmVariable(token: string): token is DmVariableToken {
  return TOKENS.has(token.toLowerCase());
}

/** Tokens actually used in a template, deduplicated and lowercased. */
export function findDmVariables(template: string | null | undefined): DmVariableToken[] {
  const found = new Set<DmVariableToken>();
  for (const match of (template ?? "").matchAll(TOKEN_RE)) {
    const token = match[1].toLowerCase();
    if (isDmVariable(token)) found.add(token);
  }
  return [...found];
}

/**
 * Replaces every known variable. Unknown tokens are preserved verbatim.
 */
export function renderDmTemplate(
  template: string | null | undefined,
  vars: DmVars = {}
): string {
  return (template ?? "").replace(TOKEN_RE, (original, rawToken: string) => {
    const token = rawToken.toLowerCase();
    if (!isDmVariable(token)) return original;
    const value = vars[token];
    return typeof value === "string" && value.length > 0 ? value : FALLBACKS[token];
  });
}

/** Builds a complete vars object with safe fallbacks for every known token. */
export function buildDmVars(input: DmVars = {}): DmVars {
  const result: DmVars = {};
  for (const variable of DM_VARIABLES) {
    const value = input[variable.token];
    result[variable.token] =
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : FALLBACKS[variable.token];
  }
  return result;
}

/** Variables the template needs but the current send has no value for. */
export function missingDmVariables(
  template: string,
  vars: DmVars
): DmVariableToken[] {
  return findDmVariables(template).filter((token) => {
    const value = vars[token];
    return !value || value.length === 0;
  });
}
