import { BillingProvider, CommercialPlan } from "@fbmaniaco/shared";

export type BillingCheckoutIntent = {
  provider: BillingProvider;
  targetPlan: CommercialPlan;
  checkoutUrl: string | null;
  message: string;
};

export type BillingProviderAdapter = {
  provider: BillingProvider;
  createCheckoutIntent(input: { workspaceId: string; plan: CommercialPlan }): Promise<BillingCheckoutIntent>;
};

export const createBillingProvider = (provider: BillingProvider = "manual"): BillingProviderAdapter => ({
  provider,
  async createCheckoutIntent(input) {
    if (provider === "manual") {
      return {
        provider,
        targetPlan: input.plan,
        checkoutUrl: null,
        message: "El upgrade queda como solicitud manual para piloto privado."
      };
    }
    return {
      provider,
      targetPlan: input.plan,
      checkoutUrl: `https://billing.example/${provider}/checkout?workspace=${encodeURIComponent(input.workspaceId)}&plan=${input.plan}`,
      message: "Checkout preparado por provider mock. No se ha cobrado nada."
    };
  }
});
