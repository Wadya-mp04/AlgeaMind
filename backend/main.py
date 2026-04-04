"""
AlgaeMind FastAPI backend.

Run from the backend/ directory:
    uvicorn main:app --reload --port 8000

Endpoints
---------
GET  /api/state           → current simulation snapshot
POST /api/step            → advance one tick
POST /api/reset           → reset to initial eutrophic state
POST /api/action          → apply intervention + step
POST /api/drivers         → update environmental drivers
POST /api/agent/step      → run one agent step (heuristic | llm | rl)
POST /api/agent/auto      → run N agent steps
GET  /api/agent/brief     → get LLM agent research brief
GET  /api/export          → download full session log as JSON
GET  /api/health          → liveness probe
"""
from __future__ import annotations

import os
from typing import Any, Dict, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from simulation.environment import GridEnvironment
from agent.heuristic_agent import HeuristicAgent
from agent.llm_agent import LLMAgent
from agent.rl_agent import RLAgent

# ─────────────────────────────────────────────────────────────────────────────
# Application setup
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="TrackAlgae Simulation API",
    description="2D grid simulation for Harmful Algal Bloom mitigation.",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Global simulation state (single session — fine for hackathon demo)
# ─────────────────────────────────────────────────────────────────────────────

env             = GridEnvironment()
heuristic_agent = HeuristicAgent()
llm_agent       = LLMAgent()
rl_agent        = RLAgent()

# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

class ActionRequest(BaseModel):
    action_id: int = Field(..., ge=0, le=9, description="Action index 0–9")
    row:       int = Field(..., ge=0, description="Target row")
    col:       int = Field(..., ge=0, description="Target column")


class DriversRequest(BaseModel):
    temperature:     Optional[float] = Field(None, ge=0, le=45)
    rainfall:        Optional[float] = Field(None, ge=0, le=1)
    storm_intensity: Optional[float] = Field(None, ge=0, le=1)
    fertilizer_use:  Optional[float] = Field(None, ge=0, le=1)
    season:          Optional[int]   = Field(None, ge=0, le=3)


class FlowConfigRequest(BaseModel):
    inflow_north:  Optional[bool] = None
    inflow_west:   Optional[bool] = None
    inflow_east:   Optional[bool] = None
    outflow_south: Optional[bool] = None


class ContaminantConfigRequest(BaseModel):
    nutrient_runoff:      Optional[bool] = None
    industrial_discharge: Optional[bool] = None
    random_spills:        Optional[bool] = None
    heavy_rain_events:    Optional[bool] = None


class AgentStepRequest(BaseModel):
    agent_type: Literal["heuristic", "llm", "rl"] = "heuristic"


class EventRequest(BaseModel):
    event_type: Literal[
        "industrial_spill", "heavy_rain", "heat_wave", "drought", "fertilizer_runoff"
    ]


class ExternalDataRequest(BaseModel):
    """Accept real-world measurements from USGS / NASA to seed the simulation."""
    temperature:      Optional[float] = Field(None, ge=0,  le=45,  description="Water/air temp °C")
    rainfall:         Optional[float] = Field(None, ge=0,  le=1,   description="Normalised rainfall 0-1")
    storm_intensity:  Optional[float] = Field(None, ge=0,  le=1)
    fertilizer_use:   Optional[float] = Field(None, ge=0,  le=1)
    avg_nitrogen:     Optional[float] = Field(None, ge=0,  le=100, description="Observed avg N (µg/L mapped 0-100)")
    avg_phosphorus:   Optional[float] = Field(None, ge=0,  le=100, description="Observed avg P (µg/L mapped 0-100)")
    avg_do:           Optional[float] = Field(None, ge=0,  le=100, description="Observed avg dissolved oxygen 0-100")
    industrial_load:  Optional[float] = Field(None, ge=0,  le=100, description="Industrial pollution index 0-100")
    source:           Optional[str]   = Field(None, description="Data source label e.g. USGS site 01234567")


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health_check() -> Dict[str, str]:
    """Liveness probe for the frontend to confirm the backend is reachable."""
    return {"status": "ok", "timestep": str(env.drivers.timestep)}


@app.get("/")
def root() -> Dict[str, str]:
    """Friendly root endpoint so opening backend URL does not return 404."""
    return {
        "service": "TrackAlgae Simulation API",
        "status": "ok",
        "health": "/api/health",
        "docs": "/docs",
    }


@app.get("/api/state")
def get_state() -> Dict[str, Any]:
    """Return the current full simulation snapshot."""
    return env.get_state()


@app.post("/api/step")
def step_simulation() -> Dict[str, Any]:
    """Advance the simulation by one tick (no action)."""
    env.step()
    return env.get_state()


@app.post("/api/reset")
def reset_simulation() -> Dict[str, Any]:
    """Reset the simulation to initial eutrophic state."""
    env.reset()
    heuristic_agent.__init__()
    llm_agent.__init__()
    rl_agent.__init__()
    return env.get_state()


@app.post("/api/action")
def apply_action(req: ActionRequest) -> Dict[str, Any]:
    """Apply an intervention at (row, col) and advance one tick."""
    rows = len(env.grid)
    cols = len(env.grid[0]) if rows else 0
    if req.row >= rows or req.col >= cols:
        raise HTTPException(status_code=400, detail="Cell coordinates out of range.")
    env.apply_action(req.action_id, req.row, req.col)
    return env.get_state()


@app.post("/api/drivers")
def update_drivers(req: DriversRequest) -> Dict[str, Any]:
    """Update one or more environmental driver values."""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    env.update_drivers(**updates)
    return env.get_state()


@app.post("/api/flows")
def update_flows(req: FlowConfigRequest) -> Dict[str, Any]:
    """Enable/disable inflow/outflow channels for scenario configuration."""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    env.update_flow_config(**updates)
    return env.get_state()


@app.post("/api/contaminants")
def update_contaminants(req: ContaminantConfigRequest) -> Dict[str, Any]:
    """Enable/disable contaminant sources used by the simulation."""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    env.update_contaminant_config(**updates)
    return env.get_state()


@app.post("/api/agent/step")
def agent_step(req: AgentStepRequest) -> Dict[str, Any]:
    """
    Let the selected agent choose and apply one intervention, then step.
    Returns the chosen action metadata alongside the new simulation state.
    """
    obs = env.get_agent_observation()

    if req.agent_type == "llm":
        action = llm_agent.select_action(obs)
    elif req.agent_type == "rl":
        action = rl_agent.select_action(obs)
    else:
        action = heuristic_agent.select_action(obs)

    env.apply_action(action["action_id"], action["row"], action["col"])
    state = env.get_state()

    return {
        "action": action,
        "state":  state,
        "brief":  llm_agent.brief if req.agent_type == "llm" else None,
        "rl_stats": action.get("rl_stats") if req.agent_type == "rl" else None,
    }


@app.post("/api/agent/auto")
def agent_auto_steps(
    req: AgentStepRequest,
    n: int = 5,
) -> Dict[str, Any]:
    """
    Run n agent steps in a row (max 20 to avoid long-running requests).
    Returns only the final state after all steps.
    """
    n = min(n, 20)
    last_action = None
    for _ in range(n):
        obs = env.get_agent_observation()
        if req.agent_type == "llm":
            action = llm_agent.select_action(obs)
        elif req.agent_type == "rl":
            action = rl_agent.select_action(obs)
        else:
            action = heuristic_agent.select_action(obs)
        env.apply_action(action["action_id"], action["row"], action["col"])
        last_action = action

    state = env.get_state()
    return {
        "action":    last_action,
        "state":     state,
        "steps_run": n,
        "brief":     llm_agent.brief if req.agent_type == "llm" else None,
        "rl_stats":  last_action.get("rl_stats") if req.agent_type == "rl" and last_action else None,
    }


@app.get("/api/agent/brief")
def get_agent_brief() -> Dict[str, str]:
    """Return the LLM agent's current research brief."""
    return {"brief": llm_agent.brief}


@app.get("/api/agent/cost_report")
def get_cost_report() -> Dict[str, Any]:
    """Return the LLM agent's full cost efficiency report for this session."""
    return llm_agent.cost_report


@app.get("/api/agent/rl_stats")
def get_rl_stats() -> Dict[str, Any]:
    """Return the RL agent's current training statistics."""
    return {
        "epsilon":           round(rl_agent.epsilon, 3),
        "q_table_size":      len(rl_agent.q_table),
        "total_steps":       rl_agent.total_steps,
        "cumulative_reward": round(rl_agent.cumulative_reward, 1),
    }


@app.post("/api/event")
def trigger_event(req: EventRequest) -> Dict[str, Any]:
    """Manually trigger an environmental event (spill, rain, heat wave, etc.)."""
    message = env.trigger_event(req.event_type)
    state   = env.get_state()
    return {"message": message, "state": state}


@app.post("/api/external_data")
def apply_external_data(req: ExternalDataRequest) -> Dict[str, Any]:
    """
    Seed the simulation with real-world observations from USGS / NASA.
    Driver fields update immediately; water-quality fields are blended into
    the current inflow and interior cells.
    """
    import math

    # ── 1. Update global drivers ───────────────────────────────────────────
    driver_updates: Dict[str, float] = {}
    if req.temperature     is not None: driver_updates["temperature"]     = req.temperature
    if req.rainfall        is not None: driver_updates["rainfall"]        = req.rainfall
    if req.storm_intensity is not None: driver_updates["storm_intensity"] = req.storm_intensity
    if req.fertilizer_use  is not None: driver_updates["fertilizer_use"]  = req.fertilizer_use
    if driver_updates:
        env.update_drivers(**driver_updates)

    # ── 2. Blend water-quality observations into inflow cells ─────────────
    from config.constants import GRID_ROWS, GRID_COLS, CELL_INFLOW, CELL_WATER
    blend = 0.4  # blend factor: 40 % observed, 60 % existing
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            cell = env.grid[r][c]
            if cell.cell_type not in (CELL_INFLOW, CELL_WATER):
                continue
            if req.avg_nitrogen    is not None:
                cell.nitrogen    = cell.nitrogen    * (1 - blend) + req.avg_nitrogen    * blend
            if req.avg_phosphorus  is not None:
                cell.phosphorus  = cell.phosphorus  * (1 - blend) + req.avg_phosphorus  * blend
            if req.avg_do          is not None:
                cell.dissolved_oxygen = cell.dissolved_oxygen * (1 - blend) + req.avg_do * blend
            if req.industrial_load is not None and cell.cell_type == CELL_INFLOW:
                cell.industrial  = cell.industrial  * (1 - blend) + req.industrial_load * blend

    source_label = req.source or "External data"
    # Store context so the LLM agent can reference it in decision-making
    env.external_data_context = {
        "source": source_label,
        "timestep_imported": env.drivers.timestep,
        "observations": {k: v for k, v in req.model_dump().items() if v is not None and k != "source"},
        "note": "Real-world measurements from external sensor/satellite data. Weight these values heavily when assessing current conditions and selecting cost-efficient interventions.",
    }
    env._log(f"📡 {source_label} imported — drivers and water quality updated.")
    return {"message": f"{source_label} applied successfully.", "state": env.get_state()}


@app.get("/api/export")
def export_session() -> Dict[str, Any]:
    """
    Export the full current session as a JSON blob.
    Includes simulation state, health history, event log, and intervention log.
    """
    state = env.get_state()
    return {
        "export_version":    "1.2",
        "timestep":          env.drivers.timestep,
        "current_state":     state,
        "health_history":    env._health_history,
        "all_events":        list(env._recent_events),
        "all_interventions": list(env._recent_interventions),
        "llm_cost_report":   llm_agent.cost_report,
        "rl_stats": {
            "epsilon":           round(rl_agent.epsilon, 3),
            "q_table_size":      len(rl_agent.q_table),
            "total_steps":       rl_agent.total_steps,
            "cumulative_reward": round(rl_agent.cumulative_reward, 1),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Dev entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
