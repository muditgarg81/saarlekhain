import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import DebitNotesList from "./DebitNotesList";

export default async function DebitNotesPage() {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/auth/signin");
  }

  const companyId = (session.user as any).companyId || "demo-company-id";
  const userRole = (session.user as any).role || "VIEWER";

  // Fetch Debit / Credit Notes and Vendors concurrently
  const [notes, vendors] = await Promise.all([
    db.debitCreditNote.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" }
    }),
    db.vendor.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" }
    })
  ]);

  // Map to clean serializable objects for the client
  const mappedNotes = notes.map((n) => {
    const vendor = vendors.find((v) => v.id === n.vendorId);
    return {
      id: n.id,
      number: n.number,
      type: n.type,
      vendorId: n.vendorId,
      vendorName: vendor ? vendor.name : "Unknown Vendor",
      refType: n.refType,
      refId: n.refId,
      amount: n.amount,
      posted: n.posted,
      createdAt: n.createdAt.toISOString()
    };
  });

  return (
    <DebitNotesList
      notes={mappedNotes}
      vendors={vendors}
      userRole={userRole}
    />
  );
}
