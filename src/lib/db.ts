import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Neon's serverless driver speaks over WebSocket; provide an implementation for
// Node. This driver adapter manages the serverless connection lifecycle (no
// stale TCP pool reuse), avoiding "PostgreSQL connection: Closed" errors that
// surface when Prisma reuses a pooled connection Neon already dropped.
neonConfig.webSocketConstructor = ws as unknown as typeof neonConfig.webSocketConstructor;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
