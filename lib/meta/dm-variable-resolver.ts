/**
 * Server-side variable resolution for DM copy.
 *
 * Only reads/fetches what a template actually uses: contact fields are loaded
 * when `{name}`, `{email}` or `{phone}` appear, and a voucher is minted only
 * when `{voucher}` / `{voucher_url}` appear. That keeps the hot webhook path
 * cheap while making every documented placeholder real.
 */

import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import {
  buildDmVars,
  findDmVariables,
  missingDmVariables,
  type DmVariableToken,
  type DmVars,
} from "@/lib/dm-variables";
import { resolveVoucher } from "@/lib/vouchers";

interface ContactSnapshot {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

async function loadContact(
  workspaceId: string,
  contactId: string | null | undefined,
  recipientId: string | null | undefined
): Promise<ContactSnapshot | null> {
  if (!hasAdminDb()) return null;
  let query = getAdminDb()
    .from("contacts")
    .select("id, username, display_name, email, phone")
    .eq("workspace_id", workspaceId);
  query = contactId
    ? query.eq("id", contactId)
    : query.eq("instagram_id", recipientId ?? "");
  const { data } = await query.limit(1).maybeSingle();
  return (data as ContactSnapshot | null) ?? null;
}

function nameFrom(contact: ContactSnapshot | null, username?: string | null): string {
  if (contact?.display_name?.trim()) return contact.display_name.trim();
  if (contact?.email?.trim()) {
    return contact.email.split("@")[0].split(/[._-]/)[0];
  }
  return username?.trim() || "";
}

export interface DmVariableResolveInput {
  workspaceId: string;
  template: string;
  /** Stable scope for voucher generation, e.g. `auto:<campaign id>`. */
  scopeKey: string;
  contactId?: string | null;
  recipientId?: string | null;
  username?: string | null;
  keyword?: string;
  link?: string | null;
  prefix?: string | null;
}

export interface DmVariableResolveResult {
  vars: DmVars;
  missing: DmVariableToken[];
}

export async function resolveDmVars(
  input: DmVariableResolveInput
): Promise<DmVariableResolveResult> {
  const tokens = findDmVariables(input.template);
  const needsContact = tokens.some((token) =>
    (["name", "email", "phone"] as DmVariableToken[]).includes(token)
  );
  const contact = needsContact
    ? await loadContact(input.workspaceId, input.contactId, input.recipientId)
    : null;

  let voucher: Awaited<ReturnType<typeof resolveVoucher>> | null = null;
  if (tokens.includes("voucher") || tokens.includes("voucher_url")) {
    voucher = await resolveVoucher({
      workspaceId: input.workspaceId,
      scopeKey: input.scopeKey,
      recipientId: input.recipientId || input.username || "unknown",
      prefix: input.prefix,
      link: input.link,
    });
  }

  const raw: DmVars = {
    username: contact?.username || input.username || "",
    name: nameFrom(contact, input.username),
    email: contact?.email || "",
    phone: contact?.phone || "",
    keyword: input.keyword || "",
    link: input.link || "",
    voucher: voucher?.code || "",
    voucher_url: voucher?.voucherUrl || "",
  };
  // Missing values are measured on the raw inputs; buildDmVars() adds friendly
  // fallbacks for rendering, which would otherwise hide an uncollected field.
  return {
    vars: buildDmVars(raw),
    missing: missingDmVariables(input.template, raw),
  };
}
