import * as vscode from 'vscode';

export interface ResponseMetrics {
  responseId: string;
  timestamp: Date;
  category: string; // 'explanation', 'refactor', 'test', etc
  autoScore: number; // 0-100 IA self-evaluation
  userRating?: number; // 1-5 stars
  wasHelpful?: boolean;
  usedInProduction?: boolean;
  readability: number; // 0-100
  relevance: number; // 0-100
  completeness: number; // 0-100
  timeToGenerate: number; // ms
}

const STORAGE_KEY = 'local-ai.responseMetrics';
const MAX_METRICS = 1000;

export class QualityScoreTracker {
  constructor(private storage: vscode.Memento) {}

  async loadMetrics(): Promise<ResponseMetrics[]> {
    return this.storage.get<ResponseMetrics[]>(STORAGE_KEY) || [];
  }

  async recordResponse(metrics: Omit<ResponseMetrics, 'responseId' | 'timestamp'>): Promise<ResponseMetrics> {
    const record: ResponseMetrics = {
      ...metrics,
      responseId: `resp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
    };

    const all = await this.loadMetrics();
    all.push(record);

    // Keep only last MAX_METRICS
    if (all.length > MAX_METRICS) {
      all.splice(0, all.length - MAX_METRICS);
    }

    await this.storage.update(STORAGE_KEY, all);
    return record;
  }

  async rateResponse(responseId: string, rating: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const metrics = await this.loadMetrics();
    const metric = metrics.find((m) => m.responseId === responseId);
    if (metric) {
      metric.userRating = rating;
      await this.storage.update(STORAGE_KEY, metrics);
    }
  }

  async getWeeklyStats(): Promise<{
    averageScore: number;
    trend: number; // -100 to +100, percentage change
    topCategory: string;
    bottomCategory: string;
  }> {
    const metrics = await this.loadMetrics();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const weeklyMetrics = metrics.filter((m) => new Date(m.timestamp) > weekAgo);
    if (weeklyMetrics.length === 0) {
      return { averageScore: 0, trend: 0, topCategory: '', bottomCategory: '' };
    }

    const averageScore = weeklyMetrics.reduce((acc, m) => acc + m.autoScore, 0) / weeklyMetrics.length;

    // Calculate trend
    const mid = Math.floor(weeklyMetrics.length / 2);
    const firstHalf = weeklyMetrics.slice(0, mid).reduce((acc, m) => acc + m.autoScore, 0) / mid;
    const secondHalf = weeklyMetrics.slice(mid).reduce((acc, m) => acc + m.autoScore, 0) / (weeklyMetrics.length - mid);
    const trend = ((secondHalf - firstHalf) / firstHalf) * 100;

    // Top and bottom categories
    const byCategory: { [key: string]: number[] } = {};
    for (const metric of weeklyMetrics) {
      if (!byCategory[metric.category]) byCategory[metric.category] = [];
      byCategory[metric.category].push(metric.autoScore);
    }

    const categoryAverages = Object.entries(byCategory).map(([cat, scores]) => ({
      category: cat,
      average: scores.reduce((a, b) => a + b, 0) / scores.length,
    }));

    const topCategory = categoryAverages.reduce((max, curr) => (curr.average > max.average ? curr : max), categoryAverages[0]);
    const bottomCategory = categoryAverages.reduce((min, curr) => (curr.average < min.average ? curr : min), categoryAverages[0]);

    return {
      averageScore,
      trend: Math.round(trend),
      topCategory: topCategory?.category || '',
      bottomCategory: bottomCategory?.category || '',
    };
  }

  async getCategoryStats(category: string): Promise<{
    count: number;
    averageScore: number;
    averageRating: number;
  }> {
    const metrics = await this.loadMetrics();
    const categoryMetrics = metrics.filter((m) => m.category === category);

    if (categoryMetrics.length === 0) {
      return { count: 0, averageScore: 0, averageRating: 0 };
    }

    const averageScore = categoryMetrics.reduce((acc, m) => acc + m.autoScore, 0) / categoryMetrics.length;

    const ratedMetrics = categoryMetrics.filter((m) => m.userRating !== undefined);
    const averageRating =
      ratedMetrics.length > 0
        ? ratedMetrics.reduce((acc, m) => acc + (m.userRating || 0), 0) / ratedMetrics.length
        : 0;

    return {
      count: categoryMetrics.length,
      averageScore,
      averageRating,
    };
  }

  autoEvaluateResponse(response: string, category: string): number {
    let score = 50; // Base score

    // Length check
    if (response.length < 50) {
      score -= 20; // Too short
    } else if (response.length > 5000) {
      score -= 10; // Too long
    } else if (response.length > 500) {
      score += 10; // Good length
    }

    // Code quality indicators
    if (response.includes('```')) {
      score += 15; // Has code examples
    }
    if (response.includes('TODO') || response.includes('FIX') || response.includes('BUG')) {
      score -= 5; // Has warnings
    }

    // Category-specific checks
    if (category === 'explanation') {
      if (response.match(/\b(because|therefore|thus|hence)\b/i)) {
        score += 10; // Good explanations
      }
    } else if (category === 'refactor') {
      if (response.includes('performance') || response.includes('readability')) {
        score += 10;
      }
    } else if (category === 'test') {
      if (response.match(/test|describe|expect|assert/i)) {
        score += 15;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  async showDashboard(): Promise<void> {
    const stats = await this.getWeeklyStats();
    const message = `
📊 Local AI - Quality Metrics (This Week)

Average Score: ${stats.averageScore.toFixed(1)}/100
Trend: ${stats.trend > 0 ? '📈' : stats.trend < 0 ? '📉' : '➡️'} ${Math.abs(stats.trend)}%

Top Category: ${stats.topCategory || 'N/A'}
Needs Work: ${stats.bottomCategory || 'N/A'}
    `.trim();

    vscode.window.showInformationMessage(message, { modal: false });
  }
}

export function getQualityIndicator(score: number): string {
  if (score >= 90) return '⭐⭐⭐⭐⭐';
  if (score >= 80) return '⭐⭐⭐⭐';
  if (score >= 70) return '⭐⭐⭐';
  if (score >= 60) return '⭐⭐';
  if (score >= 50) return '⭐';
  return '❌';
}
