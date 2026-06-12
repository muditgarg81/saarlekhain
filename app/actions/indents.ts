"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { getItemStock, postLedgerEntry } from "@/lib/stock";
import { getNextSequence as getNextSeq } from "@/lib/sequences"; // alias for sequences
import { revalidatePath } from "next/cache";
import { IndentStatus, LedgerTxnType, PrStatus } from "@prisma/client";

interface IndentLineInput {
  itemId: string;
  qty: number;
  requiredBy?: string | null;
  remarks?: string | null;
}

export async function createIndent(data: {
  priority: string;
  purpose?: string | null;
  lines: IndentLineInput[];
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const deptId = (session.user as any).deptId;

  try {
    if (!data.lines || data.lines.length === 0) {
      return { success: false, error: "Indent must contain at least one line item" };
    }

    const number = await getNextSequence(companyId, "IND");

    const result = await db.$transaction(async (tx) => {
      const indent = await tx.indent.create({
        data: {
          companyId,
          number,
          priority: data.priority,
          purpose: data.purpose || null,
          status: IndentStatus.DRAFT,
          requestedById: actorId,
          deptId: deptId || null,
          lines: {
            create: data.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              requiredBy: l.requiredBy ? new Date(l.requiredBy) : null,
              remarks: l.remarks || null,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "CREATE",
          entity: "Indent",
          entityId: indent.id,
          after: JSON.parse(JSON.stringify(indent)),
        },
      });

      return indent;
    });

    revalidatePath("/stores/indents");
    return { success: true, indent: result };
  } catch (err: any) {
    console.error("Error creating indent:", err);
    return { success: false, error: err.message || "Failed to create indent" };
  }
}

export async function updateIndent(
  indentId: string,
  data: {
    priority: string;
    purpose?: string | null;
    lines: IndentLineInput[];
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    if (!data.lines || data.lines.length === 0) {
      return { success: false, error: "Indent must contain at least one line item" };
    }

    const indent = await db.indent.findFirst({
      where: { id: indentId, companyId },
      include: { lines: true }
    });

    if (!indent) return { success: false, error: "Indent not found" };
    if (indent.status !== IndentStatus.DRAFT) {
      return { success: false, error: "Only draft indents can be edited" };
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Delete existing lines
      await tx.indentLine.deleteMany({
        where: { indentId }
      });

      // 2. Update indent and create new lines
      const updatedIndent = await tx.indent.update({
        where: { id: indentId },
        data: {
          priority: data.priority,
          purpose: data.purpose || null,
          lines: {
            create: data.lines.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              requiredBy: l.requiredBy ? new Date(l.requiredBy) : null,
              remarks: l.remarks || null,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "UPDATE",
          entity: "Indent",
          entityId: indentId,
          before: JSON.parse(JSON.stringify(indent)),
          after: JSON.parse(JSON.stringify(updatedIndent)),
        },
      });

      return updatedIndent;
    });

    revalidatePath("/stores/indents");
    return { success: true, indent: result };
  } catch (err: any) {
    console.error("Error updating indent:", err);
    return { success: false, error: err.message || "Failed to update indent" };
  }
}

export async function submitIndent(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const indent = await db.indent.findFirst({
      where: { id, companyId }
    });
    if (!indent) return { success: false, error: "Indent not found" };
    if (indent.status !== IndentStatus.DRAFT) return { success: false, error: "Only draft indents can be submitted" };

    await db.$transaction(async (tx) => {
      await tx.indent.update({
        where: { id },
        data: { status: IndentStatus.SUBMITTED }
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "SUBMIT",
          entity: "Indent",
          entityId: id,
          before: { status: IndentStatus.DRAFT },
          after: { status: IndentStatus.SUBMITTED }
        }
      });
    });

    revalidatePath("/stores/indents");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to submit indent" };
  }
}

export async function approveIndent(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const role = (session.user as any).role;

  // Enforce server-side role check
  const canApprove = ["ADMIN", "OWNER", "STORE_MANAGER", "APPROVER"].includes(role);
  if (!canApprove) return { success: false, error: "Permission denied. You do not have approval rights." };

  try {
    const indent = await db.indent.findFirst({
      where: { id, companyId }
    });
    if (!indent) return { success: false, error: "Indent not found" };
    if (indent.status !== IndentStatus.SUBMITTED) return { success: false, error: "Only submitted indents can be approved" };

    await db.$transaction(async (tx) => {
      await tx.indent.update({
        where: { id },
        data: { 
          status: IndentStatus.APPROVED,
          approvedById: actorId,
          approvedAt: new Date()
        }
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "APPROVE",
          entity: "Indent",
          entityId: id,
          before: { status: IndentStatus.SUBMITTED },
          after: { status: IndentStatus.APPROVED }
        }
      });
    });

    revalidatePath("/stores/indents");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to approve indent" };
  }
}

export async function rejectIndent(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const role = (session.user as any).role;

  const canApprove = ["ADMIN", "OWNER", "STORE_MANAGER", "APPROVER"].includes(role);
  if (!canApprove) return { success: false, error: "Permission denied." };

  try {
    const indent = await db.indent.findFirst({
      where: { id, companyId }
    });
    if (!indent) return { success: false, error: "Indent not found" };
    if (indent.status !== IndentStatus.SUBMITTED) return { success: false, error: "Only submitted indents can be rejected" };

    await db.$transaction(async (tx) => {
      await tx.indent.update({
        where: { id },
        data: { status: IndentStatus.REJECTED }
      });

      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "REJECT",
          entity: "Indent",
          entityId: id,
          before: { status: IndentStatus.SUBMITTED },
          after: { status: IndentStatus.REJECTED }
        }
      });
    });

    revalidatePath("/stores/indents");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to reject indent" };
  }
}

/**
 * Issues material from a store against an approved indent.
 * Verifies stock levels and posts to the append-only stock ledger.
 */
export async function issueMaterialAgainstIndent(
  indentId: string,
  storeId: string,
  issues: { lineId: string; itemId: string; qtyToIssue: number }[],
  issuedTo?: string | null,
  deptId?: string | null
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const indent = await db.indent.findFirst({
      where: { id: indentId, companyId },
      include: { lines: true }
    });
    if (!indent) return { success: false, error: "Indent not found" };
    if (indent.status !== IndentStatus.APPROVED && indent.status !== IndentStatus.PARTIALLY_ISSUED) {
      return { success: false, error: "Materials can only be issued against approved or partially issued indents" };
    }

    const issueNumber = await getNextSequence(companyId, "ISS");

    const result = await db.$transaction(async (tx) => {
      // 1. Create the Issue header
      const newIssue = await tx.issue.create({
        data: {
          companyId,
          number: issueNumber,
          storeId,
          deptId: deptId !== undefined ? deptId : indent.deptId,
          issuedTo: issuedTo || null,
          indentId: indent.id,
          postedById: actorId,
          postedAt: new Date(),
        }
      });

      // 2. Iterate through line issues, verify stock, update lines, and write to ledger
      let allLinesFullyIssued = true;

      for (const iss of issues) {
        if (iss.qtyToIssue <= 0) continue;

        // Check current derived stock level inside the transaction
        const stockSum = await tx.stockLedger.aggregate({
          where: { companyId, itemId: iss.itemId, storeId },
          _sum: { qty: true }
        });
        const currentStock = stockSum._sum.qty || 0;

        if (currentStock < iss.qtyToIssue) {
          throw new Error(`Insufficient stock for item in selected store. Available: ${currentStock}, Requested: ${iss.qtyToIssue}`);
        }

        // Get indent line
        const line = indent.lines.find(l => l.id === iss.lineId);
        if (!line) throw new Error("Indent line not found");

        const newIssuedQty = line.issuedQty + iss.qtyToIssue;
        if (newIssuedQty > line.qty) {
          throw new Error("Cannot issue more than the requested quantity");
        }

        // Update indent line issued quantity
        await tx.indentLine.update({
          where: { id: iss.lineId },
          data: { issuedQty: newIssuedQty }
        });

        if (newIssuedQty < line.qty) {
          allLinesFullyIssued = false;
        }

        // Create issue line
        await tx.issueLine.create({
          data: {
            issueId: newIssue.id,
            itemId: iss.itemId,
            qty: iss.qtyToIssue,
          }
        });

        // Post stock ledger entry (negative since it is an issue out of the store)
        await postLedgerEntry(tx, {
          companyId,
          itemId: iss.itemId,
          storeId,
          txnType: LedgerTxnType.ISSUE,
          qty: -iss.qtyToIssue, // negative
          refType: "ISSUE",
          refId: newIssue.id,
          createdById: actorId,
        });
      }

      // Check remaining lines
      for (const line of indent.lines) {
        const isCurrentlyIssuing = issues.find(i => i.lineId === line.id);
        const currentTotal = line.issuedQty + (isCurrentlyIssuing?.qtyToIssue || 0);
        if (currentTotal < line.qty) {
          allLinesFullyIssued = false;
        }
      }

      // 3. Update parent Indent status
      const nextStatus = allLinesFullyIssued ? IndentStatus.ISSUED : IndentStatus.PARTIALLY_ISSUED;
      await tx.indent.update({
        where: { id: indentId },
        data: { status: nextStatus }
      });

      // Log audit entry
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "POST_ISSUE",
          entity: "Issue",
          entityId: newIssue.id,
          after: JSON.parse(JSON.stringify(newIssue))
        }
      });

      return newIssue;
    });

    revalidatePath("/stores/indents");
    revalidatePath("/stores/reports");
    return { success: true, issue: result };
  } catch (err: any) {
    console.error("Error issuing material:", err);
    return { success: false, error: err.message || "Failed to issue material" };
  }
}

/**
 * Converts approved/partially-issued indent shortages into a Purchase Requisition (PR).
 */
export async function convertShortageToPr(indentId: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const indent = await db.indent.findFirst({
      where: { id: indentId, companyId },
      include: { lines: true }
    });
    if (!indent) return { success: false, error: "Indent not found" };
    
    const validStatus = indent.status === IndentStatus.APPROVED || indent.status === IndentStatus.PARTIALLY_ISSUED;
    if (!validStatus) return { success: false, error: "Only approved or partially issued indents can be converted to PR" };

    // Find shortage line items
    const prLinesToCreate: { itemId: string; qty: number }[] = [];

    for (const line of indent.lines) {
      const remainingQty = line.qty - line.issuedQty;
      if (remainingQty <= 0) continue;

      // Get derived stock on hand across all stores
      const stock = await getItemStock(companyId, line.itemId);
      
      // If stock is less than remaining indent line qty, we have a shortage
      if (stock < remainingQty) {
        const shortage = remainingQty - stock;
        prLinesToCreate.push({
          itemId: line.itemId,
          qty: shortage
        });
      }
    }

    if (prLinesToCreate.length === 0) {
      return { success: false, error: "No shortage found. Available stock covers all remaining requested quantities." };
    }

    const prNumber = await getNextSequence(companyId, "PR");

    const result = await db.$transaction(async (tx) => {
      // 1. Create the Purchase Requisition
      const pr = await tx.purchaseRequisition.create({
        data: {
          companyId,
          number: prNumber,
          indentId: indent.id,
          status: PrStatus.SUBMITTED, // auto submit since it is derived from approved indents
          lines: {
            create: prLinesToCreate.map(l => ({
              itemId: l.itemId,
              qty: l.qty,
              requiredBy: new Date()
            }))
          }
        },
        include: { lines: true }
      });

      // 2. Update Indent Status
      await tx.indent.update({
        where: { id: indentId },
        data: { status: IndentStatus.CONVERTED_TO_PR }
      });

      // 3. Log Audit
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "CONVERT_TO_PR",
          entity: "PurchaseRequisition",
          entityId: pr.id,
          after: JSON.parse(JSON.stringify(pr))
        }
      });

      return pr;
    });

    revalidatePath("/stores/indents");
    revalidatePath("/purchase/requisitions");
    return { success: true, pr: result };
  } catch (err: any) {
    console.error("Error converting shortage to PR:", err);
    return { success: false, error: err.message || "Failed to convert shortage to PR" };
  }
}

/**
 * Converts multiple approved/partially-issued indents' shortages into a single Purchase Requisition (PR).
 */
export async function convertMultipleIndentsToPR(indentIds: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    if (!indentIds || indentIds.length === 0) {
      return { success: false, error: "No indents selected" };
    }

    const indents = await db.indent.findMany({
      where: { id: { in: indentIds }, companyId },
      include: { lines: true }
    });

    if (indents.length === 0) {
      return { success: false, error: "Selected indents not found" };
    }

    // Verify all selected indents are approved or partially issued
    const allValid = indents.every(ind => 
      ind.status === IndentStatus.APPROVED || ind.status === IndentStatus.PARTIALLY_ISSUED
    );
    if (!allValid) {
      return { success: false, error: "Only approved or partially issued indents can be converted to PR" };
    }

    // Map to keep track of item quantities and which IndentLine records contribute to them
    const itemRequirements: {
      [itemId: string]: {
        qtyNeeded: number;
        lines: { id: string; requiredBy: Date | null }[];
      }
    } = {};

    for (const indent of indents) {
      for (const line of indent.lines) {
        const remainingQty = line.qty - line.issuedQty;
        if (remainingQty <= 0) continue;

        if (!itemRequirements[line.itemId]) {
          itemRequirements[line.itemId] = { qtyNeeded: 0, lines: [] };
        }
        itemRequirements[line.itemId].qtyNeeded += remainingQty;
        itemRequirements[line.itemId].lines.push({
          id: line.id,
          requiredBy: line.requiredBy
        });
      }
    }

    const prLinesToCreate: {
      itemId: string;
      qty: number;
      requiredBy: Date | null;
      originatingLineIds: string[];
    }[] = [];

    for (const [itemId, req] of Object.entries(itemRequirements)) {
      // Get stock level for item across all stores
      const stock = await getItemStock(companyId, itemId);
      
      if (stock < req.qtyNeeded) {
        const shortageQty = req.qtyNeeded - stock;
        
        // Find earliest requiredBy date among the contributing lines
        let earliestRequiredBy: Date | null = null;
        for (const line of req.lines) {
          if (line.requiredBy) {
            if (!earliestRequiredBy || new Date(line.requiredBy) < new Date(earliestRequiredBy)) {
              earliestRequiredBy = line.requiredBy;
            }
          }
        }

        prLinesToCreate.push({
          itemId,
          qty: shortageQty,
          requiredBy: earliestRequiredBy || new Date(),
          originatingLineIds: req.lines.map(l => l.id)
        });
      }
    }

    if (prLinesToCreate.length === 0) {
      return { success: false, error: "No shortage found. Available stock covers all remaining requested quantities." };
    }

    // Generate sequence number
    const prNumber = await getNextSequence(companyId, "PR");

    const result = await db.$transaction(async (tx) => {
      // 1. Create the Purchase Requisition
      // Since it's clubbed, we can link indentId to the first indent in the list for reference
      const pr = await tx.purchaseRequisition.create({
        data: {
          companyId,
          number: prNumber,
          indentId: indents[0]?.id || null,
          status: PrStatus.SUBMITTED, // auto-submitted since it is derived from approved indents
          lines: {
            create: prLinesToCreate.map(l => ({
              itemId: l.itemId,
              qty: l.qty,
              requiredBy: l.requiredBy
            }))
          }
        },
        include: { lines: true }
      });

      // 2. Link each original IndentLine to the newly created PrLine and set purchaseQty
      for (const prLineToCreate of prLinesToCreate) {
        // Find the created PR line ID
        const createdPrLine = pr.lines.find(pl => pl.itemId === prLineToCreate.itemId);
        if (createdPrLine) {
          // Iterate and update each originating indent line individually to record its specific remaining qty as purchaseQty
          for (const lineId of prLineToCreate.originatingLineIds) {
            // Find the original indent line to get its specific remaining qty
            let remaining = 0;
            for (const ind of indents) {
              const matchingLine = ind.lines.find(l => l.id === lineId);
              if (matchingLine) {
                remaining = matchingLine.qty - matchingLine.issuedQty;
                break;
              }
            }
            await tx.indentLine.update({
              where: { id: lineId },
              data: {
                prLineId: createdPrLine.id,
                purchaseQty: remaining > 0 ? remaining : 0
              }
            });
          }
        }
      }

      // 3. Update all Indents' Statuses
      await tx.indent.updateMany({
        where: {
          id: { in: indentIds }
        },
        data: {
          status: IndentStatus.CONVERTED_TO_PR
        }
      });

      // 4. Log Audit for PR
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "CONVERT_MULTIPLE_TO_PR",
          entity: "PurchaseRequisition",
          entityId: pr.id,
          after: JSON.parse(JSON.stringify(pr))
        }
      });

      return pr;
    });

    revalidatePath("/stores/indents");
    revalidatePath("/purchase/requisitions");
    return { success: true, pr: result };
  } catch (err: any) {
    console.error("Error converting multiple indents to PR:", err);
    return { success: false, error: err.message || "Failed to convert indents to PR" };
  }
}

export async function deleteIssue(id: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.issue.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: true }
    });

    if (!original) return { success: false, error: "Issue not found" };

    await db.$transaction(async (tx) => {
      // Revert indent line issuedQty and stock ledger
      if (original.indentId) {
        for (const line of original.lines) {
          const indentLine = await tx.indentLine.findFirst({
            where: { indentId: original.indentId, itemId: line.itemId }
          });
          if (indentLine) {
            const newIssuedQty = Math.max(0, indentLine.issuedQty - line.qty);
            await tx.indentLine.update({
              where: { id: indentLine.id },
              data: { issuedQty: newIssuedQty }
            });
          }
        }

        // Recalculate parent indent status
        const indent = await tx.indent.findUnique({
          where: { id: original.indentId },
          include: { lines: true }
        });

        if (indent) {
          let nextStatus: IndentStatus = IndentStatus.APPROVED;
          const allIssued = indent.lines.every(l => l.issuedQty >= l.qty);
          const anyIssued = indent.lines.some(l => l.issuedQty > 0);
          if (allIssued) {
            nextStatus = IndentStatus.ISSUED;
          } else if (anyIssued) {
            nextStatus = IndentStatus.PARTIALLY_ISSUED;
          }
          await tx.indent.update({
            where: { id: original.indentId },
            data: { status: nextStatus }
          });
        }
      }

      // Delete stock ledger entries
      await tx.stockLedger.deleteMany({
        where: { companyId, refType: "ISSUE", refId: id }
      });

      // Soft delete the Issue
      const updated = await tx.issue.update({
        where: { id },
        data: { deletedAt: new Date() }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "DELETE_ISSUE",
          entity: "Issue",
          entityId: id,
          before: original as any,
          after: updated as any
        }
      });
    });

    revalidatePath("/stores/outwards");
    revalidatePath("/stores/indents");
    revalidatePath("/stores/reports");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting issue:", err);
    return { success: false, error: err.message || "Failed to delete issue" };
  }
}

export async function bulkDeleteIssues(ids: string[]) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const issues = await db.issue.findMany({
      where: { id: { in: ids }, companyId, deletedAt: null },
      include: { lines: true }
    });

    if (issues.length !== ids.length) {
      return { success: false, error: "Some issues could not be found" };
    }

    await db.$transaction(async (tx) => {
      for (const issue of issues) {
        // Revert indent line issuedQty
        if (issue.indentId) {
          for (const line of issue.lines) {
            const indentLine = await tx.indentLine.findFirst({
              where: { indentId: issue.indentId, itemId: line.itemId }
            });
            if (indentLine) {
              const newIssuedQty = Math.max(0, indentLine.issuedQty - line.qty);
              await tx.indentLine.update({
                where: { id: indentLine.id },
                data: { issuedQty: newIssuedQty }
              });
            }
          }

          // Recalculate parent indent status
          const indent = await tx.indent.findUnique({
            where: { id: issue.indentId },
            include: { lines: true }
          });

          if (indent) {
            let nextStatus: IndentStatus = IndentStatus.APPROVED;
            const allIssued = indent.lines.every(l => l.issuedQty >= l.qty);
            const anyIssued = indent.lines.some(l => l.issuedQty > 0);
            if (allIssued) {
              nextStatus = IndentStatus.ISSUED;
            } else if (anyIssued) {
              nextStatus = IndentStatus.PARTIALLY_ISSUED;
            }
            await tx.indent.update({
              where: { id: issue.indentId },
              data: { status: nextStatus }
            });
          }
        }

        // Delete stock ledger entries
        await tx.stockLedger.deleteMany({
          where: { companyId, refType: "ISSUE", refId: issue.id }
        });

        // Soft delete the Issue
        const updated = await tx.issue.update({
          where: { id: issue.id },
          data: { deletedAt: new Date() }
        });

        // Audit Log
        await tx.auditLog.create({
          data: {
            companyId,
            actorId,
            action: "DELETE_ISSUE",
            entity: "Issue",
            entityId: issue.id,
            before: issue as any,
            after: updated as any
          }
        });
      }
    });

    revalidatePath("/stores/outwards");
    revalidatePath("/stores/indents");
    revalidatePath("/stores/reports");
    return { success: true };
  } catch (err: any) {
    console.error("Error bulk deleting issues:", err);
    return { success: false, error: err.message || "Failed to bulk delete issues" };
  }
}

export async function updateIssue(
  id: string,
  data: {
    storeId: string;
    lines: { itemId: string; qty: number }[];
    deptId?: string | null;
    issuedTo?: string | null;
  }
) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const original = await db.issue.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: true }
    });

    if (!original) return { success: false, error: "Issue not found" };

    const result = await db.$transaction(async (tx) => {
      // 1. Revert original lines on IndentLine and delete stock ledger entries
      if (original.indentId) {
        for (const line of original.lines) {
          const indentLine = await tx.indentLine.findFirst({
            where: { indentId: original.indentId, itemId: line.itemId }
          });
          if (indentLine) {
            const revertedQty = Math.max(0, indentLine.issuedQty - line.qty);
            await tx.indentLine.update({
              where: { id: indentLine.id },
              data: { issuedQty: revertedQty }
            });
          }
        }
      }

      await tx.stockLedger.deleteMany({
        where: { companyId, refType: "ISSUE", refId: id }
      });

      // 2. Fetch fresh indent information (with reverted quantities)
      const indent = original.indentId
        ? await tx.indent.findUnique({
            where: { id: original.indentId },
            include: { lines: true }
          })
        : null;

      // 3. Verify stock availability and apply new line items
      for (const iss of data.lines) {
        if (iss.qty <= 0) continue;

        // Check stock availability in the store
        const stockSum = await tx.stockLedger.aggregate({
          where: { companyId, itemId: iss.itemId, storeId: data.storeId },
          _sum: { qty: true }
        });
        const currentStock = stockSum._sum.qty || 0;

        if (currentStock < iss.qty) {
          throw new Error(`Insufficient stock for item in selected store. Available: ${currentStock}, Requested: ${iss.qty}`);
        }

        // Verify against indent line limits if linked to an indent
        if (indent) {
          const indentLine = indent.lines.find(l => l.itemId === iss.itemId);
          if (!indentLine) throw new Error("Item not found on original indent");

          const newIssuedQty = indentLine.issuedQty + iss.qty;
          if (newIssuedQty > indentLine.qty) {
            throw new Error(`Cannot issue more than the requested quantity of ${indentLine.qty} for item`);
          }

          // Update indent line issuedQty
          await tx.indentLine.update({
            where: { id: indentLine.id },
            data: { issuedQty: newIssuedQty }
          });
        }

        // Post stock ledger entry (negative)
        await postLedgerEntry(tx, {
          companyId,
          itemId: iss.itemId,
          storeId: data.storeId,
          txnType: LedgerTxnType.ISSUE,
          qty: -iss.qty,
          refType: "ISSUE",
          refId: id,
          createdById: actorId,
        });
      }

      // 4. Delete old issue lines and create new ones
      await tx.issueLine.deleteMany({
        where: { issueId: id }
      });

      const updated = await tx.issue.update({
        where: { id },
        data: {
          storeId: data.storeId,
          deptId: data.deptId,
          issuedTo: data.issuedTo,
          lines: {
            create: data.lines.map(l => ({
              itemId: l.itemId,
              qty: l.qty
            }))
          }
        },
        include: { lines: true }
      });

      // 5. Recalculate parent indent status
      if (original.indentId) {
        const freshIndent = await tx.indent.findUnique({
          where: { id: original.indentId },
          include: { lines: true }
        });

        if (freshIndent) {
          let nextStatus: IndentStatus = IndentStatus.APPROVED;
          const allIssued = freshIndent.lines.every(l => l.issuedQty >= l.qty);
          const anyIssued = freshIndent.lines.some(l => l.issuedQty > 0);
          if (allIssued) {
            nextStatus = IndentStatus.ISSUED;
          } else if (anyIssued) {
            nextStatus = IndentStatus.PARTIALLY_ISSUED;
          }
          await tx.indent.update({
            where: { id: original.indentId },
            data: { status: nextStatus }
          });
        }
      }

      // 6. Audit Log
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "UPDATE_ISSUE",
          entity: "Issue",
          entityId: id,
          before: original as any,
          after: updated as any
        }
      });

      return updated;
    });

    revalidatePath("/stores/outwards");
    revalidatePath("/stores/indents");
    revalidatePath("/stores/reports");
    return { success: true, issue: result };
  } catch (err: any) {
    console.error("Error updating issue:", err);
    return { success: false, error: err.message || "Failed to update issue" };
  }
}

export async function createDirectIssue(data: {
  storeId: string;
  deptId?: string | null;
  issuedTo?: string | null;
  lines: Array<{ itemId: string; qty: number }>;
}) {
  const session = await auth();
  if (!session || !session.user) return { success: false, error: "Unauthorized" };

  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;

  try {
    const { storeId, deptId, issuedTo, lines } = data;
    if (!storeId) return { success: false, error: "Store is required" };
    if (!lines || lines.length === 0) return { success: false, error: "Please add at least one item line" };

    const issueNumber = await getNextSequence(companyId, "ISS");

    const result = await db.$transaction(async (tx) => {
      // 1. Create the Issue header
      const newIssue = await tx.issue.create({
        data: {
          companyId,
          number: issueNumber,
          storeId,
          deptId: deptId || null,
          issuedTo: issuedTo || null,
          postedById: actorId,
          postedAt: new Date(),
        }
      });

      // 2. Iterate through lines, check stock, create issueLine, post to stock ledger
      for (const line of lines) {
        if (line.qty <= 0) continue;

        // Check stock
        const stockSum = await tx.stockLedger.aggregate({
          where: { companyId, itemId: line.itemId, storeId },
          _sum: { qty: true }
        });
        const currentStock = stockSum._sum.qty || 0;

        if (currentStock < line.qty) {
          const item = await tx.item.findUnique({
            where: { id: line.itemId },
            select: { name: true }
          });
          throw new Error(`Insufficient stock for item "${item?.name || 'Unknown'}". Available: ${currentStock}, Requested: ${line.qty}`);
        }

        // Create issue line
        await tx.issueLine.create({
          data: {
            issueId: newIssue.id,
            itemId: line.itemId,
            qty: line.qty,
          }
        });

        // Post stock ledger entry (negative)
        await postLedgerEntry(tx, {
          companyId,
          itemId: line.itemId,
          storeId,
          txnType: LedgerTxnType.ISSUE,
          qty: -line.qty,
          refType: "ISSUE",
          refId: newIssue.id,
          createdById: actorId,
        });
      }

      // Log audit entry
      await tx.auditLog.create({
        data: {
          companyId,
          actorId,
          action: "POST_ISSUE",
          entity: "Issue",
          entityId: newIssue.id,
          after: JSON.parse(JSON.stringify(newIssue))
        }
      });

      return newIssue;
    }, {
      maxWait: 15000,
      timeout: 60000
    });

    revalidatePath("/stores/outwards");
    revalidatePath("/stores/indents");
    revalidatePath("/stores/reports");
    return { success: true, issue: result };
  } catch (err: any) {
    console.error("Error creating direct issue:", err);
    return { success: false, error: err.message || "Failed to create direct issue" };
  }
}
