/**
 * Algae bloom remediation interventions.
 * Biological mechanisms grounded in limnology and watershed science.
 * Data sources: EPA, USGS, peer-reviewed literature.
 */

export type InterventionType =
  | 'NutrientReduction'
  | 'Aeration'
  | 'AlumTreatment'
  | 'BarleyStraw'
  | 'HydraulicFlushing'
  | 'RiparianBuffer'
  | 'Bioremediation'
  | 'PhosphorusPrecipitation';

export interface InterventionEffects {
  algaeMultiplier?: number;        // < 1 reduces algae each step while active
  nitrogenMultiplier?: number;     // < 1 reduces nitrogen loading
  phosphorusMultiplier?: number;   // < 1 reduces phosphorus loading
  sedimentMultiplier?: number;     // < 1 reduces sediment
  industrialMultiplier?: number;   // < 1 reduces industrial waste
}

export interface Intervention {
  id: InterventionType;
  name: string;
  shortName: string;
  description: string;
  biologicalMechanism: string;
  effects: InterventionEffects;
  /** How many sim steps the effects persist */
  duration: number;
  /** Which node types this can be applied to */
  targetTypes: Array<'headwater' | 'confluence' | 'mouth' | 'lake'>;
  color: string;
  /** EPA-aligned cost tier */
  cost: 'Low' | 'Medium' | 'High';
  /** Primary driver targeted */
  primaryTarget: 'Algae' | 'Phosphorus' | 'Nitrogen' | 'Sediment' | 'Multiple';
}

export const INTERVENTIONS: Record<InterventionType, Intervention> = {
  NutrientReduction: {
    id: 'NutrientReduction',
    name: 'Upstream Nutrient Control',
    shortName: 'Nutrient Ctrl',
    description: 'Reduce agricultural N/P inputs via best management practices (cover crops, precision fertilization)',
    biologicalMechanism:
      'Limits substrate availability for algae via Monod kinetics: μ = μmax·(N/Ks+N)·(P/Kp+P). ' +
      'Reduces non-point source loading to below Redfield threshold.',
    effects: { nitrogenMultiplier: 0.60, phosphorusMultiplier: 0.65 },
    duration: 25,
    targetTypes: ['headwater', 'confluence', 'lake'],
    color: '#10b981',
    cost: 'Medium',
    primaryTarget: 'Multiple',
  },

  Aeration: {
    id: 'Aeration',
    name: 'Lake Destratification / Aeration',
    shortName: 'Aeration',
    description: 'Install diffused-air or mechanical mixing systems to break thermal stratification',
    biologicalMechanism:
      'Disrupts thermocline, eliminates anoxic hypolimnion. Prevents internal P release from sediments under reducing conditions. ' +
      'Turbulence also inhibits buoyant cyanobacteria from outcompeting eukaryotic algae.',
    effects: { algaeMultiplier: 0.78, phosphorusMultiplier: 0.85 },
    duration: 20,
    targetTypes: ['lake'],
    color: '#3b82f6',
    cost: 'Medium',
    primaryTarget: 'Algae',
  },

  AlumTreatment: {
    id: 'AlumTreatment',
    name: 'Alum Application',
    shortName: 'Alum',
    description: 'Apply aluminum sulfate Al₂(SO₄)₃ to precipitate dissolved phosphorus',
    biologicalMechanism:
      'Al³⁺ binds soluble reactive phosphorus → insoluble AlPO₄ floc. ' +
      'Floc settles and forms a P-sorbing layer on sediment, reducing internal loading for 3-10 years.',
    effects: { phosphorusMultiplier: 0.28, algaeMultiplier: 0.72 },
    duration: 35,
    targetTypes: ['lake'],
    color: '#8b5cf6',
    cost: 'High',
    primaryTarget: 'Phosphorus',
  },

  BarleyStraw: {
    id: 'BarleyStraw',
    name: 'Barley Straw Deployment',
    shortName: 'Barley Straw',
    description: 'Float bales of decomposing barley straw to inhibit algae photosynthesis',
    biologicalMechanism:
      'Aerobic straw decomposition by fungi produces H₂O₂ and phenolic compounds. ' +
      'These oxidize polyunsaturated fatty acids in cyanobacterial membranes and suppress photosystem II activity.',
    effects: { algaeMultiplier: 0.82 },
    duration: 30,
    targetTypes: ['lake'],
    color: '#f59e0b',
    cost: 'Low',
    primaryTarget: 'Algae',
  },

  HydraulicFlushing: {
    id: 'HydraulicFlushing',
    name: 'Hydraulic Flushing',
    shortName: 'Flushing',
    description: 'Increase water exchange rate to export nutrients and bloom biomass',
    biologicalMechanism:
      'Reduces hydraulic retention time (HRT) below algae net growth rate. ' +
      'When HRT < 1/μnet, washout exceeds growth, mechanically collapsing the bloom.',
    effects: { algaeMultiplier: 0.55, nitrogenMultiplier: 0.70, phosphorusMultiplier: 0.62 },
    duration: 12,
    targetTypes: ['lake', 'confluence'],
    color: '#06b6d4',
    cost: 'Low',
    primaryTarget: 'Multiple',
  },

  RiparianBuffer: {
    id: 'RiparianBuffer',
    name: 'Riparian Buffer Restoration',
    shortName: 'Riparian Buffer',
    description: 'Establish native vegetation corridors along stream banks',
    biologicalMechanism:
      'Root uptake intercepts dissolved N/P before entering waterbody. ' +
      'Saturated riparian soils support denitrification (NO₃⁻ → N₂) via anaerobic microbial activity. ' +
      'Vegetation also traps sediment-bound phosphorus.',
    effects: { nitrogenMultiplier: 0.72, phosphorusMultiplier: 0.78, sedimentMultiplier: 0.60 },
    duration: 50,
    targetTypes: ['headwater', 'confluence', 'lake'],
    color: '#84cc16',
    cost: 'Low',
    primaryTarget: 'Nitrogen',
  },

  Bioremediation: {
    id: 'Bioremediation',
    name: 'Microbial Bioremediation',
    shortName: 'Bioremediation',
    description: 'Introduce polyphosphate-accumulating bacteria consortia to sequester P',
    biologicalMechanism:
      'Polyphosphate-accumulating organisms (PAOs) perform luxury P uptake under aerobic conditions: ' +
      'intracellular polyphosphate granules store excess P, removing it from the water column. ' +
      'Also competitively excludes toxin-producing Microcystis cyanobacteria.',
    effects: { phosphorusMultiplier: 0.52, algaeMultiplier: 0.88 },
    duration: 22,
    targetTypes: ['lake'],
    color: '#f43f5e',
    cost: 'High',
    primaryTarget: 'Phosphorus',
  },

  PhosphorusPrecipitation: {
    id: 'PhosphorusPrecipitation',
    name: 'Iron/Calcium Precipitation',
    shortName: 'P Precipitation',
    description: 'Add FeCl₃ or Ca(OH)₂ to rapidly immobilize dissolved phosphorus',
    biologicalMechanism:
      'Fe³⁺ forms insoluble iron(III) phosphate (FePO₄) floc; Ca²⁺ at high pH forms hydroxyapatite Ca₅(PO₄)₃OH. ' +
      'Both mechanisms achieve rapid P removal from the water column within hours of application.',
    effects: { phosphorusMultiplier: 0.38, algaeMultiplier: 0.80 },
    duration: 18,
    targetTypes: ['lake', 'confluence'],
    color: '#dc2626',
    cost: 'Medium',
    primaryTarget: 'Phosphorus',
  },
};

export const INTERVENTION_LIST = Object.values(INTERVENTIONS);
