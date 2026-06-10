import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
  const session = await auth();
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Mock response if Gemini API key is placeholder or missing
    const apiKey = process.env.GEMINI_API_KEY;
    const isMock = !apiKey || apiKey === "gemini_api_key_placeholder";

    if (isMock) {
      console.log("Gemini API key not configured. Using simulator mock response.");
      // Wait 1.5 seconds to simulate network lag
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return NextResponse.json({
        success: true,
        data: {
          supplierName: "Sharma Steel Traders",
          invoiceNo: "INV-2026-0891",
          invoiceDate: new Date().toISOString().split("T")[0],
          poNo: "PO-00001",
          lineItems: [
            {
              itemCode: "RM-0001",
              description: "Mild Steel Sheet 2.0mm",
              quantity: 250,
              rate: 65.5,
            },
          ],
        },
      });
    }

    // Call real Gemini API
    const genAI = new GoogleGenerativeAI(apiKey!);
    // Using gemini-1.5-flash as a stable standard model
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const filePart = {
      inlineData: {
        data: buffer.toString("base64"),
        mimeType: file.type,
      },
    };

    const prompt = `
      You are an expert OCR parser for manufacturing invoices and delivery challans.
      Extract information from the attached document and output a JSON object adhering exactly to this TypeScript schema:
      
      {
        supplierName?: string;
        invoiceNo?: string;
        invoiceDate?: string; // Format: YYYY-MM-DD
        poNo?: string; // Search for PO ref numbers
        lineItems: Array<{
          itemCode?: string; // Look for part numbers or item codes
          description: string;
          quantity: number;
          rate?: number;
        }>
      }
      
      Return ONLY the raw JSON block without markdown wrappers.
    `;

    const result = await model.generateContent([prompt, filePart]);
    const text = result.response.text();
    
    // Parse response
    const parsedData = JSON.parse(text.trim());

    return NextResponse.json({
      success: true,
      data: parsedData,
    });
  } catch (err: any) {
    console.error("OCR Extraction Error:", err);
    return NextResponse.json({
      error: err.message || "Failed to process image through OCR",
    }, { status: 500 });
  }
}
