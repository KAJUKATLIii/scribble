// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 5).toUpperCase();
}

function serializeRoomState(room) {
  return {
    hostId: room.hostId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score
    })),
    drawerId: room.drawerId || null,
    roundNumber: room.roundNumber || 0,
    maxRounds: room.settings.maxRounds,
    timeLeft: room.timeLeft || 0,
    settings: {
      language: room.settings.language,
      category: room.settings.category,
      customWords: room.settings.customWords || []
    }
  };
}

function endRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("roundEnded", { word: room.word });
  clearInterval(room.timer);
  room.word = null;
  setTimeout(() => startRound(roomCode), 3000);
}

function startRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  room.players.forEach(p => (p.guessed = false));
  room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
  room.drawerId = room.players[room.drawerIndex].id;
  room.roundNumber++;

  // Pick candidate words
  const words = room.settings.customWords.length
    ? room.settings.customWords
    : ["apple", "banana", "cat", "dog"]; // Replace with Hindi category logic if needed

  const candidateWords = [];
  while (candidateWords.length < 3) {
    candidateWords.push(words[Math.floor(Math.random() * words.length)]);
  }

  io.to(roomCode).emit("roundPrestart", {
    drawerId: room.drawerId,
    drawerName: room.players.find(p => p.id === room.drawerId).name,
    candidateWords
  });

  // Auto-pick after 30s
  room.chooseWordTimeout = setTimeout(() => {
    if (!room.word) {
      const pick = candidateWords[Math.floor(Math.random() * candidateWords.length)];
      chooseWord(roomCode, pick);
    }
  }, 30000);
}

function chooseWord(roomCode, word) {
  const room = rooms[roomCode];
  if (!room) return;
  clearTimeout(room.chooseWordTimeout);

  room.word = word;
  io.to(roomCode).emit("roundStarted", {
    drawerId: room.drawerId,
    drawerName: room.players.find(p => p.id === room.drawerId).name
  });
  io.to(room.drawerId).emit("yourWord", word);

  room.timeLeft = room.settings.roundTime;
  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(roomCode).emit("time", room.timeLeft);
    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      endRound(roomCode);
    }
  }, 1000);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name, maxRounds, roundTime, customWords }, cb) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name, score: 0 }],
      settings: {
        maxRounds: maxRounds || 8,
        roundTime: roundTime || 60,
        language: "english",
        category: "objects",
        customWords: customWords ? customWords.split(",").map(w => w.trim()).filter(Boolean) : []
      },
      roundNumber: 0,
      drawerIndex: -1
    };
    socket.join(roomCode);
    socket.data.room = roomCode;
    cb && cb({ ok: true, room: roomCode });
    io.to(roomCode).emit("roomState", serializeRoomState(rooms[roomCode]));
  });

  socket.on("joinRoom", ({ name, room }, cb) => {
    const r = rooms[room];
    if (!r) return cb({ ok: false, error: "Room not found" });
    r.players.push({ id: socket.id, name, score: 0 });
    socket.join(room);
    socket.data.room = room;
    cb({ ok: true, room });
    io.to(room).emit("roomState", serializeRoomState(r));
  });

  socket.on("chat", (msg) => {
    const room = socket.data.room;
    const r = rooms[room];
    if (!r) return;
    const player = r.players.find(p => p.id === socket.id);
    if (!player || !msg) return;

    const cleanMsg = msg.trim().toLowerCase();
    if (r.word && socket.id !== r.drawerId && !player.guessed) {
      if (cleanMsg === r.word.toLowerCase()) {
        player.guessed = true;
        player.score += 100;
        io.to(socket.id).emit("systemMessage", `✅ You guessed it! The word was "${r.word}".`);
        socket.broadcast.to(room).emit("systemMessage", `🎯 ${player.name} guessed the word!`);
        const allGuessed = r.players.filter(p => p.id !== r.drawerId).every(p => p.guessed);
        if (allGuessed) endRound(room);
        io.to(room).emit("roomState", serializeRoomState(r));
        return;
      }
    }

    io.to(room).emit("chat", { name: player.name, message: msg });
  });

  socket.on("chooseWord", ({ word }) => {
    const roomCode = socket.data.room;
    const room = rooms[roomCode];
    if (!room || socket.id !== room.drawerId) return;
    chooseWord(roomCode, word);
  });

  socket.on("startGame", () => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    startRound(socket.data.room);
  });

  socket.on("updateSettings", (settings) => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    Object.assign(room.settings, settings);
    io.to(socket.data.room).emit("roomState", serializeRoomState(room));
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.room;
    if (!roomCode) return;
    const r = rooms[roomCode];
    if (!r) return;
    r.players = r.players.filter(p => p.id !== socket.id);
    if (r.players.length === 0) {
      delete rooms[roomCode];
    } else {
      if (r.hostId === socket.id) {
        r.hostId = r.players[0].id;
      }
      io.to(roomCode).emit("roomState", serializeRoomState(r));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
