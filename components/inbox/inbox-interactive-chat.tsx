"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import {
  Search,
  CheckCircle2,
  Send,
  Loader2,
  AlertCircle,
  MessageCircle,
  UserPlus,
  UserCheck,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface StoredMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderType: "contact" | "bot" | "agent";
  text: string;
  time: string;
  status?: string | null;
}

export interface ConversationItem {
  id: string;
  conversationId?: string;
  workspaceId: string;
  instagramAccountId?: string | null;
  recipientId: string;
  username: string;
  initials: string;
  lastMessage: string;
  time: string;
  keyword: string;
  keywordLabel?: string;
  status: string;
  isBotActive?: boolean | null;
  /** Present for real stored conversations; absent for legacy log-derived rows. */
  messages?: StoredMessage[];
}

interface MessageBubble {
  id: string;
  sender: "user" | "bot" | "manual";
  text: string;
  time: string;
  status?: string;
  kind?: "follow_prompt";
}

export function InboxInteractiveChat({
  conversations: initialConversations,
  timeZone = "Asia/Kolkata",
}: {
  conversations: ConversationItem[];
  timeZone?: string;
}) {
  const [conversations, setConversations] =
    useState<ConversationItem[]>(initialConversations);
  const [activeId, setActiveId] = useState<string>(
    initialConversations[0]?.id || ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [promptNotice, setPromptNotice] = useState<string | null>(null);
  const router = useRouter();

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
      const res = await fetch("/api/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeConv.workspaceId,
          conversationId: activeConv.conversationId,
          instagramAccountId: activeConv.instagramAccountId,
          recipientId: activeConv.recipientId,
          recipientUsername: activeConv.username,
          message: messageToSend,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setSendError(data.error || "Failed to deliver message via Meta API");
      } else {
        posthog.capture("inbox_reply_sent", {
          conversation_type: activeConv.messages ? "stored" : "legacy",
        });
        // Append new manual message to conversation stream
        const newMsg: MessageBubble = {
          id: `manual-${Date.now()}`,
          sender: "manual",
          text: messageToSend,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            timeZone,
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

  const handleSendFollowPrompt = async () => {
    if (!activeConv || isSendingPrompt || isSending) return;
    setIsSendingPrompt(true);
    setSendError(null);
    setPromptNotice(null);
    try {
      const res = await fetch("/api/inbox/follow-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeConv.workspaceId,
          conversationId: activeConv.conversationId,
          instagramAccountId: activeConv.instagramAccountId,
          recipientId: activeConv.recipientId,
          recipientUsername: activeConv.username,
          promisedContent: replyText.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSendError(data.error || "Could not send the follow prompt.");
        return;
      }
      if (data.status === "already_follower") {
        setPromptNotice(`@${activeConv.username} already follows you — no prompt needed.`);
        return;
      }
      posthog.capture("inbox_follow_prompt_sent", {
        prior_follower: data.priorFollower,
      });
      setPromptNotice("Follow prompt sent — content stays locked until they follow.");
      const bubble: MessageBubble = {
        id: `follow-${Date.now()}`,
        sender: "manual",
        text: data.openingText || "Follow the account, then tap below to unlock your content.",
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone,
        }),
        status: "Awaiting follow confirmation",
        kind: "follow_prompt",
      };
      setExtraMessages((prev) => ({
        ...prev,
        [activeConv.id]: [...(prev[activeConv.id] || []), bubble],
      }));
      setReplyText("");
    } catch {
      setSendError("Network error while sending the follow prompt.");
    } finally {
      setIsSendingPrompt(false);
    }
  };

  const handleToggleBot = async () => {
    if (!activeConv?.conversationId || isTogglingBot) return;
    const nextActive = !activeConv.isBotActive;
    setIsTogglingBot(true);
    setSendError(null);
    try {
      const res = await fetch("/api/inbox/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeConv.workspaceId,
          conversationId: activeConv.conversationId,
          active: nextActive,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSendError(data.error || "Could not change automation status.");
        return;
      }
      setConversations((prev) =>
        prev.map((item) =>
          item.id === activeConv.id ? { ...item, isBotActive: nextActive } : item
        )
      );
      posthog.capture("inbox_bot_toggled", { active: nextActive });
      setPromptNotice(
        nextActive
          ? "Automation resumed for this conversation."
          : "Automation paused — you have the conversation."
      );
    } catch {
      setSendError("Network error while changing automation status.");
    } finally {
      setIsTogglingBot(false);
    }
  };

  if (conversations.length === 0) {
    return (
      <Card
        role="status"
        className="rounded-2xl border border-dashed border-[#e0e2e8] dark:border-border/80 shadow-subtle p-10 text-center space-y-3"
      >
        <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] dark:bg-[#746019]/30 dark:text-[#ffd02f] flex items-center justify-center mx-auto">
          <MessageCircle className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-base text-foreground">No conversations yet</p>
          <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto">
            When someone comments a trigger keyword, their automated DM conversation appears here.
            Connect an Instagram account and create a campaign to get started.
          </p>
        </div>
        <Button asChild size="sm" className="rounded-full font-semibold text-xs mt-2 bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e] px-6 h-9">
          <Link href="/dashboard/campaigns/new">Create a campaign</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[560px]">
      {/* ── Left: Conversations List ── */}
      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle flex flex-col overflow-hidden bg-card">
        <div className="p-3.5 border-b border-[#e0e2e8] dark:border-border/60 space-y-2">
          <div className="relative">
            <Search className="size-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs rounded-full h-9 bg-[#f7f8fa] dark:bg-muted/40 border-[#e0e2e8] dark:border-border"
            />
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            aria-label="Refresh inbox"
            className="flex items-center gap-1 text-[10px] font-medium text-[#6b6f7e] hover:text-foreground transition-colors"
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Refresh
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#e0e2e8]/60 dark:divide-border/60">
          {filteredConversations.map((c) => {
            const isSelected = c.id === activeConv?.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveId(c.id);
                  setSendError(null);
                }}
                aria-pressed={isSelected}
                aria-label={`Conversation with @${c.username}, trigger: ${c.keyword}`}
                className={`w-full text-left p-3.5 flex items-start gap-3 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
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
              </button>
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
          <div className="flex flex-col items-end gap-1.5">
            <Badge
              variant="tag-yellow"
              className="text-[10px] font-semibold py-0.5 px-3 rounded-full"
            >
              {activeConv?.keywordLabel || "Trigger"}: {activeConv?.keyword}
            </Badge>
            {activeConv?.conversationId && (
              <button
                type="button"
                onClick={handleToggleBot}
                disabled={isTogglingBot}
                title={
                  activeConv.isBotActive === false
                    ? "Resume automated replies"
                    : "Pause automation while you handle this conversation"
                }
                className="text-[10px] font-medium text-[#4262ff] hover:underline disabled:opacity-50"
              >
                {activeConv.isBotActive === false
                  ? "Bot paused · resume automation"
                  : "Bot active · take over"}
              </button>
            )}
          </div>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4 text-xs">
          {activeConv?.messages ? (
            activeConv.messages.length > 0 ? (
              activeConv.messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.direction === "inbound" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-md rounded-2xl p-4 space-y-1.5 shadow-card ${
                      message.direction === "inbound"
                        ? "bg-[#f7f8fa] dark:bg-muted/60 text-foreground border border-[#e0e2e8] dark:border-border/60"
                        : "bg-[#1c1c1e] text-white dark:bg-white dark:text-[#1c1c1e]"
                    }`}
                  >
                    <p className="leading-relaxed font-sans whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                    <p
                      className={`text-[9px] text-right flex items-center justify-end gap-1 pt-1 ${
                        message.direction === "inbound"
                          ? "text-[#6b6f7e]"
                          : "text-neutral-400 dark:text-neutral-600"
                      }`}
                    >
                      {message.direction === "outbound" && (
                        <>
                          {message.status === "FAILED" ? (
                            <AlertCircle className="size-2.5 text-destructive inline" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="size-2.5 text-[#00b473] inline" aria-hidden="true" />
                          )}
                        </>
                      )}
                      {message.senderType === "agent" ? "Manual reply · " : message.senderType === "bot" ? "Auto · " : ""}
                      {message.time}
                      {message.status && message.status !== "SENT" && message.status !== "Delivered" && (
                        <span className="ml-1 text-[8px] uppercase font-semibold">
                          {message.status}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-[11px] text-muted-foreground">
                No messages in this thread yet.
              </p>
            )
          ) : (
            <>
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
            </>
          )}

          {/* Any manual replies sent in this session */}
          {currentExtra.map((msg) => (
            <div key={msg.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-200">
              <div className="max-w-md rounded-2xl bg-[#4262ff] text-white p-4 space-y-1.5 shadow-card">
                <p className="leading-relaxed font-sans">{msg.text}</p>
                {msg.kind === "follow_prompt" && (
                  <div className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-[#262626]">
                    <UserCheck className="size-3" aria-hidden="true" />
                    I&apos;m following ✅
                  </div>
                )}
                <div className="text-[9px] text-violet-200 text-right flex items-center justify-end gap-1.5 pt-1">
                  <Badge variant="outline" className="border-white/30 text-white text-[8px] py-0 px-1.5">
                    {msg.kind === "follow_prompt" ? "Follow gate · awaiting tap" : "Manual Reply"}
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

          {promptNotice && (
            <div
              role="status"
              className="p-3 rounded-xl border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2"
            >
              <UserCheck className="size-4 shrink-0" />
              <span>{promptNotice}</span>
            </div>
          )}
        </div>

        {/* Chat Reply Input Bar */}
        <div className="p-3.5 border-t border-[#e0e2e8] dark:border-border/60 flex items-center gap-2">
          <Input
            placeholder={`Reply to @${activeConv?.username}, or write content to unlock after a follow...`}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendReply();
              }
            }}
            disabled={isSending || isSendingPrompt}
            className="text-xs rounded-full h-9 bg-background border-[#c7cad5]"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleSendFollowPrompt}
            disabled={isSending || isSendingPrompt}
            title="Send an in-chat follow prompt — content stays locked until they follow"
            className="h-9 rounded-full px-3 text-[11px] font-semibold gap-1.5 shrink-0 border-[#c7cad5] dark:border-border"
          >
            {isSendingPrompt ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <UserPlus className="size-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Ask to follow</span>
          </Button>
          <Button
            size="icon"
            onClick={handleSendReply}
            disabled={!replyText.trim() || isSending || isSendingPrompt}
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
