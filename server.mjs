
import express from 'express';
import postgres from 'postgres';
import { GoogleGenAI } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 8080;

// Database Connection (Google Cloud SQL for PostgreSQL)
// Uses the DATABASE_URL environment variable.
// Cloud Run recommends connecting via Unix sockets.
const sql = postgres(process.env.DATABASE_URL, {
  max: 10, // Optimized for Cloud Run concurrency
  idle_timeout: 20,
  connect_timeout: 10,
});

// Initialize Database Table for Cloud SQL
const initDb = async () => {
  try {
    // Create the schema if it doesn't exist
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
    // In production, we might want to exit if DB isn't ready
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
    
    // The most recent record is our "current" state
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
    res.status(500).json({ error: 'Database fetch failed. Check DATABASE_URL and Cloud SQL permissions.' });
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
    
    // AI Content Parser
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

// Health check for Google Cloud Run
app.get('/health', (req, res) => res.status(200).send('OK'));

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Cloud Run Service Active on Port ${port}`);
});
