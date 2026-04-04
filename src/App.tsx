/**
 * AlgaeMind — AI Sandbox for Harmful Algal Bloom Mitigation
 *
 * Layout (4-zone):
 *
 *  ┌──────────────────────────────────────── Header ────────────────────────────────────────┐
 *  │  Controls (160px)  │      Lake Sandbox (fluid)       │  Agent + Stats (290px)          │
 *  │  ─ Playback        │                                 │  ─ Agent mode (H / LLM / RL)    │
 *  │  ─ Env drivers     │      [Grid Canvas]              │  ─ Live toggle                  │
 *  │  ─ Interventions   │                                 │  ─ Last action / RL stats        │
 *  │                    │                                 │  ─ Health gauge + key metrics    │
 *  │                    │                                 │  ─ Health trend chart            │
 *  │                    │                                 │  ──────────────────────────────  │
 *  │                    │                                 │  Activity Log (env + AI feed)    │
 *  └────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
 *  ─────────────────────────── Bottom metrics strip ────────────────────────────────────────
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Download,
  ExternalLink,
  Wifi,
  WifiOff,
  Waves,
} from "lucide-react";
import { GridCanvas }    from "./components/GridCanvas";
import { AgentPanel }    from "./components/AgentPanel";
import { ControlPanel }  from "./components/ControlPanel";
import { StatsPanel }    from "./components/StatsPanel";
import { ActivityLog }   from "./components/ActivityLog";
import { useSimulation } from "./hooks/useSimulation";
import { healthColor, ACTION_META } from "./data/types";

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    state,
    isRunning,
    isAgentRunning,
    agentLive,
    agentLiveType,
    agentInterval,
    playbackSpeed,
    backendOnline,
    error,
    lastAgentAction,
    agentBrief,
    rlStats,
    healthHistory,
    setIsRunning,
    setAgentLive,
    setAgentLiveType,
    setAgentInterval,
    setPlaybackSpeed,
    stepOnce,
    reset,
    applyAction,
    updateDrivers,
    updateFlows,
    applyFlowPreset,
    runAgentStep,
    runAgentAuto,
    exportSession,
  } = useSimulation();

  const [selectedAction, setSelectedAction] = useState(4);
  const tickRef   = useRef(0);
  const [tickCount, setTickCount] = useState(0);

  // Drive canvas pulse animations independently of backend tick rate
  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current += 1;
      setTickCount(tickRef.current);
    }, 120);
    return () => clearInterval(id);
  }, []);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (selectedAction === 0) return;
      applyAction(selectedAction, row, col);
    },
    [selectedAction, applyAction],
  );

  const healthVal  = state?.global_health ?? 0;
  const hColor     = healthColor(healthVal);
  const timestep   = state?.drivers.timestep ?? 0;
  const bloomCount = state?.bloom_cells ?? 0;
  const deadZones  = state?.dead_zone_cells ?? 0;
  const season     = state?.drivers.season ?? 0;
  const SEASON_NAMES = ["❄ Winter", "🌱 Spring", "☀ Summer", "🍂 Fall"];

  const healthStatus =
    healthVal >= 75 ? { label: "HEALTHY",  color: "#2dba57" } :
    healthVal >= 50 ? { label: "WARNING",  color: "#f0c040" } :
    healthVal >= 30 ? { label: "CRITICAL", color: "#e07830" } :
                      { label: "COLLAPSE", color: "#e03030" };

  return (
    <div
      className="flex flex-col h-screen bg-[#050d1a] text-white overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 bg-[#060e1c] border-b border-[#1a3050]">
        {/* Left: brand */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Waves size={15} className="text-[#4a9eff]" />
            <span className="text-sm font-bold tracking-tight">AlgaeMind</span>
          </div>
          <span className="text-[9px] text-gray-500 border border-[#1e3a5f] px-1.5 py-0.5 rounded hidden sm:inline">
            AI Sandbox · HAB Mitigation
          </span>
          <span className="text-[9px] text-gray-600">{SEASON_NAMES[season]}</span>
        </div>

        {/* Centre: live status pills */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-600">t={timestep}</span>
          {bloomCount > 0 && (
            <StatusPill color="#5cb85c" label={`${bloomCount} bloom cells`} dot />
          )}
          {deadZones > 0 && (
            <StatusPill color="#e05252" label={`${deadZones} dead zones`} dot />
          )}
          <StatusPill color={hColor} label={`${healthVal.toFixed(0)}/100`} />
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ color: healthStatus.color, backgroundColor: healthStatus.color + "18" }}
          >
            {healthStatus.label}
          </span>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={exportSession}
            title="Export session as JSON"
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 border border-[#1e3a5f] hover:border-[#4a9eff]/50 px-2 py-1 rounded transition-colors"
          >
            <Download size={10} />
            Export
          </button>
          <div className={`flex items-center gap-1 text-[10px] ${backendOnline ? "text-green-400" : "text-red-400"}`}>
            {backendOnline ? <Wifi size={10} /> : <WifiOff size={10} />}
            {backendOnline ? "Online" : "Offline"}
          </div>
          <a
            href="https://www.epa.gov/nutrientpollution"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-0.5 text-[9px] text-gray-600 hover:text-gray-400 transition-colors"
          >
            <BookOpen size={9} />
            EPA <ExternalLink size={8} className="ml-0.5" />
          </a>
        </div>
      </header>

      {/* ── Offline banner ───────────────────────────────────────────────────── */}
      {!backendOnline && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-red-900/25 border-b border-red-800/40 px-4 py-1 text-xs text-red-300">
          <AlertTriangle size={11} />
          <span>
            Launch the backend:&nbsp;
            <code className="bg-black/30 px-1 rounded text-[10px]">
              cd backend &amp;&amp; pip install -r requirements.txt &amp;&amp; uvicorn main:app --reload
            </code>
          </span>
        </div>
      )}

      {/* ── Main body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <div className="h-full grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_360px] gap-3">

          {/* Left rail: controls + stats */}
          <aside className="min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <ControlPanel
                state={state}
                isRunning={isRunning}
                selectedAction={selectedAction}
                playbackSpeed={playbackSpeed}
                onPlay={() => setIsRunning(!isRunning)}
                onStep={stepOnce}
                onReset={reset}
                onDriverChange={updateDrivers}
                onFlowChange={updateFlows}
                onFlowPreset={applyFlowPreset}
                onPlaybackSpeed={setPlaybackSpeed}
                onActionSelect={setSelectedAction}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2">
              <StatsPanel state={state} healthHistory={healthHistory} />
            </div>
          </aside>

          {/* Center: map and map-local info */}
          <main className="min-h-0 flex flex-col items-center gap-3 overflow-auto rounded-lg border border-[#1a3050] bg-[#071224] p-3">
            <div className="w-full max-w-[952px] flex items-center justify-between text-xs text-gray-400">
              <span className="font-medium">28×20 grid · ~50 m² per cell</span>
              <span>Click a water cell to apply selected intervention</span>
            </div>

            <GridCanvas
              state={state}
              selectedAction={selectedAction}
              onCellClick={handleCellClick}
              tickCount={tickCount}
            />

            <div className="w-full max-w-[952px] flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
              <LegendDot color="rgb(15,38,82)"         label="Clean water" />
              <LegendDot color="rgb(22,90,25)"         label="Bloom ≥35" />
              <LegendDot color="rgb(70,190,10)"        label="Severe bloom ≥65" />
              <LegendDot color="rgb(120,20,20)"        label="Industrial" />
              <LegendDot color="rgb(75,55,12)"         label="Sediment" />
              <LegendDot color="rgb(3,3,12)"           label="Dead zone (DO≤5)" />
              <LegendDot color="rgb(38,58,38)"         label="Land" />
              <LegendDot color="rgba(80,170,255,0.75)" label="▶ Inflow" />
            </div>

            {deadZones > 10 && (
              <div className="w-full max-w-[952px] bg-red-900/20 border border-red-800/40 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
                <AlertTriangle size={15} className="flex-shrink-0" />
                <span>
                  <strong>ECOLOGICAL CRISIS:</strong> {deadZones} dead zones - deploy emergency aeration immediately.
                </span>
              </div>
            )}

            {selectedAction > 0 && (
              <div className="w-full max-w-[952px] flex items-center gap-2 bg-[#0a1628]/60 border border-[#1e3a5f]/40 rounded px-3 py-2 text-xs">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: ACTION_META.find(a => a.id === selectedAction)?.color ?? "#888" }}
                />
                <span className="text-gray-300">Active intervention:</span>
                <span className="text-white font-semibold">
                  {ACTION_META.find(a => a.id === selectedAction)?.name}
                </span>
                <span className="ml-auto text-gray-500 text-xs">
                  {ACTION_META.find(a => a.id === selectedAction)?.description}
                </span>
              </div>
            )}
          </main>

          {/* Right rail: agent controls + split logs */}
          <aside className="min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="flex-shrink-0 overflow-y-auto pr-1 max-h-[48%] bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2">
              <AgentPanel
                isAgentRunning={isAgentRunning}
                agentLive={agentLive}
                agentLiveType={agentLiveType}
                agentInterval={agentInterval}
                lastAction={lastAgentAction}
                agentBrief={agentBrief}
                rlStats={rlStats}
                onAgentStep={runAgentStep}
                onAgentAuto={runAgentAuto}
                onSetAgentLive={setAgentLive}
                onSetAgentLiveType={setAgentLiveType}
                onSetAgentInterval={setAgentInterval}
              />
            </div>

            <div className="flex-1 min-h-0 grid grid-rows-2 gap-3">
              <div className="min-h-0 border border-[#1a3050] rounded-lg overflow-hidden bg-[#0d1b2e]">
                <ActivityLog
                  state={state}
                  lastAgentAction={lastAgentAction}
                  agentLiveType={agentLiveType}
                  rlStats={rlStats}
                  mode="environment"
                  title="Environment Updates"
                />
              </div>
              <div className="min-h-0 border border-[#1a3050] rounded-lg overflow-hidden bg-[#0d1b2e]">
                <ActivityLog
                  state={state}
                  lastAgentAction={lastAgentAction}
                  agentLiveType={agentLiveType}
                  rlStats={rlStats}
                  mode="agent"
                  title="Agent Interventions"
                />
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Bottom metrics strip ──────────────────────────────────────────────── */}
      {state && (
        <div className="flex-shrink-0 flex items-center gap-0 border-t border-[#1a3050] bg-[#060e1c] px-3 py-1 overflow-x-auto">
          <Activity size={10} className="text-[#4a9eff] mr-2 flex-shrink-0" />
          <MetricPill label="Health"      value={`${healthVal.toFixed(0)}/100`}             color={hColor} />
          <Divider />
          <MetricPill label="Avg DO"      value={`${state.avg_do.toFixed(1)}`}               color={state.avg_do < 20 ? "#e07830" : "#4a9eff"} />
          <Divider />
          <MetricPill label="Bloom cells" value={`${state.bloom_cells}`}                      color={state.bloom_cells > 20 ? "#f0c040" : "#6b7280"} />
          <Divider />
          <MetricPill label="Hypoxic"     value={`${state.hypoxic_cells}`}                    color={state.hypoxic_cells > 10 ? "#e07830" : "#6b7280"} />
          <Divider />
          <MetricPill label="Dead zones"  value={`${state.dead_zone_cells}`}                  color={state.dead_zone_cells > 0 ? "#e03030" : "#6b7280"} />
          <Divider />
          <MetricPill label="Avg N"       value={`${state.avg_nitrogen.toFixed(1)}`}          color={state.avg_nitrogen > 45 ? "#f0c040" : "#6b7280"} />
          <Divider />
          <MetricPill label="Avg P"       value={`${state.avg_phosphorus.toFixed(1)}`}        color={state.avg_phosphorus > 25 ? "#a78bfa" : "#6b7280"} />
          <Divider />
          <MetricPill label="Biodiversity" value={`${state.avg_biodiversity.toFixed(1)}`}    color={state.avg_biodiversity < 40 ? "#e07830" : "#2dba57"} />
          <Divider />
          <MetricPill label="Temp"        value={`${state.drivers.temperature.toFixed(1)}°C`} color="#f97316" />
          <Divider />
          <MetricPill label="Rain"        value={`${(state.drivers.rainfall * 100).toFixed(0)}%`} color="#60a5fa" />
        </div>
      )}

      {/* ── Error toast ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2
                        bg-[#1a0808] border border-red-700 rounded-lg px-3 py-2 text-xs text-red-300
                        shadow-xl max-w-sm">
          <AlertTriangle size={11} className="flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────────

const StatusPill: React.FC<{ color: string; label: string; dot?: boolean }> = ({ color, label, dot }) => (
  <span
    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border"
    style={{ color, borderColor: color + "44", backgroundColor: color + "15" }}
  >
    {dot && <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
    {label}
  </span>
);

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1">
    <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
    {label}
  </span>
);

const MetricPill: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="flex items-center gap-1 px-2 whitespace-nowrap">
    <span className="text-[9px] text-gray-600">{label}</span>
    <span className="text-[9px] font-semibold" style={{ color }}>{value}</span>
  </div>
);

const Divider: React.FC = () => (
  <span className="text-[#1a3050] text-xs select-none">│</span>
);
