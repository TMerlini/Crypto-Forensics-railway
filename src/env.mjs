import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Zero-dep .env parser. Supports KEY=value, # comments, blank lines, quoted values.
export function loadEnv({
  require: requireKeys = ["ETHERSCAN_API_KEY", "SCAM_ADDRESS"],
  warn: warnKeys = [],
} = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", ".env"), join(process.cwd(), ".env")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }

  const missing = requireKeys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`,
    );
  }

  const warn = warnKeys.filter((k) => !process.env[k]);
  if (warn.length) {
    console.warn(`[env] Missing optional env vars: ${warn.join(", ")}. You can provide them in the UI per-request instead.`);
  }

  // Hosted platforms (Railway, Render, Fly, Heroku, etc.) inject a PORT env var
  // and expect us to bind to 0.0.0.0. We use that as a heuristic to switch the
  // default bind from loopback → all interfaces.
  //
  // Defensive override: when PORT is set, a SERVER_BIND of 127.0.0.1 / localhost
  // would make the container unreachable (the platform's edge proxy hits 0.0.0.0
  // inside the namespace). That's almost certainly a misconfig from copy-pasting
  // .env.example into Railway/Render Variables, so we ignore it and warn.
  const isHosted = !!process.env.PORT;
  const serverPort = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 4337);
  let serverBind = process.env.SERVER_BIND ?? (isHosted ? "0.0.0.0" : "127.0.0.1");
  if (isHosted && (serverBind === "127.0.0.1" || serverBind === "localhost" || serverBind === "::1")) {
    console.warn(`[env] PORT is set (hosted mode) but SERVER_BIND=${serverBind} would make the container unreachable from the edge. Forcing 0.0.0.0. Remove SERVER_BIND from your platform's Variables tab to silence this.`);
    serverBind = "0.0.0.0";
  }

  return {
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    chainId: Number(process.env.CHAIN_ID ?? 1),
    scamAddress: (process.env.SCAM_ADDRESS ?? "").toLowerCase(),
    maxDepth: Number(process.env.MAX_DEPTH ?? 15),
    maxAddresses: Number(process.env.MAX_ADDRESSES ?? 2000),
    rps: Number(process.env.RATE_LIMIT_RPS ?? 2.5),
    adaptiveRps: String(process.env.ETHERSCAN_ADAPTIVE_RPS ?? "true").toLowerCase() !== "false",
    stopAtOrigin: String(process.env.STOP_AT_ORIGIN ?? "true").toLowerCase() !== "false",
    fromTs: process.env.FROM_TIMESTAMP ? Number(process.env.FROM_TIMESTAMP) : null,
    toTs: process.env.TO_TIMESTAMP ? Number(process.env.TO_TIMESTAMP) : null,
    direction: (process.env.DIRECTION ?? "in").toLowerCase(),
    serverPort,
    serverBind,
    isHosted,
    authUser: process.env.AUTH_USER ?? "admin",
    authPassword: process.env.AUTH_PASSWORD ?? "",
    disableDisk: String(process.env.DISABLE_DISK ?? (isHosted ? "true" : "false")).toLowerCase() === "true",
  };
}
