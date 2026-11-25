import { Suspense } from "react";
import { connection } from "next/server";
import {
  Download,
  Search,
  Users,
  UserRoundSearch,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Contacts - dmplease",
};

interface ContactRow {
  id: string;
  instagram_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  properties: Record<string, unknown> | null;
  source: string | null;
  created_at: string;
}

interface ContactsPageProps {
  searchParams?: Promise<{ q?: string }>;
}

function ContactsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-52 rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

export default function ContactsPage(props: ContactsPageProps) {
  return (
    <Suspense fallback={<ContactsSkeleton />}>
      <ContactsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatProperties(properties: Record<string, unknown> | null): string {
  if (!properties || typeof properties !== "object") return "—";
  const parts = Object.entries(properties)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

async function ContactsContent({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const query = (params?.q || "").trim();
  const normalizedQuery = query.toLowerCase();

  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const workspaceIds = (profile?.ownedWorkspaces || []).map((workspace) => workspace.id);

  let contacts: ContactRow[] = [];
  let loadError = false;

  if (workspaceIds.length > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, instagram_id, username, display_name, email, phone, tags, properties, source, created_at"
      )
      .in("workspace_id", workspaceIds)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.warn("[contacts] Could not load contacts:", error.message);
      loadError = true;
    } else if (data) {
      contacts = data as ContactRow[];
    }
  }

  const filtered = normalizedQuery
    ? contacts.filter((contact) => {
        const haystack = [
          contact.display_name,
          contact.username,
          contact.instagram_id,
          contact.email,
          contact.phone,
          contact.source,
          ...(contact.tags || []),
          formatProperties(contact.properties),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : contacts;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
            Contacts
          </h1>
          <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
            Everyone who has interacted with your automations, with the details you collected.
          </p>
        </div>

        <Button
          asChild
          size="sm"
          variant="outline"
          className="rounded-full h-9 text-xs font-semibold px-5 shrink-0"
        >
          <a href="/api/contacts/export" download="contacts.csv">
            <Download className="size-3.5" />
            Export CSV
          </a>
        </Button>
      </div>

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle overflow-hidden">
        <div className="p-4 border-b border-[#e0e2e8] dark:border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-[#746019] dark:text-[#ffd02f]" />
            <span className="text-xs font-semibold text-foreground">
              {filtered.length} contact{filtered.length === 1 ? "" : "s"}
            </span>
            {query && (
              <Badge variant="tag-yellow" className="text-[10px] font-semibold rounded-full">
                Filtered
              </Badge>
            )}
          </div>
          <form method="get" action="/dashboard/contacts" className="relative w-full sm:w-72">
            <Search className="size-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search name, username, email, tag..."
              aria-label="Search contacts"
              className="pl-9 h-9 text-xs rounded-full bg-[#f7f8fa] dark:bg-muted/40 border-[#e0e2e8] dark:border-border"
            />
          </form>
        </div>

        {loadError ? (
          <div role="alert" className="p-10 text-center text-xs text-rose-600 dark:text-rose-400">
            Contacts could not be loaded right now. Please try again in a moment.
          </div>
        ) : contacts.length === 0 ? (
          <div role="status" className="p-10 text-center space-y-3">
            <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] dark:bg-[#746019]/30 dark:text-[#ffd02f] flex items-center justify-center mx-auto">
              <Users className="size-5" />
            </div>
            <div>
              <p className="font-semibold text-base text-foreground">No contacts captured yet</p>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                Add a lead-capture step to an automation. When someone shares their email, phone or name, their contact record appears here.
              </p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div role="status" className="p-10 text-center space-y-3">
            <div className="size-11 rounded-2xl bg-[#f7f8fa] dark:bg-muted/50 flex items-center justify-center mx-auto">
              <UserRoundSearch className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-base text-foreground">No contacts match &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                Try a different name, username, email address or tag.
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Instagram ID</TableHead>
                <TableHead>Email / Phone</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Captured properties</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((contact) => {
                const displayName =
                  contact.display_name || contact.username || "Unknown follower";
                const initials = displayName.slice(0, 2).toUpperCase();
                return (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="size-8 rounded-full shrink-0 bg-[#ffd02f] text-[#1c1c1e] flex items-center justify-center text-[10px] font-bold">
                          {initials}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-xs text-foreground truncate">{displayName}</p>
                          {contact.username && (
                            <p className="text-[10px] text-[#6b6f7e] truncate">@{contact.username}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground max-w-[160px] truncate">
                      {contact.instagram_id}
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-foreground truncate">{contact.email || "—"}</p>
                      <p className="text-[10px] text-[#6b6f7e]">{contact.phone || ""}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(contact.tags || []).length > 0 ? (
                          contact.tags?.map((tag) => (
                            <Badge key={tag} variant="tag-purple" className="text-[9px] px-2 py-0.5">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground capitalize">
                      {contact.source || "—"}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={formatProperties(contact.properties)}>
                      {formatProperties(contact.properties)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {formatDate(contact.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
