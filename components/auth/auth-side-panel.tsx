"use client";

import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { Star } from "lucide-react";

interface AuthSidePanelProps {
  quote?: string;
  authorName?: string;
  authorRole?: string;
  bannerText?: string;
}

export function AuthSidePanel({
  quote = "dmplease works so well that we were able to automate our Comment-to-DM workflow in just a few hours! Bye bye expensive manychat!",
  authorName = "Anish Biswas",
  authorRole = "Founder @AuraDevs",
  bannerText = "Loved by 150+ creators and brands worldwide!",
}: AuthSidePanelProps) {
  return (
    <div className="hidden lg:flex flex-1 items-center justify-center p-10 bg-lime-50/70 dark:bg-black/40 border-l border-border relative overflow-hidden">
      <FlickeringGrid
        className="absolute inset-0 z-0 pointer-events-none opacity-80"
        squareSize={2}
        gridGap={6}
        color="#83BE3C"
        maxOpacity={0.6}
        flickerChance={0.15}
      />
      <div className="w-full max-w-md relative z-10">
        {/* 5 Stars */}
        <div className="flex items-center gap-1.5 mb-6">
          {[...Array(5)].map((_, i) => (
            <Star
              key={i}
              className="w-6 h-6 text-yellow-400 fill-yellow-400 transition-transform duration-300 hover:scale-125"
            />
          ))}
        </div>

        {/* Quote */}
        <blockquote className="text-xl md:text-2xl font-medium leading-snug tracking-tight text-foreground">
          &ldquo;{quote}&rdquo;
        </blockquote>

        {/* Author */}
        <div className="mt-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-tr from-yellow-400 to-rose-500 shadow-sm ring-1 ring-border" />
          <div>
            <p className="text-sm font-semibold text-foreground">{authorName}</p>
            <p className="text-xs font-normal text-muted-foreground">{authorRole}</p>
          </div>
        </div>

        {/* Social Proof Banner */}
        <div className="mt-14 px-2 italic text-lg font-bold tracking-tight text-muted-foreground/90">
          {bannerText}
        </div>
      </div>
    </div>
  );
}
