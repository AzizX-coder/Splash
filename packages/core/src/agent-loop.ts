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
import { Planner } from "./planner.js";
import { Verifier } from "./verifier.js";
import { SelfCorrector } from "./self-corrector.js";

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
}

/**
 * AgentLoop is the core orchestrator of AlpClaw.
 *
 * It implements the full agentic cycle:
 * intake → understand → plan → context_fetch → tool_select → execute → verify → correct → finalize → persist
 */
export class AgentLoop {
  private taskManager: TaskManager;
  private planner: Planner;
  private verifier: Verifier;
  private corrector: SelfCorrector;
  private config: AgentLoopConfig;
  private stepAttempts = new Map<string, number>();
  private toolTrace: Array<{ tool: string; args: Record<string, unknown>; ok: boolean; output?: unknown; error?: string }> = [];

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
    this.planner = new Planner(router);
    this.verifier = new Verifier();
    this.corrector = new SelfCorrector(router);
    this.config = {
      maxSteps: appConfig.agent.maxSteps,
      maxRetries: appConfig.agent.maxRetries,
      timeoutMs: appConfig.agent.timeoutMs,
    };
  }

  /**
   * Run the full agent loop for a given task description.
   */
  async run(taskDescription: string): Promise<Result<Task>> {
    const startTime = Date.now();
    const task = this.taskManager.create(taskDescription);

    log.info("Agent loop started", { taskId: task.id, description: taskDescription.slice(0, 100) });

    try {
      // Phase 1: Intake
      this.setPhase(task, "intake");
      task.context.userIntent = taskDescription;

      // Phase 2: Understand — use LLM to clarify the task
      this.setPhase(task, "understand");
      const understanding = await this.understand(task);
      if (!understanding.ok) {
        return this.failTask(task, understanding.error.message);
      }

      // Phase 3: Plan — break task into steps
      this.setPhase(task, "plan");
      this.taskManager.setStatus(task.id, "planning");
      
      const contextHints = await this.memory.getRelevantContext(taskDescription);
      if (this.callbacks.systemPersona) {
         contextHints.unshift(`IMPORTANT PERSONA/SYSTEM PROMPT: ${this.callbacks.systemPersona}`);
      }

      const planResult = await this.planner.createPlan(
        understanding.value,
        this.connectors.allToolDefinitions(),
        this.skills.list(),
        contextHints,
      );

      if (!planResult.ok) {
        return this.failTask(task, `Planning failed: ${planResult.error.message}`);
      }

      const plan = planResult.value;
      log.info("Plan created", { steps: plan.steps.length, complexity: plan.estimatedComplexity });

      // Create task steps from plan
      for (const planStep of plan.steps) {
        this.taskManager.addStep(task.id, planStep.description, planStep.toolOrSkill);
      }

      // Phase 4-7: Execute each step
      this.taskManager.setStatus(task.id, "executing");
      let stepIndex = 0;

      for (const step of task.steps) {
        // Check timeout
        if (Date.now() - startTime > this.config.timeoutMs) {
          return this.failTask(task, "Task timed out");
        }

        // Check max steps
        if (stepIndex >= this.config.maxSteps) {
          return this.failTask(task, "Maximum steps exceeded");
        }

        // Phase 4: Context fetch (per-step)
        this.setPhase(task, "context_fetch");

        // Phase 5: Tool select
        this.setPhase(task, "tool_select");

        // Phase 6: Execute
        this.setPhase(task, "execute");
        this.taskManager.updateStep(task.id, step.id, { status: "executing" });

        const execResult = await this.executeStep(task, step.description, step.toolName);

        // Phase 7: Verify
        this.setPhase(task, "verify");
        this.taskManager.setStatus(task.id, "verifying");

        if (!execResult.ok) {
          // Phase 8: Self-correct (per-step retry budget)
          this.setPhase(task, "correct");
          this.callbacks.onError?.(execResult.error.message, "execute");
          const corrected = await this.selfCorrect(task, step, execResult.error);

          if (!corrected) {
            this.taskManager.updateStep(task.id, step.id, {
              status: "failed",
              error: execResult.error,
            });
            // Continue with next steps if possible, don't abort entire task
            log.warn("Step failed after correction attempts", { stepId: step.id });
          }
        } else {
          this.taskManager.updateStep(task.id, step.id, {
            status: "completed",
            output: execResult.value,
          });
          this.callbacks.onStepComplete?.(step.description, execResult.value);
        }

        stepIndex++;
      }

      // Phase 9: Finalize
      this.setPhase(task, "finalize");
      const stepResults = task.steps.map((s) => ({
        description: s.description,
        success: s.status === "completed",
        output: s.output,
      }));

      const verification = this.verifier.verifyTaskCompletion(taskDescription, stepResults);

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
            { role: "system", content: this.callbacks.systemPersona || "You are Splash, a helpful and highly capable autonomous agent." },
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
        artifacts: task.steps
          .filter((s) => s.output)
          .map((s) => String(s.output))
          .filter((s) => s.length < 200),
      };

      this.taskManager.complete(task.id, taskResult);

      // Phase 10: Persist memory
      this.setPhase(task, "persist");
      await this.persistMemory(task);

      const elapsed = Date.now() - startTime;
      log.info("Agent loop completed", {
        taskId: task.id,
        success: taskResult.success,
        steps: task.steps.length,
        elapsed: `${elapsed}ms`,
        toolCalls: this.toolTrace.length,
      });

      this.callbacks.onTaskComplete?.(task);
      return ok(task);
    } catch (cause) {
      log.error("Agent loop crashed", { taskId: task.id, error: String(cause) });
      return this.failTask(task, `Agent loop error: ${cause}`);
    }
  }

  /**
   * Understand phase — clarifies the task using LLM if needed.
   */
  private async understand(task: Task): Promise<Result<string>> {
    // For straightforward tasks, just return the intent directly
    const intent = task.context.userIntent;
    if (intent.length < 200) {
      return ok(intent);
    }

    // For complex tasks, use LLM to distill
    const sysContent = this.callbacks.systemPersona ? 
      `You are distilling a task based on this persona: ${this.callbacks.systemPersona}\nDistill the following task into a clear, actionable description. Return only the distilled task.` :
      "Distill the following task into a clear, actionable description. Keep it concise. Return only the distilled task.";

    const messages: Message[] = [
      {
        role: "system",
        content: sysContent,
      },
      { role: "user", content: intent },
    ];

    const result = await this.router.route(
      { messages, temperature: 0.1, maxTokens: 500 },
      { taskType: "reasoning" },
    );

    if (!result.ok) return ok(intent); // fallback to original
    return ok(result.value.content.trim());
  }

  /**
   * Execute a single step, dispatching to connector or skill.
   */
  private async executeStep(
    task: Task,
    description: string,
    toolOrSkill?: string,
  ): Promise<Result<unknown>> {
    // Try to match a skill first
    if (toolOrSkill) {
      const skill = this.skills.get(toolOrSkill);
      if (skill) {
        return this.executeSkill(task, skill.manifest.name, description);
      }

      // Try connector action
      const connectorMatch = this.connectors.findByAction(toolOrSkill);
      if (connectorMatch) {
        // Use LLM to determine proper arguments
        const args = await this.resolveToolArgs(toolOrSkill, description);
        if (!args.ok) return args;

        // Safety check
        const verdict = this.safety.evaluate(
          toolOrSkill,
          JSON.stringify(args.value),
        );
        if (!verdict.allowed) {
          return err(createError("safety", `Blocked by safety: ${verdict.reason}`));
        }
        if (verdict.requiresConfirmation) {
          const confirmed = await this.callbacks.onConfirmationRequired?.(
            toolOrSkill,
            verdict.riskLevel,
          );
          if (!confirmed) {
            return err(createError("safety", "User declined confirmation"));
          }
        }

        this.callbacks.onToolCall?.(toolOrSkill, args.value);
        const result = await connectorMatch.connector.execute(connectorMatch.action, args.value);
        this.recordToolResult(toolOrSkill, args.value, result);
        return result;
      }
    }

    // No direct tool match — use LLM to determine what to do
    return this.executeWithLLM(task, description);
  }

  /**
   * Execute a step by asking the LLM to use available tools.
   */
  private async executeWithLLM(task: Task, stepDescription: string): Promise<Result<unknown>> {
    const tools = this.connectors.allToolDefinitions();
    const contextHints = await this.memory.getRelevantContext(stepDescription);

    const messages: Message[] = [
      {
        role: "system",
        content: `You are an autonomous agent executing a task step. Use the available tools to accomplish the step.

Task: ${task.description}
Current step: ${stepDescription}

${contextHints.length > 0 ? `Context:\n${contextHints.join("\n")}` : ""}

Use tools when needed. If no tool is needed, respond with your result directly.`,
      },
      { role: "user", content: stepDescription },
    ];

    const request: CompletionRequest = {
      messages,
      tools,
      temperature: 0.2,
      maxTokens: 4096,
    };

    const result = await this.router.route(request, { requireTools: true });
    if (!result.ok) return result;

    // If the LLM made tool calls, execute them
    if (result.value.toolCalls && result.value.toolCalls.length > 0) {
      return this.executeToolCalls(result.value.toolCalls);
    }

    // Otherwise return the LLM's text response
    return ok(result.value.content);
  }

  /**
   * Execute tool calls from LLM response.
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<Result<unknown>> {
    const results: unknown[] = [];

    for (const tc of toolCalls) {
      // Safety check each tool call
      const verdict = this.safety.evaluate(tc.name, JSON.stringify(tc.arguments));
      if (!verdict.allowed) {
        log.warn("Tool call blocked by safety", { tool: tc.name, reason: verdict.reason });
        continue;
      }
      if (verdict.requiresConfirmation) {
        const confirmed = await this.callbacks.onConfirmationRequired?.(
          tc.name,
          verdict.riskLevel,
        );
        if (!confirmed) continue;
      }

      const match = this.connectors.findByAction(tc.name);
      if (!match) {
        log.warn("Unknown tool in LLM response", { tool: tc.name });
        continue;
      }

      this.callbacks.onToolCall?.(tc.name, tc.arguments);
      const result = await match.connector.execute(match.action, tc.arguments);
      this.recordToolResult(tc.name, tc.arguments, result);
      if (result.ok) {
        // TOKEN MINIMIZATION: compress massive execution outputs to save LLM tokens over multi-step tasks.
        let outputStr = typeof result.value === "string" ? result.value : JSON.stringify(result.value);
        if (outputStr && outputStr.length > 800) {
           outputStr = outputStr.substring(0, 250) + "\n...[TRUNCATED FOR TOKEN MINIMIZATION]...\n" + outputStr.substring(outputStr.length - 250);
        }
        results.push(outputStr);
      } else {
        results.push({ error: result.error.message });
      }
    }

    return ok(results.length === 1 ? results[0] : results);
  }

  /** Record a tool call in the trace + fire observability callback. */
  private recordToolResult(
    tool: string,
    args: Record<string, unknown>,
    result: Result<unknown>,
  ): void {
    this.toolTrace.push(
      result.ok
        ? { tool, args, ok: true, output: result.value }
        : { tool, args, ok: false, error: result.error.message },
    );
    this.callbacks.onToolResult?.(tool, result.ok ? result.value : result.error, result.ok);
  }

  /** Expose recent tool call trace (for UI / debugging). */
  getToolTrace(): ReadonlyArray<{ tool: string; args: Record<string, unknown>; ok: boolean; output?: unknown; error?: string }> {
    return this.toolTrace;
  }

  /**
   * Execute a skill by name.
   */
  private async executeSkill(
    task: Task,
    skillName: string,
    description: string,
  ): Promise<Result<unknown>> {
    const skill = this.skills.get(skillName);
    if (!skill) return err(createError("skill", `Skill not found: ${skillName}`));

    // Build skill context
    const ctx: SkillContext = {
      runConnector: async (action, args) => {
        const match = this.connectors.findByAction(action);
        if (!match) return err(createError("connector", `Unknown action: ${action}`));
        return match.connector.execute(match.action, args);
      },
      complete: async (prompt, opts) => {
        const messages: Message[] = [{ role: "user", content: prompt }];
        const result = await this.router.route(
          { messages, temperature: opts?.temperature, maxTokens: 2000, model: opts?.model },
        );
        if (!result.ok) return result as Result<never>;
        return ok(result.value.content);
      },
      log: (message, data) => log.info(`[skill:${skillName}] ${message}`, data),
    };

    // Resolve params using LLM
    const params = await this.resolveSkillParams(skillName, description);

    const result = await skill.execute(params.ok ? params.value : {}, ctx);
    if (!result.ok) return result;

    return ok(result.value);
  }

  /**
   * Use LLM to determine tool arguments from step description.
   */
  private async resolveToolArgs(
    toolName: string,
    description: string,
  ): Promise<Result<Record<string, unknown>>> {
    const match = this.connectors.findByAction(toolName);
    if (!match) return ok({});

    const actions = match.connector.listActions();
    const action = actions.find((a) => `${match.connector.name}.${a.name}` === toolName);
    if (!action) return ok({});

    const messages: Message[] = [
      {
        role: "system",
        content: `Extract the parameters for the tool "${toolName}" from the description.
Schema: ${JSON.stringify(action.parameters)}
Return only a JSON object with the parameters. No explanation.`,
      },
      { role: "user", content: description },
    ];

    const result = await this.router.route({ messages, temperature: 0, maxTokens: 500 });
    if (!result.ok) return ok({});

    try {
      const jsonMatch = result.value.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return ok({});
      return ok(JSON.parse(jsonMatch[0]) as Record<string, unknown>);
    } catch {
      return ok({});
    }
  }

  /**
   * Use LLM to determine skill parameters from step description.
   */
  private async resolveSkillParams(
    skillName: string,
    description: string,
  ): Promise<Result<Record<string, unknown>>> {
    const skill = this.skills.get(skillName);
    if (!skill) return ok({});

    const messages: Message[] = [
      {
        role: "system",
        content: `Extract parameters for skill "${skillName}".
Schema: ${JSON.stringify(skill.manifest.parameters)}
Return only JSON. No explanation.`,
      },
      { role: "user", content: description },
    ];

    const result = await this.router.route({ messages, temperature: 0, maxTokens: 500 });
    if (!result.ok) return ok({});

    try {
      const jsonMatch = result.value.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return ok({});
      return ok(JSON.parse(jsonMatch[0]) as Record<string, unknown>);
    } catch {
      return ok({});
    }
  }

  /**
   * Self-correction loop for a failed step.
   */
  private async selfCorrect(
    task: Task,
    step: { id: string; description: string; toolName?: string },
    error: AlpClawError,
  ): Promise<boolean> {
    const attempts = (this.stepAttempts.get(step.id) || 0) + 1;
    this.stepAttempts.set(step.id, attempts);
    if (attempts > this.config.maxRetries) {
      log.warn("Step exceeded max retries", { stepId: step.id, attempts });
      return false;
    }
    this.taskManager.setStatus(task.id, "correcting");

    const verification = this.verifier.verifyToolOutput(
      step.toolName || "unknown",
      {},
      null,
      error,
    );

    const strategy = await this.corrector.analyze(
      step.description,
      {},
      verification,
      attempts - 1,
      error,
    );

    if (!strategy.ok) return false;

    switch (strategy.value.action) {
      case "retry": {
        log.info("Retrying step", { stepId: step.id });
        const retryResult = await this.executeStep(task, step.description, step.toolName);
        if (retryResult.ok) {
          this.taskManager.updateStep(task.id, step.id, {
            status: "completed",
            output: retryResult.value,
          });
          return true;
        }
        return false;
      }

      case "adjust_params": {
        log.info("Retrying with adjusted params", { stepId: step.id });
        const retryResult = await this.executeStep(
          task,
          `${step.description} (adjusted: ${JSON.stringify(strategy.value.adjustedParams)})`,
          step.toolName,
        );
        if (retryResult.ok) {
          this.taskManager.updateStep(task.id, step.id, {
            status: "completed",
            output: retryResult.value,
          });
          return true;
        }
        return false;
      }

      case "use_different_tool": {
        log.info("Trying different tool", {
          stepId: step.id,
          newTool: strategy.value.alternativeTool,
        });
        const retryResult = await this.executeStep(
          task,
          step.description,
          strategy.value.alternativeTool,
        );
        if (retryResult.ok) {
          this.taskManager.updateStep(task.id, step.id, {
            status: "completed",
            output: retryResult.value,
          });
          return true;
        }
        return false;
      }

      case "abort":
        log.warn("Self-correction aborted", { reason: strategy.value.reasoning });
        return false;

      case "ask_user":
        this.callbacks.onError?.(
          `Step "${step.description}" needs user input: ${strategy.value.reasoning}`,
          "correct",
        );
        return false;

      default:
        return false;
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

    // Record successful tool strategies — helps future planning
    if (task.result?.success) {
      const succeeded = this.toolTrace.filter((t) => t.ok).map((t) => t.tool);
      const uniqueTools = Array.from(new Set(succeeded));
      if (uniqueTools.length > 0) {
        await this.memory.remember(
          "decision",
          `tools-for:${task.description.slice(0, 40)}`,
          `Useful tools for "${task.description.slice(0, 80)}": ${uniqueTools.join(", ")}`,
          { taskId: task.id, tools: uniqueTools },
        );
      }
    }
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
