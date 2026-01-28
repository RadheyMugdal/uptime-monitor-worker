import { pgEnum } from "drizzle-orm/pg-core";
import { pgTable, text, timestamp, boolean, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const planEnum = pgEnum("plan", ["free", "pro", "business"])

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified")
		.$defaultFn(() => false)
		.notNull(),
	image: text("image"),
	plan: planEnum("plan").notNull().default("free"),
	subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
	createdAt: timestamp("created_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
	updatedAt: timestamp("updated_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
	updatedAt: timestamp("updated_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
});

export const status = pgEnum("status", ["up", "down", "paused", "unknown"]);
export const methods = pgEnum("methods", ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

export const monitor = pgTable("monitor", (t) => ({
	id: t.uuid("id").primaryKey().defaultRandom(),
	name: t.text("name").notNull(),
	url: t.text("url").notNull(),

	// Store frequency in minutes
	frequencyMinutes: t.integer("frequency_minutes").notNull().default(5),
	body: t.json("body").notNull().default({}),
	status: status("status").notNull().default("unknown"),
	method: methods("method").notNull().default("GET"),
	headers: t.json("headers").notNull().default({}),
	expectedStatus: t.integer("expected_status").notNull().default(200),
	lastCheckedAt: t.timestamp("last_checked_at", { withTimezone: true }),
	userId: t.text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

	createdAt: t.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: t.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const checkResult = pgTable("check_result", (t) => ({
	id: t.uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	monitorId: t.uuid("monitor_id").notNull().references(() => monitor.id, { onDelete: "cascade" }),
	status: status("status").notNull(),
	responseMs: t.integer("response_ms").notNull(),
	createdAt: t.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: t.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const incidentStatus = pgEnum("incident_status", ["open", "resolved"]);

export const incident = pgTable("incident", (t) => ({
	id: t.uuid("id").primaryKey().defaultRandom(),
	monitorId: t.uuid("monitor_id").notNull().references(() => monitor.id, { onDelete: "cascade" }),
	userId: t.text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	status: incidentStatus("status").notNull().default("open"),
	startAt: t.timestamp("start_at", { withTimezone: true }).notNull().defaultNow(),
	endAt: t.timestamp("end_at", { withTimezone: true }),
	durationMs: t.integer("duration_ms"),
	errorMessage: t.text("error_message"),
	createdAt: t.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: t.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}));



export const channelType = pgEnum("channel_type", [
	"email",
	"slack",
	"discord",
	"webhook"
]);

export const notificationChannel = pgTable("notification_channel", (t) => ({
	id: t.uuid("id").primaryKey().defaultRandom(),
	userId: t.text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	type: channelType("type").notNull(),
	value: t.text("value").notNull(),
	createdAt: t.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: t.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const statusPage = pgTable("status_page", (t) => ({
	id: t.uuid("id").primaryKey().defaultRandom(),
	userId: t.text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	slug: t.text("slug").notNull().unique(),
	title: t.text("title").notNull(),
	description: t.text("description"),
	isPublic: t.boolean("is_public").notNull().default(true),
	createdAt: t.timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: t.timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}));

export const statusPageMonitor = pgTable("status_page_monitor", (t) => ({
	statusPageId: t.uuid("status_page_id").notNull().references(() => statusPage.id, { onDelete: "cascade" }),
	monitorId: t.uuid("monitor_id").notNull().references(() => monitor.id, { onDelete: "cascade" }),
}), (t) => ({
	pk: primaryKey({ columns: [t.statusPageId, t.monitorId] }),
}));

export const statusPageRelations = relations(statusPage, ({ many }) => ({
	monitors: many(statusPageMonitor),
}));

export const statusPageMonitorRelations = relations(statusPageMonitor, ({ one }) => ({
	statusPage: one(statusPage, {
		fields: [statusPageMonitor.statusPageId],
		references: [statusPage.id],
	}),
	monitor: one(monitor, {
		fields: [statusPageMonitor.monitorId],
		references: [monitor.id],
	}),
}));

