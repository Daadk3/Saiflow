import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface HealthStatus {
  status: "healthy" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: "up" | "down";
      latency?: number;
      error?: string;
    };
  };
}

const startTime = Date.now();

export async function GET() {
  const health: HealthStatus = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.1.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks: {
      database: {
        status: "up",
      },
    },
  };

  // Check database connection
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    health.checks.database.latency = Date.now() - dbStart;
  } catch (error) {
    health.status = "unhealthy";
    health.checks.database.status = "down";
    health.checks.database.error =
      error instanceof Error ? error.message : "Unknown database error";
  }

  const statusCode = health.status === "healthy" ? 200 : 503;

  return NextResponse.json(health, {
    status: statusCode,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
