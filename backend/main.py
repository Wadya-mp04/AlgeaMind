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
    title="AlgaeMind Simulation API",
    description="2D grid simulation for Harmful Algal Bloom mitigation.",
    version="1.1.0",
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


class AgentStepRequest(BaseModel):
    agent_type: Literal["heuristic", "llm", "rl"] = "heuristic"


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health_check() -> Dict[str, str]:
    """Liveness probe for the frontend to confirm the backend is reachable."""
    return {"status": "ok", "timestep": str(env.drivers.timestep)}


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


@app.get("/api/agent/rl_stats")
def get_rl_stats() -> Dict[str, Any]:
    """Return the RL agent's current training statistics."""
    return {
        "epsilon":           round(rl_agent.epsilon, 3),
        "q_table_size":      len(rl_agent.q_table),
        "total_steps":       rl_agent.total_steps,
        "cumulative_reward": round(rl_agent.cumulative_reward, 1),
    }


@app.get("/api/export")
def export_session() -> Dict[str, Any]:
    """
    Export the full current session as a JSON blob.
    Includes simulation state, health history, event log, and intervention log.
    """
    state = env.get_state()
    return {
        "export_version":    "1.1",
        "timestep":          env.drivers.timestep,
        "current_state":     state,
        "health_history":    env._health_history,
        "all_events":        list(env._recent_events),
        "all_interventions": list(env._recent_interventions),
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
