"""
LLMAgent — Claude-powered environmental scientist agent for TrackAlgae.

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

from config.constants import (
    ACTION_NAMES, ACTION_DESCRIPTIONS, ACTION_COSTS, NUM_ACTIONS,
    LAKE_AREA_M2, LAKE_AREA_ACRES,
)

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a limnologist agent managing a 2D lake grid simulation.
Cell variables: algae, nitrogen, phosphorus, dissolved_oxygen, industrial, biodiversity (all 0-100).
Your goal: maximise long-term ecosystem health at minimum cost.

Interventions (id | cost | notes):
  0 Do Nothing           (0)  — use when health>70 and no dead zones
  1 Reduce Nutrient Inflow (5 | 24t) — target inflow cells with high N/P
  2 Aerate              (8 | 8t)  — ONLY for dead zones (DO≤5); expensive, treats symptoms not cause
  3 Increase Circulation (6 | 16t) — mild DO/dilution boost
  4 Mechanical Removal  (7 | instant) — removes 65% algae; good for localised severe blooms
  5 Add Shading          (4 | 20t) — cheapest bloom suppression; prefer over aeration
  6 Biological Control  (10 | 28t) — slow but sustainable; best once nutrients are managed
  7 Chemical Treatment  (12 | instant) — LAST RESORT: 80% algae kill but adds toxicity and kills biodiversity
  8 Mitigate Spill       (9 | instant) — required when industrial>30
  9 Wetland Filtration  (11 | 32t) — best long-term nutrient control at inflows

Decision hierarchy (stop at first matching condition):
  1. industrial>30 at any cell → action 8 at that cell
  2. dead zone (DO≤5) → action 2 (aerate), NOT shading
  3. inflow N>50 or P>30 → action 1 or 9 at nearest inflow
  4. bloom spreading (algae>35, multiple cells) → action 5 (shading), cheapest sustained
  5. severe localised bloom (algae>65, ≤4 cells) → action 4 (mechanical)
  6. health recovering, high nutrients remain → action 6 (bio-control) for long-term suppression
  7. health>70, no blooms → action 0 (do nothing)
  NEVER use action 7 unless actions 4 and 6 are already active AND DO is still crashing.
  Avoid action 2 (aerate) unless DO≤5 — it's expensive and doesn't fix nutrient causes.

Respond ONLY with valid JSON (no markdown):
{"action_id":<int>,"row":<int>,"col":<int>,"reasoning":"<1-2 sentences>","brief_update":"<bullet>"}
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
                    max_tokens=256,
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
            f"t={obs.get('timestep','?')} {season_str} | health={obs.get('global_health','?'):.0f} "
            f"blooms={obs.get('bloom_cells','?')} hypoxic={obs.get('hypoxic_cells','?')} dead={obs.get('dead_zone_cells','?')}",
            f"DO={obs.get('avg_do','?'):.1f} N={obs.get('avg_nitrogen','?'):.1f} P={obs.get('avg_phosphorus','?'):.1f} "
            f"bio={obs.get('avg_biodiversity','?'):.1f} temp={drivers.get('temperature','?'):.1f}°C "
            f"rain={drivers.get('rainfall','?'):.2f} fert={drivers.get('fertilizer_use','?'):.2f}",
            "",
            "Worst cells (row,col health alg DO N P ind active):",
        ]

        for cell in obs.get("worst_cells", [])[:8]:
            active_ids = cell.get("active", [])
            active_str = ",".join(str(a) for a in active_ids) if active_ids else "-"
            tp = "inflow" if cell["type"] == 2 else ("out" if cell["type"] == 3 else "w")
            lines.append(
                f"  {cell['row']},{cell['col']} h={cell['health']:.0f} "
                f"alg={cell['algae']:.0f} DO={cell['do']:.0f} N={cell['n']:.0f} "
                f"P={cell['p']:.0f} ind={cell['ind']:.0f} [{tp}] act=[{active_str}]"
            )

        recent = obs.get("recent_events", [])[-3:]
        if recent:
            lines += ["", "Events: " + " | ".join(e.split("]")[-1].strip() for e in recent)]

        ext = obs.get("external_data")
        if ext:
            lines += [f"External({ext.get('source','?')}): " +
                      " ".join(f"{k}={v}" for k, v in ext.get("observations", {}).items())]

        lines += ["", f"Brief: {self.research_brief[:1500]}", "", "Return JSON only."]

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

        # Count how many times each real-world-equivalent action was used
        chem_uses = action_breakdown.get("Chemical Treatment", {}).get("count", 0)
        aerate_uses = action_breakdown.get("Aerate Region", {}).get("count", 0)
        bio_uses = action_breakdown.get("Biological Control", {}).get("count", 0)
        shading_uses = action_breakdown.get("Add Shading", {}).get("count", 0)
        mechanical_uses = action_breakdown.get("Mechanical Algae Removal", {}).get("count", 0)
        wetland_uses = action_breakdown.get("Wetland Filtration", {}).get("count", 0)
        nutrient_uses = action_breakdown.get("Reduce Nutrient Inflow", {}).get("count", 0)

        # Real-world cost benchmarks (2020 USD, per treatment event / per ~0.5 acre area)
        # Sources: ITRC HCB-1 C.2, EPA 2015 nutrient economics report, Solitude Lake Management
        # Each simulated cell = CELL_AREA_M2 (50 m²) ≈ 0.012 acres
        # Full lake = LAKE_AREA_M2 (28,000 m²) = LAKE_AREA_ACRES (~6.9 acres)
        # Action radius covers ~13-28 cells ≈ 0.2-0.4 acres
        REAL_WORLD_COSTS = {
            "chemical_algaecide_per_event": {"low": 500, "mid": 933, "high": 2000,
                "note": "Algaecide/alum per acre; ~$200-$800 per event at this scale (ITRC HCB-1)"},
            "aeration_system_annual":       {"low": 11000, "high": 50000,
                "note": "Aeration system install + annual ops; $11K-$50K/year (Wagner 2015)"},
            "biomanipulation_per_event":    {"low": 300, "mid": 800, "high": 3000,
                "note": "Biological control / zooplankton stocking per event"},
            "mechanical_harvest_per_acre":  {"low": 400, "mid": 1200, "high": 3000,
                "note": "Mechanical algae harvesting per acre per treatment"},
            "constructed_wetland_capital":  {"low": 5000, "high": 25000,
                "note": "Constructed wetland capital cost per acre of treatment area"},
            "nutrient_mgmt_per_season":     {"low": 200, "mid": 600, "high": 1500,
                "note": "Nutrient management / BMP implementation per season"},
        }

        # Estimate real-world equivalent cost for what the agent did this session
        # Using mid-range values scaled to event count
        rw_chem   = chem_uses      * REAL_WORLD_COSTS["chemical_algaecide_per_event"]["mid"]
        rw_aerate = aerate_uses    * 150   # per-event cost of running aeration (fraction of annual)
        rw_bio    = bio_uses       * REAL_WORLD_COSTS["biomanipulation_per_event"]["mid"]
        rw_mech   = mechanical_uses * REAL_WORLD_COSTS["mechanical_harvest_per_acre"]["mid"] * 0.3
        rw_wetland = wetland_uses  * 800   # annualised cost fraction per deployment
        rw_shading = shading_uses  * 200   # shade curtain deployment per event
        rw_nutrient = nutrient_uses * REAL_WORLD_COSTS["nutrient_mgmt_per_season"]["mid"]
        rw_agent_total = rw_chem + rw_aerate + rw_bio + rw_mech + rw_wetland + rw_shading + rw_nutrient

        # Traditional (chemical-heavy) baseline real-world equivalent
        trad_event_count = max(1, self._cycle // 5)  # assume reactive treatment every ~5 ticks
        rw_traditional = (trad_event_count *
                          REAL_WORLD_COSTS["chemical_algaecide_per_event"]["mid"] +
                          trad_event_count * 0.5 * 150)  # + frequent aeration
        rw_saved = rw_traditional - rw_agent_total

        return {
            "summary": {
                "total_cycles":              self._cycle,
                "total_cost_used":           round(self.total_cost, 1),
                "traditional_cost_estimate": round(self.traditional_cost_estimate, 1),
                "cost_saved":                round(saved, 1),
                "percent_saved":             round(pct_saved, 1),
                "avg_cost_per_cycle":        round(self.total_cost / self._cycle, 2) if self._cycle > 0 else 0.0,
            },
            "real_world_comparison": {
                "agent_estimated_usd":       round(rw_agent_total),
                "traditional_estimated_usd": round(rw_traditional),
                "estimated_savings_usd":     round(rw_saved),
                "breakdown_usd": {
                    "chemical_treatment":    round(rw_chem),
                    "aeration":              round(rw_aerate),
                    "biological_control":    round(rw_bio),
                    "mechanical_removal":    round(rw_mech),
                    "wetland_filtration":    round(rw_wetland),
                    "shading":               round(rw_shading),
                    "nutrient_management":   round(rw_nutrient),
                },
                "benchmarks":  REAL_WORLD_COSTS,
                "note": (
                    f"Lake area: {LAKE_AREA_ACRES} acres ({LAKE_AREA_M2:,} m²) — "
                    "each grid cell = 50 m². "
                    "Real-world costs in 2020 USD per treatment event. "
                    "Sources: ITRC HCB-1 C.2, EPA Nutrient Economics Report 2015, Wagner (2015). "
                    "USD estimates use mid-range benchmarks scaled to event count."
                ),
            },
            "comparison_note": (
                "Traditional reactive strategy assumes: Chemical Treatment per bloom event, "
                "Aeration per dead zone, Spill Mitigation per industrial incident. "
                "Agent selects most cost-efficient alternative each cycle, preferring "
                "shading, bio-control, and nutrient reduction over expensive reactive treatments."
            ),
            "action_breakdown": action_breakdown,
            "ledger": self.cost_ledger,
        }
