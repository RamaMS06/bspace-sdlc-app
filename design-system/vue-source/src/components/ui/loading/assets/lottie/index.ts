import chartLoad from '@/components/ui/loading/assets/lottie/Chart-Load.json'
import dataLoad from '@/components/ui/loading/assets/lottie/Data-Load.json'
import pageProcessRaw from '@/components/ui/loading/assets/lottie/Page-Process-Table-Load.json'
import refresh from '@/components/ui/loading/assets/lottie/Refresh.json'
import syncData from '@/components/ui/loading/assets/lottie/Sync-Data.json'

function makeColorable(animation: any, color: [number, number, number, number] = [0, 0, 0, 1]) {
  // deep clone to avoid mutating imported JSON
  const clone = JSON.parse(JSON.stringify(animation))

  const visitShapes = (shapes: any[]) => {
    if (!Array.isArray(shapes)) return
    for (const s of shapes) {
      if (!s || typeof s !== 'object') continue
      // group
      if (s.ty === 'gr' && Array.isArray(s.it)) {
        visitShapes(s.it)
      }
      // fill
      if (s.ty === 'fl' && s.c) {
        s.c.a = 0
        s.c.k = color
      }
      // stroke
      if (s.ty === 'st' && s.c) {
        s.c.a = 0
        s.c.k = color
      }
    }
  }

  const layers = clone.layers || []
  for (const layer of layers) {
    if (Array.isArray(layer.shapes)) {
      visitShapes(layer.shapes)
    }
  }
  return clone
}

export const CHART_LOAD = chartLoad as any
export const DATA_LOAD = dataLoad as any
// Make process variant colorable by neutralizing animated colors to black
export const PAGE_PROCESS = makeColorable(pageProcessRaw) as any
export const REFRESH = refresh as any
export const SYNC_DATA = syncData as any

export default {
  CHART_LOAD,
  DATA_LOAD,
  PAGE_PROCESS,
  REFRESH,
  SYNC_DATA
}
