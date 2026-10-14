import { api } from "@/lib/api";
import type { LearnerAccess } from "@/api/licenses";

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export function getNotifications(): Promise<{ unread: number; notifications: AppNotification[] }> {
  return api("/notifications");
}

export function markNotificationRead(id: string): Promise<void> {
  return api(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(): Promise<void> {
  return api("/notifications/read-all", { method: "POST" });
}

export interface ReminderPreferences {
  enabled: boolean;
  localTime: string;
  timezone: string | null;
  days: number[];
  streakAlert: boolean;
  saved?: boolean;
}

export function getReminderPreferences(): Promise<ReminderPreferences> {
  return api("/notifications/preferences");
}

export function saveReminderPreferences(prefs: Omit<ReminderPreferences, "saved"> & { timezone: string }): Promise<void> {
  return api("/notifications/preferences", { method: "PUT", body: JSON.stringify(prefs) });
}

export type EngagementStatus = "not_started" | "inactive" | "slow" | "on_track" | "achieved";

export interface LearnerEngagement {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  participantId: string | null;
  batchId: string | null;
  batchName: string | null;
  status: EngagementStatus;
  sessionsCompleted: number;
  lastActiveAt: string | null;
  currentCefr: string | null;
  startCefr: string | null;
  targetCefr: string | null;
  progress: number | null;
  expectedProgress: number | null;
  remindersSent: number;
  lastRemindedAt: string | null;
  canRemindAt: string | null;
  needsAttention: boolean;
  license: LearnerAccess;
}

export interface EngagementOverview {
  learners: LearnerEngagement[];
  batches: { id: string; name: string; autoReminders: boolean }[];
  cooldownHours: number;
}

export function getLearnerEngagement(): Promise<EngagementOverview> {
  return api("/reminders/learners");
}

export function sendReminders(
  learnerIds: string[],
  title: string,
  message: string,
): Promise<{ results: { learnerId: string; status: "sent" | "cooldown" | "not_found"; canRemindAt?: string }[] }> {
  return api("/reminders/send", { method: "POST", body: JSON.stringify({ learnerIds, title, message }) });
}

export function setAutoReminders(batchId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  return api(`/reminders/batches/${batchId}/auto`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}

export const ENGAGEMENT_LABEL: Record<EngagementStatus, string> = {
  not_started: "Not started",
  inactive: "Inactive",
  slow: "Behind",
  on_track: "On track",
  achieved: "Goal achieved",
};

export const ENGAGEMENT_CLASS: Record<EngagementStatus, string> = {
  not_started: "bg-muted/15 text-muted",
  inactive: "bg-error/15 text-error",
  slow: "bg-warning/15 text-navy-deep",
  on_track: "bg-success/15 text-success",
  achieved: "bg-navy/10 text-navy",
};

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
