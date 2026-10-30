import * as vscode from 'vscode';
import { QuotaSnapshot } from '../services/types';

export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private readonly commandId = 'antigravityMonitor.showQuickPick';

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = this.commandId;
    this.statusBarItem.name = 'Antigravity Quota & Context Monitor';
    this.statusBarItem.tooltip = 'Clique para abrir o painel detalhado de cotas e contexto';
    this.setLoadingState();
    this.statusBarItem.show();
  }

  public getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  public setLoadingState(): void {
    this.statusBarItem.text = '$(sync~spin) Gemini: --% | Wk: --% | Ctx: --%';
    this.statusBarItem.color = undefined;
    this.statusBarItem.backgroundColor = undefined;
  }

  public setErrorState(message: string): void {
    this.statusBarItem.text = '$(warning) Monitor: Desconectado';
    this.statusBarItem.color = '#f14c4c';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.statusBarItem.tooltip = `Erro de conexão com o daemon Antigravity: ${message}\nClique para tentar reconectar.`;
  }

  public update(snapshot: QuotaSnapshot): void {
    const config = vscode.workspace.getConfiguration('antigravityMonitor');
    const displayFormat = config.get<string>('displayFormat', 'detailed');

    const geminiPct = snapshot.geminiRemainingPct;
    const geminiWkPct = snapshot.geminiWeeklyRemainingPct ?? 100;
    const geminiWkReset = snapshot.geminiWeeklyResetFormatted || 'N/A';
    const geminiWkCountdown = snapshot.geminiWeeklyCountdown || 'N/A';

    const claudePct = snapshot.claudeRemainingPct;
    const claudeWkPct = snapshot.claudeWeeklyRemainingPct ?? 100;

    const ctxPct = snapshot.contextUsedPct;
    const ctxTotal = snapshot.contextTokensTotal;
    const cachePct = snapshot.cacheHitPct ?? 0;

    const ctxTokensFmt =
      ctxTotal >= 1000 ? `${(ctxTotal / 1000).toFixed(ctxTotal >= 10000 ? 0 : 1)}k` : `${ctxTotal}`;

    // Format text based on user preference
    switch (displayFormat) {
      case 'compact':
        this.statusBarItem.text = `G: ${geminiPct}% (Wk: ${geminiWkPct}% ${geminiWkCountdown}) | C: ${claudePct}% | Ctx: ${ctxTokensFmt}`;
        break;
      case 'weeklyOnly':
        this.statusBarItem.text = `Gemini Wk: ${geminiWkPct}% (${geminiWkReset}) | Claude Wk: ${claudeWkPct}% | Ctx: ${ctxTokensFmt}`;
        break;
      case 'classic':
        this.statusBarItem.text = `Gemini: ${geminiPct}% | Claude: ${claudePct}% | Ctx: ${ctxPct}%`;
        break;
      case 'detailed':
      default:
        this.statusBarItem.text = `Gemini: ${geminiPct}% | Wk: ${geminiWkPct}% (${geminiWkReset}) | Claude: ${claudePct}% | Ctx: ${ctxTokensFmt} (⚡${cachePct}%)`;
        break;
    }

    // Dynamic color coding based on minimum remaining quota:
    // Green (#89d185) for > 30%
    // Yellow (#cca700) for 10% to 30%
    // Red (#f14c4c) for < 10%
    const minRemaining = Math.min(geminiPct, geminiWkPct, claudePct, claudeWkPct);

    if (minRemaining < 10) {
      this.statusBarItem.color = '#f14c4c';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (minRemaining <= 30) {
      this.statusBarItem.color = '#cca700';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.color = '#89d185';
      this.statusBarItem.backgroundColor = undefined;
    }

    // Rich Markdown Tooltip
    const gemini5hReset = snapshot.resets.find(r => r.model.includes('Gemini (5h)'));
    const claude5hReset = snapshot.resets.find(r => r.model.includes('Claude (5h)'));

    const gem5hStr = gemini5hReset?.countdownFormatted || 'N/A';
    const cld5hStr = claude5hReset?.countdownFormatted || 'N/A';

    const promptCreds = snapshot.availablePromptCredits !== undefined ? `${snapshot.availablePromptCredits}` : 'N/A';
    const flowCreds = snapshot.availableFlowCredits !== undefined ? `${snapshot.availableFlowCredits}` : 'N/A';

    const tooltipMd = new vscode.MarkdownString();
    tooltipMd.isTrusted = true;
    tooltipMd.appendMarkdown(`### 🪐 Antigravity Quota & Context Monitor\n\n`);

    tooltipMd.appendMarkdown(`| Cota de Modelo | Restante | Renovação / Vencimento |\n`);
    tooltipMd.appendMarkdown(`| :--- | :---: | :--- |\n`);
    tooltipMd.appendMarkdown(`| **Gemini (Ciclo 5h)** | **${geminiPct}%** | Em ${gem5hStr} |\n`);
    tooltipMd.appendMarkdown(`| **Gemini (Semanal)** | **${geminiWkPct}%** | **${snapshot.geminiWeeklyResetFormatted || 'N/A'}** (${geminiWkCountdown}) |\n`);
    tooltipMd.appendMarkdown(`| **Claude (Ciclo 5h)** | **${claudePct}%** | Em ${cld5hStr} |\n`);
    tooltipMd.appendMarkdown(`| **Claude (Semanal)** | **${claudeWkPct}%** | **${snapshot.claudeWeeklyResetFormatted || 'N/A'}** (${snapshot.claudeWeeklyCountdown || 'N/A'}) |\n\n`);

    tooltipMd.appendMarkdown(`---\n\n`);
    tooltipMd.appendMarkdown(`#### 🧠 Janela de Contexto (Sessão Ativa)\n`);
    tooltipMd.appendMarkdown(`- **Total**: ${snapshot.contextTokensTotal.toLocaleString()} tokens (${ctxPct}% do teto de 1M)\n`);
    tooltipMd.appendMarkdown(`- **⚡ Cache Read**: ${snapshot.contextTokensCached.toLocaleString()} tokens (${cachePct}% reaproveitado)\n`);
    tooltipMd.appendMarkdown(`- **Novos Gerados**: ${snapshot.contextTokensNew.toLocaleString()} tokens\n\n`);

    if (snapshot.availablePromptCredits !== undefined || snapshot.availableFlowCredits !== undefined) {
      tooltipMd.appendMarkdown(`#### 💎 Créditos do Plano (${snapshot.userTier || 'Pro'})\n`);
      tooltipMd.appendMarkdown(`- **Prompt Credits**: ${promptCreds} disponíveis\n`);
      tooltipMd.appendMarkdown(`- **Flow Credits**: ${flowCreds} disponíveis\n\n`);
    }

    tooltipMd.appendMarkdown(`*Clique para abrir o menu de ações e cotas completas.*`);

    this.statusBarItem.tooltip = tooltipMd;
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
