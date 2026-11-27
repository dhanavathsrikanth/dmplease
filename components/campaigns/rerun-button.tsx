"use client";

import { useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RerunDialog } from "@/components/campaigns/rerun-dialog";

interface RerunButtonProps {
  campaign: {
    id: string;
    name: string;
    active: boolean;
    postScope?: string | null;
  };
}

/** Opens the re-run dialog from the campaign edit page. */
export function RerunButton({ campaign }: RerunButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="rounded-full h-9 text-xs font-semibold gap-1.5"
      >
        <History className="size-3.5" aria-hidden="true" />
        Re-run last 7 days
      </Button>
      <RerunDialog
        campaign={campaign}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
