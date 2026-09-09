let socket = null;
let isConnected = false;
let frameId = 0;
let lastTime = performance.now();
let fpsCount = 0;
let currentFps = 0;
let lastFpsUpdate = performance.now();

const canvas = document.getElementById("viewport");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("stats");
const badgeEl = document.getElementById("status-badge");
const connectBtn = document.getElementById("connect-btn");

// Resize canvas to match display size
function resizeCanvas() {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = 500;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Simulated entities (64 bouncing bodies)
const ENTITY_COUNT = 64;
const entities = [];
for (let i = 0; i < ENTITY_COUNT; i++) {
  entities.push({
    id: i + 1,
    x: 50 + Math.random() * (canvas.width - 100),
    y: 50 + Math.random() * 200,
    vx: (Math.random() - 0.5) * 400,
    vy: Math.random() * 100,
    radius: 8 + Math.random() * 8,
    color: `hsl(${Math.random() * 360}, 75%, 65%)`
  });
}

function toggleConnection() {
  if (isConnected) {
    disconnect();
  } else {
    connect();
  }
}

function connect() {
  const url = document.getElementById("ws-url").value;
  const token = document.getElementById("ws-token").value;

  const targetUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
  socket = new WebSocket(targetUrl);

  socket.onopen = () => {
    isConnected = true;
    badgeEl.textContent = "Connected";
    badgeEl.className = "badge connected";
    connectBtn.textContent = "Disconnect";
    connectBtn.style.background = "#da3633";
    console.log("[MCP Bridge Web] WebSocket connection established.");
  };

  socket.onmessage = (event) => {
    // Process telemetry or corrections from the bridge
  };

  socket.onerror = (err) => {
    console.error("[MCP Bridge Web] Connection error:", err);
  };

  socket.onclose = () => {
    disconnect();
  };
}

function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  isConnected = false;
  badgeEl.textContent = "Disconnected";
  badgeEl.className = "badge disconnected";
  connectBtn.textContent = "Connect";
  connectBtn.style.background = "#238636";
}

// 60 FPS Render & Simulation Loop
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  // Calculate FPS
  fpsCount++;
  if (now - lastFpsUpdate >= 500) {
    currentFps = Math.round((fpsCount * 1000) / (now - lastFpsUpdate));
    fpsCount = 0;
    lastFpsUpdate = now;
  }

  // Physics integration (gravity + bounds bounce)
  const gravity = 980; // pixels / s^2
  for (const e of entities) {
    e.vy += gravity * dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;

    // Floor collision
    if (e.y + e.radius >= canvas.height - 20) {
      e.y = canvas.height - 20 - e.radius;
      e.vy = -e.vy * 0.75; // restitution
    }
    // Wall collisions
    if (e.x - e.radius <= 10) {
      e.x = 10 + e.radius;
      e.vx = -e.vx * 0.8;
    } else if (e.x + e.radius >= canvas.width - 10) {
      e.x = canvas.width - 10 - e.radius;
      e.vx = -e.vx * 0.8;
    }
  }

  // Stream state to bridge if connected
  if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
    frameId++;
    const positions = [];
    const velocities = [];
    for (const e of entities) {
      positions.push(e.x, e.y, 0);
      velocities.push(e.vx, e.vy, 0);
    }

    const payload = JSON.stringify({
      frameId,
      timestampNs: Math.floor(now * 1e6),
      entityCount: ENTITY_COUNT,
      deltaTime: dt,
      positions,
      linearVelocities: velocities
    });

    socket.send(payload);
  }

  // Render Viewport
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ground plane
  ctx.fillStyle = "#21262d";
  ctx.fillRect(0, canvas.height - 20, canvas.width, 20);

  // Render entities
  for (const e of entities) {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  statsEl.textContent = `FPS: ${currentFps} | Entities: ${ENTITY_COUNT} | Frame: ${frameId}`;
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
