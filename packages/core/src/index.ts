export { Splash } from "./splash.js";
export { AgentLoop, type AgentLoopCallbacks, type AgentLoopConfig } from "./agent-loop.js";
export { TaskManager } from "./task-manager.js";
export { Planner, type Plan, type PlanStep } from "./planner.js";
export { Verifier, type VerificationResult, type VerifierStrategy, type WeightedCriterion, type WeightedVerification } from "./verifier.js";
export { SelfCorrector, type CorrectionStrategy } from "./self-corrector.js";
export { SelfModifier } from "./self-modifier.js";
export * from "./runs/index.js";
export { TuiApp } from "./tui/app.js";

// v4 Contract Engine
export { ContractBuilder, type Contract, type ContractStep } from "./contract-builder.js";
export { ContractValidator } from "./contract-validator.js";
export { StateMachine } from "./state-machine.js";
export { Executor } from "./executor.js";
export { ContextManager } from "./context-manager.js";
export { ResultCache } from "./cache.js";
export { SemanticCache, type Embedder, type SemanticCacheEntry, type SemanticCacheOptions } from "./semantic-cache.js";
export { resolveFastPath, isFastPath, type FastPathCommand, type FastPathKind } from "./fast-path.js";
export { ContractEvolution, type TemplateStats, type TemplateStatus, type ContractEvolutionOptions } from "./contract-evolution.js";
export {
  shouldAttemptCorrection,
  collectFailedSteps,
  buildCorrectionContract,
  mergeCorrectionResults,
  type FailedStep,
} from "./correction.js";
export { Reflector } from "./reflector.js";
export { PluginManager } from "@splash/plugins";
export { ApiGateway, startGateway } from "./gateway.js";
