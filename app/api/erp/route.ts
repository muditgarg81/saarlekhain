import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Simple in-memory job queue for the bridge agent
// In production, this would be backed by Redis or the PostgreSQL database
interface ErpJob {
  id: string;
  companyId: string;
  type: "LIST_LEDGERS" | "PULL_STATEMENT" | "WRITEBACK";
  payload: any;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  result?: any;
  createdAt: number;
}

const jobQueue: ErpJob[] = [];

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid authorization header" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];

    // Find the bridge agent associated with this token
    // For simplicity in this implementation, we can do a lookup or accept "mock-agent-token"
    const agent = await db.bridgeAgent.findFirst({
      where: { id: token },
      include: { connection: true }
    });

    if (!agent) {
      return NextResponse.json({ error: "Unauthorized bridge agent token" }, { status: 401 });
    }

    // Update last seen
    await db.bridgeAgent.update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() }
    });

    const body = await req.json();
    const { action, jobId, status, result, error } = body;

    // 1. Agent is reporting completion of a job
    if (action === "complete_job" && jobId) {
      const job = jobQueue.find(j => j.id === jobId && j.companyId === agent.companyId);
      if (job) {
        job.status = status === "success" ? "COMPLETED" : "FAILED";
        job.result = status === "success" ? result : { error };
        
        // If it was a PULL_STATEMENT job, we cache it in the database
        if (job.status === "COMPLETED" && job.type === "PULL_STATEMENT" && result) {
          await cacheStatement(agent.companyId, agent.connectionId, result);
        }

        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // 2. Agent is long-polling for new jobs
    if (action === "poll") {
      // Find pending jobs
      const pendingIndex = jobQueue.findIndex(
        j => j.companyId === agent.companyId && j.status === "PENDING"
      );

      if (pendingIndex !== -1) {
        const job = jobQueue[pendingIndex];
        job.status = "PROCESSING";
        return NextResponse.json({ job });
      }

      // No jobs, return empty response after short sleep to simulate long poll
      await new Promise(resolve => setTimeout(resolve, 1000));
      return NextResponse.json({ job: null });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("ERP API Route error:", err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}

// Helper to push cached outstandings to the database
async function cacheStatement(companyId: string, connectionId: string, result: any) {
  const { vendorId, outstanding, bills } = result;

  await db.$transaction(async (tx) => {
    // Update net statement
    const statement = await tx.creditorStatement.upsert({
      where: {
        companyId_connectionId_vendorId: {
          companyId,
          connectionId,
          vendorId
        }
      },
      update: {
        outstanding,
        asOf: new Date()
      },
      create: {
        companyId,
        connectionId,
        vendorId,
        outstanding,
        asOf: new Date()
      }
    });

    // Recreate bills list
    await tx.creditorBill.deleteMany({
      where: { companyId, statementId: statement.id }
    });

    if (bills && bills.length > 0) {
      await tx.creditorBill.createMany({
        data: bills.map((b: any) => ({
          companyId,
          statementId: statement.id,
          billRef: b.billRef,
          billDate: b.billDate ? new Date(b.billDate) : null,
          dueDate: b.dueDate ? new Date(b.dueDate) : null,
          openingAmount: b.openingAmount || 0,
          pendingAmount: b.pendingAmount || 0,
          overdueDays: b.overdueDays || 0
        }))
      });
    }
  });
}

// Function to enqueue a job from the Next.js server side
export async function enqueueErpJob(companyId: string, type: "LIST_LEDGERS" | "PULL_STATEMENT" | "WRITEBACK", payload: any) {
  const jobId = `job_${Math.random().toString(36).substring(2, 11)}`;
  const job: ErpJob = {
    id: jobId,
    companyId,
    type,
    payload,
    status: "PENDING",
    createdAt: Date.now()
  };

  jobQueue.push(job);

  // Poll for completion (max 8 seconds)
  for (let i = 0; i < 80; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const current = jobQueue.find(j => j.id === jobId);
    if (current && (current.status === "COMPLETED" || current.status === "FAILED")) {
      // Clean up queue
      const idx = jobQueue.findIndex(j => j.id === jobId);
      if (idx !== -1) jobQueue.splice(idx, 1);
      return current;
    }
  }

  // Clean up on timeout
  const idx = jobQueue.findIndex(j => j.id === jobId);
  if (idx !== -1) jobQueue.splice(idx, 1);
  throw new Error("ERP Bridge Agent timeout. Check if agent is running on your LAN.");
}
