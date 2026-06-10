"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Bell, 
  Search, 
  MapPin, 
  Building2, 
  ChevronDown, 
  Settings, 
  Check, 
  Clock, 
  X, 
  CheckSquare, 
  VolumeX, 
  Mail, 
  Eye,
  AlertTriangle,
  ArrowRight
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface HeaderProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    role: string;
    companyId: string;
    storeId?: string | null;
    storeScope?: string[];
  };
}

interface CompanyItem {
  companyId: string;
  companyName: string;
  logoUrl?: string | null;
  role: string;
}

interface StoreItem {
  id: string;
  code: string;
  name: string;
}

interface ReminderItem {
  category: string;
  label: string;
  count: number;
  severity: "saffron" | "red";
  deepLink: string;
}

interface NotificationItem {
  id: string;
  category: string;
  severity: string;
  title: string;
  body?: string | null;
  deepLink?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export default function Header({ user }: HeaderProps) {
  const { data: session, update } = useSession();
  const router = useRouter();

  // Switchers lists
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [activeCompanyName, setActiveCompanyName] = useState("Saarlekha Factory");
  const [activeStoreName, setActiveStoreName] = useState("All Stores");

  // Notifications dropdown state
  const [isBellOpen, setIsBellOpen] = useState(false);
  const [bellTab, setBellTab] = useState<"actions" | "feed" | "prefs">("actions");
  
  // Lists data
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [hasCriticalReminders, setHasCriticalReminders] = useState(false);

  // Preferences state
  const [prefs, setPrefs] = useState({
    inApp: true,
    email: false,
    emailDigest: "DAILY",
    mutedCategories: [] as string[]
  });

  const bellRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setIsBellOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch switchers and summary counts on mount
  useEffect(() => {
    async function loadContextData() {
      try {
        // Load active memberships
        const memRes = await fetch("/api/profile/memberships");
        if (memRes.ok) {
          const mems: CompanyItem[] = await memRes.json();
          setCompanies(mems);
          const current = mems.find(m => m.companyId === user.companyId);
          if (current) setActiveCompanyName(current.companyName);
        }

        // Load active stores
        const storeRes = await fetch("/api/profile/stores");
        if (storeRes.ok) {
          const activeStores: StoreItem[] = await storeRes.json();
          setStores(activeStores);
          const currentStore = activeStores.find(s => s.id === user.storeId);
          if (currentStore) {
            setActiveStoreName(currentStore.name);
          } else {
            setActiveStoreName("All Stores");
          }
        }
      } catch (err) {
        console.error("Error loading header context switchers:", err);
      }
    }

    loadContextData();
  }, [user.companyId, user.storeId]);

  // Fetch summary count and lists
  const fetchNotificationSummary = async () => {
    try {
      const res = await fetch("/api/notifications/summary");
      if (res.ok) {
        const data = await res.json();
        setUnreadNotifCount(data.unreadNotifications || 0);
        setHasCriticalReminders(data.hasCritical || false);
      }
    } catch (err) {
      console.error("Error fetching notification summary:", err);
    }
  };

  const loadRemindersAndNotifications = async () => {
    try {
      // Load action items
      const actRes = await fetch("/api/action-items");
      if (actRes.ok) {
        const actData = await actRes.json();
        setReminders(actData);
      }

      // Load notifications feed
      const notifRes = await fetch("/api/notifications");
      if (notifRes.ok) {
        const notifData = await notifRes.json();
        setNotifications(notifData);
      }

      // Load preferences
      const prefRes = await fetch("/api/notifications/prefs");
      if (prefRes.ok) {
        const prefData = await prefRes.json();
        setPrefs(prefData);
      }
    } catch (err) {
      console.error("Error loading notifications & reminders lists:", err);
    }
  };

  useEffect(() => {
    fetchNotificationSummary();
    const interval = setInterval(fetchNotificationSummary, 30000);
    return () => clearInterval(interval);
  }, []);

  // When bell dropdown opens, load fresh list details
  useEffect(() => {
    if (isBellOpen) {
      loadRemindersAndNotifications();
    }
  }, [isBellOpen]);

  // Switch company action
  const handleCompanyChange = async (newCompanyId: string) => {
    if (newCompanyId === user.companyId) return;
    try {
      await update({ companyId: newCompanyId });
      router.refresh();
      window.location.reload();
    } catch (err) {
      console.error("Failed to switch company:", err);
    }
  };

  // Switch store action
  const handleStoreChange = async (newStoreId: string) => {
    if (newStoreId === (user.storeId || "all")) return;
    try {
      await update({ storeId: newStoreId === "all" ? null : newStoreId });
      router.refresh();
      window.location.reload();
    } catch (err) {
      console.error("Failed to switch store:", err);
    }
  };

  // Mark single notification as read
  const handleMarkRead = async (notifId: string, deepLink?: string | null) => {
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: notifId }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, readAt: new Date().toISOString() } : n));
        fetchNotificationSummary();
        if (deepLink) {
          setIsBellOpen(false);
          router.push(deepLink);
        }
      }
    } catch (err) {
      console.error("Error marking read:", err);
    }
  };

  // Mark all read action
  const handleMarkAllRead = async () => {
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, readAt: new Date().toISOString() })));
        setUnreadNotifCount(0);
        fetchNotificationSummary();
      }
    } catch (err) {
      console.error("Error marking all read:", err);
    }
  };

  // Snooze action item
  const handleSnoozeReminder = async (category: string, hours: number) => {
    try {
      const res = await fetch("/api/action-items/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, snoozeHours: hours }),
      });
      if (res.ok) {
        setReminders(prev => prev.filter(r => r.category !== category));
        fetchNotificationSummary();
      }
    } catch (err) {
      console.error("Error snoozing reminder:", err);
    }
  };

  // Dismiss action item permanently
  const handleDismissReminder = async (category: string) => {
    try {
      const res = await fetch("/api/action-items/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (res.ok) {
        setReminders(prev => prev.filter(r => r.category !== category));
        fetchNotificationSummary();
      }
    } catch (err) {
      console.error("Error dismissing reminder:", err);
    }
  };

  // Update preferences
  const handleUpdatePrefs = async (updatedPrefs: typeof prefs) => {
    try {
      const res = await fetch("/api/notifications/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPrefs),
      });
      if (res.ok) {
        setPrefs(updatedPrefs);
      }
    } catch (err) {
      console.error("Error updating preferences:", err);
    }
  };

  // Toggle category mute
  const toggleMuteCategory = (cat: string) => {
    const isMuted = prefs.mutedCategories.includes(cat);
    const newMuted = isMuted 
      ? prefs.mutedCategories.filter(c => c !== cat)
      : [...prefs.mutedCategories, cat];
    handleUpdatePrefs({ ...prefs, mutedCategories: newMuted });
  };

  const totalUnreadCount = unreadNotifCount + reminders.length;

  return (
    <header className="h-16 bg-cream-light border-b border-cream-dark px-8 flex items-center justify-between sticky top-0 z-40 shadow-sm font-body">
      {/* Left Section: Switchers & Search */}
      <div className="flex items-center space-x-4 flex-1 max-w-2xl">
        
        {/* Company Dropdown Switcher */}
        <div className="relative flex items-center bg-cream border border-onyx/10 rounded-lg text-onyx/80 px-2.5 py-1 text-xs font-semibold hover:border-saffron hover:bg-cream-light transition-all duration-200">
          <Building2 size={13} className="text-saffron-dark mr-1.5" />
          <select
            value={user.companyId}
            onChange={(e) => handleCompanyChange(e.target.value)}
            className="bg-transparent pr-4 focus:outline-none cursor-pointer appearance-none text-xs font-semibold focus:ring-0 outline-none"
          >
            {companies.map((c) => (
              <option key={c.companyId} value={c.companyId} className="bg-cream-light text-onyx">
                {c.companyName} ({c.role.replace("_", " ")})
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 pointer-events-none text-onyx/40" />
        </div>

        {/* Store Dropdown Switcher */}
        <div className="relative flex items-center bg-cream border border-onyx/10 rounded-lg text-onyx/80 px-2.5 py-1 text-xs font-semibold hover:border-saffron hover:bg-cream-light transition-all duration-200">
          <MapPin size={13} className="text-saffron-dark mr-1.5" />
          <select
            value={user.storeId || "all"}
            onChange={(e) => handleStoreChange(e.target.value)}
            className="bg-transparent pr-4 focus:outline-none cursor-pointer appearance-none text-xs font-semibold focus:ring-0 outline-none"
          >
            {(!user.storeScope || user.storeScope.length === 0) && (
              <option value="all" className="bg-cream-light text-onyx">All Stores</option>
            )}
            {stores.map((s) => (
              <option key={s.id} value={s.id} className="bg-cream-light text-onyx">
                {s.name} ({s.code})
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 pointer-events-none text-onyx/40" />
        </div>

        {/* Search */}
        <div className="relative w-full hidden md:block max-w-xs">
          <span className="absolute inset-y-0 left-3 flex items-center text-onyx/40">
            <Search size={14} />
          </span>
          <input
            type="text"
            placeholder="Quick search registers, POs..."
            className="w-full text-xs pl-9 pr-4 py-1.5 bg-cream border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron transition-all duration-200"
          />
        </div>
      </div>

      {/* Right Section: Notifications & Profile */}
      <div className="flex items-center space-x-6">
        
        {/* Notification Bell Dropdown Container */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setIsBellOpen(!isBellOpen)}
            className="relative p-2 rounded-lg hover:bg-cream border border-transparent hover:border-onyx/5 transition-all duration-200 group focus:outline-none"
            title="View actions and alerts"
          >
            <Bell size={18} className="text-onyx/80 group-hover:text-onyx transition-colors duration-200" />
            {totalUnreadCount > 0 && (
              <span className={`absolute top-1 right-1 font-mono text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-pulse text-white ${hasCriticalReminders ? 'bg-red-600' : 'bg-saffron-dark'}`}>
                {totalUnreadCount}
              </span>
            )}
          </button>

          {/* Bell Panel Dropdown (Glassmorphism & Harmonious Layout) */}
          {isBellOpen && (
            <div className="absolute right-0 mt-3 w-96 bg-cream-light/95 backdrop-blur-md border border-cream-dark rounded-xl shadow-xl z-50 overflow-hidden transition-all duration-200 animate-in fade-in slide-in-from-top-1 text-onyx font-body">
              
              {/* Header block */}
              <div className="px-4 py-3 border-b border-cream-dark flex items-center justify-between bg-cream/50">
                <div className="flex items-center space-x-2">
                  <h3 className="text-xs font-bold tracking-wide text-onyx uppercase">Bell Center</h3>
                  {totalUnreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-saffron text-onyx rounded-md">
                      {totalUnreadCount} items
                    </span>
                  )}
                </div>
                
                {/* Actions line */}
                <div className="flex items-center space-x-2.5">
                  {bellTab === "feed" && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[10px] font-semibold text-saffron-dark hover:text-saffron transition-all duration-200 flex items-center space-x-1"
                    >
                      <CheckSquare size={12} />
                      <span>Mark all read</span>
                    </button>
                  )}
                  
                  <button
                    onClick={() => setBellTab(prev => prev === "prefs" ? "actions" : "prefs")}
                    className="p-1 text-onyx/60 hover:text-onyx rounded-md hover:bg-cream transition-all duration-200"
                    title="Preferences"
                  >
                    <Settings size={14} />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              {bellTab !== "prefs" && (
                <div className="flex border-b border-cream-dark text-xs font-semibold bg-cream/20">
                  <button
                    onClick={() => setBellTab("actions")}
                    className={`flex-1 text-center py-2.5 transition-all duration-200 border-b-2 ${bellTab === "actions" ? 'border-saffron text-saffron-dark font-bold' : 'border-transparent text-onyx/60 hover:text-onyx'}`}
                  >
                    Action items ({reminders.length})
                  </button>
                  <button
                    onClick={() => setBellTab("feed")}
                    className={`flex-1 text-center py-2.5 transition-all duration-200 border-b-2 ${bellTab === "feed" ? 'border-saffron text-saffron-dark font-bold' : 'border-transparent text-onyx/60 hover:text-onyx'}`}
                  >
                    Event Feed ({unreadNotifCount})
                  </button>
                </div>
              )}

              {/* Tab Contents */}
              <div className="max-h-80 overflow-y-auto">
                
                {/* Actions Tab */}
                {bellTab === "actions" && (
                  <div className="divide-y divide-cream-dark">
                    {reminders.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-onyx/40">
                        All caught up! No pending actions.
                      </div>
                    ) : (
                      reminders.map((item) => (
                        <div key={item.category} className="p-3 flex items-start justify-between hover:bg-cream/35 transition-all duration-200 group">
                          {/* Alert level strip */}
                          <div className="flex items-start space-x-3 flex-1 min-w-0">
                            <span className={`w-1.5 h-8 rounded-full shrink-0 ${item.severity === "red" ? 'bg-red-500' : 'bg-saffron'}`} />
                            <div className="min-w-0">
                              <button
                                onClick={() => {
                                  setIsBellOpen(false);
                                  router.push(item.deepLink);
                                }}
                                className="text-left text-xs font-bold hover:text-saffron-dark block leading-snug cursor-pointer"
                              >
                                {item.label}
                              </button>
                              <span className="text-[10px] text-onyx/40 font-mono">
                                Category: {item.category.replace("_", " ")}
                              </span>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center space-x-1.5 ml-2">
                            <button
                              onClick={() => handleSnoozeReminder(item.category, 24)}
                              className="p-1 text-onyx/40 hover:text-onyx hover:bg-cream rounded-md transition-all duration-200"
                              title="Snooze 24 hours"
                            >
                              <Clock size={12} />
                            </button>
                            <button
                              onClick={() => handleDismissReminder(item.category)}
                              className="p-1 text-onyx/40 hover:text-red-600 hover:bg-red-50 rounded-md transition-all duration-200"
                              title="Dismiss"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Notifications Feed Tab */}
                {bellTab === "feed" && (
                  <div className="divide-y divide-cream-dark">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-xs text-onyx/40">
                        No notifications to display.
                      </div>
                    ) : (
                      notifications.map((notif) => (
                        <div 
                          key={notif.id} 
                          onClick={() => handleMarkRead(notif.id, notif.deepLink)}
                          className={`p-3 flex items-start space-x-3 hover:bg-cream/35 transition-all duration-200 cursor-pointer ${!notif.readAt ? 'bg-cream/15' : ''}`}
                        >
                          {/* Unread circle */}
                          {!notif.readAt ? (
                            <span className="w-2 h-2 mt-1.5 rounded-full bg-saffron shrink-0" />
                          ) : (
                            <span className="w-2 h-2 mt-1.5 rounded-full border border-onyx/15 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${!notif.readAt ? 'font-bold text-onyx' : 'text-onyx/70'}`}>
                              {notif.title}
                            </p>
                            {notif.body && (
                              <p className="text-[10px] text-onyx/50 truncate mt-0.5">{notif.body}</p>
                            )}
                            <span className="text-[9px] text-onyx/30 font-mono mt-1 block">
                              {new Date(notif.createdAt).toLocaleDateString()} at {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          
                          {notif.deepLink && (
                            <ArrowRight size={12} className="text-onyx/20 shrink-0 self-center" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Preferences Tab */}
                {bellTab === "prefs" && (
                  <div className="p-4 space-y-4 text-xs">
                    <h4 className="font-bold border-b border-cream-dark pb-1 text-onyx/80">Preferences</h4>
                    
                    {/* Delivery channels */}
                    <div className="space-y-2">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prefs.inApp}
                          onChange={(e) => handleUpdatePrefs({ ...prefs, inApp: e.target.checked })}
                          className="rounded text-saffron border-onyx/20 focus:ring-saffron"
                        />
                        <span className="font-semibold">In-app Alerts enabled</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prefs.email}
                          onChange={(e) => handleUpdatePrefs({ ...prefs, email: e.target.checked })}
                          className="rounded text-saffron border-onyx/20 focus:ring-saffron"
                        />
                        <span className="font-semibold flex items-center space-x-1">
                          <Mail size={12} className="text-onyx/60" />
                          <span>Email notifications</span>
                        </span>
                      </label>
                    </div>

                    {/* Email Digest config */}
                    {prefs.email && (
                      <div className="space-y-1 bg-cream/35 p-2 rounded-lg border border-cream-dark">
                        <span className="text-[10px] font-bold text-onyx/60 uppercase block">Digest frequency</span>
                        <select
                          value={prefs.emailDigest}
                          onChange={(e) => handleUpdatePrefs({ ...prefs, emailDigest: e.target.value })}
                          className="w-full text-xs bg-cream border border-onyx/10 rounded px-1.5 py-1 focus:outline-none focus:border-saffron"
                        >
                          <option value="OFF">OFF (No email digests)</option>
                          <option value="INSTANT">INSTANT (Send immediately)</option>
                          <option value="DAILY">DAILY (Once per day)</option>
                          <option value="WEEKLY">WEEKLY (Once per week)</option>
                        </select>
                      </div>
                    )}

                    {/* Categories mute config */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-onyx/60 uppercase block">Muted Event Streams</span>
                      <div className="grid grid-cols-2 gap-2">
                        {["APPROVAL", "STATUS", "PAYMENT", "STOCK", "QUALITY", "SYSTEM", "MENTION"].map((category) => {
                          const isMuted = prefs.mutedCategories.includes(category);
                          return (
                            <button
                              key={category}
                              type="button"
                              onClick={() => toggleMuteCategory(category)}
                              className={`px-2 py-1 rounded border text-[10px] font-semibold text-center truncate flex items-center justify-between hover:border-saffron/50 transition-all duration-200 ${isMuted ? 'bg-red-50/50 border-red-200/60 text-red-700/80' : 'bg-cream/20 border-onyx/10 text-onyx/80'}`}
                            >
                              <span>{category}</span>
                              {isMuted ? <VolumeX size={10} /> : <Eye size={10} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

              </div>
              
              {/* Footer strip */}
              <div className="bg-cream/50 px-4 py-2 text-center border-t border-cream-dark">
                <button
                  onClick={() => {
                    setIsBellOpen(false);
                    router.push("/dashboard");
                  }}
                  className="text-[10px] font-bold text-onyx/50 hover:text-saffron-dark uppercase tracking-widest transition-colors duration-200"
                >
                  Go to Action Dashboard
                </button>
              </div>

            </div>
          )}
        </div>

        {/* Divider */}
        <span className="w-px h-6 bg-cream-dark" />

        {/* User profile details */}
        <div className="flex items-center space-x-2 cursor-pointer hover:opacity-85 transition-opacity duration-200" onClick={() => router.push("/settings/company")}>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold leading-none text-onyx">{user.name || "User"}</p>
            <p className="text-[9px] font-mono tracking-wider text-onyx/50 uppercase leading-none mt-1">
              {user.role.replace("_", " ")}
            </p>
          </div>
          <ChevronDown size={14} className="text-onyx/40" />
        </div>
      </div>
    </header>
  );
}
