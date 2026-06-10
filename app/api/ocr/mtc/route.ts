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

    const apiKey = process.env.GEMINI_API_KEY;
    const isMock = !apiKey || apiKey === "gemini_api_key_placeholder";

    if (isMock) {
      console.log("Gemini API key not configured. Using mock response for MTC.");
      // Wait 1.5 seconds to simulate network lag
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return NextResponse.json({
        success: true,
        data: {
          mtcRef: "MTC-SHARMA-9012",
          parameters: [
            { name: "Thickness (mm)", value: 2.02, pass: true },
            { name: "Width (mm)", value: 1201, pass: true },
            { name: "Hardness (HRB)", value: 58, pass: true }
          ]
        }
      });
    }

    // Call real Gemini API
    const genAI = new GoogleGenerativeAI(apiKey!);
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
      You are an expert material test certificate (MTC) parser.
      Extract information from the attached test report and output a JSON object adhering exactly to this schema:
      
      {
        mtcRef?: string; // Certificate, test report, or heat number
        parameters: Array<{
          name: string; // e.g. Thickness, Hardness, Tensile strength
          value: number; // Numeric value observed
        }>
      }
      
      Return ONLY raw JSON block.
    `;

    const result = await model.generateContent([prompt, filePart]);
    const text = result.response.text();
    const parsedData = JSON.parse(text.trim());

    return NextResponse.json({
      success: true,
      data: parsedData,
    });
  } catch (err: any) {
    console.error("MTC OCR Error:", err);
    return NextResponse.json({
      error: err.message || "Failed to process MTC certificate",
    }, { status: 500 });
  }
}
