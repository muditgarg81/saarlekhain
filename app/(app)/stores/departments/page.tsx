import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import DepartmentsClient from "./DepartmentsClient";

export default async function DepartmentsPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";

  // Query departments along with active item counts
  const departments = await db.department.findMany({
    where: {
      companyId,
    },
    include: {
      _count: {
        select: {
          items: {
            where: {
              deletedAt: null,
            },
          },
        },
      },
    },
    orderBy: {
      code: "asc",
    },
  });

  // Map to plain objects for safe client boundaries
  const plainDepartments = departments.map((dept) => ({
    id: dept.id,
    code: dept.code,
    name: dept.name,
    parentId: dept.parentId,
    itemCount: dept._count.items,
  }));

  return (
    <DepartmentsClient 
      initialDepartments={plainDepartments} 
    />
  );
}
