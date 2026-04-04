/**
 * ControlPanel — environmental drivers, simulation playback controls,
 * manual event triggers, and external data import (USGS / NASA).
 */
import React, { useState } from "react";
import {
  AlertTriangle,
  CloudRain,
  Droplets,
  FlaskConical,
  Flame,
  Info,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Thermometer,
  Zap,
} from "lucide-react";
import type { FlowConfig, FlowPreset, GlobalDrivers, SimulationState } from "../data/types";
import type { EventType } from "../hooks/useSimulation";

// ── Shared tooltip component ──────────────────────────────────────────────────
const Tip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <span className="relative group inline-flex">
    {children}
    <span className="pointer-events-none absolute bottom-full left-0 mb-2 z-50
                     w-max max-w-[220px] rounded-lg bg-[#0a1628] border border-[#1e3a5f]
                     px-2.5 py-1.5 text-xs text-gray-300 shadow-xl leading-snug
                     opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-normal">
      {text}
    </span>
  </span>
);

interface ControlPanelProps {
  state:             SimulationState | null;
  isRunning:         boolean;
  playbackSpeed:     number;
  onPlay:            () => void;
  onStep:            () => void;
  onReset:           () => void;
  onDriverChange:    (partial: Partial<GlobalDrivers>) => void;
  onFlowChange:      (partial: Partial<FlowConfig>) => void;
  onFlowPreset:      (preset: FlowPreset) => void;
  onPlaybackSpeed:   (v: number) => void;
  onTriggerEvent?:   (eventType: EventType) => void;
}

const SEASON_NAMES = ["❄ Winter", "🌱 Spring", "☀ Summer", "🍂 Fall"];

export const ControlPanel: React.FC<ControlPanelProps> = ({
  state,
  isRunning,
  playbackSpeed,
  onPlay,
  onStep,
  onReset,
  onDriverChange,
  onFlowChange,
  onFlowPreset,
  onPlaybackSpeed,
  onTriggerEvent,
}) => {
  const d = state?.drivers;
  const f = state?.flow_config;

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* ── Playback ─────────────────────────────────────────────────────── */}
      <section className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">Simulation</div>
        <div className="flex gap-2">
          <Tip text={isRunning ? "Pause the automatic simulation loop" : "Start running the simulation automatically (each tick = ~6 hours)"}>
            <button onClick={onPlay}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-sm font-bold transition-colors ${
                      isRunning
                        ? "bg-[#e05252]/20 border border-[#e05252]/50 text-[#e05252]"
                        : "bg-[#2dba57]/15 border border-[#2dba57]/50 text-[#2dba57]"
                    }`}>
              {isRunning ? <Pause size={15} /> : <Play size={15} />}
              {isRunning ? "Pause" : "Play"}
            </button>
          </Tip>
          <Tip text="Advance exactly one tick (~6h). Useful for examining changes step-by-step.">
            <button onClick={onStep} disabled={isRunning}
                    className="flex items-center justify-center gap-1 px-3 py-2 rounded text-xs
                               bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-gray-200
                               transition-colors disabled:opacity-40">
              <SkipForward size={14} />
            </button>
          </Tip>
          <Tip text="Reset the simulation to initial eutrophic conditions (elevated N/P, partial bloom)">
            <button onClick={onReset}
                    className="flex items-center justify-center gap-1 px-3 py-2 rounded text-xs
                               bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-orange-400 transition-colors">
              <RefreshCw size={14} />
            </button>
          </Tip>
        </div>
        {d && <div className="mt-2 text-[11px] text-gray-400">Tick {d.timestep} · {SEASON_NAMES[d.season]}</div>}
        <div className="mt-2 flex items-center justify-between gap-2 bg-[#0a1628] border border-[#1e3a5f] rounded px-2 py-1.5">
          <Tip text="How many simulation ticks to run per 500ms. Higher = faster time-lapse but less visible per-step detail. 64× runs ~16 days per second.">
            <div className="flex items-center gap-1 cursor-help">
              <Zap size={12} className="text-yellow-400" />
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Speed</span>
            </div>
          </Tip>
          <select value={playbackSpeed} onChange={e => onPlaybackSpeed(Number(e.target.value))}
                  className="bg-[#07111f] border border-[#1e3a5f] text-gray-200 text-xs rounded px-2 py-1">
            <option value={1}>1× Normal</option>
            <option value={2}>2× Fast</option>
            <option value={4}>4× Faster</option>
            <option value={8}>8× Rapid</option>
            <option value={16}>16× Turbo</option>
            <option value={32}>32× Ultra</option>
            <option value={64}>64× Max</option>
          </select>
        </div>
      </section>

      {/* ── Manual Events ────────────────────────────────────────────────── */}
      <section className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={13} className="text-orange-400" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Manual Events</span>
          <Tip text="Instantly trigger environmental shocks to test agent response and observe ecosystem dynamics">
            <Info size={12} className="text-gray-600 cursor-help" />
          </Tip>
        </div>
        <div className="text-[11px] text-gray-500 mb-2">Trigger environmental events instantly</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Tip text="Industrial Spill: Dumps +50 toxic/chemical load at a random inflow cell (60% chance at east discharge, 40% at any inflow). Spreads downstream via current. Use action 8 to contain.">
            <EventButton icon={<FlaskConical size={12} />} label="Ind. Spill" color="#ff9900"
                         onClick={() => onTriggerEvent?.("industrial_spill")} />
          </Tip>
          <Tip text="Heavy Rain: Raises rainfall +55% and storm intensity +45% instantly. Causes nutrient surge at all inflows — major bloom trigger. Map shows blue turbidity overlay.">
            <EventButton icon={<CloudRain size={12} />} label="Heavy Rain" color="#60a5fa"
                         onClick={() => onTriggerEvent?.("heavy_rain")} />
          </Tip>
          <Tip text="Heat Wave: Raises water temperature +9°C. Dramatically accelerates algae growth rate (temp coefficient). Map shows red-orange shimmer. Use shading or circulation to counter.">
            <EventButton icon={<Flame size={12} />} label="Heat Wave" color="#ef4444"
                         onClick={() => onTriggerEvent?.("heat_wave")} />
          </Tip>
          <Tip text="Drought: Reduces rainfall -30% and storm intensity -20%. Concentrates nutrients as water levels drop. Map shows yellow-brown tint. Reduces inflow dilution.">
            <EventButton icon={<Thermometer size={12} />} label="Drought" color="#f97316"
                         onClick={() => onTriggerEvent?.("drought")} />
          </Tip>
          <Tip text="Fertilizer Runoff: Injects +25 nitrogen and +18 phosphorus at ALL active inflow cells simultaneously — simulates spring field application and heavy first rain event.">
            <EventButton icon={<Droplets size={12} />} label="Fertilizer Runoff" color="#4ade80"
                         onClick={() => onTriggerEvent?.("fertilizer_runoff")} fullWidth />
          </Tip>
        </div>
      </section>

      {/* ── Flow topology ─────────────────────────────────────────────────── */}
      <section className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Droplets size={13} className="text-[#4a9eff]" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Hydrology</span>
        </div>
        <div className="text-[11px] text-gray-500 mb-2">Customize channels or apply preset</div>
        <div className="grid grid-cols-2 gap-1 mb-2">
          <PresetButton label="Default"   onClick={() => onFlowPreset("default")} />
          <PresetButton label="Lake"      onClick={() => onFlowPreset("lake")} />
          <PresetButton label="River"     onClick={() => onFlowPreset("river")} />
          <PresetButton label="Reservoir" onClick={() => onFlowPreset("reservoir")} />
        </div>
        <div className="flex flex-col gap-1">
          <FlowToggle label="North inflow"  checked={f?.inflow_north  ?? true} onChange={v => onFlowChange({ inflow_north:  v })} />
          <FlowToggle label="West inflow"   checked={f?.inflow_west   ?? true} onChange={v => onFlowChange({ inflow_west:   v })} />
          <FlowToggle label="East inflow"   checked={f?.inflow_east   ?? true} onChange={v => onFlowChange({ inflow_east:   v })} />
          <FlowToggle label="South outflow" checked={f?.outflow_south ?? true} onChange={v => onFlowChange({ outflow_south: v })} />
        </div>
      </section>

      {/* ── Environmental drivers ─────────────────────────────────────────── */}
      <section className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Thermometer size={13} className="text-orange-400" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Environment</span>
        </div>
        <div className="flex flex-col gap-3">
          <DriverSlider label="Temperature" unit="°C" value={d?.temperature ?? 18} min={5} max={35} step={0.5} color="#f97316"
            tip="Water temperature (°C). Above 15°C algae growth accelerates; above 25°C bloom risk is severe. Map shows orange heat shimmer above 27°C."
            onChange={v => onDriverChange({ temperature: v })} />
          <DriverSlider label="Rainfall" unit="" value={d?.rainfall ?? 0.2} min={0} max={1} step={0.01} color="#60a5fa"
            tip="Rainfall intensity (0–100%). Drives nutrient runoff from fields into lake via inflow channels. High values cause turbidity (blue map overlay)."
            onChange={v => onDriverChange({ rainfall: v })} />
          <DriverSlider label="Storm" unit="" value={d?.storm_intensity ?? 0} min={0} max={1} step={0.01} color="#a78bfa"
            tip="Storm intensity multiplies all runoff by up to 2.5×. Resuspends sediment, slows settling. Map shows blue-grey ripple overlay above 40%."
            onChange={v => onDriverChange({ storm_intensity: v })} />
          <DriverSlider label="Fertilizer" unit="" value={d?.fertilizer_use ?? 0.35} min={0} max={1} step={0.01} color="#4ade80"
            tip="Agricultural fertilizer use (0–100%). Scales how much N and P enter via north and west inflows each tick. Primary long-term bloom driver."
            onChange={v => onDriverChange({ fertilizer_use: v })} />
        </div>
      </section>

    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface DriverSliderProps {
  label:    string;
  unit:     string;
  value:    number;
  min:      number;
  max:      number;
  step:     number;
  color:    string;
  tip?:     string;
  onChange: (v: number) => void;
}

const DriverSlider: React.FC<DriverSliderProps> = ({ label, unit, value, min, max, step, color, tip, onChange }) => {
  const display = unit === "°C"
    ? `${value.toFixed(1)}°C`
    : `${(value * 100).toFixed(0)}%`;

  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5 items-center">
        <Tip text={tip ?? label}>
          <span className="text-gray-400 font-medium cursor-help flex items-center gap-1">
            {label} <Info size={10} className="text-gray-700" />
          </span>
        </Tip>
        <span style={{ color }} className="font-semibold">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded appearance-none cursor-pointer"
        style={{
          accentColor: color,
          background: `linear-gradient(to right, ${color} ${((value - min) / (max - min)) * 100}%, #1e3a5f ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
    </div>
  );
};

const PresetButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="px-2 py-1.5 rounded text-xs font-medium bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-gray-200 transition-colors"
  >
    {label}
  </button>
);

const FlowToggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label, checked, onChange,
}) => (
  <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#0a1628] border border-[#1e3a5f]/50 cursor-pointer">
    <span className="text-xs text-gray-400">{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      className="h-4 w-4 accent-[#4a9eff]"
    />
  </label>
);

const EventButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  fullWidth?: boolean;
}> = ({ icon, label, color, onClick, fullWidth }) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded text-xs font-semibold
                border transition-all hover:brightness-125 active:scale-95 ${fullWidth ? "col-span-2" : ""}`}
    style={{
      color,
      borderColor: color + "55",
      backgroundColor: color + "18",
    }}
  >
    {icon}
    {label}
  </button>
);


export default ControlPanel;
