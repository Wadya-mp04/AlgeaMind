/**
 * Dashboard — agent performance summary and real-world HAB cost comparison.
 *
 * Reads from:
 *  - props.healthHistory  (from useSimulation — real-time)
 *  - props.state          (current sim snapshot)
 *  - GET /api/agent/cost_report  (LLM agent session ledger + real-world benchmarks)
 */
import React, { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { AlertTriangle, DollarSign, Leaf, TrendingUp } from "lucide-react";
import { healthColor, type SimulationState } from "../data/types";
import type { AgentType } from "../hooks/useSimulation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CostReport {
  summary: {
    total_cycles:              number;
    total_cost_used:           number;
    traditional_cost_estimate: number;
    cost_saved:                number;
    percent_saved:             number;
    avg_cost_per_cycle:        number;
  };
  real_world_comparison?: {
    agent_estimated_usd:       number;
    traditional_estimated_usd: number;
    estimated_savings_usd:     number;
    breakdown_usd:             Record<string, number>;
    note:                      string;
  };
  action_breakdown: Record<string, { count: number; total_cost: number }>;
  comparison_note:  string;
  agent_type?: AgentType;
  ledger?: Array<{
    cycle: number;
    timestep: number;
    action_id: number;
    action_name: string;
    cost: number;
    traditional_cost_this_tick: number;
    health_before: number;
    bloom_cells: number;
    dead_zones: number;
  }>;
}

interface DashboardProps {
  state:         SimulationState | null;
  healthHistory: number[];
  agentType:     AgentType;
}

// ─── Real-world HAB benchmark data (ITRC HCB-1, EPA 2015, Wagner 2015) ────────

const REAL_WORLD_BENCHMARKS = [
  { name: "Algaecide/Alum",      low: 500,   mid: 933,   high: 2000,  unit: "$/event"   },
  { name: "Aeration (annual)",   low: 11000, mid: 25000, high: 50000, unit: "$/yr"       },
  { name: "Biomanipulation",     low: 300,   mid: 800,   high: 3000,  unit: "$/event"    },
  { name: "Mech. Harvest",       low: 400,   mid: 1200,  high: 3000,  unit: "$/acre"     },
  { name: "Constructed Wetland", low: 5000,  mid: 12000, high: 25000, unit: "$/acre cap" },
  { name: "Nutrient Mgmt.",      low: 200,   mid: 600,   high: 1500,  unit: "$/season"   },
];

// ─── ITRC-based per-acre cost rates (2020 USD) ──────────────────────────────
// Sources: ITRC HCB-1 C.2 Cost Compilation
// https://hcb-1.itrcweb.org/c-2-cost-compilation-for-several-mitigation-strategies/

// Daily operational costs (ongoing maintenance + monitoring, amortized from annual/capital costs)
const DAILY_COST_BASE_PER_ACRE = 300;  // $300/acre/day baseline (~$2070/day for 6.9-acre lake)
const DAILY_COST_PER_BLOOM_CELL = 75;  // $75/acre-day per bloom cell (chemical pre-treatment, monitoring)
const DAILY_COST_PER_DEAD_ZONE = 200;  // $200/acre-day per dead zone (emergency aeration 24/7)

// Simulation lake parameters (from backend constants)
const LAKE_AREA_ACRES = 6.9;  // 20×28 grid × 50 m²/cell ≈ 28,000 m² = 6.9 acres
const WATER_CELLS_COUNT = 480;  // approx. number of water (non-land) cells

// Per-action US-equivalent cost rates (from ITRC treatments)
const ACTION_USD_EQUIVALENT: Record<string, number> = {
  "Do Nothing": 0,
  "Reduce Nutrient Inflow": 600,        // Nutrient Mgmt from benchmarks
  "Aerate Region": 150,                 // Aeration O&amp;M mid-range
  "Increase Circulation": 250,          // Mechanical circulation
  "Mechanical Algae Removal": 360,      // ~$1200/acre capital ÷ 3 year lifespan
  "Add Shading": 200,                   // Low-cost intervention
  "Biological Control": 800,            // Biomanipulation mid-range
  "Chemical Treatment": 933,            // CuSO4 algaecide per ITRC Cossayuna Lake
  "Mitigate Industrial Spill": 1200,    // Emergency response scale
  "Wetland Filtration": 800,            // Long-term capital
};

// Effectiveness scores (% bloom reduction per treatment cycle, literature estimates)
const EFFECTIVENESS = [
  { treatment: "Chemical (algaecide)", effectiveness: 72, duration: "days",   cost_tier: "high",   sim_action: "Chemical Treatment"       },
  { treatment: "Aeration",             effectiveness: 45, duration: "weeks",  cost_tier: "high",   sim_action: "Aerate Region"            },
  { treatment: "Biomanipulation",      effectiveness: 55, duration: "months", cost_tier: "medium", sim_action: "Biological Control"       },
  { treatment: "Mechanical harvest",   effectiveness: 60, duration: "days",   cost_tier: "medium", sim_action: "Mechanical Algae Removal" },
  { treatment: "Shading",              effectiveness: 40, duration: "weeks",  cost_tier: "low",    sim_action: "Add Shading"              },
  { treatment: "Nutrient control",     effectiveness: 65, duration: "months", cost_tier: "low",    sim_action: "Reduce Nutrient Inflow"   },
  { treatment: "Constructed wetland",  effectiveness: 70, duration: "years",  cost_tier: "medium", sim_action: "Wetland Filtration"       },
];

// ─── Component ────────────────────────────────────────────────────────────────

export const Dashboard: React.FC<DashboardProps> = ({ state, healthHistory, agentType }) => {
  const [report,  setReport]  = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/agent/cost_report?agent_type=${agentType}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) setReport(await res.json());
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [agentType, state?.drivers.timestep]);

  const health    = state?.global_health ?? 0;
  const timestep  = state?.drivers.timestep ?? 0;
  const hColor    = healthColor(health);

  // Health trend chart data
  const healthData = healthHistory.map((h, i) => ({ t: i, h: Math.round(h) }));

  // Action breakdown for bar chart
  const actionData = report
    ? Object.entries(report.action_breakdown)
        .map(([name, d]) => ({
          name,
          count: d.count,
          totalCost: d.total_cost,
          unitCost: d.count > 0 ? d.total_cost / d.count : 0,
        }))
        .sort((a, b) => b.totalCost - a.totalCost)
    : [];

  // Calculate per-acre adjusted baseline cost (ITRC HCB-1 data, scaled to lake area)
  const calculateBaselineCost = (bloomCells: number, deadZoneCells: number): number => {
    // Base costs: continuous monitoring + preventive maintenance
    const baseDaily = LAKE_AREA_ACRES * DAILY_COST_BASE_PER_ACRE;
    
    // Bloom response cost: proportional to cells affected relative to total water cells
    const bloomExtra = (bloomCells / WATER_CELLS_COUNT) * LAKE_AREA_ACRES * DAILY_COST_PER_BLOOM_CELL;
    
    // Dead zone cost: urgent aeration / remediation (highest priority)
    const deadZoneExtra = (deadZoneCells / WATER_CELLS_COUNT) * LAKE_AREA_ACRES * DAILY_COST_PER_DEAD_ZONE;
    
    return baseDaily + bloomExtra + deadZoneExtra;
  };

  const ledger = report?.ledger ?? [];
  
  let runningAgentUsd = 0;
  const linearCostData = ledger.length > 0
    ? ledger.map((entry) => {
        // Timestep * 6 / 24 = days elapsed (each tick ≈ 6 hours)
        const daysElapsed = (entry.timestep * 6) / 24;
        
        // Calculate baseline for this day based on bloom and dead zone cells
        const dailyCost = calculateBaselineCost(entry.bloom_cells, entry.dead_zones);
        const baselineAtThisPoint = Math.round(dailyCost * daysElapsed);
        
        // Only accumulate agent cost for actual interventions (action_id > 0 means not "Do Nothing")
        if (entry.action_id > 0) {
          runningAgentUsd += ACTION_USD_EQUIVALENT[entry.action_name] ?? 0;
        }
        
        return {
          cycle: entry.cycle,
          realWorldUsd: baselineAtThisPoint,
          agentUsd: Math.round(runningAgentUsd),
          savingsUsd: Math.round(baselineAtThisPoint - runningAgentUsd),
        };
      })
    : [{ cycle: 0, realWorldUsd: 0, agentUsd: 0, savingsUsd: 0 }];

  const llmAgentUsd = linearCostData[linearCostData.length - 1]?.agentUsd ?? 0;
  const finalRealWorldBaselineUsd = linearCostData[linearCostData.length - 1]?.realWorldUsd ?? 0;
  const usdSavings = finalRealWorldBaselineUsd - llmAgentUsd;
  const usdSavedPct = finalRealWorldBaselineUsd > 0
    ? (usdSavings / finalRealWorldBaselineUsd) * 100
    : 0;

  const histogramData = [
    { label: "US Real-World", cost: finalRealWorldBaselineUsd, fill: "#e05252" },
    { label: "LLM Agent", cost: llmAgentUsd, fill: "#4a9eff" },
    { label: "Savings", cost: usdSavings, fill: usdSavings >= 0 ? "#2dba57" : "#f97316" },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-5">

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Ecosystem Health"
          value={`${health.toFixed(0)}/100`}
          color={hColor}
          icon={<Leaf size={16} />}
          sub={health >= 75 ? "Healthy" : health >= 50 ? "Warning" : "Critical"}
        />
        <SummaryCard
          label="Timesteps"
          value={String(timestep)}
          color="#4a9eff"
          icon={<TrendingUp size={16} />}
          sub={`~${Math.round(timestep * 6 / 24)} days simulated`}
        />
        <SummaryCard
          label="Agent Cycles"
          value={String(report?.summary.total_cycles ?? "—")}
          color="#a78bfa"
          icon={<TrendingUp size={16} />}
          sub={`${(report?.agent_type ?? agentType).toUpperCase()} · avg ¢${report?.summary.avg_cost_per_cycle?.toFixed(1) ?? "—"} / cycle`}
        />
        <SummaryCard
          label="USD Saved"
          value={report && finalRealWorldBaselineUsd > 0 ? `$${Math.abs(usdSavings).toLocaleString()}` : "—"}
          color={report && usdSavings >= 0 ? "#2dba57" : "#e05252"}
          icon={<DollarSign size={16} />}
          sub={report && finalRealWorldBaselineUsd > 0 ? `${usdSavedPct.toFixed(1)}% of $${finalRealWorldBaselineUsd.toLocaleString()}` : "Run LLM agent"}
        />
      </div>

      {/* ── Health trend ────────────────────────────────────────────────────── */}
      <Section title="Ecosystem Health Over Time" color="#4a9eff">
        {healthData.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={healthData} margin={{ top: 6, right: 12, bottom: 4, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" />
              <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#9ca3af" }}
              />
              <ReferenceLine y={75} stroke="#2dba57" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: "Healthy (75)", fill: "#2dba57", fontSize: 11, position: "insideTopRight" }} />
              <ReferenceLine y={50} stroke="#f0c040" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: "Warning (50)", fill: "#f0c040", fontSize: 11, position: "insideTopRight" }} />
              <ReferenceLine y={30} stroke="#e07830" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: "Critical (30)", fill: "#e07830", fontSize: 11, position: "insideTopRight" }} />
              <Line type="monotone" dataKey="h" stroke={hColor} strokeWidth={2} dot={false} name="Health" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState text="Run the simulation to see health trend." />
        )}
      </Section>

      {loading && (
        <div className="text-sm text-gray-500 text-center py-3">Loading cost report…</div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-800/40 rounded px-4 py-3">
          <AlertTriangle size={14} /> Cost report unavailable — run the LLM agent first.
        </div>
      )}

      {report && (
        <>
          {/* ── Histogram: real-world vs agent vs savings ───────────────────── */}
          <Section title="Histogram — Real-World vs LLM Agent Intervention Cost (USD)" color="#a78bfa">
            <div className="flex gap-6 items-start">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={histogramData} margin={{ top: 6, right: 12, bottom: 4, left: -4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickFormatter={v => `$${Number(v).toLocaleString()}`} />
                    <Tooltip
                      formatter={(v: number) => [`$${Math.abs(v).toLocaleString()}`, "USD"]}
                      contentStyle={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, fontSize: 12 }}
                    />
                    <Bar dataKey="cost" name="USD" radius={[4, 4, 0, 0]}>
                      {histogramData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-sm text-gray-400 flex flex-col gap-2 pt-3 min-w-[140px]">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Summary</div>
                <div className="text-[11px] text-gray-500 mb-1">Agent type: <span className="text-[#4a9eff] font-semibold">{(report.agent_type ?? agentType).toUpperCase()}</span></div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">US baseline</span>
                  <span className="text-[#e05252] font-mono font-semibold">${finalRealWorldBaselineUsd.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">LLM agent</span>
                  <span className="text-[#4a9eff] font-mono font-semibold">${llmAgentUsd.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-3 border-t border-[#1a3050] pt-2 mt-1">
                  <span className="text-gray-500">Saved</span>
                  <span className={`font-mono font-bold ${usdSavings >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ${Math.abs(usdSavings).toLocaleString()} ({usdSavedPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="text-[10px] text-gray-600 leading-relaxed mt-2">
                  Base cost: ${Math.round(DAILY_COST_BASE_PER_ACRE * LAKE_AREA_ACRES)}/day. Escalates with bloom presence and dead zones per ITRC data.
                </div>
              </div>
            </div>
          </Section>

          {/* ── Linear cost graph ───────────────────────────────────────────── */}
          <Section title="Linear Graph — Real-World Baseline vs Agent Intervention Cost" color="#2dba57">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={linearCostData} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" />
                <XAxis dataKey="cycle" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}K`} tick={{ fill: "#6b7280", fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number, n: string) => [`$${Math.round(v).toLocaleString()}`, n]}
                  contentStyle={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, fontSize: 12 }}
                />
                <Line type="linear" dataKey="realWorldUsd" name="US real-world baseline" stroke="#e05252" strokeWidth={2} dot={false} />
                <Line type="linear" dataKey="agentUsd" name="LLM agent interventions" stroke="#4a9eff" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-600 mt-3 leading-relaxed">
              The red baseline line increases based on ITRC per-acre costs scaled to your {LAKE_AREA_ACRES}-acre lake. Base cost: ${Math.round(DAILY_COST_BASE_PER_ACRE * LAKE_AREA_ACRES)}/day, escalating with bloom cells (+${Math.round(DAILY_COST_PER_BLOOM_CELL * LAKE_AREA_ACRES)}/acre-day) and dead zones (+${Math.round(DAILY_COST_PER_DEAD_ZONE * LAKE_AREA_ACRES)}/acre-day). Blue line shows cumulative agent spending.
            </p>
          </Section>

          {/* ── Action breakdown ──────────────────────────────────────────────── */}
          {actionData.length > 0 && (
            <Section title="Intervention Cost by Action (Sim Units)" color="#f97316">
              <ResponsiveContainer width="100%" height={Math.max(180, actionData.length * 34)}>
                <BarChart data={actionData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 140 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: "#9ca3af", fontSize: 11 }} width={140} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      name === "totalCost" ? `¢${v.toFixed(1)}` : v,
                      name === "totalCost" ? "Total cost" : name === "count" ? "Times used" : "Avg cost/use",
                    ]}
                    contentStyle={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="totalCost" name="Total cost" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-3 border-t border-[#1a3050] pt-3">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Action Cost Ledger</div>
                <div className="grid grid-cols-4 gap-2 text-[11px] text-gray-500 pb-1 border-b border-[#1a3050]">
                  <span>Action</span>
                  <span className="text-right">Count</span>
                  <span className="text-right">Avg cost/use</span>
                  <span className="text-right">Total cost</span>
                </div>
                {actionData.map((a) => (
                  <div key={a.name} className="grid grid-cols-4 gap-2 text-[11px] py-1 border-b border-[#0f2138] last:border-0">
                    <span className="text-gray-300 truncate">{a.name}</span>
                    <span className="text-right text-gray-400 font-mono">{a.count}</span>
                    <span className="text-right text-[#4a9eff] font-mono">¢{a.unitCost.toFixed(1)}</span>
                    <span className="text-right text-[#f97316] font-mono font-semibold">¢{a.totalCost.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {/* ── Real-world benchmarks ────────────────────────────────────────────── */}
      <Section title="Real-World HAB Treatment Benchmarks" color="#60a5fa">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-[#1a3050]">
                <th className="text-left pb-2">Treatment</th>
                <th className="text-right pb-2">Low</th>
                <th className="text-right pb-2">Mid</th>
                <th className="text-right pb-2">High</th>
                <th className="text-right pb-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {REAL_WORLD_BENCHMARKS.map(b => (
                <tr key={b.name} className="border-b border-[#0d1b2e] hover:bg-[#0a1628]">
                  <td className="py-2 text-gray-200 font-medium">{b.name}</td>
                  <td className="py-2 text-right text-gray-500 font-mono">${b.low.toLocaleString()}</td>
                  <td className="py-2 text-right text-[#4a9eff] font-mono font-semibold">${b.mid.toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-500 font-mono">${b.high.toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-500">{b.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Sources: ITRC HCB-1 C.2 Cost Compilation, EPA Nutrient Economics Report 2015, Wagner (2015) aeration case studies. Mid-range values are used as fixed US reference costs.
        </p>
      </Section>

      {/* ── Treatment effectiveness comparison ──────────────────────────────── */}
      <Section title="Treatment Effectiveness vs Simulated Agent Actions" color="#a78bfa">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-[#1a3050]">
                <th className="text-left pb-2">Real-world treatment</th>
                <th className="text-right pb-2">Bloom reduction</th>
                <th className="text-right pb-2">Duration</th>
                <th className="text-right pb-2">Cost tier</th>
                <th className="text-left pb-2 pl-4">Sim equivalent</th>
              </tr>
            </thead>
            <tbody>
              {EFFECTIVENESS.map(e => {
                const used = report?.action_breakdown[e.sim_action];
                return (
                  <tr key={e.treatment} className="border-b border-[#0d1b2e] hover:bg-[#0a1628]">
                    <td className="py-2 text-gray-200">{e.treatment}</td>
                    <td className="py-2 text-right">
                      <span className="font-mono font-semibold" style={{ color: e.effectiveness >= 60 ? "#2dba57" : e.effectiveness >= 45 ? "#f0c040" : "#9ca3af" }}>
                        {e.effectiveness}%
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-500">{e.duration}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        e.cost_tier === "high"   ? "text-red-400 bg-red-900/20" :
                        e.cost_tier === "medium" ? "text-yellow-400 bg-yellow-900/20" :
                                                   "text-green-400 bg-green-900/20"
                      }`}>{e.cost_tier}</span>
                    </td>
                    <td className="py-2 pl-4 text-gray-400">
                      {e.sim_action}
                      {used && (
                        <span className="ml-2 text-[#4a9eff] font-semibold">×{used.count}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Bloom reduction estimates from field studies. Simulation effectiveness is qualitative.
          Agent action counts shown in blue when the LLM agent used that intervention this session.
        </p>
      </Section>

    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; color: string; children: React.ReactNode }> = ({
  title, color, children,
}) => (
  <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-4">
    <div className="flex items-center gap-2 mb-4">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{title}</span>
    </div>
    {children}
  </div>
);

const SummaryCard: React.FC<{
  label: string; value: string; color: string;
  icon: React.ReactNode; sub: string;
}> = ({ label, value, color, icon, sub }) => (
  <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-4">
    <div className="flex items-center gap-2 mb-2 text-gray-500 text-xs uppercase tracking-wider">
      <span style={{ color }}>{icon}</span>
      {label}
    </div>
    <div className="text-2xl font-bold" style={{ color }}>{value}</div>
    <div className="text-xs text-gray-500 mt-1">{sub}</div>
  </div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center justify-center h-20 text-sm text-gray-600">{text}</div>
);

export default Dashboard;
