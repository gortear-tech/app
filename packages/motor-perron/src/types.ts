import type {
  ActionType,
  AiTaskType,
  AssignedStyle,
  BusinessLearningEventType,
  ConfidenceLevel,
  GenerationPlan,
  RiskLevel,
  VisualStyle,
  VisionAnalysisResult,
} from "@fbmaniaco/shared";

export interface BusinessContext {
  businessId: string;
  name: string;
  industry: string;
  tone: string;
  timezone: string;
  facebookPageId: string;
  autonomySettings?: Partial<Record<ActionType, number>>;
}

export interface LearningEvent {
  negocioId: string;
  type: BusinessLearningEventType;
  occurredAt: string;
  styleId?: string;
  styleName?: string;
  photoType?: string;
  captionPattern?: string;
  scheduledFor?: string;
  score?: number;
  costUsd?: number;
  provider?: string;
  model?: string;
  actionType?: ActionType;
  contentType?: string;
  dayOfWeek?: number;
  hourOfDay?: number;
  captionEdited?: boolean;
}

export interface PerformanceCell {
  contentType: string;
  styleId: string;
  dayOfWeek: number;
  hourBucket: string;
  captionTone: string;
  sampleSize: number;
  averageScore: number;
  variance: number;
}

export interface BusinessFootprint {
  preferredStyles: Record<string, { approvals: number; rejections: number; approvalRate: number }>;
  preferredContentTypes: Record<string, { count: number; averageScore: number }>;
  preferredHours: Record<string, { count: number; averageScore: number }>;
  captionEditRate: number;
  totalPostsMeasured: number;
}

export interface CausalConclusion {
  question: string;
  groupA: string;
  groupB: string;
  differencePoints: number;
  favorsA: boolean;
  observationsA: number;
  observationsB: number;
  confidence: ConfidenceLevel | "exploratoria";
  status: "activa" | "en_revision" | "invalidada";
}

export interface CausalMap {
  conclusions: CausalConclusion[];
  pendingQuestions: string[];
}

export interface DeepMemorySnapshot {
  performanceModel: PerformanceCell[];
  businessFootprint: BusinessFootprint;
  causalMap: CausalMap;
  confidence: ConfidenceLevel;
}

export interface AutonomyActionState {
  score: number;
  approvals: number;
  threshold: number;
  paused: boolean;
  consecutiveApprovals: number;
  consecutiveRejections: number;
}

export type AutonomyState = Record<ActionType, AutonomyActionState>;

export interface MotorDecision {
  negocioId: string;
  taskType: AiTaskType;
  mode: "sin_ia" | "ia_ligera" | "ia_avanzada";
  outcome:
    | "puede_continuar_autonomo"
    | "puede_continuar_swipe"
    | "requiere_aprobacion"
    | "bloqueado";
  confidenceLevel: ConfidenceLevel;
  riskLevel: RiskLevel;
  reason: string;
  requiresHumanApproval: boolean;
  recommendedActions: string[];
}

export interface DecisionContext {
  business: BusinessContext;
  taskType: AiTaskType;
  actionType: ActionType;
  batchStatus: string;
  costConfirmed: boolean;
  estimatedCostUsd: number;
  budgetUsd: number;
  providerSupportsTask: boolean;
  sensitiveElements: {
    priceVisible: boolean;
    logoVisible: boolean;
    personVisible: boolean;
    promotionVisible: boolean;
    textVisible: boolean;
  };
  postsMeasured: number;
  memory: DeepMemorySnapshot;
  autonomyState: AutonomyState;
}

export interface StyleAssignmentInput {
  business: BusinessContext;
  analysis: VisionAnalysisResult;
  styles: readonly VisualStyle[];
  memory?: DeepMemorySnapshot | null;
}

export interface PromptBuilderInput {
  business: BusinessContext;
  analysis: VisionAnalysisResult;
  style: AssignedStyle;
}

export interface ContentStrategyInput {
  business: BusinessContext;
  memory: DeepMemorySnapshot;
  events?: LearningEvent[];
}

export interface RecommendationInput {
  business: BusinessContext;
  memory: DeepMemorySnapshot;
}

export interface WeeklyReporterInput {
  business: BusinessContext;
  memory: DeepMemorySnapshot;
  benchmarks?: BenchmarkResult | null;
  events?: LearningEvent[];
}

export interface BenchmarkPeer {
  businessId: string;
  industry: string;
  sizeBand: "small" | "medium" | "active";
  region: string;
  reach: number;
  engagement: number;
  postsPublished: number;
}

export interface BenchmarkInput {
  businessReach: number;
  businessEngagement: number;
  businessPostsPublished: number;
  peers: BenchmarkPeer[];
}

export interface BenchmarkResult {
  peerCount: number;
  averageReach: number;
  averageEngagement: number;
  averagePostsPublished: number;
  comparisonText: string;
}

export interface PerformancePredictorInput {
  memory: DeepMemorySnapshot;
  business: BusinessContext;
  contentType: string;
  styleId: string;
  dayOfWeek: number;
  hourOfDay: number;
  captionTone: string;
  benchmarks?: BenchmarkResult | null;
}

export interface CausalAnalysisInput {
  events: LearningEvent[];
}

export interface GenerationPlanInput {
  business: BusinessContext;
  analysis: VisionAnalysisResult;
  style: AssignedStyle;
  memory: DeepMemorySnapshot;
}
