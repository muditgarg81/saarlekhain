export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { getFreshUser } from "@/app/actions/auth";
import { db } from "@/lib/db";
import PrintActions from "./PrintActions";

export default async function TransportOrderPrintPage({ params }: { params: { id: string } }) {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");

  const order = await db.transportOrder.findFirst({
    where: { id: params.id, companyId: user.companyId, deletedAt: null },
    include: {
      transporter: true,
      po: true,
      bills: { where: { deletedAt: null }, include: { payments: true } },
    },
  });

  if (!order) notFound();

  const company = await db.company.findUnique({ where: { id: user.companyId } });

  const totalBilled = order.bills.reduce((s, b) => s + b.amount, 0);
  const totalPaid = order.bills.reduce((s, b) => s + b.payments.reduce((ps, p) => ps + p.amount, 0), 0);

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          .page { box-shadow: none !important; margin: 0 !important; padding: 24px !important; }
        }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f0e8; margin: 0; }
      `}</style>

      <PrintActions />

      <div className="page max-w-3xl mx-auto bg-white shadow-lg p-10 my-4 rounded-lg text-sm text-gray-800">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-yellow-500 pb-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{company?.name || "Company"}</h1>
            <p className="text-xs text-gray-500 mt-1">{company?.address || ""}</p>
            {company?.gstin && <p className="text-xs text-gray-500">GSTIN: {company.gstin}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-yellow-600 uppercase tracking-wide">Transport Order</h2>
            <p className="font-mono font-bold text-lg text-gray-900 mt-1">{order.number}</p>
            <p className="text-xs text-gray-500 mt-1">Date: {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
            <span className={`inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full mt-1 ${
              order.status === "DELIVERED" ? "bg-green-100 text-green-800" :
              order.status === "IN_TRANSIT" ? "bg-blue-100 text-blue-800" :
              order.status === "CANCELLED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
            }`}>{order.status.replace("_", " ")}</span>
          </div>
        </div>

        {/* Transporter & Route */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Transporter</p>
            <p className="font-bold text-gray-900">{order.transporter.name}</p>
            <p className="text-xs text-gray-500 font-mono">{order.transporter.code}</p>
            {order.transporter.gstin && <p className="text-xs text-gray-500 mt-1">GSTIN: {order.transporter.gstin}</p>}
            {order.transporter.address && <p className="text-xs text-gray-500 mt-1">{order.transporter.address}</p>}
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Route Details</p>
            <div className="flex items-center gap-2 font-semibold text-gray-900">
              <span>{order.fromLocation}</span>
              <span className="text-yellow-500">→</span>
              <span>{order.toLocation}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Vehicle Capacity: {order.vehicleCapacity}</p>
            {order.loadingPoint && <p className="text-xs text-gray-500">Loading: {order.loadingPoint}</p>}
            {order.unloadingPoint && <p className="text-xs text-gray-500">Unloading: {order.unloadingPoint}</p>}
          </div>
        </div>

        {/* Vehicle & Driver */}
        {(order.vehicleNo || order.driverName) && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            {order.vehicleNo && (
              <div>
                <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Vehicle No.</p>
                <p className="font-mono font-semibold text-gray-900 mt-1">{order.vehicleNo}</p>
              </div>
            )}
            {order.driverName && (
              <div>
                <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Driver</p>
                <p className="font-semibold text-gray-900 mt-1">{order.driverName}</p>
              </div>
            )}
            {order.driverPhone && (
              <div>
                <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Driver Phone</p>
                <p className="font-semibold text-gray-900 mt-1">{order.driverPhone}</p>
              </div>
            )}
          </div>
        )}

        {/* Trip Description */}
        {order.tripDescription && (
          <div className="mb-6 border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-1">Trip Description / Remarks</p>
            <p className="text-sm text-gray-700">{order.tripDescription}</p>
          </div>
        )}

        {/* Linked PO */}
        {order.po && (
          <div className="mb-6">
            <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Linked Purchase Order</p>
            <p className="font-mono font-semibold text-gray-900 mt-1">{order.po.number}</p>
          </div>
        )}

        {/* Freight Cost */}
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="p-3 text-left font-bold uppercase text-xs text-gray-500">Description</th>
                <th className="p-3 text-right font-bold uppercase text-xs text-gray-500">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="p-3 text-gray-700">Base Freight Charges</td>
                <td className="p-3 text-right font-mono">{order.freightAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              </tr>
              {order.otherCharges > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="p-3 text-gray-700">Other / Toll Charges</td>
                  <td className="p-3 text-right font-mono">{order.otherCharges.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                </tr>
              )}
              {order.taxRate > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="p-3 text-gray-500">GST @ {order.taxRate}%</td>
                  <td className="p-3 text-right font-mono text-gray-500">
                    {((order.freightAmount + order.otherCharges) * order.taxRate / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )}
              <tr className="bg-yellow-50">
                <td className="p-3 font-bold text-gray-900">Total Freight Cost</td>
                <td className="p-3 text-right font-mono font-bold text-gray-900 text-base">
                  ₹{order.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Payment Summary */}
        {order.bills.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6 text-center">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] font-bold uppercase text-gray-400">Billed</p>
              <p className="font-mono font-bold text-gray-900 mt-1">₹{totalBilled.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-[10px] font-bold uppercase text-gray-400">Paid</p>
              <p className="font-mono font-bold text-green-700 mt-1">₹{totalPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-[10px] font-bold uppercase text-gray-400">Balance</p>
              <p className="font-mono font-bold text-red-600 mt-1">₹{(totalBilled - totalPaid).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        {/* Signature block */}
        <div className="grid grid-cols-2 gap-8 mt-10 pt-6 border-t border-gray-200">
          <div>
            <div className="h-12 border-b border-gray-400 mb-2" />
            <p className="text-xs text-gray-500 text-center">Authorised Signatory</p>
            <p className="text-xs text-gray-400 text-center">{company?.name || ""}</p>
          </div>
          <div>
            <div className="h-12 border-b border-gray-400 mb-2" />
            <p className="text-xs text-gray-500 text-center">Transporter Acknowledgement</p>
            <p className="text-xs text-gray-400 text-center">{order.transporter.name}</p>
          </div>
        </div>

        <p className="text-[10px] text-gray-400 text-center mt-6">
          Generated on {new Date().toLocaleString("en-IN")} · {order.number}
        </p>
      </div>

    </>
  );
}
