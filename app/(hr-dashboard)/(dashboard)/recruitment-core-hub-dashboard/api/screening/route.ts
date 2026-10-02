import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/app/(hr-dashboard)/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || ""
);

type AIResult = {
  match_score: number;
  recommendation: "strong_fit" | "good_fit" | "weak_fit" | "not_fit";
  strengths: string[];
  gaps: string[];
  summary: string;
};

export async function POST(request: Request) {
  try {
    // =========================================================
    // 1. Create Supabase server client
    // =========================================================

    const supabase = await createServerSupabaseClient();

    // =========================================================
    // 2. Check logged-in user
    // =========================================================

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "Unauthorized. Please log in first.",
        },
        { status: 401 }
      );
    }

    // =========================================================
    // 3. Read request body
    // =========================================================

    const body = await request.json();

    const applicantId = body.applicant_id;

    if (!applicantId) {
      return NextResponse.json(
        {
          error: "Applicant ID is required.",
        },
        { status: 400 }
      );
    }

    // =========================================================
    // 4. Get applicant from SHARED HR1 table
    // =========================================================

    const { data: applicant, error: applicantError } =
      await supabase
        .from("hr1_applicants")
        .select(
          `
          id,
          first_name,
          last_name,
          resume_text,
          job_position_id
        `
        )
        .eq("id", applicantId)
        .single();

    if (applicantError || !applicant) {
      console.error(
        "APPLICANT LOAD ERROR:",
        applicantError
      );

      return NextResponse.json(
        {
          error: "Applicant not found.",
        },
        { status: 404 }
      );
    }

    // =========================================================
    // 5. Make sure resume text exists
    // =========================================================

    if (!applicant.resume_text?.trim()) {
      return NextResponse.json(
        {
          error:
            "This applicant does not have resume text available for AI screening.",
        },
        { status: 400 }
      );
    }

    // =========================================================
    // 6. Get job position from SHARED HR1 table
    // =========================================================

    const { data: jobPosition, error: jobPositionError } =
      await supabase
        .from("hr1_job_positions")
        .select("id, title, department, description, requirements")
        .eq("id", applicant.job_position_id)
        .single();

    if (jobPositionError || !jobPosition) {
      console.error(
        "JOB POSITION LOAD ERROR:",
        jobPositionError
      );

      return NextResponse.json(
        {
          error: "Job position not found.",
        },
        { status: 404 }
      );
    }

    // =========================================================
    // 7. Check Gemini API key
    // =========================================================

    if (!process.env.GEMINI_API_KEY) {
      console.error(
        "GEMINI_API_KEY is not configured."
      );

      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY is not configured on the server.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 8. Prepare AI prompt
    // =========================================================

    const prompt = `
You are an AI-assisted recruitment screening assistant
for Airship Express Courier Service.

Your job is to analyze an applicant's resume against
the job position they applied for.

IMPORTANT RULES:

1. You are only an ASSISTIVE tool.
2. HR must make the final hiring decision.
3. Do not make discriminatory judgments.
4. Do not use age, gender, religion, race, nationality,
   marital status, disability, or other protected
   characteristics when evaluating the applicant.
5. Do not invent information.
6. Use only information provided in the resume and job
   requirements.
7. Return ONLY valid JSON.
8. Do not use Markdown.
9. Do not include code fences.

APPLICANT:

Name:
${applicant.first_name} ${applicant.last_name}

JOB POSITION:

Title:
${jobPosition.title}

Department:
${jobPosition.department || "Not specified"}

Job Description:
${jobPosition.description || "Not provided"}

Job Requirements:
${jobPosition.requirements || "Not provided"}

APPLICANT RESUME:

${applicant.resume_text}

Return exactly this JSON structure:

{
  "match_score": 0,
  "recommendation": "strong_fit",
  "strengths": [
    "strength 1",
    "strength 2"
  ],
  "gaps": [
    "gap 1",
    "gap 2"
  ],
  "summary": "Short objective summary of the applicant's qualifications compared with the position."
}

MATCH SCORE:

The match_score must be an integer from 0 to 100.

RECOMMENDATION:

The recommendation MUST be exactly one of these values:

"strong_fit"
"good_fit"
"weak_fit"
"not_fit"

Use these general guidelines:

strong_fit:
The applicant demonstrates strong alignment with the
position's relevant skills, experience, education,
and requirements.

good_fit:
The applicant demonstrates substantial alignment but
has some minor gaps.

weak_fit:
The applicant has some relevant qualifications but
has significant gaps compared with the requirements.

not_fit:
The available resume information shows very limited
alignment with the stated requirements.

IMPORTANT:

The recommendation is NOT a final hiring decision.
It is only an AI-assisted assessment for HR review.
`;

    // =========================================================
    // 9. Call Gemini
    // =========================================================

    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
    });

    let aiText = "";

    try {
      const result = await model.generateContent(prompt);

      const response = result.response;

      aiText = response.text();

      console.log(
        "GEMINI SCREENING RESPONSE:",
        aiText
      );
    } catch (aiError: unknown) {
      console.error(
        "GEMINI API ERROR:",
        aiError
      );

      const errorMessage =
        aiError instanceof Error
          ? aiError.message
          : String(aiError);

      const lowerMessage =
        errorMessage.toLowerCase();

      // -------------------------------------------------------
      // Handle Gemini temporary overload
      // -------------------------------------------------------

      if (
        lowerMessage.includes("503") ||
        lowerMessage.includes("unavailable") ||
        lowerMessage.includes("high demand") ||
        lowerMessage.includes("overloaded")
      ) {
        return NextResponse.json(
          {
            error:
              "The AI service is temporarily unavailable because the Gemini service is currently busy. Please wait a few seconds and try the screening again.",
          },
          { status: 503 }
        );
      }

      // -------------------------------------------------------
      // Handle rate limit
      // -------------------------------------------------------

      if (
        lowerMessage.includes("429") ||
        lowerMessage.includes("rate limit") ||
        lowerMessage.includes("quota")
      ) {
        return NextResponse.json(
          {
            error:
              "The AI screening service has reached its temporary request limit. Please try again later.",
          },
          { status: 429 }
        );
      }

      // -------------------------------------------------------
      // Other Gemini errors
      // -------------------------------------------------------

      return NextResponse.json(
        {
          error:
            "The AI screening service could not process this request. Please try again.",
        },
        { status: 502 }
      );
    }

    // =========================================================
    // 10. Make sure Gemini returned something
    // =========================================================

    if (!aiText.trim()) {
      return NextResponse.json(
        {
          error:
            "The AI service returned an empty response.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 11. Clean AI response
    // =========================================================

    const cleanedText = aiText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // =========================================================
    // 12. Parse JSON
    // =========================================================

    let aiResult: AIResult;

    try {
      aiResult = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error(
        "AI JSON PARSE ERROR:",
        parseError
      );

      console.error(
        "RAW AI RESPONSE:",
        aiText
      );

      return NextResponse.json(
        {
          error:
            "The AI returned an invalid screening response. Please try again.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 13. Validate match score
    // =========================================================

    const matchScore = Number(
      aiResult.match_score
    );

    if (
      !Number.isInteger(matchScore) ||
      matchScore < 0 ||
      matchScore > 100
    ) {
      return NextResponse.json(
        {
          error:
            "The AI returned an invalid match score.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 14. Validate recommendation
    // =========================================================

    const validRecommendations = [
      "strong_fit",
      "good_fit",
      "weak_fit",
      "not_fit",
    ] as const;

    if (
      !validRecommendations.includes(
        aiResult.recommendation
      )
    ) {
      return NextResponse.json(
        {
          error:
            "The AI returned an invalid recommendation.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 15. Prepare screening data
    // =========================================================

    const screeningData = {
      applicant_id: applicantId,
      match_score: matchScore,
      recommendation:
        aiResult.recommendation,
      strengths: Array.isArray(
        aiResult.strengths
      )
        ? aiResult.strengths
        : [],
      gaps: Array.isArray(aiResult.gaps)
        ? aiResult.gaps
        : [],
      summary:
        typeof aiResult.summary === "string"
          ? aiResult.summary
          : null,
    };

    // =========================================================
    // 16. Check existing AI screening
    // =========================================================

    const {
      data: existingScreening,
      error: existingScreeningError,
    } = await supabase
      .from("hr1_ai_screenings")
      .select("id")
      .eq("applicant_id", applicantId)
      .maybeSingle();

    if (existingScreeningError) {
      console.error(
        "EXISTING SCREENING CHECK ERROR:",
        existingScreeningError
      );

      return NextResponse.json(
        {
          error:
            "Failed to check the existing AI screening.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 17. Update existing screening
    // =========================================================

    if (existingScreening) {
      const {
        data: updatedScreening,
        error: updateError,
      } = await supabase
        .from("hr1_ai_screenings")
        .update(screeningData)
        .eq(
          "id",
          existingScreening.id
        )
        .select()
        .single();

      if (updateError) {
        console.error(
          "AI SCREENING UPDATE ERROR:",
          updateError
        );

        return NextResponse.json(
          {
            error:
              "Failed to update the AI screening result.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          success: true,
          screening: updatedScreening,
        },
        { status: 200 }
      );
    }

    // =========================================================
    // 18. Create new screening
    // =========================================================

    const {
      data: newScreening,
      error: insertError,
    } = await supabase
      .from("hr1_ai_screenings")
      .insert(screeningData)
      .select()
      .single();

    if (insertError) {
      console.error(
        "AI SCREENING INSERT ERROR:",
        insertError
      );

      return NextResponse.json(
        {
          error:
            "Failed to save the AI screening result.",
        },
        { status: 500 }
      );
    }

    // =========================================================
    // 19. Return successful result
    // =========================================================

    return NextResponse.json(
      {
        success: true,
        screening: newScreening,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error(
      "AI SCREENING UNEXPECTED ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
      },
      { status: 500 }
    );
  }
}