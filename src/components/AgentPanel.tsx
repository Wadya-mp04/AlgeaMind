/**
 * AgentPanel — controls for the AI intervention agent + action history.
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
  Zap,
} from "lucide-react";
import { ACTION_META, type AgentAction } from "../data/types";
import type { AgentType } from "../hooks/useSimulation";

interface AgentPanelProps {
  isAgentRunning:  boolean;
  agentLive:       boolean;
  agentLiveType:   AgentType;
  agentInterval:   number;
  lastAction:      AgentAction | null;
  agentBrief:      string;
  recentEvents:    string[];
  onAgentStep:     (type: AgentType) => void;
  onAgentAuto:     (type: AgentType, n: number) => void;
  onSetAgentLive:      (v: boolean) => void;
  onSetAgentLiveType:  (v: AgentType) => void;
  onSetAgentInterval:  (v: number) => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  isAgentRunning,
  agentLive,
  agentLiveType,
  agentInterval,
  lastAction,
  agentBrief,
  recentEvents,
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
    <div className="flex flex-col gap-3">

      {/* ── Agent type selector ────────────────────────────────────────── */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <Bot size={14} className="text-[#4a9eff]" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Agent Mode</span>
        </div>
        <div className="flex gap-2">
          <AgentTypeButton
            label="Heuristic"
            icon={<Zap size={11} />}
            active={agentLiveType === "heuristic"}
            onClick={() => onSetAgentLiveType("heuristic")}
            tooltip="Rule-based priority agent — instant, no API key"
          />
          <AgentTypeButton
            label="Claude AI"
            icon={<Brain size={11} />}
            active={agentLiveType === "llm"}
            onClick={() => onSetAgentLiveType("llm")}
            tooltip="LLM environmental scientist — requires ANTHROPIC_API_KEY"
          />
        </div>
      </div>

      {/* ── Live agent toggle ──────────────────────────────────────────── */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Radio size={13} className={agentLive ? "text-green-400 animate-pulse" : "text-gray-500"} />
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Live Agent</span>
          </div>
          {/* Toggle switch */}
          <button
            onClick={() => onSetAgentLive(!agentLive)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              agentLive ? "bg-green-500" : "bg-[#1e3a5f]"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                agentLive ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
          {agentLive
            ? `Agent acts every ${agentInterval} ticks while simulation runs.`
            : "Enable to let the agent act automatically during simulation."}
        </p>

        {/* Interval selector */}
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <span>Act every</span>
          <select
            value={agentInterval}
            onChange={e => onSetAgentInterval(Number(e.target.value))}
            className="bg-[#0a1628] border border-[#1e3a5f] text-gray-300 text-[10px] rounded px-1.5 py-0.5"
          >
            {[1, 3, 5, 10, 20].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>ticks</span>
        </div>
      </div>

      {/* ── Manual run buttons ─────────────────────────────────────────── */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="text-[10px] text-gray-500 mb-2">Manual triggers</div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onAgentStep(agentLiveType)}
            disabled={isAgentRunning}
            className="flex items-center justify-center gap-2 bg-[#4a9eff]/10 hover:bg-[#4a9eff]/20
                       border border-[#4a9eff]/40 text-[#4a9eff] text-xs font-semibold py-2 rounded
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAgentRunning
              ? <Loader2 size={12} className="animate-spin" />
              : <PlayCircle size={12} />}
            {isAgentRunning ? "Thinking…" : "Run One Step"}
          </button>

          <div className="flex gap-2 items-center">
            <button
              onClick={() => onAgentAuto(agentLiveType, autoSteps)}
              disabled={isAgentRunning}
              className="flex-1 flex items-center justify-center gap-2 bg-[#2dba57]/10 hover:bg-[#2dba57]/20
                         border border-[#2dba57]/40 text-[#2dba57] text-xs font-semibold py-2 rounded
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAgentRunning
                ? <Loader2 size={12} className="animate-spin" />
                : <Zap size={12} />}
              Run ×{autoSteps}
            </button>
            <select
              value={autoSteps}
              onChange={e => setAutoSteps(Number(e.target.value))}
              className="bg-[#0a1628] border border-[#1e3a5f] text-gray-300 text-xs rounded px-1 py-1.5"
            >
              {[3, 5, 10, 20].map(n => (
                <option key={n} value={n}>{n} steps</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Last action ───────────────────────────────────────────────── */}
      {lastAction && (
        <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: actionMeta?.color ?? "#888" }}
            />
            <span className="text-xs font-semibold text-gray-300">Last Action</span>
            {agentLive && (
              <span className="ml-auto text-[9px] text-green-400 border border-green-400/30 px-1 rounded">AUTO</span>
            )}
          </div>
          <div className="text-xs text-white font-medium mb-1">{lastAction.action_name}</div>
          <div className="text-[10px] text-gray-400 mb-1.5">
            Target: row {lastAction.row}, col {lastAction.col}
          </div>
          {lastAction.reasoning && (
            <div className="text-[10px] text-gray-400 italic border-l-2 border-[#1e3a5f] pl-2 leading-relaxed">
              {lastAction.reasoning}
            </div>
          )}
        </div>
      )}

      {/* ── Research brief (LLM only) ──────────────────────────────────── */}
      {agentBrief && (
        <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
          <button
            className="flex items-center justify-between w-full text-xs font-semibold text-gray-300"
            onClick={() => setBriefOpen(p => !p)}
          >
            <div className="flex items-center gap-2">
              <Brain size={12} className="text-[#4a9eff]" />
              Research Brief
            </div>
            {briefOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {briefOpen && (
            <div className="mt-2 max-h-52 overflow-y-auto text-[10px] text-gray-400 leading-relaxed whitespace-pre-wrap">
              {agentBrief}
            </div>
          )}
        </div>
      )}

      {/* ── Event log ─────────────────────────────────────────────────── */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Event Log</span>
        </div>
        <div className="max-h-44 overflow-y-auto flex flex-col gap-0.5">
          {[...recentEvents].reverse().slice(0, 15).map((ev, i) => (
            <div
              key={i}
              className={`text-[10px] leading-snug ${
                ev.includes("⚠") || ev.includes("spill")
                  ? "text-orange-400"
                  : ev.includes("🌧") || ev.includes("rain")
                  ? "text-blue-400"
                  : ev.includes("Season")
                  ? "text-purple-400"
                  : ev.includes("▶")
                  ? "text-green-400"
                  : "text-gray-500"
              }`}
            >
              {ev}
            </div>
          ))}
          {recentEvents.length === 0 && (
            <div className="text-[10px] text-gray-600 italic">No events yet.</div>
          )}
        </div>
      </div>

    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const AgentTypeButton: React.FC<{
  label:   string;
  icon:    React.ReactNode;
  active:  boolean;
  onClick: () => void;
  tooltip: string;
}> = ({ label, icon, active, onClick, tooltip }) => (
  <button
    onClick={onClick}
    title={tooltip}
    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium
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
