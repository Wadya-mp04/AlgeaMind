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
}

interface DashboardProps {
  state:         SimulationState | null;
  healthHistory: number[];
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

export const Dashboard: React.FC<DashboardProps> = ({ state, healthHistory }) => {
  const [report,  setReport]  = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/agent/cost_report");
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
  }, []);

  const health    = state?.global_health ?? 0;
  const timestep  = state?.drivers.timestep ?? 0;
  const hColor    = healthColor(health);

  // Health trend chart data
  const healthData = healthHistory.map((h, i) => ({ t: i, h: Math.round(h) }));

  // Action breakdown for bar chart
  const actionData = report
    ? Object.entries(report.action_breakdown)
        .map(([name, d]) => ({ name, count: d.count, cost: d.total_cost }))
        .sort((a, b) => b.count - a.count)
    : [];

  // Simulated cost comparison
  const simCostData = report
    ? [
        { label: "Agent",     cost: report.summary.total_cost_used,           fill: "#4a9eff" },
        { label: "Reactive",  cost: report.summary.traditional_cost_estimate, fill: "#e05252" },
      ]
    : [];

  // Real-world USD comparison
  const rwData = report?.real_world_comparison
    ? [
        { label: "Agent (est.)",    cost: report.real_world_comparison.agent_estimated_usd,       fill: "#4a9eff" },
        { label: "Chemical-heavy",  cost: report.real_world_comparison.traditional_estimated_usd, fill: "#e05252" },
      ]
    : [];

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
          sub={`avg ¢${report?.summary.avg_cost_per_cycle?.toFixed(1) ?? "—"} / cycle`}
        />
        <SummaryCard
          label="Sim Cost Saved"
          value={report ? `¢${report.summary.cost_saved}` : "—"}
          color={report && report.summary.cost_saved >= 0 ? "#2dba57" : "#e05252"}
          icon={<DollarSign size={16} />}
          sub={report ? `${report.summary.percent_saved.toFixed(0)}% vs reactive` : "Run LLM agent"}
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
          {/* ── Simulated cost comparison ────────────────────────────────────── */}
          <Section title="Agent vs Reactive Baseline — Simulated Cost Units" color="#a78bfa">
            <div className="flex gap-6 items-start">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={simCostData} margin={{ top: 6, right: 12, bottom: 4, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, fontSize: 12 }}
                    />
                    <Bar dataKey="cost" name="Cost (units)" radius={[4, 4, 0, 0]}>
                      {simCostData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-sm text-gray-400 flex flex-col gap-2 pt-3 min-w-[140px]">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Summary</div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Agent</span>
                  <span className="text-[#4a9eff] font-mono font-semibold">¢{report.summary.total_cost_used}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Baseline</span>
                  <span className="text-[#e05252] font-mono font-semibold">¢{report.summary.traditional_cost_estimate}</span>
                </div>
                <div className="flex justify-between gap-3 border-t border-[#1a3050] pt-2 mt-1">
                  <span className="text-gray-500">Saved</span>
                  <span className={`font-mono font-bold ${report.summary.cost_saved >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ¢{report.summary.cost_saved} ({report.summary.percent_saved.toFixed(0)}%)
                  </span>
                </div>
              </div>
            </div>
          </Section>

          {/* ── Real-world USD comparison ─────────────────────────────────────── */}
          {report.real_world_comparison && (
            <Section title="Real-World Cost Equivalent — USD Estimate" color="#2dba57">
              <div className="flex gap-6 items-start">
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={rwData} margin={{ top: 6, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" />
                      <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                      <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fill: "#6b7280", fontSize: 11 }} />
                      <Tooltip
                        formatter={(v: number) => [`$${v.toLocaleString()}`, "Est. USD"]}
                        contentStyle={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, fontSize: 12 }}
                      />
                      <Bar dataKey="cost" name="Est. USD" radius={[4, 4, 0, 0]}>
                        {rwData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-sm text-gray-400 flex flex-col gap-2 pt-3 min-w-[150px]">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">USD Estimate</div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Agent</span>
                    <span className="text-[#4a9eff] font-mono font-semibold">${report.real_world_comparison.agent_estimated_usd.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Reactive</span>
                    <span className="text-[#e05252] font-mono font-semibold">${report.real_world_comparison.traditional_estimated_usd.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-[#1a3050] pt-2 mt-1">
                    <span className="text-gray-500">Saved</span>
                    <span className={`font-mono font-bold ${report.real_world_comparison.estimated_savings_usd >= 0 ? "text-green-400" : "text-red-400"}`}>
                      ${Math.abs(report.real_world_comparison.estimated_savings_usd).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-2 leading-relaxed">{report.real_world_comparison.note.slice(0, 100)}…</p>
                </div>
              </div>
            </Section>
          )}

          {/* ── Action breakdown ──────────────────────────────────────────────── */}
          {actionData.length > 0 && (
            <Section title="Interventions Used by Agent" color="#f97316">
              <ResponsiveContainer width="100%" height={Math.max(160, actionData.length * 32)}>
                <BarChart data={actionData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 120 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: "#9ca3af", fontSize: 11 }} width={120} />
                  <Tooltip
                    contentStyle={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="count" name="Times used" fill="#4a9eff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
          Sources: ITRC HCB-1 C.2 Cost Compilation, EPA Nutrient Economics Report 2015, Wagner (2015) aeration case studies. All USD 2020.
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
