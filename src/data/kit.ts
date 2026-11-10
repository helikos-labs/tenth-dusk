export type GearSlot = 'weapon' | 'shield' | 'lantern' | 'cloak' | 'boots' | 'charm'

export interface Hero {
  name: string
  vigour: number
  maxVigour: number
  ember: number
  maxEmber: number
  gear: Partial<Record<GearSlot, { id: string; tier: 1 | 2 | 3 | 4 }>>
  satchel: { id: string; n: number }[]
}

export const STARTING_HERO = (name: string): Hero => ({
  name,
  vigour: 30,
  maxVigour: 30,
  ember: 4,
  maxEmber: 6,
  gear: {
    weapon: { id: 'staff', tier: 1 },
    lantern: { id: 'lantern', tier: 1 },
    cloak: { id: 'travel-cloak', tier: 1 },
  },
  satchel: [{ id: 'ration', n: 2 }, { id: 'draught', n: 1 }],
})
