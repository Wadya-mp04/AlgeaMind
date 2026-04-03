"""
AlgaeMind simulation constants and configuration.
Grid represents a lake / reservoir divided into 20×28 cells.
Each tick represents ~6 hours of real time.
"""
from typing import Final, Dict, List, Tuple

# ─── Grid dimensions ─────────────────────────────────────────────────────────
GRID_ROWS: Final[int] = 20
GRID_COLS: Final[int] = 28

# ─── Cell type codes ─────────────────────────────────────────────────────────
CELL_WATER:   Final[int] = 0
CELL_LAND:    Final[int] = 1
CELL_INFLOW:  Final[int] = 2   # runoff / river entry
CELL_OUTFLOW: Final[int] = 3   # water exit

# ─── Spatial zones ───────────────────────────────────────────────────────────
# North inflow — agricultural field runoff (top edge, centre)
INFLOW_NORTH: Final[List[Tuple[int, int]]] = [(0, c) for c in range(9, 14)]

# West inflow — river input (left edge, middle rows)
INFLOW_WEST: Final[List[Tuple[int, int]]] = [(r, 0) for r in range(5, 10)]

# East inflow — industrial discharge (right edge, lower-middle)
INFLOW_EAST: Final[List[Tuple[int, int]]] = [(r, GRID_COLS - 1) for r in range(10, 15)]

# South outflow — lake outlet
OUTFLOW_SOUTH: Final[List[Tuple[int, int]]] = [(GRID_ROWS - 1, c) for c in range(11, 17)]

# Pre-built sets for O(1) lookup
INFLOW_NORTH_SET: Final[set] = set(INFLOW_NORTH)
INFLOW_WEST_SET:  Final[set] = set(INFLOW_WEST)
INFLOW_EAST_SET:  Final[set] = set(INFLOW_EAST)
OUTFLOW_SET:      Final[set] = set(OUTFLOW_SOUTH)
ALL_INFLOW_SET:   Final[set] = INFLOW_NORTH_SET | INFLOW_WEST_SET | INFLOW_EAST_SET

# ─── Ecological thresholds ───────────────────────────────────────────────────
BLOOM_THRESHOLD:   Final[float] = 35.0   # algae ≥ this → bloom
SEVERE_BLOOM:      Final[float] = 65.0   # algae ≥ this → severe bloom
HYPOXIC_DO:        Final[float] = 20.0   # DO ≤ this → hypoxia
ANOXIC_DO:         Final[float] = 5.0    # DO ≤ this → dead zone
EUTROPHIC_N:       Final[float] = 45.0   # eutrophication nitrogen threshold
EUTROPHIC_P:       Final[float] = 25.0   # eutrophication phosphorus threshold

# ─── Algae growth coefficients ───────────────────────────────────────────────
ALGAE_BASE_GROWTH:   Final[float] = 0.07    # intrinsic growth rate per tick
ALGAE_TEMP_COEFF:    Final[float] = 0.004   # growth boost per °C above baseline
ALGAE_LIGHT_COEFF:   Final[float] = 0.007   # light reduction per sediment unit
ALGAE_SPREAD_RATE:   Final[float] = 0.10    # fraction that diffuses to neighbours
ALGAE_NATURAL_DECAY: Final[float] = 0.008   # natural senescence per tick
TEMP_BASELINE:       Final[float] = 15.0    # °C below which growth is minimal

# ─── Oxygen dynamics ─────────────────────────────────────────────────────────
DO_REAERATION:       Final[float] = 0.04    # atmospheric exchange × flow × deficit
# Algae–DO coupling thresholds (algae level where net effect changes sign)
DO_ALGAE_NEUTRAL:    Final[float] = 30.0    # below → O2 production dominates
DO_ALGAE_HARMFUL:    Final[float] = 65.0    # above → severe O2 crash

# ─── Biodiversity dynamics ───────────────────────────────────────────────────
BIO_RECOVERY: Final[float] = 0.025    # relaxation rate toward target each tick

# ─── Sediment / turbidity ────────────────────────────────────────────────────
SEDIMENT_SETTLING:   Final[float] = 0.04   # natural settling fraction per tick

# ─── Nutrient dynamics ───────────────────────────────────────────────────────
NUTRIENT_UPTAKE_ALGAE: Final[float] = 0.015  # algae uptakes N/P during growth
NUTRIENT_DECAY:        Final[float] = 0.010  # natural attenuation per tick

# ─── Inflow drivers ──────────────────────────────────────────────────────────
RAIN_N_INPUT:          Final[float] = 3.5   # N added per rainfall unit at inflow
RAIN_P_INPUT:          Final[float] = 2.0   # P added per rainfall unit
RAIN_SEDIMENT_INPUT:   Final[float] = 4.0   # sediment added per rainfall unit
STORM_MULTIPLIER:      Final[float] = 2.5   # amplifies all runoff during storms
INDUSTRIAL_BASE_RATE:  Final[float] = 6.0   # industrial pollution added per tick (east inflow)

# ─── Seasonal baseline temperatures ─────────────────────────────────────────
SEASON_BASE_TEMPS: Final[Dict[int, float]] = {
    0: 8.0,   # winter
    1: 17.0,  # spring
    2: 27.0,  # summer
    3: 14.0,  # fall
}

# ─── Random event probabilities (per tick) ───────────────────────────────────
SPILL_PROB:      Final[float] = 0.015   # industrial spill event
HEAVY_RAIN_PROB: Final[float] = 0.04    # sudden heavy rain event
SPILL_MAGNITUDE: Final[float] = 50.0   # industrial spill pollution magnitude

# ─── Action space ────────────────────────────────────────────────────────────
NUM_ACTIONS: Final[int] = 10

ACTION_NAMES: Final[Dict[int, str]] = {
    0: "Do Nothing",
    1: "Reduce Nutrient Inflow",
    2: "Aerate Region",
    3: "Increase Circulation",
    4: "Mechanical Algae Removal",
    5: "Add Shading",
    6: "Deploy Biological Control",
    7: "Apply Chemical Treatment",
    8: "Mitigate Industrial Spill",
    9: "Wetland Filtration",
}

ACTION_DESCRIPTIONS: Final[Dict[int, str]] = {
    0: "Observe without intervention.",
    1: "Intercept nutrient-laden runoff at inflow edges near target (radius 3).",
    2: "Inject air to raise dissolved oxygen in target region (radius 2).",
    3: "Mechanical mixers increase water circulation and DO exchange (radius 3).",
    4: "Harvest algal biomass directly via skimmer/harvester boats (radius 2).",
    5: "Floating barriers block sunlight, limiting photosynthesis (radius 2).",
    6: "Release natural algae predators — zooplankton, viruses (radius 3).",
    7: "Algaecide rapidly reduces bloom but temporarily raises toxicity (radius 2).",
    8: "Containment booms + absorbents neutralise industrial pollution (radius 2).",
    9: "Construct temporary wetland buffer to filter inflow nutrients (radius 3).",
}

# Targeting radius (Moore neighbourhood cells each side)
ACTION_RADIUS: Final[Dict[int, int]] = {
    0: 0, 1: 3, 2: 2, 3: 3, 4: 2, 5: 2, 6: 3, 7: 2, 8: 2, 9: 3,
}

# Duration in ticks (0 = instant, one-off)
ACTION_DURATION: Final[Dict[int, int]] = {
    0: 0, 1: 24, 2: 8, 3: 16, 4: 0, 5: 20, 6: 28, 7: 0, 8: 0, 9: 32,
}

# Relative cost units (used in reward penalty)
ACTION_COSTS: Final[Dict[int, float]] = {
    0: 0.0, 1: 5.0, 2: 8.0, 3: 6.0, 4: 7.0,
    5: 4.0, 6: 10.0, 7: 12.0, 8: 9.0, 9: 11.0,
}

# Hex colours for frontend overlay rendering
ACTION_COLORS: Final[Dict[int, str]] = {
    0: "#888888",
    1: "#4a9eff",   # blue  — nutrient reduction
    2: "#00cfff",   # cyan  — aeration
    3: "#7bcfff",   # pale blue — circulation
    4: "#2dba57",   # green — mechanical removal
    5: "#a87fd4",   # purple — shading
    6: "#5cb85c",   # forest green — bio control
    7: "#e05252",   # red   — chemical treatment
    8: "#ff9900",   # orange — spill mitigation
    9: "#85c785",   # sage  — wetland filtration
}

# ─── Reward weights ───────────────────────────────────────────────────────────
REWARD_ALGAE_W:    Final[float] = 0.35
REWARD_DO_W:       Final[float] = 0.30
REWARD_BIO_W:      Final[float] = 0.20
REWARD_NUTRIENT_W: Final[float] = 0.10
REWARD_INDUSTRY_W: Final[float] = 0.05
REWARD_COST_W:     Final[float] = 0.001
