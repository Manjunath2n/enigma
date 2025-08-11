const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);


app.use(express.static('public'));


const wss = new WebSocket.Server({ server, path: '/ws' });

const rooms = new Map();

wss.on('connection', (ws) => {
  console.log('✅ New WebSocket connection');

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const { type, room, payload } = data;

    if (type === 'join') {
      if (!rooms.has(room)) rooms.set(room, []);
      rooms.get(room).push(ws);
      return;
    }

    if (['offer', 'answer', 'ice', 'pubkey'].includes(type)) {
      const peers = rooms.get(room) || [];
      for (const peer of peers) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify({ type, payload }));
        }
      }
    }
  });

  ws.on('close', () => {
    for (const [roomId, clients] of rooms.entries()) {
      rooms.set(roomId, clients.filter((c) => c !== ws));
      if (rooms.get(roomId).length === 0) {
        rooms.delete(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Enigma signaling server running on port ${PORT}`);
});

