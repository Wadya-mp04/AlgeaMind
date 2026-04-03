import { InterventionType, INTERVENTIONS } from './interventions';

export type ContaminantType = 'Nitrogen' | 'Phosphorus' | 'Industrial' | 'Sediment' | 'Algae';

export interface ContaminantProperties {
  id: ContaminantType;
  name: string;
  color: string;
  decayRate: number;   // Base decay per step
  mobility: number;    // How fast it moves downstream (0-1)
  impactDescription: string;
  source: 'USGS' | 'EPA' | 'NASA';
}

export const CONTAMINANTS: Record<ContaminantType, ContaminantProperties> = {
  Nitrogen: {
    id: 'Nitrogen',
    name: 'Nitrogen Fertilizer',
    color: '#10b981',
    decayRate: 0.05,
    mobility: 0.8,
    impactDescription: 'Causes algal blooms and hypoxia in estuaries.',
    source: 'USGS',
  },
  Phosphorus: {
    id: 'Phosphorus',
    name: 'Phosphorus Fertilizer',
    color: '#8b5cf6',
    decayRate: 0.02,
    mobility: 0.4,
    impactDescription: 'Primary driver of freshwater eutrophication.',
    source: 'EPA',
  },
  Industrial: {
    id: 'Industrial',
    name: 'Industrial Waste',
    color: '#f43f5e',
    decayRate: 0.01,
    mobility: 0.9,
    impactDescription: 'Toxic to aquatic life and human health.',
    source: 'EPA',
  },
  Sediment: {
    id: 'Sediment',
    name: 'Sediment Runoff',
    color: '#f59e0b',
    decayRate: 0.1,
    mobility: 0.2,
    impactDescription: 'Increases turbidity and smothers habitats.',
    source: 'NASA',
  },
  Algae: {
    id: 'Algae',
    name: 'Algae Bloom',
    color: '#a3e635',
    decayRate: 0.03,
    mobility: 0.1,
    impactDescription: 'Depletes oxygen (hypoxia) and blocks sunlight.',
    source: 'EPA',
  },
};

export interface RiverNode {
  id: string;
  lat: number;
  lng: number;
  downstreamId: string | null;
  name: string;
  type: 'headwater' | 'confluence' | 'mouth' | 'lake';
}

export interface ActiveIntervention {
  interventionId: InterventionType;
  nodeId: string;
  startTime: number;
  duration: number;
}

export interface SimulationState {
  rainfall: number;
  fertilizer: number;
  stormIntensity: number;
  timeStep: number;
  activeSpills: { nodeId: string; amount: number; startTime: number; type: ContaminantType }[];
  activeInterventions: ActiveIntervention[];
  nodeConcentrations: Record<string, Record<ContaminantType, number>>;
  selectedContaminant: ContaminantType;
}

/**
 * Compute a 0-100 watershed health score.
 * Mirrors ReefMind's reef health score — higher is better.
 *
 * Weights:
 *   Algae bloom       45 pts  (primary concern)
 *   Phosphorus        30 pts  (limiting nutrient in freshwater)
 *   Nitrogen          25 pts  (secondary driver + hypoxia risk)
 *
 * Reference thresholds from EPA trophic classification:
 *   Algae (chlorophyll-a proxy): <5 mg/L = good, >30 = bloom
 *   Phosphorus: <0.025 mg/L good → we scale our sim units (0–20 range → 0–1)
 *   Nitrogen:   <1 mg/L good  → sim units 0–50
 */
export function computeHealthScore(
  nodeConcentrations: Record<string, Record<ContaminantType, number>>,
  nodes: RiverNode[],
): number {
  const lakeNodes = nodes.filter((n) => n.type === 'lake');
  const targetNodes = lakeNodes.length > 0 ? lakeNodes : nodes;

  let totalAlgae = 0;
  let totalP = 0;
  let totalN = 0;

  for (const node of targetNodes) {
    const c = nodeConcentrations[node.id];
    totalAlgae += c.Algae;
    totalP += c.Phosphorus;
    totalN += c.Nitrogen;
  }

  const n = targetNodes.length;
  const avgAlgae = totalAlgae / n;
  const avgP = totalP / n;
  const avgN = totalN / n;

  // Normalise to 0-1 then weight
  const algaePenalty = Math.min(avgAlgae / 30, 1) * 45;
  const pPenalty = Math.min(avgP / 15, 1) * 30;
  const nPenalty = Math.min(avgN / 25, 1) * 25;

  return Math.max(0, 100 - algaePenalty - pPenalty - nPenalty);
}

/**
 * Apply one simulation tick.
 * Pure function — returns the next nodeConcentrations given current state.
 */
export function tickSimulation(
  prev: SimulationState,
  nodes: RiverNode[],
): Record<string, Record<ContaminantType, number>> {
  const next = JSON.parse(
    JSON.stringify(prev.nodeConcentrations),
  ) as Record<string, Record<ContaminantType, number>>;

  // 1. Process contaminant transport per type
  (Object.keys(CONTAMINANTS) as ContaminantType[]).forEach((type) => {
    const props = CONTAMINANTS[type];

    // Decay existing concentrations
    const decayRate = (1 - props.decayRate) - prev.rainfall / 1000;
    Object.keys(next).forEach((id) => {
      next[id][type] *= Math.max(0, decayRate);
    });

    // Add new spill input
    prev.activeSpills.forEach((spill) => {
      if (
        spill.type === type &&
        prev.timeStep >= spill.startTime &&
        prev.timeStep < spill.startTime + 10
      ) {
        next[spill.nodeId][type] += spill.amount * (1 + prev.fertilizer / 100);
      }
    });

    // Flow downstream
    const flowFactor = (prev.rainfall + prev.stormIntensity) / 200;
    const flowUpdates: Record<string, number> = {};

    nodes.forEach((node) => {
      if (node.downstreamId) {
        const isLake = node.type === 'lake';
        const baseFlow = isLake ? 0.02 : 0.1;
        const flowAmount =
          next[node.id][type] * (baseFlow + flowFactor) * props.mobility;
        flowUpdates[node.downstreamId] = (flowUpdates[node.downstreamId] || 0) + flowAmount;
        next[node.id][type] -= flowAmount;
      }
    });

    Object.entries(flowUpdates).forEach(([id, amount]) => {
      next[id][type] += amount;
    });
  });

  // 2. Algae growth from Nitrogen + Phosphorus (Monod-inspired)
  nodes.forEach((node) => {
    const nitrogen = next[node.id].Nitrogen;
    const phosphorus = next[node.id].Phosphorus;
    const isLake = node.type === 'lake';
    // Lakes accumulate algae faster due to low flushing and thermal stratification
    const growthMultiplier = isLake ? 2.8 : 1.0;
    const growthPotential = (nitrogen * 0.05 + phosphorus * 0.12) * growthMultiplier;
    if (growthPotential > 0.01) {
      next[node.id].Algae += growthPotential;
    }
  });

  // 3. Apply active interventions
  prev.activeInterventions.forEach((active) => {
    if (
      prev.timeStep >= active.startTime &&
      prev.timeStep < active.startTime + active.duration
    ) {
      const effects = INTERVENTIONS[active.interventionId].effects;
      const c = next[active.nodeId];
      if (effects.algaeMultiplier !== undefined) c.Algae *= effects.algaeMultiplier;
      if (effects.nitrogenMultiplier !== undefined) c.Nitrogen *= effects.nitrogenMultiplier;
      if (effects.phosphorusMultiplier !== undefined) c.Phosphorus *= effects.phosphorusMultiplier;
      if (effects.sedimentMultiplier !== undefined) c.Sediment *= effects.sedimentMultiplier;
      if (effects.industrialMultiplier !== undefined) c.Industrial *= effects.industrialMultiplier;
      // Clamp negatives
      (Object.keys(c) as ContaminantType[]).forEach((t) => {
        if (c[t] < 0) c[t] = 0;
      });
    }
  });

  return next;
}

// Chesapeake Bay watershed network
export const CHESAPEAKE_RIVER_NETWORK: RiverNode[] = [
  { id: 'sus-1', lat: 42.1, lng: -76.0, downstreamId: 'sus-2', name: 'Upper Susquehanna', type: 'headwater' },
  { id: 'sus-2', lat: 41.2, lng: -76.8, downstreamId: 'sus-3', name: 'West Branch Susquehanna', type: 'confluence' },
  { id: 'sus-3', lat: 40.3, lng: -76.9, downstreamId: 'sus-4', name: 'Middle Susquehanna', type: 'confluence' },
  { id: 'sus-4', lat: 39.5, lng: -76.1, downstreamId: 'bay-1', name: 'Lower Susquehanna', type: 'confluence' },

  { id: 'pot-1', lat: 39.5, lng: -78.5, downstreamId: 'pot-2', name: 'North Branch Potomac', type: 'headwater' },
  { id: 'pot-2', lat: 39.2, lng: -77.8, downstreamId: 'pot-3', name: 'Shenandoah Confluence', type: 'confluence' },
  { id: 'pot-3', lat: 38.9, lng: -77.1, downstreamId: 'lake-1', name: 'Lower Potomac', type: 'confluence' },

  { id: 'lake-1', lat: 38.7, lng: -77.0, downstreamId: 'bay-1', name: 'Lake Potomac Reservoir', type: 'lake' },

  { id: 'jam-1', lat: 37.8, lng: -79.5, downstreamId: 'jam-2', name: 'Upper James', type: 'headwater' },
  { id: 'jam-2', lat: 37.5, lng: -77.4, downstreamId: 'lake-2', name: 'Lower James', type: 'confluence' },

  { id: 'lake-2', lat: 37.3, lng: -77.0, downstreamId: 'bay-1', name: 'James River Lake', type: 'lake' },

  { id: 'bay-1', lat: 38.5, lng: -76.3, downstreamId: 'bay-2', name: 'Upper Chesapeake Bay', type: 'confluence' },
  { id: 'bay-2', lat: 37.5, lng: -76.1, downstreamId: 'atl-1', name: 'Lower Chesapeake Bay', type: 'confluence' },
  { id: 'atl-1', lat: 36.9, lng: -75.9, downstreamId: null, name: 'Atlantic Ocean Outlet', type: 'mouth' },
];

/** Starting concentrations for a eutrophic (algae-impaired) watershed */
export function buildEutrophicState(): Record<string, Record<ContaminantType, number>> {
  return Object.fromEntries(
    CHESAPEAKE_RIVER_NETWORK.map((node) => {
      const isLake = node.type === 'lake';
      return [
        node.id,
        {
          Nitrogen: isLake ? 14 : 8,
          Phosphorus: isLake ? 10 : 5,
          Industrial: 0,
          Sediment: isLake ? 2 : 3,
          Algae: isLake ? 22 : 4,
        } as Record<ContaminantType, number>,
      ];
    }),
  );
}

/** Empty (clean) node concentrations */
export function buildCleanState(): Record<string, Record<ContaminantType, number>> {
  return Object.fromEntries(
    CHESAPEAKE_RIVER_NETWORK.map((n) => [
      n.id,
      Object.fromEntries(
        (Object.keys(CONTAMINANTS) as ContaminantType[]).map((t) => [t, 0]),
      ) as Record<ContaminantType, number>,
    ]),
  );
}
