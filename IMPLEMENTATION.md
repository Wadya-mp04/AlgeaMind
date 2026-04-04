# AlgaeMind — Implementation Notes

## What Changed

Complete architectural rewrite of the frontend and addition of a Python simulation backend.
The old Leaflet-based river-network dashboard has been replaced with a 2D grid sandbox.

---

## Architecture

```
AlgeaMind/
├── backend/                        # Python simulation engine
│   ├── config/constants.py         # All parameters (grid size, thresholds, coefficients)
│   ├── simulation/
│   │   ├── cell_state.py           # CellState + GlobalDrivers dataclasses
│   │   ├── physics.py              # Pure physics functions (growth, O2, spread…)
│   │   └── environment.py          # GridEnvironment — main simulation class
│   ├── agent/
│   │   ├── heuristic_agent.py      # Rule-based priority agent (no API key needed)
│   │   └── llm_agent.py            # Claude-powered environmental scientist agent
│   ├── main.py                     # FastAPI app with all REST endpoints
│   └── requirements.txt
│
├── src/                            # React + TypeScript frontend
│   ├── data/types.ts               # TypeScript interfaces + colour helpers
│   ├── hooks/useSimulation.ts      # State management + API calls
│   ├── components/
│   │   ├── GridCanvas.tsx          # HTML5 Canvas bird's-eye 2D grid renderer
│   │   ├── AgentPanel.tsx          # AI agent controls + event log
│   │   ├── ControlPanel.tsx        # Environmental drivers + action selector
│   │   └── StatsPanel.tsx          # Metrics, health gauge, trend chart
│   └── App.tsx                     # Root layout (3-column)
│
└── vite.config.ts                  # Added /api proxy → localhost:8000
```

---

## How to Run

### 1. Backend (Python ≥ 3.10)

```bash
cd AlgeaMind/backend
pip install -r requirements.txt
# Add ANTHROPIC_API_KEY to .env if you want the Claude agent
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd AlgeaMind
npm install
npm run dev        # opens on http://localhost:3000
```

Both must run simultaneously. Vite proxies `/api/*` → `localhost:8000` automatically.

---

## Grid Design

**20 rows × 28 columns** lake / reservoir.

| Zone | Cells | Purpose |
|------|-------|---------|
| Shore (land) | Row 0, Row 19, Col 0, Col 27 | Inert boundary |
| North inflow | Row 0, cols 9–13 | Agricultural runoff (N/P driven by rainfall × fertilizer) |
| West inflow | Rows 5–9, col 0 | River input |
| East inflow | Rows 10–14, col 27 | Industrial discharge (adds industrial pollution each tick) |
| South outflow | Row 19, cols 11–16 | Lake outlet |
| Interior | All other cells | Water — simulation active |

---

## Simulation Physics (per tick)

Each tick = ~6 hours of real time.

1. **Nutrient inflow** — rainfall × fertilizer_use drives N/P + sediment at inflow cells.
   Industrial inflow adds pollution at east edge each tick.

2. **Algae growth** — logistic model:
   `growth = BASE_RATE × temp_factor × nutrient_factor × light_factor × algae × (1 − algae/100)`
   - P is the primary limiting nutrient (Liebig's Law for freshwater)
   - Sediment reduces light penetration
   - Shading intervention halves light factor

3. **Oxygen dynamics** — algae–DO coupling:
   - algae < 30 → slight O2 production (photosynthesis > respiration)
   - algae 30–65 → net O2 consumption
   - algae > 65 → severe O2 crash (decomposition dominates)
   - Atmospheric reaeration proportional to flow × (100 − DO)

4. **Biodiversity** — relaxes toward a target determined by DO, algae, and industrial load.
   Dead zones (DO ≤ 5) collapse biodiversity toward 0.

5. **Algae spread** — 2-buffer diffusion to 4-connected water neighbours (10 % per tick).

6. **Sediment settling** — natural settling rate; storms slow settling.

7. **Decay** — nutrients, industrial pollution decay each tick at low rates.

---

## Actions (9 interventions + do-nothing)

| ID | Name | Effect | Duration |
|----|------|--------|----------|
| 0 | Do Nothing | — | — |
| 1 | Reduce Nutrient Inflow | 60 % N/P interception at inflow cells in radius | 24 ticks |
| 2 | Aerate | +18 DO instant, enhanced reaeration | 8 ticks |
| 3 | Increase Circulation | +0.3 flow in radius | 16 ticks |
| 4 | Mechanical Removal | –65 % algae instant in radius | one-off |
| 5 | Add Shading | halves algae growth rate | 20 ticks |
| 6 | Biological Control | –5 % algae/tick in radius | 28 ticks |
| 7 | Chemical Treatment | –80 % algae instant but +28 industrial | one-off |
| 8 | Mitigate Industrial Spill | –70 % industrial instant | one-off |
| 9 | Wetland Filtration | –55 % N, –65 % P at inflow cells | 32 ticks |

Key trade-off: **Chemical Treatment** is fast but raises toxicity and harms biodiversity.
**Wetland Filtration** is slow but addresses the root cause.

---

## AI Agents

### Heuristic Agent
Priority-ordered rule-based system:
1. Industrial spill detected → mitigate spill
2. Dead zone → emergency aeration
3. Severe bloom (localised) → chemical treatment
4. Severe bloom (widespread) → mechanical removal
5. Hypoxia → aerate or circulate
6. Active bloom → biological control
7. High nutrients at inflow → nutrient reduction or wetland filtration
8. Preventive circulation → if DO drifting low

### LLM Agent (Claude claude-sonnet-4-6)
Receives compact observation (metrics + 12 worst cells + driver state) and returns:
```json
{
  "action_id": 2,
  "row": 5,
  "col": 14,
  "reasoning": "Dead zone developing in sector 5,14...",
  "brief_update": "## Cycle 7\n- Aeration effective at DO recovery..."
}
```
Maintains a growing **Research Brief** across cycles — the agent accumulates
hypotheses and findings, mimicking a field ecologist's scientific process.

Requires `ANTHROPIC_API_KEY` in `backend/.env`.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness probe |
| GET | `/api/state` | Full simulation snapshot |
| POST | `/api/step` | Advance one tick |
| POST | `/api/reset` | Reset to eutrophic state |
| POST | `/api/action` | Apply intervention + step |
| POST | `/api/drivers` | Update environmental drivers |
| POST | `/api/agent/step` | Agent chooses + applies one action |
| POST | `/api/agent/auto?n=5` | Agent runs n steps |
| GET | `/api/agent/brief` | Get LLM research brief |

---

## Visual Encoding

| State variable | Colour contribution |
|---|---|
| Algae | +Green (intensifies with severity; bloom border pulse) |
| Industrial | +Red-purple |
| Sediment | +Brown |
| Low DO | Darkening (DO → 0 = near black) |
| Dead zone | Black overlay + red X |
| Land | Dark forest green |
| Active intervention | Coloured dot (top-right corner of cell) |
| Inflow | Blue arrow |

---

## Design Decisions

- **Python backend** for the simulation: gives us real data structures, clean physics, and easy LLM integration without browser API restrictions.
- **HTTP polling** (not WebSocket): simpler for a hackathon; the frontend polls at 400 ms intervals during auto-run.
- **Logistic algae growth** instead of linear: prevents unbounded runaway, more realistic.
- **P-limited freshwater model** (65 % weight on P, 35 % on N): scientifically grounded (Liebig's Law).
- **Per-cell active intervention tracking**: allows spatial targeting and overlapping effects.
- **Health score = DO (30 %) + algae (35 %) + biodiversity (20 %) + nutrients (10 %) + industrial (5 %)**: weights reflect real EPA eutrophication priority ordering.
