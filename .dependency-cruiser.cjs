/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are disallowed.",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-imports-only-pure",
      severity: "error",
      comment: "packages/domain must not import adapters, apps, or infrastructure modules.",
      from: { path: "^packages/domain/" },
      to: {
        path: [
          "^packages/adapters/",
          "^apps/",
          "^packages/db/",
          "drizzle-orm",
          "@cloudflare/workers-types",
        ],
      },
    },
    {
      name: "ports-no-adapters",
      severity: "error",
      comment: "packages/ports must not import adapters.",
      from: { path: "^packages/ports/" },
      to: { path: "^packages/adapters/" },
    },
    {
      name: "core-only-domain-ports-zod",
      severity: "error",
      comment: "packages/core must only import from domain, ports, and zod.",
      from: { path: "^packages/core/" },
      to: {
        path: [
          "^packages/adapters/",
          "^packages/db/",
          "^apps/",
          "drizzle-orm",
          "@cloudflare/workers-types",
          "hono",
          "better-auth",
        ],
      },
    },
    {
      name: "auth-no-adapters-no-drizzle",
      severity: "error",
      comment: "packages/auth must not import adapters or drizzle; wire adapters in apps/worker.",
      from: { path: "^packages/auth/" },
      to: {
        path: ["^packages/adapters/", "^packages/db/", "drizzle-orm", "@cloudflare/workers-types"],
      },
    },
    {
      name: "auth-no-drizzle-adapter",
      severity: "error",
      comment:
        "packages/auth owns better-auth config but must not construct the drizzle adapter — that belongs in packages/adapters/cloudflare.",
      from: { path: "^packages/auth/" },
      to: { path: "^better-auth/adapters/" },
    },
    {
      name: "api-no-adapters-direct",
      severity: "error",
      comment: "packages/api must go through ports, not adapters directly.",
      from: { path: "^packages/api/" },
      to: { path: "^packages/adapters/" },
    },
    {
      name: "cf-types-only-in-cf-adapter-and-worker",
      severity: "error",
      comment: "@cloudflare/workers-types only in adapters/cloudflare and apps/worker.",
      from: {
        pathNot: ["^packages/adapters/cloudflare/", "^apps/worker/"],
      },
      to: { path: "@cloudflare/workers-types" },
    },
    {
      name: "cuid2-only-in-cf-adapter",
      severity: "error",
      comment:
        "@paralleldrive/cuid2 must only appear in adapters/cloudflare; elsewhere use the IdGenerator port.",
      from: { pathNot: ["^packages/adapters/cloudflare/"] },
      to: { path: "@paralleldrive/cuid2" },
    },
    {
      name: "drizzle-only-in-cf-adapter-and-db",
      severity: "error",
      comment: "drizzle-orm must only appear in adapters/cloudflare and packages/db.",
      from: {
        pathNot: ["^packages/adapters/cloudflare/", "^packages/db/"],
      },
      to: { path: "^drizzle-orm" },
    },
    {
      name: "policy-purity-no-node-globals",
      severity: "error",
      comment: "packages/domain/policy and /visibility must stay SPA-safe: no Node globals.",
      from: {
        path: "^packages/domain/src/(policy|visibility)/",
      },
      to: {
        path: ["^node:", "^fs$", "^path$", "^crypto$", "^buffer$", "^process$"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [".ts", ".tsx", ".mjs", ".cjs", ".js"],
    },
  },
};
