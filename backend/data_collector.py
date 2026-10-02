"""
ตัวอย่างสคริปต์ดึงข้อมูลน้ำจริงจาก Open Data API ในประเทศไทย
- ดึงข้อมูลอ่างเก็บน้ำ 461 แห่งทั่วประเทศจากกรมชลประทาน (RID API)
- คัดกรองอ่างเก็บน้ำในจังหวัดระยองและพื้นที่เชื่อมโยง (ดอกกราย, คลองใหญ่, คลองระโอก ฯลฯ)
- ดึงข้อมูลพยากรณ์อัตราการไหลของแม่น้ำระยองล่วงหน้า 7 วัน (Open-Meteo Flood API)
"""

import json
import urllib.request
import ssl

def fetch_rid_reservoirs():
    """ดึงข้อมูลสถานะอ่างเก็บน้ำทั่วประเทศจาก API กรมชลประทาน (Direct Public API)"""
    url = "https://app.rid.go.th/reservoir/api/reservoir/public"
    print(f"กำลังเชื่อมต่อ API กรมชลประทาน: {url} ...")
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    )
    
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            all_reservoirs = []
            
            for group in data.get("data", []):
                region = group.get("region")
                for r in group.get("reservoir", []):
                    r["region"] = region
                    all_reservoirs.append(r)
            
            print(f"✓ ดึงข้อมูลสำเร็จ: พบอ่างเก็บน้ำทั้งหมด {len(all_reservoirs)} แห่งทั่วประเทศ")
            
            # กรองเฉพาะภาคตะวันออก และอ่างฯ สำคัญรอบระยอง
            rayong_related = [
                r for r in all_reservoirs 
                if any(k in r.get("name", "") for k in ["ดอกกราย", "คลองใหญ่", "คลองระโอก", "หนองปลาไหล", "ประแสร์", "คลองหลวง", "บางพระ"])
            ]
            return {
                "date": data.get("date"),
                "total_country_count": len(all_reservoirs),
                "rayong_and_nearby": rayong_related
            }
    except Exception as e:
        print(f"✗ เกิดข้อผิดพลาดในการดึงข้อมูล RID: {e}")
        return None

def fetch_rayong_flood_forecast():
    """ดึงข้อมูลพยากรณ์อัตราการไหลของแม่น้ำระยอง (River Discharge m³/s) ล่วงหน้า 7 วัน"""
    # พิกัดลุ่มน้ำระยอง: Lat 12.68, Long 101.28
    url = "https://flood-api.open-meteo.com/v1/flood?latitude=12.68&longitude=101.28&daily=river_discharge&forecast_days=7"
    print(f"กำลังเชื่อมต่อ API พยากรณ์น้ำหลากลุ่มน้ำระยอง: {url} ...")
    
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            daily = data.get("daily", {})
            print(f"✓ ดึงข้อมูลพยากรณ์น้ำหลากสำเร็จ: พยากรณ์ได้ {len(daily.get('time', []))} วันข้างหน้า")
            return daily
    except Exception as e:
        print(f"✗ เกิดข้อผิดพลาดในการดึงข้อมูล Flood Forecast: {e}")
        return None

if __name__ == "__main__":
    print("=" * 60)
    print("ระบบทดสอบดึงข้อมูลน้ำจริง (Live Water Data Ingestion Test)")
    print("=" * 60)
    
    # 1. ข้อมูลอ่างเก็บน้ำ
    rid_result = fetch_rid_reservoirs()
    if rid_result:
        print(f"\n[ วันที่รายงาน: {rid_result['date']} ]")
        print("ตัวอย่างสถานะอ่างเก็บน้ำในระยองและพื้นที่เชื่อมโยง:")
        for r in rid_result["rayong_and_nearby"]:
            print(f" - {r.get('name')}: ความจุ {r.get('storage')} ล้าน ลบ.ม. | ปริมาณปัจจุบัน {r.get('volume')} ล้าน ลบ.ม. ({r.get('percent_storage')}%) | ไหลเข้า {r.get('inflow')} | ระบายออก {r.get('outflow')}")

    # 2. ข้อมูลพยากรณ์น้ำหลากลุ่มน้ำระยอง
    print("\n" + "-" * 60)
    forecast_result = fetch_rayong_flood_forecast()
    if forecast_result:
        print("แนวโน้มอัตราการไหลของแม่น้ำระยอง (River Discharge m³/s):")
        times = forecast_result.get("time", [])
        discharges = forecast_result.get("river_discharge", [])
        for t, q in zip(times, discharges):
            status = "ปกติ" if q < 150 else ("เฝ้าระวัง" if q < 220 else "เตือนภัยน้ำหลาก")
            print(f" - วันที่ {t}: อัตราการไหล {q:.2f} ลบ.ม./วินาที ({status})")
    
    print("=" * 60)
