import { Role } from "@prisma/client";

// Mappings of Roles to their allowed capabilities/permissions
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  OWNER: [
    "company.settings.edit",
    "company.branding.edit",
    "user.manage",
    "role.assign",
    "numbering.config",
    "module.toggle",
    "item.manage",
    "vendor.manage",
    "vendor.approve",
    "store.manage",
    "shipto.manage",
    "indent.create",
    "indent.approve",
    "grn.post",
    "inspection.record",
    "issue.create",
    "gatepass.create",
    "stock.adjust",
    "stocktake.approve",
    "reorder.review",
    "reorder.approve",
    "pr.create",
    "pr.approve",
    "rfq.manage",
    "rfq.award",
    "po.create",
    "po.approve",
    "po.send",
    "invoice.match",
    "payment.record",
    "ledger.view",
    "customer.manage",
    "customer.approve",
    "so.create",
    "so.approve",
    "dispatch.create",
    "ewaybill.generate",
    "sales.invoice",
    "einvoice.generate",
    "receipt.record",
    "debtor.view",
    "erp.config",
    "erp.writeback.approve",
    "reports.view",
  ],
  ADMIN: [
    "company.settings.edit",
    "company.branding.edit",
    "user.manage",
    "role.assign",
    "numbering.config",
    "module.toggle",
    "item.manage",
    "vendor.manage",
    "vendor.approve",
    "store.manage",
    "shipto.manage",
    "indent.create",
    "indent.approve",
    "grn.post",
    "inspection.record",
    "issue.create",
    "gatepass.create",
    "stock.adjust",
    "stocktake.approve",
    "reorder.review",
    "reorder.approve",
    "pr.create",
    "pr.approve",
    "rfq.manage",
    "rfq.award",
    "po.create",
    "po.approve",
    "po.send",
    "invoice.match",
    "payment.record",
    "ledger.view",
    "customer.manage",
    "customer.approve",
    "so.create",
    "so.approve",
    "dispatch.create",
    "ewaybill.generate",
    "sales.invoice",
    "einvoice.generate",
    "receipt.record",
    "debtor.view",
    "erp.config",
    "erp.writeback.approve",
    "reports.view",
  ],
  PURCHASE_MANAGER: [
    "vendor.manage",
    "vendor.approve",
    "pr.create",
    "pr.approve",
    "rfq.manage",
    "rfq.award",
    "po.create",
    "po.approve",
    "po.send",
    "customer.manage",
    "so.create",
    "so.approve",
    "reports.view",
  ],
  PURCHASE_OFFICER: [
    "vendor.manage",
    "pr.create",
    "rfq.manage",
    "po.create",
    "po.approve",
    "po.send",
    "customer.manage",
    "so.create",
    "reports.view",
  ],
  STORE_MANAGER: [
    "item.manage",
    "store.manage",
    "indent.approve",
    "grn.post",
    "issue.create",
    "gatepass.create",
    "stock.adjust",
    "stocktake.approve",
    "reorder.review",
    "reorder.approve",
    "dispatch.create",
    "ewaybill.generate",
    "reports.view",
  ],
  STORE_KEEPER: [
    "item.manage",
    "indent.create",
    "grn.post",
    "issue.create",
    "gatepass.create",
    "dispatch.create",
    "reports.view",
  ],
  QC_INSPECTOR: [
    "inspection.record",
    "reports.view",
  ],
  INDENTER: [
    "indent.create",
    "reports.view",
  ],
  APPROVER: [
    "indent.approve",
    "pr.approve",
    "po.approve",
    "reports.view",
  ],
  ACCOUNTS: [
    "invoice.match",
    "payment.record",
    "ledger.view",
    "customer.manage",
    "sales.invoice",
    "einvoice.generate",
    "receipt.record",
    "debtor.view",
    "reports.view",
  ],
  VIEWER: [
    "reports.view",
  ]
};

export interface SessionUser {
  id: string;
  email?: string | null;
  role: Role;
  companyId: string;
  storeScope?: string[]; // empty = all stores
  deptScope?: string[];  // empty = all departments
  approvalLimit?: number | null;
  permissions?: string[] | null;
}

/**
 * Checks if the session user has a permission, matches scope constraints, and is within value approval limits.
 */
export function can(
  user: SessionUser | undefined | null,
  permission: string,
  options?: {
    scope?: {
      storeId?: string | null;
      deptId?: string | null;
    };
    value?: number;
  }
): boolean {
  if (!user || !user.role) {
    return false;
  }

  const permissions = user.permissions || ROLE_PERMISSIONS[user.role] || [];
  if (!permissions.includes(permission)) {
    return false;
  }

  // Value check (e.g. for approvals like po.approve, pr.approve)
  if (options?.value !== undefined && user.role !== "OWNER") {
    // If an approval action is requested and user has a configured approval limit, enforce it
    if (user.approvalLimit !== undefined && user.approvalLimit !== null) {
      if (options.value > user.approvalLimit) {
        return false;
      }
    }
  }

  // Store scope check
  if (options?.scope?.storeId && user.storeScope && user.storeScope.length > 0) {
    if (!user.storeScope.includes(options.scope.storeId)) {
      return false;
    }
  }

  // Department scope check
  if (options?.scope?.deptId && user.deptScope && user.deptScope.length > 0) {
    if (!user.deptScope.includes(options.scope.deptId)) {
      return false;
    }
  }

  return true;
}
