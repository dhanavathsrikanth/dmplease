"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function PostHogAuth() {
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (
      !process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
      !process.env.NEXT_PUBLIC_POSTHOG_HOST
    ) {
      return;
    }

    const supabase = createClient();

    const identifyCurrentUser = (user: User) => {
      if (identifiedUserId.current === user.id) {
        return;
      }

      if (identifiedUserId.current) {
        posthog.reset();
      }

      posthog.identify(user.id, user.email ? { email: user.email } : undefined);
      identifiedUserId.current = user.id;
    };

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        identifyCurrentUser(user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        if (identifiedUserId.current) {
          posthog.reset();
          identifiedUserId.current = null;
        }
        return;
      }

      if (event === "SIGNED_IN" && session?.user) {
        identifyCurrentUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}

const ThemeSwitcher = () => {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const ICON_SIZE = 16;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={"sm"} aria-label={`Theme: ${theme || "system"}. Change theme`}>
          {theme === "light" ? (
            <Sun
              key="light"
              size={ICON_SIZE}
              className={"text-muted-foreground"}
            />
          ) : theme === "dark" ? (
            <Moon
              key="dark"
              size={ICON_SIZE}
              className={"text-muted-foreground"}
            />
          ) : (
            <Laptop
              key="system"
              size={ICON_SIZE}
              className={"text-muted-foreground"}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-content" align="start">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(e) => setTheme(e)}
        >
          <DropdownMenuRadioItem className="flex gap-2" value="light">
            <Sun size={ICON_SIZE} className="text-muted-foreground" />{" "}
            <span>Light</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem className="flex gap-2" value="dark">
            <Moon size={ICON_SIZE} className="text-muted-foreground" />{" "}
            <span>Dark</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem className="flex gap-2" value="system">
            <Laptop size={ICON_SIZE} className="text-muted-foreground" />{" "}
            <span>System</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { ThemeSwitcher };
