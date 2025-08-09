// server.js - Full Scribble clone with custom words support
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.use(bodyParser.json());

// ------------ Database (SQLite) -------------
const DB_PATH = path.join(__dirname, 'scribble.sqlite3');
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT,
    player_name TEXT,
    score INTEGER,
    created_at TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT,
    round_number INTEGER,
    strokes_json TEXT,
    word TEXT,
    language TEXT,
    category TEXT,
    created_at TEXT
  )`);
});

// ------------ Word lists -------------
const WORDS = {
  english: {
    objects: ["apple","book","camera","chair","umbrella","bottle","phone","clock","guitar","car"],
    animals: ["elephant","tiger","dog","cat","penguin","horse","rabbit","lion","crow","dolphin"],
    food: ["pizza","cake","burger","banana","samosa","noodles","pasta","icecream","sandwich","biryani"]
  },
  hindi: {
    objects: ["सेब","किताब","कैमरा","कुर्सी","छाता","बोतल","फोन","घड़ी","गिटार","गाड़ी"],
    animals: ["हाथी","शेर","कुत्ता","बिल्ली","पेंगुइन","घोड़ा","खरगोश","सिंह","कौआ","डॉल्फिन"],
    food: ["पिज़्ज़ा","केक","बर्गर","केला","समोसा","नूडल्स","पास्ता","आइसक्रीम","सैंडविच","बिरयानी"]
  }
};

// ------------ In-memory rooms -------------
const rooms = {};

function makeCode(len = 5) {
  return crypto.randomBytes(len).toString('base64').replace(/[+/=]/g,'').slice(0, len).toUpperCase();
}

function pickWordsFromRoom(roomObj, n = 3) {
  // If customWords present and non-empty, use them as primary source.
  const custom = (roomObj.customWords || []).filter(Boolean);
  let pool = [];
  if (custom.length > 0) {
    pool = custom;
  } else {
    const lang = roomObj.language || 'english';
    const cat = roomObj.category || Object.keys(WORDS[lang])[0];
    pool = (WORDS[lang] && WORDS[lang][cat]) ? [...WORDS[lang][cat]] : [];
  }
  // fallback: combine all english objects
  if (pool.length === 0) {
    pool = [].concat(...Object.values(WORDS['english']));
  }
  const out = [];
  while (out.length < Math.min(n, pool.length)) {
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function saveScoresToDB(roomCode) {
  const r = rooms[roomCode];
  if (!r) return;
  const now = new Date().toISOString();
  const stmt = db.prepare("INSERT INTO leaderboard (room_code, player_name, score, created_at) VALUES (?,?,?,?)");
  r.players.forEach(p => stmt.run(roomCode, p.name, p.score, now));
  stmt.finalize();
}

function persistRound(roomCode, roundNumber, strokes, word, language, category) {
  const now = new Date().toISOString();
  const json = JSON.stringify(strokes || []);
  db.run(
    `INSERT INTO rounds (room_code, round_number, strokes_json, word, language, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [roomCode, roundNumber, json, word || '', language || '', category || '', now]
  );
}

// ------------ Socket.io -------------
io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, maxRounds = 8, roundTime = 60, language = 'english', category = 'objects', customWords = '' }, cb) => {
    const room = makeCode(5);
    rooms[room] = {
      players: [],
      hostId: socket.id,
      drawerIndex: 0,
      roundNumber: 0,
      maxRounds: Number(maxRounds) || 8,
      roundActive: false,
      currentWord: null,
      candidateWords: [],
      timer: null,
      timeLeft: 0,
      roundTime: Number(roundTime) || 60,
      language: language in WORDS ? language : 'english',
      category: (WORDS[language] && WORDS[language][category]) ? category : Object.keys(WORDS[language])[0],
      strokes: [],
      customWords: Array.isArray(customWords) ? customWords : String(customWords || '').split(',').map(s=>s.trim()).filter(Boolean)
    };
    socket.join(room);
    socket.data.room = room;
    rooms[room].players.push({ id: socket.id, name: String(name).slice(0,20) || 'Player', score: 0 });
    emitRoomState(room);
    io.to(room).emit('systemMessage', `${name} created the room ${room}`);
    cb && cb({ ok: true, room });
  });

  socket.on('joinRoom', ({ name, room }, cb) => {
    room = String(room || '').toUpperCase();
    if (!rooms[room]) return cb && cb({ ok: false, error: 'Room not found' });
    socket.join(room);
    socket.data.room = room;
    rooms[room].players.push({ id: socket.id, name: String(name).slice(0,20) || 'Player', score: 0 });
    emitRoomState(room);
    io.to(room).emit('systemMessage', `${name} joined`);
    cb && cb({ ok: true, room });
  });

  socket.on('setCustomWords', (wordsText, cb) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return cb && cb({ ok: false });
    const r = rooms[room];
    if (socket.id !== r.hostId) return cb && cb({ ok: false, error: 'not host' });
    const arr = String(wordsText || '').split(',').map(s => s.trim()).filter(Boolean);
    r.customWords = arr;
    io.to(room).emit('systemMessage', 'Host updated custom words');
    emitRoomState(room);
    cb && cb({ ok: true });
  });

  socket.on('updateSettings', (settings) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== r.hostId) return;
    if (settings.roundTime) r.roundTime = Number(settings.roundTime);
    if (settings.maxRounds) r.maxRounds = Number(settings.maxRounds);
    if (settings.language && WORDS[settings.language]) r.language = settings.language;
    if (settings.category && WORDS[r.language] && WORDS[r.language][settings.category]) r.category = settings.category;
    io.to(room).emit('systemMessage', 'Host updated settings');
    emitRoomState(room);
  });

  socket.on('kickPlayer', ({ playerId }) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== r.hostId) return;
    const idx = r.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    const removed = r.players.splice(idx, 1)[0];
    io.to(room).emit('systemMessage', `${removed.name} was kicked`);
    io.to(playerId).emit('kicked', { reason: 'Kicked by host' });
    if (r.roundActive && playerId === getDrawerId(room)) endRound(room, false);
    if (r.drawerIndex >= r.players.length) r.drawerIndex = 0;
    emitRoomState(room);
  });

  socket.on('startGame', () => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== r.hostId) return;
    startRound(room);
  });

  socket.on('pauseGame', () => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== r.hostId) return;
    if (r.timer) { clearInterval(r.timer); r.timer = null; r.roundActive = false; io.to(room).emit('systemMessage','Game paused by host'); emitRoomState(room); }
  });

  socket.on('chooseWord', ({ word }) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== getDrawerId(room)) return;
    if (!r.candidateWords.includes(word)) return;
    r.currentWord = word;
    r.roundActive = true;
    r.timeLeft = r.roundTime;
    io.to(getDrawerId(room)).emit('yourWord', word);
    io.to(room).emit('systemMessage', 'Drawer chose a word. Round started.');
    io.to(room).emit('roundStarted', { drawerId: getDrawerId(room), drawerName: r.players[r.drawerIndex].name, roundNumber: r.roundNumber, maxRounds: r.maxRounds, timeLeft: r.timeLeft });
    r.timer = setInterval(() => {
      r.timeLeft--;
      io.to(room).emit('time', r.timeLeft);
      if (r.timeLeft <= 0) endRound(room, false);
    }, 1000);
  });

  socket.on('stroke', (stroke) => {
    const room = socket.data.room; if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (!r.roundActive) return;
    if (socket.id !== getDrawerId(room)) return;
    r.strokes.push(stroke);
    socket.to(room).emit('stroke', stroke);
  });

  socket.on('undo', () => {
    const room = socket.data.room; if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== getDrawerId(room)) return;
    const removed = r.strokes.pop();
    io.to(room).emit('undo', { strokeId: removed ? removed.id : null });
  });

  socket.on('requestReplay', () => {
    const room = socket.data.room; if (!room || !rooms[room]) return;
    const r = rooms[room];
    socket.emit('replayData', r.strokes || []);
  });

  socket.on('chat', (text) => {
    const room = socket.data.room; if (!room || !rooms[room]) return;
    const r = rooms[room];
    const player = r.players.find(p => p.id === socket.id);
    if (!player) return;
    const message = String(text).trim();
    if (r.roundActive && r.currentWord && String(message).toLowerCase() === String(r.currentWord).toLowerCase()) {
      const guessPoints = Math.max(10, Math.floor(50 * (r.timeLeft / r.roundTime)));
      player.score += guessPoints;
      const drawer = r.players.find(p => p.id === getDrawerId(room));
      if (drawer) drawer.score += 5;
      io.to(room).emit('systemMessage', `${player.name} guessed correctly! (+${guessPoints})`);
      emitRoomState(room);
      endRound(room, true);
      return;
    }
    io.to(room).emit('chat', { name: player.name, message });
  });

  socket.on('requestLastSavedRound', (cb) => {
    const room = socket.data.room; if (!room) return cb && cb({ ok: false });
    db.get(`SELECT * FROM rounds WHERE room_code = ? ORDER BY id DESC LIMIT 1`, [room], (err, row) => {
      if (err) return cb && cb({ ok: false, error: err.message });
      if (!row) return cb && cb({ ok: false, message: 'no rounds' });
      cb && cb({ ok: true, strokes: JSON.parse(row.strokes_json || '[]'), word: row.word, round_number: row.round_number });
    });
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    const idx = r.players.findIndex(p => p.id === socket.id);
    if (idx !== -1) {
      const removed = r.players.splice(idx, 1)[0];
      io.to(room).emit('systemMessage', `${removed.name} left`);
      if (socket.id === r.hostId) {
        r.hostId = (r.players[0] || {}).id || null;
        io.to(room).emit('systemMessage', `Host left — new host assigned`);
      }
      if (r.roundActive && socket.id === getDrawerId(room)) endRound(room, false);
      if (r.players.length === 0) {
        if (r.timer) clearInterval(r.timer);
        delete rooms[room];
      } else {
        emitRoomState(room);
      }
    }
  });

  socket.on('getLeaderboard', (cb) => {
    db.all("SELECT player_name, score, room_code, created_at FROM leaderboard ORDER BY score DESC LIMIT 50", (err, rows) => {
      if (err) return cb && cb({ ok: false, error: err.message });
      cb && cb({ ok: true, rows });
    });
  });

  // ---- internal helpers ----
  function emitRoomState(room) {
    const r = rooms[room];
    if (!r) return;
    io.to(room).emit('roomState', {
      players: r.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
      hostId: r.hostId,
      drawerId: getDrawerId(room),
      roundActive: r.roundActive,
      roundNumber: r.roundNumber,
      maxRounds: r.maxRounds,
      timeLeft: r.timeLeft,
      roundTime: r.roundTime,
      settings: { language: r.language, category: r.category, customWords: r.customWords || [] }
    });
  }

  function getDrawerId(room) {
    const r = rooms[room];
    if (!r || r.players.length === 0) return null;
    return r.players[r.drawerIndex].id;
  }

  function startRound(room) {
    const r = rooms[room];
    if (!r || r.roundActive || r.players.length === 0) return;
    r.roundNumber++;
    r.candidateWords = pickWordsFromRoom(r, 3);
    r.currentWord = null;
    r.strokes = [];
    io.to(room).emit('roundPrestart', {
      drawerId: getDrawerId(room),
      drawerName: (r.players[r.drawerIndex] || {}).name,
      candidateWords: r.candidateWords,
      roundNumber: r.roundNumber,
      maxRounds: r.maxRounds
    });
    io.to(getDrawerId(room)).emit('chooseWords', r.candidateWords);
    emitRoomState(room);

    setTimeout(() => {
      if (!r.currentWord) {
        const pick = r.candidateWords[Math.floor(Math.random() * r.candidateWords.length)];
        r.currentWord = pick;
        r.roundActive = true;
        r.timeLeft = r.roundTime;
        io.to(getDrawerId(room)).emit('yourWord', pick);
        io.to(room).emit('roundStarted', { drawerId: getDrawerId(room), drawerName: (r.players[r.drawerIndex] || {}).name, roundNumber: r.roundNumber, maxRounds: r.maxRounds, timeLeft: r.timeLeft });
        r.timer = setInterval(() => {
          r.timeLeft--;
          io.to(room).emit('time', r.timeLeft);
          if (r.timeLeft <= 0) endRound(room, false);
        }, 1000);
      }
    }, 30000);
  }

  function endRound(room, revealed = true) {
    const r = rooms[room];
    if (!r) return;
    if (r.timer) { clearInterval(r.timer); r.timer = null; }
    r.roundActive = false;
    io.to(room).emit('roundEnded', { word: r.currentWord, revealed });
    try { persistRound(room, r.roundNumber, r.strokes, r.currentWord, r.language, r.category); } catch(e){ console.error(e); }
    r.drawerIndex = (r.drawerIndex + 1) % Math.max(1, r.players.length);
    if (r.roundNumber < r.maxRounds && r.players.length > 0) {
      setTimeout(() => startRound(room), 3500);
    } else {
      io.to(room).emit('gameOver', { players: r.players.map(p => ({ name: p.name, score: p.score })) });
      saveScoresToDB(room);
      r.players.forEach(p => p.score = 0);
      r.roundNumber = 0;
      r.drawerIndex = 0;
      emitRoomState(room);
    }
  }
});

app.get('/leaderboard', (req, res) => {
  db.all("SELECT player_name, score, room_code, created_at FROM leaderboard ORDER BY score DESC LIMIT 100", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

server.listen(PORT, () => console.log(`Server listening at http://localhost:${PORT}`));