import React, { useEffect, useState, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { RunManager } from "../runs/run-manager.js";
import type { RunEvent, RunStatus } from "../runs/events.js";
import type { RunRecord } from "../runs/run-store.js";
import { MemoryManager, EpisodicMemory, FileMemoryStore } from "@splash/memory";
import { ContractEvolution } from "../contract-evolution.js";
import { Reflector } from "../reflector.js";
import type { Insight } from "../reflector.js";
import os from "node:os";
import path from "node:path";

/* ------------------------------------------------------------------ */
/*  Branding: neutral, agency-first, no religious/mystical symbols.   */
/* ------------------------------------------------------------------ */

const TICK_MS = 750;

const FRAMES_THINK = ["⠋ ", "⠙ ", "⠹ ", "⠸ ", "⠼ ", "⠴ ", "⠦ ", "⠧ ", "⠇ ", "⠏ "] as const;
const FRAMES_PULSE = ["≈  ", " ≈ ", "  ≈"] as const;

const TABS = [
  { key: "graph", label: "Task" },
  { key: "memory", label: "Memory" },
  { key: "contract", label: "Contract" },
] as const;
type Tab = (typeof TABS)[number]["key"];

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

const CTRL_LIVE =
  "↑/↓ select  ·  s stop  ·  r retry  ·  p pause  ·  v trace  ·  tab switch  ·  q quit";
const CTRL_TRACE =
  "↑/↓ step  ·  space auto  ·  f fast  ·  v live  ·  tab switch  ·  q quit";
const CTRL_MEM = "↑/↓ nav  ·  tab switch  ·  q quit";
const CTRL_CONTRACT = "↑/↓ templates  ·  tab switch  ·  q quit";

/* ------------------------------------------------------------------ */

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
  const [tab, setTab] = useState<Tab>("graph");
  const [viewMode, setViewMode] = useState<"live" | "trace">("live");
  const [traceCursor, setTraceCursor] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState<number | null>(null);

  const storeDir = process.env.SPLASH_HOME ?? path.join(os.homedir(), ".splash");
  const memoryManager = useMemo(() => new MemoryManager(new FileMemoryStore(storeDir)), [storeDir]);
  const reflector = useMemo(() => new Reflector({}), []);
  const contractEvolution = useMemo(() => new ContractEvolution(), []);

  const selected = runs[selectedIdx];

  useEffect(() => {
    const id = setInterval(() => {
      setRuns(manager.list());
      setTick((t) => t + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [manager]);

  useEffect(() => {
    if (!selected) {
      setEvents([]);
      return;
    }
    setEvents(manager.events(selected.id));
    if (paused || viewMode === "trace") return;
    const stop = manager.follow(selected.id, (e) => {
      setEvents((prev) => [...prev.slice(-5000), e]);
    });
    return stop;
  }, [selected?.id, paused, viewMode, manager]);

  useEffect(() => {
    if (viewMode !== "trace" || replaySpeed === null || events.length === 0) return;
    const id = setInterval(() => {
      setTraceCursor((c) => {
        if (c >= events.length - 1) {
          setReplaySpeed(null);
          return c;
        }
        return c + 1;
      });
    }, replaySpeed);
    return () => clearInterval(id);
  }, [viewMode, replaySpeed, events.length]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "\t") {
      setTab((t) => (t === "graph" ? "memory" : t === "memory" ? "contract" : "graph"));
      return;
    }
    if (input === "v" && selected) {
      setViewMode((v) => (v === "live" ? "trace" : "live"));
      setTraceCursor(events.length > 0 ? events.length - 1 : 0);
      setReplaySpeed(null);
      return;
    }
    if (viewMode === "live") {
      if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelectedIdx((i) => Math.min(runs.length - 1, i + 1));
      if (input === "p") setPaused((v) => !v);
      if (input === "s" && selected) manager.stop(selected.id);
      if (input === "r" && selected) void manager.retry(selected.id, { background: true });
    }
    if (viewMode === "trace") {
      if (key.upArrow || input === "k") {
        setTraceCursor((c) => Math.max(0, c - 1));
        setReplaySpeed(null);
      }
      if (key.downArrow || input === "j") {
        setTraceCursor((c) => Math.min(events.length - 1, c + 1));
        setReplaySpeed(null);
      }
      if (input === " ") setReplaySpeed((s) => (s === null ? 200 : null));
      if (input === "f") setReplaySpeed((s) => (s === 50 ? null : 50));
    }
  });

  const rightSub =
    tab === "graph" ? (
      <TaskGraphPane record={selected} />
    ) : tab === "memory" ? (
      <MemoryPane memoryManager={memoryManager} reflector={reflector} />
    ) : (
      <ContractPane evolution={contractEvolution} />
    );

  return (
    <Box flexDirection="column" width="100%">
      <Header tick={tick} activeTab={tab} />
      <Box flexDirection="row">
        <RunsPane runs={runs} selectedIdx={selectedIdx} />
        <Box flexDirection="column" flexGrow={1}>
          <TabBar active={tab} onChange={setTab} />
          {rightSub}
          <ResourcesPane record={selected} />
          <LogsPane
            events={events}
            paused={paused}
            viewMode={viewMode}
            traceCursor={traceCursor}
            replaySpeed={replaySpeed}
          />
        </Box>
      </Box>
      <StatusBar paused={paused} viewMode={viewMode} tab={tab} />
    </Box>
  );
}

/* ---- Header ---- */

function Header({ tick, activeTab }: { tick: number; activeTab: Tab }): React.ReactElement {
  const frame = FRAMES_PULSE[tick % FRAMES_PULSE.length] ?? "≈";
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        Splash
      </Text>
      <Text color="gray"> · </Text>
      <Text color="white">Agent Dashboard</Text>
      <Text color="gray">  {frame}</Text>
      <Text color="gray"> [{activeTab}] </Text>
    </Box>
  );
}

/* ---- Runs ---- */

function RunsPane({ runs, selectedIdx }: { runs: RunRecord[]; selectedIdx: number }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} width={32}>
      <Text color="cyan" bold>
        Runs
      </Text>
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

/* ---- Tab bar ---- */

function TabBar(props: { active: Tab; onChange: (t: Tab) => void }): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="gray">Views: </Text>
      {TABS.map(({ key, label }) => {
        const on = key === props.active;
        return (
          <Box key={key}>
            <Text color={on ? "cyan" : "gray"} bold={on}>
              [{label}]
            </Text>
            <Text color="gray"> </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/* ---- Task Graph ---- */

function TaskGraphPane({ record }: { record: RunRecord | undefined }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} height={10}>
      <Text color="cyan" bold>
        Task Graph
      </Text>
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

/* ---- Memory pane ---- */

function MemoryPane({
  memoryManager,
  reflector,
}: {
  memoryManager: MemoryManager;
  reflector: Reflector;
}): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [episodes, setEpisodes] = useState<{ sessionId: string; mtimeMs: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!alive) return;
      setInsights(reflector.loadInsights());
      setEpisodes(memoryManager.episodic.getAllSessions());
    };
    load();
    const id = setInterval(load, TICK_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [memoryManager, reflector]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow || input === "j")
      setCursor((c) => Math.min(Math.max((insights?.length ?? 0) - 1, 0), c + 1));
    if (input === "\t") return;
  });

  const quality = reflector.getQualityReport();
  const toNumber = (n: unknown) => (typeof n === "number" ? n : 0);

  const bar = (label: string, n: number, color: string) => (
    <Box>
      <Text color="gray">{label}: </Text>
      <Text color={color}>{String(n).padStart(2, "0")} {"█".repeat(Math.min(n, 8))}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} height={10}>
      <Text color="magenta" bold>
        Memory
      </Text>
      <Box flexDirection="row">
        <Box flexDirection="column" width="50%">
          {bar("High", toNumber(quality.high), "green")}
          {bar("Med", toNumber(quality.medium), "yellow")}
          {bar("Low", toNumber(quality.low), "red")}
          <Text color="gray">Insights: </Text>
          <Text color="white">{insights.length}</Text>
        </Box>
        <Box flexDirection="column" width="50%">
          <Text color="gray">Recent sessions</Text>
          {episodes.slice(0, 4).map((s, idx) => (
            <Text key={idx} color="white">
              {s.sessionId.slice(0, 12)}
            </Text>
          ))}
          {episodes.length === 0 && <Text color="gray"> none</Text>}
        </Box>
      </Box>
      <Box flexWrap="wrap">
        <Text color="gray">
          Top reflection:{" "}
          {insights.length > 0 ? (
            <Text color="cyan">{insights[Math.min(cursor, insights.length - 1)]?.learning.slice(0, 100)}</Text>
          ) : (
            " — "
          )}
        </Text>
      </Box>
    </Box>
  );
}

/* ---- Contract pane ---- */

function ContractPane({
  evolution,
}: {
  evolution: ContractEvolution;
}): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [templates, setTemplates] = useState<ReturnType<typeof evolution.all>>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!alive) return;
      setTemplates(evolution.all());
    };
    load();
    const id = setInterval(load, TICK_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [evolution]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow || input === "j")
      setCursor((c) => Math.min(Math.max((templates?.length ?? 0) - 1, 0), c + 1));
    if (input === "\t") return;
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1} height={10}>
      <Text color="blue" bold>
        Contracts
      </Text>
      {templates.length === 0 && <Text color="gray">No templates yet</Text>}
      <Box flexDirection="column">
        {templates.slice(0, 6).map((t, idx) => {
          const active = idx === cursor;
          const icon = t.status === "verified" ? "✓" : t.status === "review" ? "△" : "◈";
          const color = t.status === "verified" ? "green" : t.status === "review" ? "red" : "yellow";
          const rate = t.runs === 0 ? 0 : Number(((t.successes / t.runs) * 100).toFixed(0));
          return (
            <Box key={t.signature}>
              <Text color={active ? "cyan" : "gray"}>{active ? "▸ " : "  "}</Text>
              <Text color={color}>{icon} </Text>
              <Text color="white">
                {t.sample.slice(0, 28)}{" "}
                <Text color="gray">
                  ({String(rate).padStart(3, "0")}% / {String(t.runs).padStart(4, "0")} runs)
                </Text>
              </Text>
            </Box>
          );
        })}
      </Box>
      {templates.length > 0 && (
        <Text color="gray">
          Selected:{" "}
          <Text color="cyan">
            {templates[cursor]?.sample.slice(0, 64)} = {templates[cursor]?.status}
          </Text>
        </Text>
      )}
    </Box>
  );
}

/* ---- Resources ---- */

function ResourcesPane({ record }: { record: RunRecord | undefined }): React.ReactElement {
  const elapsed = useMemo(() => {
    if (!record?.startedAt) return "—";
    const end = record.endedAt ? new Date(record.endedAt).getTime() : Date.now();
    const ms = end - new Date(record.startedAt).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  }, [record?.startedAt, record?.endedAt]);

  const thinking = record?.status === "running";

  return (
    <Box flexDirection="row" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        Resources{" "}
      </Text>
      {record ? (
        <>
          <Text color="white">steps: </Text>
          <Text color="yellow">{record.steps ?? 0}</Text>
          <Text color="white">  tools: </Text>
          <Text color="yellow">{record.toolCalls ?? 0}</Text>
          <Text color="white">  retries: </Text>
          <Text color="yellow">{record.retries ?? 0}</Text>
          <Text color="white">  elapsed: </Text>
          <Text color={thinking ? "green" : "yellow"}>
            {thinking ? <ThinkingAnimation /> : elapsed}
          </Text>
        </>
      ) : (
        <Text color="gray">—</Text>
      )}
    </Box>
  );
}

/* ---- Logs ---- */

interface LogsPaneProps {
  events: RunEvent[];
  paused: boolean;
  viewMode: string;
  traceCursor: number;
  replaySpeed: number | null;
}

function LogsPane(props: LogsPaneProps): React.ReactElement {
  const { events, paused, viewMode, traceCursor, replaySpeed } = props;
  const isTrace = viewMode === "trace";
  const displayEvents = isTrace
    ? events.slice(Math.max(0, traceCursor - 17), traceCursor + 1)
    : events.slice(-18);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isTrace ? "magenta" : "cyan"} paddingX={1} height={22}>
      <Text color={isTrace ? "magenta" : "cyan"} bold>
        {isTrace ? `Trace Replay (${traceCursor + 1}/${events.length})` : "Live Logs"}
        {!isTrace && paused ? <Text color="yellow"> (paused)</Text> : null}
        {isTrace && replaySpeed !== null ? <Text color="green"> (playing {replaySpeed}ms)</Text> : null}
      </Text>
      {displayEvents.map((e, i) => {
        const isFocus = isTrace && displayEvents.length - 1 === i;
        const typeColor = eventColorForType((e as any).type as string);
        return (
          <Text key={i} color={typeColor} backgroundColor={isFocus ? "gray" : undefined} bold={isFocus}>
            {formatEvent(e)}
          </Text>
        );
      })}
    </Box>
  );
}

/* ---- Status bar ---- */

function StatusBar({ paused, viewMode, tab }: { paused: boolean; viewMode: string; tab: Tab }): React.ReactElement {
  const ctrl =
    viewMode === "trace" ? CTRL_TRACE : tab === "memory" ? CTRL_MEM : tab === "contract" ? CTRL_CONTRACT : CTRL_LIVE;
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">{ctrl}</Text>
    </Box>
  );
}

/* ---- Thinking animation ---- */

export function ThinkingAnimation(): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES_THINK.length), 80);
    return () => clearInterval(id);
  }, []);
  return <Text color="green">{FRAMES_THINK[frame] ?? "⠋"}</Text>;
}

/* ---- Helpers ---- */

function eventColorForType(type: string): string {
  switch (type) {
    case "RunCompleted":
    case "CacheHit":
      return "green";
    case "RunFailed":
    case "RunCancelled":
      return "gray";
    case "PhaseChanged":
    case "WebCrawl":
      return "cyan";
    case "ToolCalled":
    case "WebSearch":
      return "blue";
    case "LogLine":
      return "white"; // log text may itself contain warnings; EventFormatter can override if needed
    default:
      return "white";
  }
}

function formatEvent(e: RunEvent): string {
  const t = new Date(e.at).toISOString().slice(11, 19);
  const detail = (() => {
    switch (e.type) {
      case "RunCreated":
        return `created (${e.mode})`;
      case "RunStarted":
        return "started";
      case "PhaseChanged":
        return `phase → ${e.phase}`;
      case "ToolCalled":
        return `⚡ ${e.tool}`;
      case "LogLine":
        return e.text;
      case "RunCompleted":
        return `✓ completed (${e.steps ?? 0} steps)`;
      case "RunFailed":
        return `✗ failed: ${e.error}`;
      case "RunCancelled":
        return `⊘ cancelled${e.reason ? `: ${e.reason}` : ""}`;
      case "CacheHit":
        return `⚡ cache hit! bypassed execution`;
      case "WebSearch":
        return `🔍 searching: "${e.query.slice(0, 40)}"`;
      case "WebCrawl":
        return `🕷 crawl ${e.url.slice(0, 50)}`;
      default: {
        // Exhaustiveness guard: TS narrows e to never in default for exhaustive unions.
        const _e: never = e;
        void _e;
        return "";
      }
    }
  })();
  return `[${t}] ${detail}`;
}
