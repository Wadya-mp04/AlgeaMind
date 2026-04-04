/**
 * AlgaeMind — AI Sandbox for Harmful Algal Bloom Mitigation
 *
 * Layout (3-column):
 *  ┌─────────────── Header ──────────────────────────────────────────┐
 *  │  Left (260px)    │  Center (fluid)        │  Right (320px)      │
 *  │  ─ Playback      │  [Grid Canvas]         │  ─ Agent mode       │
 *  │  ─ Events        │  ─ legend              │  ─ Live / Run       │
 *  │  ─ Hydrology     │  ─ action bar          │  ─ Last action      │
 *  │  ─ Environment   │  ─ StatsPanel          │  ─ Research brief   │
 *  │  ─ Interventions │                        │  ─ Env log          │
 *  │                  │                        │  ─ Agent log        │
 *  └──────────────────┴────────────────────────┴─────────────────────┘
 *  ─────────────────────── Bottom metrics strip ────────────────────
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Download,
  ExternalLink,
  Info,
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
    triggerEvent,
  } = useSimulation();

  const [selectedAction, setSelectedAction] = useState(4);
  const tickRef       = useRef(0);
  const [tickCount,   setTickCount]   = useState(0);
  const centerRef     = useRef<HTMLDivElement>(null);
  const [centerWidth, setCenterWidth] = useState(0);

  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setCenterWidth(e.contentRect.width);
    });
    obs.observe(el);
    setCenterWidth(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => { tickRef.current += 1; setTickCount(tickRef.current); }, 120);
    return () => clearInterval(id);
  }, []);

  const handleCellClick = useCallback(
    (row: number, col: number) => { if (selectedAction !== 0) applyAction(selectedAction, row, col); },
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
    <div className="flex flex-col h-screen bg-[#050d1a] text-white overflow-hidden"
         style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-[#060e1c] border-b border-[#1a3050]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Waves size={18} className="text-[#4a9eff]" />
            <span className="text-base font-bold tracking-tight">AlgaeMind</span>
          </div>
          <Tooltip text="AI-powered sandbox for simulating and mitigating Harmful Algal Blooms in freshwater lakes">
            <span className="text-xs text-gray-500 border border-[#1e3a5f] px-2 py-0.5 rounded hidden md:inline cursor-help">
              AI Sandbox · HAB Mitigation
            </span>
          </Tooltip>
          <Tooltip text="Current season affects temperature, algae growth rates, and biodiversity targets">
            <span className="text-xs text-gray-400 cursor-help">{SEASON_NAMES[season]}</span>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Tooltip text="Simulation timestep — each tick represents ~6 hours of real time">
            <span className="text-gray-500 font-mono cursor-help">t={timestep}</span>
          </Tooltip>
          {bloomCount > 0 && (
            <Tooltip text={`${bloomCount} cells have algae ≥ 35 (bloom threshold). Blooms deplete oxygen and harm aquatic life.`}>
              <StatusPill color="#5cb85c" label={`${bloomCount} bloom`} dot />
            </Tooltip>
          )}
          {deadZones > 0 && (
            <Tooltip text={`${deadZones} cells with dissolved oxygen ≤ 5 — anoxic dead zones where most life cannot survive.`}>
              <StatusPill color="#e05252" label={`${deadZones} dead zones`} dot />
            </Tooltip>
          )}
          <Tooltip text="Composite ecosystem health (0–100): DO 30%, algae 35%, biodiversity 20%, nutrients 10%, industry 5%">
            <StatusPill color={hColor} label={`${healthVal.toFixed(0)}/100`} />
          </Tooltip>
          <Tooltip text={`${healthStatus.label}: ${healthVal >= 75 ? 'Ecosystem recovering well' : healthVal >= 50 ? 'Bloom pressure building' : healthVal >= 30 ? 'Critical — multiple systems failing' : 'Ecosystem collapse imminent'}`}>
            <span className="text-xs font-bold px-2 py-0.5 rounded cursor-help"
                  style={{ color: healthStatus.color, backgroundColor: healthStatus.color + "18" }}>
              {healthStatus.label}
            </span>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={exportSession} title="Export full session state as JSON"
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 border border-[#1e3a5f] hover:border-[#4a9eff]/50 px-3 py-1.5 rounded transition-colors">
            <Download size={13} /> Export
          </button>
          <Tooltip text={backendOnline ? "Python simulation backend is running" : "Backend offline — cd backend && uvicorn main:app --reload"}>
            <div className={`flex items-center gap-1.5 text-xs font-medium cursor-help ${backendOnline ? "text-green-400" : "text-red-400"}`}>
              {backendOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
              {backendOnline ? "Online" : "Offline"}
            </div>
          </Tooltip>
          <a href="https://www.epa.gov/nutrientpollution" target="_blank" rel="noreferrer"
             title="EPA nutrient pollution reference"
             className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            <BookOpen size={12} /> EPA <ExternalLink size={10} className="ml-0.5" />
          </a>
        </div>
      </header>

      {!backendOnline && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-red-900/25 border-b border-red-800/40 px-4 py-1 text-xs text-red-300">
          <AlertTriangle size={11} />
          <span>Launch:&nbsp;
            <code className="bg-black/30 px-1 rounded text-[10px]">
              cd backend &amp;&amp; pip install -r requirements.txt &amp;&amp; uvicorn main:app --reload
            </code>
          </span>
        </div>
      )}

      {/* ── Main body (3-column) ──────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden p-2">
        <div className="h-full grid grid-cols-[240px_minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_320px] gap-2">

          {/* ── Left: ControlPanel ─────────────────────────────────────────── */}
          <aside className="min-h-0 overflow-y-auto">
            <ControlPanel
              state={state}
              isRunning={isRunning}
              playbackSpeed={playbackSpeed}
              onPlay={() => setIsRunning(!isRunning)}
              onStep={stepOnce}
              onReset={reset}
              onDriverChange={updateDrivers}
              onFlowChange={updateFlows}
              onFlowPreset={applyFlowPreset}
              onPlaybackSpeed={setPlaybackSpeed}
              onTriggerEvent={triggerEvent}
            />
          </aside>

          {/* ── Center: map + action bar + stats below ─────────────────────── */}
          <main ref={centerRef} className="min-h-0 flex flex-col gap-2 overflow-hidden">

            {/* Map card — constrained so StatsPanel is always visible */}
            <div className="flex-shrink-0 rounded-lg border border-[#1a3050] bg-[#071224] p-2" style={{ maxHeight: "62%" }}>
              {/* Map header row */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-400">28×20 · ~50 m²/cell · click to intervene</span>
                {/* Compact inline legend */}
                <div className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                  <LegendItem color="rgb(15,38,82)"    label="Water"       tip="Clean water — healthy DO, low algae" />
                  <LegendItem color="rgb(22,90,25)"    label="Bloom ≥35"   tip="Cyanobacteria bloom — oxygen stress beginning" />
                  <LegendItem color="rgb(70,190,10)"   label="Severe ≥65"  tip="Dense surface scum — severe oxygen crash risk" />
                  <LegendItem color="rgb(200,80,0)"    label="Industrial"  tip="Industrial pollution: chemicals/metals from east discharge. Orange border = moderate spill, Red X = severe" />
                  <LegendItem color="rgb(75,55,12)"    label="Sediment"    tip="Storm runoff turbidity — reduces light and photosynthesis" />
                  <LegendItem color="rgb(5,5,15)"      label="Dead zone"   tip="DO ≤ 5 — anoxic, no aerobic life survives. Red X animated." />
                  <LegendItem color="rgba(80,170,255,0.75)" label="▶ Inflow" tip="North=agricultural, West=river, East=industrial discharge" />
                </div>
              </div>

              <GridCanvas
                state={state}
                selectedAction={selectedAction}
                onCellClick={handleCellClick}
                tickCount={tickCount}
                containerWidth={centerWidth > 0 ? centerWidth - 16 : undefined}
              />

              {/* Intervention selector bar */}
              <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                {ACTION_META.map(action => (
                  <Tooltip key={action.id}
                           text={`${action.description} | Cost: ${action.cost}${action.duration > 0 ? ` | ${action.duration}t (~${Math.round(action.duration * 6)}h)` : " | Instant"} | r=${action.radius}`}>
                    <button
                      onClick={() => setSelectedAction(action.id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                        selectedAction === action.id
                          ? "border-[#4a9eff]/60 text-white"
                          : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#0a1628]"
                      }`}
                      style={selectedAction === action.id ? { backgroundColor: action.color + "25", borderColor: action.color + "80" } : {}}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: action.color }} />
                      <span className="truncate max-w-[90px]">{action.name}</span>
                      <span className="text-gray-600 text-[10px] ml-0.5">¢{action.cost}</span>
                    </button>
                  </Tooltip>
                ))}
                {deadZones > 10 && (
                  <div className="flex items-center gap-1 bg-red-900/20 border border-red-800/40 rounded px-2 py-1 text-[11px] text-red-300 ml-auto">
                    <AlertTriangle size={11} className="flex-shrink-0" />
                    <strong>CRISIS:</strong>&nbsp;{deadZones} dead zones — Aerate!
                  </div>
                )}
              </div>
            </div>

            {/* Stats panel below map */}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[#1e3a5f] bg-[#0d1b2e] p-2">
              <StatsPanel state={state} healthHistory={healthHistory} />
            </div>
          </main>

          {/* ── Right: Agent + Logs ────────────────────────────────────────── */}
          <aside className="min-h-0 flex flex-col gap-2 overflow-hidden">
            <div className="flex-shrink-0 overflow-y-auto max-h-[48%] bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-2">
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
            <div className="flex-1 min-h-0 grid grid-rows-2 gap-2">
              <div className="min-h-0 border border-[#1a3050] rounded-lg overflow-hidden bg-[#0d1b2e]">
                <ActivityLog state={state} lastAgentAction={lastAgentAction} agentLiveType={agentLiveType}
                             rlStats={rlStats} mode="environment" title="Environment Events" />
              </div>
              <div className="min-h-0 border border-[#1a3050] rounded-lg overflow-hidden bg-[#0d1b2e]">
                <ActivityLog state={state} lastAgentAction={lastAgentAction} agentLiveType={agentLiveType}
                             rlStats={rlStats} mode="agent" title="Agent Interventions" />
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Bottom metrics strip ─────────────────────────────────────────── */}
      {state && (
        <div className="flex-shrink-0 flex items-center border-t border-[#1a3050] bg-[#060e1c] px-3 py-1.5 overflow-x-auto gap-0">
          <Activity size={13} className="text-[#4a9eff] mr-2 flex-shrink-0" />
          <Tooltip text="Composite health (0–100): DO 30%, algae 35%, biodiversity 20%, nutrients 10%, industry 5%">
            <MetricPill label="Health"       value={`${healthVal.toFixed(0)}/100`}               color={hColor} />
          </Tooltip>
          <Divider />
          <Tooltip text="Average dissolved oxygen. Below 20 = hypoxic, below 5 = dead zone.">
            <MetricPill label="Avg DO"       value={state.avg_do.toFixed(1)}                     color={state.avg_do < 20 ? "#e07830" : "#4a9eff"} />
          </Tooltip>
          <Divider />
          <Tooltip text="Cells with algae ≥ 35. Blooms consume oxygen and can release toxins.">
            <MetricPill label="Blooms"       value={`${state.bloom_cells}`}                       color={state.bloom_cells > 20 ? "#f0c040" : "#6b7280"} />
          </Tooltip>
          <Divider />
          <Tooltip text="Cells with DO ≤ 20. Fish stress begins; invertebrates start dying.">
            <MetricPill label="Hypoxic"      value={`${state.hypoxic_cells}`}                     color={state.hypoxic_cells > 10 ? "#e07830" : "#6b7280"} />
          </Tooltip>
          <Divider />
          <Tooltip text="Cells with DO ≤ 5 — fully anoxic. No aerobic life survives.">
            <MetricPill label="Dead zones"   value={`${state.dead_zone_cells}`}                   color={state.dead_zone_cells > 0 ? "#e03030" : "#6b7280"} />
          </Tooltip>
          <Divider />
          <Tooltip text="Average nitrogen. High N (>45) fuels algae growth. Source: agricultural runoff.">
            <MetricPill label="Avg N"        value={state.avg_nitrogen.toFixed(1)}                color={state.avg_nitrogen > 45 ? "#f0c040" : "#6b7280"} />
          </Tooltip>
          <Divider />
          <Tooltip text="Average phosphorus — primary limiting nutrient in freshwater. High P (>25) triggers blooms.">
            <MetricPill label="Avg P"        value={state.avg_phosphorus.toFixed(1)}              color={state.avg_phosphorus > 25 ? "#a78bfa" : "#6b7280"} />
          </Tooltip>
          <Divider />
          <Tooltip text="Average biodiversity (0–100). Drops under hypoxia, bloom stress, or industrial pollution.">
            <MetricPill label="Biodiversity" value={state.avg_biodiversity.toFixed(1)}            color={state.avg_biodiversity < 40 ? "#e07830" : "#2dba57"} />
          </Tooltip>
          <Divider />
          <Tooltip text="Water temp °C. Above 15°C algae growth accelerates; above 27°C map shows heat shimmer.">
            <MetricPill label="Temp"         value={`${state.drivers.temperature.toFixed(1)}°C`}  color="#f97316" />
          </Tooltip>
          <Divider />
          <Tooltip text="Rainfall intensity. High values increase nutrient runoff at inflows.">
            <MetricPill label="Rain"         value={`${(state.drivers.rainfall * 100).toFixed(0)}%`} color="#60a5fa" />
          </Tooltip>
        </div>
      )}

      {error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2
                        bg-[#1a0808] border border-red-700 rounded-lg px-3 py-2 text-xs text-red-300 shadow-xl max-w-sm">
          <AlertTriangle size={11} className="flex-shrink-0" />{error}
        </div>
      )}
    </div>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <span className="relative group inline-flex">
    {children}
    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
                     w-max max-w-[240px] rounded-lg bg-[#0a1628] border border-[#1e3a5f]
                     px-2.5 py-1.5 text-xs text-gray-300 shadow-xl leading-snug
                     opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-normal text-center">
      {text}
    </span>
  </span>
);

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusPill: React.FC<{ color: string; label: string; dot?: boolean }> = ({ color, label, dot }) => (
  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border"
        style={{ color, borderColor: color + "44", backgroundColor: color + "15" }}>
    {dot && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
    {label}
  </span>
);

const LegendItem: React.FC<{ color: string; label: string; tip: string }> = ({ color, label, tip }) => (
  <Tooltip text={tip}>
    <span className="flex items-center gap-1 cursor-help">
      <span className="w-2 h-2 rounded-sm flex-shrink-0 border border-white/10" style={{ backgroundColor: color }} />
      {label}
    </span>
  </Tooltip>
);

const MetricPill: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-help">
    <span className="text-xs text-gray-500">{label}</span>
    <span className="text-xs font-bold" style={{ color }}>{value}</span>
  </div>
);

const Divider: React.FC = () => (
  <span className="text-[#1a3050] text-sm select-none">│</span>
);
