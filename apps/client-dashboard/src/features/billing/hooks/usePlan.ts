// apps/client-dashboard/src/features/billing/hooks/usePlan.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPlan,
  updatePlan,
  subscribeTenant,
  planInfoFromId,
  type PlanState,
  type SubscribeTenantRequest,
  type TenantDTO,
  type PlanTier,
} from '../../../api/billing';

export const PLAN_QK = ['billing:plan'] as const;

// Normalizes API shape: getPlan() -> { plan: PlanState } => PlanState
export function usePlanQuery() {
  return useQuery<PlanState>({
    queryKey: PLAN_QK,
    queryFn: async () => {
      const res = await getPlan();
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

// Helper: compute a new renew date
function computeRenewalDate(interval: 'month' | 'year'): string {
  const d = new Date();
  if (interval === 'year') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

// NEW: subscribe mutation that updates the plan cache from backend tenant data
export function useSubscribePlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubscribeTenantRequest) => subscribeTenant(body),
    onSuccess: (tenant: TenantDTO) => {
      const prev = qc.getQueryData<PlanState>(PLAN_QK);
      const info = planInfoFromId(tenant.planInfo?.planId ?? undefined);

      const nextTier = (info.name as PlanTier) ?? prev?.tier ?? 'Starter';
      const nextInterval = info.interval ?? prev?.interval ?? 'month';

      const next: PlanState = {
        tier: nextTier,
        interval: nextInterval,
        status: tenant.subscriptionStatus === 'active' ? 'active' : prev?.status ?? 'active',
        renewsAt: computeRenewalDate(nextInterval),
        trialEndsAt: tenant.trialEndsAt ?? prev?.trialEndsAt,
        seats: prev?.seats ?? 3,
        addOns:
          prev?.addOns ??
          { analytics: false, white_label: false, priority_support: false, multi_venue: false, ai_assistant: false },
      };

      qc.setQueryData(PLAN_QK, next);
    },
  });
}