"""
GridEnvironment — the core TrackAlgae 2D simulation environment.

Represents a lake / reservoir divided into a GRID_ROWS × GRID_COLS grid.
Each cell holds its own water-quality state; global drivers (temperature,
rainfall, etc.) influence the whole domain each tick.

Public API
----------
env = GridEnvironment()
state = env.get_state()             # full SimulationSnapshot dict
env.step()                          # advance one tick (no action)
env.apply_action(action_id, r, c)   # apply intervention then step
env.reset()                         # restore initial eutrophic state
env.update_drivers(**kwargs)        # update global drivers from frontend
"""
from __future__ import annotations

import copy
import math
import random
from dataclasses import asdict
from typing import Any, Dict, List, Optional, Tuple

from config.constants import (
    GRID_ROWS, GRID_COLS,
    CELL_WATER, CELL_LAND, CELL_INFLOW, CELL_OUTFLOW,
    INFLOW_NORTH, INFLOW_WEST, INFLOW_EAST, OUTFLOW_SOUTH,
    INFLOW_NORTH_SET, INFLOW_WEST_SET, INFLOW_EAST_SET, OUTFLOW_SET,
    ALL_INFLOW_SET,
    BLOOM_THRESHOLD, SEVERE_BLOOM, HYPOXIC_DO, ANOXIC_DO,
    ACTION_NAMES, ACTION_RADIUS, ACTION_DURATION, ACTION_COSTS, ACTION_COLORS,
    SPILL_PROB, HEAVY_RAIN_PROB, SPILL_MAGNITUDE,
    REWARD_ALGAE_W, REWARD_DO_W, REWARD_BIO_W, REWARD_NUTRIENT_W, REWARD_INDUSTRY_W,
)
from simulation.cell_state import CellState, GlobalDrivers
from simulation.physics import full_physics_step


# ─────────────────────────────────────────────────────────────────────────────

class GridEnvironment:
    """2D grid environment for Harmful Algal Bloom (HAB) simulation."""

    MAX_EVENT_LOG = 40   # keep last N events
    MAX_HISTORY   = 300  # health-score history for charts

    def __init__(self) -> None:
        self.drivers = GlobalDrivers()
        self.contaminant_config: Dict[str, bool] = {
            "nutrient_runoff": False,
            "industrial_discharge": False,
            "random_spills": False,
            "heavy_rain_events": False,
        }
        self.flow_config: Dict[str, bool] = {
            "inflow_north": True,
            "inflow_west": True,
            "inflow_east": True,
            "outflow_south": True,
        }
        self.grid: List[List[CellState]] = []
        self._recent_events: List[str] = []
        self._recent_interventions: List[Dict] = []
        self._health_history: List[float] = []
        self._season_tick_counter: int = 0
        self.external_data_context: Dict[str, Any] = {}  # real-world data for LLM agent
        self._event_markers: List[Dict] = []  # short-lived markers for grid overlay
        self.reset()

    # ─────────────────────────────────────────────────────────────────────────
    # PUBLIC API
    # ─────────────────────────────────────────────────────────────────────────

    def reset(self) -> None:
        """Restore clean baseline state with contaminants disabled."""
        self.drivers = GlobalDrivers(
            temperature=18.0, rainfall=0.20,
            storm_intensity=0.0, season=1,
            fertilizer_use=0.35, timestep=0,
        )
        self.contaminant_config = {
            "nutrient_runoff": False,
            "industrial_discharge": False,
            "random_spills": False,
            "heavy_rain_events": False,
        }
        self.grid = self._build_grid()
        self._recent_events = [
            "Simulation initialised — clean baseline (no contaminants active)."
        ]
        self._recent_interventions = []
        self._health_history = []
        self._season_tick_counter = 0
        self._event_markers = []

    def _add_marker(self, row: int, col: int, kind: str, color: str, label: str) -> None:
        """Add a short-lived visual marker for the grid overlay."""
        self._event_markers.append({
            "timestep": self.drivers.timestep,
            "row": row, "col": col,
            "kind": kind, "color": color, "label": label,
        })
        if len(self._event_markers) > 50:
            self._event_markers = self._event_markers[-50:]

    def step(self) -> None:
        """Advance the simulation by one tick."""
        full_physics_step(self.grid, self.drivers, self.contaminant_config)
        self._natural_background_events()
        self._random_events()
        self._season_tick_counter += 1
        if self._season_tick_counter >= 120:
            self._season_tick_counter = 0
            self.drivers.next_season()
            self._log(f"Season changed to {['Winter','Spring','Summer','Fall'][self.drivers.season]}.")
        self.drivers.advance_season()
        self.drivers.timestep += 1
        # Record health for charting
        h = self._compute_global_health()
        self._health_history.append(h)
        if len(self._health_history) > self.MAX_HISTORY:
            self._health_history = self._health_history[-self.MAX_HISTORY:]

    def apply_action(self, action_id: int, row: int, col: int) -> None:
        """Apply an intervention at (row, col) then advance one tick."""
        if action_id < 0 or action_id >= 10:
            return
        if action_id == 0:
            self.step()
            return
        name  = ACTION_NAMES[action_id]
        cost  = ACTION_COSTS[action_id]
        color = ACTION_COLORS.get(action_id, "#ffffff")
        self._dispatch_action(action_id, row, col)
        self._add_marker(row, col, f"action_{action_id}", color, name[:6])
        self._log(f"▶ {name} applied at ({row},{col}).")
        self._recent_interventions.append({
            "timestep":    self.drivers.timestep,
            "action_id":   action_id,
            "action_name": name,
            "row": row, "col": col,
        })
        if len(self._recent_interventions) > 20:
            self._recent_interventions = self._recent_interventions[-20:]
        self.step()

    def update_drivers(self, **kwargs) -> None:
        """Update one or more GlobalDriver fields from the frontend."""
        for k, v in kwargs.items():
            if hasattr(self.drivers, k):
                setattr(self.drivers, k, v)

    def update_flow_config(self, **kwargs) -> None:
        """Enable/disable inflow/outflow channels and apply to the current grid."""
        for key, value in kwargs.items():
            if key in self.flow_config and value is not None:
                self.flow_config[key] = bool(value)
        self._apply_flow_layout_to_grid()
        self._log(
            "Flow topology updated "
            f"(N:{int(self.flow_config['inflow_north'])} "
            f"W:{int(self.flow_config['inflow_west'])} "
            f"E:{int(self.flow_config['inflow_east'])} "
            f"S-out:{int(self.flow_config['outflow_south'])})."
        )

    def update_contaminant_config(self, **kwargs) -> None:
        """Enable/disable contaminant sources that drive water degradation."""
        for key, value in kwargs.items():
            if key in self.contaminant_config and value is not None:
                self.contaminant_config[key] = bool(value)

        # Keep drivers aligned with contaminant toggles.
        if not self.contaminant_config["nutrient_runoff"]:
            self.drivers.rainfall = 0.0
            self.drivers.storm_intensity = 0.0
            self.drivers.fertilizer_use = 0.0
        elif self.drivers.rainfall == 0.0 and self.drivers.fertilizer_use == 0.0:
            self.drivers.rainfall = 0.20
            self.drivers.fertilizer_use = 0.35

        self._log(
            "Contaminants updated "
            f"(runoff:{int(self.contaminant_config['nutrient_runoff'])} "
            f"industrial:{int(self.contaminant_config['industrial_discharge'])} "
            f"spills:{int(self.contaminant_config['random_spills'])} "
            f"rain-events:{int(self.contaminant_config['heavy_rain_events'])})."
        )

    def get_state(self) -> Dict[str, Any]:
        """Return full serialisable state snapshot for the API."""
        water_cells = [
            cell
            for row in self.grid
            for cell in row
            if cell.cell_type != CELL_LAND
        ]
        n = max(1, len(water_cells))

        bloom_cells    = sum(1 for c in water_cells if c.is_bloom)
        hypoxic_cells  = sum(1 for c in water_cells if c.is_hypoxic)
        dead_zones     = sum(1 for c in water_cells if c.is_dead_zone)
        total_algae    = sum(c.algae for c in water_cells)
        avg_do         = sum(c.dissolved_oxygen for c in water_cells) / n
        avg_bio        = sum(c.biodiversity     for c in water_cells) / n
        avg_n          = sum(c.nitrogen         for c in water_cells) / n
        avg_p          = sum(c.phosphorus       for c in water_cells) / n
        global_health  = self._compute_global_health()

        grid_serial = [
            [cell.to_dict() for cell in row]
            for row in self.grid
        ]

        return {
            "grid":                  grid_serial,
            "drivers":               self.drivers.to_dict(),
            "flow_config":           dict(self.flow_config),
            "contaminant_config":    dict(self.contaminant_config),
            "timestep":              self.drivers.timestep,
            "global_health":         round(global_health, 2),
            "bloom_cells":           bloom_cells,
            "hypoxic_cells":         hypoxic_cells,
            "dead_zone_cells":       dead_zones,
            "total_algae":           round(total_algae, 1),
            "avg_do":                round(avg_do, 1),
            "avg_biodiversity":      round(avg_bio, 1),
            "avg_nitrogen":          round(avg_n, 1),
            "avg_phosphorus":        round(avg_p, 1),
            "recent_events":         list(self._recent_events[-20:]),
            "recent_interventions":  list(self._recent_interventions[-10:]),
            "health_history":        list(self._health_history[-100:]),
            "event_markers":         list(self._event_markers[-40:]),
        }

    def get_agent_observation(self) -> Dict[str, Any]:
        """
        Compact observation for the AI agent.
        Includes full grid stats and top-10 worst cells by health score.
        """
        state = self.get_state()
        # Identify worst cells for targeted intervention
        worst: List[Dict] = []
        for r, row in enumerate(self.grid):
            for c, cell in enumerate(row):
                if cell.cell_type == CELL_LAND:
                    continue
                worst.append({
                    "row": r, "col": c,
                    "health": round(cell.health_score(), 1),
                    "algae":  round(cell.algae, 1),
                    "do":     round(cell.dissolved_oxygen, 1),
                    "n":      round(cell.nitrogen, 1),
                    "p":      round(cell.phosphorus, 1),
                    "ind":    round(cell.industrial, 1),
                    "bio":    round(cell.biodiversity, 1),
                    "type":   cell.cell_type,
                    "active": cell.active_interventions,
                })
        worst.sort(key=lambda x: x["health"])
        state["worst_cells"] = worst[:12]
        del state["grid"]   # grid too large for agent prompt
        # Include real-world data context if available
        if self.external_data_context:
            state["external_data"] = self.external_data_context
        return state

    # ─────────────────────────────────────────────────────────────────────────
    # GRID CONSTRUCTION
    # ─────────────────────────────────────────────────────────────────────────

    def _build_grid(self) -> List[List[CellState]]:
        """
        Build the initial grid.

        Layout (20 rows × 28 cols):
        - Row 0, Row 19, Col 0, Col 27 → LAND (shore)
        - INFLOW_NORTH (row 0, cols 9-13) → INFLOW (agricultural)
        - INFLOW_WEST  (rows 5-9, col 0)  → INFLOW (river)
        - INFLOW_EAST  (rows 10-14, col 27) → INFLOW (industrial)
        - OUTFLOW_SOUTH (row 19, cols 11-16) → OUTFLOW
        - All interior cells → clean water baseline (no bloom)
        """
        inflow_n_set, inflow_w_set, inflow_e_set, outflow_set = self._active_flow_sets()

        rng = random.Random(42)  # deterministic initial state
        grid: List[List[CellState]] = []

        for r in range(GRID_ROWS):
            row: List[CellState] = []
            for c in range(GRID_COLS):
                pos = (r, c)

                if pos in inflow_e_set:
                    cell = CellState.make_inflow(industrial_source=True)
                elif pos in (inflow_n_set | inflow_w_set):
                    cell = CellState.make_inflow(industrial_source=False)
                elif pos in outflow_set:
                    cell = CellState.make_outflow()
                elif r == 0 or r == GRID_ROWS - 1 or c == 0 or c == GRID_COLS - 1:
                    cell = CellState.make_land()
                else:
                    # Interior water starts healthy; contamination appears only
                    # after user-selected contaminant sources are enabled.
                    base_algae = 1.0 + rng.uniform(0.0, 1.2)
                    base_n = 4.5 + rng.uniform(-1.0, 1.0)
                    base_p = 2.2 + rng.uniform(-0.6, 0.8)
                    cell = CellState.make_water(
                        nitrogen=base_n,
                        phosphorus=base_p,
                        algae=base_algae,
                    )

                # Enforce clean baseline profiles for flow edge cells too.
                if cell.cell_type == CELL_INFLOW:
                    cell.algae = 1.5
                    cell.nitrogen = 5.0
                    cell.phosphorus = 2.5
                    cell.sediment = 2.0
                    cell.industrial = 0.0
                    cell.dissolved_oxygen = 84.0
                    cell.biodiversity = 82.0
                elif cell.cell_type == CELL_OUTFLOW:
                    cell.algae = 1.0
                    cell.nitrogen = 4.0
                    cell.phosphorus = 2.0
                    cell.sediment = 1.5
                    cell.industrial = 0.0
                    cell.dissolved_oxygen = 86.0
                    cell.biodiversity = 84.0
                row.append(cell)
            grid.append(row)
        return grid

    def _active_flow_sets(self):
        inflow_n_set = INFLOW_NORTH_SET if self.flow_config["inflow_north"] else set()
        inflow_w_set = INFLOW_WEST_SET if self.flow_config["inflow_west"] else set()
        inflow_e_set = INFLOW_EAST_SET if self.flow_config["inflow_east"] else set()
        outflow_set = OUTFLOW_SET if self.flow_config["outflow_south"] else set()
        return inflow_n_set, inflow_w_set, inflow_e_set, outflow_set

    def _apply_flow_layout_to_grid(self) -> None:
        """Remap configurable edge channels between land and flow cells."""
        if not self.grid:
            return
        inflow_n_set, inflow_w_set, inflow_e_set, outflow_set = self._active_flow_sets()
        flow_zone_positions = INFLOW_NORTH_SET | INFLOW_WEST_SET | INFLOW_EAST_SET | OUTFLOW_SET

        for r, c in flow_zone_positions:
            pos = (r, c)
            if pos in inflow_e_set:
                self.grid[r][c] = CellState.make_inflow(industrial_source=True)
            elif pos in (inflow_n_set | inflow_w_set):
                self.grid[r][c] = CellState.make_inflow(industrial_source=False)
            elif pos in outflow_set:
                self.grid[r][c] = CellState.make_outflow()
            else:
                self.grid[r][c] = CellState.make_land()

    # ─────────────────────────────────────────────────────────────────────────
    # ACTION DISPATCH
    # ─────────────────────────────────────────────────────────────────────────

    def _dispatch_action(self, action_id: int, row: int, col: int) -> None:
        """Route action_id to the correct handler."""
        handlers = {
            1: self._action_reduce_nutrient_inflow,
            2: self._action_aerate,
            3: self._action_increase_circulation,
            4: self._action_remove_algae,
            5: self._action_add_shading,
            6: self._action_bio_control,
            7: self._action_chemical_treatment,
            8: self._action_mitigate_spill,
            9: self._action_wetland_filtration,
        }
        if action_id in handlers:
            handlers[action_id](row, col)

    def _cells_in_radius(self, row: int, col: int, radius: int):
        """Yield (r, c, cell) tuples within Manhattan radius, water cells only."""
        for r in range(max(0, row - radius), min(GRID_ROWS, row + radius + 1)):
            for c in range(max(0, col - radius), min(GRID_COLS, col + radius + 1)):
                if abs(r - row) + abs(c - col) <= radius:
                    cell = self.grid[r][c]
                    if cell.cell_type != CELL_LAND:
                        yield r, c, cell

    def _register_timed(self, cell: CellState, action_id: int) -> None:
        """Register a timed intervention on a cell."""
        dur = ACTION_DURATION[action_id]
        key = str(action_id)
        cell.intervention_ticks[key] = dur
        if action_id not in cell.active_interventions:
            cell.active_interventions.append(action_id)

    # ── Action 1: Reduce Nutrient Inflow ──────────────────────────────────────

    def _action_reduce_nutrient_inflow(self, row: int, col: int) -> None:
        """Intercept ~60 % of incoming nutrients at nearby inflow cells."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[1]):
            if cell.cell_type == CELL_INFLOW:
                cell.nutrient_intercept = 0.60
                self._register_timed(cell, 1)

    # ── Action 2: Aerate ─────────────────────────────────────────────────────

    def _action_aerate(self, row: int, col: int) -> None:
        """Immediate DO boost + enhanced reaeration for a few ticks."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[2]):
            cell.dissolved_oxygen = min(100.0, cell.dissolved_oxygen + 18.0)
            cell.flow = min(1.0, cell.flow + 0.15)
            self._register_timed(cell, 2)

    # ── Action 3: Increase Circulation ───────────────────────────────────────

    def _action_increase_circulation(self, row: int, col: int) -> None:
        """Boost flow factor, improving reaeration and nutrient dilution."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[3]):
            cell.flow = min(1.0, cell.flow + 0.30)
            self._register_timed(cell, 3)

    # ── Action 4: Mechanical Algae Removal ───────────────────────────────────

    def _action_remove_algae(self, row: int, col: int) -> None:
        """Immediate 65 % reduction of algae biomass in target area."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[4]):
            cell.algae *= 0.35

    # ── Action 5: Add Shading ─────────────────────────────────────────────────

    def _action_add_shading(self, row: int, col: int) -> None:
        """Floating shade barriers cut light and slow algae growth."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[5]):
            cell.shaded = True
            self._register_timed(cell, 5)

    # ── Action 6: Biological Control ─────────────────────────────────────────

    def _action_bio_control(self, row: int, col: int) -> None:
        """Release zooplankton / viruses for sustained slow algae reduction."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[6]):
            cell.bio_control = True
            self._register_timed(cell, 6)

    # ── Action 7: Chemical Treatment ─────────────────────────────────────────

    def _action_chemical_treatment(self, row: int, col: int) -> None:
        """
        Algaecide: rapid 80 % algae reduction, but raises industrial pollution
        (chemical residue) and slightly reduces biodiversity.
        """
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[7]):
            cell.algae      *= 0.20
            cell.industrial  = min(100.0, cell.industrial + 28.0)
            cell.biodiversity = max(0.0, cell.biodiversity - 8.0)

    # ── Action 8: Mitigate Industrial Spill ──────────────────────────────────

    def _action_mitigate_spill(self, row: int, col: int) -> None:
        """Containment booms reduce industrial pollution by 70 %."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[8]):
            cell.industrial *= 0.30

    # ── Action 9: Wetland Filtration ─────────────────────────────────────────

    def _action_wetland_filtration(self, row: int, col: int) -> None:
        """Constructed wetland near inflow removes 55 % N and 65 % P each tick."""
        for r, c, cell in self._cells_in_radius(row, col, ACTION_RADIUS[9]):
            if cell.cell_type == CELL_INFLOW:
                cell.nutrient_intercept = 0.70
                cell.nitrogen   *= 0.45
                cell.phosphorus *= 0.35
                self._register_timed(cell, 9)

    # ─────────────────────────────────────────────────────────────────────────
    # RANDOM EVENTS
    # ─────────────────────────────────────────────────────────────────────────

    def trigger_event(self, event_type: str) -> str:
        """Manually trigger an environmental event from the frontend."""
        if event_type == "industrial_spill":
            # Collect all active inflow cells
            spill_candidates = [
                (r, c) for r in range(GRID_ROWS) for c in range(GRID_COLS)
                if self.grid[r][c].cell_type == CELL_INFLOW
            ]
            if not spill_candidates:
                return "No active inflow cells for spill"
            # Mild east preference, but still frequently hit other inflows.
            east = [(r, c) for r, c in spill_candidates if c == GRID_COLS - 1]
            if east and random.random() < 0.40:
                r, c = random.choice(east)
            else:
                r, c = random.choice(spill_candidates)
            # Immediately spread 50% of the spill to adjacent water cells so
            # the inflow boundary doesn't become an isolated dead zone.
            spill_at_source = SPILL_MAGNITUDE * 0.50
            spill_to_nbrs   = SPILL_MAGNITUDE * 0.50
            self.grid[r][c].industrial = min(100.0, self.grid[r][c].industrial + spill_at_source)
            neighbor_cells = list(self._cells_in_radius(r, c, 2))
            water_nbrs = [(nr, nc, cell) for nr, nc, cell in neighbor_cells
                          if cell.cell_type != CELL_INFLOW and (nr, nc) != (r, c)]
            if water_nbrs:
                share = spill_to_nbrs / len(water_nbrs)
                for *_, ncell in water_nbrs:
                    ncell.industrial = min(100.0, ncell.industrial + share)
            else:
                self.grid[r][c].industrial = min(100.0, self.grid[r][c].industrial + spill_to_nbrs)
            self.contaminant_config["industrial_discharge"] = True
            self.contaminant_config["random_spills"] = True
            msg = f"⚠ Manual industrial spill at ({r},{c})!"
            self._add_marker(r, c, "spill", "#ff9900", "Spill")
            self._log(msg)
            return msg
        elif event_type == "heavy_rain":
            self.drivers.rainfall = min(1.0, self.drivers.rainfall + 0.55)
            self.drivers.storm_intensity = min(1.0, self.drivers.storm_intensity + 0.45)
            self.contaminant_config["nutrient_runoff"] = True
            self.contaminant_config["heavy_rain_events"] = True
            inflows = [(r, c) for r in range(GRID_ROWS) for c in range(GRID_COLS)
                       if self.grid[r][c].cell_type == CELL_INFLOW]
            if inflows:
                for ir, ic in inflows[:3]:
                    self._add_marker(ir, ic, "rain", "#60a5fa", "Rain")
            msg = "🌧 Manual heavy rainfall triggered — nutrient runoff surge!"
            self._log(msg)
            return msg
        elif event_type == "heat_wave":
            self.drivers.temperature = min(35.0, self.drivers.temperature + 9.0)
            self._add_marker(GRID_ROWS // 2, GRID_COLS // 2, "heat", "#f97316", "Heat")
            msg = f"🌡 Heat wave! Temperature raised to {self.drivers.temperature:.1f}°C."
            self._log(msg)
            return msg
        elif event_type == "drought":
            self.drivers.rainfall = max(0.0, self.drivers.rainfall - 0.3)
            self.drivers.storm_intensity = max(0.0, self.drivers.storm_intensity - 0.2)
            self._add_marker(GRID_ROWS // 2, GRID_COLS // 2, "drought", "#f59e0b", "Drought")
            msg = "☀ Drought conditions — reduced inflow and runoff."
            self._log(msg)
            return msg
        elif event_type == "fertilizer_runoff":
            self.contaminant_config["nutrient_runoff"] = True
            count = 0
            for r in range(GRID_ROWS):
                for c in range(GRID_COLS):
                    if self.grid[r][c].cell_type == CELL_INFLOW:
                        self.grid[r][c].nitrogen   = min(100.0, self.grid[r][c].nitrogen   + 25.0)
                        self.grid[r][c].phosphorus = min(100.0, self.grid[r][c].phosphorus + 18.0)
                        self._add_marker(r, c, "fertilizer", "#4ade80", "Fert")
                        count += 1
            msg = f"🌱 Fertilizer runoff surge at {count} inflow cells!"
            self._log(msg)
            return msg
        return "Unknown event type"

    def _natural_background_events(self) -> None:
        """
        Background ecological variability that occurs every tick regardless of
        contaminant configuration.  These represent realistic lake dynamics:
        precipitation, wind mixing, thermal fluctuation, and atmospheric deposition.
        Only one major event fires per tick to keep the log readable.
        """
        season = self.drivers.season
        t = self.drivers.timestep

        # Atmospheric N/P deposition — tiny background nutrient loading every ~3 days
        if t % 12 == 0:
            for row in self.grid:
                for cell in row:
                    if cell.cell_type in (CELL_WATER, CELL_INFLOW, CELL_OUTFLOW):
                        cell.nitrogen   = min(100.0, cell.nitrogen   + 0.015)
                        cell.phosphorus = min(100.0, cell.phosphorus + 0.008)

        # Pick at most one notable natural event this tick
        roll = random.random()

        if roll < 0.05:
            # Spontaneous light rain event (all seasons)
            boost = random.uniform(0.08, 0.28)
            self.drivers.rainfall = min(1.0, self.drivers.rainfall + boost)
            inflows = [(r, c) for r in range(GRID_ROWS) for c in range(GRID_COLS)
                       if self.grid[r][c].cell_type == CELL_INFLOW]
            if inflows:
                r, c = random.choice(inflows)
                self._add_marker(r, c, "nat_rain", "#93c5fd", "Rain")
            self._log(f"🌦 Natural rainfall (+{boost:.0%}) — inflow levels rising.")

        elif roll < 0.09 and season == 2:
            # Summer warm spell
            delta = random.uniform(0.8, 2.5)
            self.drivers.temperature = min(35.0, self.drivers.temperature + delta)
            self._add_marker(GRID_ROWS // 2, GRID_COLS // 2, "nat_heat", "#fb923c", "Warm")
            self._log(f"☀ Warm spell — temperature +{delta:.1f}°C → {self.drivers.temperature:.1f}°C.")

        elif roll < 0.13 and season in (0, 3):
            # Winter/autumn cold front
            delta = random.uniform(0.5, 2.0)
            self.drivers.temperature = max(2.0, self.drivers.temperature - delta)
            self._add_marker(GRID_ROWS // 2, GRID_COLS // 2, "nat_cold", "#bae6fd", "Cold")
            self._log(f"❄ Cold front — temperature −{delta:.1f}°C → {self.drivers.temperature:.1f}°C.")

        elif roll < 0.17:
            # Wind-driven mixing event: brief flow boost across a mid-lake band
            center_r = random.randint(GRID_ROWS // 4, 3 * GRID_ROWS // 4)
            center_c = random.randint(GRID_COLS // 4, 3 * GRID_COLS // 4)
            cells_mixed = 0
            for r, c, cell in self._cells_in_radius(center_r, center_c, 4):
                if cell.cell_type == CELL_WATER:
                    cell.flow = min(1.0, cell.flow + random.uniform(0.04, 0.12))
                    cell.dissolved_oxygen = min(100.0, cell.dissolved_oxygen + random.uniform(0.5, 1.5))
                    cells_mixed += 1
            if cells_mixed:
                self._add_marker(center_r, center_c, "nat_wind", "#a3e635", "Wind")
                self._log(f"💨 Wind mixing event at ({center_r},{center_c}) — DO and flow boosted.")

        elif roll < 0.20 and season == 1:
            # Spring algae seed flush — small N/P pulse from snowmelt at inflows
            inflows = [(r, c) for r in range(GRID_ROWS) for c in range(GRID_COLS)
                       if self.grid[r][c].cell_type == CELL_INFLOW]
            if inflows:
                r, c = random.choice(inflows)
                self.grid[r][c].nitrogen   = min(100.0, self.grid[r][c].nitrogen   + random.uniform(2, 6))
                self.grid[r][c].phosphorus = min(100.0, self.grid[r][c].phosphorus + random.uniform(1, 3))
                self._add_marker(r, c, "nat_nutrient", "#86efac", "Melt")
                self._log(f"🌱 Spring snowmelt nutrient pulse at inflow ({r},{c}).")

    def _random_events(self) -> None:
        """Generate stochastic environmental events each tick."""
        # Industrial spill — can now happen at ANY active inflow, not just east
        if self.contaminant_config["random_spills"] and random.random() < SPILL_PROB:
            spill_candidates = [
                (r, c) for r in range(GRID_ROWS) for c in range(GRID_COLS)
                if self.grid[r][c].cell_type == CELL_INFLOW
            ]
            if spill_candidates:
                # Mild east preference, but random spills still occur on north/west inflows.
                east_candidates = [(r, c) for r, c in spill_candidates if c == GRID_COLS - 1]
                if east_candidates and random.random() < 0.40:
                    r, c = random.choice(east_candidates)
                else:
                    r, c = random.choice(spill_candidates)
                # Split spill: 50% at source, 50% spread to nearby water cells.
                spill_at_source = SPILL_MAGNITUDE * 0.50
                spill_to_nbrs   = SPILL_MAGNITUDE * 0.50
                self.grid[r][c].industrial = min(100.0, self.grid[r][c].industrial + spill_at_source)
                nbr_cells = [(nr, nc, cell)
                             for nr, nc, cell in self._cells_in_radius(r, c, 2)
                             if cell.cell_type != CELL_INFLOW and (nr, nc) != (r, c)]
                if nbr_cells:
                    share = spill_to_nbrs / len(nbr_cells)
                    for *_, ncell in nbr_cells:
                        ncell.industrial = min(100.0, ncell.industrial + share)
                else:
                    self.grid[r][c].industrial = min(100.0, self.grid[r][c].industrial + spill_to_nbrs)
                inflow_type = "east industrial" if c == GRID_COLS - 1 else ("north agricultural" if r == 0 else "west river")
                self._add_marker(r, c, "spill", "#ff9900", "Spill")
                self._log(f"⚠ Industrial spill at {inflow_type} inflow ({r},{c})!")

        # Heavy rainfall event
        if self.contaminant_config["heavy_rain_events"] and random.random() < HEAVY_RAIN_PROB:
            self.drivers.rainfall = min(1.0, self.drivers.rainfall + 0.4)
            self.drivers.storm_intensity = min(1.0, self.drivers.storm_intensity + 0.3)
            inflows = [(r, c) for r in range(GRID_ROWS) for c in range(GRID_COLS)
                       if self.grid[r][c].cell_type == CELL_INFLOW]
            if inflows:
                r, c = random.choice(inflows)
                self._add_marker(r, c, "rain", "#60a5fa", "Rain")
            self._log("🌧 Heavy rainfall event — nutrient runoff surge!")
        else:
            # Rainfall slowly returns to baseline
            floor = 0.05 if self.contaminant_config["nutrient_runoff"] else 0.0
            self.drivers.rainfall = max(floor, self.drivers.rainfall * 0.97)
            self.drivers.storm_intensity = max(0.0, self.drivers.storm_intensity * 0.90)

    # ─────────────────────────────────────────────────────────────────────────
    # METRICS
    # ─────────────────────────────────────────────────────────────────────────

    def _compute_global_health(self) -> float:
        """
        Weighted average health score across all water cells (0–100).
        Penalises dead zones and severe blooms more heavily.
        """
        scores: List[float] = []
        for row in self.grid:
            for cell in row:
                if cell.cell_type != CELL_LAND:
                    scores.append(cell.health_score())
        if not scores:
            return 0.0
        base = sum(scores) / len(scores)
        # Extra penalty for dead zones
        dead = sum(1 for row in self.grid for cell in row
                   if cell.cell_type != CELL_LAND and cell.is_dead_zone)
        penalty = dead * 0.5
        return max(0.0, min(100.0, base - penalty))

    # ─────────────────────────────────────────────────────────────────────────
    # HELPERS
    # ─────────────────────────────────────────────────────────────────────────

    def _log(self, msg: str) -> None:
        """Append a time-stamped event message."""
        entry = f"[t={self.drivers.timestep}] {msg}"
        self._recent_events.append(entry)
        if len(self._recent_events) > self.MAX_EVENT_LOG:
            self._recent_events = self._recent_events[-self.MAX_EVENT_LOG:]
