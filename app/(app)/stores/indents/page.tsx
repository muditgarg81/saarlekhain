export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import IndentsList from "./IndentsList";

export default async function IndentsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch indents, items, and stores concurrently
  const [indents, items, stores] = await Promise.all([
    db.indent.findMany({
      where: {
        companyId,
        deletedAt: null,
      },
      include: {
        lines: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.item.findMany({
      where: {
        companyId,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        baseUom: true,
      },
      orderBy: {
        code: "asc",
      },
    }),
    db.store.findMany({
      where: {
        companyId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        code: true,
      },
      orderBy: {
        code: "asc",
      },
    }),
  ]);

  // Fetch all user and department names for display mapping
  const users = await db.user.findMany({
    where: { companyId },
    select: { id: true, name: true, email: true },
  });

  const departments = await db.department.findMany({
    where: { companyId },
    select: { id: true, name: true },
  });

  // Fetch all stock sums grouped by item
  const stockSums = await db.stockLedger.groupBy({
    by: ['itemId'],
    where: { companyId },
    _sum: {
      qty: true
    }
  });

  // Map database instances to clean serializable props for the client
  const mappedIndents = indents.map((ind) => {
    const requester = users.find((u) => u.id === ind.requestedById);
    const dept = departments.find((d) => d.id === ind.deptId);

    return {
      id: ind.id,
      number: ind.number,
      priority: ind.priority,
      purpose: ind.purpose,
      status: ind.status,
      requestedBy: requester?.name || requester?.email || "Unknown",
      department: dept?.name || "N/A",
      deptId: ind.deptId,
      createdAt: ind.createdAt.toISOString(),
      lines: ind.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        const stockSum = stockSums.find((s) => s.itemId === line.itemId);
        const currentStock = stockSum?._sum.qty || 0;

        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
          issuedQty: line.issuedQty,
          stockQty: currentStock,
          requiredBy: line.requiredBy ? line.requiredBy.toISOString() : null,
          remarks: line.remarks,
        };
      }),
    };
  });

  return (
    <IndentsList
      initialIndents={mappedIndents}
      items={items}
      stores={stores}
      departments={departments}
      userRole={userRole}
    />
  );
}
