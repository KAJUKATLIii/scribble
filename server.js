// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// Serve public folder
app.use(express.static('public'));

// Room store
const rooms = {};
const defaultWords = {
  english: {
    objects: ['chair', 'bottle', 'laptop'],
    animals: ['cat', 'dog', 'elephant'],
    food: ['pizza', 'burger', 'icecream']
  },
  hindi: {
    objects: ['kursi', 'botal', 'computer'],
    animals: ['billi', 'kutta', 'haathi'],
    food: ['paani puri', 'samosa', 'laddu']
  }
};

// === Socket.IO ===
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create Room
  socket.on('createRoom', (data, cb) => {
    const code = uuidv4().slice(0, 4).toUpperCase();
    rooms[code] = {
      hostId: socket.id,
      settings: {
        roundTime: data.roundTime || 60,
        maxRounds: data.maxRounds || 8,
        language: data.language || 'english',
        category: data.category || 'objects',
        customWords: data.customWords
          ? data.customWords.split(',').map(w => w.trim()).filter(Boolean)
          : []
      },
      players: [],
      drawerId: null,
      roundNumber: 0,
      timer: null
    };

    joinRoom(socket, code, data.name);
    cb && cb({ ok: true, room: code });
  });

  // Join Room
  socket.on('joinRoom', (data, cb) => {
    const room = String(data.room || '').toUpperCase();
    if (!rooms[room]) return cb && cb({ ok: false, error: 'Room not found' });
    joinRoom(socket, room, data.name);
    cb && cb({ ok: true, room });
  });

  // Chat
  socket.on('chat', (msg) => {
    const room = socket.data.room;
    if (!room) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    io.to(room).emit('chat', { name: player.name, message: msg });
  });

  // Kick player
  socket.on('kickPlayer', ({ playerId }) => {
    const room = socket.data.room;
    if (!room) return;
    if (rooms[room].hostId !== socket.id) return;
    io.to(playerId).emit('kicked', { reason: 'Kicked by host' });
    removePlayer(room, playerId);
  });

  // Update settings
  socket.on('updateSettings', (settings) => {
    const room = socket.data.room;
    if (!room || rooms[room].hostId !== socket.id) return;
    Object.assign(rooms[room].settings, settings);
    sendRoomState(room);
  });

  // Set custom words
  socket.on('setCustomWords', (words) => {
    const room = socket.data.room;
    if (!room || rooms[room].hostId !== socket.id) return;
    rooms[room].settings.customWords = words
      ? words.split(',').map(w => w.trim()).filter(Boolean)
      : [];
  });

  // Start Game
  socket.on('startGame', () => {
    const room = socket.data.room;
    if (!room || rooms[room].hostId !== socket.id) return;
    startRound(room);
  });

  // Choose word
  socket.on('chooseWord', ({ word }) => {
    const room = socket.data.room;
    if (!room) return;
    io.to(socket.id).emit('yourWord', word);
    io.to(room).emit('roundStarted', { drawerId: socket.id, drawerName: getPlayer(room, socket.id).name });
  });

  // Strokes
  socket.on('stroke', (stroke) => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('stroke', stroke);
  });

  socket.on('undo', () => {
    const room = socket.data.room;
    if (!room) return;
    io.to(room).emit('undo');
  });

  // Disconnect
  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    removePlayer(room, socket.id);
  });
});

// === Helpers ===
function joinRoom(socket, room, name) {
  socket.join(room);
  socket.data.room = room;
  rooms[room].players.push({ id: socket.id, name, score: 0 });
  sendRoomState(room);
}

function removePlayer(room, playerId) {
  const r = rooms[room];
  if (!r) return;
  r.players = r.players.filter(p => p.id !== playerId);
  if (r.players.length === 0) delete rooms[room];
  else sendRoomState(room);
}

function getPlayer(room, id) {
  return rooms[room]?.players.find(p => p.id === id);
}

function sendRoomState(room) {
  const r = rooms[room];
  if (!r) return;
  io.to(room).emit('roomState', {
    players: r.players,
    hostId: r.hostId,
    drawerId: r.drawerId,
    roundNumber: r.roundNumber,
    maxRounds: r.settings.maxRounds,
    timeLeft: r.timeLeft || 0,
    settings: r.settings
  });
}

function startRound(room) {
  const r = rooms[room];
  if (!r) return;
  r.roundNumber++;
  const drawer = r.players[Math.floor(Math.random() * r.players.length)];
  r.drawerId = drawer.id;

  const wordList = r.settings.customWords.length
    ? r.settings.customWords
    : defaultWords[r.settings.language][r.settings.category];

  const candidates = [];
  for (let i = 0; i < 3; i++) {
    candidates.push(wordList[Math.floor(Math.random() * wordList.length)]);
  }

  io.to(room).emit('roundPrestart', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    candidateWords: candidates
  });

  // Auto-pick after 30s if not chosen
  setTimeout(() => {
    if (!r.wordChosen) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      io.to(drawer.id).emit('yourWord', pick);
      io.to(room).emit('roundStarted', { drawerId: drawer.id, drawerName: drawer.name });
    }
  }, 30000);
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
