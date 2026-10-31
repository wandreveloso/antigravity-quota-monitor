import {
  QuotaSnapshot,
  RawQuotaSummaryResponse,
  RawUserStatusResponse,
  ContextMetrics,
  RawQuotaGroup,
  RawBucketData,
  ResetItem,
  PoolItem,
} from './types';

export class MetricsNormalizer {
  /**
   * Formats ISO date into short local format: DD/MM HH:mm (e.g. 01/11 12:37)
   */
  public static formatLocalResetShort(isoDateString?: string): string {
    if (!isoDateString) return 'N/A';
    try {
      const d = new Date(isoDateString);
      if (isNaN(d.getTime())) return 'N/A';
      const day = d.getDate().toString().padStart(2, '0');
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const hours = d.getHours().toString().padStart(2, '0');
      const minutes = d.getMinutes().toString().padStart(2, '0');
      return `${day}/${month} ${hours}:${minutes}`;
    } catch {
      return 'N/A';
    }
  }

  /**
   * Formats ISO date into full readable format: Dom, 01/11/2026 às 12:37
   */
  public static formatLocalResetFull(isoDateString?: string): string {
    if (!isoDateString) return 'N/A';
    try {
      const d = new Date(isoDateString);
      if (isNaN(d.getTime())) return 'N/A';
      const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const weekday = weekdays[d.getDay()];
      const day = d.getDate().toString().padStart(2, '0');
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const year = d.getFullYear();
      const hours = d.getHours().toString().padStart(2, '0');
      const minutes = d.getMinutes().toString().padStart(2, '0');
      return `${weekday}, ${day}/${month}/${year} às ${hours}:${minutes}`;
    } catch {
      return 'N/A';
    }
  }

  /**
   * Formats remaining duration: e.g. "2d 19h", "3h 39m", or "Renovando agora"
   */
  public static formatDurationRemaining(isoDateString?: string): string {
    if (!isoDateString) return 'N/A';
    const diffMs = new Date(isoDateString).getTime() - Date.now();
    if (diffMs <= 0) return 'Renovando agora';

    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Normalizes raw API responses and context telemetry into strict QuotaSnapshot.
   */
  public static normalize(
    quotaSummary: RawQuotaSummaryResponse | null | undefined,
    userStatus: RawUserStatusResponse | null | undefined,
    contextMetrics: ContextMetrics
  ): QuotaSnapshot {
    const groups: RawQuotaGroup[] = quotaSummary?.response?.groups ?? [];
    const now = Date.now();

    // 1. Gemini Quota - Dynamically discover short and long buckets
    const geminiGroup = groups.find(g => (g.displayName || '').toLowerCase().includes('gemini'));
    const geminiBuckets = geminiGroup?.buckets ?? [];
    const geminiShort =
      geminiBuckets.find(b => b.window === '5h' || (b.bucketId || '').includes('5h')) ||
      geminiBuckets.find(b => b.window === 'daily' || b.window === 'day' || (b.bucketId || '').includes('daily')) ||
      geminiBuckets[0];
    const geminiLong =
      geminiBuckets.find(b => b.window === 'weekly' || (b.bucketId || '').includes('weekly')) ||
      geminiBuckets.find(b => b.window === 'monthly' || (b.bucketId || '').includes('monthly')) ||
      (geminiBuckets.length > 1 ? geminiBuckets[1] : undefined);

    const geminiFrac = geminiShort?.remainingFraction ?? geminiLong?.remainingFraction ?? 1.0;
    const geminiRemainingPct = Math.max(0, Math.min(100, Math.round(geminiFrac * 100)));

    const geminiWkFrac = geminiLong?.remainingFraction ?? 1.0;
    const geminiWeeklyRemainingPct = Math.max(0, Math.min(100, Math.round(geminiWkFrac * 100)));
    const geminiWeeklyResetIso = geminiLong?.resetTime;
    const geminiWeeklyResetFormatted = this.formatLocalResetShort(geminiLong?.resetTime);
    const geminiWeeklyCountdown = this.formatDurationRemaining(geminiLong?.resetTime);

    const geminiShortWindowLabel = geminiShort?.window ? (geminiShort.window === '5h' ? '5h' : geminiShort.window === 'daily' ? 'Diário' : geminiShort.window) : '5h';
    const geminiLongWindowLabel = geminiLong?.window ? (geminiLong.window === 'weekly' ? 'Wk' : geminiLong.window === 'monthly' ? 'Mês' : geminiLong.window) : 'Wk';

    // 2. Claude Quota - Dynamically discover short and long buckets
    const claudeGroup = groups.find(
      g => (g.displayName || '').toLowerCase().includes('claude') || (g.displayName || '').includes('3p')
    );
    const claudeBuckets = claudeGroup?.buckets ?? [];
    const claudeShort =
      claudeBuckets.find(b => b.window === '5h' || (b.bucketId || '').includes('5h')) ||
      claudeBuckets.find(b => b.window === 'daily' || b.window === 'day' || (b.bucketId || '').includes('daily')) ||
      claudeBuckets[0];
    const claudeLong =
      claudeBuckets.find(b => b.window === 'weekly' || (b.bucketId || '').includes('weekly')) ||
      claudeBuckets.find(b => b.window === 'monthly' || (b.bucketId || '').includes('monthly')) ||
      (claudeBuckets.length > 1 ? claudeBuckets[1] : undefined);

    const claudeFrac = claudeShort?.remainingFraction ?? claudeLong?.remainingFraction ?? 1.0;
    const claudeRemainingPct = Math.max(0, Math.min(100, Math.round(claudeFrac * 100)));

    const claudeWkFrac = claudeLong?.remainingFraction ?? 1.0;
    const claudeWeeklyRemainingPct = Math.max(0, Math.min(100, Math.round(claudeWkFrac * 100)));
    const claudeWeeklyResetIso = claudeLong?.resetTime;
    const claudeWeeklyResetFormatted = this.formatLocalResetShort(claudeLong?.resetTime);
    const claudeWeeklyCountdown = this.formatDurationRemaining(claudeLong?.resetTime);

    const claudeShortWindowLabel = claudeShort?.window ? (claudeShort.window === '5h' ? '5h' : claudeShort.window === 'daily' ? 'Diário' : claudeShort.window) : '5h';
    const claudeLongWindowLabel = claudeLong?.window ? (claudeLong.window === 'weekly' ? 'Wk' : claudeLong.window === 'monthly' ? 'Mês' : claudeLong.window) : 'Wk';

    // 3. Resets
    const resets: ResetItem[] = [];

    const addReset = (name: string, bucket: RawBucketData | undefined) => {
      if (bucket?.resetTime) {
        const resetMs = new Date(bucket.resetTime).getTime();
        const diffSec = Math.max(0, Math.floor((resetMs - now) / 1000));
        resets.push({
          model: name,
          resetInSeconds: diffSec,
          resetTimeIso: bucket.resetTime,
          resetTimeFormatted: this.formatLocalResetFull(bucket.resetTime),
          countdownFormatted: this.formatDurationRemaining(bucket.resetTime),
        });
      }
    };

    if (geminiShort) addReset(`Gemini (${geminiShortWindowLabel})`, geminiShort);
    if (geminiLong) addReset(`Gemini (${geminiLongWindowLabel})`, geminiLong);
    if (claudeShort) addReset(`Claude (${claudeShortWindowLabel})`, claudeShort);
    if (claudeLong) addReset(`Claude (${claudeLongWindowLabel})`, claudeLong);

    // Dynamic scan of all groups and buckets to capture any custom/tier-specific buckets
    for (const group of groups) {
      for (const bucket of group.buckets ?? []) {
        const bName = `${group.displayName || 'Modelo'} - ${bucket.displayName || bucket.window || 'Cota'}`;
        if (!resets.some(r => r.resetTimeIso === bucket.resetTime && r.model.includes(group.displayName || ''))) {
          addReset(bName, bucket);
        }
      }
    }

    // Also include individual model configs if present
    const modelConfigs = userStatus?.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? [];
    for (const cfg of modelConfigs) {
      if (cfg.label && cfg.quotaInfo?.resetTime) {
        const resetMs = new Date(cfg.quotaInfo.resetTime).getTime();
        const diffSec = Math.max(0, Math.floor((resetMs - now) / 1000));
        if (!resets.some(r => r.model === cfg.label)) {
          resets.push({
            model: cfg.label,
            resetInSeconds: diffSec,
            resetTimeIso: cfg.quotaInfo.resetTime,
            resetTimeFormatted: this.formatLocalResetFull(cfg.quotaInfo.resetTime),
            countdownFormatted: this.formatDurationRemaining(cfg.quotaInfo.resetTime),
          });
        }
      }
    }

    // 4. Pools
    const pools: PoolItem[] = [];

    // Long window (Weekly/Monthly) pools
    if (geminiLong) {
      const frac = geminiLong.remainingFraction ?? 1.0;
      const used = Math.max(0, Math.min(100, Math.round((1 - frac) * 100)));
      pools.push({
        name: `Gemini ${geminiLongWindowLabel} Quota`,
        used,
        total: 100,
        period: geminiLong.window === 'monthly' ? 'monthly' : 'weekly',
        resetTimeIso: geminiLong.resetTime,
        resetTimeFormatted: this.formatLocalResetFull(geminiLong.resetTime),
        countdownFormatted: this.formatDurationRemaining(geminiLong.resetTime),
      });
    }

    if (claudeLong) {
      const frac = claudeLong.remainingFraction ?? 1.0;
      const used = Math.max(0, Math.min(100, Math.round((1 - frac) * 100)));
      pools.push({
        name: `Claude ${claudeLongWindowLabel} Quota`,
        used,
        total: 100,
        period: claudeLong.window === 'monthly' ? 'monthly' : 'weekly',
        resetTimeIso: claudeLong.resetTime,
        resetTimeFormatted: this.formatLocalResetFull(claudeLong.resetTime),
        countdownFormatted: this.formatDurationRemaining(claudeLong.resetTime),
      });
    }

    // Monthly credits pools
    const planInfo = userStatus?.userStatus?.planStatus?.planInfo;
    const planStatus = userStatus?.userStatus?.planStatus;

    if (planInfo?.monthlyPromptCredits && planInfo.monthlyPromptCredits > 0) {
      const total = planInfo.monthlyPromptCredits;
      const avail = planStatus?.availablePromptCredits ?? total;
      const used = Math.max(0, total - avail);
      pools.push({
        name: 'Prompt Credits',
        used,
        total,
        period: 'monthly',
      });
    }

    if (planInfo?.monthlyFlowCredits && planInfo.monthlyFlowCredits > 0) {
      const total = planInfo.monthlyFlowCredits;
      const avail = planStatus?.availableFlowCredits ?? total;
      const used = Math.max(0, total - avail);
      pools.push({
        name: 'Flow Credits',
        used,
        total,
        period: 'monthly',
      });
    }

    const cacheHitPct =
      contextMetrics.totalTokens > 0
        ? Math.round((contextMetrics.cachedTokens / contextMetrics.totalTokens) * 100)
        : 0;

    return {
      geminiRemainingPct,
      claudeRemainingPct,
      contextUsedPct: contextMetrics.usedPct,
      contextTokensTotal: contextMetrics.totalTokens,
      contextTokensCached: contextMetrics.cachedTokens,
      contextTokensNew: contextMetrics.newTokens,
      resets,
      pools,

      geminiWeeklyRemainingPct,
      geminiWeeklyResetIso,
      geminiWeeklyResetFormatted,
      geminiWeeklyCountdown,
      geminiShortWindowLabel,
      geminiLongWindowLabel,

      claudeWeeklyRemainingPct,
      claudeWeeklyResetIso,
      claudeWeeklyResetFormatted,
      claudeWeeklyCountdown,
      claudeShortWindowLabel,
      claudeLongWindowLabel,

      cacheHitPct,
      availablePromptCredits: planStatus?.availablePromptCredits,
      monthlyPromptCredits: planInfo?.monthlyPromptCredits,
      availableFlowCredits: planStatus?.availableFlowCredits,
      monthlyFlowCredits: planInfo?.monthlyFlowCredits,
      userTier: planInfo?.planName || planInfo?.teamsTier,
    };
  }
}
