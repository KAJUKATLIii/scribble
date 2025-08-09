const socket = io();

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
const timeSpan = document.getElementById("time");
const langCat = document.getElementById("langCat");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const leaveBtn = document.getElementById("leaveBtn");

const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatLog = document.getElementById("chatLog");

const brushRange = document.getElementById("brushRange");
const colorPicker = document.getElementById("colorPicker");
const eraserBtn = document.getElementById("eraserBtn");
const undoBtn = document.getElementById("undoBtn");

const wordBox = document.getElementById("wordBox");

const chooseModal = document.getElementById("chooseModal");
const candidateList = document.getElementById("candidateList");
const modalOverlay = document.getElementById("modalOverlay");

// Drawing setup
const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d");

let drawing = false;
let currentStroke = [];
let strokes = [];
let isEraser = false;

let roomState = null;
let isHost = false;
let isDrawer = false;

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  redraw();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
}

function startDrawing(e) {
  if (!isDrawer) return;
  drawing = true;
  currentStroke = {
    color: isEraser ? "#FFFFFF" : colorPicker.value,
    width: brushRange.value,
    points: []
  };
  addPoint(e);
}

function addPoint(e) {
  if (!drawing) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke.points.push({ x, y });
  redraw();
  // Draw current stroke segment
  ctx.strokeStyle = currentStroke.color;
  ctx.lineWidth = currentStroke.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const points = currentStroke.points;
  if (points.length > 1) {
    ctx.moveTo(points[points.length - 2].x, points[points.length - 2].y);
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }
}

function stopDrawing() {
  if (!drawing) return;
  drawing = false;
  if (currentStroke.points.length > 0) {
    strokes.push(currentStroke);
    socket.emit("stroke", currentStroke);
  }
  currentStroke = [];
}

canvas.addEventListener("mousedown", startDrawing);
canvas.addEventListener("mousemove", addPoint);
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mouseleave", stopDrawing);

canvas.addEventListener("touchstart", e => {
  e.preventDefault();
  startDrawing(e.touches[0]);
});
canvas.addEventListener("touchmove", e => {
  e.preventDefault();
  addPoint(e.touches[0]);
});
canvas.addEventListener("touchend", e => {
  e.preventDefault();
  stopDrawing();
});

// Button events

createRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) {
    alert("Please enter your name");
    return;
  }
  socket.emit("createRoom", { name }, response => {
    if (response.ok) {
      enterGameScreen(response.room);
    } else {
      alert(response.error || "Failed to create room");
    }
  });
};

joinRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  const room = roomCodeInput.value.trim().toUpperCase();
  if (!name || !room) {
    alert("Please enter your name and room code");
    return;
  }
  socket.emit("joinRoom", { name, room }, response => {
    if (response.ok) {
      enterGameScreen(response.room);
    } else {
      alert(response.error || "Failed to join room");
    }
  });
};

startBtn.onclick = () => {
  socket.emit("startGame");
};

pauseBtn.onclick = () => {
  // Pause not implemented on server yet
  alert("Pause functionality not implemented yet.");
};

leaveBtn.onclick = () => {
  location.reload();
};

undoBtn.onclick = () => {
  if (isDrawer) {
    socket.emit("undo");
  }
};

eraserBtn.onclick = () => {
  isEraser = !isEraser;
  eraserBtn.textContent = isEraser ? "Brush" : "Eraser";
};

// Chat form
chatForm.addEventListener("submit", e => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chat", msg);
  chatInput.value = "";
});

// Socket event handlers

socket.on("roomState", state => {
  roomState = state;
  updateUI();
});

socket.on("roundPrestart", data => {
  showChooseModal(data.candidateWords);
});

socket.on("yourWord", word => {
  wordBox.textContent = word;
  hideChooseModal();
});

socket.on("roundStarted", data => {
  wordBox.textContent = "Drawing now...";
  strokes = [];
  redraw();
});

socket.on("chat", ({ name, message }) => {
  addChatMessage(`${name}: ${message}`, "user");
});

socket.on("systemMessage", msg => {
  addChatMessage(`* ${msg}`, "system");
});

socket.on("stroke", stroke => {
  strokes.push(stroke);
  redraw();
});

socket.on("undo", () => {
  if (strokes.length > 0) {
    strokes.pop();
    redraw();
  }
});

socket.on("time", seconds => {
  timeSpan.textContent = seconds;
});

socket.on("gameOver", data => {
  alert("Game over!");
  // Optionally reset or show scores
});

socket.on("kicked", data => {
  alert(data.reason);
  location.reload();
});

socket.on("replayData", data => {
  // For simplicity, clear canvas and redraw all strokes with animation
  strokes = [];
  redraw();

  let i = 0;
  const interval = setInterval(() => {
    if (i >= data.length) {
      clearInterval(interval);
      return;
    }
    strokes.push(data[i]);
    redraw();
    i++;
  }, 100);
});

// UI updates

function updateUI() {
  if (!roomState) return;

  roomLabel.textContent = roomState.roomCode;
  roundInfo.textContent = `${roomState.roundNumber}/${roomState.maxRounds}`;
  timeSpan.textContent = roomState.timeLeft;
  langCat.textContent = `${roomState.settings.language} / ${roomState.settings.category}`;

  isHost = socket.id === roomState.hostId;
  isDrawer = socket.id === roomState.drawerId;

  hostHint.textContent = isHost ? "(You are the host)" : "";
  startBtn.style.display = isHost ? "inline-block" : "none";

  // Show word to drawer or placeholder to others
  if (isDrawer) {
    wordBox.textContent = roomState.currentWord || "Choose a word...";
  } else {
    wordBox.textContent = "Waiting for drawer...";
  }

  // Update players list
  playersList.innerHTML = "";
  for (const player of roomState.players) {
    const li = document.createElement("li");
    li.textContent = `${player.name} (${player.score})`;
    if (player.guessed) li.style.textDecoration = "line-through";
    playersList.appendChild(li);
  }
}

// Word choosing modal

function showChooseModal(words) {
  candidateList.innerHTML = "";
  words.forEach(w => {
    const btn = document.createElement("button");
    btn.textContent = w;
    btn.className = "candidateWordBtn";
    btn.onclick = () => {
      socket.emit("chooseWord", { word: w });
      hideChooseModal();
    };
    candidateList.appendChild(btn);
  });
  chooseModal.classList.remove("hidden");
  modalOverlay.classList.remove("hidden");
}

function hideChooseModal() {
  chooseModal.classList.add("hidden");
  modalOverlay.classList.add("hidden");
}

// Enter game screen

function enterGameScreen(room) {
  loginScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  roomLabel.textContent = room;
  wordBox.textContent = "Waiting...";
  strokes = [];
  redraw();
}
