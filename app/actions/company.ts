"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import fs from "fs";
import path from "path";

/**
 * Update general company fields.
 */
export async function updateCompanyDetails(data: {
  legalName?: string | null;
  displayName?: string | null;
  address?: string | null;
  city?: string | null;
  governingPlace?: string | null;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  baseCurrency?: string;
  timezone?: string;
  fyStartMonth?: number;
  defaultStoreId?: string | null;
}) {
  const session = await auth();
  if (!can(session?.user as any, "company.settings.edit")) {
    throw new Error("Forbidden: Insufficient permissions to edit company settings");
  }

  const companyId = (session?.user as any).companyId;
  if (!companyId) throw new Error("No active company found in session");

  // Keep existing company name in sync with displayName if name is needed
  const nameUpdate = data.displayName || undefined;

  const updatedCompany = await db.company.update({
    where: { id: companyId },
    data: {
      name: nameUpdate,
      legalName: data.legalName,
      displayName: data.displayName,
      address: data.address,
      city: data.city,
      governingPlace: data.governingPlace,
      gstin: data.gstin,
      pan: data.pan,
      cin: data.cin,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      baseCurrency: data.baseCurrency,
      timezone: data.timezone,
      fyStartMonth: data.fyStartMonth,
      defaultStoreId: data.defaultStoreId,
    },
  });

  // Log action
  await db.auditLog.create({
    data: {
      companyId,
      actorId: (session?.user as any).id,
      action: "UPDATE_COMPANY",
      entity: "Company",
      entityId: companyId,
      after: data as any,
    },
  });

  return updatedCompany;
}

/**
 * Handle logo upload. Writes image to public/uploads/ and updates Company.logoUrl.
 */
export async function uploadCompanyLogo(base64Data: string, fileName: string) {
  const session = await auth();
  if (!can(session?.user as any, "company.branding.edit")) {
    throw new Error("Forbidden: Insufficient permissions to edit company branding");
  }

  const companyId = (session?.user as any).companyId;
  if (!companyId) throw new Error("No active company found in session");

  try {
    // Save base64 string directly to DB to support read-only/serverless platforms (like Vercel)
    await db.company.update({
      where: { id: companyId },
      data: { logoUrl: base64Data },
    });

    // Log action
    await db.auditLog.create({
      data: {
        companyId,
        actorId: (session?.user as any).id,
        action: "UPLOAD_LOGO",
        entity: "Company",
        entityId: companyId,
        after: { logoUrl: "[BASE64_IMAGE_DATA]" }, // Avoid bloating audit log text columns if possible
      },
    });

    return { success: true, logoUrl: base64Data };
  } catch (err: any) {
    console.error("Error saving logo to database:", err);
    throw new Error(`Logo upload failed: ${err.message}`);
  }
}

/**
 * Update PO/GRN headers, footers, signatories, bank details.
 */
export async function updateDocSettings(data: {
  poHeaderNote?: string | null;
  poFooterNote?: string | null;
  authorizedSignatory?: string | null;
  declaration?: string | null;
  showBankDetails?: boolean;
  bankDetails?: any;
}) {
  const session = await auth();
  if (!can(session?.user as any, "company.settings.edit")) {
    throw new Error("Forbidden: Insufficient permissions to edit document settings");
  }

  const companyId = (session?.user as any).companyId;
  if (!companyId) throw new Error("No active company found in session");

  const settings = await db.companyDocumentSettings.upsert({
    where: { companyId },
    update: {
      poHeaderNote: data.poHeaderNote,
      poFooterNote: data.poFooterNote,
      authorizedSignatory: data.authorizedSignatory,
      declaration: data.declaration,
      showBankDetails: data.showBankDetails,
      bankDetails: data.bankDetails || {},
    },
    create: {
      companyId,
      poHeaderNote: data.poHeaderNote,
      poFooterNote: data.poFooterNote,
      authorizedSignatory: data.authorizedSignatory,
      declaration: data.declaration,
      showBankDetails: data.showBankDetails,
      bankDetails: data.bankDetails || {},
    },
  });

  // Log action
  await db.auditLog.create({
    data: {
      companyId,
      actorId: (session?.user as any).id,
      action: "UPDATE_DOC_SETTINGS",
      entity: "CompanyDocumentSettings",
      entityId: settings.id,
      after: data as any,
    },
  });

  return settings;
}

/**
 * Configure Numbering Scheme per document type.
 */
export async function upsertNumberingScheme(data: {
  docType: string;
  prefix: string;
  padding: number;
  resetOnFY: boolean;
}) {
  const session = await auth();
  if (!can(session?.user as any, "numbering.config")) {
    throw new Error("Forbidden: Insufficient permissions to configure numbering schemes");
  }

  const companyId = (session?.user as any).companyId;
  if (!companyId) throw new Error("No active company found in session");

  const scheme = await db.numberingScheme.upsert({
    where: {
      companyId_docType: {
        companyId,
        docType: data.docType,
      },
    },
    update: {
      prefix: data.prefix,
      padding: data.padding,
      resetOnFY: data.resetOnFY,
    },
    create: {
      companyId,
      docType: data.docType,
      prefix: data.prefix,
      padding: data.padding,
      resetOnFY: data.resetOnFY,
    },
  });

  // Log action
  await db.auditLog.create({
    data: {
      companyId,
      actorId: (session?.user as any).id,
      action: "UPSERT_NUMBERING_SCHEME",
      entity: "NumberingScheme",
      entityId: scheme.id,
      after: data as any,
    },
  });

  return scheme;
}
