/**
 * Core type definitions for Antigravity Quota & Context Monitor
 * Strict TypeScript - zero 'as any' allowed
 */

export interface ResetItem {
  model: string;
  resetInSeconds: number;
  resetTimeIso?: string;
  resetTimeFormatted?: string;
  countdownFormatted?: string;
}

export interface PoolItem {
  name: string;
  used: number;
  total: number;
  period: 'weekly' | 'monthly';
  resetTimeIso?: string;
  resetTimeFormatted?: string;
  countdownFormatted?: string;
}

export interface QuotaSnapshot {
  geminiRemainingPct: number;
  claudeRemainingPct: number;
  contextUsedPct: number;
  contextTokensTotal: number;
  contextTokensCached: number;
  contextTokensNew: number;
  resets: ResetItem[];
  pools: PoolItem[];

  // Extended weekly & telemetry fields
  geminiWeeklyRemainingPct?: number;
  geminiWeeklyResetIso?: string;
  geminiWeeklyResetFormatted?: string;
  geminiWeeklyCountdown?: string;
  geminiShortWindowLabel?: string;
  geminiLongWindowLabel?: string;

  claudeWeeklyRemainingPct?: number;
  claudeWeeklyResetIso?: string;
  claudeWeeklyResetFormatted?: string;
  claudeWeeklyCountdown?: string;
  claudeShortWindowLabel?: string;
  claudeLongWindowLabel?: string;

  cacheHitPct?: number;
  availablePromptCredits?: number;
  monthlyPromptCredits?: number;
  availableFlowCredits?: number;
  monthlyFlowCredits?: number;
  userTier?: string;
}

export interface ProcessInfo {
  pid: number;
  port: number;
  csrfToken: string;
  protocol: 'http' | 'https';
}

export interface RawBucketData {
  bucketId?: string;
  displayName?: string;
  description?: string;
  window?: string;
  remainingFraction?: number;
  resetTime?: string;
}

export interface RawQuotaGroup {
  displayName?: string;
  description?: string;
  buckets?: RawBucketData[];
}

export interface RawQuotaSummaryResponse {
  response?: {
    groups?: RawQuotaGroup[];
    description?: string;
  };
}

export interface RawPlanInfo {
  teamsTier?: string;
  planName?: string;
  monthlyPromptCredits?: number;
  monthlyFlowCredits?: number;
}

export interface RawPlanStatus {
  planInfo?: RawPlanInfo;
  availablePromptCredits?: number;
  availableFlowCredits?: number;
}

export interface RawClientModelConfig {
  label?: string;
  modelOrAlias?: {
    model?: string;
  };
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string;
  };
}

export interface RawUserStatusResponse {
  userStatus?: {
    name?: string;
    email?: string;
    planStatus?: RawPlanStatus;
    cascadeModelConfigData?: {
      clientModelConfigs?: RawClientModelConfig[];
    };
  };
}

export interface ContextMetrics {
  totalTokens: number;
  cachedTokens: number;
  newTokens: number;
  usedPct: number;
}

export interface ClientStatusUpdate {
  snapshot: QuotaSnapshot;
  timestamp: Date;
}
