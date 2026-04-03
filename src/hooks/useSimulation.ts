/**
 * useSimulation — React hook that manages all simulation state and
 * communicates with the FastAPI backend.
 *
 * Agent live-mode: when agentLive=true AND isRunning=true, the agent
 * fires automatically every AGENT_INTERVAL ticks instead of plain stepOnce.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentAction,
  AgentStepResult,
  GlobalDrivers,
  SimulationState,
} from "../data/types";

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentType = "heuristic" | "llm";

export interface UseSimulationReturn {
  state:           SimulationState | null;
  isRunning:       boolean;
  isAgentRunning:  boolean;
  agentLive:       boolean;        // agent fires automatically during sim loop
  agentLiveType:   AgentType;
  agentInterval:   number;         // ticks between agent actions in live mode
  backendOnline:   boolean;
  error:           string | null;
  lastAgentAction: AgentAction | null;
  agentBrief:      string;
  healthHistory:   number[];

  setIsRunning:    (v: boolean) => void;
  setAgentLive:    (v: boolean) => void;
  setAgentLiveType:(v: AgentType) => void;
  setAgentInterval:(v: number) => void;
  stepOnce:        () => Promise<void>;
  reset:           () => Promise<void>;
  applyAction:     (actionId: number, row: number, col: number) => Promise<void>;
  updateDrivers:   (partial: Partial<GlobalDrivers>) => Promise<void>;
  runAgentStep:    (agentType: AgentType) => Promise<void>;
  runAgentAuto:    (agentType: AgentType, n?: number) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 500;   // ms between simulation ticks when running

type StateWithHistory = SimulationState & { health_history?: number[] };

function applyStateUpdate(
  data: StateWithHistory,
  setState: (s: SimulationState) => void,
  setHistory: (h: number[]) => void,
) {
  setState(data);
  if (data.health_history) setHistory(data.health_history);
}

// ─────────────────────────────────────────────────────────────────────────────

export function useSimulation(): UseSimulationReturn {
  const [state,           setState]           = useState<SimulationState | null>(null);
  const [isRunning,       setIsRunning]       = useState(false);
  const [isAgentRunning,  setIsAgentRunning]  = useState(false);
  const [agentLive,       setAgentLive]       = useState(false);
  const [agentLiveType,   setAgentLiveType]   = useState<AgentType>("heuristic");
  const [agentInterval,   setAgentInterval]   = useState(5);   // ticks
  const [backendOnline,   setBackendOnline]   = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [lastAgentAction, setLastAgentAction] = useState<AgentAction | null>(null);
  const [agentBrief,      setAgentBrief]      = useState<string>("");
  const [healthHistory,   setHealthHistory]   = useState<number[]>([]);

  // Refs so the interval callback always sees latest values without recreating
  const intervalRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCounterRef    = useRef(0);           // ticks since last agent action
  const isAgentRunningRef = useRef(false);        // sync shadow of isAgentRunning
  const agentLiveRef      = useRef(agentLive);
  const agentLiveTypeRef  = useRef(agentLiveType);
  const agentIntervalRef  = useRef(agentInterval);

  // Keep refs in sync with state
  useEffect(() => { agentLiveRef.current    = agentLive;     }, [agentLive]);
  useEffect(() => { agentLiveTypeRef.current = agentLiveType; }, [agentLiveType]);
  useEffect(() => { agentIntervalRef.current = agentInterval; }, [agentInterval]);

  // ── Backend ping ───────────────────────────────────────────────────────────
  const pingBackend = useCallback(async () => {
    try {
      await apiGet("/api/health");
      setBackendOnline(true);
      setError(null);
    } catch {
      setBackendOnline(false);
      setError("Backend offline — run: cd backend && python3 -m uvicorn main:app --reload");
    }
  }, []);

  // ── Fetch full state ───────────────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const data = await apiGet<StateWithHistory>("/api/state");
      applyStateUpdate(data, setState, setHealthHistory);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ── Step once (no agent) ──────────────────────────────────────────────────
  const stepOnce = useCallback(async () => {
    try {
      const data = await apiPost<StateWithHistory>("/api/step");
      applyStateUpdate(data, setState, setHealthHistory);
    } catch (e) {
      setError(String(e));
      setIsRunning(false);
    }
  }, []);

  // ── Internal: run one agent step and update UI ─────────────────────────────
  const _doAgentStep = useCallback(async (type: AgentType) => {
    if (isAgentRunningRef.current) return;
    isAgentRunningRef.current = true;
    setIsAgentRunning(true);
    try {
      const result = await apiPost<AgentStepResult & { brief?: string; state: StateWithHistory }>(
        "/api/agent/step",
        { agent_type: type },
      );
      applyStateUpdate(result.state, setState, setHealthHistory);
      setLastAgentAction(result.action);
      if (result.brief) setAgentBrief(result.brief);
    } catch (e) {
      setError(String(e));
    } finally {
      isAgentRunningRef.current = false;
      setIsAgentRunning(false);
    }
  }, []);

  // ── Auto-run loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }

    tickCounterRef.current = 0;

    intervalRef.current = setInterval(async () => {
      if (agentLiveRef.current && !isAgentRunningRef.current) {
        tickCounterRef.current += 1;
        if (tickCounterRef.current >= agentIntervalRef.current) {
          tickCounterRef.current = 0;
          // Agent step already includes a physics tick on the backend
          await _doAgentStep(agentLiveTypeRef.current);
          return;
        }
      }
      // Plain physics tick (no agent action)
      try {
        const data = await apiPost<StateWithHistory>("/api/step");
        applyStateUpdate(data, setState, setHealthHistory);
      } catch (e) {
        setError(String(e));
        setIsRunning(false);
      }
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, _doAgentStep]);   // deliberately excludes agentLive* — use refs instead

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(async () => {
    setIsRunning(false);
    try {
      const data = await apiPost<SimulationState>("/api/reset");
      setState(data);
      setHealthHistory([]);
      setLastAgentAction(null);
      setAgentBrief("");
      setError(null);
      tickCounterRef.current = 0;
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ── Apply manual action ───────────────────────────────────────────────────
  const applyAction = useCallback(
    async (actionId: number, row: number, col: number) => {
      try {
        const data = await apiPost<StateWithHistory>(
          "/api/action",
          { action_id: actionId, row, col },
        );
        applyStateUpdate(data, setState, setHealthHistory);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  // ── Update drivers ────────────────────────────────────────────────────────
  const updateDrivers = useCallback(async (partial: Partial<GlobalDrivers>) => {
    try {
      const data = await apiPost<SimulationState>("/api/drivers", partial);
      setState(data);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ── Manual single agent step (from button) ────────────────────────────────
  const runAgentStep = useCallback(async (agentType: AgentType) => {
    await _doAgentStep(agentType);
  }, [_doAgentStep]);

  // ── Manual batch agent steps ──────────────────────────────────────────────
  const runAgentAuto = useCallback(async (agentType: AgentType, n = 5) => {
    if (isAgentRunningRef.current) return;
    isAgentRunningRef.current = true;
    setIsAgentRunning(true);
    try {
      const result = await apiPost<{
        action: AgentAction;
        state: StateWithHistory;
        brief?: string;
      }>(`/api/agent/auto?n=${n}`, { agent_type: agentType });
      applyStateUpdate(result.state, setState, setHealthHistory);
      setLastAgentAction(result.action);
      if (result.brief) setAgentBrief(result.brief);
    } catch (e) {
      setError(String(e));
    } finally {
      isAgentRunningRef.current = false;
      setIsAgentRunning(false);
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    pingBackend().then(fetchState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    isRunning,
    isAgentRunning,
    agentLive,
    agentLiveType,
    agentInterval,
    backendOnline,
    error,
    lastAgentAction,
    agentBrief,
    healthHistory,
    setIsRunning,
    setAgentLive,
    setAgentLiveType,
    setAgentInterval,
    stepOnce,
    reset,
    applyAction,
    updateDrivers,
    runAgentStep,
    runAgentAuto,
  };
}
