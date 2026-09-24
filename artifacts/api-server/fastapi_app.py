"""FastAPI CCTV analysis service for MahaFlow.

Deploy this file separately from the React/Vercel frontend. It accepts a real
recorded MP4 or live CCTV URL, runs the uploaded server-side YOLO head model,
persists every measured observation to Supabase, and classifies the current
count using a fixed comparison against the previous three days.
"""

from __future__ import annotations

import os
import uuid
from dotenv import load_dotenv
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import cv2
import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from ultralytics import YOLO

load_dotenv()

ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("YOLO_MODEL_PATH", str(ROOT / "models" / "best.pt")))
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", "*").split(",") if origin.strip()]

app = FastAPI(title="MahaFlow YOLO CCTV Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOWED_ORIGINS != ["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class CctvRequest(BaseModel):
    stream_url: str = Field(min_length=8, max_length=2048)
    camera_id: str = Field(default="cctv", max_length=160)
    zone: str = Field(default="Unknown zone", max_length=160)
    max_seconds: int = Field(default=30, ge=5, le=300)
    sample_interval_seconds: float = Field(default=5.0, ge=0.5, le=15)
    confidence: float = Field(default=0.25, gt=0, lt=1)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@lru_cache(maxsize=1)
def model() -> YOLO:
    if not MODEL_PATH.exists():
        raise RuntimeError(f"YOLO model is missing at {MODEL_PATH}. Upload a .pt file and set YOLO_MODEL_PATH if needed.")
    return YOLO(str(MODEL_PATH))


def classify(current: float, historical_average: float | None) -> str:
    if historical_average is None or historical_average <= 0:
        return "Unavailable"
    ratio = current / historical_average
    if ratio < 0.8:
        return "Low"
    if ratio <= 1.2:
        return "Normal"
    return "High"


def request_headers(access_token: str | None = None) -> dict[str, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and a Supabase key are required for crowd_data persistence.")
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {access_token}" if access_token else f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


async def authenticated_user_id(access_token: str | None) -> str:
    if not access_token or not SUPABASE_ANON_KEY or not SUPABASE_URL:
        raise HTTPException(status_code=401, detail="A signed-in Supabase session is required.")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{SUPABASE_URL.rstrip('/')}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {access_token}"},
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="The Supabase session is invalid or expired.")
    user = response.json()
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="The Supabase session did not contain a user.")
    return str(user_id)


async def supabase_query(path: str, access_token: str | None, params: dict[str, str]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path}", headers=request_headers(None), params=params)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Supabase crowd_data query failed: {response.text[:300]}")
    return response.json()


async def save_observations(observations: list[dict[str, Any]], access_token: str) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/crowd_data",
            headers={**request_headers(access_token), "Prefer": "return=minimal"},
            json=observations,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Supabase crowd_data insert failed: {response.text[:300]}")


def analyze_stream(payload: CctvRequest) -> list[dict[str, Any]]:
    detector = model()
    capture = cv2.VideoCapture(payload.stream_url)
    if not capture.isOpened():
        raise HTTPException(status_code=422, detail="The CCTV URL could not be opened. Use a reachable MP4, HLS, or supported live-stream URL.")

    started = datetime.now(timezone.utc)
    measurements: list[dict[str, Any]] = []
    next_sample_at = 0.0
    frame_index = 0
    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    max_frames = int(payload.max_seconds * fps) if fps > 0 else 0
    try:
        while len(measurements) < 120:
            ok, frame = capture.read()
            if not ok:
                break
            frame_index += 1
            elapsed = frame_index / fps if fps > 0 else (datetime.now(timezone.utc) - started).total_seconds()
            if elapsed < next_sample_at:
                if max_frames and frame_index >= max_frames:
                    break
                continue
            results = detector.predict(source=frame, conf=payload.confidence, verbose=False, imgsz=416, device="cpu")
            count = 0
            for result in results:
                if result.boxes is not None:
                    count += len(result.boxes)
            measurements.append({"head_count": int(count), "captured_at": utc_now().isoformat()})
            next_sample_at += payload.sample_interval_seconds
            if elapsed >= payload.max_seconds:
                break
            if max_frames and frame_index >= max_frames:
                break
    finally:
        capture.release()
    if not measurements:
        raise HTTPException(status_code=422, detail="The CCTV stream opened but produced no readable frames.")
    return measurements


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok" if MODEL_PATH.exists() else "degraded",
        "model_configured": MODEL_PATH.exists(),
        "model_name": os.getenv("YOLO_MODEL_NAME", MODEL_PATH.stem),
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_KEY),
    }


@app.post("/cctv")
async def analyze_cctv(payload: CctvRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    access_token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    owner_user_id = await authenticated_user_id(access_token)
    measurements = analyze_stream(payload)
    current = measurements[-1]["head_count"]
    average = round(sum(item["head_count"] for item in measurements) / len(measurements), 2)
    peak = max(item["head_count"] for item in measurements)
    cutoff = (utc_now() - timedelta(days=3)).isoformat()
    historical_rows = await supabase_query(
        "crowd_data",
        access_token,
        {
            "select": "head_count",
            "camera_id": f"eq.{payload.camera_id}",
            "owner_user_id": f"eq.{owner_user_id}",
            "captured_at": f"gte.{cutoff}",
            "order": "captured_at.desc",
            "limit": "10000",
        },
    )
    historical_counts = [float(row["head_count"]) for row in historical_rows if row.get("head_count") is not None]
    historical_average = round(sum(historical_counts) / len(historical_counts), 2) if historical_counts else None
    crowd_level = classify(float(current), historical_average)
    analysis_id = str(uuid.uuid4())
    rows = [
        {
            "analysis_id": analysis_id,
            "owner_user_id": owner_user_id,
            "camera_id": payload.camera_id,
            "zone": payload.zone,
            "stream_url": payload.stream_url,
            "head_count": item["head_count"],
            "average_crowd": average,
            "peak_crowd": peak,
            "measurements": len(measurements),
            "historical_3d_average": historical_average,
            "crowd_level": crowd_level,
            "captured_at": item["captured_at"],
            "source": "yolo",
            "model_name": os.getenv("YOLO_MODEL_NAME", MODEL_PATH.stem),
        }
        for item in measurements
    ]
    await save_observations(rows, access_token)
    return {
        "analysis_id": analysis_id,
        "camera_id": payload.camera_id,
        "zone": payload.zone,
        "current_head_count": current,
        "average_crowd": average,
        "peak_crowd": peak,
        "measurements": len(measurements),
        "three_day_average": historical_average,
        "crowd_level": crowd_level,
        "thresholds": {"low": "below 80% of 3-day average", "normal": "80%–120% of 3-day average", "high": "above 120% of 3-day average"},
        "model_name": os.getenv("YOLO_MODEL_NAME", MODEL_PATH.stem),
    }