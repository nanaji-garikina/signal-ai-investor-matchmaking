/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
    serverComponentsExternalPackages: [
      "pdf-parse",
      "pdfjs-dist",
      "@napi-rs/canvas",
    ],
  },
};

module.exports = nextConfig;