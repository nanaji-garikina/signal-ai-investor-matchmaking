// lib/groq.js
//
// Fallback AI provider. Used by the Investor Agent whenever Gemini is
// unavailable (quota exhausted, timeout, 5xx, etc.) so the user still gets
// a real, reasoned answer instead of a canned "couldn't retrieve AI
// insights" message.
//
// Groq is deliberately a DIFFERENT vendor from Gemini (different company,
// different infrastructure, different free-tier quota bucket) so a Google
// outage or Gemini quota exhaustion can't take down the fallback too.
// Uses Groq's OpenAI-compatible chat completions endpoint - no SDK needed.
//
// Requires GROQ_API_KEY in .env.local (and in Vercel's project env vars
// for production). Get a free key at https://console.groq.com/keys -
// no credit card required.

const GROQ_MODEL = "llama-3.3-70b-versatile";
const REQUEST_TIMEOUT_MS = 20000;

export async function callGroq(prompt, { jsonMode = false } = {}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY is missing. Add it to .env.local (and your Vercel project's environment variables) to enable the fallback AI provider."
    );
  }

  if (!prompt || typeof prompt !== "string") {
    throw new Error("A valid prompt is required to call the Groq API.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;

  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 1024,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
        // Groq (OpenAI-compatible) supports forcing valid JSON output on
        // this model - used by the extraction routes, which need strict
        // JSON back. The Investor Agent's Q&A calls omit this (default
        // false) since those want plain conversational text.
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
  } catch (networkError) {
    const isTimeout = networkError?.name === "AbortError";

    console.error(
      isTimeout
        ? `Groq request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : "Groq network error:",
      isTimeout ? "" : networkError
    );

    throw new Error(
      isTimeout
        ? "The fallback AI service took too long to respond."
        : "Could not connect to the fallback AI service."
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Groq API error (${res.status}):`, errorText);

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "The Groq API key is invalid or missing permissions. Check GROQ_API_KEY in .env.local / Vercel env vars."
      );
    }

    if (res.status === 429) {
      throw new Error("The Groq free-tier rate limit was hit. Please try again shortly.");
    }

    throw new Error(`The fallback AI service returned an error (${res.status}).`);
  }

  let data;

  try {
    data = await res.json();
  } catch {
    throw new Error("The fallback AI service returned an invalid response.");
  }

  const text = data.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("The fallback AI service returned an empty response.");
  }

  return text;
}