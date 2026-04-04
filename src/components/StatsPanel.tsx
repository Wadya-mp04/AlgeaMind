/**
 * StatsPanel — real-time metrics, health gauge, and trend chart.
 */
import React from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, Droplets, Leaf, Skull, Zap } from "lucide-react";
import { healthColor, type SimulationState } from "../data/types";

interface StatsPanelProps {
  state:         SimulationState | null;
  healthHistory: number[];
}

export const StatsPanel: React.FC<StatsPanelProps> = ({ state, healthHistory }) => {
  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Waiting for backend…
      </div>
    );
  }

  const health = state.global_health;
  const hColor = healthColor(health);

  // Build chart data from health history
  const chartData = healthHistory.map((h, i) => ({ t: i, h: Math.round(h) }));

  const totalWater = state.grid
    .flat()
    .filter(c => c.cell_type !== 1).length;

  const bloomPct  = totalWater > 0 ? ((state.bloom_cells  / totalWater) * 100).toFixed(1) : "0";
  const hypoxPct  = totalWater > 0 ? ((state.hypoxic_cells / totalWater) * 100).toFixed(1) : "0";
  const deadPct   = totalWater > 0 ? ((state.dead_zone_cells / totalWater) * 100).toFixed(1) : "0";

  return (
    <div className="flex flex-col gap-3">
      {/* Global health gauge */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={15} className="text-[#4a9eff]" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Ecosystem Health</span>
        </div>
        <div className="flex items-end gap-2 mb-2">
          <span className="text-3xl font-bold" style={{ color: hColor }}>
            {health.toFixed(0)}
          </span>
          <span className="text-gray-500 text-base mb-0.5">/ 100</span>
          <span className="ml-auto text-xs font-semibold" style={{ color: hColor }}>
            {health >= 75 ? "HEALTHY" : health >= 50 ? "WARNING" : health >= 30 ? "CRITICAL" : "COLLAPSE"}
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full h-2 bg-[#0a1628] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width:           `${health}%`,
              backgroundColor: hColor,
              boxShadow:       `0 0 6px ${hColor}66`,
            }}
          />
        </div>
      </div>

      {/* Key metrics */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Key Metrics</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <MetricRow
            icon={<Leaf size={12} className="text-green-400" />}
            label="Bloom cells"
            value={`${state.bloom_cells} (${bloomPct}%)`}
            warn={state.bloom_cells > 20}
          />
          <MetricRow
            icon={<Droplets size={12} className="text-blue-400" />}
            label="Avg DO"
            value={`${state.avg_do.toFixed(1)}`}
            warn={state.avg_do < 30}
          />
          <MetricRow
            icon={<AlertTriangle size={12} className="text-orange-400" />}
            label="Hypoxic"
            value={`${state.hypoxic_cells} (${hypoxPct}%)`}
            warn={state.hypoxic_cells > 15}
          />
          <MetricRow
            icon={<Skull size={12} className="text-red-400" />}
            label="Dead zones"
            value={`${state.dead_zone_cells} (${deadPct}%)`}
            warn={state.dead_zone_cells > 0}
          />
          <MetricRow
            icon={<Zap size={12} className="text-yellow-400" />}
            label="Avg N"
            value={state.avg_nitrogen.toFixed(1)}
            warn={state.avg_nitrogen > 45}
          />
          <MetricRow
            icon={<Zap size={12} className="text-purple-400" />}
            label="Avg P"
            value={state.avg_phosphorus.toFixed(1)}
            warn={state.avg_phosphorus > 25}
          />
          <MetricRow
            icon={<Activity size={12} className="text-emerald-400" />}
            label="Biodiversity"
            value={state.avg_biodiversity.toFixed(1)}
            warn={state.avg_biodiversity < 40}
          />
          <MetricRow
            icon={<AlertTriangle size={12} className="text-red-500" />}
            label="Total algae"
            value={state.total_algae.toFixed(0)}
            warn={state.total_algae > 5000}
          />
        </div>
      </div>

      {/* Health trend chart */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Health Trend
        </div>
        {chartData.length > 2 ? (
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4a9eff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4a9eff" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, 100]} hide />
              <Tooltip
                contentStyle={{
                  background: "#0d1b2e", border: "1px solid #1e3a5f",
                  fontSize: 10, padding: "2px 6px",
                }}
                labelFormatter={() => ""}
                formatter={(v: number) => [`${v}/100`, "Health"]}
              />
              <Area
                type="monotone"
                dataKey="h"
                stroke="#4a9eff"
                strokeWidth={1.5}
                fill="url(#healthGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[90px] flex items-center justify-center text-[10px] text-gray-600">
            Run the simulation to see trend
          </div>
        )}
      </div>

      {/* Drivers summary */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Drivers</div>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span className="text-gray-500">Temperature</span>
          <span className="text-orange-400 font-medium">{state.drivers.temperature.toFixed(1)} °C</span>
          <span className="text-gray-500">Rainfall</span>
          <span className="text-blue-400 font-medium">{(state.drivers.rainfall * 100).toFixed(0)} %</span>
          <span className="text-gray-500">Storm</span>
          <span className="text-purple-400 font-medium">{(state.drivers.storm_intensity * 100).toFixed(0)} %</span>
          <span className="text-gray-500">Fertilizer</span>
          <span className="text-green-400 font-medium">{(state.drivers.fertilizer_use * 100).toFixed(0)} %</span>
        </div>
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const MetricRow: React.FC<{
  icon:  React.ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}> = ({ icon, label, value, warn }) => (
  <>
    <div className="flex items-center gap-1 text-xs text-gray-400">
      {icon}
      {label}
    </div>
    <div className={`text-xs font-medium text-right ${warn ? "text-orange-400" : "text-gray-200"}`}>
      {value}
    </div>
  </>
);

export default StatsPanel;
