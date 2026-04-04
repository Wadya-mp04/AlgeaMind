/**
 * ControlPanel — environmental drivers and simulation playback controls.
 */
import React from "react";
import {
  Droplets,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Thermometer,
  Wind,
} from "lucide-react";
import type { FlowConfig, FlowPreset, GlobalDrivers, SimulationState } from "../data/types";
import { ACTION_META } from "../data/types";

interface ControlPanelProps {
  state:          SimulationState | null;
  isRunning:      boolean;
  selectedAction: number;
  playbackSpeed:  number;
  onPlay:         () => void;
  onStep:         () => void;
  onReset:        () => void;
  onDriverChange: (partial: Partial<GlobalDrivers>) => void;
  onFlowChange:   (partial: Partial<FlowConfig>) => void;
  onFlowPreset:   (preset: FlowPreset) => void;
  onPlaybackSpeed:(v: number) => void;
  onActionSelect: (id: number) => void;
}

const SEASON_NAMES = ["❄ Winter", "🌱 Spring", "☀ Summer", "🍂 Fall"];

export const ControlPanel: React.FC<ControlPanelProps> = ({
  state,
  isRunning,
  selectedAction,
  playbackSpeed,
  onPlay,
  onStep,
  onReset,
  onDriverChange,
  onFlowChange,
  onFlowPreset,
  onPlaybackSpeed,
  onActionSelect,
}) => {
  const d = state?.drivers;
  const f = state?.flow_config;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Playback */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Simulation</div>
        <div className="flex gap-2">
          <button
            onClick={onPlay}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-sm font-semibold
                        transition-colors ${
                          isRunning
                            ? "bg-[#e05252]/20 border border-[#e05252]/50 text-[#e05252]"
                            : "bg-[#2dba57]/15 border border-[#2dba57]/50 text-[#2dba57]"
                        }`}
          >
            {isRunning ? <Pause size={14} /> : <Play size={14} />}
            {isRunning ? "Pause" : "Play"}
          </button>
          <button
            onClick={onStep}
            disabled={isRunning}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded text-xs
                       bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-gray-200
                       transition-colors disabled:opacity-40"
          >
            <SkipForward size={13} />
          </button>
          <button
            onClick={onReset}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded text-xs
                       bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-orange-400
                       transition-colors"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        {d && (
          <div className="mt-2 text-[10px] text-gray-500">
            Tick {d.timestep} · {SEASON_NAMES[d.season]}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 bg-[#0a1628] border border-[#1e3a5f] rounded px-2 py-1.5">
          <span className="text-xs text-gray-400 uppercase tracking-wider">Timelapse</span>
          <select
            value={playbackSpeed}
            onChange={e => onPlaybackSpeed(Number(e.target.value))}
            className="bg-[#07111f] border border-[#1e3a5f] text-gray-200 text-xs rounded px-2 py-1"
          >
            <option value={1}>Normal</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
            <option value={8}>8x</option>
            <option value={16}>16x</option>
          </select>
        </div>
      </div>

      {/* Flow topology */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Droplets size={12} className="text-[#4a9eff]" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Hydrology</span>
        </div>
        <div className="text-[10px] text-gray-500 mb-2">Customize channels or apply preset</div>

        <div className="grid grid-cols-2 gap-1 mb-2">
          <PresetButton label="Default" onClick={() => onFlowPreset("default")} />
          <PresetButton label="Lake" onClick={() => onFlowPreset("lake")} />
          <PresetButton label="River" onClick={() => onFlowPreset("river")} />
          <PresetButton label="Reservoir" onClick={() => onFlowPreset("reservoir")} />
        </div>

        <div className="flex flex-col gap-1">
          <FlowToggle
            label="North inflow"
            checked={f?.inflow_north ?? true}
            onChange={(v) => onFlowChange({ inflow_north: v })}
          />
          <FlowToggle
            label="West inflow"
            checked={f?.inflow_west ?? true}
            onChange={(v) => onFlowChange({ inflow_west: v })}
          />
          <FlowToggle
            label="East inflow"
            checked={f?.inflow_east ?? true}
            onChange={(v) => onFlowChange({ inflow_east: v })}
          />
          <FlowToggle
            label="South outflow"
            checked={f?.outflow_south ?? true}
            onChange={(v) => onFlowChange({ outflow_south: v })}
          />
        </div>
      </div>

      {/* Environmental drivers */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Thermometer size={12} className="text-orange-400" />
          <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Environment</span>
        </div>
        <div className="flex flex-col gap-3">
          <DriverSlider
            label="Temperature"
            unit="°C"
            value={d?.temperature ?? 18}
            min={5} max={35} step={0.5}
            color="#f97316"
            onChange={v => onDriverChange({ temperature: v })}
          />
          <DriverSlider
            label="Rainfall"
            unit=""
            value={d?.rainfall ?? 0.2}
            min={0} max={1} step={0.01}
            color="#60a5fa"
            onChange={v => onDriverChange({ rainfall: v })}
          />
          <DriverSlider
            label="Storm Intensity"
            unit=""
            value={d?.storm_intensity ?? 0}
            min={0} max={1} step={0.01}
            color="#a78bfa"
            onChange={v => onDriverChange({ storm_intensity: v })}
          />
          <DriverSlider
            label="Fertilizer Use"
            unit=""
            value={d?.fertilizer_use ?? 0.35}
            min={0} max={1} step={0.01}
            color="#4ade80"
            onChange={v => onDriverChange({ fertilizer_use: v })}
          />
        </div>
      </div>

      {/* Action selector */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          <Wind size={12} className="text-[#4a9eff]" />
            <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Intervention</span>
        </div>
        <div className="text-[10px] text-gray-500 mb-2">
            Select then click grid cell
        </div>
        <div className="flex flex-col gap-1">
          {ACTION_META.map(action => (
            <button
              key={action.id}
              onClick={() => onActionSelect(action.id)}
              title={action.description}
              className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-[10px]
                          transition-colors ${
                            selectedAction === action.id
                              ? "bg-[#1e3a5f]/80 border border-[#4a9eff]/50 text-white"
                              : "border border-transparent text-gray-400 hover:text-gray-200 hover:bg-[#0a1628]"
                          }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: action.color }}
              />
              <span className="truncate">{action.name}</span>
              {action.duration > 0 && (
                <span className="ml-auto text-gray-600 flex-shrink-0">{action.duration}t</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Slider ───────────────────────────────────────────────────────────────────

interface DriverSliderProps {
  label:    string;
  unit:     string;
  value:    number;
  min:      number;
  max:      number;
  step:     number;
  color:    string;
  onChange: (v: number) => void;
}

const DriverSlider: React.FC<DriverSliderProps> = ({
  label, unit, value, min, max, step, color, onChange,
}) => {
  const display = unit === "°C"
    ? `${value.toFixed(1)}°C`
    : (value * 100).toFixed(0) + "%";

  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-xs text-gray-400">{label}</span>
        <span style={{ color }} className="font-medium">{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded appearance-none cursor-pointer"
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
    className="px-2 py-1 rounded text-[10px] bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-gray-200 transition-colors"
  >
    {label}
  </button>
);

const FlowToggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#0a1628] border border-[#1e3a5f]/50">
    <span className="text-[10px] text-gray-400">{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 accent-[#4a9eff]"
    />
  </label>
);

export default ControlPanel;
