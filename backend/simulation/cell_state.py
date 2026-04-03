"""
CellState and GlobalDrivers dataclasses for the AlgaeMind 2D grid simulation.
All numerical values are 0–100 unless otherwise noted.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Any

from config.constants import (
    BLOOM_THRESHOLD, SEVERE_BLOOM,
    HYPOXIC_DO, ANOXIC_DO,
    CELL_WATER, CELL_LAND, CELL_INFLOW, CELL_OUTFLOW,
    SEASON_BASE_TEMPS,
    REWARD_ALGAE_W, REWARD_DO_W, REWARD_BIO_W,
    REWARD_NUTRIENT_W, REWARD_INDUSTRY_W,
)


@dataclass
class CellState:
    """State of a single grid cell in the aquatic ecosystem."""

    # ── Water-quality variables ───────────────────────────────────────────────
    algae:            float = 0.0    # algal biomass / bloom severity
    nitrogen:         float = 0.0    # dissolved inorganic nitrogen
    phosphorus:       float = 0.0    # dissolved phosphorus
    dissolved_oxygen: float = 80.0   # DO (100 = fully saturated)
    sediment:         float = 0.0    # turbidity / suspended sediment
    industrial:       float = 0.0    # industrial pollution / toxin load
    biodiversity:     float = 80.0   # ecological health index

    # ── Physical properties ───────────────────────────────────────────────────
    flow:      float = 0.30   # water circulation factor (0–1)
    cell_type: int   = CELL_WATER

    # ── Active interventions: {action_id (str key for JSON): ticks_remaining} ─
    active_interventions: List[int]          = field(default_factory=list)
    intervention_ticks:   Dict[str, int]     = field(default_factory=dict)

    # ── Shading flag (set by action 5) ───────────────────────────────────────
    shaded: bool = False

    # ── Biological-control flag (set by action 6) ─────────────────────────────
    bio_control: bool = False

    # ── Nutrient-intercept flag (set by actions 1 & 9 at inflow cells) ────────
    nutrient_intercept: float = 0.0   # multiplier reduction (0–1); 0 = full block

    # ─────────────────────────────────────────────────────────────────────────

    def clamp(self) -> None:
        """Keep all state variables within valid bounds."""
        self.algae            = max(0.0, min(100.0, self.algae))
        self.nitrogen         = max(0.0, min(100.0, self.nitrogen))
        self.phosphorus       = max(0.0, min(100.0, self.phosphorus))
        self.dissolved_oxygen = max(0.0, min(100.0, self.dissolved_oxygen))
        self.sediment         = max(0.0, min(100.0, self.sediment))
        self.industrial       = max(0.0, min(100.0, self.industrial))
        self.biodiversity     = max(0.0, min(100.0, self.biodiversity))
        self.flow             = max(0.0, min(1.0,   self.flow))

    # ── Derived flags ─────────────────────────────────────────────────────────

    @property
    def is_bloom(self) -> bool:
        return self.cell_type != CELL_LAND and self.algae >= BLOOM_THRESHOLD

    @property
    def is_severe_bloom(self) -> bool:
        return self.cell_type != CELL_LAND and self.algae >= SEVERE_BLOOM

    @property
    def is_hypoxic(self) -> bool:
        return self.cell_type != CELL_LAND and self.dissolved_oxygen <= HYPOXIC_DO

    @property
    def is_dead_zone(self) -> bool:
        return self.cell_type != CELL_LAND and self.dissolved_oxygen <= ANOXIC_DO

    # ── Local health score ────────────────────────────────────────────────────

    def health_score(self) -> float:
        """0–100 composite health for this cell. Higher = healthier."""
        if self.cell_type == CELL_LAND:
            return 100.0
        do_s  = self.dissolved_oxygen / 100.0
        alg_s = 1.0 - self.algae / 100.0
        bio_s = self.biodiversity / 100.0
        n_s   = 1.0 - self.nitrogen / 100.0
        p_s   = 1.0 - self.phosphorus / 100.0
        ind_s = 1.0 - self.industrial / 100.0
        nutrient_s = (n_s + p_s) / 2.0
        return 100.0 * (
            REWARD_DO_W      * do_s +
            REWARD_ALGAE_W   * alg_s +
            REWARD_BIO_W     * bio_s +
            REWARD_NUTRIENT_W * nutrient_s +
            REWARD_INDUSTRY_W * ind_s
        )

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # JSON-safe: keep intervention_ticks as-is (str keys already)
        return d

    # ── Factory methods ───────────────────────────────────────────────────────

    @classmethod
    def make_water(
        cls,
        nitrogen:   float = 8.0,
        phosphorus: float = 5.0,
        algae:      float = 3.0,
    ) -> "CellState":
        """Create a clean-ish water cell (starting state)."""
        return cls(
            algae=algae,
            nitrogen=nitrogen,
            phosphorus=phosphorus,
            dissolved_oxygen=82.0,
            sediment=2.0,
            industrial=0.0,
            biodiversity=78.0,
            flow=0.30,
            cell_type=CELL_WATER,
        )

    @classmethod
    def make_inflow(cls, industrial_source: bool = False) -> "CellState":
        """Create an inflow-zone cell (nutrient / pollution entry point)."""
        ind = 12.0 if industrial_source else 1.0
        return cls(
            algae=6.0,
            nitrogen=22.0,
            phosphorus=14.0,
            dissolved_oxygen=74.0,
            sediment=18.0,
            industrial=ind,
            biodiversity=55.0,
            flow=0.5,
            cell_type=CELL_INFLOW,
        )

    @classmethod
    def make_outflow(cls) -> "CellState":
        """Create an outflow-zone cell."""
        return cls(
            algae=4.0,
            nitrogen=10.0,
            phosphorus=6.0,
            dissolved_oxygen=78.0,
            sediment=6.0,
            industrial=1.0,
            biodiversity=68.0,
            flow=0.6,
            cell_type=CELL_OUTFLOW,
        )

    @classmethod
    def make_land(cls) -> "CellState":
        """Create an inert land cell."""
        return cls(
            algae=0.0, nitrogen=0.0, phosphorus=0.0,
            dissolved_oxygen=0.0, sediment=0.0,
            industrial=0.0, biodiversity=0.0,
            flow=0.0, cell_type=CELL_LAND,
        )


# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class GlobalDrivers:
    """Global environmental drivers affecting the whole simulation domain."""

    temperature:     float = 18.0   # °C  (affects growth rate)
    rainfall:        float = 0.20   # 0–1 intensity
    storm_intensity: float = 0.0    # 0–1 (0 = calm)
    season:          int   = 1      # 0=winter 1=spring 2=summer 3=fall
    fertilizer_use:  float = 0.35   # 0–1 agricultural runoff pressure
    timestep:        int   = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def advance_season(self) -> None:
        """Nudge temperature toward seasonal baseline after each tick."""
        target = SEASON_BASE_TEMPS[self.season]
        self.temperature += 0.05 * (target - self.temperature)

    def next_season(self) -> None:
        """Advance to the next season (called every ~120 ticks = ~30 days)."""
        self.season = (self.season + 1) % 4
