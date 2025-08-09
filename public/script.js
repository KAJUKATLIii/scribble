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
  currentStroke = { 
    id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), 
    points: [{x,y}], 
    color: isEraser ? '#ffffff' : '#000000', // Force black
    size: brushSize 
  };
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
  socket.emit('stroke', {
    ...currentStroke,
    color: currentStroke.color // Always black or white
  });
  currentStroke = null;
  isDrawing = false;
  redrawAll();
});

// === Incoming strokes ===
socket.on('stroke', (stroke) => {
  // Force color to black or white for all incoming strokes
  stroke.color = stroke.color === '#ffffff' ? '#ffffff' : '#000000';
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

// Toolbar
brushRange.addEventListener('input', () => brushSize = Number(brushRange.value));
eraserBtn.addEventListener('click', () => { isEraser = true; });

// The rest of your original game logic remains the same...
