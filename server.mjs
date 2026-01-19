import express from 'express';
import postgres from 'postgres';
import { GoogleGenAI } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ✅ Cloud Run port + bind to 0.0.0.0
const port = Number(process.env.PORT || 8080);

// ✅ Cloud SQL Postgres connection (NO DATABASE_URL parsing)
const sql = postgres({
  host: process.env.PGHOST,                 // e.g. /cloudsql/PROJECT:REGION:INSTANCE
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,         // e.g. postgres
  username: process.env.PGUSER,             // e.g. postgres
  password: process.env.PGPASSWORD,         // e.g. !Shotiko11 (works fine here)
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Initialize Database Table for Cloud SQL
const initDb = async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        casinos JSONB NOT NULL
      )
    `;
    console.log("Cloud SQL Table Initialized Successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
    // Optional: process.exit(1);  // if you want to fail fast when DB is required
  }
};
initDb();

// Gemini Initialization
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const MODEL_NAME = 'gemini-3-flash-preview';

app.use(express.json());
app.use(express.static(__dirname));

// API: Get Latest Data and History
app.get('/api/market', async (req, res) => {
  try {
    const history = await sql`
      SELECT timestamp, casinos
      FROM market_snapshots
      ORDER BY timestamp DESC
      LIMIT 1000
    `;

    const latest = history[0] || { casinos: [], timestamp: new Date().toISOString() };

    res.json({
      casinos: latest.casinos,
      lastUpdated: latest.timestamp,
      history: history.map(h => ({
        timestamp: h.timestamp,
        casinos: h.casinos
      })).reverse()
    });
  } catch (err) {
    console.error("Cloud SQL Fetch Error:", err);
    res.status(500).json({ error: 'Database fetch failed. Check env vars + Cloud SQL permissions.' });
  }
});

// API: Trigger New Sync
app.post('/api/sync', async (req, res) => {
  try {
    const { targets } = req.body;
    const targetInstructions = targets.map(t => `- ${t.name} (Place ID: ${t.placeId})`).join('\n');

    const prompt = `
      Perform a live lookup of these casinos in Batumi, Georgia.
      Analyze the current ratings and review counts on Google Maps.
      ${targetInstructions}
      Format: | Venue Name | Rating | Review Count | Place ID | Address |
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }, { googleSearch: {} }],
        temperature: 0.1
      },
    });

    const text = response.text || "";
    const casinos = [];

    text.split('\n').forEach(row => {
      if ((row.match(/\|/g) || []).length >= 4) {
        const parts = row.split('|').map(p => p.trim());
        const cols = parts.filter(p => p !== '');
        if (cols.length >= 4 && !cols[0].toLowerCase().includes('name') && !cols[0].includes('---')) {
          casinos.push({
            id: cols[3] || cols[0].toLowerCase().replace(/\s+/g, '-'),
            placeId: cols[3],
            name: cols[0],
            rating: parseFloat(cols[1].match(/[\d.]+/) || [0]),
            userRatingsTotal: parseInt(cols[2].replace(/,/g, '').match(/\d+/) || [0]),
            vicinity: cols[4] || "Batumi",
            googleMapsUri: `https://www.google.com/maps/search/${encodeURIComponent(cols[0])}`
          });
        }
      }
    });

    if (casinos.length > 0) {
      await sql`INSERT INTO market_snapshots (casinos) VALUES (${sql.json(casinos)})`;
      res.json({ success: true, count: casinos.length });
    } else {
      res.status(422).json({ error: "No valid casino data extracted from AI response." });
    }
  } catch (err) {
    console.error("AI Sync Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => res.status(200).send('OK'));

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ✅ IMPORTANT: bind to 0.0.0.0 for Cloud Run
app.listen(port, "0.0.0.0", () => {
  console.log(`Cloud Run Service Active on Port ${port}`);
});

