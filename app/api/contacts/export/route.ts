import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/csv";

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
  status: string | null;
  notes: string | null;
  opted_in_at: string | null;
  last_interaction_at: string | null;
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
  "status",
  "notes",
  "opted_in_at",
  "last_interaction_at",
  "created_at",
];

export async function GET(request: NextRequest) {
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

  const params = request.nextUrl.searchParams;
  const query = (params.get("q") || "").trim().toLowerCase();
  const source = (params.get("source") || "").trim();
  const tag = (params.get("tag") || "").trim();
  const has = (params.get("has") || "").trim();

  let dbQuery = supabase
    .from("contacts")
    .select(
      "id, instagram_id, username, display_name, email, phone, tags, properties, source, status, notes, opted_in_at, last_interaction_at, created_at"
    )
    .in("workspace_id", workspaceIds)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (source) dbQuery = dbQuery.eq("source", source);
  if (has === "email") dbQuery = dbQuery.not("email", "is", null);
  if (has === "phone") dbQuery = dbQuery.not("phone", "is", null);

  const { data, error } = await dbQuery;

  if (error) {
    console.error("[contacts/export] Query failed:", error.message);
    return NextResponse.json(
      { error: "Could not export contacts right now." },
      { status: 500 }
    );
  }

  let rows = (data || []) as ContactExportRow[];
  if (tag) rows = rows.filter((row) => (row.tags || []).includes(tag));
  if (query) {
    rows = rows.filter((row) => {
      const haystack = [
        row.display_name,
        row.username,
        row.instagram_id,
        row.email,
        row.phone,
        row.source,
        row.status,
        ...(row.tags || []),
        row.properties ? JSON.stringify(row.properties) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  const lines = [HEADERS.map(csvCell).join(",")];
  for (const row of rows) {
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
        row.status,
        row.notes,
        row.opted_in_at,
        row.last_interaction_at,
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
