"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Unlink, Loader2 } from "lucide-react";

export function DisconnectButton() {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  const handleDisconnect = async () => {
    if (
      !confirm(
        "Are you sure you want to disconnect this Instagram account? Your comment-to-DM automations will stop responding until an account is reconnected."
      )
    ) {
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch("/api/instagram/disconnect", {
        method: "POST",
      });

      if (res.ok) {
        router.refresh();
        window.location.href = "/dashboard/settings";
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to disconnect account");
      }
    } catch {
      alert("Network error while disconnecting account");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleDisconnect}
      disabled={isPending}
      className="rounded-xl text-xs h-8 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
    >
      {isPending ? (
        <Loader2 className="size-3 animate-spin mr-1" />
      ) : (
        <Unlink className="size-3 mr-1" />
      )}
      Disconnect
    </Button>
  );
}
