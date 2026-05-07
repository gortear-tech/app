export interface MetricsCollectionWindow {
  from: string;
  to: string;
}

export interface PostPerformanceMetrics {
  reach: number;
  reactions: number;
  comments: number;
  saves: number;
  shares: number;
}

export interface BusinessPerformanceSummary {
  reach: number;
  engagement: number;
  postsPublished: number;
  score: number;
}
