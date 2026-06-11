import type {
  AgentPhase,
  AgentState,
  ExecutionEntry,
  Task,
  Message,
  CompletionRequest,
  Result,
  ToolCall,
  AlpClawError,
} from "@alpclaw/utils";
import { ok, err, createError, createLogger, generateId } from "@alpclaw/utils";
import type { AlpClawConfig } from "@alpclaw/config";
import { SafetyEngine } from "@alpclaw/safety";
import { MemoryManager } from "@alpclaw/memory";
import type { ProviderRouter } from "@alpclaw/providers";
import { ConnectorRegistry } from "@alpclaw/connectors";
import { SkillRegistry } from "@alpclaw/skills";
import type { SkillContext } from "@alpclaw/skills";
import { TaskManager } from "./task-manager.js";
import { Verifier } from "./verifier.js";
import { ContractBuilder, type Contract } from "./contract-builder.js";
import { ContractValidator } from "./contract-validator.js";
import { StateMachine } from "./state-machine.js";
import { ContextManager } from "./context-manager.js";
import { ResultCache } from "./cache.js";
import { Reflector, type StepOutcome } from "./reflector.js";
import { Executor, type ExecutionResult } from "./executor.js";
import { SPLASH_MASTER_PROMPT } from "./prompts.js";
import { classifyInput } from "@alpclaw/safety";

const log = createLogger("core:agent");

export interface AgentLoopConfig {
  maxSteps: number;
  maxRetries: number;
  timeoutMs: number;
}

export interface AgentLoopCallbacks {
  onPhaseChange?: (phase: AgentPhase, task: Task) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, output: unknown, ok: boolean) => void;
  onStepComplete?: (step: string, result: unknown) => void;
  onError?: (error: string, phase: AgentPhase) => void;
  onConfirmationRequired?: (action: string, risk: string) => Promise<boolean>;
  onTaskComplete?: (task: Task) => void;
  systemPersona?: string; // Inject character.md here
  onCacheHit?: (key: string) => void;
}

/**
 * AgentLoop is the core orchestrator of AlpClaw.
 *
 * It implements the full agentic cycle:
 * intake → understand → plan → context_fetch → tool_select → execute → verify → correct → finalize → persist
 */
export class AgentLoop {
  private taskManager: TaskManager;
  private verifier: Verifier;
  private config: AgentLoopConfig;

  // v4 Contract Engine
  private contractBuilder: ContractBuilder;
  private contractValidator: ContractValidator;
  private stateMachine: StateMachine;
  private contextManager: ContextManager;
  private cache: ResultCache;
  private reflector: Reflector;
  private executor: Executor;

  constructor(
    private router: ProviderRouter,
    private connectors: ConnectorRegistry,
    private skills: SkillRegistry,
    private safety: SafetyEngine,
    private memory: MemoryManager,
    appConfig: AlpClawConfig,
    private callbacks: AgentLoopCallbacks = {},
  ) {
    this.taskManager = new TaskManager();
    this.verifier = new Verifier();
    this.config = {
      maxSteps: appConfig.agent.maxSteps,
      maxRetries: appConfig.agent.maxRetries,
      timeoutMs: appConfig.agent.timeoutMs,
    };

    // v4 Contract Engine initialization
    this.contractBuilder = new ContractBuilder(router);
    this.contractValidator = new ContractValidator(
      appConfig.safety?.blockedPatterns || [],
    );
    this.stateMachine = new StateMachine();
    this.contextManager = new ContextManager(100_000);
    this.cache = new ResultCache(undefined, appConfig.memory.ttlMs);
    this.reflector = new Reflector({ trash: this.memory.trash });
    this.executor = new Executor(
      router,
      this.contextManager,
      connectors,
      skills,
      safety,
      memory,
      {
        onToolCall: callbacks.onToolCall,
        onConfirmationRequired: callbacks.onConfirmationRequired,
      },
    );
  }

  /**
   * Run the full agent loop for a given task description.
   */
  async run(taskDescription: string): Promise<Result<Task>> {
    const startTime = Date.now();
    const task = this.taskManager.create(taskDescription);
    this.stateMachine.reset();

    log.info("Agent loop started", { taskId: task.id, description: taskDescription.slice(0, 100) });

    // Wire state machine to phase callbacks
    this.stateMachine.onTransition((from, to) => {
      const phaseMap: Record<string, AgentPhase> = {
        building_contract: "plan",
        validating: "plan",
        checking_cache: "context_fetch",
        executing: "execute",
        verifying: "verify",
        correcting: "correct",
        reflecting: "persist",
        done: "finalize",
        failed: "finalize",
      };
      const phase = phaseMap[to];
      if (phase) this.setPhase(task, phase);
    });

    try {
      // ── Intake ─────────────────────────────────────────────────────────────
      this.setPhase(task, "intake");
      task.context.userIntent = taskDescription;

      // ── Build Contract ─────────────────────────────────────────────────────
      this.stateMachine.transition("start");

      const contextHints = await this.memory.getRelevantContext(taskDescription);
      if (this.callbacks.systemPersona) {
        contextHints.unshift(`IMPORTANT PERSONA/SYSTEM PROMPT: ${this.callbacks.systemPersona}`);
      }

      const contractResult = await this.contractBuilder.buildContract(
        taskDescription,
        this.connectors.allToolDefinitions(),
        this.skills.list(),
        contextHints,
      );

      if (!contractResult.ok) {
        this.stateMachine.transition("abort");
        return this.failTask(task, `Contract build failed: ${contractResult.error.message}`);
      }

      const contract = contractResult.value;
      this.stateMachine.transition("contract_built");
      log.info("Contract built", { steps: contract.steps.length, objective: contract.objective.slice(0, 60) });

      // ── Validate Contract ──────────────────────────────────────────────────
      const validation = this.contractValidator.validate(contract);
      if (!validation.valid) {
        this.stateMachine.transition("invalid");
        const reasons = validation.issues.map((i) => i.message).join("; ");
        return this.failTask(task, `Contract validation failed: ${reasons}`);
      }
      this.stateMachine.transition("valid");

      // ── Check Cache ────────────────────────────────────────────────────────
      const cacheKey = ResultCache.hashKey(
        taskDescription,
        JSON.stringify(contextHints),
        "default",
        "default",
      );
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.stateMachine.transition("cache_hit");
        log.info("Cache hit, returning cached result");
        this.callbacks.onCacheHit?.(cacheKey);
        const taskResult = { success: true, output: cached, summary: String(cached), artifacts: [] };
        this.taskManager.complete(task.id, taskResult);
        this.callbacks.onTaskComplete?.(task);
        return ok(task);
      }
      this.stateMachine.transition("cache_miss");

      // ── Create task steps from contract ────────────────────────────────────
      for (const contractStep of contract.steps) {
        this.taskManager.addStep(task.id, contractStep.description, contractStep.tools[0]);
      }
      // ── Execute ────────────────────────────────────────────────────────────
      this.taskManager.setStatus(task.id, "executing");
      const sysContent = this.callbacks.systemPersona || SPLASH_MASTER_PROMPT;
      const execResult: ExecutionResult = await this.executor.execute(contract, sysContent);

      // Sync executor results back into task for observability/compat
      for (const stepResult of execResult.stepResults) {
        this.taskManager.updateStep(task.id, stepResult.stepId, {
          status: stepResult.success ? "completed" : "failed",
          output: stepResult.output,
          error: stepResult.error ? createError("task", stepResult.error) : undefined,
        });
        if (stepResult.success) {
          this.callbacks.onStepComplete?.(stepResult.stepId, stepResult.output);
        }
      }

      // ── Verify ─────────────────────────────────────────────────────────────
      this.stateMachine.transition("all_done");
      this.setPhase(task, "finalize");

      const stepResults = execResult.stepResults.map((s) => ({
        description: `Contract step ${s.stepId}`,
        success: s.success,
        output: s.output,
      }));

      const verification = this.verifier.verifyTaskCompletion(taskDescription, stepResults);
      this.stateMachine.transition(verification.passed ? "verify_pass" : "verify_partial");

      let finalSummary = verification.passed
        ? `Task completed successfully (${task.steps.length} steps)`
        : `Task completed with ${verification.issues.length} issues: ${verification.issues.join("; ")}`;

      if (verification.passed) {
        const summaryPrompt = `The user requested: "${taskDescription}"

I have completed the task in ${task.steps.length} steps. Here are the results of my actions:
${JSON.stringify(stepResults.map(r => ({ desc: r.description, out: String(r.output).substring(0, 500) })))}

Provide a concise, conversational final reply to the user. If they just said a greeting like "hi", simply greet them back. If a complex task was performed, summarize the outcome and provide the final result clearly. Be helpful and natural.`;

        const summaryRes = await this.router.route({
          messages: [
            { role: "system", content: this.callbacks.systemPersona || SPLASH_MASTER_PROMPT },
            { role: "user", content: summaryPrompt }
          ],
          temperature: 0.2,
          maxTokens: 1000
        });

        if (summaryRes.ok && summaryRes.value.content.trim()) {
          finalSummary = summaryRes.value.content.trim();
        }
      }

      const taskResult = {
        success: verification.passed,
        output: stepResults,
        summary: finalSummary,
        tokens: this.contextManager.getTotalSpent(),
        artifacts: task.steps
          .filter((s) => s.output)
          .map((s) => String(s.output))
          .filter((s) => s.length < 200),
      };

      this.taskManager.complete(task.id, taskResult);

      // ── Cache result ───────────────────────────────────────────────────────
      if (verification.passed) {
        this.cache.set(cacheKey, finalSummary);
      }

      // ── Reflect ────────────────────────────────────────────────────────────
      const outcomes: StepOutcome[] = task.steps.map((s) => ({
        stepId: s.id,
        tool: s.toolName || "llm",
        success: s.status === "completed",
        output: s.output ? String(s.output).slice(0, 100) : undefined,
        error: s.error ? s.error.message : undefined,
      }));
      const insights = this.reflector.reflect(outcomes);
      
      const intentClassification = classifyInput(taskDescription);
      if (intentClassification === "adversarial" || intentClassification === "noisy") {
        this.memory.trash.add("task:intent", intentClassification, "User prompt classified as " + intentClassification, taskDescription);
      } else {
        for (const insight of insights) {
          await this.memory.semantic.set(`insight:${insight.tool}:${Date.now()}`, insight.learning);
        }
      }
      this.stateMachine.transition("reflection_done");


      // ── Persist memory ─────────────────────────────────────────────────────
      this.setPhase(task, "persist");
      await this.persistMemory(task);

      const elapsed = Date.now() - startTime;
      log.info("Agent loop completed", {
        taskId: task.id,
        success: taskResult.success,
        steps: task.steps.length,
        elapsed: `${elapsed}ms`,
        tokensBudgetUsed: this.contextManager.getTotalSpent(),
      });

      this.callbacks.onTaskComplete?.(task);
      return ok(task);
    } catch (cause) {
      log.error("Agent loop crashed", { taskId: task.id, error: String(cause) });
      this.stateMachine.transition("abort");
      return this.failTask(task, `Agent loop error: ${cause}`);
    }
  }


  /**
   * Persist useful memory from the task execution.
   */
  private async persistMemory(task: Task): Promise<void> {
    // Record task completion
    await this.memory.remember(
      "task",
      `task:${task.id}`,
      `${task.description} → ${task.result?.success ? "success" : "failed"}: ${task.result?.summary || ""}`,
      { taskId: task.id, status: task.status },
    );

    // Record any failures for learning
    for (const step of task.steps) {
      if (step.status === "failed" && step.error) {
        await this.memory.recordFailure(
          task.id,
          step.error.message,
          step.description,
        );
      }
    }

    // Tool trace is now handled internally by Executor
    // Reflector takes care of summarizing decisions.
  }

  private setPhase(task: Task, phase: AgentPhase): void {
    log.debug("Phase transition", { taskId: task.id, phase });
    this.callbacks.onPhaseChange?.(phase, task);
  }

  private failTask(task: Task, message: string): Result<Task> {
    this.taskManager.complete(task.id, {
      success: false,
      output: null,
      summary: message,
    });
    log.error("Task failed", { taskId: task.id, reason: message });
    return ok(task); // Return the task even on failure so caller can inspect it
  }

  /** Expose task manager for external inspection. */
  getTaskManager(): TaskManager {
    return this.taskManager;
  }
}
