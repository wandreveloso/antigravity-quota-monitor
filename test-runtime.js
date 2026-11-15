const assert = require('assert');
const Module = require('module');

// Mock vscode module for out-of-host runtime validation
const mockVscode = {
  window: {
    createStatusBarItem: (alignment, priority) => ({
      text: '',
      color: undefined,
      backgroundColor: undefined,
      tooltip: '',
      command: '',
      name: '',
      show: () => {},
      dispose: () => {},
    }),
    showQuickPick: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    withProgress: async (opts, task) => await task({ report: () => {} }),
  },
  env: {
    clipboard: {
      writeText: async () => {},
    },
  },
  StatusBarAlignment: { Right: 2 },
  QuickPickItemKind: { Separator: -1 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  MarkdownString: class MarkdownString {
    constructor(val) {
      this.value = val;
    }
  },
  commands: {
    registerCommand: (name, callback) => ({
      dispose: () => {},
    }),
    executeCommand: async () => undefined,
  },
  workspace: {
    getConfiguration: () => ({
      get: (k, def) => def,
    }),
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
  },
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, arguments);
};

// Now load extension bundle
const extension = require('./dist/extension.js');

assert.strictEqual(typeof extension.activate, 'function');
assert.strictEqual(typeof extension.deactivate, 'function');

const disposables = [];
const mockContext = {
  subscriptions: {
    push(...items) {
      disposables.push(...items);
    },
  },
};

console.log('Activating extension in mock runtime...');
extension.activate(mockContext);
assert.ok(disposables.length >= 4, `Expected at least 4 disposables, got ${disposables.length}`);

console.log('Deactivating extension...');
extension.deactivate();
console.log('Extension deactivated cleanly.');

// Clean up test file
