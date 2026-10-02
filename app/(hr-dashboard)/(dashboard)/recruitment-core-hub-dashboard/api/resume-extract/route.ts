import { NextResponse } from "next/server";
import mammoth from "mammoth";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Resume file is required." },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    let resumeText = "";

    // ---------------------------------------------
    // PDF EXTRACTION
    // ---------------------------------------------
    if (fileName.endsWith(".pdf")) {
      // Dynamic require to prevent Next.js / Turbopack bundler module errors
      const pdfParse = require("pdf-parse/lib/pdf-parse.js");
      const result = await pdfParse(buffer);
      resumeText = result.text;
    }

    // ---------------------------------------------
    // DOCX EXTRACTION
    // ---------------------------------------------
    else if (fileName.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer: buffer });
      resumeText = result.value;
    }

    // ---------------------------------------------
    // UNSUPPORTED FORMAT
    // ---------------------------------------------
    else {
      return NextResponse.json(
        {
          error:
            "Unsupported resume format. Please upload a PDF or DOCX file.",
        },
        { status: 400 }
      );
    }

    resumeText = resumeText.trim();

    if (!resumeText) {
      return NextResponse.json(
        {
          error:
            "Unable to extract text from this resume. Please upload a text-based PDF or DOCX file.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      text: resumeText,
    });
  } catch (error) {
    console.error("RESUME EXTRACTION ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to extract resume text.",
      },
      { status: 500 }
    );
  }
}