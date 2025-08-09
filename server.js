const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));
app.use(express.json());

const rooms = {}; // { roomCode: { hostId, players[], settings, ... } }

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 4).toUpperCase();
}

function serializeRoomState(room) {
  return {
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
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

const WORDS = {
  english: {
    objects: ["car", "phone", "book", "laptop", "house"],
    animals: ["dog", "cat", "elephant", "lion", "tiger"],
    food: ["pizza", "burger", "rice", "pasta", "mango"]
  },
  hindi: {
    objects: ["किताब", "कलम", "कुर्सी", "घड़ी", "गिलास"],
    animals: ["कुत्ता", "बिल्ली", "हाथी", "शेर", "बाघ"],
    food: ["समोसा", "चाय", "दाल", "रोटी", "पकौड़ा"]
  }
};

io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  // CREATE ROOM
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
        customWords: customWords
          ? customWords.split(",").map(w => w.trim()).filter(Boolean)
          : []
      },
      roundNumber: 0,
      drawerIndex: -1,
      strokes: []
    };
    socket.join(roomCode);
    socket.data.room = roomCode;
    cb && cb({ ok: true, room: roomCode });
    io.to(roomCode).emit("roomState", serializeRoomState(rooms[roomCode]));
  });

  // JOIN ROOM
  socket.on("joinRoom", ({ name, room }, cb) => {
    const r = rooms[room];
    if (!r) return cb && cb({ ok: false, error: "Room not found" });
    if (r.players.find(p => p.id === socket.id))
      return cb && cb({ ok: false, error: "Already in room" });

    r.players.push({ id: socket.id, name, score: 0 });
    socket.join(room);
    socket.data.room = room;
    cb && cb({ ok: true, room });
    io.to(room).emit("roomState", serializeRoomState(r));
    io.to(room).emit("systemMessage", `${name} joined the room`);
  });

  // CHAT / GUESS
  socket.on("chat", msg => {
    const roomCode = socket.data.room;
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Check if guessing
    if (
      room.drawerId &&
      room.currentWord &&
      socket.id !== room.drawerId &&
      msg.trim().toLowerCase() === room.currentWord.toLowerCase()
    ) {
      player.score += 10;
      io.to(roomCode).emit("systemMessage", `${player.name} guessed the word!`);
      io.to(roomCode).emit("roomState", serializeRoomState(room));
    } else {
      io.to(roomCode).emit("chat", { name: player.name, message: msg });
    }
  });

  // KICK PLAYER
  socket.on("kickPlayer", ({ playerId }) => {
    const roomCode = socket.data.room;
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;
    room.players = room.players.filter(p => p.id !== playerId);
    io.to(playerId).emit("kicked", { reason: "Kicked by host" });
    io.sockets.sockets.get(playerId)?.leave(roomCode);
    io.to(roomCode).emit("roomState", serializeRoomState(room));
  });

  // SETTINGS
  socket.on("updateSettings", settings => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    Object.assign(room.settings, settings);
    io.to(socket.data.room).emit("roomState", serializeRoomState(room));
  });

  socket.on("setCustomWords", words => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    room.settings.customWords = words
      ? words.split(",").map(w => w.trim()).filter(Boolean)
      : [];
  });

  // START GAME
  socket.on("startGame", () => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    startRound(socket.data.room);
  });

  function startRound(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.roundNumber++;
    if (room.roundNumber > room.settings.maxRounds) {
      io.to(roomCode).emit("gameOver", { players: room.players });
      return;
    }

    room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
    const drawer = room.players[room.drawerIndex];
    room.drawerId = drawer.id;
    room.strokes = [];
    room.currentWord = null;

    // Pick 3 words
    let wordPool = [];
    if (room.settings.customWords.length > 0) {
      wordPool = [...room.settings.customWords];
    } else {
      wordPool =
        WORDS[room.settings.language][room.settings.category] || [];
    }
    const candidates = [];
    while (candidates.length < 3 && wordPool.length > 0) {
      const w = wordPool.splice(
        Math.floor(Math.random() * wordPool.length),
        1
      )[0];
      candidates.push(w);
    }

    io.to(roomCode).emit("roomState", serializeRoomState(room));
    io.to(room.drawerId).emit("roundPrestart", {
      drawerId: drawer.id,
      drawerName: drawer.name,
      candidateWords: candidates
    });

    // Auto-pick after 30s
    room.chooseWordTimeout = setTimeout(() => {
      if (!room.currentWord) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        setWord(roomCode, pick);
      }
    }, 30000);
  }

  function setWord(roomCode, word) {
    const room = rooms[roomCode];
    if (!room) return;
    room.currentWord = word;
    clearTimeout(room.chooseWordTimeout);
    io.to(room.drawerId).emit("yourWord", word);
    io.to(roomCode).emit("roundStarted", {
      drawerId: room.drawerId,
      drawerName: room.players.find(p => p.id === room.drawerId)?.name
    });

    // Start round timer
    room.timeLeft = room.settings.roundTime;
    room.timer = setInterval(() => {
      room.timeLeft--;
      io.to(roomCode).emit("time", room.timeLeft);
      if (room.timeLeft <= 0) {
        clearInterval(room.timer);
        io.to(roomCode).emit("roundEnded", { word: room.currentWord });
        setTimeout(() => startRound(roomCode), 3000);
      }
    }, 1000);
  }

  socket.on("chooseWord", ({ word }) => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.drawerId) return;
    setWord(socket.data.room, word);
  });

  // === Drawing events ===
  socket.on("stroke", stroke => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.drawerId) return;
    socket.broadcast.to(socket.data.room).emit("stroke", stroke);
    room.strokes.push(stroke);
  });

  socket.on("undo", () => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.drawerId) return;
    if (room.strokes.length > 0) {
      room.strokes.pop();
      io.to(socket.data.room).emit("undo");
    }
  });

  socket.on("requestReplay", () => {
    const room = rooms[socket.data.room];
    if (!room) return;
    socket.emit("replayData", room.strokes || []);
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.room;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[roomCode];
    } else {
      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
      }
      io.to(roomCode).emit("roomState", serializeRoomState(room));
    }
  });
});

server.listen(3000, () => console.log("Server running on port 3000"));
