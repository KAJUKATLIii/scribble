// === FIXED script.js ===
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
let brushColor = '#000';
let isEraser = false;

// === Canvas Resize ===
function resizeCanvas(){
  const wrap = document.querySelector('.canvasWrap');
  canvas.width = Math.max(300, wrap.clientWidth - 32);
  canvas.height = Math.max(300, wrap.clientHeight - 32);
  redrawAll();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawStrokeOnCtx(stroke){
  if(!stroke?.points?.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.beginPath();
  const pts = stroke.points;
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=1;i<pts.length;i++){
    const midX = (pts[i-1].x + pts[i].x)/2;
    const midY = (pts[i-1].y + pts[i].y)/2;
    ctx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, midX, midY);
  }
  ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
  ctx.stroke();
  ctx.closePath();
}

function redrawAll(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const s of localStrokes) drawStrokeOnCtx(s);
}

// === Drawing Events ===
canvas.addEventListener('pointerdown', (e)=>{
  if(drawerId !== myId) return;
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke = { id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), points: [{x,y}], color: isEraser ? '#ffffff' : brushColor, size: brushSize };
});
canvas.addEventListener('pointermove', (e)=>{
  if(!isDrawing || !currentStroke) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke.points.push({ x, y });
  redrawAll();
  drawStrokeOnCtx(currentStroke);
});
window.addEventListener('pointerup', ()=>{
  if(!isDrawing || !currentStroke) return;
  localStrokes.push(currentStroke);
  socket.emit('stroke', currentStroke);
  currentStroke = null;
  isDrawing = false;
  redrawAll();
});

// === Incoming strokes ===
socket.on('stroke', (stroke) => {
  localStrokes.push(stroke);
  drawStrokeOnCtx(stroke);
});

// Undo
undoBtn.addEventListener('click', () => {
  if(drawerId !== myId) return;
  socket.emit('undo');
  localStrokes.pop();
  redrawAll();
});
socket.on('undo', () => socket.emit('requestReplay'));

// Replay
replayBtn.addEventListener('click', () => socket.emit('requestReplay'));
socket.on('replayData', (strokes) => {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  let i = 0;
  function step() {
    if (i >= strokes.length) return;
    drawStrokeOnCtx(strokes[i]);
    i++;
    setTimeout(step, 200);
  }
  step();
});

// Load Last Saved Round
loadLastSavedBtn.addEventListener('click', () => {
  if(!currentRoom) return alert('Not in room');
  fetch(`/rounds/${currentRoom}/last`).then(r => r.json()).then(j => {
    if(!j.ok) return alert('No saved round');
    const strokes = j.round.strokes;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let i = 0;
    function step() {
      if(i >= strokes.length) return;
      drawStrokeOnCtx(strokes[i]);
      i++;
      setTimeout(step, 150);
    }
    step();
  }).catch(() => alert('Failed to load'));
});

// Toolbar
brushRange.addEventListener('input', () => brushSize = Number(brushRange.value));
colorPicker.addEventListener('input', () => { brushColor = colorPicker.value; isEraser = false; });
eraserBtn.addEventListener('click', () => { isEraser = true; });

// Enter Room
function enterRoom(room, name) {
  currentRoom = room;
  myName = name;
  roomLabel.textContent = room;
  loginScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

createRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player';
  const custom = customWordsTextarea.value.trim();
  socket.emit('createRoom', { name, maxRounds: 8, roundTime: 60, customWords: custom }, (res) => {
    if (res?.ok) enterRoom(res.room, name);
    else alert('Failed to create');
  });
});
joinRoomBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player';
  const room = roomCodeInput.value.trim().toUpperCase();
  if (!room) return alert('Enter room code');
  socket.emit('joinRoom', { name, room }, (res) => {
    if (res?.ok) enterRoom(res.room, name);
    else alert(res?.error || 'Failed to join');
  });
});

// Chat
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat', text);
  chatInput.value = '';
});
socket.on('chat', (d) => {
  const div = document.createElement('div'); div.classList.add('msg'); div.innerHTML = `<strong>${escapeHtml(d.name)}:</strong> ${escapeHtml(d.message)}`;
  chatLog.appendChild(div); chatLog.scrollTop = chatLog.scrollHeight;
});
socket.on('systemMessage', (msg) => {
  const div = document.createElement('div'); div.classList.add('msg','system'); div.textContent = msg;
  chatLog.appendChild(div); chatLog.scrollTop = chatLog.scrollHeight;
});

// Room State
socket.on('roomState', (state) => {
  playersList.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.score})`;
    if (state.hostId === myId && p.id !== myId) {
      const kb = document.createElement('button'); kb.textContent = 'Kick';
      kb.addEventListener('click', () => socket.emit('kickPlayer', { playerId: p.id }));
      li.appendChild(kb);
    }
    if (state.hostId === p.id) {
      const hostTag = document.createElement('span'); hostTag.textContent = ' (host)'; hostTag.style.fontWeight = '700';
      li.appendChild(hostTag);
    }
    playersList.appendChild(li);
  });
  hostId = state.hostId;
  drawerId = state.drawerId;
  document.getElementById('roundInfo').textContent = `${state.roundNumber || 0}/${state.maxRounds || 0}`;
  document.getElementById('time').textContent = state.timeLeft || 0;
  document.getElementById('langCat').textContent = `${state.settings.language}/${state.settings.category}`;
  if (hostId === myId) {
    settingsBtn.classList.remove('hidden');
    if (state.settings.customWords?.length) {
      customWordsTextarea.value = state.settings.customWords.join(', ');
    }
  } else settingsBtn.classList.add('hidden');
});

// === FIXED: Pick-a-word timeout ===
let chooseWordTimeout;
socket.on('roundPrestart', (info) => {
  drawerId = info.drawerId;
  localStrokes = [];
  redrawAll();
  if (drawerId === myId) {
    candidateList.innerHTML = '';
    info.candidateWords.forEach(w => {
      const btn = document.createElement('button');
      btn.textContent = w;
      btn.addEventListener('click', () => {
        clearTimeout(chooseWordTimeout);
        socket.emit('chooseWord', { word: w });
        chooseModal.classList.add('hidden');
      });
      candidateList.appendChild(btn);
    });
    chooseModal.classList.remove('hidden');
    chooseWordTimeout = setTimeout(() => {
      if (!chooseModal.classList.contains('hidden')) {
        const pick = info.candidateWords[Math.floor(Math.random() * info.candidateWords.length)];
        socket.emit('chooseWord', { word: pick });
        chooseModal.classList.add('hidden');
      }
    }, 30000);
  } else {
    wordBox.textContent = `${info.drawerName} is choosing a word...`;
  }
});
socket.on('roundStarted', (info) => {
  clearTimeout(chooseWordTimeout);
  drawerId = info.drawerId;
  localStrokes = [];
  ctx.clearRect(0,0,canvas.width,canvas.height);
  wordBox.textContent = drawerId === myId ? `You are drawing` : `${info.drawerName} is drawing`;
});

// Other events
socket.on('yourWord', (w) => { myWord = w; wordBox.textContent = `Your word: ${w}`; });
socket.on('time', (t) => { document.getElementById('time').textContent = t; wordBox.textContent = wordBox.textContent.split(' | ')[0] + ` | ${t}s`; });
socket.on('roundEnded', (data) => { wordBox.textContent = `Round ended. Word: ${data.word || '—'}`; myWord = null; });
socket.on('gameOver', (data) => alert('Game over!\n' + data.players.map(p => `${p.name}: ${p.score}`).join('\n')));
socket.on('kicked', ({ reason }) => { alert('You were kicked: ' + (reason || 'by host')); location.reload(); });

// Controls
startBtn.addEventListener('click', () => socket.emit('startGame'));
pauseBtn.addEventListener('click', () => socket.emit('pauseGame'));
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
cancelSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
saveSettingsBtn.addEventListener('click', () => {
  socket.emit('updateSettings', {
    roundTime: Number(setRoundTime.value),
    maxRounds: Number(setMaxRounds.value),
    language: setLanguage.value,
    category: setCategory.value
  });
  socket.emit('setCustomWords', customWordsTextarea.value.trim());
  settingsModal.classList.add('hidden');
});
socket.on('connect', () => { myId = socket.id; });

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
