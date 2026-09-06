import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emits a self-contained server bundle with only the modules actually
  // imported, so the production image does not carry the whole workspace
  // node_modules. Without this the web image is an order of magnitude larger
  // than the code it runs.
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../../"),
  async headers() {
    return [
      {
        // The embed player is meant to be framed on third-party sites - that
        // embed traffic is the distribution model, so framing must stay open
        // here. Every other route keeps the default deny.
        source: "/embed/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        source: "/((?!embed).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "no-referrer-when-downgrade" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};
export default nextConfig;
