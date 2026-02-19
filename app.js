// ---------------- DOM ----------------
const boardEl = document.getElementById("board");
const turnLabel = document.getElementById("turnLabel");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const modeBtn = document.getElementById("modeBtn");

const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");

// ---------------- Game Config ----------------
const SIZE = 8;

// board[r][c] = null or { color: "red"|"black", king: boolean }
let board = [];
let turn = "red";
let selected = null;
let legalMoves = [];
let mustContinueChain = false;

// Modes
let mode = "2p"; // "2p" or "ai"
let aiColor = "black";
let aiDifficulty = "hard"; // easy | medium | hard

// Online multiplayer
let online = false;
let roomId = null;
let playerRole = null; // "red" or "black"
let roomRef = null;
let onlineReady = false; // BOTH players joined?

// ---------------- Helpers ----------------

function setMessage(msg) {
  messageEl.textContent = msg || "";
}

function updateTurnLabel() {
  const t = turn === "red" ? "Red" : "Black";

  let m = "2 Player";
  if (online) m = `Online (${playerRole || "?"})`;
  else if (mode === "ai") m = `AI (${aiDifficulty})`;

  turnLabel.textContent = `Turn: ${t} • Mode: ${m}`;
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function getDirections(piece) {
  if (piece.king) return [-1, 1];
  return piece.color === "red" ? [-1] : [1];
}

// ---- IMPORTANT: STRONG NORMALIZER (Fixes blank board) ----
function normalizeBoard(raw) {
  // Always return a full 8x8 array
  const out = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  if (!raw) return out;

  // Firebase may send: array, object, sparse object, etc.
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      let cell = null;

      // array format
      if (Array.isArray(raw)) {
        cell = raw?.[r]?.[c] ?? null;
      } else {
        // object format
        cell = raw?.[r]?.[c] ?? null;
      }

      // If it looks like a piece, keep it. Else null.
      if (cell && typeof cell === "object" && (cell.color === "red" || cell.color === "black")) {
        out[r][c] = {
          color: cell.color,
          king: !!cell.king
        };
      } else {
        out[r][c] = null;
      }
    }
  }

  return out;
}

// Ensure board is safe
function ensureBoardSafe() {
  if (!Array.isArray(board)) board = [];
  if (board.length !== SIZE) board = normalizeBoard(board);

  for (let r = 0; r < SIZE; r++) {
    if (!Array.isArray(board[r]) || board[r].length !== SIZE) {
      board = normalizeBoard(board);
      break;
    }
  }
}

// ---------------- Core ----------------

function initBoard() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  // Black at top
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { color: "black", king: false };
    }
  }

  // Red at bottom
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { color: "red", king: false };
    }
  }

  turn = "red";
  selected = null;
  legalMoves = [];
  mustContinueChain = false;

  ensureBoardSafe();
  updateTurnLabel();
  render();

  // only AI if not online
  maybeAIMove();
}

function getMovesFrom(r, c, includeSimple = true) {
  const p = board[r][c];
  if (!p) return [];

  const dirs = getDirections(p);
  const results = [];

  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const r1 = r + dr;
      const c1 = c + dc;
      const r2 = r + dr * 2;
      const c2 = c + dc * 2;

      // Simple move
      if (includeSimple && inBounds(r1, c1) && board[r1][c1] === null) {
        results.push({ to: { r: r1, c: c1 }, capture: null });
      }

      // Capture
      if (inBounds(r2, c2) && board[r2][c2] === null) {
        if (
          inBounds(r1, c1) &&
          board[r1][c1] &&
          board[r1][c1].color !== p.color
        ) {
          results.push({ to: { r: r2, c: c2 }, capture: { r: r1, c: c1 } });
        }
      }
    }
  }

  return results;
}

function getAllMovesFor(color) {
  ensureBoardSafe();

  const movesByFrom = new Map();
  let anyCapture = false;

  if (color !== "red" && color !== "black") {
    return { hasCapture: false, movesByFrom };
  }

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;

      const moves = getMovesFrom(r, c, true);
      if (moves.some((m) => m.capture)) anyCapture = true;
      movesByFrom.set(`${r},${c}`, moves);
    }
  }

  if (anyCapture) {
    for (const [k, moves] of movesByFrom.entries()) {
      movesByFrom.set(k, moves.filter((m) => m.capture));
    }
  }

  return { hasCapture: anyCapture, movesByFrom };
}

function render() {
  ensureBoardSafe();
  boardEl.innerHTML = "";

  const { hasCapture, movesByFrom } = getAllMovesFor(turn);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const sq = document.createElement("div");
      sq.className = "square " + ((r + c) % 2 === 0 ? "light" : "dark");
      sq.dataset.r = r;
      sq.dataset.c = c;

      // Move hints
      if (selected) {
        const isTarget = legalMoves.some((m) => m.to.r === r && m.to.c === c);
        if (isTarget) {
          const move = legalMoves.find((m) => m.to.r === r && m.to.c === c);
          sq.classList.add(move.capture ? "captureHint" : "hint");
        }
      }

      const p = board[r][c];
      if (p) {
        const piece = document.createElement("div");
        piece.className = `piece ${p.color}`;

        if (selected && selected.r === r && selected.c === c) {
          piece.classList.add("selected");
        }

        if (p.king) {
          const k = document.createElement("div");
          k.className = "king";
          k.textContent = "K";
          piece.appendChild(k);
        }

        // forced capture highlight
        if (!mustContinueChain && hasCapture) {
          const moves = movesByFrom.get(`${r},${c}`) || [];
          if (p.color === turn && moves.some((m) => m.capture)) {
            piece.style.boxShadow =
              "0 0 0 3px rgba(255,183,3,0.65), 0 10px 18px rgba(0,0,0,0.35)";
          }
        }

        sq.appendChild(piece);
      }

      sq.addEventListener("click", onSquareClick);
      boardEl.appendChild(sq);
    }
  }
}

function onSquareClick(e) {
  // Online: block until both players are ready
  if (online && !onlineReady) {
    setMessage("Waiting for player...");
    return;
  }

  // Online: block if not your turn
  if (online && playerRole !== turn) {
    setMessage("Not your turn.");
    return;
  }

  // AI: block if AI turn
  if (!online && mode === "ai" && turn === aiColor) return;

  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  const p = board[r][c];

  // Multi capture chain lock
  if (mustContinueChain && selected) {
    const move = legalMoves.find((m) => m.to.r === r && m.to.c === c);
    if (move) applyMove(selected.r, selected.c, move);
    else setMessage("You must continue capturing.");
    return;
  }

  // Select
  if (p && p.color === turn) {
    selectPiece(r, c);
    return;
  }

  // Move
  if (selected) {
    const move = legalMoves.find((m) => m.to.r === r && m.to.c === c);
    if (move) applyMove(selected.r, selected.c, move);
    else {
      setMessage("");
      selected = null;
      legalMoves = [];
      render();
    }
  }
}

function selectPiece(r, c) {
  const { hasCapture, movesByFrom } = getAllMovesFor(turn);
  const moves = movesByFrom.get(`${r},${c}`) || [];

  if (hasCapture && !moves.some((m) => m.capture)) {
    setMessage("Capture is available — you must capture.");
    return;
  }

  selected = { r, c };
  legalMoves = moves;
  setMessage(moves.length ? "" : "No moves for this piece.");
  render();
}

function applyMove(fr, fc, move) {
  ensureBoardSafe();

  const piece = board[fr][fc];
  if (!piece) return;

  board[fr][fc] = null;

  const tr = move.to.r;
  const tc = move.to.c;
  board[tr][tc] = piece;

  // Capture
  if (move.capture) board[move.capture.r][move.capture.c] = null;

  // Promote
  if (!piece.king) {
    if (piece.color === "red" && tr === 0) piece.king = true;
    if (piece.color === "black" && tr === SIZE - 1) piece.king = true;
  }

  // Multi jump
  if (move.capture) {
    const nextMoves = getMovesFrom(tr, tc, false).filter((m) => m.capture);
    if (nextMoves.length) {
      selected = { r: tr, c: tc };
      legalMoves = nextMoves;
      mustContinueChain = true;
      setMessage("Multi-capture! Continue.");
      render();
      syncOnlineGame();
      return;
    }
  }

  mustContinueChain = false;
  selected = null;
  legalMoves = [];
  turn = turn === "red" ? "black" : "red";
  updateTurnLabel();
  setMessage("");

  const winner = isGameOver(turn) ? (turn === "red" ? "Black" : "Red") : null;
  if (winner) setMessage(`${winner} wins!`);

  render();
  syncOnlineGame();
  maybeAIMove();
}

function isGameOver(colorToPlay) {
  ensureBoardSafe();

  let pieces = 0;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (p && p.color === colorToPlay) pieces++;
    }
  }

  if (pieces === 0) return true;

  const { movesByFrom } = getAllMovesFor(colorToPlay);
  for (const moves of movesByFrom.values()) {
    if (moves.length) return false;
  }

  return true;
}

// ---------------- Online Multiplayer ----------------

function syncOnlineGame() {
  if (!online || !roomId) return;

  ensureBoardSafe();

  const winner = isGameOver(turn) ? (turn === "red" ? "Black" : "Red") : null;

  db.ref("rooms/" + roomId + "/game").set({
    board,
    turn,
    mustContinueChain,
    winner
  });
}

function listenToRoom(id) {
  roomRef = db.ref("rooms/" + id);

  roomRef.on("value", (snap) => {
    const data = snap.val();
    if (!data) return;

    // detect player readiness
    const redIn = !!data.players?.red;
    const blackIn = !!data.players?.black;
    onlineReady = redIn && blackIn;

    // If game doesn't exist yet, show waiting
    if (!data.game) {
      updateTurnLabel();
      setMessage("Waiting for game...");
      return;
    }

    // Fix board safely
    board = normalizeBoard(data.game.board);
    turn = data.game.turn === "black" ? "black" : "red";
    mustContinueChain = !!data.game.mustContinueChain;

    selected = null;
    legalMoves = [];

    updateTurnLabel();

    if (data.game.winner) {
      setMessage(data.game.winner + " wins!");
    } else if (!onlineReady) {
      setMessage("Waiting for player...");
    } else if (playerRole !== turn) {
      setMessage("Opponent's turn...");
    } else {
      setMessage("");
    }

    render();
  });
}

// Create Room
createRoomBtn.addEventListener("click", async () => {
  online = true;
  mode = "2p";
  modeBtn.textContent = "Mode: 2 Player";

  initBoard();

  roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
  playerRole = "red";
  onlineReady = false;

  const ref = db.ref("rooms/" + roomId);

  await ref.set({
    createdAt: Date.now(),
    players: { red: true, black: false },
    game: {
      board,
      turn,
      mustContinueChain: false,
      winner: null
    }
  });

  listenToRoom(roomId);
  updateTurnLabel();

  setMessage("Waiting for player...");
  alert("Room created! Code: " + roomId);
});

// Join Room
joinRoomBtn.addEventListener("click", async () => {
  const code = prompt("Enter room code:");
  if (!code) return;

  online = true;
  mode = "2p";
  modeBtn.textContent = "Mode: 2 Player";

  roomId = code.trim().toUpperCase();
  const ref = db.ref("rooms/" + roomId);

  const snap = await ref.get();
  if (!snap.exists()) {
    alert("Room not found.");
    online = false;
    roomId = null;
    return;
  }

  const data = snap.val();

  if (data.players?.black === false) {
    playerRole = "black";
    await ref.child("players/black").set(true);
  } else {
    alert("Room is full.");
    online = false;
    roomId = null;
    return;
  }

  listenToRoom(roomId);
  updateTurnLabel();
  setMessage("");
});

// ---------------- AI ----------------

function maybeAIMove() {
  if (online) return;
  if (mode !== "ai") return;
  if (turn !== aiColor) return;
  if (isGameOver(turn)) return;

  setTimeout(() => aiMakeMove(), 350);
}

function aiMakeMove() {
  const actions = getAllActionsFor(aiColor);
  if (!actions.length) return;

  let chosen;
  if (aiDifficulty === "easy") {
    chosen = actions[Math.floor(Math.random() * actions.length)];
  } else if (aiDifficulty === "medium") {
    chosen = pickMediumMove(actions);
  } else {
    chosen = pickHardMove(actions);
  }

  applyMove(chosen.from.r, chosen.from.c, chosen.move);
}

function getAllActionsFor(color) {
  const { movesByFrom } = getAllMovesFor(color);
  const actions = [];

  for (const [k, moves] of movesByFrom.entries()) {
    const [r, c] = k.split(",").map(Number);
    for (const m of moves) actions.push({ from: { r, c }, move: m });
  }
  return actions;
}

function pickMediumMove(actions) {
  let best = null;
  let bestScore = -999999;

  for (const a of actions) {
    const score = scoreMove(a);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best || actions[Math.floor(Math.random() * actions.length)];
}

function scoreMove(action) {
  const { from, move } = action;
  const piece = board[from.r][from.c];
  let score = 0;

  if (move.capture) score += 50;

  if (!piece.king) {
    if (piece.color === "black" && move.to.r === SIZE - 1) score += 30;
    if (piece.color === "red" && move.to.r === 0) score += 30;
  }

  return score;
}

// -------- HARD AI (Minimax + alpha-beta) --------

function pickHardMove(actions) {
  const depth = 5;
  let best = null;
  let bestScore = -Infinity;

  for (const a of actions) {
    const snapshot = deepCopy(board);

    simulateMove(a.from, a.move);
    const score = minimax(depth - 1, false, -Infinity, Infinity);

    board = snapshot;

    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best || actions[Math.floor(Math.random() * actions.length)];
}

function minimax(depth, maximizing, alpha, beta) {
  if (depth === 0) return evaluateBoard(aiColor);

  const current = maximizing ? aiColor : (aiColor === "red" ? "black" : "red");
  const actions = getAllActionsFor(current);

  if (!actions.length) return maximizing ? -9999 : 9999;

  if (maximizing) {
    let best = -Infinity;
    for (const a of actions) {
      const snapshot = deepCopy(board);
      simulateMove(a.from, a.move);
      const score = minimax(depth - 1, false, alpha, beta);
      board = snapshot;

      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const a of actions) {
      const snapshot = deepCopy(board);
      simulateMove(a.from, a.move);
      const score = minimax(depth - 1, true, alpha, beta);
      board = snapshot;

      best = Math.min(best, score);
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function simulateMove(from, move) {
  const piece = board[from.r][from.c];
  board[from.r][from.c] = null;
  board[move.to.r][move.to.c] = piece;

  if (move.capture) board[move.capture.r][move.capture.c] = null;

  if (!piece.king) {
    if (piece.color === "red" && move.to.r === 0) piece.king = true;
    if (piece.color === "black" && move.to.r === SIZE - 1) piece.king = true;
  }
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function evaluateBoard(perspectiveColor) {
  let score = 0;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p) continue;

      let val = p.king ? 5 : 3;

      if (c >= 2 && c <= 5) val += 0.3;

      if (!p.king) {
        if (p.color === "black") val += r * 0.15;
        if (p.color === "red") val += (7 - r) * 0.15;
      }

      if (p.color === perspectiveColor) score += val;
      else score -= val;
    }
  }

  return score;
}

// ---------------- UI ----------------

restartBtn.addEventListener("click", () => {
  initBoard();

  if (online && roomId) {
    db.ref("rooms/" + roomId + "/game").set({
      board,
      turn,
      mustContinueChain: false,
      winner: null
    });
  }
});

modeBtn.addEventListener("click", () => {
  if (online) {
    alert("AI is disabled while playing online.");
    return;
  }

  if (mode === "2p") {
    mode = "ai";
    aiDifficulty = "hard";
    modeBtn.textContent = "Mode: AI (Hard)";
  } else {
    mode = "2p";
    modeBtn.textContent = "Mode: 2 Player";
  }

  updateTurnLabel();
  initBoard();
});

// ---------------- Start ----------------
initBoard();
