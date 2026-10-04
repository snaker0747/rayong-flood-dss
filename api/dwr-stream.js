// Vercel Serverless Function: DWR Real-Time Camera Direct Snapshot Engine
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const CAMERAS = {
  TA170203: {
    code: 'TA170203',
    host: 'ta170203.dyndns.info',
    port: 5001,
    user: 'live',
    pass: 'Live2025!',
    dwrId: 'ec06a49c-a335-4e8d-a6cf-39a8aa0d1687',
    name: 'คลองใหญ่'
  },
  TA170406: {
    code: 'TA170406',
    host: 'ta170406.dyndns.info',
    port: 5001,
    user: 'live',
    pass: 'Live2025!',
    dwrId: '82406bf4-b432-4db5-8423-4bbb40360fd5',
    name: 'คลองสะพานดำ'
  }
};

function parseDigestHeader(header) {
  const params = {};
  const regex = /(\w+)="?([^",]+)"?/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2];
  }
  return params;
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function fetchDirectCameraImage(cam) {
  return new Promise((resolve, reject) => {
    const req1 = http.get({
      hostname: cam.host,
      port: cam.port,
      path: '/snap.jpg',
      timeout: 5000
    }, (res1) => {
      if (res1.statusCode !== 401 || !res1.headers['www-authenticate']) {
        return reject(new Error('Expected 401 Digest Auth, got ' + res1.statusCode));
      }

      const p = parseDigestHeader(res1.headers['www-authenticate']);
      const cnonce = crypto.randomBytes(8).toString('hex');
      const nc = '00000001';
      const ha1 = md5(`${cam.user}:${p.realm}:${cam.pass}`);
      const ha2 = md5('GET:/snap.jpg');
      const qop = p.qop || 'auth';
      const response = md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
      const auth = `Digest username="${cam.user}", realm="${p.realm}", nonce="${p.nonce}", uri="/snap.jpg", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;

      const req2 = http.get({
        hostname: cam.host,
        port: cam.port,
        path: '/snap.jpg',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Authorization': auth
        },
        timeout: 6000
      }, (res2) => {
        if (res2.statusCode !== 200) {
          return reject(new Error('Camera responded with ' + res2.statusCode));
        }
        const chunks = [];
        res2.on('data', c => chunks.push(c));
        res2.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ buffer, source: 'direct-camera' });
        });
      });
      req2.on('error', reject);
      req2.on('timeout', () => { req2.destroy(); reject(new Error('Camera timeout on image transfer')); });
    });
    req1.on('error', reject);
    req1.on('timeout', () => { req1.destroy(); reject(new Error('Camera timeout on initial connect')); });
  });
}

// Fallback to DWR Central API repository
async function fetchDwrApiFallback(cam) {
  let snapPath = '';
  try {
    const snapData = await new Promise((resolve, reject) => {
      https.get(`https://telemetry.dwr.go.th/api/public/reportCctv/snapshot/${cam.dwrId}`, { timeout: 4000 }, (res) => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => {
          try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    if (snapData && snapData.value) snapPath = snapData.value;
  } catch (e) {
    console.warn('DWR Snapshot lookup failed:', e.message);
  }

  if (!snapPath) {
    throw new Error('No snapshot path available from DWR');
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ path: snapPath });
    const req = https.request({
      hostname: 'telemetry.dwr.go.th',
      port: 443,
      path: '/api/file/image/cctv',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 5000
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error('DWR file image returned ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({ buffer: Buffer.concat(chunks), source: 'dwr-api-fallback' });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DWR API timeout')); });
    req.write(postData);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { station = 'TA170203', mode = 'image' } = req.query;
  const cam = CAMERAS[station];

  if (!cam) {
    return res.status(404).json({ error: 'Station not found', validStations: Object.keys(CAMERAS) });
  }

  try {
    let result = null;
    try {
      // 1. Try real-time direct camera fetch
      result = await fetchDirectCameraImage(cam);
    } catch (directErr) {
      console.warn(`Direct cam fetch failed for ${station} (${directErr.message}), falling back to DWR API...`);
      // 2. Try DWR Central API fallback
      result = await fetchDwrApiFallback(cam);
    }

    if (!result || !result.buffer) {
      return res.status(502).json({ error: 'Failed to retrieve camera frame from both direct and central sources' });
    }

    if (mode === 'json') {
      return res.status(200).json({
        station: cam.code,
        name: cam.name,
        source: result.source,
        bytes: result.buffer.length,
        timestamp: new Date().toISOString()
      });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-CCTV-Source', result.source);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    return res.status(200).send(result.buffer);

  } catch (err) {
    return res.status(500).json({ error: 'Internal camera proxy error', details: err.message });
  }
};
