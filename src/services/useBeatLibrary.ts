import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";
import { listBeatLibrary, type BeatLibraryItem } from "./beatLibrary";

export function useBeatLibrary() {
  const [items, setItems] = useState<BeatLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  useEffect(() => {
    const subscription = liveQuery(listBeatLibrary).subscribe({
      next: (next) => { setItems(next); setLoading(false); setError(undefined); },
      error: (reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    window.addEventListener("focus", refresh);
    window.addEventListener("runbeat:beat-references-changed", refresh);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("runbeat:beat-references-changed", refresh);
    };
  }, [refresh, refreshVersion]);
  return { items, loading, error, refresh };
}
