import { handleUpload } from "@vercel/blob/client";

export const runtime = "nodejs";

export async function POST(request) {
  console.log("========== BLOB UPLOAD ==========");

  console.log(
    "BLOB_READ_WRITE_TOKEN exists:",
    !!process.env.BLOB_READ_WRITE_TOKEN
  );

  console.log(
    "BLOB_STORE_ID:",
    process.env.BLOB_STORE_ID || "NOT FOUND"
  );

  try {
    const body = await request.json();

    const jsonResponse = await handleUpload({
      body,
      request,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        console.log("Generating upload token...");
        console.log("Path:", pathname);

        return {
          allowedContentTypes: [
            "application/pdf",

            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

            "text/csv",
            "text/plain",

            "image/jpeg",
            "image/png",
          ],

          addRandomSuffix: true,

          tokenPayload: JSON.stringify({
            type: "startup",
            clientPayload: clientPayload || null,
          }),
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log("========== UPLOAD COMPLETE ==========");

        console.log({
          pathname: blob.pathname,
          url: blob.url,
          size: blob.size,
          uploadedAt: blob.uploadedAt,
          tokenPayload,
        });
      },
    });

    console.log("Upload token generated successfully.");

    return Response.json(jsonResponse);
  } catch (error) {
    console.error("========== BLOB ERROR ==========");
    console.error(error);

    return Response.json(
      {
        error:
          error?.message ||
          "Failed to generate Blob upload token.",
      },
      {
        status: 400,
      }
    );
  }
}