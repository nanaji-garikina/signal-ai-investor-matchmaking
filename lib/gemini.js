// lib/gemini.js

const GEMINI_MODEL = "gemini-3.5-flash";

// Maximum number of retry attempts after the first request.
const DEFAULT_RETRIES = 4;

// How long to wait for a single Gemini request (connect + response)
// before giving up on that attempt and moving to a retry. Without this,
// a dead/blocked network connection can hang for 2+ minutes across all
// retries before the user sees any error.
const REQUEST_TIMEOUT_MS = 30000;

// Temporary HTTP errors that are worth retrying automatically.
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));


/**
 * Calculate retry delay.
 *
 * Retry 1 -> 5 seconds
 * Retry 2 -> 10 seconds
 * Retry 3 -> 20 seconds
 * Retry 4 -> 30 seconds
 *
 * For 429 errors, Gemini may provide a retryDelay value.
 */
function getRetryDelay(retriesLeft, retryDelayFromApi = null) {
  // Use Gemini's suggested retry delay when available.
  if (retryDelayFromApi) {
    const seconds = parseInt(
      String(retryDelayFromApi).replace("s", ""),
      10
    );

    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 60000);
    }
  }

  const attempt = DEFAULT_RETRIES - retriesLeft + 1;

  const delays = [
    5000,  // Retry 1
    10000, // Retry 2
    20000, // Retry 3
    30000, // Retry 4
  ];

  return delays[Math.min(attempt - 1, delays.length - 1)];
}


/**
 * Try to extract Google's recommended retry delay
 * from the Gemini API error response.
 */
function extractRetryDelay(errorText) {
  try {
    const parsed = JSON.parse(errorText);

    const details = parsed?.error?.details || [];

    for (const detail of details) {
      if (detail?.retryDelay) {
        return detail.retryDelay;
      }
    }
  } catch {
    // Ignore invalid JSON.
  }

  return null;
}


/**
 * Detect a PER-DAY free-tier quota exhaustion (as opposed to a
 * per-minute rate limit). A per-day quota won't come back for hours,
 * so retrying with a 5-60s backoff is pure wasted time - we should
 * fail immediately instead.
 */
function isDailyQuotaExhausted(errorText) {
  return (
    errorText.includes("GenerateRequestsPerDay") ||
    errorText.includes("free_tier_requests") ||
    errorText.includes("PerDay")
  );
}


/**
 * Convert raw Gemini API errors into cleaner,
 * user-friendly messages.
 */
function getFriendlyError(status, errorText) {
  if (status === 429) {
    // Daily free-tier quota exhausted.
    if (isDailyQuotaExhausted(errorText)) {
      return (
        "The Gemini free-tier daily usage limit (20 requests/day for gemini-3.5-flash) has been reached. " +
        "It resets roughly 24 hours after your first request of the day. In the meantime, try again later, " +
        "use a different Google Cloud project/API key, or switch to a lighter model like gemini-3.5-flash-lite " +
        "which may have separate free-tier quota."
      );
    }

    return (
      "The AI service is receiving too many requests right now. " +
      "Please wait a moment and try again."
    );
  }

  if (status === 503) {
    return (
      "The AI model is temporarily busy because of high demand. " +
      "Please try again in a few moments."
    );
  }

  if ([500, 502, 504].includes(status)) {
    return (
      "The AI service is temporarily unavailable. " +
      "Please try again shortly."
    );
  }

  if (status === 400) {
    return (
      "The AI request could not be processed. " +
      "Please check the request data and try again."
    );
  }

  if (status === 401 || status === 403) {
    return (
      "The Gemini API key is invalid, restricted, expired, or does not have permission to use this model. " +
      "Please check GEMINI_API_KEY in your .env.local file."
    );
  }

  if (status === 404) {
    return (
      `The Gemini model "${GEMINI_MODEL}" was not found or is not available for this API key. ` +
      "Please check the configured model name."
    );
  }

  return `The AI service returned an unexpected error (${status}). Please try again.`;
}


/**
 * Main Gemini API function.
 *
 * responseType:
 * - "json" -> Forces Gemini to return structured JSON.
 * - "text" -> Returns normal conversational text.
 */
export async function callGemini(
  prompt,
  attachment = null,
  retriesLeft = DEFAULT_RETRIES,
  responseType = "json"
) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is missing. Add it to your .env.local file and restart the development server."
    );
  }

  if (!prompt || typeof prompt !== "string") {
    throw new Error(
      "A valid prompt is required to call the Gemini API."
    );
  }

  const parts = attachment
    ? [
        {
          inline_data: {
            mime_type: attachment.mediaType,
            data: attachment.data,
          },
        },
        {
          text: prompt,
        },
      ]
    : [
        {
          text: prompt,
        },
      ];

  const generationConfig = {
    maxOutputTokens: 4096,
    temperature: 0.7,

    thinkingConfig: {
      thinkingLevel: "low",
    },
  };

  // Only force JSON for routes that need structured data.
  // Investor Agent should use normal conversational text.
  if (responseType === "json") {
    generationConfig.responseMimeType = "application/json";
  } else {
    generationConfig.responseMimeType = "text/plain";
  }

  let res;

  // Guard the request with a hard timeout so a dead/blocked connection
  // fails fast instead of hanging on the OS-level TCP timeout (which can
  // be 10+ seconds per attempted IP address, per retry).
  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts,
            },
          ],

          generationConfig,
        }),

        signal: controller.signal,
      }
    );
  } catch (networkError) {
    const isTimeout = networkError?.name === "AbortError";

    console.error(
      isTimeout
        ? `Gemini request timed out after ${REQUEST_TIMEOUT_MS / 1000}s:`
        : "Gemini network error:",
      isTimeout ? "" : networkError
    );

    // Retry temporary network failures (including our own timeout).
    if (retriesLeft > 0) {
      const wait = getRetryDelay(retriesLeft);

      console.warn(
        `Gemini ${
          isTimeout ? "request timed out" : "network request failed"
        }. Retrying in ${wait / 1000} seconds... (${retriesLeft} retries remaining)`
      );

      await sleep(wait);

      return callGemini(
        prompt,
        attachment,
        retriesLeft - 1,
        responseType
      );
    }

    throw new Error(
      isTimeout
        ? "The AI service took too long to respond. Please check your internet connection and try again."
        : "Could not connect to the AI service. Please check your internet connection and try again."
    );
  } finally {
    clearTimeout(timeoutId);
  }


  /**
   * Handle unsuccessful Gemini responses.
   */
  if (!res.ok) {
    const errorText = await res.text();

    console.error(
      `Gemini API error (${res.status}):`,
      errorText
    );

    // A per-day quota exhaustion will not resolve itself within our
    // retry window (max ~65s of backoff), so never retry it - fail
    // fast with a clear message instead of burning time first.
    const isDailyQuota =
      res.status === 429 && isDailyQuotaExhausted(errorText);

    const shouldRetry =
      !isDailyQuota &&
      RETRYABLE_STATUS_CODES.includes(res.status) &&
      retriesLeft > 0;

    if (isDailyQuota) {
      console.error(
        "Gemini daily free-tier quota exhausted - not retrying."
      );
    }

    if (shouldRetry) {
      const apiRetryDelay = extractRetryDelay(errorText);

      const wait = getRetryDelay(
        retriesLeft,
        apiRetryDelay
      );

      console.warn(
        `Gemini temporarily unavailable (${res.status}). ` +
          `Retrying in ${wait / 1000} seconds... ` +
          `(${retriesLeft} retries remaining)`
      );

      await sleep(wait);

      return callGemini(
        prompt,
        attachment,
        retriesLeft - 1,
        responseType
      );
    }

    throw new Error(
      getFriendlyError(res.status, errorText)
    );
  }


  /**
   * Parse successful response.
   */
  let data;

  try {
    data = await res.json();
  } catch {
    throw new Error(
      "The AI service returned an invalid response. Please try again."
    );
  }


  /**
   * Check safety blocking.
   */
  if (data.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini blocked the request: ${data.promptFeedback.blockReason}`
    );
  }


  /**
   * Extract the first response candidate.
   */
  const candidate = data.candidates?.[0];

  if (!candidate) {
    console.error(
      "Gemini returned no candidate:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "The AI service returned no answer. Please try again."
    );
  }


  /**
   * Handle token limit.
   */
  if (candidate.finishReason === "MAX_TOKENS") {
    throw new Error(
      "The AI response was cut off because it reached the token limit. Please try a shorter document or request."
    );
  }


  /**
   * Handle other abnormal finish reasons.
   */
  if (
    candidate.finishReason &&
    !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)
  ) {
    console.warn(
      `Gemini finish reason: ${candidate.finishReason}`
    );
  }


  /**
   * Extract generated text.
   */
  const text = (candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error(
      "The AI service returned an empty response. Please try again."
    );
  }


  /**
   * Remove accidental Markdown JSON fences.
   */
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}


/**
 * Runs async tasks with limited concurrency and spacing.
 *
 * Useful for:
 * - Investor enrichment
 * - Personalized email generation
 * - Multiple AI operations
 *
 * Helps prevent 429 rate-limit errors.
 */
export async function runThrottled(
  items,
  worker,
  {
    concurrency = 2,
    spacingMs = 1500,
  } = {}
) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);

  let next = 0;

  async function lane() {
    while (next < items.length) {
      const index = next++;

      try {
        results[index] = await worker(
          items[index],
          index
        );
      } catch (error) {
        console.error(
          `Throttled worker failed at index ${index}:`,
          error
        );

        throw error;
      }

      if (next < items.length) {
        await sleep(spacingMs);
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          concurrency,
          items.length
        ),
      },
      lane
    )
  );

  return results;
}