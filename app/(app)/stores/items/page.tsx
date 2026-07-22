export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import ItemMasterList from "./ItemMasterList";

export default async function ItemsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";

  // Query categories, items and departments from the multi-schema db
  const [items, categories, departments] = await Promise.all([
    db.item.findMany({
      where: {
        companyId,
        deletedAt: null,
      },
      orderBy: {
        code: "asc",
      },
    }),
    db.itemCategory.findMany({
      where: {
        companyId,
      },
      orderBy: {
        code: "asc",
      },
    }),
    db.department.findMany({
      where: {
        companyId,
      },
      orderBy: {
        code: "asc",
      },
    }),
  ]);

  // Transform model instances into plain JS objects to cross the client/server boundary safely
  const plainItems = items.map(item => ({
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.description,
    categoryId: item.categoryId,
    departmentId: item.departmentId,
    type: item.type,
    baseUom: item.baseUom,
    altUom: item.altUom,
    altUomFactor: item.altUomFactor,
    make: item.make,
    specification: item.specification,
    hsnCode: item.hsnCode,
    gstRate: item.gstRate,
    reorderLevel: item.reorderLevel,
    minStock: item.minStock,
    maxStock: item.maxStock,
    leadTimeDays: item.leadTimeDays,
    shelfLifeDays: item.shelfLifeDays,
    qcRequired: item.qcRequired,
    valuation: item.valuation,
    status: item.status,
  }));

  const plainCategories = categories.map(cat => ({
    id: cat.id,
    code: cat.code,
    name: cat.name,
  }));

  const plainDepartments = departments.map(dept => ({
    id: dept.id,
    code: dept.code,
    name: dept.name,
    parentId: dept.parentId,
  }));

  return (
    <ItemMasterList 
      initialItems={plainItems} 
      categories={plainCategories} 
      departments={plainDepartments}
    />
  );
}
