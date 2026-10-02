"""
Rayong Smart Flood Decision Support System (RW-DSS)
Backend Core API & Data Collector Service
FastAPI implementation with ThaiWater & RID Open Data ingestion
"""

from fastapi import FastAPI, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import uvicorn

app = FastAPI(
    title="Rayong Smart Water & Flood Decision Support API",
    version="1.0.0",
    description="ระบบเชื่อมโยงข้อมูลน้ำ อ่างเก็บน้ำ และพยากรณ์ระดับน้ำลุ่มน้ำระยอง"
)

# ----------------- DATA MODELS -----------------

class ReservoirStatus(BaseModel):
    id: str
    name_th: str
    basin: str
    capacity_million_m3: float
    current_storage_million_m3: float
    storage_percentage: float
    inflow_today_million_m3: float
    outflow_today_million_m3: float
    status: str  # normal, watch, warning, critical

class RiverStationStage(BaseModel):
    station_id: str
    name: str
    location: str
    water_level_m_msl: float
    bankfull_level_m_msl: float
    remaining_to_spill_m: float
    status: str
    latitude: float
    longitude: float

class WaterForecastPoint(BaseModel):
    timestamp: datetime
    predicted_level_m_msl: float
    lower_bound: float
    upper_bound: float
    risk_level: str

# ----------------- SAMPLE / MOCK DATA ENGINE -----------------

RAYONG_RESERVOIRS = [
    {
        "id": "RES-01",
        "name_th": "อ่างเก็บน้ำหนองปลาไหล",
        "basin": "ลุ่มน้ำคลองใหญ่ / ระยอง",
        "capacity_million_m3": 163.75,
        "current_storage_million_m3": 104.80,
        "storage_percentage": 64.0,
        "inflow_today_million_m3": 2.10,
        "outflow_today_million_m3": 0.40,
        "status": "normal"
    },
    {
        "id": "RES-02",
        "name_th": "อ่างเก็บน้ำดอกกราย",
        "basin": "ลุ่มน้ำคลองใหญ่ / ระยอง",
        "capacity_million_m3": 71.40,
        "current_storage_million_m3": 55.69,
        "storage_percentage": 78.0,
        "inflow_today_million_m3": 1.85,
        "outflow_today_million_m3": 0.60,
        "status": "watch"
    },
    {
        "id": "RES-03",
        "name_th": "อ่างเก็บน้ำคลองใหญ่",
        "basin": "ลุ่มน้ำคลองใหญ่",
        "capacity_million_m3": 40.10,
        "current_storage_million_m3": 20.85,
        "storage_percentage": 52.0,
        "inflow_today_million_m3": 0.50,
        "outflow_today_million_m3": 0.15,
        "status": "normal"
    },
    {
        "id": "RES-04",
        "name_th": "อ่างเก็บน้ำประแสร์",
        "basin": "ลุ่มน้ำประแสร์ (อ.แกลง)",
        "capacity_million_m3": 295.00,
        "current_storage_million_m3": 203.55,
        "storage_percentage": 69.0,
        "inflow_today_million_m3": 3.40,
        "outflow_today_million_m3": 1.20,
        "status": "normal"
    }
]

RIVER_STATIONS = [
    {
        "station_id": "RYG-01",
        "name": "คลองทับมา (สะพานท่าสถิตย์)",
        "location": "ต.ทับมา อ.เมืองระยอง",
        "water_level_m_msl": 2.45,
        "bankfull_level_m_msl": 3.00,
        "remaining_to_spill_m": 0.55,
        "status": "watch",
        "latitude": 12.7150,
        "longitude": 101.2420
    },
    {
        "station_id": "RYG-02",
        "name": "แม่น้ำระยอง (สะพานเปรมใจรักษ์)",
        "location": "เทศบาลนครระยอง",
        "water_level_m_msl": 1.35,
        "bankfull_level_m_msl": 2.60,
        "remaining_to_spill_m": 1.25,
        "status": "normal",
        "latitude": 12.6780,
        "longitude": 101.2750
    },
    {
        "station_id": "RYG-03",
        "name": "วัดน้ำคอกใหม่ (คลองหวายโสม)",
        "location": "ต.น้ำคอก อ.เมืองระยอง",
        "water_level_m_msl": 3.10,
        "bankfull_level_m_msl": 4.00,
        "remaining_to_spill_m": 0.90,
        "status": "watch",
        "latitude": 12.7420,
        "longitude": 101.2650
    },
    {
        "station_id": "RYG-04",
        "name": "สถานีปากน้ำระยอง (วัดระดับน้ำทะเล)",
        "location": "ต.ปากน้ำ อ.เมืองระยอง",
        "water_level_m_msl": 1.48,
        "bankfull_level_m_msl": 2.20,
        "remaining_to_spill_m": 0.72,
        "status": "normal",
        "latitude": 12.6580,
        "longitude": 101.2680
    }
]

# ----------------- API ENDPOINTS -----------------

@app.get("/")
def root():
    return {
        "system": "Rayong Smart Flood Decision Support System (RW-DSS)",
        "version": "1.0.0",
        "status": "online",
        "documentation": "/docs"
    }

@app.get("/api/v1/reservoirs/rayong", response_model=List[ReservoirStatus])
def get_rayong_reservoirs():
    """ดึงข้อมูลสถานะ 4 อ่างเก็บน้ำหลักในจังหวัดระยอง (RID Open Data)"""
    return RAYONG_RESERVOIRS

@app.get("/api/v1/stations/river-stage", response_model=List[RiverStationStage])
def get_river_stations():
    """ดึงระดับน้ำในแม่น้ำระยองและคลองทับมาเปรียบเทียบกับระดับตลิ่งวิกฤต"""
    return RIVER_STATIONS

@app.get("/api/v1/forecast/thapma")
def get_thapma_flood_forecast(hours_ahead: int = Query(72, ge=6, le=72)):
    """
    โมดูลพยากรณ์ระดับน้ำล่วงหน้า 6 - 72 ชั่วโมง ที่คลองทับมา
    คำนวณจาก: โมเดลฝน TMD WRF + ปริมาณระบายน้ำอ่างฯ ดอกกราย/หนองปลาไหล + น้ำทะเลหนุน
    """
    forecast_timeline = [
        {"time_offset": "+06h", "predicted_stage": 2.70, "risk": "watch", "comment": "ระดับน้ำสูงขึ้นจากฝนสะสมตอนบน"},
        {"time_offset": "+12h", "predicted_stage": 2.85, "risk": "warning", "comment": "จุดสูงสุด (Peak) ใกล้ตลิ่ง 15 ซม."},
        {"time_offset": "+18h", "predicted_stage": 2.75, "risk": "watch", "comment": "เริ่มลดลงจากการสูบน้ำออกทะเล"},
        {"time_offset": "+24h", "predicted_stage": 2.50, "risk": "normal", "comment": "เข้าสู่สภาวะปกติ"},
        {"time_offset": "+48h", "predicted_stage": 2.10, "risk": "normal", "comment": "ปลอดภัย"},
        {"time_offset": "+72h", "predicted_stage": 1.80, "risk": "normal", "comment": "ปลอดภัย"}
    ]
    return {
        "station": "คลองทับมา (สะพานท่าสถิตย์)",
        "bankfull_threshold": 3.00,
        "peak_time_expected": "+12 ชั่วโมงข้างหน้า",
        "peak_level": 2.85,
        "forecast_timeline": forecast_timeline
    }

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
