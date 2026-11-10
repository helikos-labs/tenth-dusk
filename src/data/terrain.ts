export type TerrainId = 'meadow' | 'heath' | 'forest' | 'oldwood' | 'hills' | 'mountain' | 'peaks' | 'marsh' | 'river' | 'lake' | 'sea'

export type Engine = 'grassland' | 'forest' | 'mountain' | 'water' | 'blight'

export interface TerrainRecord {
  steps: number | null
  levels: readonly [number, number]
  cover: number
  engine: Engine
}

export const TERRAIN: Record<TerrainId, TerrainRecord> = {
  meadow: { steps: 2, levels: [0, 0], cover: 0, engine: 'grassland' },
  heath: { steps: 2, levels: [0, 1], cover: 0, engine: 'grassland' },
  forest: { steps: 3, levels: [0, 0], cover: 0.5, engine: 'forest' },
  oldwood: { steps: 4, levels: [0, 0], cover: 0.5, engine: 'forest' },
  hills: { steps: 3, levels: [1, 1], cover: 0, engine: 'mountain' },
  mountain: { steps: 4, levels: [2, 2], cover: 0, engine: 'mountain' },
  peaks: { steps: null, levels: [3, 3], cover: 0, engine: 'mountain' },
  marsh: { steps: 4, levels: [0, 0], cover: 0, engine: 'blight' },
  river: { steps: null, levels: [0, 0], cover: 0, engine: 'water' },
  lake: { steps: null, levels: [0, 0], cover: 0, engine: 'water' },
  sea: { steps: null, levels: [0, 0], cover: 0, engine: 'water' },
}
