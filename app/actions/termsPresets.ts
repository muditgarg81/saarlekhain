"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TermsPresetStatus, PoType } from "@prisma/client";

const configSchema = z.object({
  inspectionDays: z.number().int().nonnegative().default(7),
  replacementDays: z.number().int().nonnegative().default(15),
  returnCollectionDays: z.number().int().nonnegative().default(30),
  qtyTolerancePct: z.number().nonnegative().default(0),
  warrantyMonths: z.number().int().nonnegative().default(24),
  sparesYears: z.number().int().nonnegative().default(10),
  ldPctPerDay: z.number().nonnegative().default(0.5),
  ldCapPct: z.number().nonnegative().default(100),
  creditDays: z.number().int().nonnegative().default(45),
  latentDefectDays: z.number().int().nonnegative().default(90),
  fmTerminationDays: z.number().int().nonnegative().default(45),
  cureDays: z.number().int().nonnegative().default(30),
  arbitrationForum: z.string().min(2, "Arbitration forum name must be set"),
  jurisdictionCity: z.string().optional().nullable(),
});

const companyIdentitySchema = z.object({
  address: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  governingPlace: z.string().optional().nullable(),
});

export async function getPresets() {
  const session = await auth();
  if (!session || !session.user) return [];
  const companyId = (session.user as any).companyId;

  try {
    const rawPresets = await db.poTermsPreset.findMany({
      where: {
        OR: [
          { companyId: null },
          { companyId }
        ],
        status: TermsPresetStatus.ACTIVE,
      },
      orderBy: { createdAt: "asc" }
    });

    // Merge: company-owned copies override system/global ones
    const presetMap = new Map<string, typeof rawPresets[0]>();
    for (const p of rawPresets) {
      if (p.companyId === null) {
        // Only set if not already set by company
        if (!presetMap.has(p.key)) {
          presetMap.set(p.key, p);
        }
      } else {
        // Company owned overrides system global
        presetMap.set(p.key, p);
      }
    }

    return Array.from(presetMap.values());
  } catch (e) {
    console.error("Failed to load presets", e);
    return [];
  }
}

export async function getTermsConfig() {
  const session = await auth();
  if (!session || !session.user) return null;
  const companyId = (session.user as any).companyId;

  try {
    let config = await db.poTermsConfig.findUnique({
      where: { companyId }
    });

    if (!config) {
      config = await db.poTermsConfig.create({
        data: {
          companyId,
          inspectionDays: 7,
          replacementDays: 15,
          returnCollectionDays: 30,
          qtyTolerancePct: 0,
          warrantyMonths: 24,
          sparesYears: 10,
          ldPctPerDay: 0.5,
          ldCapPct: 10,
          creditDays: 45,
          latentDefectDays: 90,
          fmTerminationDays: 45,
          cureDays: 30,
          arbitrationForum: "Arbitration and Conciliation Act, 1996",
        }
      });
    }

    return config;
  } catch (e) {
    console.error("Failed to fetch terms config", e);
    return null;
  }
}

export async function updateTermsConfig(data: z.infer<typeof configSchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const validated = configSchema.parse(data);

    const config = await db.poTermsConfig.upsert({
      where: { companyId },
      update: validated,
      create: {
        companyId,
        ...validated,
      }
    });

    revalidatePath("/purchase/po");
    return { success: true, config };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to update configuration" };
  }
}

export async function updateCompanyIdentity(data: z.infer<typeof companyIdentitySchema>) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const validated = companyIdentitySchema.parse(data);

    await db.company.update({
      where: { id: companyId },
      data: {
        address: validated.address || null,
        gstin: validated.gstin || null,
        city: validated.city || null,
        governingPlace: validated.governingPlace || null,
      }
    });

    revalidatePath("/purchase/po");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to update company profile" };
  }
}

export async function getCompanyProfile() {
  const session = await auth();
  if (!session || !session.user) return null;
  const companyId = (session.user as any).companyId;

  try {
    return await db.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        address: true,
        gstin: true,
        city: true,
        governingPlace: true,
      }
    });
  } catch (e) {
    return null;
  }
}

export async function clonePreset(key: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    // Check if company override already exists
    const exists = await db.poTermsPreset.findUnique({
      where: {
        companyId_key: { companyId, key }
      }
    });

    if (exists) {
      return { success: true, preset: exists };
    }

    // Find the system template
    const template = await db.poTermsPreset.findFirst({
      where: { companyId: null, key }
    });

    if (!template) {
      return { success: false, error: "System template not found" };
    }

    // Clone it for company
    const preset = await db.poTermsPreset.create({
      data: {
        companyId,
        key,
        name: template.name,
        description: template.description,
        appliesTo: template.appliesTo,
        isDefault: template.isDefault,
        bodyMarkdown: template.bodyMarkdown,
        tokenDefaults: template.tokenDefaults || {},
        version: 1,
        status: TermsPresetStatus.ACTIVE,
      }
    });

    revalidatePath("/purchase/po");
    return { success: true, preset };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to clone preset" };
  }
}

export async function updatePreset(
  key: string,
  data: {
    name: string;
    description?: string | null;
    bodyMarkdown: string;
    tokenDefaults?: any;
    appliesTo: PoType[];
    isDefault: boolean;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    // If it's a default, reset other defaults for these same appliesTo types
    if (data.isDefault) {
      const allPresets = await db.poTermsPreset.findMany({
        where: {
          OR: [
            { companyId: null },
            { companyId }
          ]
        }
      });
      // Filter out system presets overridden by company presets
      const map = new Map<string, typeof allPresets[0]>();
      for (const p of allPresets) {
        if (p.companyId === null) {
          if (!map.has(p.key)) map.set(p.key, p);
        } else {
          map.set(p.key, p);
        }
      }
      
      const activePresets = Array.from(map.values());
      for (const p of activePresets) {
        if (p.key === key) continue;
        // Check if there is overlap in appliesTo
        const overlap = p.appliesTo.some(t => data.appliesTo.includes(t));
        if (overlap && p.isDefault) {
          // If it's system, we need to clone it to override it. If it's company, we update it.
          if (p.companyId === null) {
            await db.poTermsPreset.create({
              data: {
                companyId,
                key: p.key,
                name: p.name,
                description: p.description,
                appliesTo: p.appliesTo,
                isDefault: false,
                bodyMarkdown: p.bodyMarkdown,
                tokenDefaults: p.tokenDefaults || {},
                version: p.version,
                status: p.status,
              }
            });
          } else {
            await db.poTermsPreset.update({
              where: { id: p.id },
              data: { isDefault: false }
            });
          }
        }
      }
    }

    // Ensure company override exists
    let preset = await db.poTermsPreset.findUnique({
      where: {
        companyId_key: { companyId, key }
      }
    });

    if (!preset) {
      // Find template
      const template = await db.poTermsPreset.findFirst({
        where: { companyId: null, key }
      });
      preset = await db.poTermsPreset.create({
        data: {
          companyId,
          key,
          name: data.name,
          description: data.description || template?.description,
          appliesTo: data.appliesTo,
          isDefault: data.isDefault,
          bodyMarkdown: data.bodyMarkdown,
          tokenDefaults: data.tokenDefaults || template?.tokenDefaults || {},
          version: 1,
        }
      });
    } else {
      preset = await db.poTermsPreset.update({
        where: { id: preset.id },
        data: {
          name: data.name,
          description: data.description,
          appliesTo: data.appliesTo,
          isDefault: data.isDefault,
          bodyMarkdown: data.bodyMarkdown,
          tokenDefaults: data.tokenDefaults || {},
          version: preset.version + 1,
        }
      });
    }

    revalidatePath("/purchase/po");
    return { success: true, preset };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to update preset" };
  }
}
