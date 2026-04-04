"""
Physics update rules for the AlgaeMind 2D grid simulation.

All functions are pure-ish (they mutate CellState in-place for performance,
but accept and return nothing surprising).  The step order is:
  1. inflow_nutrients        — nutrient / pollution input at inflow cells
  2. grow_algae              — logistic growth driven by N, P, temperature, light
  3. update_oxygen           — photosynthesis / respiration / reaeration
  4. update_biodiversity     — target-relaxation toward DO/algae/industrial-driven target
  5. decay_nutrients         — natural attenuation + algae uptake
  6. decay_sediment          — settling
  7. decay_industrial        — slow natural degradation
  8. spread_algae            — diffusion to water neighbours (separate pass)
  9. tick_interventions      — decrement and remove expired intervention timers
"""
from __future__ import annotations

import math
import random
from typing import List

from config.constants import (
    ALGAE_BASE_GROWTH, ALGAE_TEMP_COEFF, ALGAE_LIGHT_COEFF,
    ALGAE_SPREAD_RATE, ALGAE_NATURAL_DECAY,
    DO_REAERATION, DO_ALGAE_NEUTRAL, DO_ALGAE_HARMFUL,
    BIO_RECOVERY,
    SEDIMENT_SETTLING,
    NUTRIENT_UPTAKE_ALGAE, NUTRIENT_DECAY,
    RAIN_N_INPUT, RAIN_P_INPUT, RAIN_SEDIMENT_INPUT,
    STORM_MULTIPLIER, INDUSTRIAL_BASE_RATE,
    BLOOM_THRESHOLD, HYPOXIC_DO, ANOXIC_DO,
    CELL_LAND, CELL_INFLOW, CELL_OUTFLOW, CELL_WATER,
    INFLOW_EAST_SET, TEMP_BASELINE,
)
from simulation.cell_state import CellState, GlobalDrivers


# ─────────────────────────────────────────────────────────────────────────────
# 1. INFLOW NUTRIENTS
# ─────────────────────────────────────────────────────────────────────────────

def inflow_nutrients(
    cell: CellState,
    row: int,
    col: int,
    drivers: GlobalDrivers,
    grid: List[List[CellState]],
    contaminant_config: dict,
) -> None:
    """Add runoff nutrients and sediment to inflow cells each tick."""
    if cell.cell_type != CELL_INFLOW:
        return

    rain   = drivers.rainfall
    storm  = drivers.storm_intensity
    fert   = drivers.fertilizer_use
    amp    = rain * (1.0 + STORM_MULTIPLIER * storm)

    # Agricultural / river inflow: nutrients proportional to rainfall × fertilizer
    if contaminant_config.get("nutrient_runoff", False):
        n_in  = RAIN_N_INPUT  * amp * fert
        p_in  = RAIN_P_INPUT  * amp * fert
        s_in  = RAIN_SEDIMENT_INPUT * amp
    else:
        n_in = 0.0
        p_in = 0.0
        s_in = 0.0

    # Apply interception before the load is distributed so containment also
    # reduces leakage into neighboring water cells.
    intercept_factor = 1.0
    if cell.nutrient_intercept > 0:
        intercept_factor = max(0.0, 1.0 - cell.nutrient_intercept)

    n_in_eff = n_in * intercept_factor
    p_in_eff = p_in * intercept_factor
    s_in_eff = s_in * intercept_factor

    cell.nitrogen   = min(100.0, cell.nitrogen   + n_in_eff)
    cell.phosphorus = min(100.0, cell.phosphorus + p_in_eff)
    cell.sediment   = min(100.0, cell.sediment   + s_in_eff)

    # Spread inflow loads into adjacent and second-ring water cells.
    # Higher neighbor_fraction = more realistic nutrient plume from inflow.
    neighbor_fraction = 0.50
    second_ring_fraction = 0.20
    rows_count = len(grid)
    cols_count = len(grid[0]) if rows_count else 0

    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = row + dr, col + dc
        if 0 <= nr < rows_count and 0 <= nc < cols_count:
            nbr = grid[nr][nc]
            if nbr.cell_type == CELL_LAND:
                continue
            nbr.nitrogen   = min(100.0, nbr.nitrogen   + n_in_eff * neighbor_fraction)
            nbr.phosphorus = min(100.0, nbr.phosphorus + p_in_eff * neighbor_fraction)
            nbr.sediment   = min(100.0, nbr.sediment   + s_in_eff * neighbor_fraction)
            # Second-ring spread (cells 2 steps from inflow)
            for dr2, dc2 in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr2, nc2 = nr + dr2, nc + dc2
                if (nr2, nc2) == (row, col):
                    continue
                if 0 <= nr2 < rows_count and 0 <= nc2 < cols_count:
                    nbr2 = grid[nr2][nc2]
                    if nbr2.cell_type == CELL_LAND:
                        continue
                    nbr2.nitrogen   = min(100.0, nbr2.nitrogen   + n_in_eff * second_ring_fraction)
                    nbr2.phosphorus = min(100.0, nbr2.phosphorus + p_in_eff * second_ring_fraction)
                    nbr2.sediment   = min(100.0, nbr2.sediment   + s_in_eff * second_ring_fraction * 0.5)

    # East inflow: industrial discharge
    if contaminant_config.get("industrial_discharge", False) and (row, col) in INFLOW_EAST_SET:
        cell.industrial = min(100.0, cell.industrial + INDUSTRIAL_BASE_RATE)


# ─────────────────────────────────────────────────────────────────────────────
# 2. ALGAE GROWTH
# ─────────────────────────────────────────────────────────────────────────────

def grow_algae(cell: CellState, drivers: GlobalDrivers) -> None:
    """Logistic algae growth with nutrient, temperature, and light limitation."""
    if cell.cell_type == CELL_LAND:
        return

    # Light availability: sediment reduces penetration
    light_factor = max(0.05, 1.0 - ALGAE_LIGHT_COEFF * cell.sediment)

    # Shading intervention halves effective light
    if cell.shaded:
        light_factor *= 0.45

    # Nutrient co-limitation (Liebig's Law: P is limiting in freshwater)
    n_rel = min(1.0, cell.nitrogen   / 50.0)
    p_rel = min(1.0, cell.phosphorus / 25.0)
    nutrient_factor = n_rel * 0.35 + p_rel * 0.65

    # Temperature dependence: growth accelerates above 15 °C
    temp_excess  = max(0.0, drivers.temperature - TEMP_BASELINE)
    growth_rate  = (
        ALGAE_BASE_GROWTH
        * (1.0 + ALGAE_TEMP_COEFF * temp_excess)
        * nutrient_factor
        * light_factor
    )

    # Small recruitment term: once catalysts return, a fully cleared cell can
    # still seed new algae instead of staying permanently at zero.
    seed_biomass = 1.5 + 0.015 * (cell.nitrogen + cell.phosphorus)

    # Logistic term: growth slows as algae approaches carrying capacity (100)
    logistic = 1.0 - cell.algae / 100.0
    delta     = growth_rate * (cell.algae + seed_biomass) * logistic - ALGAE_NATURAL_DECAY * cell.algae

    # Biological-control intervention reduces net growth by 5 % per tick
    if cell.bio_control:
        delta -= 0.05 * cell.algae

    cell.algae = max(0.0, min(100.0, cell.algae + delta))

    # Nutrient uptake proportional to growth
    if delta > 0:
        uptake = NUTRIENT_UPTAKE_ALGAE * delta
        cell.nitrogen   = max(0.0, cell.nitrogen   - uptake * 0.60)
        cell.phosphorus = max(0.0, cell.phosphorus - uptake * 0.40)


# ─────────────────────────────────────────────────────────────────────────────
# 3. OXYGEN DYNAMICS
# ─────────────────────────────────────────────────────────────────────────────

def update_oxygen(cell: CellState) -> None:
    """
    Net O2 effect of algal bloom + atmospheric reaeration.

    Low–moderate algae  → net O2 production (photosynthesis > respiration).
    Bloom levels        → net O2 consumption (respiration + decay dominate).
    Severe bloom (>65)  → rapid crash toward hypoxia / dead zone.
    """
    if cell.cell_type == CELL_LAND:
        return

    a = cell.algae
    if a < DO_ALGAE_NEUTRAL:
        algae_effect = +0.020 * a          # slight positive
    elif a < DO_ALGAE_HARMFUL:
        algae_effect = -0.010 * a          # net negative
    else:
        algae_effect = -0.050 * a          # severe crash

    # Aeration intervention: direct O2 boost applied in action handler, not here.
    # Circulation improves reaeration via higher flow.
    reaeration = DO_REAERATION * cell.flow * max(0.0, 100.0 - cell.dissolved_oxygen) / 100.0

    cell.dissolved_oxygen = max(0.0, min(100.0,
        cell.dissolved_oxygen + algae_effect + reaeration
    ))


# ─────────────────────────────────────────────────────────────────────────────
# 4. BIODIVERSITY
# ─────────────────────────────────────────────────────────────────────────────

def update_biodiversity(cell: CellState) -> None:
    """
    Biodiversity relaxes toward a target driven by DO, algae, and industrial load.
    Dead zones (DO ≤ 5) crush biodiversity quickly toward 0.
    """
    if cell.cell_type == CELL_LAND:
        return

    do  = cell.dissolved_oxygen
    ind = cell.industrial / 100.0

    if do <= ANOXIC_DO:
        target = 2.0
    elif do <= HYPOXIC_DO:
        target = 15.0 * (do / HYPOXIC_DO)
    else:
        do_fac   = ((do - HYPOXIC_DO) / (100.0 - HYPOXIC_DO)) ** 1.5
        alg_stress = max(0.0, (cell.algae - BLOOM_THRESHOLD) / (100.0 - BLOOM_THRESHOLD)) if cell.algae > BLOOM_THRESHOLD else 0.0
        ind_stress = ind
        target = 80.0 * do_fac * (1.0 - 0.70 * alg_stress) * (1.0 - 0.50 * ind_stress)

    # Faster degradation, slower recovery (realistic ecological lag)
    speed = BIO_RECOVERY if target > cell.biodiversity else BIO_RECOVERY * 2.5
    cell.biodiversity = max(0.0, min(100.0,
        cell.biodiversity + speed * (target - cell.biodiversity)
    ))


# ─────────────────────────────────────────────────────────────────────────────
# 5. NUTRIENT DECAY
# ─────────────────────────────────────────────────────────────────────────────

def decay_nutrients(cell: CellState) -> None:
    """Natural attenuation of dissolved N and P each tick."""
    if cell.cell_type == CELL_LAND:
        return
    cell.nitrogen   = max(0.0, cell.nitrogen   * (1.0 - NUTRIENT_DECAY))
    cell.phosphorus = max(0.0, cell.phosphorus * (1.0 - NUTRIENT_DECAY))


# ─────────────────────────────────────────────────────────────────────────────
# 6. SEDIMENT SETTLING
# ─────────────────────────────────────────────────────────────────────────────

def decay_sediment(cell: CellState, storm_intensity: float) -> None:
    """Sediment settles naturally; storms resuspend it (slow settling)."""
    if cell.cell_type == CELL_LAND:
        return
    settle_rate = SEDIMENT_SETTLING * (1.0 - 0.6 * storm_intensity)
    cell.sediment = max(0.0, cell.sediment * (1.0 - settle_rate))


# ─────────────────────────────────────────────────────────────────────────────
# 7. INDUSTRIAL DECAY
# ─────────────────────────────────────────────────────────────────────────────

def decay_industrial(cell: CellState) -> None:
    """Industrial pollutants degrade slowly via photolysis / dilution."""
    if cell.cell_type == CELL_LAND:
        return
    cell.industrial = max(0.0, cell.industrial * 0.980)


# ─────────────────────────────────────────────────────────────────────────────
# 8. ALGAE SPREAD (separate pass — avoids update-order artefacts)
# ─────────────────────────────────────────────────────────────────────────────

def spread_algae(grid: List[List[CellState]]) -> None:
    """
    Diffuse algal biomass to 4-connected water neighbours.
    Uses a two-buffer approach to avoid race conditions.
    Applies a directional bias towards the outflow (south edge) to simulate
    realistic downstream transport of algae and pollutants.
    """
    rows = len(grid)
    cols = len(grid[0]) if rows else 0

    # Directional flow bias constants
    # Keep a southward tendency without collapsing spread into one direction.
    SOUTH_BIAS = 1.3   # weight for downward (southward) spread
    NORTH_BIAS = 0.9   # still allow meaningful upstream/back-diffusion
    LATERAL_BIAS = 1.0 # east/west spread unchanged

    # Buffers for delta values
    delta = [[0.0] * cols for _ in range(rows)]

    for r in range(rows):
        for c in range(cols):
            cell = grid[r][c]
            if cell.cell_type == CELL_LAND:
                continue

            water_nbrs: List[tuple] = []
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc].cell_type != CELL_LAND:
                    water_nbrs.append((nr, nc, dr, dc))

            if not water_nbrs:
                continue

            # Amount leaving this cell (less if high flow — faster flushing removes algae)
            nutrient_seed = 0.0
            if cell.algae < 5.0:
                nutrient_seed = max(0.0, (cell.nitrogen / 50.0) + (cell.phosphorus / 25.0) - 0.4)

            spread_source = cell.algae + (nutrient_seed * 3.0)
            spread_out = ALGAE_SPREAD_RATE * spread_source * max(0.1, 1.0 - 0.4 * cell.flow)

            # Compute directional weights for each neighbour
            weights = []
            for nr, nc, dr, dc in water_nbrs:
                if dr == 1:        # south — towards outflow
                    w = SOUTH_BIAS
                elif dr == -1:     # north — away from outflow
                    w = NORTH_BIAS
                else:              # east / west
                    w = LATERAL_BIAS
                weights.append(w)

            total_weight = sum(weights)
            delta[r][c] -= spread_out
            for (nr, nc, _dr, _dc), w in zip(water_nbrs, weights):
                delta[nr][nc] += spread_out * (w / total_weight)

    # Apply deltas
    for r in range(rows):
        for c in range(cols):
            if grid[r][c].cell_type != CELL_LAND:
                grid[r][c].algae = max(0.0, min(100.0, grid[r][c].algae + delta[r][c]))


# ─────────────────────────────────────────────────────────────────────────────
# 8b. INDUSTRIAL SPREAD (separate pass — mirrors algae spread logic)
# ─────────────────────────────────────────────────────────────────────────────

def spread_industrial(grid: List[List[CellState]]) -> None:
    """
    Diffuse industrial pollution to neighbouring water cells.
    Biased towards outflow (south) to simulate downstream transport.
    Spread rate is slower than algae (pollution is denser / settles).
    """
    rows = len(grid)
    cols = len(grid[0]) if rows else 0

    INDUSTRIAL_SPREAD_RATE = 0.06
    SOUTH_BIAS   = 1.3
    NORTH_BIAS   = 0.9
    LATERAL_BIAS = 1.0

    delta = [[0.0] * cols for _ in range(rows)]

    for r in range(rows):
        for c in range(cols):
            cell = grid[r][c]
            if cell.cell_type == CELL_LAND or cell.industrial < 1.0:
                continue

            water_nbrs = []
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc].cell_type != CELL_LAND:
                    water_nbrs.append((nr, nc, dr, dc))

            if not water_nbrs:
                continue

            spread_out = INDUSTRIAL_SPREAD_RATE * cell.industrial * max(0.1, 1.0 - 0.3 * cell.flow)
            weights = []
            for _nr, _nc, dr, dc in water_nbrs:
                if dr == 1:
                    weights.append(SOUTH_BIAS)
                elif dr == -1:
                    weights.append(NORTH_BIAS)
                else:
                    weights.append(LATERAL_BIAS)

            total_weight = sum(weights)
            delta[r][c] -= spread_out
            for (nr, nc, _dr, _dc), w in zip(water_nbrs, weights):
                delta[nr][nc] += spread_out * (w / total_weight)

    for r in range(rows):
        for c in range(cols):
            if grid[r][c].cell_type != CELL_LAND:
                grid[r][c].industrial = max(0.0, min(100.0, grid[r][c].industrial + delta[r][c]))


# ─────────────────────────────────────────────────────────────────────────────
# 8c. RUNOFF NUTRIENT SPREAD (separate pass)
# ─────────────────────────────────────────────────────────────────────────────

def spread_runoff_nutrients(
    grid: List[List[CellState]],
    contaminant_config: dict,
) -> None:
    """
    Transport nutrient and sediment plumes downstream so runoff visibly spreads
    from inflow channels into the wider lake each tick.
    """
    if not contaminant_config.get("nutrient_runoff", False):
        return

    rows = len(grid)
    cols = len(grid[0]) if rows else 0

    N_RATE = 0.07
    P_RATE = 0.06
    S_RATE = 0.08
    SOUTH_BIAS = 1.15
    NORTH_BIAS = 0.95
    LATERAL_BIAS = 1.0
    OUTFLOW_DRIFT = 0.18
    FAR_FIELD_MIX = 0.015

    delta_n = [[0.0] * cols for _ in range(rows)]
    delta_p = [[0.0] * cols for _ in range(rows)]
    delta_s = [[0.0] * cols for _ in range(rows)]

    outflow_positions = [
        (r, c)
        for r in range(rows)
        for c in range(cols)
        if grid[r][c].cell_type == CELL_OUTFLOW
    ]

    def min_outflow_dist(rr: int, cc: int) -> int:
        if not outflow_positions:
            return 0
        return min(abs(rr - orow) + abs(cc - ocol) for orow, ocol in outflow_positions)

    for r in range(rows):
        for c in range(cols):
            cell = grid[r][c]
            if cell.cell_type == CELL_LAND:
                continue

            water_nbrs = []
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc].cell_type != CELL_LAND:
                    water_nbrs.append((nr, nc, dr))

            if not water_nbrs:
                continue

            # Faster cells advect more pollutant mass each tick, but keep
            # transport modest so agents have time to intervene.
            flow_boost = 0.35 + 0.65 * cell.flow
            move_n = cell.nitrogen * N_RATE * flow_boost
            move_p = cell.phosphorus * P_RATE * flow_boost
            move_s = cell.sediment * S_RATE * flow_boost

            src_outflow_dist = min_outflow_dist(r, c)

            weights = []
            for nr, nc, dr in water_nbrs:
                if dr == 1:
                    w = SOUTH_BIAS
                elif dr == -1:
                    w = NORTH_BIAS
                else:
                    w = LATERAL_BIAS

                # Mild directional pull toward outflow cells.
                nbr_outflow_dist = min_outflow_dist(nr, nc)
                if nbr_outflow_dist < src_outflow_dist:
                    w *= (1.0 + OUTFLOW_DRIFT)
                elif nbr_outflow_dist > src_outflow_dist:
                    w *= (1.0 - OUTFLOW_DRIFT * 0.45)
                weights.append(w)
            total_weight = sum(weights)

            delta_n[r][c] -= move_n
            delta_p[r][c] -= move_p
            delta_s[r][c] -= move_s

            for (nr, nc, _dr), w in zip(water_nbrs, weights):
                share = w / total_weight
                delta_n[nr][nc] += move_n * share
                delta_p[nr][nc] += move_p * share
                delta_s[nr][nc] += move_s * share

    # Basin-scale conservative mixing so contamination slowly reaches the full
    # sandbox without unrealistically appearing everywhere at once.
    water_positions = [
        (r, c)
        for r in range(rows)
        for c in range(cols)
        if grid[r][c].cell_type != CELL_LAND
    ]

    if water_positions:
        avg_n = sum(grid[r][c].nitrogen for r, c in water_positions) / len(water_positions)
        avg_p = sum(grid[r][c].phosphorus for r, c in water_positions) / len(water_positions)
        avg_s = sum(grid[r][c].sediment for r, c in water_positions) / len(water_positions)
        for r, c in water_positions:
            cell = grid[r][c]
            mix = FAR_FIELD_MIX * (0.8 + 0.4 * cell.flow)
            delta_n[r][c] += (avg_n - cell.nitrogen) * mix
            delta_p[r][c] += (avg_p - cell.phosphorus) * mix
            delta_s[r][c] += (avg_s - cell.sediment) * mix

    for r in range(rows):
        for c in range(cols):
            cell = grid[r][c]
            if cell.cell_type == CELL_LAND:
                continue
            cell.nitrogen = max(0.0, min(100.0, cell.nitrogen + delta_n[r][c]))
            cell.phosphorus = max(0.0, min(100.0, cell.phosphorus + delta_p[r][c]))
            cell.sediment = max(0.0, min(100.0, cell.sediment + delta_s[r][c]))


# ─────────────────────────────────────────────────────────────────────────────
# 9. INTERVENTION TIMERS
# ─────────────────────────────────────────────────────────────────────────────

def tick_interventions(cell: CellState) -> None:
    """
    Decrement timed intervention counters.
    When a counter reaches 0 remove the effect flags.
    """
    if cell.cell_type == CELL_LAND:
        return

    to_remove: List[str] = []
    for key in list(cell.intervention_ticks.keys()):
        cell.intervention_ticks[key] -= 1
        if cell.intervention_ticks[key] <= 0:
            to_remove.append(key)

    for key in to_remove:
        del cell.intervention_ticks[key]
        action_id = int(key)
        if action_id in cell.active_interventions:
            cell.active_interventions.remove(action_id)
        # Clear intervention-specific flags
        if action_id == 5:
            cell.shaded = False
        elif action_id == 6:
            cell.bio_control = False
        elif action_id in (1, 9):
            cell.nutrient_intercept = 0.0


# ─────────────────────────────────────────────────────────────────────────────
# ORCHESTRATED FULL-GRID STEP
# ─────────────────────────────────────────────────────────────────────────────

def full_physics_step(
    grid: List[List[CellState]],
    drivers: GlobalDrivers,
    contaminant_config: dict,
) -> None:
    """
    Apply all physics rules to the entire grid for one timestep.
    Order matters: interventions are ticked last so effects persist for the full step.
    """
    rows = len(grid)
    cols = len(grid[0]) if rows else 0

    for r in range(rows):
        for c in range(cols):
            cell = grid[r][c]
            if cell.cell_type == CELL_LAND:
                continue
            inflow_nutrients(cell, r, c, drivers, grid, contaminant_config)
            grow_algae(cell, drivers)
            update_oxygen(cell)
            update_biodiversity(cell)
            decay_nutrients(cell)
            decay_sediment(cell, drivers.storm_intensity)
            decay_industrial(cell)
            cell.clamp()

    # Spread passes (two-buffer approach prevents race conditions)
    spread_runoff_nutrients(grid, contaminant_config)
    spread_algae(grid)
    spread_industrial(grid)

    # Tick intervention timers
    for r in range(rows):
        for c in range(cols):
            tick_interventions(grid[r][c])
