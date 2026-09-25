import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, Check, Menu, MessageSquarePlus, MoreHorizontal, Send, Sparkles, Trash2, Users, X } from "lucide-react";
import { listAIConversations, listCrowdPredictions, listCrowdReadings, listFacilities, listTransportServices, replaceAIMessages, saveAIConversation } from "@/lib/supabaseData";
import { LoadingState, ErrorState } from "@/components/workspace/WorkspaceUI";

const initialMessage = {
  role: "assistant",
  content: "Namaste. I’m MahaFlow AI, your Maharashtra public transportation assistant. I can help with verified routes, timings, delays, stations, bus stands, and crowd information.",
};

const cleanAIText = value => String(value || "").replace(/\*\*/g, "").replace(/\*/g, "").trim();

const promptSuggestions = [
  "Which verified routes are available today?",
  "Show me the least crowded verified option.",
  "Are any of my saved routes delayed?",
];

const compactService = service => ({
  id: service.id,
  mode: service.mode,
  service_number: service.service_number,
  service_name: service.service_name,
  origin: service.origin,
  destination: service.destination,
  service_date: service.service_date,
  departure_time: service.departure_time,
  arrival_time: service.arrival_time,
  status: service.status,
  capacity: service.capacity,
  facility_id: service.facility_id,
});

const compactReading = (reading, includePrivateFields) => ({
  facility_id: reading.facility_id,
  zone: reading.zone,
  people_count: reading.people_count,
  crowd_level: reading.crowd_level,
  recorded_at: reading.recorded_at,
  ...(includePrivateFields ? { source: reading.source, model_version: reading.model_version, fps: reading.fps } : {}),
});

const compactPrediction = (prediction, includePrivateFields) => ({
  facility_id: prediction.facility_id,
  zone: prediction.zone,
  predicted_count: prediction.predicted_count,
  crowd_level: prediction.crowd_level,
  prediction_for: prediction.prediction_for,
  ...(includePrivateFields ? { model_version: prediction.model_version } : {}),
});

const newConversation = () => ({
  id: globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: "New conversation",
  updatedAt: Date.now(),
  messages: [initialMessage],
});

const loadHistory = key => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item?.id && Array.isArray(item.messages) && item.messages.length);
  } catch {
    return [];
  }
};

const ChatMessage = ({ message }) => (
  <article className={`mf-chat-message ${message.role === "assistant" ? "assistant" : "user"}`} data-testid={`mf-ai-message-${message.role}`}>
    {message.role === "assistant" && <div className="mf-chat-avatar"><Bot size={17}/></div>}
    <div className="mf-chat-bubble">
      {message.role === "assistant" && <span className="mf-chat-author">MahaFlow AI</span>}
      <p>{message.content}</p>
      {message.role === "assistant" && <div className="mf-chat-actions"><button type="button" aria-label="Copy answer" onClick={() => navigator.clipboard?.writeText(message.content)}><Check size={12}/> Copy</button></div>}
    </div>
  </article>
);

export const MahaFlowAI = ({ role, session, profile, setPage }) => {
  const historyKey = `mahaflow-ai-history:${session.user.id}:${role}`;
  const [conversations, setConversations] = useState(() => {
    const saved = loadHistory(historyKey);
    return saved.length ? saved : [newConversation()];
  });
  const [activeId, setActiveId] = useState(() => loadHistory(historyKey)[0]?.id || "");
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [data, setData] = useState({ services: [], readings: [], predictions: [], facilities: [] });
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [fromFacilityId, setFromFacilityId] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [predictionBusy, setPredictionBusy] = useState(false);
  const [predictionResult, setPredictionResult] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const messagesEndRef = useRef(null);

  const activeConversation = conversations.find(item => item.id === activeId) || conversations[0];
  const messages = activeConversation?.messages || [initialMessage];
  const isAuthority = role === "authority";
  const busStands = data.facilities.filter(facility => facility.kind === "bus" || facility.kind === "railway");

  useEffect(() => {
    if (!activeId && conversations[0]?.id) setActiveId(conversations[0].id);
  }, [activeId, conversations]);

  useEffect(() => {
    window.localStorage.setItem(historyKey, JSON.stringify(conversations.slice(0, 40)));
  }, [conversations, historyKey]);

  const syncConversation = conversation => Promise.all([
    saveAIConversation(session.user.id, role, conversation),
    replaceAIMessages(session.user.id, conversation.id, conversation.messages),
  ]).catch(() => {});

  useEffect(() => {
    let active = true;
    listAIConversations(session.user.id, role).then(remote => {
      if (active && remote.length) setConversations(remote);
    }).catch(() => {});
    return () => { active = false; };
  }, [role, session.user.id]);

  useEffect(() => {
    const syncTimer = window.setTimeout(() => {
      void Promise.all(conversations.slice(0, 40).map(syncConversation));
    }, 350);
    return () => window.clearTimeout(syncTimer);
  }, [conversations, historyKey]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [services, readings, predictions, facilities] = await Promise.all([
          listTransportServices(),
          isAuthority ? listCrowdReadings({ ownerId: session.user.id }) : listCrowdReadings(),
          isAuthority ? listCrowdPredictions({ ownerId: session.user.id }) : listCrowdPredictions(),
          listFacilities(),
        ]);
        if (!active) return;
        const scopedFacilities = isAuthority && profile?.facility_id ? facilities.filter(item => item.id === profile.facility_id) : facilities;
        setData({ services, readings, predictions, facilities: scopedFacilities });
      } catch (error) {
        if (active) setDataError(error.message || "Verified MahaFlow data is unavailable.");
      } finally {
        if (active) setLoadingData(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [isAuthority, profile?.facility_id, session.user.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId, messages.length, busy]);

  const context = useMemo(() => ({
    role,
    privacy_scope: isAuthority
      ? "Authority scope: use public transport schedules plus only this signed-in authority's facility crowd records. Never reveal another authority's records."
      : "Passenger scope: use public schedules and public crowd records only. Never reveal private authority records, model metadata, stream details, or internal operator information.",
    services: data.services.map(compactService),
    crowd_readings: data.readings.map(item => compactReading(item, isAuthority)),
    crowd_predictions: data.predictions.map(item => compactPrediction(item, isAuthority)),
    facilities: data.facilities.map(facility => ({
      id: facility.id,
      name: facility.name,
      kind: facility.kind,
      district: facility.district,
      state: facility.state,
    })),
  }), [data, isAuthority, role]);

  const updateConversation = (conversationId, updater) => {
    setConversations(current => current.map(item => item.id === conversationId ? { ...item, ...updater, updatedAt: Date.now() } : item));
  };

  const createChat = () => {
    const conversation = newConversation();
    setConversations(current => [conversation, ...current]);
    setActiveId(conversation.id);
    setMessageError("");
    setPredictionResult("");
    setMobileHistoryOpen(false);
  };

  const deleteChat = conversationId => {
    const remaining = conversations.filter(item => item.id !== conversationId);
    if (!remaining.length) {
      const conversation = newConversation();
      setConversations([conversation]);
      setActiveId(conversation.id);
    } else {
      setConversations(remaining);
      if (activeId === conversationId) setActiveId(remaining[0].id);
    }
  };

  const askAI = async (nextMessages, purpose = "chat", requestContext = context) => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || "";
    const response = await fetch(`${backendUrl}${purpose === "crowd_prediction" ? "/api/gemini/chat" : "/api/groq/chat"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: nextMessages, context: { ...requestContext, purpose } }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "MahaFlow AI is unavailable.");
    return cleanAIText(body.message);
  };

  const sendMessage = async event => {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy || !activeConversation) return;
    const nextMessages = [...messages, { role: "user", content }];
    updateConversation(activeConversation.id, { messages: nextMessages, title: activeConversation.title === "New conversation" ? content.slice(0, 42) : activeConversation.title });
    setInput("");
    setBusy(true);
    setMessageError("");
    try {
      const answer = await askAI(nextMessages);
      updateConversation(activeConversation.id, { messages: [...nextMessages, { role: "assistant", content: answer }] });
    } catch (error) {
      setMessageError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const askSuggestion = suggestion => {
    setInput(suggestion);
    window.setTimeout(() => document.querySelector('[data-testid="mf-ai-chat-input"]')?.focus(), 0);
  };

  const predictCrowd = async event => {
    event.preventDefault();
    if (!fromFacilityId || !destination.trim() || !date || !time || predictionBusy) return;
    const facility = data.facilities.find(item => item.id === fromFacilityId);
    const relevantServices = data.services.filter(service => {
      const matchesOrigin = service.facility_id === fromFacilityId || String(service.origin || "").toLowerCase().includes(String(facility?.name || "").toLowerCase());
      const matchesDestination = String(service.destination || "").toLowerCase().includes(destination.trim().toLowerCase());
      const serviceDate = String(service.service_date || "").slice(0, 10);
      const matchesDate = !serviceDate || serviceDate === date;
      const matchesTime = !service.departure_time || String(service.departure_time).slice(0, 5) === time;
      return matchesOrigin && matchesDestination && matchesDate && matchesTime;
    });
    const relevantReadings = data.readings.filter(reading => reading.facility_id === fromFacilityId);
    const relevantPredictions = data.predictions.filter(prediction => prediction.facility_id === fromFacilityId);
    const query = `Predict the crowd level for a ${facility?.kind === "railway" ? "railway" : "bus"} journey from ${facility?.name || "the selected bus stand"} to ${destination.trim()} on ${date} at ${time}. Analyze only the supplied YOLO crowd readings and prediction records for this facility and matching verified services. If there is not enough relevant data, say that the prediction is currently unavailable. Do not create a number or crowd level.`;
    setPredictionBusy(true);
    setPredictionResult("");
    setMessageError("");
    try {
      const answer = await askAI([{ role: "user", content: query }], "crowd_prediction", {
        ...context,
        selected_journey: { origin: facility?.name, destination: destination.trim(), date, time },
        services: relevantServices.map(compactService),
        crowd_readings: relevantReadings.map(item => compactReading(item, isAuthority)),
        crowd_predictions: relevantPredictions.map(item => compactPrediction(item, isAuthority)),
      });
       setPredictionResult(cleanAIText(answer));
    } catch (error) {
      setMessageError(error.message);
    } finally {
      setPredictionBusy(false);
    }
  };

  if (!chatOpen) return <div className="mf-ai-page mf-ai-hub">
    <div className="mf-ai-topbar"><div><span className="eyebrow"><Sparkles size={13}/> {role.toUpperCase()} · MAHAFLOW AI</span><h1>MahaFlow AI</h1><p>Choose the MahaFlow AI tool you want to use.</p></div><span className="mf-ai-privacy"><Users size={14}/> {isAuthority ? "Your facility scope" : "Public data scope"}</span></div>
    <section className="mf-ai-hub-grid">
      <article className="mf-ai-hub-card chat"><div className="mf-ai-hub-icon"><Bot size={24}/></div><span className="eyebrow">ASSISTED TRAVEL</span><h2>Chat with AI</h2><p>Ask about verified routes, timings, delays, stations, bus stands, and public crowd information.</p><button className="primary-button" onClick={() => setChatOpen(true)} data-testid="open-ai-chat-button">Chat with AI <ArrowRight size={16}/></button></article>
      <article className="mf-ai-hub-card prediction"><div className="mf-ai-hub-icon"><Sparkles size={24}/></div><span className="eyebrow">LIVE CROWD INSIGHT</span><h2>AI crowd prediction</h2><p>Review the latest crowd predictions from real authority CCTV and the configured YOLO model.</p><button className="outline-button" onClick={() => setPage?.("AI crowd prediction")} data-testid="open-ai-prediction-button">Open crowd prediction <ArrowRight size={16}/></button></article>
    </section>
    <div className="mf-ai-hub-note"><Users size={16}/><span><b>Your conversations are saved</b><small>MahaFlow keeps chat history on this account and on this device so you can continue later.</small></span></div>
  </div>;

  return <div className="mf-ai-page">
    <div className="mf-ai-topbar"><div><span className="eyebrow"><Sparkles size={13}/> {role.toUpperCase()} · MAHAFLOW AI</span><h1>MahaFlow AI</h1><p>Your verified Maharashtra public transportation assistant.</p></div><div className="mf-ai-top-actions"><span className="mf-ai-privacy"><Users size={14}/> {isAuthority ? "Your facility scope" : "Public data scope"}</span><button className="icon-button mf-ai-mobile-history" onClick={() => setMobileHistoryOpen(value => !value)} aria-label="Open chat history"><Menu size={18}/></button></div></div>
    <div className={`mf-ai-product-shell ${mobileHistoryOpen ? "history-open" : ""}`}>
      <aside className="mf-ai-history">
        <div className="mf-ai-history-head"><span><b>Conversations</b><small>Saved on this account and device</small></span><button className="icon-button" onClick={() => setMobileHistoryOpen(false)} aria-label="Close chat history"><X size={15}/></button></div>
        <button className="mf-ai-new-chat" onClick={createChat}><MessageSquarePlus size={16}/> New chat</button>
        <div className="mf-ai-history-list">{[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(conversation => <div className={`mf-ai-history-item ${conversation.id === activeConversation?.id ? "active" : ""}`} key={conversation.id}><button onClick={() => { setActiveId(conversation.id); setMobileHistoryOpen(false); }}><MessageSquarePlus size={14}/><span><b>{conversation.title}</b><small>{new Date(conversation.updatedAt).toLocaleDateString()}</small></span></button><button className="mf-ai-delete-chat" onClick={() => deleteChat(conversation.id)} aria-label={`Delete ${conversation.title}`}><Trash2 size={13}/></button></div>)}</div>
        <div className="mf-ai-history-footer"><span className="mf-chat-avatar"><Sparkles size={14}/></span><span><b>MahaFlow AI</b><small>Verified data only</small></span><MoreHorizontal size={16}/></div>
      </aside>
      <main className="mf-ai-chat-main">
        <div className="mf-ai-chat-header"><span><div className="mf-chat-avatar large"><Bot size={18}/></div><span><b>MahaFlow AI</b><small>Transport assistant · {isAuthority ? "authority workspace" : "passenger workspace"}</small></span></span><span className="mf-ai-live"><i/> Ready</span></div>
        {loadingData && <div className="mf-ai-inline-loading"><LoadingState label="Loading verified MahaFlow data…"/></div>}
        {dataError && <ErrorState message={dataError}/>}
        <div className="mf-ai-chat-scroll">
          {messages.length === 1 && <div className="mf-ai-welcome"><div className="mf-ai-welcome-icon"><Sparkles size={26}/></div><h2>How can I help you travel?</h2><p>Ask about verified routes, timings, delays, or crowd levels. MahaFlow AI will tell you when live data is unavailable.</p><div className="mf-ai-suggestions">{promptSuggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => askSuggestion(suggestion)}>{suggestion}<ArrowRight size={13}/></button>)}</div></div>}
          {messages.map((message, index) => <ChatMessage message={message} key={`${activeConversation?.id}-${index}`}/>)}{busy && <div className="mf-ai-thinking"><span/><span/><span/> Reviewing verified MahaFlow data…</div>}
          <div ref={messagesEndRef}/>
        </div>
        <form className="mf-ai-full-composer" onSubmit={sendMessage}><div className="mf-ai-composer-box"><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} rows="1" placeholder="Message MahaFlow AI…" aria-label="Message MahaFlow AI" data-testid="mf-ai-chat-input"/><div className="mf-ai-composer-footer"><span>Shift + Enter for a new line · MahaFlow data only</span><button className="mf-ai-send" disabled={busy || !input.trim()} aria-label="Send message" data-testid="mf-ai-send-button"><Send size={17}/></button></div></div></form>
        {messageError && <div className="mf-ai-error" data-testid="mf-ai-error">{messageError}</div>}
      </main>
    </div>
  </div>;
};