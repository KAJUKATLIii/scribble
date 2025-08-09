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
      score: p.score,
      guessed: p.guessed || false
    })),
    hostId: room.hostId,
    drawerId: room.drawerId,
    roundNumber: room.roundNumber,
    maxRounds: room.settings.maxRounds,
    timeLeft: room.timeLeft || 0,
    settings: room.settings,
    roomCode: room.code
  };
}

function generateRoomCode() {
  let code;
  do {
    code = uuidv4().slice(0, 4).toUpperCase();
  } while (rooms[code]);
  return code;
}

io.on("connection", socket => {
  console.log("New connection:", socket.id);

  // CREATE ROOM
  socket.on("createRoom", (data, cb) => {
    console.log("createRoom event received:", data);

    try {
      if (typeof cb !== "function") {
        console.warn("createRoom callback missing or not a function");
        return;
      }

      if (!data || !data.name || typeof data.name !== "string" || !data.name.trim()) {
        return cb({ ok: false, error: "Invalid name" });
      }

      const roomCode = generateRoomCode();

      rooms[roomCode] = {
        code: roomCode,
        hostId: socket.id,
        players: [{ id: socket.id, name: data.name.trim(), score: 0, guessed: false }],
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
        },
        timerId: null,
        pickTimer: null,
        candidateWords: []
      };

      socket.join(roomCode);
      socket.data.room = roomCode;

      console.log(`Room ${roomCode} created by ${data.name}`);

      cb({ ok: true, room: roomCode });
      io.to(roomCode).emit("roomState", serializeRoomState(rooms[roomCode]));
    } catch (error) {
      console.error("Error in createRoom handler:", error);
      if (typeof cb === "function") cb({ ok: false, error: "Internal server error" });
    }
  });

  // JOIN ROOM
  socket.on("joinRoom", (data, cb) => {
    const room = rooms[data.room];
    if (!room) return cb({ ok: false, error: "Room not found" });

    if (room.players.find(p => p.id === socket.id)) {
      return cb({ ok: false, error: "Already joined" });
    }

    if (room.players.find(p => p.name.toLowerCase() === data.name.toLowerCase())) {
      return cb({ ok: false, error: "Name already taken in room" });
    }

    room.players.push({ id: socket.id, name: data.name.trim(), score: 0, guessed: false });
    socket.join(data.room);
    socket.data.room = data.room;
    cb({ ok: true, room: data.room });
    io.to(data.room).emit("roomState", serializeRoomState(room));
  });

  // KICK PLAYER
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

  // START GAME
  socket.on("startGame", () => {
    const room = rooms[socket.data.room];
    if (!room || socket.id !== room.hostId) return;
    startRound(room.code);
  });

  // CHOOSE WORD
  socket.on("chooseWord", ({ word }) => {
    const room = rooms[socket.data.room];
    if (!room) return;

    if (socket.id === room.drawerId) {
      if (!room.candidateWords) return;
      if (room.candidateWords.includes(word)) {
        if (room.pickTimer) {
          clearTimeout(room.pickTimer);
          room.pickTimer = null;
        }
        chooseWord(room.code, word);
      }
    }
  });

  // CHAT / GUESS
  socket.on("chat", msg => {
    const room = rooms[socket.data.room];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const isDrawer = socket.id === room.drawerId;
    const cleanMsg = msg.trim();

    if (
      room.currentWord &&
      !isDrawer &&
      cleanMsg.toLowerCase() === room.currentWord.toLowerCase() &&
      !player.guessed
    ) {
      player.score += 10;
      player.guessed = true;
      io.to(room.code).emit("systemMessage", `${player.name} guessed the word!`);
      io.to(room.code).emit("roomState", serializeRoomState(room));
      return;
    }

    io.to(room.code).emit("chat", { name: player.name, message: cleanMsg });
  });

  // DRAWING EVENTS
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

  // DISCONNECT
  socket.on("disconnect", () => {
    const room = rooms[socket.data.room];
    if (!room) return;

    const wasDrawer = room.drawerId === socket.id;

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      delete rooms[socket.data.room];
    } else {
      if (wasDrawer) {
        if (room.timerId) {
          clearInterval(room.timerId);
          room.timerId = null;
        }
        if (room.pickTimer) {
          clearTimeout(room.pickTimer);
          room.pickTimer = null;
        }
        io.to(room.code).emit("systemMessage", "Drawer disconnected. Starting next round...");
        room.currentWord = null;
        setTimeout(() => startRound(room.code), 3000);
      }
      io.to(room.code).emit("roomState", serializeRoomState(room));
    }
  });

  // Helper functions

  function startRound(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.timerId) {
      clearInterval(room.timerId);
      room.timerId = null;
    }
    if (room.pickTimer) {
      clearTimeout(room.pickTimer);
      room.pickTimer = null;
    }

    room.roundNumber++;
    if (room.roundNumber > room.settings.maxRounds) {
      io.to(roomCode).emit("gameOver", { players: room.players });
      return;
    }

    const drawerIndex = (room.roundNumber - 1) % room.players.length;
    const drawer = room.players[drawerIndex];
    room.drawerId = drawer.id;
    room.strokes = [];
    room.players.forEach(p => (p.guessed = false));
    room.currentWord = null;

    room.candidateWords = getRandomWords(
      room.settings.language,
      room.settings.category,
      3,
      room.settings.customWords
    );

    io.to(roomCode).emit("roomState", serializeRoomState(room));
    io.to(roomCode).emit("roundPrestart", {
      drawerId: room.drawerId,
      drawerName: drawer.name,
      candidateWords: room.candidateWords
    });

    room.pickTimer = setTimeout(() => {
      if (!room.currentWord) {
        const pick = room.candidateWords[Math.floor(Math.random() * room.candidateWords.length)];
        chooseWord(roomCode, pick);
      }
      room.pickTimer = null;
    }, 30000);
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

    if (room.timerId) {
      clearInterval(room.timerId);
      room.timerId = null;
    }

    room.timerId = setInterval(() => {
      room.timeLeft--;
      io.to(roomCode).emit("time", room.timeLeft);

      if (room.timeLeft <= 0) {
        clearInterval(room.timerId);
        room.timerId = null;
        io.to(roomCode).emit("systemMessage", `Round ended! The word was: ${room.currentWord}`);
        setTimeout(() => startRound(roomCode), 5000);
      }
    }, 1000);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
