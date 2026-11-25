import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ContactExportRow {
  id: string;
  instagram_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  properties: Record<string, unknown> | null;
  source: string | null;
  opted_in_at: string | null;
  created_at: string;
}

const HEADERS = [
  "id",
  "instagram_id",
  "username",
  "display_name",
  "email",
  "phone",
  "tags",
  "properties",
  "source",
  "opted_in_at",
  "created_at",
];

/** Quote every value and double embedded quotes so spreadsheets parse reliably. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id);

  const workspaceIds = (workspaces || []).map((workspace) => workspace.id as string);
  if (workspaceIds.length === 0) {
    return new Response(`\uFEFF${HEADERS.map(csvCell).join(",")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="contacts.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, instagram_id, username, display_name, email, phone, tags, properties, source, opted_in_at, created_at"
    )
    .in("workspace_id", workspaceIds)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[contacts/export] Query failed:", error.message);
    return NextResponse.json(
      { error: "Could not export contacts right now." },
      { status: 500 }
    );
  }

  const lines = [HEADERS.map(csvCell).join(",")];
  for (const row of (data || []) as ContactExportRow[]) {
    lines.push(
      [
        row.id,
        row.instagram_id,
        row.username,
        row.display_name,
        row.email,
        row.phone,
        row.tags,
        row.properties,
        row.source,
        row.opted_in_at,
        row.created_at,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="contacts.csv"',
      "Cache-Control": "no-store",
    },
  });
}
