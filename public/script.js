const socket = io();

// Elements
const loginScreen = document.getElementById('loginScreen');
const gameScreen = document.getElementById('gameScreen');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const nameInput = document.getElementById('nameInput');

const roomLabel = document.getElementById('roomLabel');
const hostHint = document.getElementById('hostHint');
const playersList = document.getElementById('playersList');
const roundInfo = document.getElementById('roundInfo');
const timeDisplay = document.getElementById('time');
const langCatDisplay = document.getElementById('langCat');

const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const leaveBtn = document.getElementById('leaveBtn');
const settingsBtn = document.getElementById('settingsBtn');

const settingsModal = document.getElementById('settingsModal');
const setRoundTime = document.getElementById('setRoundTime');
const setMaxRounds = document.getElementById('setMaxRounds');
const setLanguage = document.getElementById('setLanguage');
const setCategory = document.getElementById('setCategory');
const customWordsTextarea = document.getElementById('customWords');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');

const chooseModal = document.getElementById('chooseModal');
const candidateList = document.getElementById('candidateList');

const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');

const brushRange = document.getElementById('brushRange');
const colorPicker = document.getElementById('colorPicker');
const eraserBtn = document.getElementById('eraserBtn');
const undoBtn = document.getElementById('undoBtn');

const wordBox = document.getElementById('wordBox');
const replayBtn = document.getElementById('replayBtn');
const loadLastSavedBtn = document.getElementById('loadLastSavedBtn');

let myId = null;
let myName = null;
let currentRoom = null;
let hostId = null;
let drawerId = null;
let myWord = null;

let localStrokes = [];
let isDrawing = false;
let currentStroke = null;
let brushSize = Number(brushRange.value) || 4;
let isEraser = false;
let currentColor = colorPicker.value || '#000000';

// Resize canvas
function resizeCanvas() {
  const wrap = document.querySelector('.canvasWrap');
  canvas.width = Math.max(300, wrap.clientWidth - 32);
  canvas.height = Math.max(300, wrap.clientHeight - 32);
  redrawAll();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Drawing helpers
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
    const midX = (pts[i-1].x + pts[i].x)/2;
    const midY = (pts[i-1].y + pts[i].y)/2;
    ctx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, midX, midY);
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
canvas.addEventListener('pointerdown', e => {
  if (drawerId !== myId) return;
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke = {
    id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    points: [{x,y}],
    color: currentColor,
    size: brushSize
  };
});

canvas.addEventListener('pointermove', e => {
  if (!isDrawing || !currentStroke) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke.points.push({x,y});
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

// Toolbar controls
brushRange.addEventListener('input', () => brushSize = Number(brushRange.value));
colorPicker.addEventListener('input', () => {
  if (!isEraser) currentColor = colorPicker.value;
});
eraserBtn.addEventListener('click', () => {
  isEraser = !isEraser;
  if (isEraser) {
    currentColor = '#fff';
    eraserBtn.style.background = '#ccc';
  } else {
    currentColor = colorPicker.value;
    eraserBtn.style.background = '';
  }
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
      btn.onclick = () => {
        socket.emit('chooseWord', { word });
        chooseModal.classList.add('hidden');
      };
      candidateList.appendChild(btn);
    });
    chooseModal.classList.remove('hidden');
  } else {
    chooseModal.classList.add('hidden');
  }
});

// Receive your chosen word
socket.on('yourWord', word => {
  myWord = word;
  if (drawerId === myId) {
    wordBox.textContent = `Your word: ${word}`;
    chooseModal.classList.add('hidden');
  }
});

// Chat
socket.on('chat', ({ name, message }) => {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(message)}`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
});
socket.on('systemMessage', msg => {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = msg;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
});
chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat', msg);
  chatInput.value = '';
});

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

// Room state update + player list + UI
socket.on('roomState', room => {
  currentRoom = room;
  hostId = room.hostId;
  drawerId = room.drawerId;

  roomLabel.textContent = room.roomCode || '—';
  hostHint.textContent = (myId === hostId) ? '(You are Host)' : '';
  roundInfo.textContent = `${room.roundNumber}/${room.maxRounds}`;
  timeDisplay.textContent = room.timeLeft || 0;
  langCatDisplay.textContent = `${room.settings.language} / ${room.settings.category}`;

  // Update players list
  playersList.innerHTML = '';
  room.players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} - Score: ${p.score} ${p.guessed ? '(Guessed)' : ''} ${p.id === hostId ? '[Host]' : ''} ${p.id === drawerId ? '[Drawer]' : ''}`;
    playersList.appendChild(li);
  });

  startBtn.style.display = (myId === hostId) ? 'inline-block' : 'none';
  pauseBtn.style.display = (myId === hostId) ? 'inline-block' : 'none';

  // Show word if drawer
  if (drawerId === myId) {
    wordBox.textContent = myWord ? `Your word: ${myWord}` : 'Pick a word to draw...';
  } else {
    wordBox.textContent = '';
  }
});

// Start/pause buttons
startBtn.onclick = () => {
  if (myId !== hostId) return alert('Only host can start the game');
  socket.emit('startGame');
};

pauseBtn.onclick = () => {
  alert('Pause functionality not implemented yet.');
};

// Login logic
createRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return alert('Enter your name');
  socket.emit('createRoom', { name, roundTime: 60, maxRounds: 8 }, resp => {
    if (resp.ok) {
      myId = socket.id;
      myName = name;
      loginScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
    } else {
      alert(resp.error || 'Failed to create room');
    }
  });
};
joinRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  const room = roomCodeInput.value.trim().toUpperCase();
  if (!name || !room) return alert('Enter room code and name');
  socket.emit('joinRoom', { name, room }, resp => {
    if (resp.ok) {
      myId = socket.id;
      myName = name;
      loginScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
    } else {
      alert(resp.error || 'Failed to join room');
    }
  });
};

// Leave button reloads page for now
leaveBtn.onclick = () => location.reload();

// Settings modal
settingsBtn.onclick = () => {
  if (!currentRoom || myId !== hostId) return;
  setRoundTime.value = currentRoom.settings.roundTime || 60;
  setMaxRounds.value = currentRoom.settings.maxRounds || 8;
  setLanguage.value = currentRoom.settings.language || 'english';
  setCategory.value = currentRoom.settings.category || 'objects';
  customWordsTextarea.value = (currentRoom.settings.customWords || []).join(', ');
  settingsModal.classList.remove('hidden');
};

cancelSettingsBtn.onclick = () => settingsModal.classList.add('hidden');

saveSettingsBtn.onclick = () => {
  // For now, just close modal - you can emit settings to server if needed
  settingsModal.classList.add('hidden');
  alert('Settings save not implemented on server.');
};

// Load last saved drawing
loadLastSavedBtn.onclick = () => {
  const saved = localStorage.getItem('lastDrawing');
  if (!saved) return alert('No saved drawing found');
  localStrokes = JSON.parse(saved);
  redrawAll();
};

// Save drawing every 10s
setInterval(() => {
  if (localStrokes.length > 0) {
    localStorage.setItem('lastDrawing', JSON.stringify(localStrokes));
  }
}, 10000);
