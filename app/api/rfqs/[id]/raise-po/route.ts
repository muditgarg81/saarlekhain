import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getNextSequence } from "@/lib/sequences";
import { PoStatus, PoType, PrStatus, IndentStatus, LineStatus, RfqLineStatus, RfqStatus } from "@prisma/client";
import { can } from "@/lib/rbac";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can(session.user as any, "rfq.award")) {
    return NextResponse.json({ error: "Forbidden: You do not have permission to award RFQs." }, { status: 403 });
  }
  const companyId = (session.user as any).companyId;
  const actorId = (session.user as any).id;
  const { id: rfqId } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const { paymentTerms, freightTerms, shipTo, termsConditions, termsPresetId } = body;

    const rfq = await db.rfq.findFirst({
      where: { id: rfqId, companyId },
      include: {
        lines: {
          include: {
            prLine: {
              include: {
                indentLines: true,
              }
            }
          }
        }
      }
    });

    if (!rfq) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    if (rfq.status !== RfqStatus.AWARDED) {
      return NextResponse.json({ error: "RFQ is not in AWARDED status. Please complete awards first." }, { status: 400 });
    }

    // Fetch allocations for this RFQ
    const rfqLineIds = rfq.lines.map((l) => l.id);
    const allocations = await db.awardAllocation.findMany({
      where: { rfqLineId: { in: rfqLineIds }, companyId }
    });

    if (allocations.length === 0) {
      return NextResponse.json({ error: "No awards found for this RFQ" }, { status: 400 });
    }

    // Fetch items and vendors for MOQ and minOrderValue checks
    const itemIds = rfq.lines.map((l) => l.itemId);
    const items = await db.item.findMany({
      where: { id: { in: itemIds }, companyId }
    });

    const vendorIds = Array.from(new Set(allocations.map((a) => a.vendorId)));
    const vendors = await db.vendor.findMany({
      where: { id: { in: vendorIds }, companyId }
    });

    // Group allocations by vendorId
    const vendorAllocations: { [vendorId: string]: typeof allocations } = {};
    for (const alloc of allocations) {
      if (!vendorAllocations[alloc.vendorId]) {
        vendorAllocations[alloc.vendorId] = [];
      }
      vendorAllocations[alloc.vendorId].push(alloc);
    }

    const defaultPreset = await db.poTermsPreset.findFirst({
      where: {
        OR: [
          { companyId: null },
          { companyId }
        ],
        appliesTo: { has: PoType.REGULAR },
        isDefault: true,
        status: "ACTIVE"
      }
    });

    const poIds: string[] = [];
    const warnings: string[] = [];

    // Robust, stable idempotency key signature based on the specific allocations content
    const sortedAllocContent = allocations
      .map((a) => `${a.quotationLineId}:${a.qty}`)
      .sort()
      .join(",");
    const idempotencyKey = `rfq-to-po-${rfqId}-${sortedAllocContent}`;

    // Run PO raising inside a transaction
    const result = await db.$transaction(async (tx) => {
      // Check idempotency first
      const existingConv = await tx.flowConversion.findFirst({
        where: { companyId, idempotencyKey }
      });
      if (existingConv) {
        // Find existing POs raised for this RFQ
        const existingPos = await tx.purchaseOrder.findMany({
          where: {
            companyId,
            lines: {
              some: {
                rfqLineId: {
                  in: rfqLineIds
                }
              }
            }
          },
          select: { id: true }
        });
        return { success: true, poIds: existingPos.map((p) => p.id), warnings: [] };
      }

      // Create PO for each vendor group
      for (const [vendorId, allocs] of Object.entries(vendorAllocations)) {
        const vendor = vendors.find((v) => v.id === vendorId);
        const poNumber = await getNextSequence(companyId, "PO");

        // Fetch Quotation to get freight and packingCharges
        const quotation = await tx.quotation.findFirst({
          where: { rfqId, vendorId, companyId }
        });
        const otherCharges = quotation ? (quotation.freight || 0) + (quotation.packingCharges || 0) : 0;

        // Compute PO lines details
        const poLinesData = [];
        let totalTaxable = 0;

        for (const alloc of allocs) {
          const rfqLine = rfq.lines.find((l) => l.id === alloc.rfqLineId)!;
          const item = items.find((i) => i.id === rfqLine.itemId)!;
          
          // Fetch quote line to get rate, discount, gstRate
          const qLine = await tx.quotationLine.findUnique({
            where: { id: alloc.quotationLineId },
          });

          if (!qLine) {
            throw new Error(`Quotation line not found for allocation ${alloc.id}`);
          }

          poLinesData.push({
            itemId: rfqLine.itemId,
            qty: alloc.qty,
            rate: qLine.rate,
            discount: qLine.discount,
            gstRate: qLine.gstRate,
            quotationLineId: qLine.id,
            rfqLineId: rfqLine.id,
            prLineId: rfqLine.prLineId,
            allocationId: alloc.id, // helper reference
            moq: item.moq,
            itemCode: item.code,
          });

          const basicTaxable = alloc.qty * qLine.rate * (1 - qLine.discount / 100);
          totalTaxable += basicTaxable;
        }

        // Calculate landed PO total value including pro-rata otherCharges
        let poTotalValue = 0;
        for (const pld of poLinesData) {
          const taxable = pld.qty * pld.rate * (1 - pld.discount / 100);
          const allocatedOtherCharges = totalTaxable > 0 ? otherCharges * (taxable / totalTaxable) : 0;
          const landedLine = (taxable + allocatedOtherCharges) * (1 + pld.gstRate / 100);
          poTotalValue += landedLine;

          // Check item MOQ warning
          if (pld.qty < pld.moq) {
            warnings.push(`MOQ Warning: Quantity (${pld.qty}) for item [${pld.itemCode}] is below its MOQ (${pld.moq}) for vendor "${vendor?.name || vendorId}".`);
          }
        }

        // Check vendor minimum order value warning
        if (vendor && poTotalValue < vendor.minOrderValue) {
          warnings.push(`Min Value Warning: PO total value (₹${poTotalValue.toFixed(0)}) is below vendor "${vendor.name}"'s minimum order value of ₹${vendor.minOrderValue.toFixed(0)}.`);
        }

        // Create PO
        const po = await tx.purchaseOrder.create({
          data: {
            companyId,
            number: poNumber,
            vendorId,
            status: PoStatus.PENDING_APPROVAL,
            prId: rfq.prId,
            paymentTerms: paymentTerms || quotation?.paymentTerms || vendor?.paymentTerms || "Net 30",
            freightTerms: freightTerms || "FOB Destination",
            shipTo: shipTo || "Main Warehouse Gate 1",
            termsConditions: termsConditions || null,
            termsPresetId: termsPresetId !== undefined ? termsPresetId : (defaultPreset?.id || null),
            otherCharges: otherCharges,
            lines: {
              create: poLinesData.map((pld) => ({
                itemId: pld.itemId,
                qty: pld.qty,
                rate: pld.rate,
                discount: pld.discount,
                gstRate: pld.gstRate,
                quotationLineId: pld.quotationLineId,
                rfqLineId: pld.rfqLineId,
                prLineId: pld.prLineId,
              }))
            }
          },
          include: {
            lines: true,
          }
        });

        poIds.push(po.id);

        // Update allocations with generated poLineIds
        for (const poLine of po.lines) {
          const matchingPld = poLinesData.find((pld) => pld.itemId === poLine.itemId && pld.rfqLineId === poLine.rfqLineId);
          if (matchingPld) {
            await tx.awardAllocation.update({
              where: { id: matchingPld.allocationId },
              data: { poLineId: poLine.id }
            });
          }
        }
      }

      // --- Propagation & Status Updates ---

      // 1. Update quantities up the trace chain
      for (const alloc of allocations) {
        const rfqLine = rfq.lines.find((l) => l.id === alloc.rfqLineId)!;

        // RfqLine awardedQty
        const updatedRfqLine = await tx.rfqLine.update({
          where: { id: rfqLine.id },
          data: {
            awardedQty: { increment: alloc.qty }
          }
        });

        // PrLine orderedQty
        if (rfqLine.prLineId) {
          const updatedPrLine = await tx.prLine.update({
            where: { id: rfqLine.prLineId },
            data: {
              orderedQty: { increment: alloc.qty }
            }
          });

          // IndentLine orderedQty
          const indentLines = rfqLine.prLine?.indentLines || [];
          for (const indLine of indentLines) {
            await tx.indentLine.update({
              where: { id: indLine.id },
              data: {
                orderedQty: { increment: alloc.qty }
              }
            });
          }
        }
      }

      // 2. Recompute and save line and header statuses
      for (const rfqLine of rfq.lines) {
        // Fetch fresh RfqLine data
        const freshRfqLine = await tx.rfqLine.findUnique({
          where: { id: rfqLine.id },
          include: { quotationLines: true }
        });

        if (freshRfqLine) {
          const rfqLineAllocations = await tx.awardAllocation.findMany({
            where: { rfqLineId: freshRfqLine.id, companyId }
          });
          const totalAllocated = rfqLineAllocations.reduce((sum: number, a: any) => sum + a.qty, 0);

          let rfqLineStatus: RfqLineStatus = RfqLineStatus.OPEN;
          if (totalAllocated >= freshRfqLine.qty) {
            rfqLineStatus = RfqLineStatus.CLOSED;
          } else if (totalAllocated > 0) {
            rfqLineStatus = RfqLineStatus.PARTIALLY_AWARDED;
          } else {
            const activeQuotes = freshRfqLine.quotationLines.filter((q: any) => q.canSupply);
            if (activeQuotes.length === 0) {
              rfqLineStatus = RfqLineStatus.UNCOVERED;
            } else {
              const totalAvailable = activeQuotes.reduce((sum: number, q: any) => sum + (q.quotedQty ?? freshRfqLine.qty), 0);
              if (totalAvailable < freshRfqLine.qty) {
                rfqLineStatus = RfqLineStatus.SHORT;
              } else {
                rfqLineStatus = RfqLineStatus.QUOTED;
              }
            }
          }

          await tx.rfqLine.update({
            where: { id: freshRfqLine.id },
            data: { status: rfqLineStatus }
          });
        }

        // Recompute PrLine status
        if (rfqLine.prLineId) {
          const prLine = await tx.prLine.findUnique({
            where: { id: rfqLine.prLineId }
          });
          if (prLine) {
            const open = prLine.qty - prLine.orderedQty - prLine.shortClosedQty;
            let prLineStatus: LineStatus = LineStatus.OPEN;
            if (open <= 0) {
              prLineStatus = prLine.shortClosedQty === prLine.qty ? LineStatus.SHORT_CLOSED : LineStatus.ORDERED;
            } else if (prLine.orderedQty > 0) {
              prLineStatus = LineStatus.PARTIALLY_ORDERED;
            }

            await tx.prLine.update({
              where: { id: prLine.id },
              data: { status: prLineStatus, poRaised: open <= 0 }
            });
          }

          // Recompute IndentLines statuses
          const indentLinesList = rfqLine.prLine?.indentLines || [];
          for (const indLine of indentLinesList) {
            const indentLine = await tx.indentLine.findUnique({
              where: { id: indLine.id }
            });
            if (indentLine) {
              const open = indentLine.qty - indentLine.orderedQty - indentLine.issuedQty - indentLine.shortClosedQty;
              let indentLineStatus: LineStatus = LineStatus.OPEN;
              if (open <= 0) {
                if (indentLine.shortClosedQty === indentLine.qty) {
                  indentLineStatus = LineStatus.SHORT_CLOSED;
                } else if (indentLine.issuedQty >= indentLine.qty - indentLine.shortClosedQty) {
                  indentLineStatus = LineStatus.ISSUED;
                } else {
                  indentLineStatus = LineStatus.ORDERED;
                }
              } else if (indentLine.orderedQty > 0 || indentLine.issuedQty > 0) {
                indentLineStatus = LineStatus.PARTIALLY_ORDERED;
              }

              await tx.indentLine.update({
                where: { id: indentLine.id },
                data: { status: indentLineStatus }
              });
            }
          }
        }
      }

      // 3. Roll up header statuses
      
      // Update RFQ status
      const freshRfqLines = await tx.rfqLine.findMany({
        where: { rfqId }
      });
      const allRfqLinesClosed = freshRfqLines.every((l) => l.status === RfqLineStatus.CLOSED);
      await tx.rfq.update({
        where: { id: rfqId },
        data: { status: allRfqLinesClosed ? RfqStatus.CLOSED : RfqStatus.AWARDED }
      });

      // Update PR status
      if (rfq.prId) {
        const pr = await tx.purchaseRequisition.findUnique({
          where: { id: rfq.prId },
          include: { lines: true }
        });
        if (pr) {
          const allPrLinesTerminal = pr.lines.every((l) =>
            ([LineStatus.ORDERED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
          );
          const somePrLinesOrdered = pr.lines.some((l) =>
            ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED] as LineStatus[]).includes(l.status)
          );

          let nextPrStatus: PrStatus = PrStatus.RFQ_ISSUED;
          if (allPrLinesTerminal) {
            const allShortClosed = pr.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
            nextPrStatus = allShortClosed ? PrStatus.SHORT_CLOSED : PrStatus.CLOSED;
          } else if (somePrLinesOrdered) {
            nextPrStatus = PrStatus.PARTIALLY_ORDERED;
          }

          await tx.purchaseRequisition.update({
            where: { id: pr.id },
            data: { status: nextPrStatus }
          });
        }
      }

      // Update Indent status
      const indentIds = Array.from(new Set(rfq.lines.flatMap((l) => l.prLine?.indentLines.map((il) => il.indentId) || []).filter(Boolean)));
      for (const indentId of indentIds) {
        const indent = await tx.indent.findUnique({
          where: { id: indentId },
          include: { lines: true }
        });
        if (indent) {
          const allIndentLinesTerminal = indent.lines.every((l) =>
            ([LineStatus.ORDERED, LineStatus.ISSUED, LineStatus.SHORT_CLOSED, LineStatus.CANCELLED] as LineStatus[]).includes(l.status)
          );
          const someIndentLinesOrdered = indent.lines.some((l) =>
            ([LineStatus.ORDERED, LineStatus.PARTIALLY_ORDERED, LineStatus.ISSUED] as LineStatus[]).includes(l.status)
          );

          let nextIndentStatus: IndentStatus = IndentStatus.CONVERTED_TO_PR;
          if (allIndentLinesTerminal) {
            const allShortClosed = indent.lines.every((l) => l.status === LineStatus.SHORT_CLOSED);
            nextIndentStatus = allShortClosed ? IndentStatus.SHORT_CLOSED : IndentStatus.CLOSED;
          } else if (someIndentLinesOrdered) {
            nextIndentStatus = IndentStatus.PARTIALLY_ORDERED;
          }

          await tx.indent.update({
            where: { id: indent.id },
            data: { status: nextIndentStatus }
          });
        }
      }

      // Idempotency conversion logging
      await tx.flowConversion.create({
        data: {
          companyId,
          step: "RFQ_TO_PO",
          sourceId: rfqId,
          idempotencyKey
        }
      });

      await logAudit(tx, companyId, actorId, "RAISE_PO_FROM_AWARD", "Rfq", rfqId, null, { poIds });

      return { success: true, poIds, warnings };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Error raising POs from award:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}

async function logAudit(
  tx: any,
  companyId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  before: any,
  after: any
) {
  await tx.auditLog.create({
    data: {
      companyId,
      actorId,
      action,
      entity,
      entityId,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null,
    },
  });
}
