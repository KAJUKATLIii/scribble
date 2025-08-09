// server.js
// Scribble clone server (Express + Socket.IO + file-based persistence)
// Matches package.json dependencies: express, socket.io, uuid

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.use(express.json());

// ----- Simple file-based persistence -----
const DATA_FILE = path.join(__dirname, 'data.json');
let PERSIST = { leaderboards: [], rounds: [] };

function loadPersist() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      PERSIST = JSON.parse(raw || '{}');
      PERSIST.leaderboards = PERSIST.leaderboards || [];
      PERSIST.rounds = PERSIST.rounds || [];
    } else {
      savePersist();
    }
  } catch (e) {
    console.error('Failed to load persisted data:', e);
    PERSIST = { leaderboards: [], rounds: [] };
  }
}
function savePersist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(PERSIST, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save persisted data:', e);
  }
}
loadPersist();

// ----- Word lists (english + hindi) -----
const WORDS = {
  english: {
    objects: ["apple","book","camera","chair","umbrella","bottle","phone","clock","guitar","car","lamp","shoe","hat","cup","key"],
    animals: ["elephant","tiger","dog","cat","penguin","horse","rabbit","lion","crow","dolphin","bear","fox","panda","whale","owl"],
    food: ["pizza","cake","burger","banana","samosa","noodles","pasta","icecream","sandwich","biryani","salad","sushi","taco","curry","steak"]
  },
  hindi: {
    objects: ["सेब","किताब","कैमरा","कुर्सी","छाता","बोतल","फोन","घड़ी","गिटार","गाड़ी","लैंप","जूता","टोपी","कप","चाबी"],
    animals: ["हाथी","शेर","कुत्ता","बिल्ली","पेंगुइन","घोड़ा","खरगोश","सिंह","कौआ","डॉल्फिन","भालू","लोमड़ी","पांडा","व्हेल","उल्लू"],
    food: ["पिज़्ज़ा","केक","बर्गर","केला","समोसा","नूडल्स","पास्ता","आइसक्रीम","सैंडविच","बिरयानी","सलाद","सुशी","टाको","करी","स्टेक"]
  }
};

// ----- In-memory rooms -----
/*
rooms[roomCode] = {
  code,
  hostId,
  players: [{id, name, score}],
  drawerIndex,
  roundNumber,
  maxRounds,
  roundTime,
  roundActive,
  candidateWords: [],
  currentWord,
  timeLeft,
  timer: IntervalRef,
  strokes: [],
  language,
  category,
  customWords: []
}
*/
const rooms = {};

function makeRoomCode(len = 5) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function pickWords(roomObj, n = 3) {
  const custom = (roomObj.customWords || []).filter(Boolean);
  let pool = [];
  if (custom.length > 0) {
    pool = custom;
  } else {
    const lang = roomObj.language || 'english';
    const cat = roomObj.category || Object.keys(WORDS[lang])[0];
    pool = (WORDS[lang] && WORDS[lang][cat]) ? [...WORDS[lang][cat]] : [].concat(...Object.values(WORDS['english']));
  }
  if (pool.length === 0) pool = [].concat(...Object.values(WORDS['english']));
  const out = [];
  while (out.length < Math.min(n, pool.length)) {
    const w = pool[Math.floor(Math.random() * pool.length)];
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function persistRound(roomCode, roundNumber, strokes, word, language, category) {
  try {
    PERSIST.rounds.push({
      id: uuidv4(),
      roomCode,
      roundNumber,
      strokes: strokes || [],
      word: word || '',
      language: language || '',
      category: category || '',
      createdAt: new Date().toISOString()
    });
    savePersist();
  } catch (e) {
    console.error('persistRound failed', e);
  }
}

function saveScoresToPersist(roomCode) {
  const r = rooms[roomCode];
  if (!r) return;
  const now = new Date().toISOString();
  r.players.forEach(p => {
    PERSIST.leaderboards.push({ id: uuidv4(), roomCode, playerName: p.name, score: p.score, createdAt: now });
  });
  // keep leaderboard size reasonable
  PERSIST.leaderboards = PERSIST.leaderboards.slice(-1000);
  savePersist();
}

// ----- Helper -----
function getDrawerId(room) {
  const r = rooms[room];
  if (!r || r.players.length === 0) return null;
  return r.players[r.drawerIndex].id;
}
function broadcastRoom(room) {
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

// ----- Socket.IO -----
io.on('connection', (socket) => {
  socket.on('createRoom', (opts = {}, cb) => {
    try {
      const { name = 'Player', maxRounds = 8, roundTime = 60, language = 'english', category = 'objects', customWords = '' } = opts;
      const code = makeRoomCode(5);
      const r = {
        code,
        hostId: socket.id,
        players: [{ id: socket.id, name: String(name).slice(0, 24), score: 0 }],
        drawerIndex: 0,
        roundNumber: 0,
        maxRounds: Number(maxRounds) || 8,
        roundTime: Number(roundTime) || 60,
        roundActive: false,
        candidateWords: [],
        currentWord: null,
        timeLeft: 0,
        timer: null,
        strokes: [],
        language: (language in WORDS) ? language : 'english',
        category: category,
        customWords: Array.isArray(customWords) ? customWords : String(customWords || '').split(',').map(s => s.trim()).filter(Boolean)
      };
      rooms[code] = r;
      socket.join(code);
      socket.data.room = code;
      broadcastRoom(code);
      socket.emit('systemMessage', `Room ${code} created`);
      cb && cb({ ok: true, room: code });
    } catch (e) {
      console.error(e);
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('joinRoom', ({ name = 'Player', room } = {}, cb) => {
    try {
      if (!room) return cb && cb({ ok: false, error: 'no room' });
      room = String(room || '').toUpperCase();
      if (!rooms[room]) return cb && cb({ ok: false, error: 'Room not found' });
      const r = rooms[room];
      socket.join(room);
      socket.data.room = room;
      r.players.push({ id: socket.id, name: String(name).slice(0, 24), score: 0 });
      broadcastRoom(room);
      io.to(room).emit('systemMessage', `${name} joined the room`);
      cb && cb({ ok: true, room });
    } catch (e) {
      console.error(e);
      cb && cb({ ok: false, error: e.message });
    }
  });

  socket.on('setCustomWords', (wordsText, cb) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return cb && cb({ ok: false, error: 'no room' });
    const r = rooms[room];
    if (socket.id !== r.hostId) return cb && cb({ ok: false, error: 'not host' });
    const arr = String(wordsText || '').split(',').map(s => s.trim()).filter(Boolean);
    r.customWords = arr;
    broadcastRoom(room);
    io.to(room).emit('systemMessage', 'Host updated custom words');
    cb && cb({ ok: true });
  });

  socket.on('updateSettings', (settings = {}) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== r.hostId) return;
    if (settings.roundTime) r.roundTime = Number(settings.roundTime);
    if (settings.maxRounds) r.maxRounds = Number(settings.maxRounds);
    if (settings.language && WORDS[settings.language]) r.language = settings.language;
    if (settings.category && WORDS[r.language] && WORDS[r.language][settings.category]) r.category = settings.category;
    broadcastRoom(room);
    io.to(room).emit('systemMessage', 'Host updated settings');
  });

  socket.on('kickPlayer', ({ playerId } = {}) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== r.hostId) return;
    const idx = r.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    const removed = r.players.splice(idx, 1)[0];
    io.to(room).emit('systemMessage', `${removed.name} was kicked`);
    io.to(playerId).emit('kicked', { reason: 'Kicked by host' });
    // if kicked was drawer, end round
    if (r.roundActive && playerId === getDrawerId(room)) {
      endRound(room, false);
    }
    if (r.drawerIndex >= r.players.length) r.drawerIndex = 0;
    broadcastRoom(room);
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
    if (r.timer) { clearInterval(r.timer); r.timer = null; r.roundActive = false; io.to(room).emit('systemMessage','Game paused by host'); broadcastRoom(room); }
  });

  socket.on('chooseWord', ({ word } = {}) => {
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
    io.to(room).emit('roundStarted', { drawerId: getDrawerId(room), drawerName: r.players[r.drawerIndex]?.name, roundNumber: r.roundNumber, maxRounds: r.maxRounds, timeLeft: r.timeLeft });
    r.timer = setInterval(() => {
      r.timeLeft--;
      io.to(room).emit('time', r.timeLeft);
      if (r.timeLeft <= 0) endRound(room, false);
    }, 1000);
  });

  socket.on('stroke', (stroke) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (!r.roundActive) return;
    if (socket.id !== getDrawerId(room)) return;
    r.strokes.push(stroke);
    socket.to(room).emit('stroke', stroke);
  });

  socket.on('undo', () => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    if (socket.id !== getDrawerId(room)) return;
    const removed = r.strokes.pop();
    io.to(room).emit('undo', { strokeId: removed ? removed.id : null });
  });

  socket.on('requestReplay', () => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    socket.emit('replayData', r.strokes || []);
  });

  socket.on('chat', (text) => {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    const r = rooms[room];
    const player = r.players.find(p => p.id === socket.id);
    if (!player) return;
    const message = String(text).trim();
    // check correct guess
    if (r.roundActive && r.currentWord && String(message).toLowerCase() === String(r.currentWord).toLowerCase()) {
      const guessPoints = Math.max(10, Math.floor(50 * (r.timeLeft / r.roundTime)));
      player.score += guessPoints;
      const drawer = r.players.find(p => p.id === getDrawerId(room));
      if (drawer) drawer.score += 5;
      io.to(room).emit('systemMessage', `${player.name} guessed correctly! (+${guessPoints})`);
      broadcastRoom(room);
      endRound(room, true);
      return;
    }
    io.to(room).emit('chat', { name: player.name, message });
  });

  socket.on('requestLastSavedRound', (cb) => {
    const room = socket.data.room;
    if (!room) return cb && cb({ ok: false });
    // find last persisted round for this room
    const last = PERSIST.rounds.filter(r => r.roomCode === room).slice(-1)[0];
    if (!last) return cb && cb({ ok: false, message: 'no rounds' });
    cb && cb({ ok: true, strokes: last.strokes, word: last.word, round_number: last.roundNumber });
  });

  socket.on('getLeaderboard', (cb) => {
    const top = (PERSIST.leaderboards || []).slice(-100).reverse();
    cb && cb({ ok: true, rows: top });
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
        r.hostId = r.players[0]?.id || null;
        io.to(room).emit('systemMessage', 'Host left — new host assigned');
      }
      if (r.roundActive && socket.id === getDrawerId(room)) endRound(room, false);
      if (r.players.length === 0) {
        if (r.timer) clearInterval(r.timer);
        delete rooms[room];
      } else {
        broadcastRoom(room);
      }
    }
  });
});

// ----- Game round flow helpers -----
function startRound(room) {
  const r = rooms[room];
  if (!r || r.roundActive || r.players.length === 0) return;
  r.roundNumber++;
  r.candidateWords = pickWords(r, 3);
  r.currentWord = null;
  r.strokes = [];
  io.to(room).emit('roundPrestart', {
    drawerId: getDrawerId(room),
    drawerName: r.players[r.drawerIndex]?.name,
    candidateWords: r.candidateWords,
    roundNumber: r.roundNumber,
    maxRounds: r.maxRounds
  });
  io.to(getDrawerId(room)).emit('chooseWords', r.candidateWords);
  broadcastRoom(room);

  // If drawer doesn't choose in 30 seconds we auto-pick on server-side as well,
  // but clients also have their auto-pick. We will wait 30s then auto-pick here if still no word.
  r.autoPickTimeout && clearTimeout(r.autoPickTimeout);
  r.autoPickTimeout = setTimeout(() => {
    if (!r.currentWord) {
      const pick = r.candidateWords[Math.floor(Math.random() * r.candidateWords.length)];
      r.currentWord = pick;
      r.roundActive = true;
      r.timeLeft = r.roundTime;
      io.to(getDrawerId(room)).emit('yourWord', pick);
      io.to(room).emit('systemMessage', 'Auto-picked a word. Round started.');
      io.to(room).emit('roundStarted', { drawerId: getDrawerId(room), drawerName: r.players[r.drawerIndex]?.name, roundNumber: r.roundNumber, maxRounds: r.maxRounds, timeLeft: r.timeLeft });
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
  if (r.autoPickTimeout) { clearTimeout(r.autoPickTimeout); r.autoPickTimeout = null; }
  r.roundActive = false;
  io.to(room).emit('roundEnded', { word: r.currentWord, revealed });
  try {
    persistRound(room, r.roundNumber, r.strokes, r.currentWord, r.language, r.category);
  } catch (e) {
    console.error('persistRound error', e);
  }
  r.drawerIndex = (r.drawerIndex + 1) % Math.max(1, r.players.length);
  if (r.roundNumber < r.maxRounds && r.players.length > 0) {
    setTimeout(() => startRound(room), 3500);
  } else {
    io.to(room).emit('gameOver', { players: r.players.map(p => ({ name: p.name, score: p.score })) });
    saveScoresToPersist(room);
    // reset scores (or keep — here we reset)
    r.players.forEach(p => p.score = 0);
    r.roundNumber = 0;
    r.drawerIndex = 0;
    broadcastRoom(room);
  }
}

// ----- HTTP endpoints for leaderboards -----
app.get('/leaderboard', (req, res) => {
  const rows = (PERSIST.leaderboards || []).slice(-100).reverse();
  res.json(rows);
});

// ----- Start -----
server.listen(PORT, () => console.log(`Server listening at http://localhost:${PORT}`));

// graceful shutdown save
process.on('SIGINT', () => {
  console.log('SIGINT - saving data and exiting');
  savePersist();
  process.exit();
});
process.on('SIGTERM', () => {
  console.log('SIGTERM - saving data and exiting');
  savePersist();
  process.exit();
});
