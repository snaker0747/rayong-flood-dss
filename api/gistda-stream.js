// Vercel Serverless Function: GISTDA Coastal Radar HLS Stream Proxy
const https = require('https');

const STATIONS = {
  S031: {
    hash: '100352499133831682028641249087836640405',
    code: 'S031',
    name: 'Ban Phe Pier'
  },
  GISTDA_S031: {
    hash: '100352499133831682028641249087836640405',
    code: 'S031',
    name: 'Ban Phe Pier'
  },
  S042: {
    hash: '106503982638575697228475930513862621829',
    code: 'S042',
    name: 'Phayun Beach'
  },
  GISTDA_S042: {
    hash: '106503982638575697228475930513862621829',
    code: 'S042',
    name: 'Phayun Beach'
  },
  S046: {
    hash: '116185462407234580845451996571834281111',
    code: 'S046',
    name: 'Laem Mae Phim Beach'
  },
  GISTDA_S046: {
    hash: '116185462407234580845451996571834281111',
    code: 'S046',
    name: 'Laem Mae Phim Beach'
  }
};

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { station = 'S031', type = 'm3u8', file } = req.query;
  const config = STATIONS[station];

  if (!config) {
    return res.status(404).json({ error: 'Station not found', validStations: Object.keys(STATIONS) });
  }

  if (type === 'status') {
    const targetUrl = `https://coastalradar.gistda.or.th/cctvlive/${config.hash}/hls/${config.code}/playlist.m3u8`;
    return new Promise((resolve) => {
      const request = https.get(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        rejectUnauthorized: false,
        timeout: 4000
      }, (upstream) => {
        let body = '';
        upstream.on('data', c => body += c);
        upstream.on('end', () => {
          if (upstream.statusCode === 200) {
            const seqMatch = body.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
            const segMatches = body.match(/segment_\d+\.ts/g) || [];
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json({
              station: config.code,
              online: true,
              sequence: seqMatch ? parseInt(seqMatch[1], 10) : null,
              segments: segMatches,
              timestamp: new Date().toISOString()
            });
          } else {
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json({
              station: config.code,
              online: false,
              statusCode: upstream.statusCode,
              timestamp: new Date().toISOString()
            });
          }
          resolve();
        });
      });
      request.on('error', (err) => {
        res.status(502).json({ station: config.code, online: false, error: err.message });
        resolve();
      });
      request.on('timeout', () => {
        request.destroy();
        res.status(504).json({ station: config.code, online: false, error: 'Upstream timeout' });
        resolve();
      });
    });
  }

  if (type === 'm3u8') {
    // Bandwidth Saver: Redirect directly to official GISTDA stream without proxying video through Vercel
    const targetUrl = `https://coastalradar.gistda.or.th/cctvlive/${config.hash}/hls/${config.code}/playlist.m3u8`;
    res.setHeader('Location', targetUrl);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(302).end();
  }

  if (type === 'ts') {
    if (!file || !/^segment_\d+\.ts$/.test(file)) {
      return res.status(400).json({ error: 'Invalid segment filename format' });
    }
    // Bandwidth Saver: Redirect directly to official GISTDA segment without piping video through Vercel
    const targetUrl = `https://coastalradar.gistda.or.th/cctvlive/${config.hash}/hls/${config.code}/${file}`;
    res.setHeader('Location', targetUrl);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(302).end();
  }

  return res.status(400).json({ error: 'Invalid type requested' });
};
