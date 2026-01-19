
import express from 'express';
import postgres from 'postgres';
import { GoogleGenAI } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const port = Number(process.env.PORT || 8080);

// Use simpler environment variable detection for Cloud SQL
const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'postgres',
  username: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  max: 15,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Initialize Database Table
const initDb = async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        casinos JSONB NOT NULL
      )
    `;
    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Critical Database Error during init:", err);
  }
};
initDb();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
// Use Gemini 2.5 series model as required for Google Maps grounding support.
const MODEL_NAME = 'gemini-2.5-flash';

app.use(express.json());

// Serve static files first
// Fix: Added explicit path '/' to resolve "No overload matches this call" error for middleware registration.
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));


// API: Get Latest Data and History
// Fix: Added 'next' parameter and ensuring signature matches RequestHandler to resolve type overload error.
app.get('/api/market', async (req, res, next) => {
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
    console.error("API Market Error:", err);
    res.status(500).json({ error: 'Database fetch failed.' });
    if (next) next(err);
  }
});

// Fix: Added 'next' parameter to properly match Express RequestHandler signature for async functions.
app.post('/api/sync', async (req, res, next) => {
  try {
    const { targets } = req.body;
    if (!targets) return res.status(400).send("No targets");
    
    const targetInstructions = targets.map(t => `- ${t.name} (Place ID: ${t.placeId})`).join('\n');
    const prompt = `Perform a live lookup of these casinos in Batumi, Georgia. Format: | Name | Rating | Reviews | PlaceID | Address |\n${targetInstructions}`;

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
    text.split('\n').forEach(line => {
      const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
      if (parts.length >= 4 && !parts[0].toLowerCase().includes('name') && !parts[0].includes('---')) {
        const ratingMatch = parts[1].match(/[\d.]+/);
        const reviewsMatch = parts[2].replace(/,/g, '').match(/\d+/);
        casinos.push({
          id: parts[3] || parts[0].toLowerCase().replace(/\s+/g, '-'),
          placeId: parts[3],
          name: parts[0],
          rating: parseFloat(ratingMatch ? ratingMatch[0] : "0"),
          userRatingsTotal: parseInt(reviewsMatch ? reviewsMatch[0] : "0"),
          vicinity: parts[4] || "Batumi",
          googleMapsUri: `https://www.google.com/maps/search/${encodeURIComponent(parts[0])}`
        });
      }
    });

    if (casinos.length > 0) {
      await sql`INSERT INTO market_snapshots (casinos) VALUES (${sql.json(casinos)})`;
      res.json({ success: true, count: casinos.length });
    } else {
      res.status(422).json({ error: "No data parsed" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
    if (next) next(err);
  }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// Fallback for SPA
// Added 'next' parameter for consistency across route definitions.
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});


app.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on port ${port}`);
});
