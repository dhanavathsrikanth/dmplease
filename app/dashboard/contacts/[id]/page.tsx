import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Mail,
  MessageCircle,
  Phone,
  Tag,
  UserRound,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactEditor } from "@/components/contacts/contact-editor";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Contact - dmplease" };

interface ContactRow {
  id: string;
  workspace_id: string;
  instagram_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  properties: Record<string, unknown> | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  opted_in_at: string | null;
  created_at: string;
  last_interaction_at: string | null;
}

interface MessageRow {
  id: string;
  direction: string;
  sender_type: string;
  content: { text?: string } | null;
  delivery_status: string | null;
  created_at: string;
}

interface LeadEventRow {
  id: string;
  kind: string;
  field: string | null;
  value: string | null;
  created_at: string;
}

function ContactSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-52 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-96 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ContactSkeleton />}>
      <ContactContent params={params} />
    </Suspense>
  );
}

async function ContactContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  const profile = await getCurrentProfile();
  if (!profile) notFound();
  const workspaceIds = (profile.ownedWorkspaces || []).map((workspace) => workspace.id);
  if (workspaceIds.length === 0) notFound();

  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select(
      "id, workspace_id, instagram_id, username, display_name, email, phone, tags, properties, source, status, notes, opted_in_at, created_at, last_interaction_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!contact || !workspaceIds.includes(String(contact.workspace_id))) {
    notFound();
  }
  const row = contact as ContactRow;

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", row.id)
    .limit(5);
  const conversationIds = (conversations ?? []).map((c) => String(c.id));

  const [messagesRes, leadEventsRes] = await Promise.all([
    conversationIds.length > 0
      ? supabase
          .from("messages")
          .select("id, direction, sender_type, content, delivery_status, created_at")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [] as MessageRow[] }),
    supabase
      .from("lead_events")
      .select("id, kind, field, value, created_at")
      .eq("contact_id", row.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const messages = (messagesRes.data ?? []) as MessageRow[];
  const leadEvents = (leadEventsRes.data ?? []) as LeadEventRow[];
  const displayName = row.display_name || row.username || "Unknown follower";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/contacts"
            className="size-9 rounded-full border border-[#e0e2e8] dark:border-border flex items-center justify-center hover:bg-muted/50"
            aria-label="Back to contacts"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <div className="flex items-center gap-3">
            <span className="size-11 rounded-full bg-[#ffd02f] text-[#1c1c1e] flex items-center justify-center text-sm font-bold">
              {initials}
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-foreground">
                {displayName}
              </h1>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground">
                {row.username ? `@${row.username} · ` : ""}
                {row.instagram_id}
              </p>
            </div>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3 capitalize">
          {row.status || "new"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
            <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                <MessageCircle className="size-4 text-[#4262ff]" aria-hidden="true" />
                Conversation
              </CardTitle>
              <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                Every inbound and outbound message stored for this contact.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {messages.length === 0 ? (
                <p role="status" className="py-8 text-center text-xs text-muted-foreground">
                  No messages stored yet. They appear here after the first DM.
                </p>
              ) : (
                <ul className="space-y-3" aria-label="Conversation messages">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      className={`flex ${message.direction === "inbound" ? "justify-start" : "justify-end"}`}
                    >
                      <div
                        className={`max-w-md rounded-2xl px-3.5 py-2.5 text-xs ${
                          message.direction === "inbound"
                            ? "bg-[#f7f8fa] dark:bg-muted/60 border border-[#e0e2e8] dark:border-border"
                            : "bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {message.content?.text || "(attachment)"}
                        </p>
                        <p className="mt-1 text-[9px] opacity-70">
                          {message.sender_type === "agent"
                            ? "Manual reply · "
                            : message.sender_type === "bot"
                              ? "Auto · "
                              : ""}
                          {formatDate(message.created_at)}
                          {message.delivery_status ? ` · ${message.delivery_status}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
            <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-base font-semibold tracking-tight">
                Lead capture timeline
              </CardTitle>
              <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                Prompts sent, values captured, skips and invalid replies.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {leadEvents.length === 0 ? (
                <p role="status" className="py-6 text-center text-xs text-muted-foreground">
                  No lead-capture events yet.
                </p>
              ) : (
                <ul className="space-y-2" aria-label="Lead capture events">
                  {leadEvents.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[#e0e2e8] dark:border-border px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          variant={
                            event.kind === "captured"
                              ? "tag-teal"
                              : event.kind === "invalid"
                                ? "destructive"
                                : "outline"
                          }
                          className="text-[9px] rounded-full px-2 py-0.5 shrink-0 capitalize"
                        >
                          {event.kind}
                        </Badge>
                        <span className="text-[11px] text-foreground truncate">
                          {event.field ?? "field"}
                          {event.value ? `: ${event.value}` : ""}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDate(event.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
            <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-base font-semibold tracking-tight">
                Contact details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5 space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <Mail className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-foreground">{row.email || "No email yet"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-foreground">{row.phone || "No phone yet"}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-foreground capitalize">{row.source || "Unknown source"}</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-foreground">Joined {formatDate(row.created_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Tag className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-foreground">
                  Last interaction {formatDate(row.last_interaction_at)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle">
            <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
              <CardTitle className="text-base font-semibold tracking-tight">
                Edit contact
              </CardTitle>
              <CardDescription className="text-xs text-[#555a6a] dark:text-muted-foreground">
                Tags, custom properties, status and notes.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <ContactEditor
                contactId={row.id}
                workspaceId={row.workspace_id}
                initialTags={row.tags ?? []}
                initialProperties={row.properties ?? {}}
                initialStatus={
                  (row.status as "new" | "contacted" | "qualified" | "customer" | "archived") ||
                  "new"
                }
                initialNotes={row.notes}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
