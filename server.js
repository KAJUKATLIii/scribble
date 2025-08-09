const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

let rooms = {}; // { roomCode: { hostId, players:[], settings:{}, word, drawerId, roundNumber, ... } }

// ============ Helper functions ============
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function endRound(room) {
  const r = rooms[room];
  if (!r) return;

  clearInterval(r.timer);
  io.to(room).emit('roundEnded', { word: r.word });

  // Prepare for next round
  setTimeout(() => {
    if (r.roundNumber >= r.settings.maxRounds) {
      io.to(room).emit('gameOver', { players: r.players });
    } else {
      startRound(room);
    }
  }, 3000);
}

function startRound(room) {
  const r = rooms[room];
  if (!r) return;

  r.roundNumber++;
  r.drawerIndex = (r.drawerIndex + 1) % r.players.length;
  r.drawerId = r.players[r.drawerIndex].id;
  r.players.forEach(p => p.guessed = false);

  // Pick candidate words
  let candidates = [];
  if (r.settings.customWords && r.settings.customWords.length >= 3) {
    candidates = shuffle([...r.settings.customWords]).slice(0, 3);
  } else {
    const pool = getWordPool(r.settings.language, r.settings.category);
    candidates = shuffle([...pool]).slice(0, 3);
  }

  io.to(room).emit('roundPrestart', {
    drawerId: r.drawerId,
    drawerName: r.players.find(p => p.id === r.drawerId).name,
    candidateWords: candidates
  });

  r.word = null;

  // Wait for word choice
  r.chooseWordTimeout = setTimeout(() => {
    if (!r.word) {
      const autoPick = candidates[Math.floor(Math.random() * candidates.length)];
      r.word = autoPick;
      io.to(r.drawerId).emit('yourWord', r.word);
      io.to(room).emit('roundStarted', {
        drawerId: r.drawerId,
        drawerName: r.players.find(p => p.id === r.drawerId).name
      });
      startRoundTimer(room);
    }
  }, 30000);
}

function startRoundTimer(room) {
  const r = rooms[room];
  r.timeLeft = r.settings.roundTime;
  r.timer = setInterval(() => {
    r.timeLeft--;
    io.to(room).emit('time', r.timeLeft);
    if (r.timeLeft <= 0) {
      clearInterval(r.timer);
      endRound(room);
    }
  }, 1000);
}

function getWordPool(language, category) {
  const words = {
    english: {
      objects: ['chair', 'bottle', 'computer', 'phone'],
      animals: ['cat', 'dog', 'elephant', 'tiger'],
      food: ['pizza', 'burger', 'mango', 'rice']
    },
    hindi: {
      objects: ['kursi', 'botal', 'computer', 'phone'],
      animals: ['billi', 'kutta', 'hathi', 'sher'],
      food: ['pizza', 'burger', 'aam', 'chawal']
    }
  };
  return words[language]?.[category] || [];
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

// ============ Socket.io ============
io.on('connection', (socket) => {
  console.log('User connected', socket.id);

  socket.on('createRoom', ({ name, maxRounds, roundTime, customWords }, cb) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name, score: 0 }],
      settings: {
        maxRounds: maxRounds || 8,
        roundTime: roundTime || 60,
        language: 'english',
        category: 'objects',
        customWords: customWords ? customWords.split(',').map(w => w.trim()).filter(Boolean) : []
      },
      roundNumber: 0,
      drawerIndex: -1
    };
    socket.join(roomCode);
    socket.data.room = roomCode;
    cb && cb({ ok: true, room: roomCode });
    io.to(roomCode).emit('roomState', rooms[roomCode]);
  });

  socket.on('joinRoom', ({ name, room }, cb) => {
    const roomCode = String(room || '').toUpperCase();
    const r = rooms[roomCode];
    if (!r) return cb && cb({ ok: false, error: 'Room not found' });

    r.players.push({ id: socket.id, name, score: 0 });
    socket.join(roomCode);
    socket.data.room = roomCode;
    cb && cb({ ok: true, room: roomCode });
    io.to(roomCode).emit('roomState', r);
  });

  socket.on('chat', (msg) => {
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
        io.to(socket.id).emit('systemMessage', `✅ You guessed it! The word was "${r.word}".`);
        socket.broadcast.to(room).emit('systemMessage', `🎯 ${player.name} guessed the word!`);

        const allGuessed = r.players.filter(p => p.id !== r.drawerId).every(p => p.guessed);
        if (allGuessed) {
          clearInterval(r.timer);
          endRound(room);
        }
        io.to(room).emit('roomState', r);
        return;
      }
    }

    io.to(room).emit('chat', { name: player.name, message: msg });
  });

  socket.on('chooseWord', ({ word }) => {
    const room = socket.data.room;
    const r = rooms[room];
    if (!r) return;

    clearTimeout(r.chooseWordTimeout);
    r.word = word;
    io.to(r.drawerId).emit('yourWord', r.word);
    io.to(room).emit('roundStarted', {
      drawerId: r.drawerId,
      drawerName: r.players.find(p => p.id === r.drawerId).name
    });
    startRoundTimer(room);
  });

  socket.on('startGame', () => {
    const room = socket.data.room;
    const r = rooms[room];
    if (!r || r.hostId !== socket.id) return;
    startRound(room);
  });

  socket.on('updateSettings', (settings) => {
    const room = socket.data.room;
    const r = rooms[room];
    if (!r || r.hostId !== socket.id) return;
    Object.assign(r.settings, settings);
    io.to(room).emit('roomState', r);
  });

  socket.on('setCustomWords', (words) => {
    const room = socket.data.room;
    const r = rooms[room];
    if (!r || r.hostId !== socket.id) return;
    r.settings.customWords = words.split(',').map(w => w.trim()).filter(Boolean);
    io.to(room).emit('roomState', r);
  });

  socket.on('kickPlayer', ({ playerId }) => {
    const room = socket.data.room;
    const r = rooms[room];
    if (!r || r.hostId !== socket.id) return;
    const idx = r.players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      io.to(playerId).emit('kicked', { reason: 'Kicked by host' });
      io.sockets.sockets.get(playerId)?.leave(room);
      r.players.splice(idx, 1);
      io.to(room).emit('roomState', r);
    }
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    r.players = r.players.filter(p => p.id !== socket.id);

    if (r.players.length === 0) {
      clearInterval(r.timer);
      delete rooms[room];
    } else {
      if (socket.id === r.hostId) {
        r.hostId = r.players[0].id;
      }
      io.to(room).emit('roomState', r);
    }
  });
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
