import { Hono } from "hono";
import { z } from "zod";
import { getCurrentUser } from "../middleware/auth";

export const narrateRouter = new Hono();

// Schema for narrate request
const narrateRequestSchema = z.object({
  text: z.string().describe("Text to convert to speech"),
});

type NarrateRequest = z.infer<typeof narrateRequestSchema>;

/**
 * POST /api/narrate
 * Convert text to speech using ElevenLabs
 *
 * For MVP, this returns a placeholder audio data.
 * In production, integrate with ElevenLabs API
 */
narrateRouter.post("/narrate", async (c) => {
  try {
    const user = getCurrentUser(c);
    if (!user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    // Parse and validate request
    const body = await c.req.json();
    const request = narrateRequestSchema.parse(body);

    if (!request.text || request.text.length === 0) {
      return c.json({ error: "Text cannot be empty" }, 400);
    }

    // TODO: Integrate ElevenLabs API
    // For MVP, return a simple response indicating the feature is available
    // In production:
    // const audio = await textToSpeech(
    //   request.text,
    //   process.env.ELEVENLABS_VOICE_ID!
    // );
    // return c.newResponse(audio, 200, { "Content-Type": "audio/mpeg" });

    // Return a placeholder response
    return c.json({
      status: "narration_ready",
      message: "Text-to-speech feature is available",
      text: request.text,
      note: "ElevenLabs integration coming in next phase",
    });
  } catch (error) {
    console.error("Narrate error:", error);

    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation error",
          details: error.errors,
        },
        400
      );
    }

    return c.json(
      {
        error: "Text-to-speech generation failed",
        message:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : "Unknown error"
            : undefined,
      },
      500
    );
  }
});
