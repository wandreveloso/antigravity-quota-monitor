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

    const argonPct = snapshot.argonRemainingPct;
    const argonReset = snapshot.argonWeeklyResetFormatted || 'N/A';
    const argonCountdown = snapshot.argonWeeklyCountdown || 'N/A';

    const claudePct = snapshot.claudeRemainingPct;
    const claudeWkPct = snapshot.claudeWeeklyRemainingPct ?? 100;

    const ctxPct = snapshot.contextUsedPct;
    const ctxTotal = snapshot.contextTokensTotal;
    const cachePct = snapshot.cacheHitPct ?? 0;

    const ctxTokensFmt =
      ctxTotal >= 1000 ? `${(ctxTotal / 1000).toFixed(ctxTotal >= 10000 ? 0 : 1)}k` : `${ctxTotal}`;

    const gemLongTag = snapshot.geminiLongWindowLabel || 'Wk';
    const cldLongTag = snapshot.claudeLongWindowLabel || 'Wk';

    const argonPrefix = argonPct !== undefined ? `Argon: ${argonPct}% | ` : '';
    const argonCompact = argonPct !== undefined ? `Arg: ${argonPct}% | ` : '';

    // Format text based on user preference
    switch (displayFormat) {
      case 'compact':
        this.statusBarItem.text = `${argonCompact}G: ${geminiPct}% (${gemLongTag}: ${geminiWkPct}% ${geminiWkCountdown}) | C: ${claudePct}% | Ctx: ${ctxTokensFmt}`;
        break;
      case 'weeklyOnly':
        this.statusBarItem.text = `${argonPrefix}Gemini ${gemLongTag}: ${geminiWkPct}% (${geminiWkReset}) | Claude ${cldLongTag}: ${claudeWkPct}% | Ctx: ${ctxTokensFmt}`;
        break;
      case 'classic':
        this.statusBarItem.text = `Gemini: ${geminiPct}% | Claude: ${claudePct}% | Ctx: ${ctxPct}%`;
        break;
      case 'detailed':
      default:
        this.statusBarItem.text = `${argonPrefix}Gemini: ${geminiPct}% | ${gemLongTag}: ${geminiWkPct}% (${geminiWkReset}) | Claude: ${claudePct}% | Ctx: ${ctxTokensFmt} (⚡${cachePct}%)`;
        break;
    }

    // Dynamic color coding based on minimum remaining quota:
    // Green (#89d185) for > 30%
    // Yellow (#cca700) for 10% to 30%
    // Red (#f14c4c) for < 10%
    const minRemaining = Math.min(geminiPct, geminiWkPct, claudePct, claudeWkPct, argonPct ?? 100);

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
    if (argonPct !== undefined) {
      tooltipMd.appendMarkdown(`| **Gemini 4 Argon (Semanal)** | **${argonPct}%** | **${argonReset}** (${argonCountdown}) |\n`);
    }
    tooltipMd.appendMarkdown(`| **Gemini (Ciclo 5h)** | **${geminiPct}%** | Em ${gem5hStr} |\n`);
    tooltipMd.appendMarkdown(`| **Gemini (Semanal)** | **${geminiWkPct}%** | **${snapshot.geminiWeeklyResetFormatted || 'N/A'}** (${geminiWkCountdown}) |\n`);
    tooltipMd.appendMarkdown(`| **Claude (Ciclo 5h)** | **${claudePct}%** | Em ${cld5hStr} |\n`);
    tooltipMd.appendMarkdown(`| **Claude (Semanal)** | **${claudeWkPct}%** | **${snapshot.claudeWeeklyResetFormatted || 'N/A'}** (${snapshot.claudeWeeklyCountdown || 'N/A'}) |\n\n`);

    tooltipMd.appendMarkdown(`---\n\n`);
    tooltipMd.appendMarkdown(`#### 💡 Dicas de Modelos & Esforço Recomendado\n`);
    tooltipMd.appendMarkdown(`- 🔥 **Gemini 4 Neon** *(Esforço: Médio/Alto)*: Modelo de ponta para arquiteturas e desafios complexos.\n`);
    tooltipMd.appendMarkdown(`- 🧱 **Gemini 4 Carbon** *(Esforço: Médio)*: Raciocínio avançado e refatorações pesadas.\n`);
    tooltipMd.appendMarkdown(`- 💎 **Gemini 4 Argon** *(Esforço: Médio/Alto)*: Raciocínio profundo e arquiteturas complexas.\n`);
    tooltipMd.appendMarkdown(`- 🧪 **Gemini 4 Hydrogen** *(Esforço: Médio)*: Cavalo de batalha diário para código, testes e refatorações gerais.\n`);
    tooltipMd.appendMarkdown(`- 🤖 **Orchestrator (Argon)** *(Esforço: Automático)*: Orquestração multi-agente, subagentes e planejamento de alto nível.\n`);
    tooltipMd.appendMarkdown(`- ⚡ **Gemini 3.8 Flash** *(Esforço: Alto)*: Velocidade máxima para correções rápidas, boilerplates e tarefas simples.\n`);
    tooltipMd.appendMarkdown(`- 🎭 **Claude Opus 5.5** *(Esforço: Médio/Alto)*: Análise conceitual crítica, auditoria minuciosa e corner-cases difíceis.\n`);
    tooltipMd.appendMarkdown(`- 🎯 **Claude Sonnet 5.5** *(Esforço: Médio)*: Precisão cirúrgica em sintaxe, TypeScript/UI e zero regressões.\n`);
    tooltipMd.appendMarkdown(`- 🌐 **GPT-OSS 120B** *(Esforço: Médio)*: Excelente segunda opinião e validação cruzada independente de código.\n\n`);

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
