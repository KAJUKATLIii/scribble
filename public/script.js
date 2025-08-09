const socket = io();

// ==== Elements ====
const loginScreen = document.getElementById("loginScreen");
const gameScreen = document.getElementById("gameScreen");

const nameInput = document.getElementById("nameInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");

const roomLabel = document.getElementById("roomLabel");
const hostHint = document.getElementById("hostHint");
const playersList = document.getElementById("playersList");
const roundInfo = document.getElementById("roundInfo");
const timeDisplay = document.getElementById("time");
const langCat = document.getElementById("langCat");

const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const settingsBtn = document.getElementById("settingsBtn");

const chooseModal = document.getElementById("chooseModal");
const candidateList = document.getElementById("candidateList");
const wordBox = document.getElementById("wordBox");

const colorPicker = document.getElementById("colorPicker");
const eraserBtn = document.getElementById("eraserBtn");
const brushRange = document.getElementById("brushRange");
const undoBtn = document.getElementById("undoBtn");

const drawCanvas = document.getElementById("drawCanvas");
const ctx = drawCanvas.getContext("2d");

let currentRoom = null;
let isHost = false;
let isDrawer = false;
let currentWord = null;
let timerInterval = null;

let brushColor = "#000000";
let brushSize = 4;
let isEraser = false;
let drawing = false;
let lastPos = null;
let strokes = [];

// ==== Resize canvas ====
function resizeCanvas() {
  drawCanvas.width = drawCanvas.clientWidth;
  drawCanvas.height = drawCanvas.clientHeight;
  redraw();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ==== Drawing functions ====
function redraw() {
  ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  for (const s of strokes) {
    drawStroke(s);
  }
}

function drawStroke(stroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.size;
  ctx.strokeStyle = stroke.color;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i++) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  ctx.stroke();
}

function emitStroke(stroke) {
  socket.emit("stroke", stroke);
}

drawCanvas.addEventListener("mousedown", e => {
  if (!isDrawer) return;
  drawing = true;
  lastPos = { x: e.offsetX, y: e.offsetY };
  const newStroke = {
    color: isEraser ? "#FFFFFF" : brushColor,
    size: brushSize,
    points: [lastPos]
  };
  strokes.push(newStroke);
});

drawCanvas.addEventListener("mousemove", e => {
  if (!drawing || !isDrawer) return;
  const currPos = { x: e.offsetX, y: e.offsetY };
  const stroke = strokes[strokes.length - 1];
  stroke.points.push(currPos);
  drawStrokeSegment(stroke.points[stroke.points.length - 2], currPos, stroke.color, stroke.size);
  emitStroke({ color: stroke.color, size: stroke.size, points: [stroke.points[stroke.points.length - 2], currPos] });
  lastPos = currPos;
});

drawCanvas.addEventListener("mouseup", () => {
  drawing = false;
  lastPos = null;
});

drawCanvas.addEventListener("mouseleave", () => {
  drawing = false;
  lastPos = null;
});

function drawStrokeSegment(from, to, color, size) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

// ==== Undo ====
undoBtn.onclick = () => {
  if (!isDrawer) return;
  socket.emit("undo");
};

// Receive undo event
socket.on("undo", () => {
  strokes.pop();
  redraw();
});

// Receive strokes from others
socket.on("stroke", stroke => {
  strokes.push(stroke);
  drawStroke(stroke);
});

// ==== Chat ====
chatForm.onsubmit = e => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chat", msg);
  chatInput.value = "";
};

function addChatMessage(name, message, isSystem = false) {
  const div = document.createElement("div");
  div.className = isSystem ? "chatSystemMsg" : "chatUserMsg";
  div.textContent = isSystem ? message : `${name}: ${message}`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

socket.on("chat", ({ name, message }) => addChatMessage(name, message));
socket.on("systemMessage", msg => addChatMessage(null, msg, true));

// ==== Room state updates ====
socket.on("roomState", state => {
  currentRoom = state.roomCode;
  isHost = socket.id === state.hostId;
  isDrawer = socket.id === state.drawerId;

  roomLabel.textContent = currentRoom;
  hostHint.textContent = isHost ? "(You are host)" : "";

  // Update players list
  playersList.innerHTML = "";
  state.players.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.name} — Score: ${p.score}${p.guessed ? " ✓" : ""}`;
    if (isHost && p.id !== socket.id) {
      const kickBtn = document.createElement("button");
      kickBtn.textContent = "Kick";
      kickBtn.onclick = () => socket.emit("kickPlayer", { playerId: p.id });
      li.appendChild(kickBtn);
    }
    if (p.id === state.drawerId) {
      li.style.fontWeight = "bold";
      li.textContent += " (Drawing)";
    }
    playersList.appendChild(li);
  });

  roundInfo.textContent = `${state.roundNumber}/${state.maxRounds}`;
  langCat.textContent = `${state.settings.language}/${state.settings.category}`;

  startBtn.disabled = !isHost;
});

// ==== Word pick modal ====
socket.on("roundPrestart", ({ drawerId, drawerName, candidateWords }) => {
  isDrawer = socket.id === drawerId;
  wordBox.textContent = "Waiting for word to be picked...";
  currentWord = null;

  if (isDrawer) {
    candidateList.innerHTML = "";
    candidateWords.forEach(word => {
      const btn = document.createElement("button");
      btn.textContent = word;
      btn.className = "candidateWordBtn";
      btn.onclick = () => {
        socket.emit("chooseWord", { word });
        chooseModal.classList.add("hidden");
      };
      candidateList.appendChild(btn);
    });
    chooseModal.classList.remove("hidden");
  } else {
    chooseModal.classList.add("hidden");
  }
});

// ==== Receive your chosen word ====
socket.on("yourWord", word => {
  currentWord = word;
  if (isDrawer) {
    wordBox.textContent = `Your word: ${word}`;
  }
});

// ==== Round started ====
socket.on("roundStarted", ({ drawerId, drawerName }) => {
  isDrawer = socket.id === drawerId;
  if (!isDrawer) {
    wordBox.textContent = "Guess the word!";
  }
  chooseModal.classList.add("hidden");
  clearInterval(timerInterval);
  strokes = [];
  redraw();
});

// ==== Time updates ====
socket.on("time", secondsLeft => {
  timeDisplay.textContent = secondsLeft;
});

// ==== Game over ====
socket.on("gameOver", ({ players }) => {
  let winner = players.reduce((max, p) => (p.score > max.score ? p : max), players[0]);
  alert(`Game Over! Winner is ${winner.name} with ${winner.score} points.`);
});

// ==== Start / Pause Buttons ====
startBtn.onclick = () => {
  socket.emit("startGame");
};

pauseBtn.onclick = () => {
  alert("Pause feature not implemented yet.");
};

// ==== Brush size and color ====
brushRange.oninput = () => {
  brushSize = +brushRange.value;
};

colorPicker.oninput = e => {
  if (!isEraser) brushColor = e.target.value;
};

eraserBtn.onclick = () => {
  isEraser = !isEraser;
  eraserBtn.textContent = isEraser ? "Brush" : "Eraser";
  colorPicker.disabled = isEraser;
};

// ==== Login and room join/create logic ====
createRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) {
    alert("Please enter your name.");
    return;
  }
  socket.emit("createRoom", { name }, response => {
    if (response.ok) {
      loginScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
    } else {
      alert(response.error || "Failed to create room");
    }
  });
};

joinRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  const room = roomCodeInput.value.trim().toUpperCase();
  if (!name || !room) {
    alert("Please enter your name and room code.");
    return;
  }
  socket.emit("joinRoom", { name, room }, response => {
    if (response.ok) {
      loginScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
    } else {
      alert(response.error || "Failed to join room");
    }
  });
};

// ==== Leave button reloads page ====
document.getElementById("leaveBtn").onclick = () => {
  location.reload();
};
