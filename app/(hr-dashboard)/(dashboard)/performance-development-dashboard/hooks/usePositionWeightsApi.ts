"use client";

import { useCallback, useState } from "react";
import type {
  PositionAppraisalWeightsInput,
  UpdatePositionAppraisalWeightsInput,
} from "@/performance-development-dashboard/types";
import type { PositionAppraisalWeightsItem } from "@/performance-development-dashboard/lib/performance/positionWeights";
import { perDevFetch } from "@/performance-development-dashboard/lib/api/perDevFetch";

const POSITION_WEIGHTS_API =
  "/performance-development-dashboard/api/performance/position-weights";

/**
 * Position appraisal-weights API client (HR scope only, server-enforced).
 * Percentages sum to 100 per job position; the client never derives them.
 */
export function usePositionWeightsApi() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    (path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown) =>
      perDevFetch(path, {
        method,
        body,
        sessionExpiredMessage: "Your session has expired. Please sign in again.",
      }),
    []
  );

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      setError(null);
      setBusy(true);
      try {
        return await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const listWeights = useCallback(
    () =>
      request(POSITION_WEIGHTS_API) as Promise<
        PositionAppraisalWeightsItem[]
      >,
    [request]
  );

  const createWeights = useCallback(
    (input: PositionAppraisalWeightsInput) =>
      request(
        POSITION_WEIGHTS_API,
        "POST",
        input
      ) as Promise<PositionAppraisalWeightsItem>,
    [request]
  );

  const updateWeights = useCallback(
    (id: string, input: UpdatePositionAppraisalWeightsInput) =>
      request(
        `${POSITION_WEIGHTS_API}/${id}`,
        "PATCH",
        input
      ) as Promise<PositionAppraisalWeightsItem>,
    [request]
  );

  return {
    listWeights,
    createWeights,
    updateWeights,
    runListWeights: () => run(() => listWeights()),
    runCreateWeights: (input: PositionAppraisalWeightsInput) =>
      run(() => createWeights(input)),
    runUpdateWeights: (id: string, input: UpdatePositionAppraisalWeightsInput) =>
      run(() => updateWeights(id, input)),
    busy,
    error,
    clearError: () => setError(null),
  };
}
