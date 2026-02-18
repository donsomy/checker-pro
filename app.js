// ---------------- DOM Elements ----------------
const boardEl        = document.getElementById("board");
const turnLabel      = document.getElementById("turnLabel");
const messageEl      = document.getElementById("message");
const restartBtn     = document.getElementById("restartBtn");
const modeBtn        = document.getElementById("modeBtn");
const createRoomBtn  = document.getElementById("createRoomBtn");
const joinRoomBtn    = document.getElementById("joinRoomBtn");

// ---------------- Game Constants & State ----------------
const SIZE = 8;

let board = [];
let turn = "red";
let selected = null;
let legalMoves = [];
let mustContinueChain = false;

// Modes
let mode = "2p";           // "2p" or "ai"
let aiColor = "black";
let aiDifficulty = "hard"; // easy | medium | hard

// Online
let online = false;
let roomId = null;
let playerRole = null;     // "red" or "black"
let roomRef = null;
let onlineReady = false;

// ---------------- Helpers ----------------

function setMessage(msg) {
  messageEl.textContent = msg;
}

function updateTurnLabel() {
  const t = turn === "red" ? "Red" : "Black";
  let m = "2 Player Local";
  if (online)      m = `Online (${playerRole || "?"})`;
  else if (mode === "ai") m = `vs AI (${aiDifficulty})`;
  turnLabel.textContent = `Turn: ${t} • ${m}`;
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function getDirections(piece) {
  if (piece.king) return [-1, 1];
  return piece.color === "red" ? [-1] : [1];
}

// Normalize board from Firebase (handles array or object-with-string-keys)
function normalizeBoard(raw) {
  if (!raw) {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  // Already a proper 2D array
  if (Array.isArray(raw) && Array.isArray(raw[0])) {
    return raw.map(row => row.map(cell => cell ? { ...cell } : null));
  }

  // Firebase object style { "0": { "0": {...}, "1": ... }, "1": ... }
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  for (let r = 0; r < SIZE; r++) {
    const rowData = raw[r] ?? raw[String(r)] ?? {};
    for (let c = 0; c < SIZE; c++) {
      const cell = rowData[c] ?? rowData[String(c)];
      board[r][c] = cell ? { ...cell } : null;
    }
  }
  return board;
}

function deepCopyBoard(b) {
  return b.map(row => row.map(cell => cell ? { ...cell } : null));
}

// ---------------- Core Game Logic ----------------

function initBoard() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  // Black pieces – top (rows 0–2)
  for (let r = 0; r < 3; r++) {
    for (let c = (r % 2 === 0 ? 1 : 0); c < SIZE; c += 2) {
      board[r][c] = { color: "black", king: false };
    }
  }

  // Red pieces – bottom (rows 5–7)
  for (let r = 5; r < SIZE; r++) {
    for (let c = (r % 2 === 0 ? 1 : 0); c < SIZE; c += 2) {
      board[r][c] = { color: "red", king: false };
    }
  }

  turn = "red";
  selected = null;
  legalMoves = [];
  mustContinueChain = false;

  updateTurnLabel();
  render();

  if (!online && mode === "ai") maybeAIMove();
}

function getMovesFrom(r, c, includeSimple = true) {
  const piece = board[r][c];
  if (!piece) return [];

  const dirs = getDirections(piece);
  const moves = [];

  for (const dr of dirs) {
    for (const dc of [-1, 1]) {
      const r1 = r + dr;
      const c1 = c + dc;
      const r2 = r + dr * 2;
      const c2 = c + dc * 2;

      // Normal move
      if (includeSimple && inBounds(r1, c1) && !board[r1][c1]) {
        moves.push({ to: { r: r1, c: c1 }, capture: null });
      }

      // Capture
      if (inBounds(r2, c2) && !board[r2][c2] &&
          inBounds(r1, c1) && board[r1][c1] &&
          board[r1][c1].color !== piece.color) {
        moves.push({ to: { r: r2, c: c2 }, capture: { r: r1, c: c1 } });
      }
    }
  }

  return moves;
}

function getAllMovesFor(color) {
  if (color !== "red" && color !== "black") {
    return { hasCapture: false, movesByFrom: new Map() };
  }

  const movesByFrom = new Map();
  let hasCapture = false;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!board[r][c] || board[r][c].color !== color) continue;

      const moves = getMovesFrom(r, c, true);
      if (moves.some(m => m.capture)) hasCapture = true;
      movesByFrom.set(`${r},${c}`, moves);
    }
  }

  // Mandatory capture rule
  if (hasCapture) {
    for (const [key, moves] of movesByFrom) {
      movesByFrom.set(key, moves.filter(m => m.capture));
    }
  }

  return { hasCapture, movesByFrom };
}

function render() {
  boardEl.innerHTML = "";

  const { hasCapture, movesByFrom } = getAllMovesFor(turn);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const square = document.createElement("div");
      square.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;
      square.dataset.r = r;
      square.dataset.c = c;

      // Highlight possible moves
      if (selected) {
        const isTarget = legalMoves.some(m => m.to.r === r && m.to.c === c);
        if (isTarget) {
          const move = legalMoves.find(m => m.to.r === r && m.to.c === c);
          square.classList.add(move.capture ? "captureHint" : "hint");
        }
      }

      const piece = board[r][c];
      if (piece) {
        const el = document.createElement("div");
        el.className = `piece ${piece.color}`;
        if (selected?.r === r && selected?.c === c) {
          el.classList.add("selected");
        }
        if (piece.king) {
          const k = document.createElement("div");
          k.className = "king";
          k.textContent = "K";
          el.appendChild(k);
        }

        // Highlight pieces that can capture (when mandatory)
        if (!mustContinueChain && hasCapture) {
          const moves = movesByFrom.get(`${r},${c}`) || [];
          if (moves.some(m => m.capture)) {
            el.style.boxShadow = "0 0 0 3px rgba(255,183,3,0.7), 0 4px 12px rgba(0,0,0,0.4)";
          }
        }

        square.appendChild(el);
      }

      square.addEventListener("click", onSquareClick);
      boardEl.appendChild(square);
    }
  }
}

// ---------------- Input & Game Flow ----------------

function onSquareClick(e) {
  if (online && !onlineReady) {
    setMessage("Waiting for the other player...");
    return;
  }
  if (online && playerRole !== turn) {
    setMessage("Not your turn.");
    return;
  }
  if (!online && mode === "ai" && turn === aiColor) {
    return;
  }

  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  const piece = board[r][c];

  // Continuing a multi-capture
  if (mustContinueChain && selected) {
    const move = legalMoves.find(m => m.to.r === r && m.to.c === c);
    if (move) {
      applyMove(selected.r, selected.c, move);
    } else {
      setMessage("You must continue capturing with this piece.");
    }
    return;
  }

  // Select own piece
  if (piece && piece.color === turn) {
    selectPiece(r, c);
    return;
  }

  // Try move
  if (selected) {
    const move = legalMoves.find(m => m.to.r === r && m.to.c === c);
    if (move) {
      applyMove(selected.r, selected.c, move);
    } else {
      // Clicked elsewhere → deselect
      selected = null;
      legalMoves = [];
      setMessage("");
      render();
    }
  }
}

function selectPiece(r, c) {
  const { hasCapture, movesByFrom } = getAllMovesFor(turn);
  const moves = movesByFrom.get(`${r},${c}`) || [];

  if (hasCapture && !moves.some(m => m.capture)) {
    setMessage("You must capture when possible.");
    return;
  }

  selected = { r, c };
  legalMoves = moves;
  setMessage(moves.length ? "" : "This piece has no legal moves.");
  render();
}

function applyMove(fromR, fromC, move) {
  const piece = board[fromR][fromC];
  board[fromR][fromC] = null;
  board[move.to.r][move.to.c] = piece;

  if (move.capture) {
    board[move.capture.r][move.capture.c] = null;
  }

  // King promotion
  if (!piece.king) {
    if (piece.color === "red"   && move.to.r === 0)        piece.king = true;
    if (piece.color === "black" && move.to.r === SIZE - 1) piece.king = true;
  }

  // Check for multi-capture
  if (move.capture) {
    const nextCaptures = getMovesFrom(move.to.r, move.to.c, false)
      .filter(m => m.capture);
    if (nextCaptures.length > 0) {
      selected = { r: move.to.r, c: move.to.c };
      legalMoves = nextCaptures;
      mustContinueChain = true;
      setMessage("Multi-capture — continue jumping.");
      render();
      syncOnlineGame();
      return;
    }
  }

  // End of turn
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

function isGameOver(colorToCheck) {
  let hasPieces = false;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c]?.color === colorToCheck) {
        hasPieces = true;
        break;
      }
    }
    if (hasPieces) break;
  }
  if (!hasPieces) return true;

  const { movesByFrom } = getAllMovesFor(colorToCheck);
  for (const moves of movesByFrom.values()) {
    if (moves.length > 0) return false;
  }
  return true;
}

// ---------------- Online Multiplayer ----------------

function syncOnlineGame() {
  if (!online || !roomId) return;

  const winner = isGameOver(turn) ? (turn === "red" ? "Black" : "Red") : null;

  db.ref(`rooms/${roomId}/game`).set({
    board: deepCopyBoard(board),
    turn,
    mustContinueChain,
    winner
  });
}

function listenToRoom(id) {
  roomRef = db.ref(`rooms/${id}`);

  roomRef.on("value", snap => {
    const data = snap.val();
    if (!data) return;

    const redJoined   = !!data.players?.red;
    const blackJoined = !!data.players?.black;
    onlineReady = redJoined && blackJoined;

    if (!onlineReady) {
      setMessage("Waiting for second player...");
      render();
      return;
    }

    if (!data.game) {
      updateTurnLabel();
      render();
      return;
    }

    board = normalizeBoard(data.game.board);

    turn = data.game.turn ?? "red";
    mustContinueChain = !!data.game.mustContinueChain;

    // Reset local selection (important!)
    selected = null;
    legalMoves = [];

    updateTurnLabel();

    if (data.game.winner) {
      setMessage(`${data.game.winner} wins!`);
    } else {
      setMessage("");
    }

    render();

    // AI can still play locally even in "online" view (for testing)
    maybeAIMove();
  });
}

// ---------------- Online Buttons ----------------

createRoomBtn.addEventListener("click", async () => {
  online = true;
  mode = "2p";
  modeBtn.textContent = "Mode: Online";
  initBoard();

  roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
  playerRole = "red";

  await db.ref(`rooms/${roomId}`).set({
    createdAt: Date.now(),
    players: { red: true, black: false },
    game: {
      board: deepCopyBoard(board),
      turn,
      mustContinueChain: false,
      winner: null
    }
  });

  listenToRoom(roomId);
  updateTurnLabel();
  alert(`Room created!\nCode: ${roomId}`);
});

joinRoomBtn.addEventListener("click", async () => {
  const code = prompt("Enter room code:").trim().toUpperCase();
  if (!code) return;

  online = true;
  mode = "2p";
  modeBtn.textContent = "Mode: Online";

  const ref = db.ref(`rooms/${code}`);
  const snap = await ref.get();

  if (!snap.exists()) {
    alert("Room not found.");
    resetOnlineState();
    return;
  }

  const data = snap.val();
  if (data.players?.black !== false) {
    alert("Room is full.");
    resetOnlineState();
    return;
  }

  playerRole = "black";
  await ref.child("players/black").set(true);

  roomId = code;
  listenToRoom(roomId);
  updateTurnLabel();
});

function resetOnlineState() {
  online = false;
  roomId = null;
  playerRole = null;
  onlineReady = false;
  if (roomRef) roomRef.off();
}

// ---------------- AI ----------------

function maybeAIMove() {
  if (online || mode !== "ai" || turn !== aiColor || isGameOver(turn)) return;
  setTimeout(aiMakeMove, 400);
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

  if (chosen) applyMove(chosen.from.r, chosen.from.c, chosen.move);
}

function getAllActionsFor(color) {
  const { movesByFrom } = getAllMovesFor(color);
  const actions = [];
  for (const [key, moves] of movesByFrom) {
    const [r, c] = key.split(",").map(Number);
    for (const m of moves) {
      actions.push({ from: { r, c }, move: m });
    }
  }
  return actions;
}

function pickMediumMove(actions) {
  let best = null;
  let bestScore = -9999;

  for (const a of actions) {
    const score = scoreMove(a);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best || actions[Math.floor(Math.random() * actions.length)];
}

function scoreMove({ move }) {
  let score = move.capture ? 50 : 0;
  if (!board[move.to.r][move.to.c]?.king) {
    if (move.to.r === 0 && turn === "red")   score += 35;
    if (move.to.r === 7 && turn === "black") score += 35;
  }
  return score;
}

// ---------------- Hard AI (Minimax + Alpha-Beta) ----------------

function pickHardMove(actions) {
  const depth = 5;
  let best = null;
  let bestScore = -Infinity;

  for (const action of actions) {
    const backup = deepCopyBoard(board);
    simulateMove(action.from, action.move);
    const score = minimax(depth - 1, false, -Infinity, Infinity);
    board = backup;

    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }

  return best || actions[Math.floor(Math.random() * actions.length)] || null;
}

function minimax(depth, maximizing, alpha, beta) {
  if (depth === 0) return evaluateBoard(aiColor);

  const maximizingColor = maximizing ? aiColor : (aiColor === "red" ? "black" : "red");
  const actions = getAllActionsFor(maximizingColor);

  if (!actions.length) {
    return maximizing ? -10000 : 10000;
  }

  if (maximizing) {
    let value = -Infinity;
    for (const a of actions) {
      const backup = deepCopyBoard(board);
      simulateMove(a.from, a.move);
      value = Math.max(value, minimax(depth - 1, false, alpha, beta));
      board = backup;
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  } else {
    let value = Infinity;
    for (const a of actions) {
      const backup = deepCopyBoard(board);
      simulateMove(a.from, a.move);
      value = Math.min(value, minimax(depth - 1, true, alpha, beta));
      board = backup;
      beta = Math.min(beta, value);
      if (beta <= alpha) break;
    }
    return value;
  }
}

function simulateMove(from, move) {
  const piece = board[from.r][from.c];
  board[from.r][from.c] = null;
  board[move.to.r][move.to.c] = piece;

  if (move.capture) {
    board[move.capture.r][move.capture.c] = null;
  }

  if (!piece.king) {
    if (piece.color === "red"   && move.to.r === 0)        piece.king = true;
    if (piece.color === "black" && move.to.r === SIZE - 1) piece.king = true;
  }
}

function evaluateBoard(perspective) {
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p) continue;

      let val = p.king ? 5 : 3;
      if (c >= 2 && c <= 5) val += 0.4;

      if (!p.king) {
        if (p.color === "black") val += r * 0.12;
        if (p.color === "red")   val += (SIZE - 1 - r) * 0.12;
      }

      score += (p.color === perspective ? val : -val);
    }
  }
  return score;
}

// ---------------- UI Controls ----------------

restartBtn.addEventListener("click", () => {
  initBoard();
  if (online && roomId) {
    syncOnlineGame();
  }
});

modeBtn.addEventListener("click", () => {
  if (online) {
    alert("Cannot change mode during online play.");
    return;
  }

  if (mode === "2p") {
    mode = "ai";
    aiDifficulty = "hard";
    modeBtn.textContent = "Mode: AI (Hard)";
  } else {
    mode = "2p";
    modeBtn.textConten
