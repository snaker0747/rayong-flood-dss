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

// Global in-memory cache
const frameCache = {
  TA170203: { buffer: null, source: null, time: 0 },
  TA170406: { buffer: null, source: null, time: 0 }
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

function fetchDirectCameraImage(cam, maxTimeoutMs = 6800) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let activeReq1 = null;
    let activeReq2 = null;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        if (activeReq1) { try { activeReq1.destroy(); } catch (e) {} }
        if (activeReq2) { try { activeReq2.destroy(); } catch (e) {} }
        reject(new Error(`Direct camera timeout after ${maxTimeoutMs}ms`));
      }
    }, maxTimeoutMs);

    function cleanupAndResolve(val) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(val);
      }
    }

    function cleanupAndReject(err) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (activeReq1) { try { activeReq1.destroy(); } catch (e) {} }
        if (activeReq2) { try { activeReq2.destroy(); } catch (e) {} }
        reject(err);
      }
    }

    try {
      activeReq1 = http.get({
        hostname: cam.host,
        port: cam.port,
        path: '/snap.jpg',
        timeout: 4500
      }, (res1) => {
        if (res1.statusCode !== 401 || !res1.headers['www-authenticate']) {
          return cleanupAndReject(new Error('Expected 401 Digest Auth, got ' + res1.statusCode));
        }

        const p = parseDigestHeader(res1.headers['www-authenticate']);
        const cnonce = crypto.randomBytes(8).toString('hex');
        const nc = '00000001';
        const ha1 = md5(`${cam.user}:${p.realm}:${cam.pass}`);
        const ha2 = md5('GET:/snap.jpg');
        const qop = p.qop || 'auth';
        const response = md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
        const auth = `Digest username="${cam.user}", realm="${p.realm}", nonce="${p.nonce}", uri="/snap.jpg", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;

        try {
          activeReq2 = http.get({
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
              return cleanupAndReject(new Error('Camera responded with ' + res2.statusCode));
            }
            const chunks = [];
            res2.on('data', c => chunks.push(c));
            res2.on('end', () => {
              cleanupAndResolve({ buffer: Buffer.concat(chunks), source: 'direct-camera' });
            });
            res2.on('error', cleanupAndReject);
          });

          activeReq2.on('error', cleanupAndReject);
          activeReq2.on('timeout', () => cleanupAndReject(new Error('req2 socket timeout')));
        } catch (e2) {
          cleanupAndReject(e2);
        }
      });

      activeReq1.on('error', cleanupAndReject);
      activeReq1.on('timeout', () => cleanupAndReject(new Error('req1 socket timeout')));
    } catch (e1) {
      cleanupAndReject(e1);
    }
  });
}

// Fallback to DWR Central API repository
async function fetchDwrApiFallback(cam, maxTimeoutMs = 2500) {
  let snapPath = '';
  try {
    const snapData = await new Promise((resolve, reject) => {
      const req = https.get(`https://telemetry.dwr.go.th/api/public/reportCctv/snapshot/${cam.dwrId}`, { timeout: maxTimeoutMs }, (res) => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => {
          try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('DWR snapshot API timeout')); });
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
      timeout: maxTimeoutMs
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
    req.on('timeout', () => { req.destroy(); reject(new Error('DWR image API timeout')); });
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

  const { station = 'TA170203', mode = 'image', force = '0' } = req.query;
  const cam = CAMERAS[station];

  if (!cam) {
    return res.status(404).json({ error: 'Station not found', validStations: Object.keys(CAMERAS) });
  }

  // 1. Check in-memory cache (fresh within 4 seconds)
  const cached = frameCache[station];
  const now = Date.now();
  if (force !== '1' && cached && cached.buffer && (now - cached.time < 4000)) {
    if (mode === 'json') {
      return res.status(200).json({
        station: cam.code,
        name: cam.name,
        source: cached.source + ' (cached)',
        bytes: cached.buffer.length,
        timestamp: new Date(cached.time).toISOString()
      });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-CCTV-Source', cached.source + '-cached');
    res.setHeader('Cache-Control', 'public, max-age=3');
    return res.status(200).send(cached.buffer);
  }

  try {
    let result = null;
    let directError = null;
    
    // Attempt Direct Camera (fast budget 2500ms) and DWR Official API in sequence / fallback
    try {
      result = await fetchDirectCameraImage(cam, 2500);
    } catch (err) {
      directError = err.message;
    }

    if (!result || !result.buffer) {
      try {
        result = await fetchDwrApiFallback(cam, 5500);
      } catch (err2) {
        console.warn('DWR fallback error:', err2.message);
      }
    }

    if (!result || !result.buffer) {
      if (cached && cached.buffer) {
        result = cached;
      } else {
        return res.status(502).json({ error: 'Failed to retrieve camera frame', directError });
      }
    } else {
      // Update cache
      frameCache[station] = {
        buffer: result.buffer,
        source: result.source,
        time: now
      };
    }

    if (mode === 'json') {
      return res.status(200).json({
        station: cam.code,
        name: cam.name,
        source: result.source,
        bytes: result.buffer.length,
        timestamp: new Date().toISOString(),
        directError
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
