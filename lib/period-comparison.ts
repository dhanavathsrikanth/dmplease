/**
 * Previous-period comparison helpers.
 *
 * Counts and revenue use percent change; rates use percentage-point change.
 * Pure functions so the maths is testable and the UI can stay dumb.
 */

export type ComparisonDirection = "up" | "down" | "flat";

export interface MetricComparison {
  current: number;
  previous: number;
  /** Percent change for counts/revenue. Null when the previous value is 0. */
  deltaPercent: number | null;
  /** Percentage-point change for rates. Null when either side is null. */
  deltaPoints: number | null;
  direction: ComparisonDirection;
}

export function compareCount(current: number, previous: number): MetricComparison {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safePrevious = Number.isFinite(previous) ? previous : 0;
  const deltaPercent =
    safePrevious > 0
      ? ((safeCurrent - safePrevious) / safePrevious) * 100
      : null;
  return {
    current: safeCurrent,
    previous: safePrevious,
    deltaPercent,
    deltaPoints: null,
    direction:
      safeCurrent > safePrevious
        ? "up"
        : safeCurrent < safePrevious
          ? "down"
          : "flat",
  };
}

export function compareRate(
  current: number | null,
  previous: number | null
): MetricComparison {
  const deltaPoints =
    current !== null && previous !== null ? current - previous : null;
  return {
    current: current ?? 0,
    previous: previous ?? 0,
    deltaPercent: null,
    deltaPoints,
    direction:
      deltaPoints === null || deltaPoints === 0
        ? "flat"
        : deltaPoints > 0
          ? "up"
          : "down",
  };
}

export interface CampaignComparison {
  dmSent: MetricComparison;
  dmFailed: MetricComparison;
  deliveryRate: MetricComparison;
  readRate: MetricComparison;
  linkClicks: MetricComparison;
  uniqueClickers: MetricComparison;
  conversions: MetricComparison;
  revenueMinor: MetricComparison;
  commentsReceived: MetricComparison;
  matchedComments: MetricComparison;
  commentDmsSent: MetricComparison;
  commentClicks: MetricComparison;
  commentConversions: MetricComparison;
  commentRevenueMinor: MetricComparison;
  commentToDmRate: MetricComparison;
  averageOrderValueMinor: MetricComparison;
  revenuePerDmMinor: MetricComparison;
  clickToConversionRate: MetricComparison;
  sharesReceived: MetricComparison;
  shareDmsSent: MetricComparison;
  shareClicks: MetricComparison;
  shareToDmRate: MetricComparison;
  leadsCaptured: MetricComparison;
  leadCaptureRate: MetricComparison;
}

export interface ComparisonInput {
  dmSent: number;
  dmFailed: number;
  deliveryRate: number | null;
  readRate: number | null;
  linkClicks: number;
  uniqueClickers: number;
  conversions: number;
  revenueMinor: number;
  leadsCaptured: number;
  leadCaptureRate: number | null;
  comment: {
    commentsReceived: number;
    matchedComments: number;
    dmsSent: number;
    clicks: number;
    conversions: number;
    revenueMinor: number;
    commentToDmRate: number | null;
    averageOrderValueMinor: number | null;
    revenuePerDmMinor: number | null;
    clickToConversionRate: number | null;
  };
  share: {
    sharesReceived: number;
    dmsSent: number;
    clicks: number;
    shareToDmRate: number | null;
  };
}

export function buildCampaignComparison(
  current: ComparisonInput,
  previous: ComparisonInput
): CampaignComparison {
  return {
    dmSent: compareCount(current.dmSent, previous.dmSent),
    dmFailed: compareCount(current.dmFailed, previous.dmFailed),
    deliveryRate: compareRate(current.deliveryRate, previous.deliveryRate),
    readRate: compareRate(current.readRate, previous.readRate),
    linkClicks: compareCount(current.linkClicks, previous.linkClicks),
    uniqueClickers: compareCount(current.uniqueClickers, previous.uniqueClickers),
    conversions: compareCount(current.conversions, previous.conversions),
    revenueMinor: compareCount(current.revenueMinor, previous.revenueMinor),
    commentsReceived: compareCount(
      current.comment.commentsReceived,
      previous.comment.commentsReceived
    ),
    matchedComments: compareCount(
      current.comment.matchedComments,
      previous.comment.matchedComments
    ),
    commentDmsSent: compareCount(
      current.comment.dmsSent,
      previous.comment.dmsSent
    ),
    commentClicks: compareCount(current.comment.clicks, previous.comment.clicks),
    commentConversions: compareCount(
      current.comment.conversions,
      previous.comment.conversions
    ),
    commentRevenueMinor: compareCount(
      current.comment.revenueMinor,
      previous.comment.revenueMinor
    ),
    commentToDmRate: compareRate(
      current.comment.commentToDmRate,
      previous.comment.commentToDmRate
    ),
    averageOrderValueMinor: compareCount(
      current.comment.averageOrderValueMinor ?? 0,
      previous.comment.averageOrderValueMinor ?? 0
    ),
    revenuePerDmMinor: compareCount(
      current.comment.revenuePerDmMinor ?? 0,
      previous.comment.revenuePerDmMinor ?? 0
    ),
    clickToConversionRate: compareRate(
      current.comment.clickToConversionRate,
      previous.comment.clickToConversionRate
    ),
    sharesReceived: compareCount(
      current.share.sharesReceived,
      previous.share.sharesReceived
    ),
    shareDmsSent: compareCount(current.share.dmsSent, previous.share.dmsSent),
    shareClicks: compareCount(current.share.clicks, previous.share.clicks),
    shareToDmRate: compareRate(
      current.share.shareToDmRate,
      previous.share.shareToDmRate
    ),
    leadsCaptured: compareCount(current.leadsCaptured, previous.leadsCaptured),
    leadCaptureRate: compareRate(
      current.leadCaptureRate,
      previous.leadCaptureRate
    ),
  };
}
