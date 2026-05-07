import type { BenchmarkInput, BenchmarkResult } from "../types";
import { mean } from "../utils";

export function compareAgainstPeers(input: BenchmarkInput): BenchmarkResult {
  const peerCount = input.peers.length;
  const averageReach = peerCount > 0 ? mean(input.peers.map((peer) => peer.reach)) : 0;
  const averageEngagement = peerCount > 0 ? mean(input.peers.map((peer) => peer.engagement)) : 0;
  const averagePostsPublished = peerCount > 0 ? mean(input.peers.map((peer) => peer.postsPublished)) : 0;

  const reachDelta = averageReach === 0 ? 0 : ((input.businessReach - averageReach) / averageReach) * 100;
  const engagementDelta = averageEngagement === 0 ? 0 : ((input.businessEngagement - averageEngagement) / averageEngagement) * 100;

  return {
    peerCount,
    averageReach: Number(averageReach.toFixed(2)),
    averageEngagement: Number(averageEngagement.toFixed(2)),
    averagePostsPublished: Number(averagePostsPublished.toFixed(2)),
    comparisonText: `Reach ${reachDelta >= 0 ? "above" : "below"} peers by ${Math.abs(reachDelta).toFixed(1)}%; engagement ${engagementDelta >= 0 ? "above" : "below"} peers by ${Math.abs(engagementDelta).toFixed(1)}%.`,
  };
}

