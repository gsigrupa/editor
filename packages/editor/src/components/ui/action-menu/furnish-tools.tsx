import type { CatalogCategory } from './../../../store/use-editor'

export type FurnishToolConfig = {
  id: 'item'
  iconSrc: string
  label: string
  catalogCategory: CatalogCategory
}

export const furnishTools: FurnishToolConfig[] = [
  { id: 'item', iconSrc: '/icons/couch.png', label: 'Meble', catalogCategory: 'furniture' },
  { id: 'item', iconSrc: '/icons/appliance.png', label: 'AGD', catalogCategory: 'appliance' },
  { id: 'item', iconSrc: '/icons/kitchen.png', label: 'Kuchnia', catalogCategory: 'kitchen' },
  { id: 'item', iconSrc: '/icons/bathroom.png', label: 'Łazienka', catalogCategory: 'bathroom' },
  { id: 'item', iconSrc: '/icons/tree.png', label: 'Ogród', catalogCategory: 'outdoor' },
]
