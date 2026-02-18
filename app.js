// ---------------- DOM ----------------
const boardEl = document.getElementById("board");
const turnLabel = document.getElementById("turnLabel");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const modeBtn = document.getElementById("modeBtn");

const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");

// ---------------- Game Config ----------------
const SIZE = 10; // International draughts

// board[r][c] = null or { color: "red"|"black", king: boolean }
let board = [];
let turn = "red";

// selection + UI legal targets
let selected = null;
let legalMoves = [];
let mustContinueChain = false;

// --------- Max capture system ----------
let forcedMaxCaptureCount = 0;
let allowedFromKeys = new Set(); // pieces that are allowed to move this turn

// Modes
let mode = "2p"; // "2p" or "ai"
let aiColor = "black";
let aiDifficulty = "hard";

// Online multiplayer
let online = false;
let roomId = null;
let playerRole = null; // "red" or "black"
let roomRef = null;
let onlineReady = false;

// ---------------- Helpers ----------------
function setMessage(msg) {
  messageEl.textContent = msg;
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

// Firebase sometimes returns arrays as objects
function normalizeBoard(b) {
  if (!b) return null;
  if (Array.isArray(b)) return b;

  const arr = [];
  for (let r = 0; r < SIZE; r++) {
    arr[r] = [];
    for (let c = 0; c < SIZE; c++) {
      arr[r][c] = b?.[r]?.[c] ?? null;
    }
  }
  return arr;
}

// Deep clone board
function cloneBoard(b) {
  return b.map(row =>
    row.map(cell => (cell ? { color: cell.color, king: !!cell.king } : null))
  );
}

// ---------------- Core ----------------

function initBoard() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  // International draughts: 4 rows each = 20 pieces
  // Black top rows 0-3
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { color: "black", king: false };
    }
  }

  // Red bottom rows 6-9
  for (let r = SIZE - 4; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { color: "red", king: false };
    }
  }

  turn = "red";
  selected = null;
  legalMoves = [];
  mustContinueChain = false;

  forcedMaxCaptureCount = 0;
  allowedFromKeys = new Set();

  updateTurnLabel();
  setMessage("");
  recomputeTurnRestrictions();
  render();
}

// ---------------- MOVE GENERATION ----------------

// Men move forward, capture forward+backward (international).
function getManMovesFromBoard(b, r, c, includeSimple = true) {
  const p = b[r][c];
  if (!p) return [];

  const results = [];

  // Simple: forward only
  const forwardDirs = p.color === "red" ? [-1] : [1];

  // Capture: both directions
  const captureDirs = [-1, 1];

  if (includeSimple) {
    for (const dr of forwardDirs) {
      for (const dc of [-1, 1]) {
        const r1 = r + dr;
        const c1 = c + dc;
        if (inBounds(r1, c1) && b[r1][c1] === null) {
          results.push({ to: { r: r1, c: c1 }, capture: null });
        }
      }
    }
  }

  for (const dr of captureDirs) {
    for (const dc of [-1, 1]) {
      const r1 = r + dr;
      const c1 = c + dc;
      const r2 = r + dr * 2;
      const c2 = c + dc * 2;

      if (!inBounds(r2, c2)) continue;
      if (b[r2][c2] !== null) continue;

      if (inBounds(r1, c1) && b[r1][c1] && b[r1][c1].color !== p.color) {
        results.push({ to: { r: r2, c: c2 }, capture: { r: r1, c: c1 } });
      }
    }
  }

  return results;
}

// Flying king: move any distance. Capture long-range.
function getKingMovesFromBoard(b, r, c, includeSimple = true) {
  const p = b[r][c];
  if (!p) return [];

  const results = [];
  const dirs = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];

  for (const [dr, dc] of dirs) {
    // SIMPLE slides
    if (includeSimple) {
      let rr = r + dr;
      let cc = c + dc;
      while (inBounds(rr, cc) && b[rr][cc] === null) {
        results.push({ to: { r: rr, c: cc }, capture: null });
        rr += dr;
        cc += dc;
      }
    }

    // CAPTURE scan
    let rr = r + dr;
    let cc = c + dc;

    let foundEnemy = null;

    while (inBounds(rr, cc)) {
      const sq = b[rr][cc];

      if (sq === null) {
        rr += dr;
        cc += dc;
        continue;
      }

      // Friendly blocks
      if (sq.color === p.color) break;

      // First enemy
      foundEnemy = { r: rr, c: cc };
      rr += dr;
      cc += dc;
      break;
    }

    if (!foundEnemy) continue;

    // Landing squares after enemy
    while (inBounds(rr, cc) && b[rr][cc] === null) {
      results.push({ to: { r: rr, c: cc }, capture: foundEnemy });
      rr += dr;
      cc += dc;
    }
  }

  return results;
}

function getMovesFromBoard(b, r, c, includeSimple = true) {
  const p = b[r][c];
  if (!p) return [];
  return p.king
    ? getKingMovesFromBoard(b, r, c, includeSimple)
    : getManMovesFromBoard(b, r, c, includeSimple);
}

// ---------------- APPLY MOVE ON BOARD (SIMULATION) ----------------
function applyMoveOnBoard(b, fr, fc, move) {
  const piece = b[fr][fc];
  b[fr][fc] = null;

  const tr = move.to.r;
  const tc = move.to.c;

  b[tr][tc] = piece;

  if (move.capture) {
    b[move.capture.r][move.capture.c] = null;
  }

  // promotion
  if (!piece.king) {
    if (piece.color === "red" && tr === 0) piece.king = true;
    if (piece.color === "black" && tr === SIZE - 1) piece.king = true;
  }

  return { tr, tc };
}

// ---------------- MAX CAPTURE SEARCH ----------------
//
// Returns max number of captures possible from this piece if it starts capturing now.
// It explores all capture sequences (men and kings).
//
function maxCapturesFrom(b, r, c) {
  const p = b[r][c];
  if (!p) return 0;

  const captureMoves = getMovesFromBoard(b, r, c, false).filter(m => m.capture);
  if (!captureMoves.length) return 0;

  let best = 0;

  for (const mv of captureMoves) {
    const nb = cloneBoard(b);
    const { tr, tc } = applyMoveOnBoard(nb, r, c, mv);

    // Continue from new square
    const further = maxCapturesFrom(nb, tr, tc);
    best = Math.max(best, 1 + further);
  }

  return best;
}

// Compute forced rules for the current player:
// - if any capture exists, force capture
// - max capture rule: only pieces with the maximum capture chain are allowed
function recomputeTurnRestrictions() {
  allowedFromKeys = new Set();
  forcedMaxCaptureCount = 0;

  // find if any capture exists and the max chain length
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.color !== turn) continue;

      const captures = getMovesFromBoard(board, r, c, false).filter(m => m.capture);
      if (!captures.length) continue;

      const m = maxCapturesFrom(board, r, c);
      forcedMaxCaptureCount = Math.max(forcedMaxCaptureCount, m);
    }
  }

  // If no capture at all, everything allowed
  if (forcedMaxCaptureCount === 0) return;

  // Otherwise only pieces with that max are allowed
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.color !== turn) continue;

      const captures = getMovesFromBoard(board, r, c, false).filter(m => m.capture);
      if (!captures.length) continue;

      const m = maxCapturesFrom(board, r, c);
      if (m === forcedMaxCaptureCount) allowedFromKeys.add(`${r},${c}`);
    }
  }
}

// ---------------- MOVE SET FOR A SELECTED PIECE ----------------
function getLegalMovesForSelected(r, c) {
  const p = board[r][c];
  if (!p) return [];

  // chain capture lock
  if (mustContinueChain) {
    // only capture moves allowed
    return getMovesFromBoard(board, r, c, false).filter(m => m.capture);
  }

  // If max-capture is active, only those pieces can be selected
  if (forcedMaxCaptureCount > 0) {
    if (!allowedFromKeys.has(`${r},${c}`)) return [];
    // only capture moves
    return getMovesFromBoard(board, r, c, false).filter(m => m.capture);
  }

  // no forced capture: allow simple + capture
  return getMovesFromBoard(board, r, c, true);
}

// ---------------- RENDER ----------------
function render() {
  boardEl.innerHTML = "";

  // make grid 10×10
  boardEl.style.gridTemplateColumns = `repeat(${SIZE}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${SIZE}, 1fr)`;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const sq = document.createElement("div");
      sq.className = "square " + (((r + c) % 2 === 0) ? "light" : "dark");
      sq.dataset.r = r;
      sq.dataset.c = c;

      // move hint highlight
      if (selected) {
        const isTarget = legalMoves.some(m => m.to.r === r && m.to.c === c);
        if (isTarget) {
          const move = legalMoves.find(m => m.to.r === r && m.to.c === c);
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

        // highlight allowed max-capture pieces
        if (!mustContinueChain && forcedMaxCaptureCount > 0) {
          if (p.color === turn && allowedFromKeys.has(`${r},${c}`)) {
            piece.style.boxShadow =
              "0 0 0 3px rgba(255,183,3,0.70), 0 10px 18px rgba(0,0,0,0.35)";
          }
        }

        sq.appendChild(piece);
      }

      sq.addEventListener("click", onSquareClick);
      boardEl.appendChild(sq);
    }
  }
}

// ---------------- INPUT ----------------
function onSquareClick(e) {
  // Online: block until both players ready
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

  // chain lock: must move same piece
  if (mustContinueChain && selected) {
    const move = legalMoves.find(m => m.to.r === r && m.to.c === c);
    if (move) applyMove(selected.r, selected.c, move);
    else setMessage("You must continue capturing.");
    return;
  }

  // select piece
  if (p && p.color === turn) {
    selectPiece(r, c);
    return;
  }

  // attempt move
  if (selected) {
    const move = legalMoves.find(m => m.to.r === r && m.to.c === c);
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
  const p = board[r][c];
  if (!p || p.color !== turn) return;

  // If max-capture active, block wrong piece
  if (!mustContinueChain && forcedMaxCaptureCount > 0 && !allowedFromKeys.has(`${r},${c}`)) {
    setMessage(`You must capture the maximum (${forcedMaxCaptureCount}).`);
    return;
  }

  const moves = getLegalMovesForSelected(r, c);

  if (!moves.length) {
    setMessage(forcedMaxCaptureCount > 0 ? "This piece is not allowed (max capture rule)." : "No moves.");
    return;
  }

  selected = { r, c };
  legalMoves = moves;

  if (forcedMaxCaptureCount > 0) setMessage(`Forced capture: take maximum (${forcedMaxCaptureCount}).`);
  else setMessage("");

  render();
}

// ---------------- APPLY MOVE (REAL GAME) ----------------
function applyMove(fr, fc, move) {
  const piece = board[fr][fc];
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

  // If capture, check for continued captures
  if (move.capture) {
    const nextCaptures = getMovesFromBoard(board, tr, tc, false).filter(m => m.capture);

    if (nextCaptures.length) {
      selected = { r: tr, c: tc };
      legalMoves = nextCaptures;
      mustContinueChain = true;
      setMessage("Multi-capture! Continue.");
      render();
      syncOnlineGame();
      return;
    }
  }

  // End turn
  mustContinueChain = false;
  selected = null;
  legalMoves = [];

  turn = turn === "red" ? "black" : "red";
  updateTurnLabel();

  // recompute max capture for new turn
  recomputeTurnRestrictions();

  const winner = getWinnerIfAny();
  if (winner) setMessage(`${winner} wins!`);
  else setMessage("");

  render();
  syncOnlineGame();
  maybeAIMove();
}

function getWinnerIfAny() {
  // if player to play has no pieces or no moves, other wins
  let pieces = 0;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (p && p.color === turn) pieces++;
    }
  }
  if (pieces === 0) return turn === "red" ? "Black" : "Red";

  // check moves exist
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.color !== turn) continue;

      const moves = getLegalMovesForSelected(r, c);
      if (moves.length) return null;
    }
  }

  return turn === "red" ? "Black" : "Red";
}

// ---------------- Online Multiplayer ----------------
function syncOnlineGame() {
  if (!online || !roomId) return;

  const winner = getWinnerIfAny();

  db.ref("rooms/" + roomId + "/game").set({
    board,
    turn,
    mustContinueChain,
    forcedMaxCaptureCount,
    winner
  });
}

function listenToRoom(id) {
  roomRef = db.ref("rooms/" + id);

  roomRef.on("value", (snap) => {
    const data = snap.val();
    if (!data) return;

    const redIn = !!data.players?.red;
    const blackIn = !!data.players?.black;
    onlineReady = redIn && blackIn;

    if (!onlineReady) setMessage("Waiting for player...");

    if (!data.game || !data.game.board) {
      updateTurnLabel();
      return;
    }

    const fixedBoard = normalizeBoard(data.game.board);
    if (!fixedBoard) return;

    board = fixedBoard;
    turn = data.game.turn ?? "red";
    mustContinueChain = data.game.mustContinueChain ?? false;

    selected = null;
    legalMoves = [];

    // recompute restrictions locally (don't trust network)
    recomputeTurnRestrictions();

    updateTurnLabel();

    if (data.game.winner) setMessage(data.game.winner + " wins!");
    else if (!onlineReady) setMessage("Waiting for player...");
    else if (forcedMaxCaptureCount > 0) setMessage(`Forced capture: take maximum (${forcedMaxCaptureCount}).`);
    else setMessage("");

    render();
  });
}

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
      forcedMaxCaptureCount,
      winner: null
    }
  });

  listenToRoom(roomId);
  updateTurnLabel();
  alert("Room created! Code: " + roomId);
});

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
});

// ---------------- AI (DISABLED ONLINE) ----------------
function maybeAIMove() {
  if (online) return;
  if (mode !== "ai") return;
  if (turn !== aiColor) return;
  if (getWinnerIfAny()) return;

  setTimeout(() => aiMakeMove(), 350);
}

// Very simple AI (still works on 10×10)
function aiMakeMove() {
  const actions = getAllActionsFor(aiColor);
  if (!actions.length) return;

  // prefer captures
  const caps = actions.filter(a => a.move.capture);
  const pool = caps.length ? caps : actions;

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  applyMove(chosen.from.r, chosen.from.c, chosen.move);
}

function getAllActionsFor(color) {
  const actions = [];

  // recompute restrictions for AI turn
  recomputeTurnRestrictions();

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;

      const moves = getLegalMovesForSelected(r, c);
      for (const m of moves) actions.push({ from: { r, c }, move: m });
    }
  }
  return actions;
}

// ---------------- UI ----------------
restartBtn.addEventListener("click", () => {
  initBoard();

  if (online && roomId) {
    db.ref("rooms/" + roomId + "/game").set({
      board,
      turn,
      mustContinueChain: false,
      forcedMaxCaptureCount,
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
    modeBtn.textContent = "Mode: AI";
  } else {
    mode = "2p";
    modeBtn.textContent = "Mode: 2 Player";
  }

  updateTurnLabel();
  initBoard();
});

// ---------------- Start ----------------
initBoard();
