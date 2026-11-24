"use client";

import { useState } from "react";
import {
  Search,
  CheckCircle2,
  Send,
  Loader2,
  AlertCircle,
  Inbox,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface ConversationItem {
  id: string;
  recipientId: string;
  username: string;
  initials: string;
  lastMessage: string;
  time: string;
  keyword: string;
  status: string;
}

interface MessageBubble {
  id: string;
  sender: "user" | "bot" | "manual";
  text: string;
  time: string;
  status?: string;
}

export function InboxInteractiveChat({
  conversations: initialConversations,
}: {
  conversations: ConversationItem[];
}) {
  const [conversations] = useState<ConversationItem[]>(initialConversations);
  const [activeId, setActiveId] = useState<string>(
    initialConversations[0]?.id || ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Per-conversation extra sent messages
  const [extraMessages, setExtraMessages] = useState<
    Record<string, MessageBubble[]>
  >({});

  const filteredConversations = conversations.filter(
    (c) =>
      c.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.keyword.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeConv =
    conversations.find((c) => c.id === activeId) || conversations[0] || null;

  const currentExtra = activeConv ? extraMessages[activeConv.id] || [] : [];

  const handleSendReply = async () => {
    if (!replyText.trim() || !activeConv || isSending) return;

    const messageToSend = replyText.trim();
    setIsSending(true);
    setSendError(null);

    try {
      const res = await fetch("/api/instagram/send-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId: activeConv.recipientId,
          recipientUsername: activeConv.username,
          message: messageToSend,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setSendError(data.error || "Failed to deliver message via Meta API");
      } else {
        // Append new manual message to conversation stream
        const newMsg: MessageBubble = {
          id: `manual-${Date.now()}`,
          sender: "manual",
          text: messageToSend,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          status: "Delivered",
        };

        setExtraMessages((prev) => ({
          ...prev,
          [activeConv.id]: [...(prev[activeConv.id] || []), newMsg],
        }));

        setReplyText("");
      }
    } catch {
      setSendError("Network error while connecting to Meta Graph API");
    } finally {
      setIsSending(false);
    }
  };

  if (conversations.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[560px]">
      {/* ── Left: Conversations List ── */}
      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle flex flex-col overflow-hidden bg-card">
        <div className="p-3.5 border-b border-[#e0e2e8] dark:border-border/60">
          <div className="relative">
            <Search className="size-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs rounded-full h-9 bg-[#f7f8fa] dark:bg-muted/40 border-[#e0e2e8] dark:border-border"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#e0e2e8]/60 dark:divide-border/60">
          {filteredConversations.map((c) => {
            const isSelected = c.id === activeConv?.id;
            return (
              <div
                key={c.id}
                onClick={() => {
                  setActiveId(c.id);
                  setSendError(null);
                }}
                className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-[#fff8e0]/70 dark:bg-[#746019]/25 border-l-4 border-l-[#ffd02f]"
                    : "hover:bg-[#f7f8fa] dark:hover:bg-muted/30"
                }`}
              >
                <Avatar className="size-9 rounded-full shrink-0 border border-[#e0e2e8]">
                  <AvatarFallback className="text-[10px] font-bold bg-[#ffd02f] text-[#1c1c1e]">
                    {c.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground truncate">
                      @{c.username}
                    </span>
                    <span className="text-[10px] text-[#6b6f7e]">{c.time}</span>
                  </div>
                  <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground truncate mt-0.5">
                    kw:{" "}
                    <span className="font-semibold text-[#1c1c1e] dark:text-foreground px-1.5 py-0.2 rounded-full bg-[#fde0f0] text-[#7d2663]">
                      {c.keyword}
                    </span>
                  </p>
                  <p className="text-xs text-foreground truncate mt-1">
                    {c.lastMessage}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Right: Active Chat View with Live Reply ── */}
      <Card className="lg:col-span-2 rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle flex flex-col justify-between overflow-hidden bg-card">
        {/* Chat Header */}
        <div className="p-4 border-b border-[#e0e2e8] dark:border-border/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="size-9 rounded-full border border-[#e0e2e8]">
              <AvatarFallback className="text-[10px] font-bold bg-[#ffd02f] text-[#1c1c1e]">
                {activeConv?.initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-xs sm:text-sm text-foreground">
                @{activeConv?.username}
              </p>
              <p className="text-[10px] text-[#6b6f7e]">
                Meta Graph API &bull; Webhook Verified
              </p>
            </div>
          </div>
          <Badge
            variant="tag-yellow"
            className="text-[10px] font-semibold py-0.5 px-3 rounded-full"
          >
            Trigger: {activeConv?.keyword}
          </Badge>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4 text-xs">
          <div className="text-center">
            <span className="px-3 py-1 rounded-full bg-[#f7f8fa] dark:bg-muted/60 text-[10px] font-medium text-[#6b6f7e] border border-[#e0e2e8] dark:border-border/60">
              User commented &ldquo;{activeConv?.keyword}&rdquo; &bull; Auto-DM dispatched
            </span>
          </div>

          {/* Outgoing automated message */}
          <div className="flex justify-end">
            <div className="max-w-md rounded-2xl bg-[#1c1c1e] text-white p-4 space-y-1.5 shadow-card dark:bg-white dark:text-[#1c1c1e]">
              <p className="leading-relaxed font-sans">{activeConv?.lastMessage}</p>
              <p className="text-[9px] text-neutral-400 dark:text-neutral-600 text-right flex items-center justify-end gap-1 pt-1">
                <CheckCircle2 className="size-2.5 text-[#00b473] inline" /> {activeConv?.time}
              </p>
            </div>
          </div>

          {/* Any manual replies sent in this session */}
          {currentExtra.map((msg) => (
            <div key={msg.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-200">
              <div className="max-w-md rounded-2xl bg-[#4262ff] text-white p-4 space-y-1.5 shadow-card">
                <p className="leading-relaxed font-sans">{msg.text}</p>
                <div className="text-[9px] text-violet-200 text-right flex items-center justify-end gap-1.5 pt-1">
                  <Badge variant="outline" className="border-white/30 text-white text-[8px] py-0 px-1.5">
                    Manual Reply
                  </Badge>
                  <CheckCircle2 className="size-2.5 text-emerald-300 inline" /> {msg.time}
                </div>
              </div>
            </div>
          ))}

          {sendError && (
            <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>{sendError}</span>
            </div>
          )}
        </div>

        {/* Chat Reply Input Bar */}
        <div className="p-3.5 border-t border-[#e0e2e8] dark:border-border/60 flex items-center gap-2">
          <Input
            placeholder={`Type a manual reply to @${activeConv?.username}...`}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendReply();
              }
            }}
            disabled={isSending}
            className="text-xs rounded-full h-9 bg-background border-[#c7cad5]"
          />
          <Button
            size="icon"
            onClick={handleSendReply}
            disabled={!replyText.trim() || isSending}
            className="size-9 rounded-full shrink-0 bg-[#1c1c1e] hover:bg-[#2c2c34] text-white dark:bg-white dark:text-[#1c1c1e]"
          >
            {isSending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
