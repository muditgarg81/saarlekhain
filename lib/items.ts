import { db } from "./db";

/**
 * Generates the next sequential item code according to the company's ItemCodeScheme.
 * 
 * @param companyId The ID of the tenant company
 * @param categoryCode The prefix code of the item category (e.g., "RM", "CONS")
 * @returns The next auto-generated item code
 */
export async function generateNextItemCode(
  companyId: string,
  categoryCode: string
): Promise<string> {
  // Get company code scheme
  const scheme = await db.itemCodeScheme.findUnique({
    where: { companyId },
  });

  const separator = scheme?.separator || "-";
  const prefix = categoryCode.toUpperCase();

  // Find the last item created in this category
  const lastItem = await db.item.findFirst({
    where: {
      companyId,
      code: {
        startsWith: `${prefix}${separator}`,
      },
    },
    orderBy: {
      code: "desc",
    },
  });

  let nextSerial = 1;

  if (lastItem) {
    // Extract the serial number from the code (e.g., "RM-0012" -> "0012" -> 12)
    const parts = lastItem.code.split(separator);
    const lastSerialPart = parts[parts.length - 1];
    const parsed = parseInt(lastSerialPart, 10);
    if (!isNaN(parsed)) {
      nextSerial = parsed + 1;
    }
  }

  // Width of serial number segment (default 4, e.g. "0001")
  let width = 4;
  if (scheme && Array.isArray(scheme.segments)) {
    const serialSeg = (scheme.segments as any[]).find(
      (s) => s.type === "SERIAL" || s.seg === "SERIAL"
    );
    if (serialSeg && typeof serialSeg.width === "number") {
      width = serialSeg.width;
    }
  }

  const paddedSerial = String(nextSerial).padStart(width, "0");
  return `${prefix}${separator}${paddedSerial}`;
}
