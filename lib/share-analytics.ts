/**
 * T1.9: Share-to-DM analytics.
 *
 * Pure helpers that turn persisted share events, share-triggered DM logs and
 * link clicks into the numbers a creator actually cares about: how many shares
 * arrived, how many became DMs, and which shared media performed best.
 */

export interface ShareEventRow {
  sender_id: string;
  media_id: string | null;
  title: string | null;
  received_at: string;
}

export interface ShareDmRow {
  recipient_id: string;
  status: string | null;
  post_id: string | null;
  trigger_keyword: string | null;
  keyword: string | null;
}

export interface ShareClickRow {
  post_id: string | null;
  contact_id: string | null;
  is_bot: boolean | null;
}

export interface ShareMediaStat {
  mediaId: string;
  title: string | null;
  shares: number;
  dms: number;
  clicks: number;
}

export interface ShareSummary {
  sharesReceived: number;
  uniqueSharers: number;
  dmsSent: number;
  dmsFailed: number;
  skipped: number;
  shareToDmRate: number | null;
  clicks: number;
  topMedia: ShareMediaStat[];
}

function isShareDm(row: ShareDmRow): boolean {
  return row.trigger_keyword === "SHARE" || row.keyword === "SHARE";
}

export function summarizeShares(input: {
  events: ShareEventRow[];
  dms: ShareDmRow[];
  clicks: ShareClickRow[];
}): ShareSummary {
  const { events, dms, clicks } = input;

  const sharesReceived = events.length;
  const uniqueSharers = new Set(events.map((event) => event.sender_id)).size;

  const shareDms = dms.filter(isShareDm);
  const dmsSent = shareDms.filter((row) => row.status === "SENT").length;
  const dmsFailed = shareDms.filter((row) => row.status === "FAILED").length;
  const skipped = Math.max(0, sharesReceived - dmsSent - dmsFailed);

  const humanClicks = clicks.filter((row) => !row.is_bot);
  const clicksTotal = humanClicks.length;

  const media = new Map<string, ShareMediaStat>();
  const ensure = (mediaId: string | null, title: string | null = null) => {
    const key = mediaId || "unknown";
    const existing =
      media.get(key) ??
      ({
        mediaId: key,
        title,
        shares: 0,
        dms: 0,
        clicks: 0,
      } satisfies ShareMediaStat);
    if (!existing.title && title) existing.title = title;
    media.set(key, existing);
    return existing;
  };

  for (const event of events) {
    ensure(event.media_id, event.title).shares++;
  }
  for (const row of shareDms) {
    if (row.status !== "SENT") continue;
    ensure(row.post_id).dms++;
  }
  for (const click of humanClicks) {
    ensure(click.post_id).clicks++;
  }

  const topMedia = [...media.values()]
    .filter((item) => item.shares > 0 || item.dms > 0 || item.clicks > 0)
    .sort((a, b) => b.shares - a.shares || b.dms - a.dms || b.clicks - a.clicks)
    .slice(0, 5);

  return {
    sharesReceived,
    uniqueSharers,
    dmsSent,
    dmsFailed,
    skipped,
    shareToDmRate:
      sharesReceived > 0 ? Math.round((dmsSent / sharesReceived) * 100) : null,
    clicks: clicksTotal,
    topMedia,
  };
}
