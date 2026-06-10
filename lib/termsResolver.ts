export const DEFAULT_CONFIG = {
  inspectionDays: 7,
  replacementDays: 15,
  returnCollectionDays: 30,
  qtyTolerancePct: 0,
  warrantyMonths: 24,
  sparesYears: 10,
  ldPctPerDay: 0.5,
  ldCapPct: 100,
  creditDays: 45,
  latentDefectDays: 90,
  fmTerminationDays: 45,
  cureDays: 30,
  arbitrationForum: "Arbitration and Conciliation Act, 1996",
  jurisdictionCity: "New Delhi",
};

export function resolvePoTerms(
  po: any,
  preset: any,
  company: any,
  vendor: any,
  config: any
): { success: true; text: string } | { success: false; errors: string[] } {
  const body = preset.bodyMarkdown || "";
  const errors: string[] = [];

  // Parse tokenDefaults from preset
  let tokenDefaults: any = {};
  if (preset.tokenDefaults) {
    try {
      tokenDefaults = typeof preset.tokenDefaults === "string" 
        ? JSON.parse(preset.tokenDefaults) 
        : preset.tokenDefaults;
    } catch (e) {
      console.error("Failed to parse tokenDefaults", e);
    }
  }

  // Define resolution map
  const resolverMap: Record<string, () => any> = {
    COMPANY_NAME: () => company?.name,
    COMPANY_ADDRESS: () => company?.address,
    COMPANY_GSTIN: () => company?.gstin,
    COMPANY_CITY: () => company?.city,
    GOVERNING_PLACE: () => company?.governingPlace,

    PO_NUMBER: () => po?.number,
    PO_DATE: () => po?.orderDate ? new Date(po.orderDate).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN"),
    DELIVERY_TERMS: () => po?.freightTerms || vendor?.paymentTerms || tokenDefaults?.deliveryTerms,
    DELIVERY_LOCATION: () => po?.shipTo,
    PAYMENT_MODE: () => po?.paymentTerms || vendor?.paymentTerms || tokenDefaults?.paymentMode,

    CREDIT_DAYS: () => (vendor?.creditDays !== undefined && vendor?.creditDays !== 0) 
      ? vendor.creditDays 
      : (config?.creditDays ?? tokenDefaults?.creditDays ?? DEFAULT_CONFIG.creditDays),
    
    INSPECTION_DAYS: () => config?.inspectionDays ?? tokenDefaults?.inspectionDays ?? DEFAULT_CONFIG.inspectionDays,
    REPLACEMENT_DAYS: () => config?.replacementDays ?? tokenDefaults?.replacementDays ?? DEFAULT_CONFIG.replacementDays,
    RETURN_COLLECTION_DAYS: () => config?.returnCollectionDays ?? tokenDefaults?.returnCollectionDays ?? DEFAULT_CONFIG.returnCollectionDays,
    QTY_TOLERANCE_PCT: () => config?.qtyTolerancePct ?? tokenDefaults?.qtyTolerancePct ?? DEFAULT_CONFIG.qtyTolerancePct,
    WARRANTY_MONTHS: () => config?.warrantyMonths ?? tokenDefaults?.warrantyMonths ?? DEFAULT_CONFIG.warrantyMonths,
    LATENT_DEFECT_DAYS: () => config?.latentDefectDays ?? tokenDefaults?.latentDefectDays ?? DEFAULT_CONFIG.latentDefectDays,
    SPARES_YEARS: () => config?.sparesYears ?? tokenDefaults?.sparesYears ?? DEFAULT_CONFIG.sparesYears,
    LD_PCT_PER_DAY: () => config?.ldPctPerDay ?? tokenDefaults?.ldPctPerDay ?? DEFAULT_CONFIG.ldPctPerDay,
    LD_CAP_PCT: () => config?.ldCapPct ?? tokenDefaults?.ldCapPct ?? DEFAULT_CONFIG.ldCapPct,
    FM_TERMINATION_DAYS: () => config?.fmTerminationDays ?? tokenDefaults?.fmTerminationDays ?? DEFAULT_CONFIG.fmTerminationDays,
    CURE_DAYS: () => config?.cureDays ?? tokenDefaults?.cureDays ?? DEFAULT_CONFIG.cureDays,
    ARBITRATION_FORUM: () => config?.arbitrationForum ?? tokenDefaults?.arbitrationForum ?? DEFAULT_CONFIG.arbitrationForum,
    JURISDICTION_CITY: () => config?.jurisdictionCity ?? tokenDefaults?.jurisdictionCity ?? company?.city ?? DEFAULT_CONFIG.jurisdictionCity,
  };

  // Find all tokens in the bodyMarkdown
  const tokenRegex = /\{\{([A-Z_]+)\}\}/g;
  const foundTokens = new Set<string>();
  let match;
  while ((match = tokenRegex.exec(body)) !== null) {
    foundTokens.add(match[1]);
  }

  let resolvedText = body;

  // Resolve each token
  for (const token of foundTokens) {
    const resolver = resolverMap[token];
    if (!resolver) {
      errors.push(`Unknown token: {{${token}}}`);
      continue;
    }

    const value = resolver();
    if (value === undefined || value === null || value === "") {
      errors.push(`Missing value for token: {{${token}}}`);
    } else {
      // Escape value for safe display in text, format numbers appropriately
      const displayValue = typeof value === "number" ? String(value) : String(value).trim();
      resolvedText = resolvedText.replaceAll(`{{${token}}}`, displayValue);
    }
  }

  // Fail-closed verification
  const checkMatch = resolvedText.match(tokenRegex);
  if (checkMatch) {
    for (const m of checkMatch) {
      const tokName = m.slice(2, -2);
      if (!errors.includes(`Missing value for token: {{${tokName}}}`)) {
        errors.push(`Unresolved literal token remains: {{${tokName}}}`);
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, text: resolvedText };
}
