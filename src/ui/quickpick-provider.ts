import * as vscode from 'vscode';
import { QuotaSnapshot } from '../services/types';
import { MetricsClient } from '../services/metrics-client';
import { CacheManager } from '../services/cache-manager';

interface MonitorQuickPickItem extends vscode.QuickPickItem {
  actionId?: 'refresh' | 'clean_storage' | 'compact_context' | 'restart_agent' | 'open_settings';
}

export class QuickPickProvider {
  private cacheManager: CacheManager;

  constructor(private metricsClient: MetricsClient) {
    this.cacheManager = new CacheManager();
  }

  public getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  public async show(snapshot?: QuotaSnapshot): Promise<void> {
    const currentSnapshot = snapshot ?? this.metricsClient.getLastSnapshot();
    const items: MonitorQuickPickItem[] = [];

    // --- SEÇÃO 1: COTAS INDIVIDUAIS E RENOVAÇÕES ---
    items.push({
      label: 'Cotas de Modelos & Prazos de Vencimento',
      kind: vscode.QuickPickItemKind.Separator,
    });

    if (currentSnapshot) {
      // Gemini 5h
      const geminiReset = currentSnapshot.resets.find(r => r.model.includes('Gemini (5h)'));
      const gemini5hCount = geminiReset ? this.formatCountdown(geminiReset.resetInSeconds) : 'N/A';
      items.push({
        label: `$(hubot) Gemini (Ciclo 5h): ${currentSnapshot.geminiRemainingPct}% restante`,
        description: `Renova em: ${gemini5hCount}`,
        detail: 'Cota de ciclo curto para modelos Gemini Flash e Pro.',
      });

      // Gemini Weekly
      const gemWkPct = currentSnapshot.geminiWeeklyRemainingPct ?? 100;
      const gemWkReset = currentSnapshot.geminiWeeklyResetFormatted || 'N/A';
      const gemWkCount = currentSnapshot.geminiWeeklyCountdown || 'N/A';
      items.push({
        label: `$(calendar) Gemini Semanal: ${gemWkPct}% restante`,
        description: `Vence em: ${gemWkReset} (${gemWkCount})`,
        detail: 'Cota semanal principal de modelos Gemini.',
      });

      // Claude 5h
      const claudeReset = currentSnapshot.resets.find(r => r.model.includes('Claude (5h)'));
      const claude5hCount = claudeReset ? this.formatCountdown(claudeReset.resetInSeconds) : 'N/A';
      items.push({
        label: `$(sparkle) Claude (Ciclo 5h): ${currentSnapshot.claudeRemainingPct}% restante`,
        description: `Renova em: ${claude5hCount}`,
        detail: 'Cota para modelos Claude Sonnet, Opus e parceiros.',
      });

      // Claude Weekly
      const claudeWkPct = currentSnapshot.claudeWeeklyRemainingPct ?? 100;
      const claudeWkReset = currentSnapshot.claudeWeeklyResetFormatted || 'N/A';
      const claudeWkCount = currentSnapshot.claudeWeeklyCountdown || 'N/A';
      items.push({
        label: `$(calendar) Claude Semanal: ${claudeWkPct}% restante`,
        description: `Vence em: ${claudeWkReset} (${claudeWkCount})`,
        detail: 'Cota semanal de parceiros (Anthropic / OpenAI).',
      });

      // Additional model resets if available
      for (const r of currentSnapshot.resets) {
        if (!r.model.includes('(5h)') && !r.model.includes('(Weekly)')) {
          items.push({
            label: `$(server) ${r.model}`,
            description: `Renova em: ${r.resetTimeFormatted || this.formatCountdown(r.resetInSeconds)}`,
          });
        }
      }
    } else {
      items.push({
        label: '$(sync~spin) Aguardando dados das cotas...',
      });
    }

    // --- SEÇÃO 2: POOLS PERIÓDICOS E CRÉDITOS ---
    items.push({
      label: 'Pools Periódicos & Créditos',
      kind: vscode.QuickPickItemKind.Separator,
    });

    if (currentSnapshot && currentSnapshot.pools.length > 0) {
      for (const pool of currentSnapshot.pools) {
        const bar = this.makeProgressBar(pool.used, pool.total, 10);
        const icon = pool.period === 'weekly' ? '$(calendar)' : '$(credit-card)';
        const pctUsed = pool.total > 0 ? Math.round((pool.used / pool.total) * 100) : 0;
        const resetInfo = pool.resetTimeFormatted
          ? ` • Vencimento: ${pool.resetTimeFormatted} (${pool.countdownFormatted})`
          : '';

        items.push({
          label: `${icon} ${pool.name}`,
          description: `${bar} ${pctUsed}% consumido (${pool.used.toLocaleString()} / ${pool.total.toLocaleString()})`,
          detail: `Período: ${pool.period === 'weekly' ? 'Semanal' : 'Mensal'}${resetInfo}`,
        });
      }
    } else {
      items.push({
        label: '$(info) Nenhum pool de créditos configurado para a conta ativa.',
      });
    }

    // --- SEÇÃO 3: JANELA DE CONTEXTO E ARMAZENAMENTO ---
    items.push({
      label: 'Janela de Contexto & Armazenamento em Disco',
      kind: vscode.QuickPickItemKind.Separator,
    });

    if (currentSnapshot) {
      const totalFmt = currentSnapshot.contextTokensTotal.toLocaleString();
      const cachedFmt = currentSnapshot.contextTokensCached.toLocaleString();
      const newFmt = currentSnapshot.contextTokensNew.toLocaleString();
      const cachePct = currentSnapshot.cacheHitPct ?? 0;

      items.push({
        label: `$(database) Contexto da Sessão: ${totalFmt} tokens`,
        description: `${currentSnapshot.contextUsedPct}% de 1M tokens`,
        detail: 'Volume acumulado de tokens no contexto atual do agente.',
      });

      items.push({
        label: `$(history) ⚡ Tokens em Cache Read: ${cachedFmt} tokens`,
        description: `${cachePct}% do contexto recuperado de cache instantâneo`,
        detail: 'Tokens de cache economizam cota e aceleram a resposta.',
      });

      items.push({
        label: `$(add) Tokens Novos / Gerados: ${newFmt} tokens`,
        description: 'Input recente do usuário + Respostas do assistente',
      });
    }

    // Get current cache stats asynchronously
    try {
      const cacheStats = await this.cacheManager.getCacheStats();
      items.push({
        label: `$(archive) Cache em Disco do Antigravity: ${cacheStats.totalSizeMB} MB`,
        description: `${cacheStats.totalConversations} sessões salvas (~${cacheStats.conversationsSizeMB} MB conversas, ${cacheStats.brainSizeMB} MB artefatos)`,
        detail: 'Use a ação "Limpar Cache & Compactar" abaixo para liberar espaço.',
      });
    } catch {
      // Ignore cache stat error
    }

    // --- SEÇÃO 4: AÇÕES E OTIMIZAÇÕES ---
    items.push({
      label: 'Ações & Otimizações do Sistema',
      kind: vscode.QuickPickItemKind.Separator,
    });

    items.push({
      label: '$(trash) Limpar Cache e Compactar Armazenamento',
      description: 'Remove sessões antigas (>5), artefatos órfãos e executa VACUUM no SQLite',
      actionId: 'clean_storage',
    });

    items.push({
      label: '$(compress) Compactar Contexto do Agente (/compact)',
      description: 'Copia "/compact" e foca na janela do chat para otimizar o histórico',
      actionId: 'compact_context',
    });

    items.push({
      label: '$(debug-restart) Reiniciar Serviços do Agente',
      description: 'Reinicia Language Server e User Status Updater do Antigravity',
      actionId: 'restart_agent',
    });

    items.push({
      label: '$(refresh) Recarregar métricas agora',
      description: 'Consulta imediata das cotas no daemon local',
      actionId: 'refresh',
    });

    items.push({
      label: '$(gear) Configurar exibição do rodapé',
      description: 'Alternar entre formato Detalhado, Compacto ou Semanal',
      actionId: 'open_settings',
    });

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Antigravity Quota & Context Monitor',
      placeHolder: 'Selecione uma ação ou visualize as informações de uso detalhadas',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected && selected.actionId) {
      await this.handleAction(selected.actionId);
    }
  }

  private async handleAction(
    actionId: 'refresh' | 'clean_storage' | 'compact_context' | 'restart_agent' | 'open_settings'
  ): Promise<void> {
    if (actionId === 'refresh') {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Atualizando cotas do Antigravity...',
          cancellable: false,
        },
        async () => {
          try {
            const updated = await this.metricsClient.refreshNow();
            vscode.window.showInformationMessage(
              `Cotas atualizadas! Gemini: ${updated.geminiRemainingPct}% | Wk: ${updated.geminiWeeklyRemainingPct ?? 100}% (${updated.geminiWeeklyResetFormatted || 'N/A'})`
            );
          } catch (e) {
            vscode.window.showErrorMessage(
              `Falha ao atualizar cotas: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }
      );
    } else if (actionId === 'clean_storage') {
      const confirm = await vscode.window.showWarningMessage(
        'Deseja limpar os arquivos de sessões antigas de conversas e compactar os bancos de dados do Antigravity? (As 5 conversas mais recentes serão preservadas)',
        { modal: true },
        'Limpar e Compactar'
      );

      if (confirm === 'Limpar e Compactar') {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Limpando cache e compactando bancos de dados...',
            cancellable: false,
          },
          async () => {
            const result = await this.cacheManager.cleanCache(5);
            const freedMB = (result.freedBytes / (1024 * 1024)).toFixed(1);
            vscode.window.showInformationMessage(
              `Limpeza concluída! ${freedMB} MB liberados em ${result.deletedFilesCount} arquivos.${result.vacuumedDb ? ' Banco SQLite compactado com VACUUM.' : ''}`
            );
            await this.metricsClient.refreshNow();
          }
        );
      }
    } else if (actionId === 'compact_context') {
      await this.cacheManager.triggerContextCompaction();
    } else if (actionId === 'restart_agent') {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Reiniciando serviços do agente Antigravity...',
          cancellable: false,
        },
        async () => {
          const ok = await this.cacheManager.restartAgentServices();
          if (ok) {
            vscode.window.showInformationMessage('Serviços do agente Antigravity reiniciados com sucesso.');
            await new Promise(r => setTimeout(r, 1000));
            await this.metricsClient.refreshNow();
          } else {
            vscode.window.showWarningMessage('Tentativa de reinicialização enviada ao Antigravity IDE.');
          }
        }
      );
    } else if (actionId === 'open_settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'antigravityMonitor');
    }
  }

  /**
   * Generates a textual progress bar e.g. [██████░░░░]
   */
  public makeProgressBar(used: number, total: number, blocks = 10): string {
    if (total <= 0) {
      return `[${'░'.repeat(blocks)}]`;
    }
    const ratio = Math.max(0, Math.min(1, used / total));
    const filled = Math.round(ratio * blocks);
    const empty = blocks - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * Formats remaining seconds into HH:MM:SS or Dd HHh format
   */
  public formatCountdown(seconds: number): string {
    if (seconds <= 0) {
      return 'Renovando agora';
    }

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    }

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
}
