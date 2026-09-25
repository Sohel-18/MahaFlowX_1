import React, { useEffect, useMemo, useState } from "react";
import { Bell, BrainCircuit, CheckCircle2, TriangleAlert, X } from "lucide-react";
import { listAuthorities, listCrowdReadings, listSavedRoutes, listTransportServices } from "@/lib/supabaseData";

const makeAlerts = (role, payload) => {
  const alerts = [];
  if (role === "passenger") {
    const savedIds = new Set(payload.savedRoutes.map(route => route.route_id));
    payload.services.filter(service => savedIds.has(service.id) && ["delayed", "cancelled"].includes(String(service.status).toLowerCase())).forEach(service => {
      alerts.push({ id: `route-${service.id}`, tone: "warning", title: "Saved route update", text: `${service.service_number} is ${service.status}.` });
    });
    payload.readings.filter(reading => ["high", "very-high", "critical"].includes(String(reading.crowd_level).toLowerCase())).slice(0, 3).forEach(reading => {
      alerts.push({ id: `crowd-${reading.id}`, tone: "warning", title: "Verified crowd alert", text: `${reading.zone || "A facility"} is reporting ${reading.crowd_level} crowd.` });
    });
  } else if (role === "authority") {
    payload.services.filter(service => ["delayed", "cancelled"].includes(String(service.status).toLowerCase())).slice(0, 3).forEach(service => {
      alerts.push({ id: `service-${service.id}`, tone: "warning", title: "Operations update", text: `${service.service_number} is marked ${service.status}.` });
    });
    payload.readings.filter(reading => ["high", "very-high", "critical"].includes(String(reading.crowd_level).toLowerCase())).slice(0, 3).forEach(reading => {
      alerts.push({ id: `reading-${reading.id}`, tone: "warning", title: "YOLO crowd alert", text: `${reading.zone || "Your facility"} has a ${reading.crowd_level} reading.` });
    });
  } else {
    payload.authorities.filter(authority => authority.status && authority.status !== "active").slice(0, 3).forEach(authority => {
      alerts.push({ id: `authority-${authority.id}`, tone: "warning", title: "Authority account update", text: `${authority.display_name || authority.email} is ${authority.status}.` });
    });
  }
  if (!alerts.length) alerts.push({ id: "ready", tone: "info", title: "MahaFlow is monitoring", text: "New verified service, crowd, and saved-route updates will appear here." });
  return alerts;
};

export const WorkspaceUtilities = ({ role, userId, setPage }) => {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const seenKey = useMemo(() => `mahaflow-notifications:${userId || "anonymous"}:${role}`, [role, userId]);
  const [seenIds, setSeenIds] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`mahaflow-notifications:${userId || "anonymous"}:${role}`) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const unreadCount = alerts.filter(alert => !seenIds.includes(alert.id)).length;
  useEffect(() => {
    let active = true;
    const requests = role === "developer"
      ? Promise.all([listAuthorities()]).then(([authorities]) => ({ authorities }))
      : Promise.all([listTransportServices(), listCrowdReadings(), role === "passenger" ? listSavedRoutes(userId) : Promise.resolve([])]).then(([services, readings, savedRoutes]) => ({ services, readings, savedRoutes }));
    requests.then(payload => { if (active) setAlerts(makeAlerts(role, payload)); }).catch(() => { if (active) setAlerts([{ id: "unavailable", tone: "info", title: "Alerts unavailable", text: "Verified alert data is temporarily unavailable." }]); });
    return () => { active = false; };
  }, [role, userId]);

  const openNotifications = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && alerts.length) {
      const nextSeen = Array.from(new Set([...seenIds, ...alerts.map(alert => alert.id)]));
      setSeenIds(nextSeen);
      window.localStorage.setItem(seenKey, JSON.stringify(nextSeen));
    }
  };

  return <>
  <div className="workspace-utilities">
    <div className="notification-wrap">
      <button className={`notification-button ${open ? "selected" : ""}`} onClick={openNotifications} aria-label="Open alerts" data-testid="notifications-button">
        <Bell size={18}/>
        {unreadCount > 0 && <b>{unreadCount > 9 ? "9+" : unreadCount}</b>}
      </button>

      {open && (
        <div className="notification-panel" data-testid="notifications-panel">
          <div className="notification-head">
            <span>
              <b>Alerts</b>
              <small>Verified MahaFlow updates</small>
            </span>
            <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close alerts">
              <X size={14}/>
            </button>
          </div>

          {alerts.map(alert => (
            <div className="notification-item" key={alert.id}>
              {alert.tone === "warning" ? <TriangleAlert size={15}/> : <CheckCircle2 size={15}/>}
              <span>
                <b>{alert.title}</b>
                <small>{alert.text}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>

  {role !== "developer" && (
    <button
      className="ai-float-button"
      onClick={() => setPage("MF AI")}
      aria-label="Open MahaFlow AI"
      title="Open MahaFlow AI"
      data-testid="floating-ai-button"
    >
      <BrainCircuit size={22}/>
      <span>MF AI</span>
    </button>
  )}
</>;
};