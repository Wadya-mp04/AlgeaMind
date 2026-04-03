/**
 * ControlPanel — environmental drivers and simulation playback controls.
 */
import React from "react";
import {
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Thermometer,
  Wind,
} from "lucide-react";
import type { GlobalDrivers, SimulationState } from "../data/types";
import { ACTION_META } from "../data/types";

interface ControlPanelProps {
  state:          SimulationState | null;
  isRunning:      boolean;
  selectedAction: number;
  onPlay:         () => void;
  onStep:         () => void;
  onReset:        () => void;
  onDriverChange: (partial: Partial<GlobalDrivers>) => void;
  onActionSelect: (id: number) => void;
}

const SEASON_NAMES = ["❄ Winter", "🌱 Spring", "☀ Summer", "🍂 Fall"];

export const ControlPanel: React.FC<ControlPanelProps> = ({
  state,
  isRunning,
  selectedAction,
  onPlay,
  onStep,
  onReset,
  onDriverChange,
  onActionSelect,
}) => {
  const d = state?.drivers;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Playback */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Simulation</div>
        <div className="flex gap-2">
          <button
            onClick={onPlay}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-semibold
                        transition-colors ${
                          isRunning
                            ? "bg-[#e05252]/20 border border-[#e05252]/50 text-[#e05252]"
                            : "bg-[#2dba57]/15 border border-[#2dba57]/50 text-[#2dba57]"
                        }`}
          >
            {isRunning ? <Pause size={12} /> : <Play size={12} />}
            {isRunning ? "Pause" : "Play"}
          </button>
          <button
            onClick={onStep}
            disabled={isRunning}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded text-xs
                       bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-gray-200
                       transition-colors disabled:opacity-40"
          >
            <SkipForward size={11} />
          </button>
          <button
            onClick={onReset}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded text-xs
                       bg-[#0a1628] border border-[#1e3a5f] text-gray-400 hover:text-orange-400
                       transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        </div>
        {d && (
          <div className="mt-2 text-[10px] text-gray-500">
            Tick {d.timestep} · {SEASON_NAMES[d.season]}
          </div>
        )}
      </div>

      {/* Environmental drivers */}
      <div className="bg-[#0d1b2e] border border-[#1e3a5f] rounded-lg p-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Thermometer size={12} className="text-orange-400" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Environment</span>
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
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Intervention</span>
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
        <span className="text-gray-400">{label}</span>
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

export default ControlPanel;
