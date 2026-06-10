import React, { useEffect, useState, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { RunManager } from "../runs/run-manager.js";
import type { RunEvent, RunStatus } from "../runs/events.js";
import type { RunRecord } from "../runs/run-store.js";

/**
 * Splash TUI dashboard — 4-pane runs monitor built on Ink.
 *
 * Panes:
 *   Runs        list + status badges
 *   Live Logs   streaming events for selected run
 *   Task Graph  current phase + step counter
 *   Resources   tool calls / retries / elapsed
 *   Controls    keyboard shortcuts
 */

const STATUS_COLOR: Record<RunStatus, string> = {
  queued: "yellow",
  running: "cyan",
  succeeded: "green",
  failed: "red",
  cancelled: "gray",
};

const STATUS_ICON: Record<RunStatus, string> = {
  queued: "○",
  running: "◌",
  succeeded: "✓",
  failed: "✗",
  cancelled: "⊘",
};

const PHASES = [
  "intake",
  "understand",
  "plan",
  "context_fetch",
  "tool_select",
  "execute",
  "verify",
  "correct",
  "finalize",
  "persist",
];

interface AppProps {
  manager: RunManager;
}

export function TuiApp({ manager }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [runs, setRuns] = useState<RunRecord[]>(() => manager.list());
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);

  const selected = runs[selectedIdx];

  useEffect(() => {
    const timer = setInterval(() => {
      setRuns(manager.list());
      setTick((t) => t + 1);
    }, 750);
    return () => clearInterval(timer);
  }, [manager]);

  useEffect(() => {
    if (!selected) {
      setEvents([]);
      return;
    }
    setEvents(manager.events(selected.id));
    if (paused) return;
    const stop = manager.follow(selected.id, (e) => {
      setEvents((prev) => [...prev.slice(-500), e]);
    });
    return stop;
  }, [selected?.id, paused, manager]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(runs.length - 1, i + 1));
    if (input === "p") setPaused((v) => !v);
    if (input === "s" && selected) manager.stop(selected.id);
    if (input === "r" && selected) void manager.retry(selected.id, { background: true });
    if (input === "l" && selected) setEvents(manager.events(selected.id));
  });

  return (
    <Box flexDirection="column" width="100%">
      <Header tick={tick} />
      <Box flexDirection="row">
        <RunsPane runs={runs} selectedIdx={selectedIdx} />
        <Box flexDirection="column" flexGrow={1}>
          <TaskGraphPane record={selected} />
          <ResourcesPane record={selected} />
          <LogsPane events={events} paused={paused} />
        </Box>
      </Box>
      <ControlsPane paused={paused} />
    </Box>
  );
}

function Header({ tick }: { tick: number }): React.ReactElement {
  const pulse = ["≈  ", " ≈ ", "  ≈"][tick % 3]!;
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>💧 Splash</Text>
      <Text color="gray"> · </Text>
      <Text color="white">Autonomous Agent Dashboard</Text>
      <Text color="gray">   {pulse}</Text>
    </Box>
  );
}

function RunsPane({ runs, selectedIdx }: { runs: RunRecord[]; selectedIdx: number }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} width={32}>
      <Text color="cyan" bold>Runs</Text>
      {runs.length === 0 && <Text color="gray">(none yet)</Text>}
      {runs.slice(0, 20).map((r, i) => {
        const active = i === selectedIdx;
        return (
          <Box key={r.id}>
            <Text color={STATUS_COLOR[r.status]}>
              {active ? "▸ " : "  "}
              {STATUS_ICON[r.status]} {r.task.slice(0, 22)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function TaskGraphPane({ record }: { record: RunRecord | undefined }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>Task Graph</Text>
      {!record ? (
        <Text color="gray">Select a run</Text>
      ) : (
        <Box flexWrap="wrap">
          {PHASES.map((phase, idx) => {
            const isCurrent = record.phase === phase;
            const completed = record.phase ? PHASES.indexOf(record.phase) > idx : false;
            const color = isCurrent ? "cyan" : completed ? "green" : "gray";
            return (
              <Text key={phase} color={color}>
                {isCurrent ? "◉ " : completed ? "✓ " : "○ "}
                {phase}
                {idx < PHASES.length - 1 ? "  " : ""}
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function ResourcesPane({ record }: { record: RunRecord | undefined }): React.ReactElement {
  const elapsed = useMemo(() => {
    if (!record?.startedAt) return "—";
    const end = record.endedAt ? new Date(record.endedAt).getTime() : Date.now();
    const ms = end - new Date(record.startedAt).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  }, [record?.startedAt, record?.endedAt]);

  return (
    <Box flexDirection="row" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>Resources  </Text>
      {record ? (
        <>
          <Text color="white">steps: </Text>
          <Text color="yellow">{record.steps}</Text>
          <Text color="white">  tools: </Text>
          <Text color="yellow">{record.toolCalls}</Text>
          <Text color="white">  retries: </Text>
          <Text color="yellow">{record.retries}</Text>
          {record.tokens !== undefined && (
             <>
               <Text color="white">  tokens: </Text>
               <Text color="yellow">{record.tokens}</Text>
             </>
          )}
          <Text color="white">  elapsed: </Text>
          <Text color="yellow">{elapsed}</Text>
        </>
      ) : (
        <Text color="gray">—</Text>
      )}
    </Box>
  );
}

function LogsPane({ events, paused }: { events: RunEvent[]; paused: boolean }): React.ReactElement {
  const tail = events.slice(-18);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} height={22}>
      <Text color="cyan" bold>
        Live Logs {paused ? <Text color="yellow">(paused)</Text> : null}
      </Text>
      {tail.map((e, i) => (
        <Text key={i} color={eventColor(e)}>
          {formatEvent(e)}
        </Text>
      ))}
    </Box>
  );
}

function ControlsPane({ paused }: { paused: boolean }): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">
        ↑/↓ select  ·  <Text color="cyan">s</Text> stop  ·  <Text color="cyan">r</Text> retry  ·{" "}
        <Text color="cyan">p</Text> {paused ? "resume" : "pause"}  ·  <Text color="cyan">l</Text> reload logs  ·{" "}
        <Text color="cyan">q</Text> quit
      </Text>
    </Box>
  );
}

function eventColor(e: RunEvent): string {
  switch (e.type) {
    case "RunCompleted": return "green";
    case "RunFailed": return "red";
    case "RunCancelled": return "gray";
    case "PhaseChanged": return "cyan";
    case "ToolCalled": return "magenta";
    case "CacheHit": return "green";
    case "WebSearch": return "blue";
    case "WebCrawl": return "cyan";
    case "LogLine": return e.level === "error" ? "red" : e.level === "warn" ? "yellow" : "white";
    default: return "white";
  }
}

function formatEvent(e: RunEvent): string {
  const t = new Date(e.at).toISOString().slice(11, 19);
  switch (e.type) {
    case "RunCreated":   return `[${t}] created (${e.mode})`;
    case "RunStarted":   return `[${t}] started`;
    case "PhaseChanged": return `[${t}] phase → ${e.phase}`;
    case "ToolCalled":   return `[${t}] ⚡ ${e.tool}`;
    case "LogLine":      return `[${t}] ${e.text}`;
    case "RunCompleted": return `[${t}] ✓ completed (${e.steps ?? 0} steps)`;
    case "RunFailed":    return `[${t}] ✗ failed: ${e.error}`;
    case "RunCancelled": return `[${t}] ⊘ cancelled${e.reason ? `: ${e.reason}` : ""}`;
    case "CacheHit":     return `[${t}] ⚡ cache hit! bypassed execution`;
    case "WebSearch":    return `[${t}] 🔍 searching web for: "${e.query}"`;
    case "WebCrawl":     return `[${t}] 🕷️ crawling url: ${e.url.slice(0, 50)}...`;
  }
}
