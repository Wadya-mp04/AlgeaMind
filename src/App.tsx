/**
 * AlgaeMind — Autonomous AI Research Agent for Algae Bloom Remediation
 *
 * Inspired by ReefMind (devpost.com/software/reefmind).
 * Architecture:
 *   1. World Model   — TypeScript watershed simulator (nutrient transport + Monod algae growth)
 *   2. RL Agent      — Claude claude-sonnet-4-6 selects remediation interventions, observes outcomes, updates research brief
 *   3. Keep/Discard  — Sliding window: successful cycles advance the watershed; failed cycles revert
 *
 * Data sources: NASA (environmental drivers), USGS (river network), EPA (water quality standards)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import {
  Droplets,
  Wind,
  Sprout,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  Info,
  Layers,
  Activity,
  FlaskConical,
  Brain,
  ChevronRight,
  Map as MapIcon,
  Zap,
  BookOpen,
  TrendingUp,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import Anthropic from '@anthropic-ai/sdk';
import {
  CHESAPEAKE_RIVER_NETWORK,
  SimulationState,
  CONTAMINANTS,
  ContaminantType,
  computeHealthScore,
  tickSimulation,
  buildEutrophicState,
  buildCleanState,
} from './data/watershed';
import {
  INTERVENTIONS,
  INTERVENTION_LIST,
  InterventionType,
} from './data/interventions';

// ---------------------------------------------------------------------------
// Anthropic client (browser-side for demo)
// ---------------------------------------------------------------------------
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  dangerouslyAllowBrowser: true,
});

// ---------------------------------------------------------------------------
// RL agent types
// ---------------------------------------------------------------------------
interface CycleRecord {
  cycle: number;
  intervention: InterventionType;
  targetNode: string;
  scoreBeforeAfter: [number, number];
  delta: number;
  kept: boolean;
  reasoning: string;
}

interface AgentDecision {
  intervention: InterventionType;
  targetNodeId: string;
  reasoning: string;
  briefUpdate: string;
}

const INITIAL_BRIEF = `# AlgaeMind Research Brief
## Mission
Discover the optimal sequence of remediation interventions to reduce algae blooms and restore water quality in the Chesapeake Bay watershed.

## Target Metrics (EPA Standards)
- Algae concentration: < 5 mg/L at all lake nodes
- Phosphorus: < 2 mg/L
- Nitrogen: < 5 mg/L
- Watershed Health Score: ≥ 75 / 100

## Available Interventions
NutrientReduction, Aeration, AlumTreatment, BarleyStraw, HydraulicFlushing, RiparianBuffer, Bioremediation, PhosphorusPrecipitation

## Current Understanding
No interventions tested yet. Beginning systematic evaluation of remediation strategies.

## Active Hypotheses
- H1: Phosphorus is the primary limiting nutrient in freshwater — target P first (Liebig's Law)
- H2: Lake nodes are highest-priority targets due to low flushing and thermal stratification

## Intervention History
(empty — experiment begins now)
`;

// ---------------------------------------------------------------------------
// Helper: run N simulation ticks and return the final concentrations
// ---------------------------------------------------------------------------
function runNTicks(
  state: SimulationState,
  n: number,
): Record<string, Record<ContaminantType, number>> {
  let concs = state.nodeConcentrations;
  for (let i = 0; i < n; i++) {
    const tempState = { ...state, nodeConcentrations: concs, timeStep: state.timeStep + i };
    concs = tickSimulation(tempState, CHESAPEAKE_RIVER_NETWORK);
  }
  return concs;
}

// ---------------------------------------------------------------------------
// Claude RL Agent Panel
// ---------------------------------------------------------------------------
const AlgaeRLPanel = ({
  state,
  setState,
  isPlaying,
  setIsPlaying,
}: {
  state: SimulationState;
  setState: React.Dispatch<React.SetStateAction<SimulationState>>;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
}) => {
  const [researchBrief, setResearchBrief] = useState(INITIAL_BRIEF);
  const [showBrief, setShowBrief] = useState(false);
  const [cycles, setCycles] = useState(0);
  const [cycleLog, setCycleLog] = useState<CycleRecord[]>([]);
  const [healthHistory, setHealthHistory] = useState<{ cycle: number; score: number }[]>([
    { cycle: 0, score: computeHealthScore(state.nodeConcentrations, CHESAPEAKE_RIVER_NETWORK) },
  ]);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'running' | 'done'>('idle');
  const [currentThought, setCurrentThought] = useState('');
  const [autoRun, setAutoRun] = useState(false);
  const autoRunRef = useRef(false);
  const stateRef = useRef(state);
  const briefRef = useRef(researchBrief);
  const cyclesRef = useRef(cycles);

  // Keep refs in sync
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { briefRef.current = researchBrief; }, [researchBrief]);
  useEffect(() => { cyclesRef.current = cycles; }, [cycles]);

  // ---------------------------------------------------------------------------
  // Ask Claude to select an intervention
  // ---------------------------------------------------------------------------
  const askClaude = useCallback(async (
    currentState: SimulationState,
    brief: string,
    history: CycleRecord[],
  ): Promise<AgentDecision> => {
    const lakeNodes = CHESAPEAKE_RIVER_NETWORK.filter((n) => n.type === 'lake');
    const nodeStatus = lakeNodes.map((n) => {
      const c = currentState.nodeConcentrations[n.id];
      return `${n.name} (${n.id}): Algae=${c.Algae.toFixed(1)}, P=${c.Phosphorus.toFixed(1)}, N=${c.Nitrogen.toFixed(1)}`;
    }).join('\n');

    const score = computeHealthScore(currentState.nodeConcentrations, CHESAPEAKE_RIVER_NETWORK);
    const lastFive = history.slice(-5).map((r) =>
      `Cycle ${r.cycle}: ${r.intervention} @ ${r.targetNode} → score ${r.scoreBeforeAfter[0].toFixed(1)}→${r.scoreBeforeAfter[1].toFixed(1)} (${r.kept ? 'KEPT' : 'DISCARDED'})`
    ).join('\n') || 'No history yet.';

    const interventionMenu = INTERVENTION_LIST.map((iv) =>
      `- ${iv.id}: ${iv.shortName} — targets ${iv.primaryTarget}, cost ${iv.cost}, works on [${iv.targetTypes.join(', ')}]`
    ).join('\n');

    const lakeNodeMenu = lakeNodes.map((n) => `- ${n.id}: ${n.name}`).join('\n');

    const prompt = `You are an autonomous environmental scientist AI running algae bloom remediation experiments on the Chesapeake Bay watershed simulator.

## Current Research Brief
${brief}

## Current Watershed State (Health Score: ${score.toFixed(1)} / 100)
${nodeStatus}

## Recent Cycle History
${lastFive}

## Available Interventions
${interventionMenu}

## Valid Lake Target Nodes
${lakeNodeMenu}

## Your Task
Select ONE intervention and ONE target lake node for this experiment cycle.
Avoid repeating the exact same intervention+node combination that was just tried unless you have a new hypothesis.
Think step by step about which nutrient or mechanism to address, then output a JSON object with these exact keys:
{
  "intervention": "<InterventionType>",
  "targetNodeId": "<nodeId>",
  "reasoning": "<1-2 sentences explaining your choice>",
  "briefUpdate": "<1-3 sentences updating the research brief with new findings or revised hypotheses. Write in markdown. Can reference the current score and history.>"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    // Extract JSON even if wrapped in markdown
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned no JSON: ' + text);
    const parsed = JSON.parse(jsonMatch[0]) as AgentDecision;

    // Validate fields
    if (!INTERVENTIONS[parsed.intervention as InterventionType]) {
      throw new Error(`Invalid intervention: ${parsed.intervention}`);
    }
    if (!CHESAPEAKE_RIVER_NETWORK.find((n) => n.id === parsed.targetNodeId)) {
      throw new Error(`Invalid node: ${parsed.targetNodeId}`);
    }

    return parsed;
  }, []);

  // ---------------------------------------------------------------------------
  // Run one RL cycle
  // ---------------------------------------------------------------------------
  const runOneCycle = useCallback(async () => {
    const currentState = stateRef.current;
    const brief = briefRef.current;
    const cycleNum = cyclesRef.current + 1;

    setAgentStatus('thinking');
    setCurrentThought('Claude is selecting an intervention...');

    let decision: AgentDecision;
    try {
      decision = await askClaude(currentState, brief, cycleLog);
    } catch (err) {
      setAgentStatus('idle');
      setCurrentThought(`Error: ${(err as Error).message}`);
      return;
    }

    const intervention = INTERVENTIONS[decision.intervention];
    setCurrentThought(
      `→ ${intervention.shortName} @ ${CHESAPEAKE_RIVER_NETWORK.find((n) => n.id === decision.targetNodeId)?.name}. Running simulation...`
    );
    setAgentStatus('running');

    // Capture baseline score
    const scoreBefore = computeHealthScore(currentState.nodeConcentrations, CHESAPEAKE_RIVER_NETWORK);

    // Build trial state with intervention applied
    const trialState: SimulationState = {
      ...currentState,
      activeInterventions: [
        ...currentState.activeInterventions,
        {
          interventionId: decision.intervention,
          nodeId: decision.targetNodeId,
          startTime: currentState.timeStep,
          duration: intervention.duration,
        },
      ],
    };

    // Run N ticks with intervention
    const TICKS_PER_CYCLE = 15;
    const newConcs = runNTicks(trialState, TICKS_PER_CYCLE);
    const scoreAfter = computeHealthScore(newConcs, CHESAPEAKE_RIVER_NETWORK);
    const delta = scoreAfter - scoreBefore;
    const kept = delta >= -0.5; // Accept neutral or positive

    const record: CycleRecord = {
      cycle: cycleNum,
      intervention: decision.intervention,
      targetNode: decision.targetNodeId,
      scoreBeforeAfter: [scoreBefore, scoreAfter],
      delta,
      kept,
      reasoning: decision.reasoning,
    };

    if (kept) {
      // Advance the simulation state
      setState((prev) => ({
        ...prev,
        timeStep: prev.timeStep + TICKS_PER_CYCLE,
        nodeConcentrations: newConcs,
        activeInterventions: trialState.activeInterventions,
      }));
    }
    // If discarded: state stays as-is (revert)

    // Append brief update
    const updatedBrief =
      brief +
      `\n### Cycle ${cycleNum} — ${kept ? 'KEPT ✓' : 'DISCARDED ✗'}\n` +
      `Intervention: ${intervention.name} @ ${CHESAPEAKE_RIVER_NETWORK.find((n) => n.id === decision.targetNodeId)?.name}\n` +
      `Score: ${scoreBefore.toFixed(1)} → ${scoreAfter.toFixed(1)} (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(1)})\n` +
      decision.briefUpdate + '\n';

    setResearchBrief(updatedBrief);
    setCycleLog((prev) => [...prev, record]);
    setCycles(cycleNum);
    setHealthHistory((prev) => [...prev, { cycle: cycleNum, score: scoreAfter }]);
    setCurrentThought(
      `Cycle ${cycleNum}: ${kept ? '✓ Kept' : '✗ Reverted'} — Health ${scoreBefore.toFixed(1)} → ${scoreAfter.toFixed(1)}`
    );
    setAgentStatus(autoRunRef.current ? 'thinking' : 'idle');

    // Auto-run next cycle
    if (autoRunRef.current) {
      setTimeout(() => runOneCycle(), 800);
    }
  }, [askClaude, cycleLog, setState]);

  const handleAutoRun = () => {
    const next = !autoRun;
    setAutoRun(next);
    autoRunRef.current = next;
    if (next && agentStatus === 'idle') {
      runOneCycle();
    }
  };

  const currentScore = computeHealthScore(state.nodeConcentrations, CHESAPEAKE_RIVER_NETWORK);
  const scoreColor =
    currentScore >= 75 ? 'text-emerald-400' :
    currentScore >= 50 ? 'text-amber-400' :
    'text-red-400';

  return (
    <div className="space-y-3">
      {/* Health Score + Cycle Counter */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3 flex flex-col items-center justify-center">
          <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold">Health Score</span>
          <span className={cn('text-2xl font-black font-mono mt-0.5', scoreColor)}>
            {currentScore.toFixed(1)}
          </span>
          <span className="text-[9px] text-zinc-600">/ 100</span>
        </div>
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3 flex flex-col items-center justify-center">
          <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold">Cycles Run</span>
          <span className="text-2xl font-black font-mono mt-0.5 text-blue-400">{cycles}</span>
          <span className="text-[9px] text-zinc-600">experiments</span>
        </div>
      </div>

      {/* Health trend mini-chart */}
      {healthHistory.length > 1 && (
        <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1 font-bold">Health Trajectory</div>
          <ResponsiveContainer width="100%" height={52}>
            <LineChart data={healthHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="cycle" hide />
              <YAxis domain={[0, 100]} hide />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', fontSize: '10px' }}
                itemStyle={{ color: '#34d399' }}
                formatter={(v: number) => [`${v.toFixed(1)}`, 'Score']}
              />
              <ReferenceLine y={75} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Agent status */}
      <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-400">
            <Brain size={14} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Claude RL Agent</span>
          </div>
          <div className="flex items-center gap-1.5">
            {agentStatus === 'thinking' || agentStatus === 'running' ? (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            )}
            <span className="text-[9px] text-zinc-500 capitalize">{agentStatus}</span>
          </div>
        </div>

        <p className="text-[10px] text-zinc-400 leading-relaxed min-h-[28px]">
          {currentThought || 'Ready to run remediation experiments. Press Run Cycle or enable Auto.'}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={runOneCycle}
            disabled={agentStatus === 'thinking' || agentStatus === 'running' || autoRun}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[11px] font-semibold transition-all"
          >
            <Zap size={12} />
            Run Cycle
          </button>
          <button
            onClick={handleAutoRun}
            className={cn(
              'flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition-all',
              autoRun
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300',
            )}
          >
            {autoRun ? <Pause size={12} /> : <Play size={12} />}
            {autoRun ? 'Stop Auto' : 'Auto Run'}
          </button>
        </div>
      </div>

      {/* Recent cycle log */}
      {cycleLog.length > 0 && (
        <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-3 space-y-1.5">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold mb-2">Recent Cycles</div>
          {[...cycleLog].reverse().slice(0, 4).map((r) => (
            <div key={r.cycle} className={cn(
              'flex items-start justify-between text-[10px] gap-2 pb-1.5 border-b last:border-0',
              r.kept ? 'border-zinc-700/30' : 'border-zinc-700/20',
            )}>
              <div className="flex-1 min-w-0">
                <span className={cn('font-bold', r.kept ? 'text-emerald-400' : 'text-zinc-500')}>
                  {r.kept ? '✓' : '✗'} #{r.cycle}
                </span>
                <span className="text-zinc-400 ml-1">
                  {INTERVENTIONS[r.intervention].shortName}
                </span>
                <div className="text-zinc-600 text-[9px] truncate">{r.reasoning}</div>
              </div>
              <span className={cn(
                'font-mono font-bold shrink-0',
                r.delta >= 0 ? 'text-emerald-400' : 'text-red-400',
              )}>
                {r.delta >= 0 ? '+' : ''}{r.delta.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Research brief toggle */}
      <button
        onClick={() => setShowBrief((v) => !v)}
        className="w-full flex items-center justify-between text-[10px] text-zinc-500 hover:text-zinc-300 py-1 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <BookOpen size={11} />
          <span className="uppercase tracking-wider font-bold">Research Brief</span>
        </div>
        <ChevronRight size={11} className={cn('transition-transform', showBrief && 'rotate-90')} />
      </button>
      <AnimatePresence>
        {showBrief && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <pre className="text-[9px] text-zinc-400 leading-relaxed bg-zinc-900/60 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto border border-zinc-800">
              {researchBrief}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Control Slider
// ---------------------------------------------------------------------------
const ControlSlider = ({
  label, value, onChange, min = 0, max = 100, icon: Icon, color = 'blue',
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; icon: any; color?: string;
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between text-sm font-medium">
      <div className="flex items-center gap-2 text-zinc-400">
        <Icon size={16} />
        <span>{label}</span>
      </div>
      <span className={cn('font-mono', `text-${color}-400`)}>{value}%</span>
    </div>
    <input
      type="range" min={min} max={max} value={value}
      onChange={(e) => onChange(parseInt(e.target.value))}
      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
    />
  </div>
);

// ---------------------------------------------------------------------------
// Map click handler
// ---------------------------------------------------------------------------
const MapEvents = ({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) => {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
};

// ---------------------------------------------------------------------------
// Contaminant selector
// ---------------------------------------------------------------------------
const ContaminantSelector = ({
  selected, onSelect,
}: { selected: ContaminantType; onSelect: (t: ContaminantType) => void }) => (
  <div className="space-y-3">
    <h3 className="text-sm font-semibold text-zinc-300">Manual Spill Type</h3>
    <div className="grid grid-cols-2 gap-2">
      {(Object.keys(CONTAMINANTS) as ContaminantType[]).map((type) => {
        const props = CONTAMINANTS[type];
        return (
          <button key={type} onClick={() => onSelect(type)}
            className={cn(
              'flex flex-col items-start p-2 rounded-lg border transition-all text-left',
              selected === type
                ? 'bg-zinc-800 border-blue-500 ring-1 ring-blue-500'
                : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700',
            )}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: props.color }} />
              <span className="text-[10px] font-bold uppercase">{type}</span>
            </div>
            <span className="text-[9px] text-zinc-500 leading-tight">{props.impactDescription}</span>
          </button>
        );
      })}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export default function App() {
  const [state, setState] = useState<SimulationState>({
    rainfall: 35,
    fertilizer: 25,
    stormIntensity: 15,
    timeStep: 0,
    activeSpills: [],
    activeInterventions: [],
    nodeConcentrations: buildEutrophicState(),
    selectedContaminant: 'Nitrogen',
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [history, setHistory] = useState<{ time: number; avgConcentration: number }[]>([]);
  const [activeTab, setActiveTab] = useState<'controls' | 'agent'>('agent');

  // Severity 0-1
  const severity = useMemo(() => {
    const maxConc = Math.max(
      ...Object.values(state.nodeConcentrations).map((n) => Math.max(...Object.values(n))),
    );
    return Math.min(maxConc / 50, 1);
  }, [state.nodeConcentrations]);

  // Find nearest node and add spill on map click
  const handleMapClick = (lat: number, lng: number) => {
    let nearestNode = CHESAPEAKE_RIVER_NETWORK[0];
    let minDist = Infinity;
    CHESAPEAKE_RIVER_NETWORK.forEach((node) => {
      const dist = Math.hypot(node.lat - lat, node.lng - lng);
      if (dist < minDist) { minDist = dist; nearestNode = node; }
    });
    setState((prev) => ({
      ...prev,
      activeSpills: [
        ...prev.activeSpills,
        { nodeId: nearestNode.id, amount: 100, startTime: prev.timeStep, type: prev.selectedContaminant },
      ],
    }));
  };

  // Simulation tick
  const runSimulationStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      timeStep: prev.timeStep + 1,
      nodeConcentrations: tickSimulation(prev, CHESAPEAKE_RIVER_NETWORK),
    }));
  }, []);

  useEffect(() => {
    let interval: any;
    if (isPlaying) interval = setInterval(runSimulationStep, 500);
    return () => clearInterval(interval);
  }, [isPlaying, runSimulationStep]);

  // History for chart
  useEffect(() => {
    const concentrations = Object.values(state.nodeConcentrations).map((node) =>
      Object.values(node).reduce((a, b) => a + b, 0),
    );
    const avg = concentrations.reduce((a, b) => a + b, 0) / CHESAPEAKE_RIVER_NETWORK.length;
    setHistory((prev) => [...prev.slice(-40), { time: state.timeStep, avgConcentration: avg }]);
  }, [state.timeStep, state.nodeConcentrations]);

  const resetSimulation = () => {
    setIsPlaying(false);
    setState({
      rainfall: 35,
      fertilizer: 25,
      stormIntensity: 15,
      timeStep: 0,
      activeSpills: [],
      activeInterventions: [],
      nodeConcentrations: buildEutrophicState(),
      selectedContaminant: 'Nitrogen',
    });
    setHistory([]);
  };

  // River lines coloring
  const riverLines = useMemo(() => {
    return CHESAPEAKE_RIVER_NETWORK.filter((n) => n.downstreamId).map((node) => {
      const downstream = CHESAPEAKE_RIVER_NETWORK.find((n) => n.id === node.downstreamId);
      if (!downstream) return null;
      const nodeConc = state.nodeConcentrations[node.id];
      const downConc = state.nodeConcentrations[downstream.id];
      let dominantType: ContaminantType = 'Nitrogen';
      let maxVal = -1;
      (Object.keys(CONTAMINANTS) as ContaminantType[]).forEach((t) => {
        const avg = ((nodeConc[t] as number) + (downConc[t] as number)) / 2;
        if (avg > maxVal) { maxVal = avg; dominantType = t; }
      });
      return {
        id: `${node.id}-${downstream.id}`,
        positions: [[node.lat, node.lng], [downstream.lat, downstream.lng]] as [number, number][],
        concentration: maxVal,
        type: dominantType,
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }, [state.nodeConcentrations]);

  const healthScore = computeHealthScore(state.nodeConcentrations, CHESAPEAKE_RIVER_NETWORK);

  return (
    <div className="flex h-screen w-full bg-zinc-950 overflow-hidden font-sans text-zinc-100 relative">
      {/* Severity overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-[9999]"
        animate={{
          backgroundColor:
            severity > 0.1
              ? `rgba(${255 * severity}, ${255 * (1 - severity)}, 0, 0.07)`
              : 'rgba(16, 185, 129, 0.03)',
        }}
        transition={{ duration: 1 }}
      />

      {/* ===== Sidebar ===== */}
      <aside className="w-80 border-r border-zinc-800 bg-zinc-900/50 flex flex-col overflow-hidden z-10">
        {/* Header */}
        <header className="p-5 pb-3 border-b border-zinc-800 space-y-1 shrink-0">
          <div className="flex items-center gap-2 text-emerald-400">
            <Sprout size={22} />
            <h1 className="text-xl font-bold tracking-tight">AlgaeMind</h1>
          </div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">
            AI Algae Bloom Remediation Agent
          </p>
        </header>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
          {(['agent', 'controls'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors',
                activeTab === tab
                  ? 'text-emerald-400 border-b-2 border-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {tab === 'agent' ? '🧠 RL Agent' : '🎛 Controls'}
            </button>
          ))}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'agent' ? (
            <AlgaeRLPanel
              state={state}
              setState={setState}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
            />
          ) : (
            <div className="space-y-6">
              <section className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-300">Environmental Drivers</h2>
                  <Info size={14} className="text-zinc-600 cursor-help" />
                </div>
                <ControlSlider
                  label="Rainfall" value={state.rainfall}
                  onChange={(v) => setState((s) => ({ ...s, rainfall: v }))}
                  icon={Droplets} color="blue"
                />
                <ControlSlider
                  label="Storm Intensity" value={state.stormIntensity}
                  onChange={(v) => setState((s) => ({ ...s, stormIntensity: v }))}
                  icon={Wind} color="amber"
                />
              </section>

              <section>
                <ContaminantSelector
                  selected={state.selectedContaminant}
                  onSelect={(t) => setState((s) => ({ ...s, selectedContaminant: t }))}
                />
                <p className="text-[9px] text-zinc-600 mt-2">Click the map to add a manual spill at the nearest node</p>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-zinc-300">Simulation Control</h2>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setIsPlaying((v) => !v)}
                    className={cn(
                      'flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium transition-all',
                      isPlaying
                        ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20',
                    )}
                  >
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    {isPlaying ? 'Pause' : 'Simulate'}
                  </button>
                  <button
                    onClick={resetSimulation}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-medium transition-all"
                  >
                    <RotateCcw size={18} />
                    Reset
                  </button>
                </div>
                <p className="text-[9px] text-zinc-600">
                  Simulation starts in an eutrophic (algae-impaired) state.
                  Use the RL Agent tab to run autonomous remediation.
                </p>
              </section>

              {/* Intervention legend */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-zinc-300">Interventions</h2>
                <div className="space-y-1.5">
                  {INTERVENTION_LIST.map((iv) => (
                    <div key={iv.id} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: iv.color }} />
                      <span className="text-[10px] text-zinc-400">{iv.shortName}</span>
                      <span className="text-[9px] text-zinc-600 ml-auto">{iv.cost}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <main className="flex-1 flex flex-col relative">
        {/* Map */}
        <div className="flex-1 relative z-0">
          <MapContainer
            center={[39.5, -76.5]}
            zoom={7}
            className="h-full w-full"
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <MapEvents onMapClick={handleMapClick} />

            {/* River network */}
            {riverLines.map((line: any) => (
              <Polyline
                key={line.id}
                positions={line.positions}
                pathOptions={{
                  color: line.concentration > 0.5
                    ? CONTAMINANTS[line.type as ContaminantType].color
                    : '#3b82f6',
                  weight: 2 + Math.min(line.concentration / 5, 8),
                  opacity: 0.65,
                  lineCap: 'round',
                }}
              />
            ))}

            {/* Nodes */}
            {CHESAPEAKE_RIVER_NETWORK.map((node) => {
              const concentrations = state.nodeConcentrations[node.id];
              const totalConc = (Object.values(concentrations) as number[]).reduce((a, b) => a + b, 0);
              let dominantType: ContaminantType = 'Nitrogen';
              let maxVal = -1;
              (Object.keys(CONTAMINANTS) as ContaminantType[]).forEach((t) => {
                const val = concentrations[t] as number;
                if (val > maxVal) { maxVal = val; dominantType = t; }
              });
              const isLake = node.type === 'lake';
              const hasActiveIntervention = state.activeInterventions.some(
                (iv) => iv.nodeId === node.id &&
                  state.timeStep >= iv.startTime &&
                  state.timeStep < iv.startTime + iv.duration,
              );
              return (
                <CircleMarker
                  key={node.id}
                  center={[node.lat, node.lng]}
                  radius={isLake ? 9 + Math.min(totalConc / 10, 14) : 4 + Math.min(totalConc / 10, 12)}
                  pathOptions={{
                    fillColor: totalConc > 1
                      ? CONTAMINANTS[dominantType].color
                      : (isLake ? '#0ea5e9' : '#3b82f6'),
                    color: hasActiveIntervention ? '#34d399' : (isLake ? '#fff' : '#fff'),
                    weight: hasActiveIntervention ? 3 : (isLake ? 2.5 : 1),
                    fillOpacity: 0.85,
                  }}
                >
                  <Popup className="custom-popup">
                    <div className="p-2 min-w-[160px]">
                      <h3 className="font-bold text-zinc-900 mb-0.5">{node.name}</h3>
                      {isLake && (
                        <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider mb-2 inline-block">
                          Lake / Reservoir
                        </span>
                      )}
                      {hasActiveIntervention && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider mb-2 inline-block ml-1">
                          Intervention Active
                        </span>
                      )}
                      <div className="space-y-1 pt-1.5 border-t border-zinc-100">
                        {(Object.keys(CONTAMINANTS) as ContaminantType[]).map((t) => (
                          <div key={t} className="flex justify-between items-center text-[10px]">
                            <span className="text-zinc-500">{t}:</span>
                            <span className="font-mono font-bold" style={{ color: CONTAMINANTS[t].color }}>
                              {(concentrations[t] as number).toFixed(2)}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center text-[10px] pt-1 border-t border-zinc-100">
                          <span className="font-bold text-zinc-700">Total:</span>
                          <span className="font-mono font-bold text-zinc-900">{totalConc.toFixed(2)} mg/L</span>
                        </div>
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>

          {/* Map overlay cards */}
          <div className="absolute top-5 right-5 z-[1000] flex flex-col gap-3">
            {/* Health score */}
            <motion.div
              className={cn(
                'bg-zinc-900/92 backdrop-blur-md border p-4 rounded-xl shadow-2xl flex flex-col items-center gap-0.5',
                healthScore >= 75
                  ? 'border-emerald-500 shadow-emerald-900/25'
                  : healthScore >= 50
                  ? 'border-amber-500 shadow-amber-900/25'
                  : 'border-red-500 shadow-red-900/25',
              )}
              animate={{ scale: [1, 1.02, 1] }}
              transition={{ repeat: Infinity, duration: 2.5 }}
            >
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                Watershed Health
              </span>
              <span className={cn(
                'text-2xl font-black font-mono',
                healthScore >= 75 ? 'text-emerald-400' :
                healthScore >= 50 ? 'text-amber-400' : 'text-red-400',
              )}>
                {healthScore.toFixed(1)}
              </span>
              <span className="text-[9px] text-zinc-600">/ 100</span>
            </motion.div>

            {/* Legend */}
            <div className="bg-zinc-900/92 backdrop-blur-md border border-zinc-800 p-4 rounded-xl shadow-2xl w-60">
              <div className="flex items-center gap-2 mb-3 text-zinc-400">
                <Layers size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Contaminant Legend</span>
              </div>
              <div className="space-y-2">
                {Object.values(CONTAMINANTS).map((c) => (
                  <div key={c.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-[10px] text-zinc-300">{c.name}</span>
                    </div>
                    <span className="text-[9px] text-zinc-500 font-mono">{c.source}</span>
                  </div>
                ))}
                <div className="pt-1 border-t border-zinc-800 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full border-2 border-emerald-400 bg-transparent" />
                  <span className="text-[10px] text-emerald-400">Active Intervention</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom panel */}
        <div className="h-56 border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-md p-5 flex gap-5">
          {/* Trend chart */}
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-blue-500" />
                <h3 className="text-sm font-semibold">Watershed Contamination Trend</h3>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">
                Avg Total Concentration (mg/L)
              </span>
            </div>
            <div className="flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorConc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a3e635" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a3e635" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', fontSize: '11px' }}
                    itemStyle={{ color: '#a3e635' }}
                  />
                  <Area
                    type="monotone" dataKey="avgConcentration"
                    stroke="#a3e635" fillOpacity={1} fill="url(#colorConc)" strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Basin stats */}
          <div className="w-72 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <MapIcon size={16} className="text-emerald-500" />
              <h3 className="text-sm font-semibold">Basin Statistics</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 flex-1">
              {[
                {
                  label: 'Active Spills', icon: AlertTriangle, color: 'text-amber-500',
                  value: state.activeSpills.length,
                },
                {
                  label: 'Peak Conc.', icon: Activity, color: 'text-red-400',
                  value: Math.max(...Object.values(state.nodeConcentrations).map((n) => Math.max(...Object.values(n)))).toFixed(1),
                },
                {
                  label: 'Algae Blooms', icon: Sprout, color: 'text-lime-400',
                  value: CHESAPEAKE_RIVER_NETWORK.filter(
                    (n) => (state.nodeConcentrations[n.id].Algae as number) > 5,
                  ).length,
                },
                {
                  label: 'Interventions', icon: FlaskConical, color: 'text-emerald-400',
                  value: state.activeInterventions.filter(
                    (iv) => state.timeStep >= iv.startTime && state.timeStep < iv.startTime + iv.duration,
                  ).length,
                },
              ].map((stat, i) => (
                <div
                  key={i}
                  className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-3 flex flex-col justify-center"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <stat.icon size={11} className="text-zinc-500" />
                    <span className="text-[9px] text-zinc-500 font-medium uppercase tracking-wider">{stat.label}</span>
                  </div>
                  <span className={cn('text-lg font-bold font-mono', stat.color)}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Leaflet overrides */}
      <style dangerouslySetInnerHTML={{ __html: `
        .leaflet-container { background: #09090b !important; }
        .custom-popup .leaflet-popup-content-wrapper {
          background: #ffffff; color: #09090b; border-radius: 12px; padding: 0;
        }
        .custom-popup .leaflet-popup-tip { background: #ffffff; }
      ` }} />
    </div>
  );
}
