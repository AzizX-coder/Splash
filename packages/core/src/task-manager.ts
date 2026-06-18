import type { Task, TaskStep, TaskContext, TaskResult, TaskStatus } from "@splash/utils";
import { generateId, createLogger } from "@splash/utils";

const log = createLogger("core:task");

/**
 * TaskManager creates and manages task lifecycle.
 */
export class TaskManager {
  private tasks = new Map<string, Task>();

  /** Create a new task. */
  create(description: string, context: Partial<TaskContext> = {}, parentId?: string): Task {
    const task: Task = {
      id: generateId("task"),
      description,
      status: "pending",
      steps: [],
      context: {
        userIntent: description,
        metadata: {},
        ...context,
      },
      parentId,
      retries: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    log.info("Task created", { id: task.id, description: description.slice(0, 80) });
    return task;
  }

  /** Get a task by ID. */
  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** Update task status. */
  setStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      log.debug("Task status updated", { id: taskId, status });
    }
  }

  /** Add a step to a task. Optionally provide a custom step ID (e.g., from contract). */
  addStep(taskId: string, description: string, toolName?: string, stepId?: string): TaskStep {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const step: TaskStep = {
      id: stepId || generateId("step"),
      description,
      status: "pending",
      toolName,
    };

    task.steps.push(step);
    task.updatedAt = Date.now();
    return step;
  }

  /** Add multiple steps with known IDs (for contract sync). */
  addSteps(taskId: string, steps: Array<{ id: string; description: string; toolName?: string }>): TaskStep[] {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    for (const s of steps) {
      const step: TaskStep = { id: s.id, description: s.description, status: "pending", toolName: s.toolName };
      task.steps.push(step);
    }
    task.updatedAt = Date.now();
    return task.steps.slice(-steps.length);
  }

  /** Update a step's status and output. */
  updateStep(
    taskId: string,
    stepId: string,
    update: Partial<Pick<TaskStep, "status" | "output" | "error" | "toolInput">>,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const step = task.steps.find((s) => s.id === stepId);
    if (!step) return;

    Object.assign(step, update);
    if (update.status === "executing") step.startedAt = Date.now();
    if (update.status === "completed" || update.status === "failed") step.completedAt = Date.now();
    task.updatedAt = Date.now();
  }

  /** Complete a task with a result. */
  complete(taskId: string, result: TaskResult): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = result.success ? "completed" : "failed";
    task.result = result;
    task.updatedAt = Date.now();
    log.info("Task completed", { id: taskId, success: result.success });
  }

  /** Increment retry counter. Returns true if retries remain. */
  retry(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.retries++;
    task.updatedAt = Date.now();

    if (task.retries > task.maxRetries) {
      task.status = "failed";
      log.warn("Task max retries exceeded", { id: taskId, retries: task.retries });
      return false;
    }

    task.status = "correcting";
    log.info("Task retrying", { id: taskId, attempt: task.retries });
    return true;
  }

  /** List all tasks. */
  list(): Task[] {
    return Array.from(this.tasks.values());
  }

  /** Get child tasks of a parent. */
  getChildren(parentId: string): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.parentId === parentId);
  }
}
