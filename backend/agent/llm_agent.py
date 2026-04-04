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
from typing import Any, Dict, Optional

import anthropic
from dotenv import load_dotenv

from config.constants import ACTION_NAMES, ACTION_DESCRIPTIONS, NUM_ACTIONS

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
ecosystem health, balancing:
  - Lower algae bloom severity
  - Healthy dissolved oxygen (avoid hypoxia / dead zones)
  - Lower industrial / toxin load
  - Controlled nutrient levels
  - Higher biodiversity

Available interventions (action_id):
  0  Do Nothing
  1  Reduce Nutrient Inflow  (radius 3, 24 ticks) — blocks runoff at inflow cells
  2  Aerate Region           (radius 2, 8 ticks)  — boosts DO immediately
  3  Increase Circulation    (radius 3, 16 ticks) — improves reaeration + dilution
  4  Mechanical Algae Removal (radius 2, instant) — removes 65% algae directly
  5  Add Shading             (radius 2, 20 ticks) — limits photosynthesis
  6  Biological Control      (radius 3, 28 ticks) — slow sustained algae reduction
  7  Chemical Treatment      (radius 2, instant)  — 80% algae kill + raises toxicity
  8  Mitigate Industrial Spill (radius 2, instant) — removes 70% industrial pollution
  9  Wetland Filtration      (radius 3, 32 ticks) — filters inflow nutrients

Important trade-offs:
  - Chemical treatment is fast but raises industrial pollution and harms biodiversity.
  - Aeration helps DO but does not address nutrient root causes.
  - Biological control is slow but sustainable.
  - If nutrients are not controlled, blooms will return after any intervention.
  - Doing nothing when metrics are healthy preserves resources.

You will respond ONLY with a valid JSON object — no prose, no markdown fences:
{
  "action_id":   <integer 0-9>,
  "row":         <integer>,
  "col":         <integer>,
  "reasoning":   "<1-3 sentence scientific explanation>",
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

    def select_action(self, observation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Call Claude to select an intervention.  Falls back to heuristic if
        the API key is missing or the call fails.
        """
        self._cycle += 1

        if self.client is None:
            return self._fallback("ANTHROPIC_API_KEY not set — falling back to heuristic observation.")

        prompt = self._build_prompt(observation)
        try:
            message = self.client.messages.create(
                model=self.MODEL,
                max_tokens=512,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = message.content[0].text.strip()
            return self._parse_response(raw)
        except Exception as exc:
            return self._fallback(f"LLM call failed: {exc}")

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

        lines += [
            "",
            "### Your Running Research Brief",
            self.research_brief[:self.MAX_BRIEF_CHARS],
            "",
            "Choose the single best intervention for this timestep.  Return JSON only.",
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
