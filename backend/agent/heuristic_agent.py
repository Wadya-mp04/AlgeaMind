"""
HeuristicAgent — rule-based baseline agent for AlgaeMind.

Strategy (priority order):
  1. Industrial spill present → mitigate_spill at worst industrial cell
  2. Dead zone (DO ≤ 5)      → aerate at worst DO cell
  3. Severe bloom (algae ≥ 65) → mechanical removal OR chemical treatment
  4. Hypoxia (DO ≤ 20)       → aerate or increase circulation
  5. Active bloom (algae ≥ 35) → biological control
  6. High nutrients at inflow → reduce_nutrient_inflow or wetland filtration
  7. Moderate nutrients       → do nothing (conserve resources)
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple

from config.constants import (
    BLOOM_THRESHOLD, SEVERE_BLOOM, HYPOXIC_DO, ANOXIC_DO,
    CELL_LAND, CELL_INFLOW,
    ACTION_NAMES,
)


class HeuristicAgent:
    """Deterministic priority-based intervention agent."""

    def __init__(self) -> None:
        self._last_action: Optional[Dict] = None
        self._cycle: int = 0

    def select_action(self, observation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Given the agent observation dict (from env.get_agent_observation()),
        return {action_id, row, col, reasoning}.
        """
        self._cycle += 1
        worst_cells: List[Dict] = observation.get("worst_cells", [])
        drivers = observation.get("drivers", {})

        if not worst_cells:
            return self._do_nothing("No actionable cells found.")

        # Collect convenience lists
        industrial_cells = [c for c in worst_cells if c["ind"] > 30]
        dead_zone_cells  = [c for c in worst_cells if c["do"] <= ANOXIC_DO]
        severe_bloom     = [c for c in worst_cells if c["algae"] >= SEVERE_BLOOM]
        hypoxic_cells    = [c for c in worst_cells if c["do"] <= HYPOXIC_DO and c["do"] > ANOXIC_DO]
        bloom_cells      = [c for c in worst_cells if BLOOM_THRESHOLD <= c["algae"] < SEVERE_BLOOM]
        inflow_cells     = [c for c in worst_cells if c["type"] == CELL_INFLOW]
        high_nutrient_inf = [
            c for c in inflow_cells
            if c["n"] > 40 or c["p"] > 22
        ]

        # ── Priority 1: Industrial spill ──────────────────────────────────────
        if industrial_cells:
            target = max(industrial_cells, key=lambda x: x["ind"])
            return self._action(8, target, "Industrial pollution above safe threshold — deploying containment.")

        # ── Priority 2: Dead zone / anoxia ────────────────────────────────────
        if dead_zone_cells:
            target = min(dead_zone_cells, key=lambda x: x["do"])
            return self._action(2, target, "Dead zone detected — emergency aeration to prevent ecosystem collapse.")

        # ── Priority 3a: Severe bloom — chemical treatment if localised ───────
        if severe_bloom and len(severe_bloom) <= 6:
            target = max(severe_bloom, key=lambda x: x["algae"])
            return self._action(7, target, "Severe localised bloom — chemical treatment for rapid control.")

        # ── Priority 3b: Severe bloom — mechanical removal if widespread ──────
        if severe_bloom:
            target = max(severe_bloom, key=lambda x: x["algae"])
            return self._action(4, target, "Widespread severe bloom — mechanical harvesting at epicentre.")

        # ── Priority 4: Hypoxia → aerate or circulate ────────────────────────
        if hypoxic_cells:
            target = min(hypoxic_cells, key=lambda x: x["do"])
            # Alternate between aeration and circulation to cover more area
            action_id = 2 if (self._cycle % 3 != 0) else 3
            name = "aeration" if action_id == 2 else "increased circulation"
            return self._action(action_id, target, f"Hypoxic conditions — applying {name}.")

        # ── Priority 5: Active bloom → biological control ─────────────────────
        if bloom_cells:
            target = max(bloom_cells, key=lambda x: x["algae"])
            # Prefer biological control (sustainable); shading if bio_control already active
            if 6 not in target["active"]:
                return self._action(6, target, "Bloom developing — releasing biological control agents.")
            elif 5 not in target["active"]:
                return self._action(5, target, "Bio-control active — adding shading to limit photosynthesis.")
            else:
                return self._action(4, target, "Multiple interventions active — mechanical removal as backup.")

        # ── Priority 6: High nutrient inflow ─────────────────────────────────
        if high_nutrient_inf:
            target = max(high_nutrient_inf, key=lambda x: x["n"] + x["p"])
            # Alternate nutrient reduction and wetland filtration
            action_id = 1 if (self._cycle % 4 < 2) else 9
            label = "nutrient reduction" if action_id == 1 else "wetland filtration"
            return self._action(action_id, target, f"Elevated inflow nutrients — {label} applied.")

        # ── Priority 7: Preventive circulation in low-flow areas ─────────────
        low_flow = [c for c in worst_cells if c["do"] < 65 and c["do"] > HYPOXIC_DO]
        if low_flow:
            target = min(low_flow, key=lambda x: x["do"])
            return self._action(3, target, "Preventive circulation to maintain DO levels.")

        # ── Default: do nothing ───────────────────────────────────────────────
        return self._do_nothing("Ecosystem metrics within acceptable range — monitoring.")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _action(self, action_id: int, cell: Dict, reasoning: str) -> Dict[str, Any]:
        result = {
            "action_id":   action_id,
            "action_name": ACTION_NAMES[action_id],
            "row":         cell["row"],
            "col":         cell["col"],
            "reasoning":   reasoning,
        }
        self._last_action = result
        return result

    def _do_nothing(self, reasoning: str) -> Dict[str, Any]:
        result = {
            "action_id":   0,
            "action_name": "Do Nothing",
            "row":         0,
            "col":         0,
            "reasoning":   reasoning,
        }
        self._last_action = result
        return result

    @property
    def last_action(self) -> Optional[Dict]:
        return self._last_action
