import * as vscode from 'vscode';
import { MetricsClient } from './services/metrics-client';
import { StatusBarProvider } from './ui/status-bar-provider';
import { QuickPickProvider } from './ui/quickpick-provider';

let metricsClient: MetricsClient | undefined;
let statusBarProvider: StatusBarProvider | undefined;
let quickPickProvider: QuickPickProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Read configuration if available
  const config = vscode.workspace.getConfiguration('antigravityMonitor');
  const pollingIntervalSeconds = config.get<number>('pollingInterval', 30);
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;

  metricsClient = new MetricsClient({
    pollingIntervalMs: pollingIntervalSeconds * 1000,
    workspaceUri,
  });

  statusBarProvider = new StatusBarProvider();
  quickPickProvider = new QuickPickProvider(metricsClient);

  // Wire client events to UI
  metricsClient.on('update', snapshot => {
    statusBarProvider?.update(snapshot);
  });

  metricsClient.on('error', error => {
    statusBarProvider?.setErrorState(error.message);
  });

  // Register commands
  const showQuickPickCmd = vscode.commands.registerCommand(
    'antigravityMonitor.showQuickPick',
    async () => {
      if (quickPickProvider) {
        await quickPickProvider.show();
      }
    }
  );

  const refreshCmd = vscode.commands.registerCommand(
    'antigravityMonitor.refresh',
    async () => {
      if (metricsClient) {
        statusBarProvider?.setLoadingState();
        try {
          const snapshot = await metricsClient.refreshNow();
          statusBarProvider?.update(snapshot);
          vscode.window.showInformationMessage('Antigravity Monitor: Métricas atualizadas.');
        } catch (e) {
          statusBarProvider?.setErrorState(e instanceof Error ? e.message : String(e));
        }
      }
    }
  );

  const cleanCacheCmd = vscode.commands.registerCommand(
    'antigravityMonitor.cleanCache',
    async () => {
      if (quickPickProvider) {
        const mgr = quickPickProvider.getCacheManager();
        const confirm = await vscode.window.showWarningMessage(
          'Deseja limpar os arquivos de sessões antigas de conversas e compactar os bancos de dados do Antigravity? (As 5 conversas mais recentes serão preservadas)',
          { modal: true },
          'Limpar e Compactar'
        );
        if (confirm === 'Limpar e Compactar') {
          const res = await mgr.cleanCache(5);
          const freedMB = (res.freedBytes / (1024 * 1024)).toFixed(1);
          vscode.window.showInformationMessage(
            `Limpeza concluída! ${freedMB} MB liberados em ${res.deletedFilesCount} arquivos.`
          );
          await metricsClient?.refreshNow();
        }
      }
    }
  );

  const compactContextCmd = vscode.commands.registerCommand(
    'antigravityMonitor.compactContext',
    async () => {
      if (quickPickProvider) {
        await quickPickProvider.getCacheManager().triggerContextCompaction();
      }
    }
  );

  const restartAgentCmd = vscode.commands.registerCommand(
    'antigravityMonitor.restartAgent',
    async () => {
      if (quickPickProvider) {
        await quickPickProvider.getCacheManager().restartAgentServices();
        vscode.window.showInformationMessage('Serviços do agente Antigravity reiniciados.');
        await metricsClient?.refreshNow();
      }
    }
  );

  // Register workspace change listener
  const wsListener = vscode.workspace.onDidChangeWorkspaceFolders(e => {
    const newWsUri = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    metricsClient?.setWorkspaceUri(newWsUri);
  });

  // Track config changes
  const configListener = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('antigravityMonitor.pollingInterval')) {
      const newInterval = vscode.workspace.getConfiguration('antigravityMonitor').get<number>('pollingInterval', 30);
      metricsClient?.setPollingInterval(newInterval * 1000);
    }
    if (e.affectsConfiguration('antigravityMonitor.displayFormat')) {
      const last = metricsClient?.getLastSnapshot();
      if (last && statusBarProvider) {
        statusBarProvider.update(last);
      }
    }
  });

  // Register all resources in context subscriptions for automatic garbage collection
  context.subscriptions.push(
    statusBarProvider,
    metricsClient,
    showQuickPickCmd,
    refreshCmd,
    cleanCacheCmd,
    compactContextCmd,
    restartAgentCmd,
    wsListener,
    configListener
  );

  // Start polling
  metricsClient.startPolling();
}

export function deactivate(): void {
  if (metricsClient) {
    metricsClient.dispose();
    metricsClient = undefined;
  }
  if (statusBarProvider) {
    statusBarProvider.dispose();
    statusBarProvider = undefined;
  }
  quickPickProvider = undefined;
}

