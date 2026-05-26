const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  experimental: {
    outputFileTracingIncludes: {
      "/api/jobs": ["./jobs.json"],
    },
  },
  async redirects() {
    return [
      { source: "/webapp", destination: "/webapp/index.html", permanent: false },
      { source: "/admin", destination: "/admin/index.html", permanent: false },
    ]
  },
}
module.exports = nextConfig
