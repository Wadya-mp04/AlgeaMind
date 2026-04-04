/**
 * ActivityLog — unified, real-time feed of AI agent actions and
 * environmental events, merged and sorted by simulation timestep.
 *
 * Entry types:
 *   system      — simulation start / reset
 *   weather     — rainfall, storm events
 *   spill       — industrial spill events
 *   season      — season change notifications
 *   intervention— human or agent intervention applied
 *   agent       — agent reasoning note
 */
import React, { useEffect, useRef } from "react";
import {
  Bot,
  CloudRain,
  Factory,
  Leaf,
  RefreshCw,
  Sunset,
  Zap,
} from "lucide-react";
import type { InterventionRecord, SimulationState } from "../data/types";
import { ACTION_META } from "../data/types";
import type { AgentAction, RLStats } from "../hooks/useSimulation";

// ─── Types ────────────────────────────────────────────────────────────────────

type EntryKind = "system" | "weather" | "spill" | "season" | "intervention" | "agent";

interface LogEntry {
  id:        string;
  t:         number;
  kind:      EntryKind;
  message:   string;
  detail?:   string;
  color:     string;
  actionId?: number;
}

interface ActivityLogProps {
  state:          SimulationState | null;
  lastAgentAction: import("../data/types").AgentAction | null;
  agentLiveType:  string;
  rlStats:        RLStats | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyEvent(msg: string): EntryKind {
  if (msg.includes("spill") || msg.includes("⚠"))            return "spill";
  if (msg.includes("rain")  || msg.includes("🌧"))           return "weather";
  if (msg.includes("Season") || msg.includes("season"))      return "season";
  if (msg.includes("initialised") || msg.includes("reset"))  return "system";
  if (msg.includes("▶"))                                     return "intervention";
  return "system";
}

function kindColor(kind: EntryKind): string {
  switch (kind) {
    case "spill":        return "#f97316";
    case "weather":      return "#60a5fa";
    case "season":       return "#a78bfa";
    case "intervention": return "#2dba57";
    case "agent":        return "#4a9eff";
    default:             return "#6b7280";
  }
}

function KindIcon({ kind, size = 11 }: { kind: EntryKind; size?: number }) {
  const cls = `flex-shrink-0`;
  switch (kind) {
    case "spill":        return <Factory   size={size} className={cls} />;
    case "weather":      return <CloudRain size={size} className={cls} />;
    case "season":       return <Sunset    size={size} className={cls} />;
    case "intervention": return <Leaf      size={size} className={cls} />;
    case "agent":        return <Bot       size={size} className={cls} />;
    default:             return <RefreshCw size={size} className={cls} />;
  }
}

/** Parse the timestep out of backend event strings like "[t=42] message..." */
function parseEvent(raw: string, idx: number): LogEntry {
  const m    = raw.match(/^\[t=(\d+)\]\s*(.+)$/);
  const t    = m ? parseInt(m[1]) : 0;
  const msg  = m ? m[2] : raw;
  const kind = classifyEvent(msg);
  return {
    id:      `ev-${idx}-${t}`,
    t,
    kind,
    message: msg,
    color:   kindColor(kind),
  };
}

function buildFeed(
  events:        string[],
  interventions: InterventionRecord[],
  lastAgent:     AgentAction | null,
  agentType:     string,
  rlStats:       RLStats | null,
): LogEntry[] {
  const entries: LogEntry[] = [];

  // Environmental events
  events.forEach((ev, i) => entries.push(parseEvent(ev, i)));

  // Recorded interventions (human + agent)
  interventions.forEach((inv, i) => {
    const meta = ACTION_META.find(a => a.id === inv.action_id);
    entries.push({
      id:       `inv-${i}-${inv.timestep}`,
      t:        inv.timestep,
      kind:     "intervention",
      message:  `${inv.action_name}`,
      detail:   `→ (${inv.row}, ${inv.col})`,
      color:    meta?.color ?? "#2dba57",
      actionId: inv.action_id,
    });
  });

  // Latest agent action with reasoning
  if (lastAgent && lastAgent.reasoning) {
    const meta = ACTION_META.find(a => a.id === lastAgent.action_id);
    const rlTag = agentType === "rl" && rlStats
      ? ` [ε=${rlStats.epsilon.toFixed(3)}, ${rlStats.total_steps} steps]`
      : "";
    entries.push({
      id:       `agent-last`,
      t:        999999,   // pin to top (most recent)
      kind:     "agent",
      message:  `${agentType.toUpperCase()}: ${lastAgent.action_name}${rlTag}`,
      detail:   lastAgent.reasoning,
      color:    meta?.color ?? "#4a9eff",
      actionId: lastAgent.action_id,
    });
  }

  // Sort newest first
  entries.sort((a, b) => b.t - a.t);

  // Deduplicate by id
  const seen = new Set<string>();
  return entries.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ActivityLog: React.FC<ActivityLogProps> = ({
  state,
  lastAgentAction,
  agentLiveType,
  rlStats,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const feed = state
    ? buildFeed(
        state.recent_events,
        state.recent_interventions,
        lastAgentAction,
        agentLiveType,
        rlStats,
      )
    : [];

  // Auto-scroll to top (newest entry) when feed changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [feed.length]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a3050] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
        <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider">
          Activity Log
        </span>
        <span className="ml-auto text-[9px] text-gray-600">{feed.length} entries</span>
      </div>

      {/* Legend pills */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-1.5 border-b border-[#1a3050]/60 flex-shrink-0">
        {(["agent", "intervention", "weather", "spill", "season"] as EntryKind[]).map(k => (
          <span key={k} className="flex items-center gap-1 text-[9px]" style={{ color: kindColor(k) }}>
            <KindIcon kind={k} size={9} />
            {k}
          </span>
        ))}
      </div>

      {/* Scrollable feed */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0 px-2 py-1.5 flex flex-col gap-0.5"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#1e3a5f transparent" }}
      >
        {feed.length === 0 && (
          <div className="text-[10px] text-gray-600 italic px-1 pt-2">
            Run the simulation to see activity…
          </div>
        )}

        {feed.map(entry => (
          <div
            key={entry.id}
            className="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-white/5 transition-colors group"
          >
            {/* Icon + colour bar */}
            <div
              className="flex-shrink-0 mt-0.5 flex items-center gap-1"
              style={{ color: entry.color }}
            >
              <div
                className="w-0.5 h-full rounded-full self-stretch"
                style={{ backgroundColor: entry.color, minHeight: 14 }}
              />
              <KindIcon kind={entry.kind} size={10} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span
                  className="text-[10px] font-medium leading-tight truncate"
                  style={{ color: entry.color }}
                >
                  {entry.message}
                </span>
                {entry.detail && entry.kind === "intervention" && (
                  <span className="text-[9px] text-gray-500 flex-shrink-0">{entry.detail}</span>
                )}
              </div>

              {/* Agent reasoning — show truncated with expand on hover */}
              {entry.kind === "agent" && entry.detail && (
                <div className="text-[9px] text-gray-500 leading-relaxed mt-0.5 italic line-clamp-2 group-hover:line-clamp-none transition-all">
                  {entry.detail}
                </div>
              )}
            </div>

            {/* Tick badge */}
            {entry.t < 999999 && (
              <span className="flex-shrink-0 text-[8px] text-gray-600 mt-0.5">
                t={entry.t}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActivityLog;
