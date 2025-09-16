import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlan, updatePlan, type PlanState } from '../../../api/billing';

export const PLAN_QK = ['billing:plan'] as const;

// Normalizes API shape: getPlan() -> { plan: PlanState } => PlanState
export function usePlanQuery() {
  return useQuery<PlanState>({
    queryKey: PLAN_QK,
    queryFn: async () => {
      const res = await getPlan();
      // If your getPlan already returns PlanState directly, change to: return res;
      return res.plan;
    },
  });
}

export function useUpdatePlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: PlanState) => updatePlan(next), // expects PlanState back
    onSuccess: (saved: PlanState) => {
      qc.setQueryData(PLAN_QK, saved);
    },
  });
}