import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  timeAgo,
  type AppNotification,
} from "@/api/notifications";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
const POLL_MS = 60_000;

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  function load() {
    getNotifications()
      .then((r) => {
        setItems(r.notifications);
        setUnread(r.unread);
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function openItem(n: AppNotification) {
    if (!n.read) {
      markNotificationRead(n.id).catch(() => {});
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function readAll() {
    await markAllNotificationsRead().catch(() => {});
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setUnread(0);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={tr("Notifications")}
        className="relative p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer"
      >
        <Bell size={22} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-error text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-surface border border-rule rounded-card shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
            <p className="text-sm font-semibold text-ink">{tr("Notifications")}</p>
            {unread > 0 && (
              <button onClick={readAll} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
                {tr("Mark all read")}</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-6 text-sm text-muted text-center">{tr("You're all caught up.")}</p>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper-warm transition-colors cursor-pointer flex gap-2.5 ${
                  n.read ? "" : "bg-navy/5"
                }`}
              >
                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read ? "bg-transparent" : "bg-navy"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{trServer(n.title)}</span>
                  <span className="block text-xs text-muted mt-0.5 line-clamp-2">{trServer(n.body)}</span>
                  <span className="block text-[11px] text-muted mt-1">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
