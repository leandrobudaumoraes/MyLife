import type { CalendarPrefix } from "./schemas.js";
import {
  PROTECTED_SERIES_IDS,
  PROTECTED_SERIES_PREFIX,
  type ProtectedSeriesCatalog,
} from "./catalog.js";

export class InMemoryProtectedSeriesCatalog implements ProtectedSeriesCatalog {
  isProtectedSeries(seriesId: string): boolean {
    return PROTECTED_SERIES_IDS.includes(seriesId);
  }

  prefixOf(seriesId: string): CalendarPrefix | null {
    return PROTECTED_SERIES_PREFIX[seriesId] ?? null;
  }
}
