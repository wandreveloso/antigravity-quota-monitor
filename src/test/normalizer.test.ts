import * as assert from 'assert';
import { describe, it } from 'node:test';
import { MetricsNormalizer } from '../services/metrics-normalizer';
import {
  RawQuotaSummaryResponse,
  RawUserStatusResponse,
  ContextMetrics,
  QuotaSnapshot,
} from '../services/types';

describe('MetricsNormalizer Unit Tests', () => {
  it('should normalize standard Antigravity response correctly', () => {
    const rawQuota: RawQuotaSummaryResponse = {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              {
                bucketId: 'gemini-5h',
                window: '5h',
                remainingFraction: 0.84,
                resetTime: new Date(Date.now() + 3600 * 1000).toISOString(),
              },
              {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                remainingFraction: 0.75,
                resetTime: new Date(Date.now() + 86400 * 1000).toISOString(),
              },
            ],
          },
          {
            displayName: 'Claude and GPT models',
            buckets: [
              {
                bucketId: '3p-5h',
                window: '5h',
                remainingFraction: 0.60,
                resetTime: new Date(Date.now() + 7200 * 1000).toISOString(),
              },
              {
                bucketId: '3p-weekly',
                window: 'weekly',
                remainingFraction: 0.90,
                resetTime: new Date(Date.now() + 172800 * 1000).toISOString(),
              },
            ],
          },
        ],
      },
    };

    const rawUserStatus: RawUserStatusResponse = {
      userStatus: {
        name: 'Test User',
        email: 'test@example.com',
        planStatus: {
          planInfo: {
            teamsTier: 'TEAMS_TIER_PRO',
            planName: 'Pro',
            monthlyPromptCredits: 50000,
            monthlyFlowCredits: 150000,
          },
          availablePromptCredits: 35000,
          availableFlowCredits: 120000,
        },
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: 'Gemini 4 Argon',
              quotaInfo: {
                remainingFraction: 1.0,
                resetTime: new Date(Date.now() + 50000 * 1000).toISOString(),
              },
            },
          ],
        },
      },
    };

    const contextMetrics: ContextMetrics = {
      totalTokens: 85000,
      cachedTokens: 80000,
      newTokens: 5000,
      usedPct: 8,
    };

    const snapshot: QuotaSnapshot = MetricsNormalizer.normalize(rawQuota, rawUserStatus, contextMetrics);

    assert.strictEqual(snapshot.geminiRemainingPct, 84);
    assert.strictEqual(snapshot.claudeRemainingPct, 60);
    assert.strictEqual(snapshot.contextUsedPct, 8);
    assert.strictEqual(snapshot.contextTokensTotal, 85000);
    assert.strictEqual(snapshot.contextTokensCached, 80000);
    assert.strictEqual(snapshot.contextTokensNew, 5000);

    // Extended Weekly checks
    assert.strictEqual(snapshot.geminiWeeklyRemainingPct, 75);
    assert.ok(snapshot.geminiWeeklyResetFormatted);
    assert.match(snapshot.geminiWeeklyResetFormatted, /\d{2}\/\d{2} \d{2}:\d{2}/);
    assert.ok(snapshot.geminiWeeklyCountdown);

    assert.strictEqual(snapshot.claudeWeeklyRemainingPct, 90);
    assert.ok(snapshot.claudeWeeklyResetFormatted);

    // Cache hit check
    assert.strictEqual(snapshot.cacheHitPct, 94);
    assert.strictEqual(snapshot.availablePromptCredits, 35000);

    // Resets check
    assert.ok(snapshot.resets.length >= 4);
    const gemini5hReset = snapshot.resets.find(r => r.model === 'Gemini (5h)');
    assert.ok(gemini5hReset);
    assert.ok(gemini5hReset.resetInSeconds > 0 && gemini5hReset.resetInSeconds <= 3600);
    assert.ok(gemini5hReset.resetTimeFormatted);

    // Pools check
    assert.ok(snapshot.pools.length >= 4);
    const promptPool = snapshot.pools.find(p => p.name === 'Prompt Credits');
    assert.ok(promptPool);
    assert.strictEqual(promptPool.total, 50000);
    assert.strictEqual(promptPool.used, 15000);
    assert.strictEqual(promptPool.period, 'monthly');

    const geminiWeeklyPool = snapshot.pools.find(p => p.name === 'Gemini Weekly Quota');
    assert.ok(geminiWeeklyPool);
    assert.strictEqual(geminiWeeklyPool.used, 25);
    assert.strictEqual(geminiWeeklyPool.total, 100);
    assert.strictEqual(geminiWeeklyPool.period, 'weekly');
    assert.ok(geminiWeeklyPool.resetTimeFormatted);
  });

  it('should handle empty or null responses gracefully', () => {
    const emptyContext: ContextMetrics = {
      totalTokens: 0,
      cachedTokens: 0,
      newTokens: 0,
      usedPct: 0,
    };

    const snapshot = MetricsNormalizer.normalize(null, null, emptyContext);

    assert.strictEqual(snapshot.geminiRemainingPct, 100);
    assert.strictEqual(snapshot.claudeRemainingPct, 100);
    assert.strictEqual(snapshot.contextUsedPct, 0);
    assert.strictEqual(snapshot.contextTokensTotal, 0);
    assert.strictEqual(snapshot.contextTokensCached, 0);
    assert.strictEqual(snapshot.contextTokensNew, 0);
    assert.strictEqual(snapshot.cacheHitPct, 0);
    assert.deepStrictEqual(snapshot.resets, []);
    assert.deepStrictEqual(snapshot.pools, []);
  });

  it('should handle exhausted quotas and boundary fractions correctly', () => {
    const exhaustedQuota: RawQuotaSummaryResponse = {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              {
                bucketId: 'gemini-5h',
                window: '5h',
                remainingFraction: 0,
                resetTime: new Date(Date.now() + 1800 * 1000).toISOString(),
              },
            ],
          },
          {
            displayName: 'Claude Models',
            buckets: [
              {
                bucketId: 'claude-5h',
                window: '5h',
                remainingFraction: -0.1, // anomalous negative fraction
              },
            ],
          },
        ],
      },
    };

    const context: ContextMetrics = {
      totalTokens: 1200000,
      cachedTokens: 1000000,
      newTokens: 200000,
      usedPct: 100,
    };

    const snapshot = MetricsNormalizer.normalize(exhaustedQuota, null, context);

    assert.strictEqual(snapshot.geminiRemainingPct, 0);
    assert.strictEqual(snapshot.claudeRemainingPct, 0); // clamped to 0
    assert.strictEqual(snapshot.contextUsedPct, 100);
    assert.strictEqual(snapshot.cacheHitPct, 83);
  });

  it('should normalize modern Antigravity 2.0 with Gemini 4 Argon, Hydrogen and Claude 5.5', () => {
    const rawQuota: RawQuotaSummaryResponse = {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            description: 'Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash',
            buckets: [
              {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                remainingFraction: 0.95,
                resetTime: new Date(Date.now() + 600000 * 1000).toISOString(),
              },
              {
                bucketId: 'gemini-5h',
                window: '5h',
                remainingFraction: 0.88,
                resetTime: new Date(Date.now() + 18000 * 1000).toISOString(),
              },
            ],
          },
          {
            displayName: 'Claude and GPT models',
            description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
            buckets: [
              {
                bucketId: '3p-weekly',
                window: 'weekly',
                remainingFraction: 1.0,
                resetTime: new Date(Date.now() + 600000 * 1000).toISOString(),
              },
              {
                bucketId: '3p-5h',
                window: '5h',
                remainingFraction: 0.90,
                resetTime: new Date(Date.now() + 18000 * 1000).toISOString(),
              },
            ],
          },
          {
            displayName: 'Gemini 4 Argon',
            description: 'For paid Pro plans, Argon quota is separate.',
            buckets: [
              {
                bucketId: 'gemini-argon-wtu-weekly',
                displayName: 'Gemini 4 Argon Weekly Limit',
                window: 'weekly',
                remainingFraction: 0.70,
                resetTime: new Date(Date.now() + 600000 * 1000).toISOString(),
              },
            ],
          },
        ],
      },
    };

    const rawUserStatus: RawUserStatusResponse = {
      userStatus: {
        name: 'Wandré Veloso',
        email: 'wandreveloso@gmail.com',
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: 'Gemini 4 Argon (Medium)',
              tagTitle: 'New',
              quotaInfo: {
                remainingFraction: 0.70,
                resetTime: new Date(Date.now() + 600000 * 1000).toISOString(),
              },
            },
            {
              label: 'Gemini 4 Hydrogen (Medium)',
              tagTitle: 'New',
              quotaInfo: {
                remainingFraction: 0.88,
                resetTime: new Date(Date.now() + 18000 * 1000).toISOString(),
              },
            },
            {
              label: 'Orchestrator (Argon)',
              tagTitle: 'New',
              quotaInfo: {
                remainingFraction: 0.70,
                resetTime: new Date(Date.now() + 600000 * 1000).toISOString(),
              },
            },
            {
              label: 'Claude Opus 5.5 (Medium)',
              tagTitle: 'New',
              quotaInfo: {
                remainingFraction: 0.90,
                resetTime: new Date(Date.now() + 18000 * 1000).toISOString(),
              },
            },
            {
              label: 'GPT-OSS 120B (Medium)',
              tagTitle: 'Notice',
              quotaInfo: {
                remainingFraction: 1.0,
                resetTime: new Date(Date.now() + 18000 * 1000).toISOString(),
              },
            },
            {
              label: 'Gemini 4 Carbon',
              tagTitle: 'Unavailable',
            },
          ],
        },
      },
    };

    const context: ContextMetrics = {
      totalTokens: 10000,
      cachedTokens: 8000,
      newTokens: 2000,
      usedPct: 1,
    };

    const snapshot = MetricsNormalizer.normalize(rawQuota, rawUserStatus, context);

    assert.strictEqual(snapshot.geminiRemainingPct, 88);
    assert.strictEqual(snapshot.geminiWeeklyRemainingPct, 95);
    assert.strictEqual(snapshot.claudeRemainingPct, 90);
    assert.strictEqual(snapshot.claudeWeeklyRemainingPct, 100);
    assert.strictEqual(snapshot.argonRemainingPct, 70);
    assert.ok(snapshot.argonWeeklyResetFormatted);

    // Check models list
    assert.ok(snapshot.models);
    assert.strictEqual(snapshot.models.length, 6);

    const argonModel = snapshot.models.find(m => m.label === 'Gemini 4 Argon (Medium)');
    assert.ok(argonModel);
    assert.strictEqual(argonModel.group, 'gemini-argon');
    assert.strictEqual(argonModel.tagTitle, 'New');
    assert.strictEqual(argonModel.remainingPct, 70);
    assert.strictEqual(argonModel.isAvailable, true);

    const carbonModel = snapshot.models.find(m => m.label === 'Gemini 4 Carbon');
    assert.ok(carbonModel);
    assert.strictEqual(carbonModel.isAvailable, false);
    assert.strictEqual(carbonModel.tagTitle, 'Unavailable');

    // Check pools
    const argonPool = snapshot.pools.find(p => p.name === 'Gemini 4 Argon Weekly Quota');
    assert.ok(argonPool);
    assert.strictEqual(argonPool.used, 30);
    assert.strictEqual(argonPool.total, 100);
  });
});
