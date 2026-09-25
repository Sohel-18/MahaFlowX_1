import React, { useEffect, useMemo, useState } from "react";
import { Activity, BusFront, Camera, Check, Clock3, Cpu, Edit3, MapPin, Plus, Radio, Trash2, TrainFront, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { addCamera, addTransportService, deleteCamera, deleteTransportService, getUserSettings, listCameras, listCrowdObservations, listCrowdPredictions, listCrowdReadings, listFacilities, listTransportServices, updateCamera, updateTransportService } from "@/lib/supabaseData";
import { useWorkspaceData } from "@/hooks/useWorkspaceData";
import { EmptyState, ErrorState, LoadingState, SectionHeader, StatusBadge, formatDateTime12, formatTime12 } from "@/components/workspace/WorkspaceUI";
import { StreamPlayer } from "@/components/workspace/StreamPlayer";
import { SettingsPanel } from "@/components/workspace/SettingsPanel";

const emptyCamera = { camera_id: "", name: "", zone: "", stream_url: "", protocol: "HLS", detection_enabled: true };
const cctvBackendUrl = import.meta.env.VITE_CCTV_BACKEND_URL || import.meta.env.VITE_BACKEND_URL || "";
const readApiBody = async response => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(response.status === 404
      ? "CCTV backend endpoint was not found. Set the FastAPI backend URL in VITE_CCTV_BACKEND_URL."
      : `CCTV backend returned an invalid response (${response.status}).`);
  }
};

const fileAsBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("The CCTV frame could not be read."));
  reader.onload = () => resolve(String(reader.result));
  reader.readAsDataURL(file);
});

const CameraInference = ({ camera }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");

  const analyze = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_base64: await fileAsBase64(file) }),
      });
       const body = await readApiBody(response);
      if (!response.ok) throw new Error(body.detail || "YOLO inference failed.");
      setResult(body);
    } catch (error) {
      setResult(null);
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="camera-inference">
    <label className="outline-button camera-frame-button">
      <input type="file" accept="image/*" onChange={analyze} disabled={busy}/>
      {busy ? <><span className="loading-ring loading-ring-dark"/> Predicting…</> : "Analyze CCTV frame"}
    </label>
    {result && <div className="camera-inference-result"><StatusBadge value={result.crowd_level}/><b>{result.count} people</b><small>{result.boxes?.length || 0} bounding boxes · {result.model}</small></div>}
    {message && <small className="camera-inference-error">{message}</small>}
  </div>;
};

const CctvAnalysisSummary = ({ camera, result, busy, error, onAnalyze }) => <div className="cctv-url-analysis">
  <button type="button" className="outline-button" onClick={() => onAnalyze(camera)} disabled={busy || !camera.stream_url} data-testid={`cctv-analyze-url-${camera.id}`}>
    {busy ? <><span className="loading-ring loading-ring-dark"/> Analyzing URL…</> : "Analyze CCTV URL"}
  </button>
  {result && <div className="cctv-analysis-result" data-testid={`cctv-analysis-result-${camera.id}`}><div><StatusBadge value={result.crowd_level}/><b>{result.current_head_count} current heads</b></div><dl><span><dt>3-day average</dt><dd>{result.three_day_average ?? "Not enough history"}</dd></span><span><dt>Average scan</dt><dd>{result.average_crowd}</dd></span><span><dt>Peak</dt><dd>{result.peak_crowd}</dd></span><span><dt>Measurements</dt><dd>{result.measurements}</dd></span></dl><small>Fixed comparison: below 80% Low · 80–120% Normal · above 120% High</small></div>}
  {error && <small className="camera-inference-error" data-testid={`cctv-analysis-error-${camera.id}`}>{error}</small>}
</div>;

const CctvManager = ({ session, profile }) => {
  const cameras = useWorkspaceData(() => listCameras(session.user.id), [session.user.id]);
  const facilities = useWorkspaceData(() => listFacilities(), []);
  const facility = facilities.data.find(item => item.id === profile?.facility_id);
  const [form, setForm] = useState(emptyCamera);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysisBusyId, setAnalysisBusyId] = useState("");
  const [analysisResults, setAnalysisResults] = useState({});
  const [analysisErrors, setAnalysisErrors] = useState({});
  const [workerEndpoint, setWorkerEndpoint] = useState(cctvBackendUrl);
  useEffect(() => {
    getUserSettings(session.user.id).then(settings => {
      if (settings?.yolo_worker_url) setWorkerEndpoint(settings.yolo_worker_url);
    }).catch(() => {});
  }, [session.user.id]);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const reset = () => { setForm(emptyCamera); setEditingId(""); };
  const save = async event => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const payload = { ...form, owner_user_id: session.user.id, facility_id: profile?.facility_id || null, station: facility?.name || "", ...(editingId ? {} : { status: "pending" }) };
      if (editingId) await updateCamera(editingId, payload);
      else await addCamera(payload);
      reset(); await cameras.reload(); setMessage(editingId ? "Camera updated." : "Camera endpoint added.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const edit = camera => { setEditingId(camera.id); setForm({ camera_id: camera.camera_id || "", name: camera.name || "", zone: camera.zone || "", stream_url: camera.stream_url || "", protocol: camera.protocol || "HLS", detection_enabled: camera.detection_enabled !== false }); };
  const remove = async id => { await deleteCamera(id); await cameras.reload(); };
  const analyzeUrl = async camera => {
    if (!camera.stream_url || analysisBusyId) return;
    setAnalysisBusyId(camera.id);
    setAnalysisErrors(current => ({ ...current, [camera.id]: "" }));
    try {
      const baseUrl = workerEndpoint || cctvBackendUrl;
      const endpoint = baseUrl ? `${baseUrl.replace(/\/$/, "")}/cctv` : "/api/cctv";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ camera_id: camera.camera_id || camera.id, zone: camera.zone, stream_url: camera.stream_url, max_seconds: 30, sample_interval_seconds: 2 }),
      });
      const body = await readApiBody(response);
      if (!response.ok) throw new Error(body.detail || "CCTV analysis failed.");
      setAnalysisResults(current => ({ ...current, [camera.id]: body }));
    } catch (error) {
      setAnalysisErrors(current => ({ ...current, [camera.id]: error.message || "CCTV analysis failed." }));
    } finally {
      setAnalysisBusyId("");
    }
  };
  return <><SectionHeader eyebrow="AUTHORITY · SECURE VIDEO" title="CCTV cameras" description="Register real MP4, HLS, or RTSP endpoints. The assigned facility location is filled from your authority access code." action={<span className="live-dot"><i/> {cameras.data.filter(item => item.status === "online").length} online</span>}/><div className="camera-workspace"><form className="data-form" onSubmit={save}><h3>{editingId ? "Edit camera" : "Add camera"}</h3><p>Stream URLs remain protected by owner-level RLS. No address or location entry is required.</p><div className="verified-facility camera-facility"><MapPin size={16}/><span><b>{facility?.name || "Assigned facility"}</b><small>{facility?.address || "Facility address is loaded from the registered authority location."}</small></span></div><label>Camera ID<input value={form.camera_id} onChange={event => set("camera_id", event.target.value)} data-testid="camera-id-input" placeholder="CAM-ENTRANCE-01" required/></label><label>Display name<input value={form.name} onChange={event => set("name", event.target.value)} data-testid="camera-name-input" required/></label><label>Zone<input value={form.zone} onChange={event => set("zone", event.target.value)} data-testid="camera-zone-input" placeholder="Main entrance" required/></label><label>Protocol<select value={form.protocol} onChange={event => set("protocol", event.target.value)} data-testid="camera-protocol-select"><option>HLS</option><option>MP4</option><option>RTSP</option><option>WEBRTC</option></select></label><label>Secure stream URL<input type="url" value={form.stream_url} onChange={event => set("stream_url", event.target.value)} data-testid="camera-stream-url-input" placeholder="https://…/stream.m3u8" required/></label><label className="check"><input type="checkbox" checked={form.detection_enabled} onChange={event => set("detection_enabled", event.target.checked)} data-testid="camera-detection-checkbox"/><span>Enable YOLO head detection when worker connects</span></label><div className="form-actions"><button className="primary-button" data-testid="cctv-add-stream-button" disabled={busy}>{editingId ? <Check size={17}/> : <Plus size={17}/>} {busy ? "Saving…" : editingId ? "Save camera" : "Add camera"}</button>{editingId && <button type="button" className="outline-button" onClick={reset}><X size={15}/>Cancel</button>}</div>{message && <div className="notice-line" data-testid="camera-form-message">{message}</div>}</form><div className="real-camera-grid">{cameras.loading ? <LoadingState/> : cameras.error ? <ErrorState message={cameras.error}/> : cameras.data.length ? cameras.data.map(camera => <article className="real-camera-card" key={camera.id} data-testid={`camera-card-${camera.id}`}><StreamPlayer camera={camera}/><div className="camera-meta"><span><b>{camera.name}</b><small>{camera.camera_id} · {camera.zone} · {camera.station || facility?.name || "Assigned facility"}</small></span><StatusBadge value={camera.status}/><button className="icon-button" aria-label={`Edit ${camera.name}`} data-testid={`camera-edit-${camera.id}`} onClick={() => edit(camera)}><Edit3 size={16}/></button><button className="icon-button" aria-label={`Delete ${camera.name}`} data-testid={`camera-delete-${camera.id}`} onClick={() => remove(camera.id)}><Trash2 size={16}/></button></div><div className="camera-tech"><span>{camera.protocol}</span><span>{camera.detection_enabled ? "AI enabled" : "AI paused"}</span><span>{camera.last_seen_at ? formatDateTime12(camera.last_seen_at) : "Awaiting first signal"}</span></div><CameraInference camera={camera}/><CctvAnalysisSummary camera={camera} result={analysisResults[camera.id]} busy={analysisBusyId === camera.id} error={analysisErrors[camera.id]} onAnalyze={analyzeUrl}/></article>) : <EmptyState icon={Camera} title="No cameras registered" message="Add your first real stream endpoint using the form." testId="cameras-empty"/>}</div></div></>;
};

const emptyTransport = { service_number: "", service_name: "", origin: "", destination: "", departure: "", arrival: "", service_date: "", bay: "", capacity: "", vehicle: "", driver: "", status: "scheduled" };

const TransportRegistry = ({ session, profile }) => {
  const facilities = useWorkspaceData(() => listFacilities(), []);
  const services = useWorkspaceData(() => listTransportServices({ ownerId: session.user.id }), [session.user.id]);
  const facility = facilities.data.find(item => item.id === profile?.facility_id);
  const mode = facility?.kind || "bus";
  const [form, setForm] = useState(emptyTransport);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const reset = () => { setForm(emptyTransport); setEditingId(""); };
  const seedDemo = async () => {
    setBusy(true); setMessage("");
    try {
      const sample = mode === "bus"
        ? [{ service_number: "MH-BUS-101", service_name: "Pune Express", origin: "Pune", destination: "Mumbai", departure_time: "07:30", arrival_time: "11:30", bay_or_platform: "Bay 4", vehicle_registration: "MH12-AB-1010" }, { service_number: "MH-BUS-205", service_name: "Nashik Link", origin: "Pune", destination: "Nashik", departure_time: "09:15", arrival_time: "12:10", bay_or_platform: "Bay 2", vehicle_registration: "MH14-CD-2050" }]
        : [{ service_number: "MFR-EXP-101", service_name: "Deccan Express", origin: "Pune", destination: "Mumbai", departure_time: "06:40", arrival_time: "09:55", bay_or_platform: "Platform 3", vehicle_registration: "CR-EXP-101" }, { service_number: "MFR-EXP-205", service_name: "Godavari Express", origin: "Pune", destination: "Nashik", departure_time: "10:20", arrival_time: "13:45", bay_or_platform: "Platform 5", vehicle_registration: "CR-EXP-205" }];
      await Promise.all(sample.map(service => addTransportService({ ...service, owner_user_id: session.user.id, facility_id: profile?.facility_id || null, mode, capacity: 80, status: "scheduled", active: true })));
      await services.reload();
      setMessage("Sample schedule data added. Crowd values still come only from authority readings.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const save = async event => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const payload = { owner_user_id: session.user.id, facility_id: profile?.facility_id || null, mode, service_number: form.service_number, service_name: form.service_name, origin: form.origin, destination: form.destination, service_date: form.service_date || null, departure_time: form.departure, arrival_time: form.arrival, bay_or_platform: form.bay, vehicle_registration: form.vehicle, driver_id: form.driver, capacity: Number(form.capacity || 0), status: form.status, active: true };
      if (editingId) await updateTransportService(editingId, payload);
      else await addTransportService(payload);
      reset(); await services.reload(); setMessage(editingId ? "Transport service updated." : "Service registered.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const edit = service => { setEditingId(service.id); setForm({ service_number: service.service_number || "", service_name: service.service_name || "", origin: service.origin || "", destination: service.destination || "", service_date: String(service.service_date || "").slice(0, 10), departure: String(service.departure_time || "").slice(0, 5), arrival: String(service.arrival_time || "").slice(0, 5), bay: service.bay_or_platform || "", capacity: service.capacity || "", vehicle: service.vehicle_registration || "", driver: service.driver_id || "", status: service.status || "scheduled" }); };
  const remove = async id => { await deleteTransportService(id); await services.reload(); };
  return <><SectionHeader eyebrow="AUTHORITY · OPERATIONS" title="Transport registry" description={`Register and maintain ${mode === "bus" ? "buses" : "trains"} for your code-assigned ${mode === "bus" ? "bus stand" : "railway station"}. Edit on-time or delay status whenever operations change.`}/><div className="registry-layout"><form className="data-form registry-form" onSubmit={save}><div className="locked-mode" data-testid="authority-transport-mode">{mode === "bus" ? <BusFront/> : <TrainFront/>}<span><small>Code-locked network</small><b>{mode === "bus" ? "Bus service" : "Railway service"}</b><small>{facility?.name || "Assigned facility"}</small></span></div><div className="form-grid"><label>Service number<input value={form.service_number} onChange={event => set("service_number", event.target.value)} data-testid="service-number-input" required/></label><label>Service name<input value={form.service_name} onChange={event => set("service_name", event.target.value)} data-testid="service-name-input" required/></label><label>Origin<input value={form.origin} onChange={event => set("origin", event.target.value)} data-testid="service-origin-input" required/></label><label>Destination<input value={form.destination} onChange={event => set("destination", event.target.value)} data-testid="service-destination-input" required/></label><label>Service date (optional)<input value={form.service_date} onChange={event => set("service_date", event.target.value)} type="date" data-testid="service-date-input"/><small className="time-preview">{form.service_date ? "Only this date" : "Repeats every day"}</small></label><label>Departure<input value={form.departure} onChange={event => set("departure", event.target.value)} type="time" data-testid="service-departure-input" required/><small className="time-preview">{formatTime12(form.departure)}</small></label><label>Arrival<input value={form.arrival} onChange={event => set("arrival", event.target.value)} type="time" data-testid="service-arrival-input" required/><small className="time-preview">{formatTime12(form.arrival)}</small></label><label>{mode === "bus" ? "Bay" : "Platform"}<input value={form.bay} onChange={event => set("bay", event.target.value)} data-testid="service-bay-input"/></label><label>Capacity<input value={form.capacity} onChange={event => set("capacity", event.target.value)} type="number" min="0" data-testid="service-capacity-input"/></label><label>Vehicle registration<input value={form.vehicle} onChange={event => set("vehicle", event.target.value)} data-testid="service-vehicle-input"/></label><label>Driver / crew ID<input value={form.driver} onChange={event => set("driver", event.target.value)} data-testid="service-driver-input"/></label><label>Operating status<select value={form.status} onChange={event => set("status", event.target.value)} data-testid="service-status-select"><option value="scheduled">Scheduled</option><option value="on time">On time</option><option value="delayed">Delayed</option><option value="boarding">Boarding</option><option value="cancelled">Cancelled</option></select></label></div><div className="form-actions"><button className="primary-button" data-testid="register-transport-button" disabled={busy}>{editingId ? <Check size={17}/> : <Plus size={17}/>} {busy ? "Saving…" : editingId ? "Save service" : "Register service"}</button><button type="button" className="outline-button" data-testid="add-simulated-services-button" disabled={busy || !profile?.facility_id} onClick={seedDemo}>Add sample schedules</button>{editingId && <button type="button" className="outline-button" onClick={reset}><X size={15}/>Cancel</button>}</div>{message && <div className="notice-line" data-testid="transport-registry-message">{message}</div>}</form><div className="service-list">{services.loading ? <LoadingState/> : services.error ? <ErrorState message={services.error}/> : services.data.length ? services.data.map(service => <article className="service-row detailed-service-row" key={service.id} data-testid={`authority-service-${service.id}`}><div className={`service-mode ${service.mode}`}>{service.mode === "bus" ? <BusFront/> : <TrainFront/>}</div><div className="service-main"><span>{service.service_number}</span><b>{service.origin} → {service.destination}</b><small>{service.service_name} · {service.service_date ? `${service.service_date} · ` : "Daily · "}{service.vehicle_registration || "Vehicle pending"} · Capacity {service.capacity || "not set"}</small></div><div className="service-time"><span><small>Leaves</small><b>{formatTime12(service.departure_time)}</b></span><span><small>Arrives</small><b>{formatTime12(service.arrival_time)}</b></span><small>{service.bay_or_platform || "—"}</small></div><StatusBadge value={service.status}/><button className="icon-button" aria-label={`Edit ${service.service_number}`} data-testid={`edit-service-${service.id}`} onClick={() => edit(service)}><Edit3 size={16}/></button><button className="icon-button" aria-label={`Delete ${service.service_number}`} data-testid={`delete-service-${service.id}`} onClick={() => remove(service.id)}><Trash2 size={16}/></button></article>) : <EmptyState icon={BusFront} title="No services registered" message="Add the first scheduled service for this facility." testId="authority-services-empty"/>}</div></div></>;
};

const LiveCrowd = ({ session }) => {
  const readings = useWorkspaceData(() => listCrowdReadings({ ownerId: session.user.id }), [session.user.id]);
  const observations = useWorkspaceData(() => listCrowdObservations({ ownerId: session.user.id }).catch(() => []), [session.user.id]);
  const predictions = useWorkspaceData(() => listCrowdPredictions({ ownerId: session.user.id }), [session.user.id]);
  const displayReadings = readings.data.length ? readings.data : observations.data.map(item => ({ ...item, people_count: item.head_count, recorded_at: item.captured_at, source: item.source || "yolo", model_version: item.model_name }));
  const reloadReadings = readings.reload;
  useEffect(() => { const channel = supabase.channel(`crowd-${session.user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "mahaflow_crowd_readings", filter: `owner_user_id=eq.${session.user.id}` }, () => reloadReadings()).subscribe(); return () => { void supabase.removeChannel(channel); }; }, [session.user.id, reloadReadings]);
  return <><SectionHeader eyebrow="AUTHORITY · REALTIME" title="Live monitoring" description="Real detector output and model predictions from your connected YOLO head model." action={<span className="live-dot"><i/> Realtime subscribed</span>}/>{readings.loading || observations.loading ? <LoadingState/> : displayReadings.length ? <div className="telemetry-grid">{displayReadings.map(item => <article className="telemetry-card" key={item.id} data-testid={`authority-reading-${item.id}`}><div><Radio/><StatusBadge value={item.crowd_level}/></div><strong>{item.people_count}</strong><span>people · {item.zone}</span><small>{item.source} {item.model_version ? `· ${item.model_version}` : ""}</small><footer><span>{item.fps ? `${item.fps} FPS` : "FPS awaiting"}</span><span>{item.inference_latency_ms ? `${item.inference_latency_ms} ms` : "Latency awaiting"}</span></footer></article>)}</div> : <EmptyState icon={Cpu} title="Awaiting YOLO readings" message="No counts are simulated. Analyze a registered CCTV URL to publish real observations." testId="authority-readings-empty"/>}<section className="prediction-section"><h3>Predictions</h3>{predictions.data.length ? <div className="prediction-list">{predictions.data.map(item => <article key={item.id} data-testid={`authority-prediction-${item.id}`}><span><b>{item.zone}</b><small>{formatDateTime12(item.prediction_for)} · {item.model_version || "model pending"}</small></span><strong>{item.predicted_count}</strong><StatusBadge value={item.crowd_level}/></article>)}</div> : <EmptyState icon={Activity} title="No predictions received" message="Prediction records will appear when the model service publishes them." testId="authority-predictions-empty"/>}</section></>;
};

const Reports = ({ session }) => {
  const cameras = useWorkspaceData(() => listCameras(session.user.id), [session.user.id]); const services = useWorkspaceData(() => listTransportServices({ ownerId: session.user.id }), [session.user.id]); const readings = useWorkspaceData(() => listCrowdReadings({ ownerId: session.user.id }), [session.user.id]); const observations = useWorkspaceData(() => listCrowdObservations({ ownerId: session.user.id }).catch(() => []), [session.user.id]);
  const latestCount = readings.data.length ? readings.data.reduce((sum, item) => sum + Number(item.people_count || 0), 0) : observations.data.reduce((sum, item) => sum + Number(item.head_count || 0), 0);
  return <><SectionHeader eyebrow="AUTHORITY · REPORTS" title="Operations report" description="A live summary calculated from your registered assets and detector records."/><div className="report-grid"><article><Camera/><strong>{cameras.data.length}</strong><span>Registered cameras</span></article><article><Radio/><strong>{cameras.data.filter(item => item.status === "online").length}</strong><span>Online streams</span></article><article><BusFront/><strong>{services.data.length}</strong><span>Transport services</span></article><article><Users/><strong>{latestCount}</strong><span>Recorded people</span></article></div><section className="report-note"><Activity/><div><h3>Data integrity</h3><p>Reports only include persisted Supabase records. Camera detections will be included after the YOLO26n worker begins writing telemetry.</p></div></section></>;
};

export const AuthorityWorkspace = ({ page, session, profile, theme, setTheme, onSignOut }) => {
  if (page === "Live monitoring") return <LiveCrowd session={session}/>;
  if (page === "CCTV cameras") return <CctvManager session={session} profile={profile}/>;
  if (page === "Transport registry") return <TransportRegistry session={session} profile={profile}/>;
  if (page === "Reports") return <Reports session={session}/>;
  if (page === "Settings") return <SettingsPanel {...{ role: "authority", session, profile, theme, setTheme, onSignOut }}/>;
  return null;
};