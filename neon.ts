import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  // The Sweet Revenge API: saves chat and finished games. Source in api/, schema in api/schema.sql.
  functions: {
    api: {
      name: "Sweet Revenge API",
      source: "api/index.ts",
      env: {
        // Private key of the relay bridge (api/bridge.ts). Lives only in .env.local; the public half is in shared/records.js.
        RELAY_PRIVATE_KEY: { value: process.env.RELAY_PRIVATE_KEY, required: true },
      },
    },
  },
  // Wakes the relay bridge every minute (see api/bridge.ts).
  triggers: {
    "relay-tick": { type: "schedule", function: "api", cron: "* * * * *", functionPath: "/relay-tick" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
