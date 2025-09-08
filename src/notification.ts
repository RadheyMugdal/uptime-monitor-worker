import { db } from "./db/index.js";
import nodemailer from "nodemailer";
import { notificationChannel } from "./db/schema.js";
import { eq } from "drizzle-orm";
import axios from "axios";

// Types for better type safety
interface NotificationPayload {
    userId: string;
    title: string;
    message: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    metadata?: Record<string, any> | undefined;
}

interface NotificationResult {
    channelId: string;
    type: string;
    success: boolean;
    error?: string;
}

// Create transporter with better error handling
const createTransporter = () => {
    try {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587"),
            secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
            // Add connection timeout and other options
            connectionTimeout: 10000, // 10 seconds
            greetingTimeout: 5000,    // 5 seconds
            socketTimeout: 10000,     // 10 seconds
        });
    } catch (error) {
        console.error('Failed to create email transporter:', error);
        return null;
    }
};

const transporter = createTransporter();

// Enhanced notification service
export class NotificationService {
    private static async sendEmail(
        to: string,
        title: string,
        message: string,
        priority: string = 'medium'
    ): Promise<void> {
        if (!transporter) {
            throw new Error('Email transporter not available');
        }

        if (!process.env.SMTP_FROM) {
            throw new Error('SMTP_FROM environment variable not set');
        }

        const priorityEmojis = {
            low: '📢',
            medium: '⚠️',
            high: '🚨',
            critical: '🔴'
        };

        const emoji = priorityEmojis[priority as keyof typeof priorityEmojis] || '⚠️';

        await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to,
            subject: `${emoji} ${title}`,
            text: message,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: ${priority === 'critical' ? '#fee2e2' : priority === 'high' ? '#fef3c7' : '#f3f4f6'}; 
                                padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h2 style="margin: 0; color: ${priority === 'critical' ? '#dc2626' : priority === 'high' ? '#d97706' : '#374151'};">
                            ${emoji} ${title}
                        </h2>
                    </div>
                    <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb;">
                        <p style="font-size: 16px; line-height: 1.5; margin: 0; white-space: pre-line;">
                            ${message}
                        </p>
                    </div>
                    <div style="margin-top: 20px; padding: 10px; font-size: 12px; color: #6b7280; text-align: center;">
                        <p>This is an automated notification. Please do not reply to this email.</p>
                    </div>
                </div>
            `
        });
    }

    private static async sendWebhook(
        url: string,
        title: string,
        message: string,
        type: 'slack' | 'discord' | 'webhook',
        priority: string = 'medium'
    ): Promise<void> {
        const timeout = 10000; // 10 seconds timeout

        let payload: any;

        switch (type) {
            case 'slack':
                payload = {
                    text: `*${title}*\n${message}`,
                    attachments: [{
                        color: priority === 'critical' ? 'danger' : priority === 'high' ? 'warning' : 'good',
                        fields: [{
                            title: title,
                            value: message,
                            short: false
                        }],
                        footer: 'Monitor Alert',
                        ts: Math.floor(Date.now() / 1000)
                    }]
                };
                break;

            case 'discord':
                const colorMap = {
                    low: 0x36a64f,      // Green
                    medium: 0xffcc00,    // Yellow  
                    high: 0xff9900,      // Orange
                    critical: 0xff0000    // Red
                };

                payload = {
                    embeds: [{
                        title: title,
                        description: message,
                        color: colorMap[priority as keyof typeof colorMap] || colorMap.medium,
                        timestamp: new Date().toISOString(),
                        footer: {
                            text: 'Monitor Alert'
                        }
                    }]
                };
                break;

            case 'webhook':
            default:
                payload = {
                    title,
                    message,
                    priority,
                    timestamp: new Date().toISOString(),
                    type: 'monitor_alert'
                };
                break;
        }

        await axios.post(url, payload, {
            timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Monitor-Alert-Service/1.0'
            },
            // Retry configuration
            validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        });
    }

    static async notifyUser(payload: NotificationPayload): Promise<NotificationResult[]> {
        const { userId, title, message, priority = 'medium', metadata = {} } = payload;

        if (!userId || !title || !message) {
            throw new Error('Missing required notification parameters');
        }

        console.log(`Sending notification to user ${userId}: ${title}`);

        const results: NotificationResult[] = [];

        try {
            const channels = await db
                .select()
                .from(notificationChannel)
                .where(eq(notificationChannel.userId, userId));

            if (channels.length === 0) {
                console.warn(`No notification channels found for user ${userId}`);
                return results;
            }

            // Send notifications concurrently with Promise.allSettled for better performance
            const promises = channels.map(async (channel): Promise<NotificationResult> => {
                try {
                    switch (channel.type) {
                        case "email":
                            await this.sendEmail(channel.value, title, message, priority);
                            break;

                        case "slack":
                        case "discord":
                        case "webhook":
                            await this.sendWebhook(channel.value, title, message, channel.type as any, priority);
                            break;

                        default:
                            throw new Error(`Unsupported channel type: ${channel.type}`);
                    }

                    return {
                        channelId: channel.id,
                        type: channel.type,
                        success: true
                    };
                } catch (error) {
                    console.error(`Failed to send notification to ${channel.type} (${channel.id}):`, error);
                    return {
                        channelId: channel.id,
                        type: channel.type,
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    };
                }
            });

            const settlementResults = await Promise.allSettled(promises);

            settlementResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    results.push({
                        channelId: channels[index]!.id,
                        type: channels[index]!.type,
                        success: false,
                        error: result.reason?.message || 'Promise rejected'
                    });
                }
            });

            // Log summary
            const successful = results.filter(r => r.success).length;
            const total = results.length;
            console.log(`Notification sent to ${successful}/${total} channels for user ${userId}`);

            return results;

        } catch (error) {
            console.error('Failed to send notifications:', error);
            throw error;
        }
    }
}

// Legacy function for backward compatibility
export async function notifyUser(userId: string, message: string): Promise<NotificationResult[]> {
    return NotificationService.notifyUser({
        userId,
        title: "Monitor Alert",
        message,
        priority: 'medium'
    });
}

// Utility functions for common notification types
export const NotificationHelpers = {
    async sendCriticalAlert(userId: string, title: string, message: string, metadata?: Record<string, any>) {
        return NotificationService.notifyUser({
            userId,
            title,
            message,
            priority: 'critical',
            metadata
        });
    },

    async sendWarning(userId: string, title: string, message: string, metadata?: Record<string, any>) {
        return NotificationService.notifyUser({
            userId,
            title,
            message,
            priority: 'high',
            metadata
        });
    },

    async sendInfo(userId: string, title: string, message: string, metadata?: Record<string, any>) {
        return NotificationService.notifyUser({
            userId,
            title,
            message,
            priority: 'low',
            metadata
        });
    }
};