import { createServerFn } from "@tanstack/react-start";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { z } from "zod";

const Input = z.object({
  idea: z.string().min(3).max(500),
});

const SYSTEM = `You generate tiny single-file HTML5 canvas games.
Return ONLY a complete <!doctype html> document. No markdown, no commentary.
Requirements:
- Self-contained: inline CSS + JS, no external assets, no network calls.
- One <canvas> filling the viewport, dark background.
- Keyboard + mouse/touch friendly. Show score/instructions on screen.
- Must be playable immediately on load, with a restart on game over.
- Keep code under ~200 lines. No external fonts.`;

export const generateAiGame = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const provider = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const { text } = await generateText({
      model: provider("google/gemini-3-flash-preview"),
      system: SYSTEM,
      prompt: `Game idea: ${data.idea}\n\nReturn the full HTML document now.`,
    });
    // Strip possible code fences
    const cleaned = text
      .replace(/^```(?:html)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return { html: cleaned };
  });
