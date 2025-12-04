import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_PROMPT = "This image contains a number (could be a digital display, meter, gauge, thermometer, scale, or any numeric display). Please read and extract the number shown. Respond with ONLY the numeric value (e.g., '37.5' or '123'). Include decimal points if present. If you cannot read the number clearly, respond with 'Unable to read'.";

export async function POST(request: NextRequest) {
  try {
    const { image, prompt } = await request.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const { text } = await generateText({
      model: openai("gpt-5-mini"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt || DEFAULT_PROMPT,
            },
            {
              type: "image",
              image: image,
            },
          ],
        },
      ],
    });

    return NextResponse.json({ number: text.trim() });
  } catch (error) {
    console.error("Error reading number:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read number" },
      { status: 500 }
    );
  }
}
