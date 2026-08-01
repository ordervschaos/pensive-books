/** @type {import('next').NextConfig} */
const nextConfig = {
  // The build pipeline is a long-running server job (fetch → LLM → email), never a static page.
  // Nothing here is prerendered; every route is either an authed dashboard or an API route.
  reactStrictMode: true,
};

export default nextConfig;
