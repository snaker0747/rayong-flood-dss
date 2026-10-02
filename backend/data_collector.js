/**
 * Rayong Water Live Data Collector (Node.js)
 * ดึงข้อมูลสดจาก API น้ำของไทยและสากล:
 * 1. กรมชลประทาน (RID API): ข้อมูลอ่างเก็บน้ำ 461 แห่งทั่วประเทศ
 * 2. Open-Meteo Flood API (Copernicus/GloFAS): พยากรณ์อัตราการไหลของแม่น้ำระยอง 7 วัน
 * 3. กรมทรัพยากรน้ำ (DWR Thaiwater Standard): ข้อมูลแหล่งน้ำ
 */

const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log("=".repeat(65));
  console.log("🌊 ระบบทดสอบดึงข้อมูลน้ำ Real-Time (Live Water Data Ingestion)");
  console.log("=".repeat(65));

  // 1. ดึงข้อมูลอ่างเก็บน้ำจากกรมชลประทาน (RID)
  try {
    console.log("1. กำลังดึงข้อมูลจาก API กรมชลประทาน (app.rid.go.th)...");
    const ridData = await fetchJSON('https://app.rid.go.th/reservoir/api/reservoir/public');
    
    let allDams = [];
    (ridData.data || []).forEach(group => {
      (group.reservoir || []).forEach(r => {
        allDams.push({ ...r, region: group.region });
      });
    });

    console.log(`   ✓ สำเร็จ: พบอ่างเก็บน้ำทั้งหมด ${allDams.length} แห่งทั่วประเทศ (วันที่: ${ridData.date})`);
    
    // คัดกรองอ่างเก็บน้ำในระยองและพื้นที่เชื่อมโยง
    const targetKeywords = ['ดอกกราย', 'คลองใหญ่', 'คลองระโอก', 'คลองหลวง', 'บางพระ', 'ขุนด่าน'];
    const filteredDams = allDams.filter(d => targetKeywords.some(k => d.name.includes(k)));

    console.log("\n   📊 ตัวอย่างสถานะอ่างเก็บน้ำในระยองและพื้นที่เชื่อมโยง:");
    filteredDams.forEach(d => {
      console.log(`      • [${d.region}] ${d.name}`);
      console.log(`        - ความจุกักเก็บ: ${d.storage} ล้าน ลบ.ม. | ปริมาณปัจจุบัน: ${d.volume} ล้าน ลบ.ม. (${d.percent_storage}%)`);
      console.log(`        - น้ำไหลเข้า: ${d.inflow ?? 0} ล้าน ลบ.ม./วัน | ระบายออก: ${d.outflow ?? 0} ล้าน ลบ.ม./วัน`);
    });
  } catch (err) {
    console.error("   ✗ เกิดข้อผิดพลาด RID:", err.message);
  }

  // 2. ดึงข้อมูลพยากรณ์น้ำหลากลุ่มน้ำระยอง (Open-Meteo Flood API)
  try {
    console.log("\n2. กำลังดึงข้อมูลพยากรณ์น้ำหลากลุ่มน้ำระยอง (Lat 12.68, Lng 101.28)...");
    const floodUrl = 'https://flood-api.open-meteo.com/v1/flood?latitude=12.68&longitude=101.28&daily=river_discharge&forecast_days=7';
    const floodData = await fetchJSON(floodUrl);
    
    const times = floodData.daily?.time || [];
    const discharges = floodData.daily?.river_discharge || [];

    console.log(`   ✓ สำเร็จ: ได้รับข้อมูลพยากรณ์อัตราการไหลของน้ำ ${times.length} วันล่วงหน้า`);
    console.log("\n   📈 แนวโน้มอัตราการไหลของแม่น้ำระยอง (River Discharge m³/s):");
    times.forEach((date, i) => {
      const q = discharges[i];
      let alert = "ปกติ 🟢";
      if (q > 200) alert = "เฝ้าระวังน้ำล้นตลิ่ง 🟡";
      if (q > 250) alert = "เตือนภัยน้ำท่วม 🔴";
      console.log(`      • วันที่ ${date}: ${q.toFixed(2)} ลบ.ม./วินาที -> สถานะ: ${alert}`);
    });
  } catch (err) {
    console.error("   ✗ เกิดข้อผิดพลาด Flood API:", err.message);
  }

  console.log("\n" + "=".repeat(65));
}

main();
