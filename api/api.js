const express = require("express");
const { randomUUID } = require("crypto");
const { createServer } = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

// CORS - Allow your frontend
app.use(cors({
  origin: "*", // For testing, we'll allow all. Change to your actual domain later
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Api-Key"]
}));

app.use(express.json());

// Simple in-memory storage
const sessions = new Map();
const API_KEY = "test-api-key-123"; // Simple API key for testing

// Middleware to check API key
function auth(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.body?.api_key || req.query?.api_key;
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

// Create session endpoint
app.post("/cloud/v1/createSession", auth, async (req, res) => {
  const { game_key } = req.body;
  console.log("Creating session for game:", game_key);
  
  const uuid = randomUUID();
  const session = {
    uuid,
    game_key,
    state: "creating",
    created_at: Date.now()
  };
  
  sessions.set(uuid, session);
  
  // Simulate account creation (simplified)
  setTimeout(() => {
    session.state = "finished_queue";
    session.ice_servers = [{ urls: "stun:stun.l.google.com:19302" }];
    session.signaling_ws = `wss://${req.headers.host}/cloud/v1/signal/${uuid}`;
    console.log("Session ready:", uuid);
  }, 2000);
  
  res.json({ status: "creating", uuid });
});

// Get queue status
app.get("/cloud/v1/getQueue", auth, (req, res) => {
  const { uuid } = req.query;
  const session = sessions.get(uuid);
  
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  if (session.state === "finished_queue") {
    return res.json({
      status: "finished_queue",
      uuid,
      message: "Ready to start"
    });
  }
  
  return res.json({ status: "queue", queue_pos: 1 });
});

// Start game
app.post("/cloud/v1/startGame", auth, (req, res) => {
  const { uuid } = req.body;
  const session = sessions.get(uuid);
  
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  session.state = "active";
  
  res.json({
    ice_servers: session.ice_servers,
    signaling_ws: session.signaling_ws,
    max_seconds: 1140
  });
  
  console.log("Game started:", uuid);
});

// Ping to keep session alive
app.post("/cloud/v1/pingSession", auth, (req, res) => {
  const { uuid } = req.body;
  const session = sessions.get(uuid);
  
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  res.json({ status: "ok", time_used: 0 });
});

// Embed data endpoint
app.get("/cloud/v1/embed-data", (req, res) => {
  const { id } = req.query;
  const session = sessions.get(id);
  
  if (!session || session.state !== "active") {
    return res.status(404).json({ error: "Session not active" });
  }
  
  res.json({
    ice_servers: session.ice_servers,
    signaling_ws: session.signaling_ws
  });
});

// Simple HTML for embed
app.get("/cloud/v1/embed", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Game Stream</title>
      <style>
        body { margin: 0; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
        #status { text-align: center; }
        video { width: 100%; height: 100%; display: none; }
      </style>
    </head>
    <body>
      <div id="status">Connecting to game...</div>
      <video id="stream" autoplay playsinline></video>
      <script>
        const params = new URLSearchParams(location.search);
        const id = params.get('id');
        
        async function connect() {
          try {
            const res = await fetch('/cloud/v1/embed-data?id=' + id);
            const data = await res.json();
            
            if (!res.ok) {
              document.getElementById('status').textContent = 'Error: ' + (data.error || 'Unknown');
              return;
            }
            
            document.getElementById('status').textContent = 'Connected! WebSocket: ' + data.signaling_ws;
            
            // Here you would connect WebRTC - simplified for now
            setTimeout(() => {
              document.getElementById('status').style.display = 'none';
              document.getElementById('stream').style.display = 'block';
              document.getElementById('stream').srcObject = null; // Would be WebRTC stream
            }, 1000);
            
          } catch (e) {
            document.getElementById('status').textContent = 'Connection failed: ' + e.message;
          }
        }
        
        connect();
      </script>
    </body>
    </html>
  `);
});

// WebSocket server (simplified)
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const match = req.url.match(/^\\/cloud\\/v1\\/signal\\/([0-9a-f-]{36})$/i);
  if (!match) {
    socket.destroy();
    return;
  }
  
  const uuid = match[1];
  const session = sessions.get(uuid);
  
  if (!session) {
    socket.destroy();
    return;
  }
  
  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log("WebSocket connected for:", uuid);
    
    ws.on("message", (data) => {
      console.log("WS message:", data.toString());
    });
    
    ws.on("close", () => {
      console.log("WebSocket closed:", uuid);
    });
    
    // Send test message
    ws.send(JSON.stringify({ type: "connected", uuid }));
  });
});

httpServer.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
