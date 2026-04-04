"""
LLMAgent — Claude-powered environmental scientist agent for AlgaeMind.

The agent receives a compact observation of the simulation state and returns
a structured intervention decision with reasoning.  It also maintains a
growing "research brief" that accumulates hypotheses and findings across
cycles — mimicking how a field researcher builds domain knowledge over time.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import anthropic
from dotenv import load_dotenv

from config.constants import ACTION_NAMES, ACTION_DESCRIPTIONS, ACTION_COSTS, NUM_ACTIONS

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert environmental scientist and limnologist specialising in
Harmful Algal Bloom (HAB) mitigation for freshwater lakes and reservoirs.

You are operating as an autonomous decision-making agent in a 2D grid
simulation of a eutrophying lake.  Each cell has:
  algae (0-100), nitrogen, phosphorus, dissolved_oxygen, sediment,
  industrial, biodiversity, flow, cell_type (0=water,2=inflow,3=outflow).

Global drivers: temperature (°C), rainfall (0-1), storm_intensity (0-1),
                season (0-3), fertilizer_use (0-1).

Your goal is NOT simply to minimise algae.  You must optimise for long-term
ecosystem health WHILE MINIMISING INTERVENTION COST.  Prioritise the most
cost-effective action that addresses the most critical issue.  Avoid
expensive interventions when cheaper alternatives work.

Available interventions (action_id | cost | radius | duration):
  0  Do Nothing              (cost:  0 | —      | —       ) — observe only
  1  Reduce Nutrient Inflow  (cost:  5 | r=3    | 24 ticks) — blocks 60% runoff at inflow cells
  2  Aerate Region           (cost:  8 | r=2    | 8 ticks ) — boosts DO immediately (+18)
  3  Increase Circulation    (cost:  6 | r=3    | 16 ticks) — improves reaeration + dilution
  4  Mechanical Algae Removal(cost:  7 | r=2    | instant ) — removes 65% algae directly
  5  Add Shading             (cost:  4 | r=2    | 20 ticks) — limits photosynthesis (cheapest sustained)
  6  Biological Control      (cost: 10 | r=3    | 28 ticks) — slow sustained algae reduction
  7  Chemical Treatment      (cost: 12 | r=2    | instant ) — 80% algae kill + raises toxicity (EXPENSIVE)
  8  Mitigate Industrial Spill(cost: 9 | r=2    | instant ) — removes 70% industrial pollution
  9  Wetland Filtration      (cost: 11 | r=3    | 32 ticks) — filters inflow nutrients (long duration)

Cost-efficiency rules:
  1. If health > 70 and no dead zones: Do Nothing (cost 0) — conserve budget.
  2. Dead zone (DO ≤ 5): Aerate (cost 8) — cheapest emergency fix.
  3. Industrial spill (ind > 30): Mitigate Spill (cost 9) — must act quickly.
  4. High inflow nutrients (N or P > 50): Reduce Inflow (cost 5) — prevents future blooms cheaply.
  5. Active bloom spreading: Shading (cost 4) is cheapest sustained suppression.
  6. Widespread severe bloom: Mechanical Removal (cost 7) before Chemical (cost 12).
  7. NEVER use Chemical Treatment (cost 12) unless DO is crashing AND bloom is severe AND cheaper
     alternatives are already active.

Trade-offs to always consider:
  - Chemical treatment is fast but raises industrial pollution and harms biodiversity.
  - Aeration helps DO but does not address nutrient root causes.
  - Biological control is slow (28 ticks) but the most sustainable once nutrients are managed.
  - If nutrients are not controlled, blooms will return after any intervention.
  - Real-world data (if provided) should be weighted heavily — it represents measured ground truth.

You will respond ONLY with a valid JSON object — no prose, no markdown fences:
{
  "action_id":    <integer 0-9>,
  "row":          <integer>,
  "col":          <integer>,
  "reasoning":    "<1-3 sentence scientific + cost justification>",
  "brief_update": "<markdown bullet updating your running research brief>"
}
"""


class LLMAgent:
    """Claude-powered agent that acts as an environmental scientist."""

    MODEL = "claude-sonnet-4-6"
    MAX_BRIEF_CHARS = 3000

    def __init__(self) -> None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else None
        self.research_brief: str = (
            "# Research Brief\n\n"
            "## Initial Assessment\n"
            "- Eutrophic lake with elevated N/P detected.\n"
            "- Agricultural inflow (north) and industrial discharge (east) identified as primary sources.\n"
            "- Bloom conditions developing near north inflow zone.\n\n"
            "## Hypotheses\n"
            "- H1: Phosphorus is the primary limiting nutrient (Liebig's Law, freshwater).\n"
            "- H2: Targeting inflow zones before the bloom peak will be more effective than reactive treatment.\n"
            "- H3: Combined bio-control + shading can suppress blooms without chemical toxicity.\n"
        )
        self._cycle = 0
        self._last_action: Optional[Dict] = None
        # Cost tracking
        self.cost_ledger: List[Dict] = []
        self.total_cost: float = 0.0
        self.traditional_cost_estimate: float = 0.0

    def select_action(self, observation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Call Claude to select an intervention.  Falls back to heuristic if
        the API key is missing or the call fails.
        """
        self._cycle += 1

        # Snapshot metrics before action for cost ledger
        health_before  = observation.get("global_health", 0)
        bloom_cells    = observation.get("bloom_cells", 0)
        dead_zones     = observation.get("dead_zone_cells", 0)
        worst_cells    = observation.get("worst_cells", [])
        industrial_hit = sum(1 for c in worst_cells if c.get("ind", 0) > 30)

        if self.client is None:
            result = self._fallback("ANTHROPIC_API_KEY not set — falling back to heuristic observation.")
        else:
            prompt = self._build_prompt(observation)
            try:
                message = self.client.messages.create(
                    model=self.MODEL,
                    max_tokens=512,
                    system=SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = message.content[0].text.strip()
                result = self._parse_response(raw)
            except Exception as exc:
                result = self._fallback(f"LLM call failed: {exc}")

        # Record cost
        action_cost = ACTION_COSTS.get(result["action_id"], 0.0)
        self.total_cost += action_cost

        # Estimate what a traditional reactive approach would have cost this tick
        # (chemical treatment for bloom, aerate for dead zones, spill mitigate for industrial)
        trad_cost = 0.0
        if bloom_cells > 20:
            trad_cost += ACTION_COSTS[7]   # Chemical Treatment = 12
        if dead_zones > 0:
            trad_cost += ACTION_COSTS[2]   # Aerate = 8
        if industrial_hit > 0:
            trad_cost += ACTION_COSTS[8]   # Mitigate Industrial Spill = 9
        if trad_cost == 0.0 and bloom_cells > 0:
            trad_cost += ACTION_COSTS[4]   # Mechanical removal for minor blooms
        self.traditional_cost_estimate += trad_cost

        self.cost_ledger.append({
            "cycle":          self._cycle,
            "timestep":       observation.get("timestep"),
            "action_id":      result["action_id"],
            "action_name":    result["action_name"],
            "cost":           action_cost,
            "traditional_cost_this_tick": trad_cost,
            "health_before":  round(health_before, 1),
            "bloom_cells":    bloom_cells,
            "dead_zones":     dead_zones,
            "reasoning":      result.get("reasoning", ""),
        })

        return result

    # ── Prompt construction ───────────────────────────────────────────────────

    def _build_prompt(self, obs: Dict[str, Any]) -> str:
        drivers = obs.get("drivers", {})
        season_names = ["Winter", "Spring", "Summer", "Fall"]
        season_str = season_names[int(drivers.get("season", 1))]

        lines = [
            f"## Timestep {obs.get('timestep', '?')} | Season: {season_str}",
            "",
            "### Global Metrics",
            f"  Global health:  {obs.get('global_health', '?')}/100",
            f"  Bloom cells:    {obs.get('bloom_cells', '?')} | Hypoxic: {obs.get('hypoxic_cells', '?')} | Dead zones: {obs.get('dead_zone_cells', '?')}",
            f"  Avg algae:      {obs.get('total_algae', '?'):.0f} total | Avg DO: {obs.get('avg_do', '?'):.1f} | Avg bio: {obs.get('avg_biodiversity', '?'):.1f}",
            f"  Avg N:          {obs.get('avg_nitrogen', '?'):.1f} | Avg P: {obs.get('avg_phosphorus', '?'):.1f}",
            "",
            "### Environmental Drivers",
            f"  Temp: {drivers.get('temperature', '?'):.1f}°C | Rainfall: {drivers.get('rainfall', '?'):.2f} | Storm: {drivers.get('storm_intensity', '?'):.2f} | Fertilizer: {drivers.get('fertilizer_use', '?'):.2f}",
            "",
            "### 12 Worst Cells",
        ]

        for cell in obs.get("worst_cells", [])[:12]:
            active_names = [ACTION_NAMES.get(a, str(a)) for a in cell.get("active", [])]
            active_str   = ", ".join(active_names) if active_names else "none"
            lines.append(
                f"  ({cell['row']:2d},{cell['col']:2d}) h={cell['health']:5.1f} "
                f"alg={cell['algae']:4.1f} DO={cell['do']:4.1f} N={cell['n']:4.1f} "
                f"P={cell['p']:4.1f} ind={cell['ind']:4.1f} bio={cell['bio']:4.1f} "
                f"type={'inflow' if cell['type']==2 else 'water':6s} active=[{active_str}]"
            )

        lines += [
            "",
            "### Recent Events",
        ]
        for ev in obs.get("recent_events", [])[-5:]:
            lines.append(f"  {ev}")

        # Include real-world sensor/satellite data if available
        ext = obs.get("external_data")
        if ext:
            lines += [
                "",
                f"### Real-World Data Import ({ext.get('source', 'External')} — t={ext.get('timestep_imported', '?')})",
                "  ⚡ These are MEASURED values from sensors/satellites — treat as ground truth.",
            ]
            for k, v in ext.get("observations", {}).items():
                lines.append(f"  {k}: {v}")
            lines.append(f"  {ext.get('note', '')}")
            lines.append("  → Prioritise cost-efficient interventions that address the measured conditions above.")

        lines += [
            "",
            "### Your Running Research Brief",
            self.research_brief[:self.MAX_BRIEF_CHARS],
            "",
            "Select the MOST COST-EFFICIENT intervention for this timestep. Return JSON only.",
        ]

        return "\n".join(lines)

    # ── Response parsing ──────────────────────────────────────────────────────

    def _parse_response(self, raw: str) -> Dict[str, Any]:
        """Parse Claude's JSON response; fall back if malformed."""
        try:
            # Strip markdown code fences if Claude adds them despite instructions
            text = raw.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            data = json.loads(text.strip())

            action_id = int(data.get("action_id", 0))
            row       = int(data.get("row", 0))
            col       = int(data.get("col", 0))

            if action_id < 0 or action_id >= NUM_ACTIONS:
                action_id = 0

            brief_update = data.get("brief_update", "")
            if brief_update:
                self._update_brief(brief_update)

            result = {
                "action_id":    action_id,
                "action_name":  ACTION_NAMES.get(action_id, "Unknown"),
                "row":          row,
                "col":          col,
                "reasoning":    data.get("reasoning", ""),
                "brief_update": brief_update,
            }
            self._last_action = result
            return result
        except Exception as exc:
            return self._fallback(f"JSON parse error: {exc}")

    def _update_brief(self, update: str) -> None:
        """Append a new finding to the running research brief."""
        separator = f"\n\n### Cycle {self._cycle} Update\n"
        self.research_brief += separator + update
        # Trim to stay within LLM context budget
        if len(self.research_brief) > 6000:
            lines = self.research_brief.splitlines()
            # Keep first 20 lines (initial assessment + hypotheses) + last 40
            self.research_brief = "\n".join(lines[:20] + ["...(earlier entries trimmed)..."] + lines[-40:])

    def _fallback(self, reason: str) -> Dict[str, Any]:
        result = {
            "action_id":    0,
            "action_name":  "Do Nothing",
            "row":          0,
            "col":          0,
            "reasoning":    reason,
            "brief_update": "",
        }
        self._last_action = result
        return result

    @property
    def last_action(self) -> Optional[Dict]:
        return self._last_action

    @property
    def brief(self) -> str:
        return self.research_brief

    @property
    def cost_report(self) -> Dict[str, Any]:
        """Return a full cost efficiency report for the session."""
        saved = self.traditional_cost_estimate - self.total_cost
        pct_saved = (saved / self.traditional_cost_estimate * 100) if self.traditional_cost_estimate > 0 else 0.0

        action_breakdown: Dict[str, Any] = {}
        for entry in self.cost_ledger:
            name = entry["action_name"]
            if name not in action_breakdown:
                action_breakdown[name] = {"count": 0, "total_cost": 0.0}
            action_breakdown[name]["count"] += 1
            action_breakdown[name]["total_cost"] += entry["cost"]

        return {
            "summary": {
                "total_cycles":              self._cycle,
                "total_cost_used":           round(self.total_cost, 1),
                "traditional_cost_estimate": round(self.traditional_cost_estimate, 1),
                "cost_saved":                round(saved, 1),
                "percent_saved":             round(pct_saved, 1),
                "avg_cost_per_cycle":        round(self.total_cost / self._cycle, 2) if self._cycle > 0 else 0.0,
            },
            "comparison_note": (
                "Traditional reactive strategy assumes: Chemical Treatment (12) per bloom event, "
                "Aeration (8) per dead zone, Spill Mitigation (9) per industrial incident. "
                "LLM agent selects the most cost-efficient alternative each cycle."
            ),
            "action_breakdown": action_breakdown,
            "ledger": self.cost_ledger,
        }
