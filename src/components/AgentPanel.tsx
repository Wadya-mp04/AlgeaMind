/**
 * AgentPanel — compact agent controls: mode selector, live toggle,
 * manual run buttons, last action display, RL stats, and research brief.
 */
import React, { useState } from "react";
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronUp,
  Loader2,
  PlayCircle,
  Radio,
  TrendingUp,
  Zap,
} from "lucide-react";
import { ACTION_META } from "../data/types";
import type { AgentAction } from "../data/types";
import type { AgentType, RLStats } from "../hooks/useSimulation";

interface AgentPanelProps {
  isAgentRunning:    boolean;
  agentLive:         boolean;
  agentLiveType:     AgentType;
  agentInterval:     number;
  lastAction:        AgentAction | null;
  agentBrief:        string;
  rlStats:           RLStats | null;
  onAgentStep:       (type: AgentType) => void;
  onAgentAuto:       (type: AgentType, n: number) => void;
  onSetAgentLive:    (v: boolean) => void;
  onSetAgentLiveType:(v: AgentType) => void;
  onSetAgentInterval:(v: number) => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  isAgentRunning,
  agentLive,
  agentLiveType,
  agentInterval,
  lastAction,
  agentBrief,
  rlStats,
  onAgentStep,
  onAgentAuto,
  onSetAgentLive,
  onSetAgentLiveType,
  onSetAgentInterval,
}) => {
  const [briefOpen,  setBriefOpen]  = useState(false);
  const [autoSteps,  setAutoSteps]  = useState(5);

  const actionMeta = lastAction
    ? ACTION_META.find(a => a.id === lastAction.action_id)
    : null;

  return (
    <div className="flex flex-col gap-2">

      {/* ── Agent type selector ──────────────────────────────────────────── */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Bot size={12} className="text-[#4a9eff]" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Agent Mode</span>
        </div>
        <div className="flex gap-1.5">
          <AgentTypeBtn
            label="Heuristic"
            icon={<Zap size={10} />}
            active={agentLiveType === "heuristic"}
            onClick={() => onSetAgentLiveType("heuristic")}
            tooltip="Rule-based priority agent"
          />
          <AgentTypeBtn
            label="Claude AI"
            icon={<Brain size={10} />}
            active={agentLiveType === "llm"}
            onClick={() => onSetAgentLiveType("llm")}
            tooltip="LLM environmental scientist"
          />
          <AgentTypeBtn
            label="RL"
            icon={<TrendingUp size={10} />}
            active={agentLiveType === "rl"}
            onClick={() => onSetAgentLiveType("rl")}
            tooltip="Q-learning agent — learns online"
          />
        </div>
      </div>

      {/* ── RL stats (only when RL selected) ─────────────────────────────── */}
      {agentLiveType === "rl" && (
        <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp size={11} className="text-purple-400" />
            <span className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider">RL Training</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <span className="text-gray-500">Exploration ε</span>
            <span className="text-purple-300 font-mono">{rlStats?.epsilon?.toFixed(3) ?? "—"}</span>
            <span className="text-gray-500">Q-table entries</span>
            <span className="text-purple-300 font-mono">{rlStats?.q_table_size ?? 0}</span>
            <span className="text-gray-500">Steps taken</span>
            <span className="text-purple-300 font-mono">{rlStats?.total_steps ?? 0}</span>
            <span className="text-gray-500">Σ Reward</span>
            <span className={`font-mono ${(rlStats?.cumulative_reward ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {rlStats?.cumulative_reward?.toFixed(1) ?? "0.0"}
            </span>
          </div>
          {rlStats && (
            <div className="mt-1.5">
              <div className="flex justify-between text-[9px] text-gray-600 mb-0.5">
                <span>ε decay</span>
                <span>{((1 - rlStats.epsilon) * 100).toFixed(0)}% exploiting</span>
              </div>
              <div className="w-full h-1 bg-[#0a1628] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${(1 - rlStats.epsilon / 0.4) * 100}%`,
                    background: "linear-gradient(to right, #a855f7, #4a9eff)",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Live agent toggle ─────────────────────────────────────────────── */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Radio size={11} className={agentLive ? "text-green-400 animate-pulse" : "text-gray-500"} />
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Live</span>
            <span className="text-[9px] text-gray-600">
              every
            </span>
            <select
              value={agentInterval}
              onChange={e => onSetAgentInterval(Number(e.target.value))}
              className="bg-[#0a1628] border border-[#1e3a5f] text-gray-300 text-[9px] rounded px-1 py-0.5"
            >
              {[1, 3, 5, 10, 20].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="text-[9px] text-gray-600">ticks</span>
          </div>
          <button
            onClick={() => onSetAgentLive(!agentLive)}
            className={`relative w-8 h-4 rounded-full transition-colors ${agentLive ? "bg-green-500" : "bg-[#1e3a5f]"}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${agentLive ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {/* ── Manual run buttons ────────────────────────────────────────────── */}
      <div className="flex gap-1.5">
        <button
          onClick={() => onAgentStep(agentLiveType)}
          disabled={isAgentRunning}
          className="flex-1 flex items-center justify-center gap-1.5 bg-[#4a9eff]/10 hover:bg-[#4a9eff]/20
                     border border-[#4a9eff]/40 text-[#4a9eff] text-[10px] font-semibold py-1.5 rounded
                     transition-colors disabled:opacity-50"
        >
          {isAgentRunning ? <Loader2 size={10} className="animate-spin" /> : <PlayCircle size={10} />}
          {isAgentRunning ? "Thinking…" : "Step"}
        </button>
        <button
          onClick={() => onAgentAuto(agentLiveType, autoSteps)}
          disabled={isAgentRunning}
          className="flex-1 flex items-center justify-center gap-1.5 bg-[#2dba57]/10 hover:bg-[#2dba57]/20
                     border border-[#2dba57]/40 text-[#2dba57] text-[10px] font-semibold py-1.5 rounded
                     transition-colors disabled:opacity-50"
        >
          {isAgentRunning ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
          ×{autoSteps}
        </button>
        <select
          value={autoSteps}
          onChange={e => setAutoSteps(Number(e.target.value))}
          className="bg-[#0a1628] border border-[#1e3a5f] text-gray-300 text-[9px] rounded px-1"
        >
          {[3, 5, 10, 20].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      {/* ── Last action ──────────────────────────────────────────────────── */}
      {lastAction && (
        <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: actionMeta?.color ?? "#888" }} />
            <span className="text-[10px] font-semibold text-gray-300 truncate">{lastAction.action_name}</span>
            {agentLive && (
              <span className="ml-auto text-[8px] text-green-400 border border-green-400/30 px-1 rounded flex-shrink-0">AUTO</span>
            )}
          </div>
          <div className="text-[9px] text-gray-500 mb-1">
            → ({lastAction.row}, {lastAction.col})
          </div>
          {lastAction.reasoning && (
            <div className="text-[9px] text-gray-500 italic border-l border-[#1e3a5f] pl-1.5 leading-relaxed line-clamp-3">
              {lastAction.reasoning}
            </div>
          )}
        </div>
      )}

      {/* ── Research brief (LLM only) ─────────────────────────────────────── */}
      {agentLiveType === "llm" && agentBrief && (
        <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2.5">
          <button
            className="flex items-center justify-between w-full text-[10px] font-semibold text-gray-300"
            onClick={() => setBriefOpen(p => !p)}
          >
            <div className="flex items-center gap-1.5">
              <Brain size={11} className="text-[#4a9eff]" />
              Research Brief
            </div>
            {briefOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {briefOpen && (
            <div className="mt-1.5 max-h-40 overflow-y-auto text-[9px] text-gray-400 leading-relaxed whitespace-pre-wrap">
              {agentBrief}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const AgentTypeBtn: React.FC<{
  label:   string;
  icon:    React.ReactNode;
  active:  boolean;
  onClick: () => void;
  tooltip: string;
}> = ({ label, icon, active, onClick, tooltip }) => (
  <button
    onClick={onClick}
    title={tooltip}
    className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[10px] font-medium
                transition-colors ${
                  active
                    ? "bg-[#4a9eff]/20 border border-[#4a9eff] text-[#4a9eff]"
                    : "bg-transparent border border-[#1e3a5f] text-gray-500 hover:text-gray-300"
                }`}
  >
    {icon}
    {label}
  </button>
);

export default AgentPanel;
