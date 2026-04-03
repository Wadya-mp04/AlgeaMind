/**
 * AlgaeMind — AI Sandbox for Harmful Algal Bloom Mitigation
 *
 * Complete rewrite: replaces Leaflet river-network map with a 2D grid
 * bird's-eye lake simulation driven by a Python FastAPI backend.
 *
 * Layout: controls (left) | lake canvas (centre) | agent + stats (right)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ExternalLink,
  Wifi,
  WifiOff,
  Waves,
} from "lucide-react";
import { GridCanvas }    from "./components/GridCanvas";
import { AgentPanel }    from "./components/AgentPanel";
import { ControlPanel }  from "./components/ControlPanel";
import { StatsPanel }    from "./components/StatsPanel";
import { useSimulation } from "./hooks/useSimulation";
import { healthColor }   from "./data/types";

// ─────────────────────────────────────────────────────────────────────────────

const GRID_COLS = 28;
const GRID_ROWS = 20;

export default function App() {
  const {
    state,
    isRunning,
    isAgentRunning,
    agentLive,
    agentLiveType,
    agentInterval,
    backendOnline,
    error,
    lastAgentAction,
    agentBrief,
    healthHistory,
    setIsRunning,
    setAgentLive,
    setAgentLiveType,
    setAgentInterval,
    stepOnce,
    reset,
    applyAction,
    updateDrivers,
    runAgentStep,
    runAgentAuto,
  } = useSimulation();

  const [selectedAction, setSelectedAction] = useState(4);   // default: mechanical removal
  const tickRef  = useRef(0);
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

  return (
    <div
      className="flex flex-col h-screen bg-[#060e1c] text-white overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-[#080f1e] border-b border-[#1a3050]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Waves size={16} className="text-[#4a9eff]" />
            <span className="text-sm font-bold tracking-tight text-white">AlgaeMind</span>
          </div>
          <span className="text-[10px] text-gray-500 border border-[#1e3a5f] px-1.5 py-0.5 rounded">
            AI Sandbox · HAB Mitigation
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {bloomCount > 0 && (
            <StatusPill color="#5cb85c" label={`🟢 ${bloomCount} bloom cells`} />
          )}
          {deadZones > 0 && (
            <StatusPill color="#e05252" label={`☠ ${deadZones} dead zones`} />
          )}
          <StatusPill color={hColor} label={`Health: ${healthVal.toFixed(0)}/100`} />
          <span className="text-gray-500">Tick {timestep}</span>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1 text-[10px] ${backendOnline ? "text-green-400" : "text-red-400"}`}>
            {backendOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
            {backendOnline ? "Backend online" : "Backend offline"}
          </div>
          <a
            href="https://www.epa.gov/nutrientpollution"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            <BookOpen size={10} />
            EPA <ExternalLink size={8} className="ml-0.5" />
          </a>
        </div>
      </header>

      {/* ── Backend offline banner ───────────────────────────────────────── */}
      {!backendOnline && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-red-900/30 border-b border-red-800/50 px-4 py-1.5 text-xs text-red-300">
          <AlertTriangle size={12} />
          <span>
            Backend not reachable. Launch it with:&nbsp;
            <code className="bg-black/30 px-1 rounded">
              cd AlgeaMind/backend &amp;&amp; pip install -r requirements.txt &amp;&amp; uvicorn main:app --reload
            </code>
          </span>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: simulation controls */}
        <aside className="w-52 flex-shrink-0 border-r border-[#1a3050] overflow-y-auto p-2">
          <ControlPanel
            state={state}
            isRunning={isRunning}
            selectedAction={selectedAction}
            onPlay={() => setIsRunning(!isRunning)}
            onStep={stepOnce}
            onReset={reset}
            onDriverChange={updateDrivers}
            onActionSelect={setSelectedAction}
          />
        </aside>

        {/* Centre: lake grid + legend */}
        <main className="flex-1 flex flex-col items-center justify-start overflow-auto p-3 gap-2 min-w-0">
          <div className="w-full max-w-[700px] flex items-center justify-between text-[10px] text-gray-600">
            <span>{GRID_COLS}×{GRID_ROWS} grid — each cell ≈ 50 m²</span>
            <span>Click any water cell to apply the selected intervention</span>
          </div>

          <GridCanvas
            state={state}
            selectedAction={selectedAction}
            onCellClick={handleCellClick}
            tickCount={tickCount}
          />

          <div className="w-full max-w-[700px]">
            <GridLegend />
          </div>

          {deadZones > 10 && (
            <div className="w-full max-w-[700px] bg-red-900/25 border border-red-800/50 rounded p-2.5 text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span>
                <strong>ECOLOGICAL CRISIS:</strong> {deadZones} dead zones detected. Dissolved oxygen has
                collapsed — deploy emergency aeration and remove algae mass to prevent ecosystem collapse.
              </span>
            </div>
          )}

          {/* HAB context card */}
          <div className="w-full max-w-[700px] bg-[#0a1628]/60 border border-[#1e3a5f]/50 rounded p-2.5 text-[10px] text-gray-600 leading-relaxed">
            <strong className="text-gray-500">About HABs:</strong> Harmful Algal Blooms are driven by
            excess nitrogen &amp; phosphorus from agricultural runoff and industrial discharge, amplified
            by warming temperatures. They deplete dissolved oxygen, create dead zones, kill aquatic life,
            contaminate drinking water, and cost economies hundreds of millions annually.
          </div>
        </main>

        {/* Right: agent + stats */}
        <aside className="w-64 flex-shrink-0 border-l border-[#1a3050] overflow-y-auto p-2">
          <div className="flex flex-col gap-2">
            <AgentPanel
              isAgentRunning={isAgentRunning}
              agentLive={agentLive}
              agentLiveType={agentLiveType}
              agentInterval={agentInterval}
              lastAction={lastAgentAction}
              agentBrief={agentBrief}
              recentEvents={state?.recent_events ?? []}
              onAgentStep={runAgentStep}
              onAgentAuto={runAgentAuto}
              onSetAgentLive={setAgentLive}
              onSetAgentLiveType={setAgentLiveType}
              onSetAgentInterval={setAgentInterval}
            />
            <div className="border-t border-[#1a3050] pt-2">
              <StatsPanel state={state} healthHistory={healthHistory} />
            </div>
          </div>
        </aside>

      </div>

      {/* ── Error toast ──────────────────────────────────────────────────── */}
      {error && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-[#1a0808] border border-red-700 rounded-lg px-3 py-2 text-xs text-red-300 shadow-xl max-w-md">
          <AlertTriangle size={12} className="flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusPill: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span
    className="px-2 py-0.5 rounded-full text-[10px] font-medium border"
    style={{ color, borderColor: color + "44", backgroundColor: color + "18" }}
  >
    {label}
  </span>
);

const GridLegend: React.FC = () => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-600">
    <LegendItem color="rgb(15,55,100)"  label="Clean water" />
    <LegendItem color="rgb(25,100,35)"  label="Bloom (algae ≥35)" />
    <LegendItem color="rgb(80,200,20)"  label="Severe bloom (≥65)" />
    <LegendItem color="rgb(130,25,25)"  label="Industrial pollution" />
    <LegendItem color="rgb(80,60,15)"   label="Sediment" />
    <LegendItem color="rgb(3,3,12)"     label="Dead zone (DO ≤5)" />
    <LegendItem color="rgb(42,65,42)"   label="Land / shore" />
    <LegendItem color="rgba(80,170,255,0.75)" label="▶ Inflow" />
    <LegendItem color="rgba(100,200,255,0.55)" label="▼ Outflow" />
  </div>
);

const LegendItem: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1">
    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
    {label}
  </span>
);
