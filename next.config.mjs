/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ["mysql2", "mongodb"],
  outputFileTracingIncludes: { "/**": ["./db/*.sql", "./data/*"] },
};
