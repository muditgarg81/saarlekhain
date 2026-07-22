export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getItemValuation } from "@/lib/stock";
import StoresReportsList from "./StoresReportsList";

export default async function StoresReportsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";

  // Query categories, items, active indent lines, and active PO lines
  const [items, categories, activeIndentLines, activePoLines] = await Promise.all([
    db.item.findMany({
      where: {
        companyId,
        deletedAt: null,
      },
      include: {
        company: true,
      },
      orderBy: {
        code: "asc",
      },
    }),
    db.itemCategory.findMany({
      where: {
        companyId,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    db.indentLine.findMany({
      where: {
        indent: {
          companyId,
          status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_ISSUED"] },
        },
      },
      select: {
        itemId: true,
        qty: true,
        issuedQty: true,
      },
    }),
    db.poLine.findMany({
      where: {
        po: {
          companyId,
          status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] },
        },
      },
      select: {
        itemId: true,
        qty: true,
        receivedQty: true,
      },
    }),
  ]);

  // Compute derived stock valuation details for every item
  const stockRows = await Promise.all(
    items.map(async (item) => {
      const valuation = await getItemValuation(companyId, item.id);
      const cat = categories.find((c) => c.id === item.categoryId);

      let procurementStatus: "INDENTED" | "PO_ISSUED" | "NONE" = "NONE";
      const hasActivePo = activePoLines.some((pl) => pl.itemId === item.id && pl.qty > pl.receivedQty);
      const hasActiveIndent = activeIndentLines.some((il) => il.itemId === item.id && il.qty > il.issuedQty);

      if (hasActivePo) {
        procurementStatus = "PO_ISSUED";
      } else if (hasActiveIndent) {
        procurementStatus = "INDENTED";
      }
      
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        categoryName: cat?.name || "Uncategorized",
        qty: valuation.qty,
        valuationRate: valuation.valuationRate,
        totalValue: valuation.totalValue,
        reorderLevel: item.reorderLevel,
        qcRequired: item.qcRequired,
        baseUom: item.baseUom,
        procurementStatus,
      };
    })
  );

  // Compute aggregates
  let totalCompanyValuation = 0;
  let lowStockItemsCount = 0;
  const totalItemsCount = stockRows.length;

  stockRows.forEach((row) => {
    totalCompanyValuation += row.totalValue;
    if (row.qty < row.reorderLevel) {
      lowStockItemsCount++;
    }
  });

  return (
    <StoresReportsList
      stockData={stockRows}
      categories={categories}
      totalCompanyValuation={totalCompanyValuation}
      totalItemsCount={totalItemsCount}
      lowStockItemsCount={lowStockItemsCount}
    />
  );
}
