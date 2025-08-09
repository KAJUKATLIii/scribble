const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

const PORT = process.env.PORT || 3000;

const rooms = {};

const wordLists = {
  english: {
    objects: ["car", "house", "book", "tree", "phone", "chair"],
    animals: ["dog", "cat", "lion", "elephant", "tiger", "monkey"],
    food: ["pizza", "burger", "apple", "mango", "rice", "bread"]
  },
  hindi: {
    objects: ["किताब", "कुर्सी", "पेड़", "घड़ी", "दरवाज़ा"],
    animals: ["कुत्ता", "बिल्ली", "शेर", "हाथी", "बाघ"],
    food: ["आम", "चावल", "रोटी", "दूध", "दाल"]
  }
};

function getRandomWords(language, category, count, customWords = []) {
  let pool = [];
  if (customWords.length) {
    pool = customWords;
  } else {
    pool = wordLists[language]?.[category] || [];
  }
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function serializeRoomState(room) {
  return {
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score
    })),
    hostId: room.hostId,
    drawerId: room.drawerId,
    roundNumber: room.roundNumber,
    maxRounds: room.settings.maxRounds,
    timeLeft: room.timeLeft || 0,
    settings: room.settings
  };
}

io.on("connection", socket => {
  console.log("New connection", socket.id);

  // Create Room
  socket.on("createRoom", (data, cb) => {
    const roomCode = uuidv4().slice(0, 4).toUpperCase();
    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      players: [{ id: socket.id, name: data.name, score: 0, guessed: false }],
      drawerId: null,
      roundNumber: 0,
      currentWord: null,
      strokes: [],
      timeLeft: 0,
      settings: {
        roundTime: data.roundTime || 60,
        maxRounds: data.maxRounds || 8,
        language: "english",
        category: "objects",
        customWords: data.customWords
          ? data.customWords.split(",").map(w => w.trim()).filter(Boolean)
          : []
      }
    };
    socket.join(roomCode);
    socket.data.room = roomCode;
    cb({ ok: true, room: roomCode });
    io.to(roomCode).emit("roomState", serializeRoomState(rooms[roomCode]));
  });

  // Join Room
  socket.on("joinRoom", (data, cb) => {
    const room = rooms[data.room];
    if (!room) return cb({ ok: false, error: "Room not found" });
    room.players.push({ id: socket.id, name: data.name, score: 0, guessed: false });
    socket.join(data.room);
    socket.data.room = data.room;
    cb({ ok: true, room: data.room });
    io.to(data.room).emit("roomState", serializeRoomState(room));
  });

  // Kick Player
  socket.on("kickPlayer", ({ playerId }) => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      io.to(playerId).emit("kicked", { reason: "Kicked by host" });
      room.players.splice(idx, 1);
      io.to(socket.data.room).emit("roomState", serializeRoomState(room));
    }
  });

  // Start Game
  socket.on("startGame", () => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    startRound(room.code);
  });

  function startRound(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.roundNumber++;
    if (room.roundNumber > room.settings.maxRounds) {
      io.to(roomCode).emit("gameOver", { players: room.players });
      return;
    }

    // Pick drawer
    const drawer = room.players[room.roundNumber % room.players.length];
    room.drawerId = drawer.id;
    room.strokes = [];
    room.players.forEach(p => (p.guessed = false));

    // Send choose word to drawer
    const candidateWords = getRandomWords(
      room.settings.language,
      room.settings.category,
      3,
      room.settings.customWords
    );

    io.to(roomCode).emit("roomState", serializeRoomState(room));
    io.to(roomCode).emit("roundPrestart", {
      drawerId: room.drawerId,
      drawerName: drawer.name,
      candidateWords
    });

    // Auto pick after 30 sec
    const pickTimer = setTimeout(() => {
      if (!room.currentWord) {
        const pick = candidateWords[Math.floor(Math.random() * candidateWords.length)];
        chooseWord(roomCode, pick);
      }
    }, 30000);

    // Wait for chooseWord event
    socket.on("chooseWord", ({ word }) => {
      if (socket.id === room.drawerId && candidateWords.includes(word)) {
        clearTimeout(pickTimer);
        chooseWord(roomCode, word);
      }
    });
  }

  function chooseWord(roomCode, word) {
    const room = rooms[roomCode];
    if (!room) return;
    room.currentWord = word;
    room.timeLeft = room.settings.roundTime;

    const drawerSocket = io.sockets.sockets.get(room.drawerId);
    if (drawerSocket) {
      drawerSocket.emit("yourWord", word);
    }

    io.to(roomCode).emit("roundStarted", {
      drawerId: room.drawerId,
      drawerName: room.players.find(p => p.id === room.drawerId)?.name
    });

    const timer = setInterval(() => {
      room.timeLeft--;
      io.to(roomCode).emit("time", room.timeLeft);
      if (room.timeLeft <= 0) {
        clearInterval(timer);
        io.to(roomCode).emit("roundEnded", { word: room.currentWord });
        room.currentWord = null;
        setTimeout(() => startRound(roomCode), 3000);
      }
    }, 1000);
  }

  // Chat / Guess
  socket.on("chat", msg => {
    const room = rooms[socket.data.room];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const isDrawer = socket.id === room.drawerId;

    // Guess check
    if (
      room.currentWord &&
      !isDrawer &&
      msg.trim().toLowerCase() === room.currentWord.toLowerCase() &&
      !player.guessed
    ) {
      player.score += 10;
      player.guessed = true;
      io.to(room.code).emit("systemMessage", `${player.name} guessed the word!`);
      io.to(room.code).emit("roomState", serializeRoomState(room));
      return;
    }

    // Normal chat
    io.to(room.code).emit("chat", { name: player.name, message: msg });
  });

  // Drawing events
  socket.on("stroke", stroke => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.drawerId) return;
    socket.broadcast.to(room.code).emit("stroke", stroke);
    room.strokes.push(stroke);
  });

  socket.on("undo", () => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.drawerId) return;
    if (room.strokes.length > 0) {
      room.strokes.pop();
      io.to(room.code).emit("undo");
    }
  });

  socket.on("requestReplay", () => {
    const room = rooms[socket.data.room];
    if (!room) return;
    socket.emit("replayData", room.strokes || []);
  });

  // Disconnect
  socket.on("disconnect", () => {
    const room = rooms[socket.data.room];
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[socket.data.room];
    } else {
      io.to(room.code).emit("roomState", serializeRoomState(room));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
