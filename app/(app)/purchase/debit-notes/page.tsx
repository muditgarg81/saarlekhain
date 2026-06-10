import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import DebitNotesList from "./DebitNotesList";
import { getFreshUser } from "@/app/actions/auth";

export default async function DebitNotesPage() {
  const user = await getFreshUser();
  if (!user) {
    redirect("/auth/signin");
  }

  const companyId = user.companyId;

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
      user={user}
    />
  );
}
