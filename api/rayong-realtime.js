// Vercel Serverless Function: Aggregated Real-Time Rayong Water & Telemetry API
// Sources: 
// 1. DWR Telemetry (กรมทรัพยากรน้ำ) - Real-time stations (minute-by-minute)
// 2. ThaiWater 3.0 / ONWR (สทนช. / สสน. / กรมชลประทาน) - 5 Reservoirs, 34 Rain stations, River levels

const https = require('https');

// Cache in-memory for 60 seconds to prevent rate-limiting upstream
let cache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL_MS = 60 * 1000;

function fetchPostJson(url, postData, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const dataStr = JSON.stringify(postData);
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Content-Length': Buffer.byteLength(dataStr)
        },
        timeout: timeoutMs,
        rejectUnauthorized: false
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(dataStr);
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

function fetchGetJson(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://nationalthaiwater.onwr.go.th/',
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: timeoutMs,
        rejectUnauthorized: false
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch (e) {
      resolve(null);
    }
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();
  if (cache.data && (now - cache.timestamp < CACHE_TTL_MS)) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cache.data);
  }

  try {
    // 1. Fetch DWR Telemetry stations
    const dwrPromise = fetchPostJson('https://telemetry.dwr.go.th/api/public/reportCurrentStatus/getCurrentStatus', {});
    
    // 2. Fetch ThaiWater Dams for Rayong (province 21)
    const damPromise = fetchGetJson('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_id=21');

    // 3. Fetch RID Public Reservoir API directly (Daily 06:00 batch)
    const ridPromise = fetchGetJson('https://app.rid.go.th/reservoir/api/reservoir/public');

    // 4. Fetch ThaiWater Rain stations for Rayong (province 21)
    const rainPromise = fetchGetJson('https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thailand_main_rain?province_code=21');

    // 5. Fetch ThaiWater Waterlevel Stations
    const wlPromise = fetchGetJson('https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load');

    const [dwrRaw, damRaw, ridRaw, rainRaw, wlRaw] = await Promise.all([
      dwrPromise,
      damPromise,
      ridPromise,
      rainPromise,
      wlPromise
    ]);

    // Process DWR Stations (Filter for Rayong)
    const allDwr = dwrRaw?.value || [];
    const dwrRayong = allDwr.filter(s => {
      const code = s.code || '';
      const prov = s.addressInfo?.provinceInfo?.nameTh || '';
      const provCode = s.addressInfo?.provinceInfo?.code || '';
      return prov === 'ระยอง' || provCode === '21' || code.startsWith('TA17');
    }).map(s => ({
      code: s.code,
      nameTh: s.nameTh,
      nameEn: s.nameEn,
      waterLevel: s.currWaterLevelValue,
      flowRate: s.currFlowRateValue,
      rainfall: s.currRainfallValue,
      basinCapPercent: s.currRiverBasinCapValue,
      timestamp: s.currTimestamp,
      wlTimestamp: s.currWlTimestamp,
      cctvEnabled: s.cctvEnabled,
      district: s.addressInfo?.districtInfo?.nameTh || '',
      subDistrict: s.addressInfo?.subDistrictInfo?.nameTh || ''
    }));

    // Process Dams (5 Reservoirs in Rayong - Dual Sync: ThaiWater + RID Public API)
    const dailyDams = damRaw?.data?.dam_daily || [];
    const mediumDams = damRaw?.data?.dam_medium || [];
    const ridDate = ridRaw?.date || new Date().toISOString().split('T')[0];
    const ridDams = {};
    (ridRaw?.data || []).forEach(group => {
      (group.reservoir || []).forEach(r => {
        if (r.name.includes('ดอกกราย')) ridDams.dokkrai = r;
        if (r.name.includes('คลองใหญ่') && !r.name.includes('ตะคลอง')) ridDams.khlongyai = r;
        if (r.name.includes('คลองระโอก')) ridDams.khlongraok = r;
        if (r.name.includes('ประแสร์')) ridDams.prasae = r;
        if (r.name.includes('หนองปลาไหล')) ridDams.nongplalai = r;
      });
    });
    
    // Map official dams
    const reservoirs = {
      prasae: null,
      nongplalai: null,
      dokkrai: null,
      khlongyai: null,
      khlongraok: null
    };

    // 1. Prasae (ประแสร์)
    const prasaeObj = dailyDams.find(d => d.dam?.dam_name?.th?.includes('ประแสร์'));
    if (prasaeObj && prasaeObj.dam_storage !== null && prasaeObj.dam_storage !== undefined) {
      reservoirs.prasae = {
        name: 'อ่างเก็บน้ำประแสร์',
        storage: Number(prasaeObj.dam_storage),
        percent: Number(prasaeObj.dam_storage_percent),
        inflow: prasaeObj.dam_inflow != null ? Number(prasaeObj.dam_inflow) : null,
        released: prasaeObj.dam_released != null ? Number(prasaeObj.dam_released) : null,
        waterLevel: prasaeObj.dam_level || 0,
        date: prasaeObj.dam_date,
        capacityMax: 295.0,
        status: prasaeObj.dam_storage_percent >= 100 ? 'overflow' : (prasaeObj.dam_storage_percent >= 90 ? 'warning' : 'normal')
      };
    } else if (ridDams.prasae) {
      const r = ridDams.prasae;
      const pct = Number(r.percent_storage || r.percent_volume || 0);
      reservoirs.prasae = {
        name: 'อ่างเก็บน้ำประแสร์',
        storage: Number(r.volume),
        percent: pct,
        inflow: r.inflow != null ? Number(r.inflow) : null,
        released: r.outflow != null ? Number(r.outflow) : null,
        date: ridDate,
        capacityMax: 295.0,
        status: pct >= 100 ? 'overflow' : (pct >= 90 ? 'warning' : 'normal')
      };
    }

    // 2. Nong Pla Lai (หนองปลาไหล)
    const nongplalaiObj = dailyDams.find(d => d.dam?.dam_name?.th?.includes('หนองปลาไหล'));
    if (nongplalaiObj && nongplalaiObj.dam_storage !== null && nongplalaiObj.dam_storage !== undefined) {
      reservoirs.nongplalai = {
        name: 'อ่างเก็บน้ำหนองปลาไหล',
        storage: Number(nongplalaiObj.dam_storage),
        percent: Number(nongplalaiObj.dam_storage_percent),
        inflow: nongplalaiObj.dam_inflow != null ? Number(nongplalaiObj.dam_inflow) : null,
        released: nongplalaiObj.dam_released != null ? Number(nongplalaiObj.dam_released) : null,
        waterLevel: nongplalaiObj.dam_level || 0,
        date: nongplalaiObj.dam_date,
        capacityMax: 163.75,
        status: nongplalaiObj.dam_storage_percent >= 100 ? 'overflow' : (nongplalaiObj.dam_storage_percent >= 90 ? 'warning' : 'normal')
      };
    } else if (ridDams.nongplalai) {
      const r = ridDams.nongplalai;
      const pct = Number(r.percent_storage || r.percent_volume || 0);
      reservoirs.nongplalai = {
        name: 'อ่างเก็บน้ำหนองปลาไหล',
        storage: Number(r.volume),
        percent: pct,
        inflow: r.inflow != null ? Number(r.inflow) : null,
        released: r.outflow != null ? Number(r.outflow) : null,
        date: ridDate,
        capacityMax: 163.75,
        status: pct >= 100 ? 'overflow' : (pct >= 90 ? 'warning' : 'normal')
      };
    }

    // 3. Dok Krai (ดอกกราย)
    const dokkraiObj = mediumDams.find(d => d.dam?.dam_name?.th?.includes('ดอกกราย'));
    if (dokkraiObj && dokkraiObj.dam_storage !== null && dokkraiObj.dam_storage !== undefined) {
      reservoirs.dokkrai = {
        name: 'อ่างเก็บน้ำดอกกราย',
        storage: Number(dokkraiObj.dam_storage),
        percent: Number(dokkraiObj.dam_storage_percent),
        inflow: dokkraiObj.dam_inflow != null ? Number(dokkraiObj.dam_inflow) : null,
        released: dokkraiObj.dam_released != null ? Number(dokkraiObj.dam_released) : null,
        date: dokkraiObj.dam_date,
        capacityMax: 71.4,
        status: dokkraiObj.dam_storage_percent >= 100 ? 'overflow' : (dokkraiObj.dam_storage_percent >= 90 ? 'warning' : 'normal')
      };
    } else if (ridDams.dokkrai) {
      const r = ridDams.dokkrai;
      const pct = Number(r.percent_storage || r.percent_volume || 0);
      reservoirs.dokkrai = {
        name: 'อ่างเก็บน้ำดอกกราย',
        storage: Number(r.volume),
        percent: pct,
        inflow: r.inflow != null ? Number(r.inflow) : null,
        released: r.outflow != null ? Number(r.outflow) : null,
        date: ridDate,
        capacityMax: 71.4,
        status: pct >= 100 ? 'overflow' : (pct >= 90 ? 'warning' : 'normal')
      };
    }

    // 4. Khlong Yai (คลองใหญ่)
    const khlongyaiObj = mediumDams.find(d => d.dam?.dam_name?.th?.includes('คลองใหญ่'));
    if (khlongyaiObj && khlongyaiObj.dam_storage !== null && khlongyaiObj.dam_storage !== undefined) {
      reservoirs.khlongyai = {
        name: 'อ่างเก็บน้ำคลองใหญ่',
        storage: Number(khlongyaiObj.dam_storage),
        percent: Number(khlongyaiObj.dam_storage_percent),
        inflow: khlongyaiObj.dam_inflow != null ? Number(khlongyaiObj.dam_inflow) : null,
        released: khlongyaiObj.dam_released != null ? Number(khlongyaiObj.dam_released) : null,
        date: khlongyaiObj.dam_date,
        capacityMax: 50.8,
        status: khlongyaiObj.dam_storage_percent >= 100 ? 'overflow' : (khlongyaiObj.dam_storage_percent >= 90 ? 'warning' : 'normal')
      };
    } else if (ridDams.khlongyai) {
      const r = ridDams.khlongyai;
      const pct = Number(r.percent_storage || r.percent_volume || 0);
      reservoirs.khlongyai = {
        name: 'อ่างเก็บน้ำคลองใหญ่',
        storage: Number(r.volume),
        percent: pct,
        inflow: r.inflow != null ? Number(r.inflow) : null,
        released: r.outflow != null ? Number(r.outflow) : null,
        date: ridDate,
        capacityMax: 50.8,
        status: pct >= 100 ? 'overflow' : (pct >= 90 ? 'warning' : 'normal')
      };
    }

    // 5. Khlong Ra-ok (คลองระโอก)
    const khlongraokObj = mediumDams.find(d => d.dam?.dam_name?.th?.includes('คลองระโอก'));
    if (khlongraokObj && khlongraokObj.dam_storage !== null && khlongraokObj.dam_storage !== undefined) {
      reservoirs.khlongraok = {
        name: 'อ่างเก็บน้ำคลองระโอก',
        storage: Number(khlongraokObj.dam_storage),
        percent: Number(khlongraokObj.dam_storage_percent),
        inflow: khlongraokObj.dam_inflow != null ? Number(khlongraokObj.dam_inflow) : null,
        released: khlongraokObj.dam_released != null ? Number(khlongraokObj.dam_released) : null,
        date: khlongraokObj.dam_date,
        capacityMax: 19.65,
        status: khlongraokObj.dam_storage_percent >= 100 ? 'overflow' : (khlongraokObj.dam_storage_percent >= 90 ? 'warning' : 'normal')
      };
    } else if (ridDams.khlongraok) {
      const r = ridDams.khlongraok;
      const pct = Number(r.percent_storage || r.percent_volume || 0);
      reservoirs.khlongraok = {
        name: 'อ่างเก็บน้ำคลองระโอก',
        storage: Number(r.volume),
        percent: pct,
        inflow: r.inflow != null ? Number(r.inflow) : null,
        released: r.outflow != null ? Number(r.outflow) : null,
        date: ridDate,
        capacityMax: 19.65,
        status: pct >= 100 ? 'overflow' : (pct >= 90 ? 'warning' : 'normal')
      };
    }

    // Process Rainfall (34 stations in Rayong)
    const rainData = rainRaw?.data || [];
    const rainfallStations = rainData.map(r => ({
      stationId: r.station?.id,
      code: r.station?.tele_station_oldcode,
      name: r.station?.tele_station_name?.th || r.station?.tele_station_name?.en || 'สถานีวัดน้ำฝน',
      lat: r.station?.tele_station_lat,
      lng: r.station?.tele_station_long,
      rain24h: r.rain_24h,
      rain1h: r.rain_1h,
      datetime: r.rainfall_datetime,
      district: r.geocode?.amphoe_name?.th || '',
      subDistrict: r.geocode?.tumbon_name?.th || '',
      agency: r.agency?.agency_shortname?.th || r.agency?.agency_name?.th || ''
    }));

    // Process River Waterlevel Stations (ThaiWater)
    const allWl = wlRaw?.waterlevel_data?.data || [];
    const riverStations = allWl.filter(s => {
      const str = JSON.stringify(s);
      return str.includes('"province_code":"21"') || str.includes('ระยอง');
    }).map(s => ({
      code: s.station?.tele_station_oldcode,
      name: s.station?.tele_station_name?.th,
      river: s.river_name,
      lat: s.station?.tele_station_lat,
      lng: s.station?.tele_station_long,
      waterLevelMsl: s.waterlevel_msl ? parseFloat(s.waterlevel_msl) : null,
      diffBankText: s.diff_wl_bank_text,
      diffBank: s.diff_wl_bank ? parseFloat(s.diff_wl_bank) : null,
      situationLevel: s.situation_level,
      datetime: s.waterlevel_datetime,
      minBank: s.station?.min_bank
    }));

    const responsePayload = {
      status: 'success',
      source: 'DWR Telemetry & ThaiWater 3.0 (HII / ONWR / RID)',
      timestamp: new Date().toISOString(),
      updatedText: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' น.',
      reservoirs,
      dwrStations: dwrRayong,
      riverStations,
      rainfallStations,
      summary: {
        totalReservoirs: Object.keys(reservoirs).filter(k => reservoirs[k] !== null).length,
        totalDwrStations: dwrRayong.length,
        totalRiverStations: riverStations.length,
        totalRainStations: rainfallStations.length,
        criticalReservoirs: Object.keys(reservoirs).filter(k => reservoirs[k] && reservoirs[k].percent >= 100).length
      }
    };

    cache.data = responsePayload;
    cache.timestamp = now;

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);

  } catch (err) {
    console.error('Error fetching government data:', err);
    if (cache.data) {
      return res.status(200).json({ ...cache.data, cacheNotice: 'Stale cache served due to upstream error' });
    }
    return res.status(500).json({ status: 'error', message: err.message });
  }
};
