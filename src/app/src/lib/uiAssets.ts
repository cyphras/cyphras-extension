import { UI_ASSETS } from '@constants/backend'
import { toDataUrls } from '@/lib/iconCache'

export type UiAssetKey = keyof typeof UI_ASSETS

// Brand/UI images resolve through the same byte cache as token icons: the
// first use downloads once, after that they render instantly and offline.
export async function getUiAsset(key: UiAssetKey): Promise<string> {
  const cached = await toDataUrls(new Map([[key, UI_ASSETS[key]]]))
  return cached.get(key) ?? UI_ASSETS[key]
}
