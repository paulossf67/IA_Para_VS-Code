import * as vscode from 'vscode';

export interface MarketplaceExtension {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  rating: number; // 0-5
  downloads: number;
  tags: string[];
  code?: string;
}

export class LocalMarketplace {
  constructor(private storage: vscode.Memento) {}

  private extensions: Map<string, MarketplaceExtension> = new Map();

  async publishExtension(ext: MarketplaceExtension): Promise<void> {
    this.extensions.set(ext.id, ext);
    const all = this.storage.get<MarketplaceExtension[]>('marketplace.extensions') || [];
    all.push(ext);
    await this.storage.update('marketplace.extensions', all);
  }

  async search(query: string): Promise<MarketplaceExtension[]> {
    const all = this.storage.get<MarketplaceExtension[]>('marketplace.extensions') || [];
    const lowerQuery = query.toLowerCase();

    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(lowerQuery) ||
        e.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );
  }

  async getTopRated(): Promise<MarketplaceExtension[]> {
    const all = this.storage.get<MarketplaceExtension[]>('marketplace.extensions') || [];
    return all.sort((a, b) => b.rating - a.rating).slice(0, 10);
  }

  async rateExtension(id: string, rating: number): Promise<void> {
    const all = this.storage.get<MarketplaceExtension[]>('marketplace.extensions') || [];
    const ext = all.find((e) => e.id === id);
    if (ext) {
      ext.rating = rating;
      await this.storage.update('marketplace.extensions', all);
    }
  }

  async downloadExtension(id: string): Promise<void> {
    const all = this.storage.get<MarketplaceExtension[]>('marketplace.extensions') || [];
    const ext = all.find((e) => e.id === id);
    if (ext) {
      ext.downloads++;
      await this.storage.update('marketplace.extensions', all);
    }
  }
}

export async function showMarketplaceUI(): Promise<void> {
  vscode.window.showInformationMessage('🌐 Local Marketplace coming soon - share and discover extensions!');
}
