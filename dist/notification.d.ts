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
export declare class NotificationService {
    private static sendEmail;
    private static sendWebhook;
    static notifyUser(payload: NotificationPayload): Promise<NotificationResult[]>;
}
export declare function notifyUser(userId: string, message: string): Promise<NotificationResult[]>;
export declare const NotificationHelpers: {
    sendCriticalAlert(userId: string, title: string, message: string, metadata?: Record<string, any>): Promise<NotificationResult[]>;
    sendWarning(userId: string, title: string, message: string, metadata?: Record<string, any>): Promise<NotificationResult[]>;
    sendInfo(userId: string, title: string, message: string, metadata?: Record<string, any>): Promise<NotificationResult[]>;
};
export {};
//# sourceMappingURL=notification.d.ts.map