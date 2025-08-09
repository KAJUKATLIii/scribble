const socket = io();

// --- elements ---
const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const nameInput = document.getElementById('nameInput');

const roomLabel = document.getElementById('roomLabel');
const playersList = document.getElementById('playersList');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const settingsBtn = document.getElementById('settingsBtn');
const leaveBtn = document.getElementById('leaveBtn');

const settingsModal = document.getElementById('settingsModal');
const setRoundTime = document.getElementById('setRoundTime');
const setMaxRounds = document.getElementById('setMaxRounds');
const setLanguage = document.getElementById('setLanguage');
const setCategory = document.getElementById('setCategory');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const customWordsTextarea = document.getElementById('customWords');

const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const brushRange = document.getElementById('brushRange');
const colorPicker = document.getElementById('colorPicker');
const eraserBtn = document.getElementById('eraserBtn');
const penBtn = document.getElementById('penBtn');
const undoBtn = document.getElementById('undoBtn');
const wordBox = document.getElementById('wordBox');
const replayBtn = document.getElementById('replayBtn');
const loadLastSavedBtn = document.getElementById('loadLastSavedBtn');

const chooseModal = document.getElementById('chooseModal');
const candidateList = document.getElementById('candidateList');

let myId = null;
let myName = null;
let currentRoom = null;
let hostId = null;
let drawerId = null;
let myWord = null;

let localStrokes = [];
let isDrawing = false;
let currentStroke = null;
let brushSize = 4;
let isEraser = false;
let currentColor = '#000000';

// Canvas resize
function resizeCanvas() {
  const wrap = document.querySelector('.canvasWrap');
  canvas.width = Math.max(300, wrap.clientWidth - 32);
  canvas.height = Math.max(300, wrap.clientHeight - 32);
  redrawAll();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawStrokeOnCtx(stroke) {
  if (!stroke?.points?.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.beginPath();
  const pts = stroke.points;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const midX = (pts[i - 1].x + pts[i].x) / 2;
    const midY = (pts[i - 1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, midX, midY);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
  ctx.closePath();
}

function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of localStrokes) drawStrokeOnCtx(s);
}

// Drawing events
canvas.addEventListener('pointerdown', (e) => {
  if (drawerId !== myId) return;
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke = {
    id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    points: [{ x, y }],
    color: currentColor,
    size: brushSize
  };
});
canvas.addEventListener('pointermove', (e) => {
  if (!isDrawing || !currentStroke) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke.points.push({ x, y });
  redrawAll();
  drawStrokeOnCtx(currentStroke);
});
window.addEventListener('pointerup', () => {
  if (!isDrawing || !currentStroke) return;
  localStrokes.push(currentStroke);
  socket.emit('stroke', currentStroke);
  currentStroke = null;
  isDrawing = false;
  redrawAll();
});

// Incoming strokes
socket.on('stroke', (stroke) => {
  localStrokes.push(stroke);
  drawStrokeOnCtx(stroke);
});

// Undo
undoBtn.addEventListener('click', () => {
  if (drawerId !== myId) return;
  socket.emit('undo');
  localStrokes.pop();
  redrawAll();
});
socket.on('undo', () => socket.emit('requestReplay'));

// Replay
replayBtn.addEventListener('click', () => socket.emit('requestReplay'));
socket.on('replayData', (strokes) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let i = 0;
  function step() {
    if (i >= strokes.length) return;
    drawStrokeOnCtx(strokes[i]);
    i++;
    setTimeout(step, 200);
  }
  step();
});

// Toolbar
brushRange.addEventListener('input', () => brushSize = Number(brushRange.value));

penBtn.addEventListener('click', () => {
  isEraser = false;
  currentColor = colorPicker.value;
});
colorPicker.addEventListener('input', () => {
  if (!isEraser) {
    currentColor = colorPicker.value;
  }
});
eraserBtn.addEventListener('click', () => {
  isEraser = true;
  currentColor = '#ffffff';
});

// Word choice modal for drawer
socket.on('roundPrestart', ({ drawerId: dId, drawerName, candidateWords }) => {
  drawerId = dId;
  if (drawerId === myId) {
    candidateList.innerHTML = '';
    candidateWords.forEach(word => {
      const btn = document.createElement('button');
      btn.textContent = word;
      btn.className = 'candidate-word-btn';
      btn.addEventListener('click', () => {
        socket.emit('chooseWord', { word });
        chooseModal.style.display = 'none';
      });
      candidateList.appendChild(btn);
    });
    chooseModal.style.display = 'block';
  } else {
    chooseModal.style.display = 'none';
  }
});

// Chat
socket.on('chat', ({ name, message }) => {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('chat-message');
  msgDiv.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(message)}`;
  chatLog.appendChild(msgDiv);
  chatLog.scrollTop = chatLog.scrollHeight;
});
socket.on('systemMessage', (msg) => {
  const sysDiv = document.createElement('div');
  sysDiv.classList.add('system-message');
  sysDiv.textContent = msg;
  chatLog.appendChild(sysDiv);
  chatLog.scrollTop = chatLog.scrollHeight;
});
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  socket.emit('chat', message);
  chatInput.value = '';
});
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

// Room state update & player list
socket.on('roomState', (room) => {
  currentRoom = room;
  hostId = room.hostId;
  drawerId = room.drawerId;
  roomLabel.textContent = `Room: ${room.roomCode || ''} (Round ${room.roundNumber}/${room.maxRounds})`;

  playersList.innerHTML = '';
  room.players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} - Score: ${p.score} ${p.guessed ? '(Guessed)' : ''} ${p.id === hostId ? '[Host]' : ''} ${p.id === drawerId ? '[Drawer]' : ''}`;
    playersList.appendChild(li);
  });

  startBtn.style.display = (myId === hostId) ? 'inline-block' : 'none';
  pauseBtn.style.display = (myId === hostId) ? 'inline-block' : 'none';

  if (myId === drawerId) {
    wordBox.textContent = myWord ? `Your word: ${myWord}` : "Your turn to draw! Waiting to pick word...";
  } else {
    wordBox.textContent = "";
  }
});

// Receiving your word
socket.on('yourWord', (word) => {
  myWord = word;
  if (drawerId === myId) {
    wordBox.textContent = `Your word: ${word}`;
    chooseModal.style.display = 'none';
  }
});

// Start and pause buttons
startBtn.addEventListener('click', () => {
  if (myId !== hostId) return alert('Only host can start the game');
  socket.emit('startGame');
});
pauseBtn.addEventListener('click', () => {
  alert('Pause not implemented yet');
});

// Login
createRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) return alert('Enter your name');
  socket.emit('createRoom', { name, roundTime: 60, maxRounds: 8 }, (resp) => {
    if (resp.ok) {
      myId = socket.id;
      myName = name;
      loginScreen.style.display = 'none';
      gameScreen.style.display = 'block';
    } else {
      alert(resp.error || 'Error creating room');
    }
  });
});
joinRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const room = roomCodeInput.value.trim().toUpperCase();
  if (!name || !room) return alert('Enter room code and name');
  socket.emit('joinRoom', { name, room }, (resp) => {
    if (resp.ok) {
      myId = socket.id;
      myName = name;
      loginScreen.style.display = 'none';
      gameScreen.style.display = 'block';
    } else {
      alert(resp.error || 'Error joining room');
    }
  });
});

// Leave button reloads page for now
leaveBtn.addEventListener('click', () => window.location.reload());

// Replay last saved drawing
loadLastSavedBtn.addEventListener('click', () => {
  localStrokes = JSON.parse(localStorage.getItem('lastDrawing') || '[]');
  redrawAll();
});

// Save drawing to localStorage periodically
setInterval(() => {
  if (localStrokes.length > 0) {
    localStorage.setItem('lastDrawing', JSON.stringify(localStrokes));
  }
}, 10000);
