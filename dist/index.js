import { Worker } from "bullmq";
import axios, { AxiosError } from "axios";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/index.js";
import { monitor, checkResult, incident } from "./db/schema.js";
import { Redis } from "ioredis";
import { NotificationService } from "./notification.js";
export const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
        // exponential backoff up to 2s
        return Math.min(times * 100, 2000);
    },
});
// Utility function to perform the actual HTTP check
async function performHealthCheck(monitor) {
    const start = Date.now();
    let responseMs = 0;
    let isUp = false;
    let statusCode;
    let errorMessage;
    let errorType = 'unknown';
    try {
        console.log(`🔍 Checking ${monitor.name || monitor.url} (${monitor.method})`);
        const response = await axios.request({
            url: monitor.url,
            method: monitor.method,
            headers: {
                'User-Agent': 'Monitor-Service/1.0',
                ...monitor.headers,
            },
            timeout: 10000, // 10 seconds
            validateStatus: () => true, // Don't throw on any status code
            maxRedirects: 5,
        });
        responseMs = Date.now() - start;
        statusCode = response.status;
        isUp = response.status === monitor.expectedStatus;
        if (!isUp) {
            errorType = 'status';
            errorMessage = `Expected ${monitor.expectedStatus}, got ${response.status}`;
        }
    }
    catch (error) {
        responseMs = Date.now() - start;
        isUp = false;
        if (error instanceof AxiosError) {
            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                errorType = 'timeout';
                errorMessage = `Request timeout after ${responseMs}ms`;
            }
            else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                errorType = 'network';
                errorMessage = `Network error: ${error.code}`;
            }
            else if (error.response?.status) {
                statusCode = error.response.status;
                errorType = 'status';
                errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
            }
            else {
                errorMessage = error.message || 'Unknown axios error';
            }
        }
        else {
            errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        }
        console.error(`❌ Check failed for ${monitor.url}:`, errorMessage);
    }
    return {
        isUp,
        responseMs,
        statusCode,
        errorMessage,
        errorType
    };
}
// Function to generate notification messages
function generateNotificationMessages(monitor, results, isNewIncident = false, isResolved = false) {
    const serviceName = monitor.name || monitor.url;
    if (isResolved) {
        return {
            title: `✅ Service Restored: ${serviceName}`,
            message: `Good news! Your monitored service is back online.

🔗 Service: ${serviceName}
⏱️ Response Time: ${results.responseMs}ms
📊 Status: ${results.statusCode || 'N/A'}
🕒 Resolved at: ${new Date().toLocaleString()}

Your service is now responding normally.`,
            priority: 'medium'
        };
    }
    if (isNewIncident) {
        const errorDetails = results.errorMessage || 'Unknown error';
        const troubleshootingTips = getTroubleshootingTips(results.errorType);
        return {
            title: `🚨 Service Down: ${serviceName}`,
            message: `Your monitored service is currently experiencing issues.

🔗 Service: ${serviceName}
❌ Status: ${errorDetails}
⏱️ Response Time: ${results.responseMs}ms
🕒 Started at: ${new Date().toLocaleString()}

${troubleshootingTips}

We'll continue monitoring and notify you when the service is restored.`,
            priority: 'critical'
        };
    }
    // Ongoing incident update
    return {
        title: `⚠️ Service Still Down: ${serviceName}`,
        message: `Your service continues to experience issues.

🔗 Service: ${serviceName}
❌ Current Status: ${results.errorMessage || 'Unknown error'}
⏱️ Latest Check: ${results.responseMs}ms
🕒 Last Checked: ${new Date().toLocaleString()}

We're still monitoring the situation.`,
        priority: 'high'
    };
}
function getTroubleshootingTips(errorType) {
    switch (errorType) {
        case 'timeout':
            return `💡 Troubleshooting tips:
• Check if your server is overloaded
• Verify network connectivity
• Consider increasing timeout if legitimate slow response`;
        case 'network':
            return `💡 Troubleshooting tips:
• Verify the URL is correct and accessible
• Check DNS resolution
• Ensure firewall/security groups allow connections`;
        case 'status':
            return `💡 Troubleshooting tips:
• Check server logs for errors
• Verify the service is running properly
• Review recent deployments or changes`;
        default:
            return `💡 We recommend checking your server logs and service status.`;
    }
}
const worker = new Worker("monitor-checks", async (job) => {
    const { monitorId } = job.data;
    try {
        // Fetch monitor details
        const [existingMonitor] = await db
            .select()
            .from(monitor)
            .where(eq(monitor.id, monitorId));
        if (!existingMonitor) {
            console.warn(`⚠️ Monitor ${monitorId} not found, skipping check`);
            return;
        }
        // Perform the health check
        const results = await performHealthCheck({
            monitorId: existingMonitor.id,
            url: existingMonitor.url,
            method: existingMonitor.method,
            expectedStatus: existingMonitor.expectedStatus,
            headers: existingMonitor.headers,
            userId: existingMonitor.userId,
            name: existingMonitor.name,
        });
        // Update monitor status (remove lastChecked if not in schema)
        await db.update(monitor)
            .set({
            status: results.isUp ? "up" : "down",
        })
            .where(eq(monitor.id, monitorId));
        // Insert check result (remove statusCode and errorMessage if not in schema)
        await db.insert(checkResult).values({
            monitorId,
            status: results.isUp ? "up" : "down",
            responseMs: results.responseMs,
            createdAt: new Date(),
        });
        // Handle incidents and notifications
        if (!results.isUp) {
            // Check for existing ongoing incident
            const [ongoingIncident] = await db
                .select()
                .from(incident)
                .where(and(eq(incident.monitorId, monitorId), isNull(incident.endAt)));
            if (ongoingIncident) {
                // Update existing incident
                await db.update(incident)
                    .set({
                    durationMs: Date.now() - ongoingIncident.startAt.getTime(),
                    errorMessage: results.errorMessage || `HTTP ${results.statusCode || 'Unknown'}`,
                })
                    .where(eq(incident.id, ongoingIncident.id));
                console.log(`📝 Updated ongoing incident ${ongoingIncident.id} for monitor ${monitorId}`);
            }
            else {
                // Create new incident (remove createdAt if not in schema)
                const [newIncident] = await db.insert(incident).values({
                    userId: existingMonitor.userId,
                    monitorId,
                    status: "open",
                    startAt: new Date(),
                    endAt: null,
                    durationMs: 0,
                    errorMessage: results.errorMessage || `HTTP ${results.statusCode || 'Unknown'}`,
                }).returning();
                console.log(`🚨 Created new incident ${newIncident?.id} for monitor ${monitorId}`);
                // Send notification for new incident
                try {
                    const notification = generateNotificationMessages({
                        monitorId: existingMonitor.id,
                        url: existingMonitor.url,
                        method: existingMonitor.method,
                        expectedStatus: existingMonitor.expectedStatus,
                        userId: existingMonitor.userId,
                        name: existingMonitor.name,
                    }, results, true // isNewIncident
                    );
                    await NotificationService.notifyUser({
                        userId: existingMonitor.userId,
                        title: notification.title,
                        message: notification.message,
                        priority: notification.priority,
                        metadata: {
                            monitorId,
                            incidentId: newIncident?.id,
                            url: existingMonitor.url,
                            errorType: results.errorType,
                        }
                    });
                    console.log(`📧 Sent incident notification to user ${existingMonitor.userId}`);
                }
                catch (notificationError) {
                    console.error('Failed to send incident notification:', notificationError);
                }
            }
        }
        else {
            // Service is up - check if we need to resolve an incident
            const [ongoingIncident] = await db
                .select()
                .from(incident)
                .where(and(eq(incident.monitorId, monitorId), isNull(incident.endAt)));
            if (ongoingIncident) {
                // Resolve the incident
                const endTime = new Date();
                const totalDuration = endTime.getTime() - ongoingIncident.startAt.getTime();
                await db.update(incident)
                    .set({
                    endAt: endTime,
                    durationMs: totalDuration,
                })
                    .where(eq(incident.id, ongoingIncident.id));
                console.log(`✅ Resolved incident ${ongoingIncident.id} for monitor ${monitorId}`);
                // Send resolution notification
                try {
                    const notification = generateNotificationMessages({
                        monitorId: existingMonitor.id,
                        url: existingMonitor.url,
                        method: existingMonitor.method,
                        expectedStatus: existingMonitor.expectedStatus,
                        userId: existingMonitor.userId,
                        name: existingMonitor.name,
                    }, results, false, // isNewIncident
                    true // isResolved
                    );
                    await NotificationService.notifyUser({
                        userId: existingMonitor.userId,
                        title: notification.title,
                        message: notification.message,
                        priority: notification.priority,
                        metadata: {
                            monitorId,
                            incidentId: ongoingIncident.id,
                            url: existingMonitor.url,
                            downtimeDuration: totalDuration,
                        }
                    });
                    console.log(`📧 Sent resolution notification to user ${existingMonitor.userId}`);
                }
                catch (notificationError) {
                    console.error('Failed to send resolution notification:', notificationError);
                }
            }
        }
        console.log(`✅ Monitor check completed for ${existingMonitor.url}: ${results.isUp ? 'UP' : 'DOWN'} (${results.responseMs}ms)`);
    }
    catch (error) {
        console.error(`❌ Worker job failed for monitor ${monitorId}:`, error);
        throw error; // Re-throw to mark job as failed
    }
}, {
    connection,
    concurrency: 10, // Process up to 10 jobs concurrently
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 50 }, // Keep last 50 failed jobs
});
// Enhanced event handlers
worker.on("completed", (job) => {
    console.log(`✅ Monitor check job ${job.id} completed successfully`);
});
worker.on("failed", (job, err) => {
    console.error(`❌ Monitor check job ${job?.id} failed:`, err.message);
});
worker.on("error", (err) => {
    console.error("🚨 Worker error:", err);
});
worker.on("stalled", (jobId) => {
    console.warn(`⚠️ Job ${jobId} stalled`);
});
// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🔄 Gracefully shutting down worker...');
    await worker.close();
    await connection.quit();
    process.exit(0);
});
export default worker;
//# sourceMappingURL=index.js.map