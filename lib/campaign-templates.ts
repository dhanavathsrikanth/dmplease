export type CampaignTemplateAccent =
  | "brand"
  | "success"
  | "rose"
  | "coral"
  | "info";

export type CampaignTemplateIcon =
  | "sparkles"
  | "message"
  | "zap"
  | "bot"
  | "inbox"
  | "story"
  | "flow"
  | "users"
  | "mail"
  | "trending"
  | "book"
  | "calendar"
  | "plus";

export interface CampaignTemplateDefaults {
  name: string;
  triggerKeywords: string[];
  dmMessage: string;
  buttonText?: string;
  buttonUrl?: string;
  followGateEnabled?: boolean;
  publicReplyEnabled?: boolean;
  collectField?: string;
}

export interface CampaignTemplate {
  id: string;
  title: string;
  description: string;
  badge?: string;
  icon: CampaignTemplateIcon;
  href: string;
  accent: CampaignTemplateAccent;
  /** Only comment-to-DM templates pre-fill the campaign builder. */
  defaults?: CampaignTemplateDefaults;
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "followers",
    title: "Grow followers",
    description:
      "Ask people to follow before you deliver the link — our follow gate verifies it automatically.",
    badge: "Follow gate",
    icon: "users",
    href: "/dashboard/campaigns/new?template=followers",
    accent: "brand",
    defaults: {
      name: "Grow followers",
      triggerKeywords: ["FOLLOW"],
      dmMessage:
        "Hey {username}! Follow me and I'll send the link right away. 💛",
      buttonText: "Get the link",
      buttonUrl: "https://dmplease.vercel.app/guide",
      followGateEnabled: true,
      publicReplyEnabled: true,
      collectField: "none",
    },
  },
  {
    id: "leads",
    title: "Capture leads",
    description:
      "Collect an email or phone number after the DM and save it straight to Contacts.",
    badge: "Lead capture",
    icon: "mail",
    href: "/dashboard/campaigns/new?template=leads",
    accent: "success",
    defaults: {
      name: "Capture leads",
      triggerKeywords: ["GUIDE"],
      dmMessage:
        "Hey {username}! Here's your guide: {link}. What's the best email to send more?",
      buttonText: "Download guide",
      buttonUrl: "https://dmplease.vercel.app/guide",
      followGateEnabled: false,
      publicReplyEnabled: true,
      collectField: "email",
    },
  },
  {
    id: "revenue",
    title: "Drive revenue",
    description:
      "Send a tracked link and attribute every purchase back to the keyword that started it.",
    badge: "Revenue",
    icon: "trending",
    href: "/dashboard/campaigns/new?template=revenue",
    accent: "coral",
    defaults: {
      name: "Drive revenue",
      triggerKeywords: ["SHOP"],
      dmMessage:
        "Hey {username}! Here's your VIP shop link: {link}. Every purchase is tracked automatically.",
      buttonText: "Shop now",
      buttonUrl: "https://dmplease.vercel.app/guide",
      followGateEnabled: false,
      publicReplyEnabled: true,
      collectField: "none",
    },
  },
  {
    id: "freebie",
    title: "Send a freebie",
    description:
      "Deliver a guide, PDF or lead magnet instantly when someone comments.",
    badge: "Instant",
    icon: "book",
    href: "/dashboard/campaigns/new?template=freebie",
    accent: "info",
    defaults: {
      name: "Send a freebie",
      triggerKeywords: ["GUIDE"],
      dmMessage:
        "Hey {username}! Here is your free training guide: {link}. Enjoy! 🙌",
      buttonText: "Download Guide 📖",
      buttonUrl: "https://dmplease.vercel.app/guide",
      followGateEnabled: false,
      publicReplyEnabled: true,
      collectField: "none",
    },
  },
  {
    id: "booking",
    title: "Book a call",
    description: "Turn comments into calendar bookings with a tracked link.",
    badge: "Calendar",
    icon: "calendar",
    href: "/dashboard/campaigns/new?template=booking",
    accent: "rose",
    defaults: {
      name: "Book a call",
      triggerKeywords: ["CALL"],
      dmMessage:
        "Would love to chat with you {username}! Pick a time on my calendar here: {link} 📅",
      buttonText: "Book Discovery Call 📅",
      buttonUrl: "https://dmplease.vercel.app/guide",
      followGateEnabled: false,
      publicReplyEnabled: true,
      collectField: "none",
    },
  },
  {
    id: "blank",
    title: "Build from scratch",
    description: "Start blank and choose every detail yourself.",
    badge: "Blank",
    icon: "plus",
    href: "/dashboard/campaigns/new",
    accent: "info",
  },
];

export function getCampaignTemplate(
  id: string | undefined
): CampaignTemplate | undefined {
  if (!id) return undefined;
  return CAMPAIGN_TEMPLATES.find((template) => template.id === id);
}
