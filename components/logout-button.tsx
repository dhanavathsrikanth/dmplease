"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      window.location.href = "/auth/login";
    } else {
      router.push("/auth/login");
      router.refresh();
    }
  };

  return <Button onClick={logout}>Logout</Button>;
}
