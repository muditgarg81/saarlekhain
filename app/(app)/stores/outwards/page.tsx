export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import OutwardsList from "./OutwardsList";

export default async function OutwardsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch all necessary data concurrently
  const [
    issues,
    gatePasses,
    items,
    vendors,
    stores,
    departments,
    indents,
    users
  ] = await Promise.all([
    db.issue.findMany({
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
    db.gatePass.findMany({
      where: {
        companyId,
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
    db.vendor.findMany({
      where: {
        companyId,
        status: "APPROVED",
        deletedAt: null,
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
    db.store.findMany({
      where: {
        companyId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
      },
    }),
    db.department.findMany({
      where: {
        companyId,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    db.indent.findMany({
      where: {
        companyId,
      },
      select: {
        id: true,
        number: true,
      },
    }),
    db.user.findMany({
      where: {
        companyId,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    }),
  ]);

  // Map issues to UI shape
  const mappedIssues = issues.map((iss) => {
    const store = stores.find((s) => s.id === iss.storeId);
    const dept = departments.find((d) => d.id === iss.deptId);
    const indent = indents.find((i) => i.id === iss.indentId);
    const user = users.find((u) => u.id === iss.postedById);

    return {
      id: iss.id,
      number: iss.number,
      type: iss.type,
      storeName: store?.name || "Unknown Store",
      deptName: dept?.name || null,
      deptId: iss.deptId,
      issuedTo: iss.issuedTo,
      indentNumber: indent?.number || null,
      postedBy: user?.name || user?.email || "Unknown",
      postedAt: iss.postedAt?.toISOString() || iss.createdAt.toISOString(),
      lines: iss.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
        };
      }),
    };
  });

  // Map gate passes to UI shape
  const mappedGatePasses = gatePasses.map((gp) => {
    const vendor = vendors.find((v) => v.id === gp.vendorId);

    return {
      id: gp.id,
      number: gp.number,
      type: gp.type,
      status: gp.status,
      vendorName: vendor?.name || null,
      purpose: gp.purpose,
      dueBack: gp.dueBack ? gp.dueBack.toISOString() : null,
      createdAt: gp.createdAt.toISOString(),
      lines: gp.lines.map((line) => {
        const item = items.find((i) => i.id === line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          itemName: item?.name || "Unknown Item",
          itemCode: item?.code || "N/A",
          qty: line.qty,
          returnedQty: line.returnedQty,
        };
      }),
    };
  });

  return (
    <OutwardsList
      issues={mappedIssues}
      gatePasses={mappedGatePasses}
      items={items}
      vendors={vendors}
      stores={stores}
      departments={departments}
      userRole={userRole}
    />
  );
}
