import { type Result, ok, err, createError } from "@splash/utils";

/**
 * Input validators for tool calls and commands.
 * Prevents injection attacks and validates tool arguments.
 */

/** Validate that a string doesn't contain shell injection patterns. */
export function validateNoInjection(input: string): Result<string> {
  const dangerousPatterns = [
    /;\s*(rm|del|format|shutdown|kill)\b/i,
    /\$\(.*\)/, // command substitution
    /`[^`]+`/, // backtick execution
    /\|\s*(bash|sh|cmd|powershell)/i,
    /&&\s*(rm|del|format|shutdown)\b/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      return err(
        createError("safety", `Potential injection detected in input: ${pattern.source}`),
      );
    }
  }

  return ok(input);
}

/** Validate a file path isn't trying to escape a sandbox. */
export function validateFilePath(path: string, allowedRoots: string[] = []): Result<string> {
  const normalized = path.replace(/\\/g, "/");

  // Block path traversal
  if (normalized.includes("../") || normalized.includes("/..")) {
    return err(createError("safety", "Path traversal detected"));
  }

  // Block access to sensitive system paths
  const blockedPaths = [
    "/etc/shadow",
    "/etc/passwd",
    "C:/Windows/System32",
    "/root/.ssh",
    "~/.ssh/id_",
  ];

  for (const blocked of blockedPaths) {
    if (normalized.toLowerCase().includes(blocked.toLowerCase())) {
      return err(createError("safety", `Access to sensitive path blocked: ${blocked}`));
    }
  }

  // If allowed roots are specified, enforce them
  if (allowedRoots.length > 0) {
    const inAllowedRoot = allowedRoots.some((root) => {
      const normalizedRoot = root.replace(/\\/g, "/");
      return normalized.startsWith(normalizedRoot);
    });
    if (!inAllowedRoot) {
      return err(createError("safety", "Path is outside allowed roots"));
    }
  }

  return ok(normalized);
}

/** Validate tool arguments against expected schema shape. */
export function validateToolArgs(
  args: Record<string, unknown>,
  requiredKeys: string[],
): Result<Record<string, unknown>> {
  const missing = requiredKeys.filter((key) => !(key in args));
  if (missing.length > 0) {
    return err(
      createError("validation", `Missing required tool arguments: ${missing.join(", ")}`),
    );
  }
  return ok(args);
}
