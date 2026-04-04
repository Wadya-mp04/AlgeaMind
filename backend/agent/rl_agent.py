"""
RLAgent — online Q-learning agent for HAB mitigation.

State space (discrete): 5-tuple of bucketed global metrics.
    (health_b, bloom_b, do_b, dead_zone_b, issue_b)
    Total combinations: 5 × 4 × 4 × 3 × 5 = 1200 possible states (sparse)

Action space: 10 discrete actions (mirrors the environment's action IDs).

The agent starts with high exploration (ε=0.40) and decays toward pure
exploitation as it accumulates experience. The learning process is
intentionally visible — watching ε fall and Q-entries grow is part of the
demo narrative.

Target cell selection uses lightweight domain knowledge so the RL agent
doesn't waste actions on wrong cell types (e.g. nutrient actions near inflow).
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple

from config.constants import ACTION_NAMES


class RLAgent:
    """Online Q-learning (TD-0) agent with epsilon-greedy exploration."""

    EPSILON_START = 0.40
    EPSILON_MIN   = 0.05
    EPSILON_DECAY = 0.992   # per step
    ALPHA         = 0.12    # learning rate
    GAMMA         = 0.95    # discount factor
    N_ACTIONS     = 10

    def __init__(self) -> None:
        # Sparse Q-table: (state_key, action_id) → float
        self.q_table: Dict[Tuple, float] = {}
        self.epsilon:          float = self.EPSILON_START
        self.total_steps:      int   = 0
        self.cumulative_reward: float = 0.0

        # Saved from previous call for TD update
        self._prev_state: Optional[Tuple] = None
        self._prev_action: Optional[int]  = None
        self._prev_health: Optional[float] = None
        self._prev_dead:   Optional[int]   = None

    # ─────────────────────────────────────────────────────────────────────────
    # Public
    # ─────────────────────────────────────────────────────────────────────────

    def select_action(self, obs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Choose an action for the current observation.
        Performs a TD(0) Q-update from the last transition first.
        Returns a dict compatible with the other agents' return format.
        """
        state = self._discretize(obs)

        # TD update from the previous step (if any)
        if self._prev_state is not None:
            self._td_update(state, obs)

        # Epsilon-greedy selection
        if random.random() < self.epsilon:
            action_id = random.randint(0, self.N_ACTIONS - 1)
            mode = "EXPLORE"
        else:
            q_vals = [self._get_q(state, a) for a in range(self.N_ACTIONS)]
            action_id = max(range(self.N_ACTIONS), key=lambda a: q_vals[a])
            mode = "EXPLOIT"

        # Decay epsilon
        self.epsilon = max(self.EPSILON_MIN, self.epsilon * self.EPSILON_DECAY)
        self.total_steps += 1

        # Save for next TD update
        self._prev_state  = state
        self._prev_action = action_id
        self._prev_health = obs["global_health"]
        self._prev_dead   = obs["dead_zone_cells"]

        row, col = self._choose_target(action_id, obs)

        reasoning = (
            f"[RL/{mode}] ε={self.epsilon:.3f} | "
            f"state={state} | Q={self._get_q(state, action_id):.2f} | "
            f"steps={self.total_steps} | table={len(self.q_table)} entries | "
            f"Σreward={self.cumulative_reward:.1f}"
        )

        return {
            "action_id":          action_id,
            "action_name":        ACTION_NAMES[action_id],
            "row":                row,
            "col":                col,
            "reasoning":          reasoning,
            # Extra RL stats for the frontend to display
            "rl_stats": {
                "epsilon":            round(self.epsilon, 3),
                "q_table_size":       len(self.q_table),
                "total_steps":        self.total_steps,
                "cumulative_reward":  round(self.cumulative_reward, 1),
                "mode":               mode,
            },
        }

    # ─────────────────────────────────────────────────────────────────────────
    # State discretization
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _discretize(obs: Dict[str, Any]) -> Tuple[int, int, int, int, int]:
        """Map continuous observation to a 5-dimensional discrete state key."""
        health = obs["global_health"]
        bloom  = obs["bloom_cells"]
        do_val = obs["avg_do"]
        dead   = obs["dead_zone_cells"]
        ind    = obs.get("avg_industrial", 0.0)

        # Health: 5 buckets (0-20, 20-40, 40-60, 60-80, 80+)
        h_b = min(4, int(health / 20))

        # Bloom cells: none / mild / moderate / severe
        b_b = 0 if bloom == 0 else (1 if bloom < 8 else (2 if bloom < 25 else 3))

        # Average DO: critical / hypoxic / low / healthy
        d_b = (0 if do_val < 10 else
               1 if do_val < 20 else
               2 if do_val < 50 else 3)

        # Dead zones: none / few / many
        dz_b = 0 if dead == 0 else (1 if dead < 5 else 2)

        # Dominant issue: helps disambiguate states at same health level
        if dead > 3:      issue = 0   # dead zones — most urgent
        elif do_val < 20: issue = 1   # hypoxia
        elif bloom > 20:  issue = 2   # severe bloom
        elif ind > 20:    issue = 3   # industrial
        else:             issue = 4   # nutrient pressure / mild

        return (h_b, b_b, d_b, dz_b, issue)

    # ─────────────────────────────────────────────────────────────────────────
    # Q-table helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _get_q(self, state: Tuple, action_id: int) -> float:
        return self.q_table.get((state, action_id), 0.0)

    def _td_update(self, next_state: Tuple, obs: Dict[str, Any]) -> None:
        """Single TD(0) update: Q(s,a) ← Q(s,a) + α[r + γ·max Q(s') − Q(s,a)]"""
        assert self._prev_state is not None
        assert self._prev_action is not None

        # Reward: change in global health + shaped bonuses
        reward = obs["global_health"] - (self._prev_health or 0.0)

        # Bonus: dead zones reduced → big positive
        dead_now  = obs["dead_zone_cells"]
        dead_prev = self._prev_dead or 0
        if dead_now < dead_prev:
            reward += 3.0 * (dead_prev - dead_now)
        elif dead_now > dead_prev:
            reward -= 2.0 * (dead_now - dead_prev)

        # Bonus: healthy DO maintained
        if obs["avg_do"] >= 50:
            reward += 0.3

        self.cumulative_reward += reward

        old_q    = self._get_q(self._prev_state, self._prev_action)
        best_nxt = max(self._get_q(next_state, a) for a in range(self.N_ACTIONS))
        new_q    = old_q + self.ALPHA * (reward + self.GAMMA * best_nxt - old_q)
        self.q_table[(self._prev_state, self._prev_action)] = new_q

    # ─────────────────────────────────────────────────────────────────────────
    # Target cell selection
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _choose_target(action_id: int, obs: Dict[str, Any]) -> Tuple[int, int]:
        """
        Domain-guided target selection: ensures the action is applied to a
        cell where it will have meaningful effect.  Keeps RL exploration
        focused on *which* action to take rather than also exploring random
        cell positions.
        """
        worst: List[Dict] = obs.get("worst_cells", [])
        if not worst:
            return (10, 14)   # lake centre fallback

        if action_id in (1, 9):
            # Nutrient reduction / wetland filtration → inflow cells
            inflow = [c for c in worst if c.get("type") == 2]
            if inflow:
                return (inflow[0]["row"], inflow[0]["col"])
            # Fallback: highest nitrogen cell
            by_n = sorted(worst, key=lambda x: -x.get("n", 0))
            return (by_n[0]["row"], by_n[0]["col"])

        if action_id == 8:
            # Spill mitigation → highest industrial load
            by_ind = sorted(worst, key=lambda x: -x.get("ind", 0))
            return (by_ind[0]["row"], by_ind[0]["col"])

        if action_id in (2, 3):
            # Aerate / circulation → lowest dissolved oxygen
            by_do = sorted(worst, key=lambda x: x.get("do", 100.0))
            return (by_do[0]["row"], by_do[0]["col"])

        if action_id in (4, 7):
            # Mechanical removal / chemical treatment → highest algae
            by_algae = sorted(worst, key=lambda x: -x.get("algae", 0))
            return (by_algae[0]["row"], by_algae[0]["col"])

        if action_id in (5, 6):
            # Shading / bio-control → moderate+ bloom cells
            bloom_cells = [c for c in worst if c.get("algae", 0) >= 35]
            if bloom_cells:
                return (bloom_cells[0]["row"], bloom_cells[0]["col"])

        # action_id == 0 (do nothing) or generic fallback
        return (worst[0]["row"], worst[0]["col"])
