// ─── Cell types ───────────────────────────────────────────────────────────────
export const CELL_WATER   = 0;
export const CELL_LAND    = 1;
export const CELL_INFLOW  = 2;
export const CELL_OUTFLOW = 3;

// ─── Bloom / hypoxia thresholds (mirrors Python constants) ────────────────────
export const BLOOM_THRESHOLD  = 35;
export const SEVERE_BLOOM     = 65;
export const HYPOXIC_DO       = 20;
export const ANOXIC_DO        = 5;

// ─── Core state interfaces ────────────────────────────────────────────────────
export interface CellState {
  algae:             number;   // 0–100 biomass / bloom severity
  nitrogen:          number;   // 0–100 dissolved inorganic N
  phosphorus:        number;   // 0–100 dissolved P
  dissolved_oxygen:  number;   // 0–100 (100 = fully saturated)
  sediment:          number;   // 0–100 turbidity
  industrial:        number;   // 0–100 pollution / toxin load
  biodiversity:      number;   // 0–100 ecological health
  flow:              number;   // 0–1 circulation factor
  cell_type:         number;   // CELL_* constant
  active_interventions: number[];
  intervention_ticks:   Record<string, number>;
}

export interface GlobalDrivers {
  temperature:    number;  // °C
  rainfall:       number;  // 0–1
  storm_intensity: number; // 0–1
  season:         number;  // 0=winter 1=spring 2=summer 3=fall
  fertilizer_use: number;  // 0–1 agricultural pressure
  timestep:       number;
}

// ─── Simulation snapshot (full state returned by API) ─────────────────────────
export interface SimulationState {
  grid:              CellState[][];
  drivers:           GlobalDrivers;
  timestep:          number;
  global_health:     number;   // 0–100 composite score
  bloom_cells:       number;
  hypoxic_cells:     number;
  dead_zone_cells:   number;
  total_algae:       number;   // sum across all water cells
  avg_do:            number;
  avg_biodiversity:  number;
  avg_nitrogen:      number;
  avg_phosphorus:    number;
  recent_events:     string[];
  recent_interventions: InterventionRecord[];
}

export interface InterventionRecord {
  timestep:    number;
  action_id:   number;
  action_name: string;
  row:         number;
  col:         number;
}

// ─── Agent types ─────────────────────────────────────────────────────────────
export interface AgentAction {
  action_id:   number;
  action_name: string;
  row:         number;
  col:         number;
  reasoning:   string;
}

export interface AgentStepResult {
  action:      AgentAction;
  state:       SimulationState;
  brief_update?: string;
}

// ─── Action metadata (mirrors Python ACTION_NAMES / ACTION_DESCRIPTIONS) ──────
export interface ActionMeta {
  id:          number;
  name:        string;
  description: string;
  color:       string;
  radius:      number;
  duration:    number;
  cost:        number;
}

export const ACTION_META: ActionMeta[] = [
  { id: 0, name: "Do Nothing",               color: "#888888", radius: 0,  duration: 0,  cost: 0,
    description: "Observe without intervention." },
  { id: 1, name: "Reduce Nutrient Inflow",   color: "#4a9eff", radius: 3,  duration: 24, cost: 5,
    description: "Intercept runoff nutrients at inflow edges near target." },
  { id: 2, name: "Aerate Region",            color: "#00cfff", radius: 2,  duration: 8,  cost: 8,
    description: "Inject air to raise dissolved oxygen." },
  { id: 3, name: "Increase Circulation",     color: "#7bcfff", radius: 3,  duration: 16, cost: 6,
    description: "Mechanical mixers increase flow and DO exchange." },
  { id: 4, name: "Mechanical Algae Removal", color: "#2dba57", radius: 2,  duration: 0,  cost: 7,
    description: "Harvest algal biomass via skimmer boats." },
  { id: 5, name: "Add Shading",              color: "#a87fd4", radius: 2,  duration: 20, cost: 4,
    description: "Floating barriers block sunlight, limiting photosynthesis." },
  { id: 6, name: "Biological Control",       color: "#5cb85c", radius: 3,  duration: 28, cost: 10,
    description: "Release natural algae predators — zooplankton, viruses." },
  { id: 7, name: "Chemical Treatment",       color: "#e05252", radius: 2,  duration: 0,  cost: 12,
    description: "Algaecide rapidly reduces bloom but raises toxicity." },
  { id: 8, name: "Mitigate Industrial Spill",color: "#ff9900", radius: 2,  duration: 0,  cost: 9,
    description: "Containment booms + absorbents neutralise industrial pollution." },
  { id: 9, name: "Wetland Filtration",       color: "#85c785", radius: 3,  duration: 32, cost: 11,
    description: "Temporary wetland buffer filters inflow nutrients." },
];

// ─── Colour helpers ───────────────────────────────────────────────────────────
/** Compute RGB for a water cell based on its state. Returns [r, g, b] 0–255. */
export function cellRGB(cell: CellState): [number, number, number] {
  if (cell.cell_type === CELL_LAND) return [42, 65, 42];

  // Base: deep blue water
  let r = 15, g = 38, b = 82;

  // Algae contribution → greens
  const a01 = cell.algae / 100;
  r += Math.round(a01 * (cell.algae > SEVERE_BLOOM ? 60 : 20));
  g += Math.round(a01 * 115);
  b -= Math.round(a01 * 45);

  // Industrial pollution → red-purple
  const i01 = cell.industrial / 100;
  r += Math.round(i01 * 130);
  g -= Math.round(i01 * 15);
  b += Math.round(i01 * 25);

  // Sediment → muddy brown
  const s01 = cell.sediment / 100;
  r += Math.round(s01 * 55);
  g += Math.round(s01 * 22);
  b -= Math.round(s01 * 25);

  // Low DO → darken
  const doFactor = 0.20 + 0.80 * (cell.dissolved_oxygen / 100);
  r = Math.round(r * doFactor);
  g = Math.round(g * doFactor);
  b = Math.round(b * doFactor);

  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b)),
  ];
}

export function healthColor(score: number): string {
  if (score >= 75) return "#2dba57";
  if (score >= 50) return "#f0c040";
  if (score >= 30) return "#e07830";
  return "#e03030";
}

export const SEASON_NAMES = ["Winter", "Spring", "Summer", "Fall"];
