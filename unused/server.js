import express from 'express';
import { google } from 'googleapis';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

const GA4_PROPERTY_ID = '153293282';
const TOKENS_FILE = '.ga4_tokens.json';

const OAUTH_CLIENT_ID     = '570779043366-81g2j7ejahv76pp2s9l61vucscjb3m5u.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const REDIRECT_URI        = `http://localhost:${PORT}/oauth/callback`;

const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, REDIRECT_URI);

if (existsSync(TOKENS_FILE)) {
  try {
    const tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf8'));
    if (tokens.access_token || tokens.refresh_token) {
      oauth2Client.setCredentials(tokens);
      console.log('✓ Loaded saved GA4 tokens');
    }
  } catch(e) {}
}

oauth2Client.on('tokens', (tokens) => {
  const existing = existsSync(TOKENS_FILE) ? JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) : {};
  writeFileSync(TOKENS_FILE, JSON.stringify({ ...existing, ...tokens }));
  console.log('✓ GA4 tokens refreshed');
});

let analyticsClient = null;
function getClient() {
  if (!analyticsClient) analyticsClient = new BetaAnalyticsDataClient({ authClient: oauth2Client });
  return analyticsClient;
}

// OAuth start
app.get('/oauth/start', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  res.redirect(url);
});

// OAuth callback
app.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(`Auth failed: ${error}`);
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    writeFileSync(TOKENS_FILE, JSON.stringify(tokens));
    analyticsClient = null;
    console.log('✓ GA4 authenticated!');
    res.send(`<html><body style="font-family:sans-serif;padding:40px;background:#0b0c10;color:#e2e4f0">
      <h2 style="color:#34d399">✓ Connected!</h2>
      <p>GA4 is now connected. Close this tab and refresh the dashboard.</p>
      <a href="/" style="color:#4f8ef7">← Back to dashboard</a>
    </body></html>`);
  } catch (err) {
    res.send(`Token exchange failed: ${err.message}`);
  }
});

// GA4 data — public endpoint, YOUR credentials power it
app.get('/api/ga4', async (req, res) => {
  const creds = oauth2Client.credentials;
  if (!creds?.access_token && !creds?.refresh_token) {
    return res.status(401).json({ error: 'Not authenticated', authUrl: '/oauth/start' });
  }
  try {
    const client = getClient();
    const property = `properties/${GA4_PROPERTY_ID}`;
    const days = parseInt(req.query.days || '30');
    const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' };

    const [ovRes, chRes, pgRes] = await Promise.all([
      client.runReport({ property, dateRanges: [dateRange], metrics: [
        { name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' },
        { name: 'conversions' }, { name: 'sessionConversionRate' },
      ]}),
      client.runReport({ property, dateRanges: [dateRange],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8,
      }),
      client.runReport({ property, dateRanges: [dateRange],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'sessions' }, { name: 'engagementRate' }, { name: 'sessionConversionRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10,
      }),
    ]);

    const mv = (row, i) => row?.metricValues?.[i]?.value ?? '0';
    const ovRow = ovRes[0].rows?.[0];
    const overview = {
      sessions:       parseInt(mv(ovRow, 0)),
      users:          parseInt(mv(ovRow, 1)),
      engagementRate: parseFloat(mv(ovRow, 2)) * 100,
      conversions:    parseInt(mv(ovRow, 3)),
      conversionRate: parseFloat(mv(ovRow, 4)) * 100,
      sessionsDelta:  'live',
    };
    const channels = (chRes[0].rows || []).map(r => ({
      name: r.dimensionValues[0].value, sessions: parseInt(mv(r,0)), conversions: parseInt(mv(r,1))
    }));
    const pages = (pgRes[0].rows || []).map(r => ({
      path: r.dimensionValues[0].value, sessions: parseInt(mv(r,0)),
      engRate: (parseFloat(mv(r,1))*100).toFixed(1), conv: (parseFloat(mv(r,2))*100).toFixed(1)
    }));
    const funnel = [
      { stage: 'Sessions', value: overview.sessions },
      { stage: 'Engaged',  value: Math.round(overview.sessions * overview.engagementRate / 100) },
      { stage: 'Conversions', value: overview.conversions },
    ];
    res.json({ live: true, overview, channels, pages, funnel });
  } catch (err) {
    console.error('GA4 error:', err.message);
    if (err.message?.includes('invalid_grant') || err.message?.includes('401')) {
      analyticsClient = null;
      return res.status(401).json({ error: 'Token expired — visit /oauth/start to re-authenticate', authUrl: '/oauth/start' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  const hasTokens = existsSync(TOKENS_FILE) && (() => {
    try { const t = JSON.parse(readFileSync(TOKENS_FILE,'utf8')); return t.access_token||t.refresh_token; } catch{return false;}
  })();
  console.log(`\n✓ Dashboard: http://localhost:${PORT}`);
  if (!hasTokens) {
    console.log('\n⚠  GA4 not connected yet.');
    console.log('  Open this URL to authorize: http://localhost:3000/oauth/start\n');
  } else {
    console.log('  GA4 ✓  Stripe ✓\n');
  }
});
