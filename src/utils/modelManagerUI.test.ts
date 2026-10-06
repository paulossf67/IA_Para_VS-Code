import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManagerProvider } from './modelManagerUI';
import * as vscode from 'vscode';

describe('ModelManagerProvider', () => {
  let provider: ModelManagerProvider;
  let mockUri: vscode.Uri;

  beforeEach(() => {
    mockUri = vscode.Uri.file('/test/extension');
    provider = new ModelManagerProvider(mockUri);
  });

  it('should have correct viewType', () => {
    expect(ModelManagerProvider.viewType).toBe('local-ai.modelManager');
  });

  it('should initialize without errors', () => {
    expect(provider).toBeDefined();
  });

  describe('resolveWebviewView', () => {
    it('should not throw when resolving webview', () => {
      const mockWebview = {
        options: {},
        html: '',
        onDidDispose: vi.fn(),
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      } as any;

      const mockWebviewView = {
        webview: mockWebview,
        onDidDispose: vi.fn(),
        onDidChangeVisibility: vi.fn(),
      } as any;

      expect(() => {
        provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      }).not.toThrow();
    });

    it('should enable scripts in webview', () => {
      const mockWebview = {
        options: {},
        html: '',
        onDidDispose: vi.fn(),
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      } as any;

      const mockWebviewView = {
        webview: mockWebview,
        onDidDispose: vi.fn(),
        onDidChangeVisibility: vi.fn(),
      } as any;

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockWebview.options.enableScripts).toBe(true);
      expect(mockWebview.options.localResourceRoots).toBeDefined();
    });

    it('should set HTML content', () => {
      const mockWebview = {
        options: {},
        html: '',
        onDidDispose: vi.fn(),
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      } as any;

      const mockWebviewView = {
        webview: mockWebview,
        onDidDispose: vi.fn(),
        onDidChangeVisibility: vi.fn(),
      } as any;

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockWebview.html).toBeTruthy();
      expect(mockWebview.html).toContain('<!DOCTYPE html');
    });

    it('should register message handler', () => {
      const mockWebview = {
        options: {},
        html: '',
        onDidDispose: vi.fn(),
        onDidReceiveMessage: vi.fn().mockImplementation((cb) => {
          cb({ type: 'ready' });
        }),
        postMessage: vi.fn(),
      } as any;

      const mockWebviewView = {
        webview: mockWebview,
        onDidDispose: vi.fn(),
        onDidChangeVisibility: vi.fn(),
      } as any;

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
    });
  });

  describe('HTML generation', () => {
    it('should generate valid HTML with required elements', () => {
      const mockWebview = {
        options: {},
        html: '',
        onDidDispose: vi.fn(),
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: 'self',
      } as any;

      const mockWebviewView = {
        webview: mockWebview,
        onDidDispose: vi.fn(),
        onDidChangeVisibility: vi.fn(),
      } as any;

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      const html = mockWebview.html;
      expect(html).toContain('Model Manager');
      expect(html).toContain('modelsList');
      expect(html).toContain('pullBtn');
      expect(html).toContain('refreshBtn');
      expect(html).toContain('script');
    });

    it('should include nonce for security', () => {
      const mockWebview = {
        options: {},
        html: '',
        onDidDispose: vi.fn(),
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: 'self',
      } as any;

      const mockWebviewView = {
        webview: mockWebview,
        onDidDispose: vi.fn(),
        onDidChangeVisibility: vi.fn(),
      } as any;

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      const html = mockWebview.html;
      expect(html).toContain('nonce=');
      expect(html).toContain('Content-Security-Policy');
    });
  });
});
