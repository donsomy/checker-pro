/* Checkers Pro — 10x10 International Draughts (Online + AI)
   - 10x10 board, 20 pieces per side
   - Mandatory captures
   - Men move forward, capture forward/backward (international)
   - Flying kings (move any distance diagonally)
   - Flying king capture: ONE direction per jump (no turn inside a single jump)
   - Multi-capture chaining supported
   - AI with Easy/Hard/Legendary (minimax)
   - Online mode with Firebase Realtime DB
*/
// Helper to show/hide thinking animation
function showAITinking() {
  setMessage("AI thinking");
  messageEl.classList.add("thinking");
}
function getCaptureMovesFromBoard(b, r, c){
  const original = board;
  board = b;
  const result = getCaptureMovesFrom(r,c);
  board = original;
  return result;
}

function hasCaptureFrom(r, c){
const caps = getCaptureMovesForChainAt(r, c);
return caps && caps.length > 0;
}
function hideAIThinking() {
  messageEl.classList.remove("thinking");
  setMessage(""); // or keep previous message if you want
}
const BOARD_SIZE = 10;


// Piece encoding
// 0 empty
// 1 red man
// 2 black man
// 3 red king
// 4 black king

const RED = "red";
const BLACK = "black";

const boardEl = document.getElementById("board");
const turnLabel = document.getElementById("turnLabel");
const messageEl = document.getElementById("message");

const restartBtn = document.getElementById("restartBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const modeBtn = document.getElementById("modeBtn");
const aiDifficultyEl = document.getElementById("aiDifficulty");

const redBar = document.getElementById("redBar");
const blackBar = document.getElementById("blackBar");
const redCountEl = document.getElementById("redCount");
const blackCountEl = document.getElementById("blackCount");

const sfxMove = document.getElementById("sfxMove");
const sfxCapture = document.getElementById("sfxCapture");
const sfxCrown = document.getElementById("sfxCrown");
const sfxWin = document.getElementById("sfxWin");
const sfxClick = document.getElementById("sfxClick");

function playSfx(audio){
  if(!audio) return;
  try{
    audio.currentTime = 0;
    audio.play().catch(()=>{});
  }catch(e){}
}

let board = null;
let turn = RED;

let selected = null; // {r,c}
let legalMoves = []; // moves for selected
let forcedMovesAll = []; // all forced capture moves for current player

let mode = "2p"; // "2p" | "ai"
let aiSide = BLACK; // AI plays black
let online = false;

let roomId = null;
let roomRef = null;

let myRole = null; // "host" or "guest"
let myColor = null; // "red" or "black"
let waitingForPlayer = false;

let mustContinueChain = null; // {r,c} piece that must continue capture chain

// ---------- Helpers ----------
function inBounds(r,c){ return r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE; }

function isRed(p){ return p===1 || p===3; }
function isBlack(p){ return p===2 || p===4; }
function isKing(p){ return p===3 || p===4; }
function ownerOf(p){
  if(isRed(p)) return RED;
  if(isBlack(p)) return BLACK;
  return null;
}
function makeKing(p){
  if(p===1) turn 3;
  if(p===2) return 4;
  return p;
}re

function cloneBoard(b){ return b.map(row => row.slice()); }

function setMessage(msg){ messageEl.textContent = msg || ""; }

// ===== FORCED MOVE VISUALS =====
function clearForcedHighlights(){
  document.querySelectorAll('.forced-piece').forEach(e=>e.classList.remove('forced-piece'));
  document.querySelectorAll('.forced-destination').forEach(e=>e.classList.remove('forced-destination'));
}

function highlightForcedPiece(pieceEl){
  if(!pieceEl) return;
  pieceEl.classList.add('forced-piece');
}

function highlightForcedDestinations(destinations){
  destinations.forEach(d=>{
    const sq = document.querySelector(`.square[data-r='${d.r}'][data-c='${d.c}']`);
    if(sq) sq.classList.add('forced-destination');
  });
}

function applyForcedVisuals(){
  clearForcedHighlights();
  if(!legalMoves || !legalMoves.length) return;
  if(!legalMoves.some(m => m.captures && m.captures.length)) return;

  const src = legalMoves[0].from;
  const piece = document.querySelector(`.square[data-r='${src.r}'][data-c='${src.c}'] .piece`);
  highlightForcedPiece(piece);
  highlightForcedDestinations(legalMoves.map(m=>m.to));
}

function normalizeBoard(b){
  if(!b) return null;
  if(Array.isArray(b)) return b;
  // object form from RTDB
  const arr = [];
  for(let r=0;r<BOARD_SIZE;r++){
    arr[r]=[];
    for(let c=0;c<BOARD_SIZE;c++){
      arr[r][c] = b?.[r]?.[c] ?? 0;
    }
  }
  return arr;
}

function countPieces(){
  let red=0, black=0;
  for(let r=0;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      const p = board[r][c];
      if(isRed(p)) red++;
      else if(isBlack(p)) black++;
    }
  }
  return {red, black};
}

function updateBars(){
  const {red, black} = countPieces();
  redCountEl.textContent = red;
  blackCountEl.textContent = black;

  const max = 20; // start pieces per side
  redBar.style.width = Math.max(0, Math.min(100, (red/max)*100)) + "%";
  blackBar.style.width = Math.max(0, Math.min(100, (black/max)*100)) + "%";
}

// ---------- Init ----------
function initBoard(){
  board = Array.from({length:BOARD_SIZE}, ()=>Array(BOARD_SIZE).fill(0));

  // International: each side occupies 4 rows on dark squares
  // Black at top (rows 0-3), Red at bottom (rows 6-9)
  for(let r=0;r<4;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      if((r+c)%2===1) board[r][c]=2;
    }
  }
  for(let r=BOARD_SIZE-4;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      if((r+c)%2===1) board[r][c]=1;
    }
  }

  turn = RED;
  selected = null;
  legalMoves = [];
  mustContinueChain = null;
  setMessage("");
  waitingForPlayer = false;
  updateBars();
}


function buildBoardUI(){
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;

  for(let r=0;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      const sq = document.createElement("div");
      sq.className = "square " + (((r+c)%2===0) ? "light" : "dark");
      sq.dataset.r = r;
      sq.dataset.c = c;
      sq.addEventListener("click", onSquareClick);
      boardEl.appendChild(sq);
    }
  }
}


function render(){
  if(!board) return;

  // Clear all classes
  const squares = boardEl.querySelectorAll(".square");
  squares.forEach(sq=>{
    sq.classList.remove("selected","legal","capture");
    sq.innerHTML = "";
  });

  // Pieces
  for(let r=0;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      const p = board[r][c];
      if(p===0) continue;
      const sq = getSquareEl(r,c);
      const piece = document.createElement("div");
      
      piece.className = "piece " + (isRed(p) ? "red" : "black");
      if(isKing(p)) piece.classList.add("king");
      sq.appendChild(piece);
        
       if(hasCaptureFrom(r, c)){
piece.classList.add("capture-glow");
      }
    }
  }

  // Selected
  if(selected){
    getSquareEl(selected.r, selected.c)?.classList.add("selected");
  }

  // Legal
  for(const m of legalMoves){
    const sq = getSquareEl(m.to.r, m.to.c);
    if(!sq) continue;
    sq.classList.add("legal");
    if(m.captures && m.captures.length>0) sq.classList.add("capture");
  }

   updateBars();
  updateTurnLabel();

  // wait until pieces exist in DOM before highlighting
  setTimeout(applyForcedVisuals, 0);
}

function getSquareEl(r,c){
  return boardEl.querySelector(`.square[data-r="${r}"][data-c="${c}"]`);
}

function updateTurnLabel(){
  let modeText = (mode==="ai") ? `AI (${aiDifficultyEl.value})` : "2 Player";
  if(online) modeText = "Online";

  let waitText = waitingForPlayer ? " • Waiting for player…" : "";
  let roleText = "";
  if(online && myColor){
    roleText = ` • You: ${myColor.toUpperCase()}`;
  }

  turnLabel.textContent = `Turn: ${turn.toUpperCase()} • Mode: ${modeText}${roleText}${waitText}`;
}

// ---------- Move generation (International) ----------

function getAllPiecesFor(color){
  const out=[];
  for(let r=0;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      const p = board[r][c];
      if(p===0) continue;
      if(color===RED && isRed(p)) out.push({r,c});
      if(color===BLACK && isBlack(p)) out.push({r,c});
    }
  }
  return out;
}

function dirsForMan(color){
  // Men move forward only (red moves up, black moves down)
  return color===RED ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
}

function allDiagDirs(){
  return [[1,1],[1,-1],[-1,1],[-1,-1]];
}

// Non-capture moves
function getQuietMovesFrom(r,c){
  const p = board[r][c];
  if(p===0) return [];
  const color = ownerOf(p);
  const out=[];

  if(isKing(p)){
    // flying king: slide any distance
    for(const [dr,dc] of allDiagDirs()){
      let nr=r+dr, nc=c+dc;
      while(inBounds(nr,nc) && board[nr][nc]===0){
        out.push({from:{r,c}, to:{r:nr,c:nc}, captures:[]});
        nr+=dr; nc+=dc;
      }
    }
  }else{
    // man: 1 step forward
    for(const [dr,dc] of dirsForMan(color)){
      const nr=r+dr, nc=c+dc;
      if(inBounds(nr,nc) && board[nr][nc]===0){
        out.push({from:{r,c}, to:{r:nr,c:nc}, captures:[]});
      }
    }
  }

  return out;
}

// Capture moves (single jump options from a square)
function getCaptureMovesFrom(r,c){
  const p = board[r][c];
  if(p===0) return [];
  const color = ownerOf(p);
  const out=[];

  if(isKing(p)){
    // flying king capture:
    // along a diagonal: empty squares, then exactly one enemy, then at least one empty landing square beyond.
    for(const [dr,dc] of allDiagDirs()){
      let nr=r+dr, nc=c+dc;
      // skip empties
      while(inBounds(nr,nc) && board[nr][nc]===0){
        nr+=dr; nc+=dc;
      }
      if(!inBounds(nr,nc)) continue;

      const mid = board[nr][nc];
      if(mid===0) continue;
      if(ownerOf(mid)===color) continue;

      // enemy found; squares beyond must be empty; each empty is a legal landing
      let lr=nr+dr, lc=nc+dc;
      while(inBounds(lr,lc) && board[lr][lc]===0){
        out.push({
          from:{r,c},
          to:{r:lr,c:lc},
          captures:[{r:nr,c:nc}]
        });
        lr+=dr; lc+=dc;
      }
    }
  }else{
    // man capture: forward/backward allowed in international
    for(const [dr,dc] of allDiagDirs()){
      const mr=r+dr, mc=c+dc;
      const lr=r+2*dr, lc=c+2*dc;
      if(!inBounds(lr,lc) || !inBounds(mr,mc)) continue;
      const mid = board[mr][mc];
      if(mid===0) continue;
      if(ownerOf(mid)===color) continue;
      if(board[lr][lc]!==0) continue;
      out.push({
        from:{r,c},
        to:{r:lr,c:lc},
        captures:[{r:mr,c:mc}]
      });
    }
  }

  return out;
}

function getAllCaptureMovesFor(color){
  const pieces = getAllPiecesFor(color);
  const all=[];
  for(const pos of pieces){
    const moves = getCaptureMovesFrom(pos.r,pos.c);
    for(const m of moves) all.push(m);
  }
  return all;
}

function getAllLegalMovesFor(color){
  const caps = getMaxCaptureMoves(color);
  if(caps.length>0) return {moves:caps, forced:true};
  // quiet moves
  const pieces = getAllPiecesFor(color);
  const all=[];
  for(const pos of pieces){
    const moves = getQuietMovesFrom(pos.r,pos.c);
    for(const m of moves) all.push(m);
  }
  return {moves:all, forced:false};
}

function getCaptureMovesForChainAt(r,c){
  const moves = getCaptureMovesFrom(r,c);
  if(!moves.length) return moves;

  let max = 0;
  for(const m of moves){
    if(m.captures.length > max) max = m.captures.length;
  }
  return moves.filter(m => m.captures.length === max);
}

// ---------- Apply move ----------
function applyMove(move, playSounds=true){
  const p = board[move.from.r][move.from.c];
  board[move.from.r][move.from.c] = 0;
  board[move.to.r][move.to.c] = p;

  let didCapture = false;
  if(move.captures && move.captures.length){
    didCapture = true;
    for(const cap of move.captures){
      board[cap.r][cap.c] = 0;
    }
  }

  // ---- PROMOTION DETECTION (INTERNATIONAL RULE) ----
 // ---- INTERNATIONAL DELAYED PROMOTION ----
let promoted = false;
let moved = board[move.to.r][move.to.c];

// detect if piece reached king row
let reachedBackRank = false;
if(!isKing(moved)){
  if(ownerOf(moved)===RED && move.to.r===0) reachedBackRank = true;
  if(ownerOf(moved)===BLACK && move.to.r===BOARD_SIZE-1) reachedBackRank = true;
}

// ONLY crown if it was NOT a capture
if(reachedBackRank && !didCapture){
  board[move.to.r][move.to.c] = makeKing(moved);
  promoted = true;
  if(playSounds) playSfx(sfxCrown);
}

  if(playSounds){
    if(didCapture) playSfx(sfxCapture);
    else playSfx(sfxMove);
  }
}

  // IMPORTANT: return both values
  return {didCapture, promoted};
}

function checkWinner(){
  const {red, black} = countPieces();
  if(red===0) return BLACK;
  if(black===0) return RED;

  // no legal moves
  const redMoves = getAllLegalMovesFor(RED).moves.length;
  const blackMoves = getAllLegalMovesFor(BLACK).moves.length;
  if(redMoves===0) return BLACK;
  if(blackMoves===0) return RED;

  return null;
}

// ---------- Input / Turn logic ----------
function isMyTurn(){
  if(!online) return true;
  if(!myColor) return false;
  return myColor === turn;
}

function onSquareClick(e){
  if(waitingForPlayer) return;

  playSfx(sfxClick);

  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);

  if(online && !isMyTurn()) return;

  const p = board[r][c];
  const color = ownerOf(p);

  // If chain forced, only allow selecting that piece
  if(mustContinueChain){
// allow clicking destination squares too
const isChainPiece = (r===mustContinueChain.r && c===mustContinueChain.c);

// if clicked somewhere else, only allow it if it's a legal destination
if(!isChainPiece){
if(!selected) return;
const isLegalDest = legalMoves.some(m => m.to.r===r && m.to.c===c);
if(!isLegalDest) return;
}
}

  // Select if clicking own piece
 if(p!==0 && color===turn){

  // enforce forced piece rule
  const forced = getMaxCaptureMoves(turn);
  if(forced.length && !forced.some(m => m.from.r===r && m.from.c===c)){
    return;
  }

  // select piece
  selected = {r,c};
  legalMoves = getMovesForSelection(r,c);

  render();
  return;
}

  // Try move
  const move = legalMoves.find(m => m.to.r===r && m.to.c===c);
  if(!move) return;

const result = applyMove(move, true);
const didCapture = result.didCapture;
const promoted = result.promoted;
  // If capture, check chain
  // INTERNATIONAL RULE: if crowned, stop the move immediately
if(didCapture && !promoted){
  const nextCaps = getCaptureMovesForChainAt(r,c);
  if(nextCaps.length>0){
    mustContinueChain = {r,c};
    selected = {r,c};
    legalMoves = nextCaps;
    render();
    if(online) pushGameState();
    return;
  }
}
  
  // delayed crowning after full capture sequence
let endPiece = board[r][c];
if(endPiece===1 && r===0){
  board[r][c]=3;
  playSfx(sfxCrown);
}
if(endPiece===2 && r===BOARD_SIZE-1){
  board[r][c]=4;
  playSfx(sfxCrown);
}
   
// End turn
mustContinueChain = null;
selected = null;
legalMoves = [];
turn = (turn===RED) ? BLACK : RED;
   
  const winner = checkWinner();
  if(winner){
    setMessage(`${winner.toUpperCase()} wins!`);
    playSfx(sfxWin);
  }else{
    setMessage("");
  }

  render();

  if(online) pushGameState();

  // AI turn
  if(mode==="ai" && !online && turn===aiSide && !winner){
    setTimeout(()=> aiMakeMove(), 250);
  }
}

function getMovesForSelection(r,c){
  const p = board[r][c];
  if(p===0) return [];
  const color = ownerOf(p);
  if(color!==turn) return [];

  // If chain forced, only captures
  if(mustContinueChain){
    return getCaptureMovesForChainAt(r,c);
  }

  // Mandatory capture rule
 const capsAll = getMaxCaptureMoves(turn);
if(capsAll.length>0){
  return capsAll.filter(m => m.from.r===r && m.from.c===c);
}

  return getQuietMovesFrom(r,c);
}

// ---------- LONGEST CAPTURE SEARCH (International rule) ----------
function exploreCaptureChains(b, r, c, piece, visited=[]){
  const moves = getCaptureMovesFromBoard(b, r, c);
  if(!moves.length){
    return [{length:0, sequence:[]}];
  }

  let results = [];

  for(const m of moves){
    const nb = cloneBoard(b);

    nb[r][c]=0;
    nb[m.to.r][m.to.c]=piece;
    for(const cap of m.captures){
      nb[cap.r][cap.c]=0;
    }

    const next = exploreCaptureChains(nb, m.to.r, m.to.c, piece, visited);
    for(const n of next){
      results.push({
        length: 1 + n.length,
        sequence: [m, ...n.sequence]
      });
    }
  }

  return results;
}

function getMaxCaptureMoves(color){
  const pieces = getAllPiecesFor(color);
  let allChains=[];
  let maxLen=0;

  for(const pos of pieces){
    const p = board[pos.r][pos.c];
    const chains = exploreCaptureChains(board, pos.r, pos.c, p);

    for(const ch of chains){
      if(ch.length>0){
        if(ch.length>maxLen){
          maxLen=ch.length;
          allChains=[{start:pos, chain:ch.sequence}];
        }else if(ch.length===maxLen){
          allChains.push({start:pos, chain:ch.sequence});
        }
      }
    }
  }

  // convert back to move list
  let moves=[];
  for(const item of allChains){
    if(item.chain.length>0){
      moves.push(item.chain[0]);
    }
  }

  return moves;
}
// ---------- Online (Firebase) ----------
function setOnlineMode(on){
  online = on;
  if(on){
    mode = "2p";
    modeBtn.textContent = "Mode: 2 Player";
    setMessage("Online mode enabled.");
  }else{
    setMessage("");
  }
  updateTurnLabel();
}

function newRoomId(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s="";
  for(let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function createRoom(){
  if(!db){
    alert("Firebase not ready. Check firebase.js config.");
    return;
  }
  const id = newRoomId();
  roomId = id;
  myRole = "host";
  myColor = RED;
  waitingForPlayer = true;

  initBoard();
  buildBoardUI();
  render();

  setOnlineMode(true);

  const payload = {
    createdAt: Date.now(),
    players: { host: true, guest: false },
    game: {
      board,
      turn,
      mustContinueChain: null,
      winner: null
    }
  };

  db.ref("rooms/" + id).set(payload);

  listenToRoom(id);

  alert("Room created: " + id + "\nShare this code with your friend.");
}

function joinRoom(){
  if(!db){
    alert("Firebase not ready. Check firebase.js config.");
    return;
  }
  const id = prompt("Enter Room Code:");
  if(!id) return;
  roomId = id.trim().toUpperCase();
  myRole = "guest";
  myColor = BLACK;

  setOnlineMode(true);

  // Mark guest joined
  db.ref("rooms/" + roomId + "/players/guest").set(true);

  listenToRoom(roomId);
}

function listenToRoom(id){
  roomRef = db.ref("rooms/" + id);

  roomRef.on("value", (snap)=>{
    const data = snap.val();
    if(!data) return;

    // Waiting message
    const guestJoined = !!data.players?.guest;
    waitingForPlayer = (myRole==="host" && !guestJoined);

    if(!data.game || !data.game.board) return;

    board = normalizeBoard(data.game.board);
    if(!board) return;

    turn = data.game.turn ?? RED;
    mustContinueChain = data.game.mustContinueChain ?? null;

    const winner = data.game.winner ?? null;

    // Reset selection each sync
    selected = null;
    legalMoves = [];

    if(waitingForPlayer){
      setMessage("Waiting for player to join…");
    }else if(winner){
      setMessage(`${winner.toUpperCase()} wins!`);
    }else{
      setMessage("");
    }

    buildBoardUI();
    render();
  });
}

function pushGameState(){
  if(!db || !roomId) return;

  const winner = checkWinner();

  db.ref("rooms/" + roomId + "/game").set({
    board,
    turn,
    mustContinueChain,
    winner
  });
}

// ---------- AI ----------
function aiDepth(){
  const d = aiDifficultyEl.value;
  if(d==="easy") return 2;
  if(d==="hard") return 4;
  return 6; // legendary
}

function evaluateBoard(b){
  // simple heuristic:
  // man = 10, king = 18
  // plus center control
  let score = 0;
  for(let r=0;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      const p=b[r][c];
      if(p===0) continue;
      const isK = (p===3 || p===4);
      const val = isK ? 18 : 10;

      // center bonus
      const dist = Math.abs(r-(BOARD_SIZE-1)/2) + Math.abs(c-(BOARD_SIZE-1)/2);
      const centerBonus = (10 - dist) * 0.25;

      if(isRed(p)) score += val + centerBonus;
      else score -= val + centerBonus;
    }
  }
  // positive = red better, negative = black better
  return score;
}

function getMovesForColorOnBoard(b, color, mustChain=null){
  // Generate moves on a provided board
  function inB(r,c){ return r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE; }
  function isR(p){ return p===1 || p===3; }
  function isB(p){ return p===2 || p===4; }
  function isK(p){ return p===3 || p===4; }
  function own(p){
    if(isR(p)) return RED;
    if(isB(p)) return BLACK;
    return null;
  }
  function dirsMan(col){
    return col===RED ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
  }
  function diag(){ return [[1,1],[1,-1],[-1,1],[-1,-1]]; }

  function quietFrom(r,c){
    const p=b[r][c];
    if(p===0) return [];
    const col=own(p);
    const out=[];
    if(isK(p)){
      for(const [dr,dc] of diag()){
        let nr=r+dr, nc=c+dc;
        while(inB(nr,nc) && b[nr][nc]===0){
          out.push({from:{r,c}, to:{r:nr,c:nc}, captures:[]});
          nr+=dr; nc+=dc;
        }
      }
    }else{
      for(const [dr,dc] of dirsMan(col)){
        const nr=r+dr, nc=c+dc;
        if(inB(nr,nc) && b[nr][nc]===0) out.push({from:{r,c}, to:{r:nr,c:nc}, captures:[]});
      }
    }
    return out;
  }

  function capsFrom(r,c){
    const p=b[r][c];
    if(p===0) return [];
    const col=own(p);
    const out=[];
    if(isK(p)){
      for(const [dr,dc] of diag()){
        let nr=r+dr, nc=c+dc;
        while(inB(nr,nc) && b[nr][nc]===0){
          nr+=dr; nc+=dc;
        }
        if(!inB(nr,nc)) continue;
        const mid=b[nr][nc];
        if(mid===0) continue;
        if(own(mid)===col) continue;

        let lr=nr+dr, lc=nc+dc;
        while(inB(lr,lc) && b[lr][lc]===0){
          out.push({from:{r,c}, to:{r:lr,c:lc}, captures:[{r:nr,c:nc}]});
          lr+=dr; lc+=dc;
        }
      }
    }else{
      for(const [dr,dc] of diag()){
        const mr=r+dr, mc=c+dc;
        const lr=r+2*dr, lc=c+2*dc;
        if(!inB(lr,lc) || !inB(mr,mc)) continue;
        const mid=b[mr][mc];
        if(mid===0) continue;
        if(own(mid)===col) continue;
        if(b[lr][lc]!==0) continue;
        out.push({from:{r,c}, to:{r:lr,c:lc}, captures:[{r:mr,c:mc}]});
      }
    }
    return out;
  }

  // if mustChain, only capture moves for that piece
  if(mustChain){
    return capsFrom(mustChain.r, mustChain.c);
  }

  // mandatory capture
 const allCaps = getMaxCaptureMovesOnBoard(b, color);
if(allCaps.length) return allCaps;

  const all=[];
  for(let r=0;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      const p=b[r][c];
      if(p===0) continue;
      if(color===RED && !isR(p)) continue;
      if(color===BLACK && !isB(p)) continue;
      const ms=quietFrom(r,c);
      for(const m of ms) all.push(m);
    }
  }
  return all;
}
function getMaxCaptureMovesOnBoard(b, color){
  const original = board;
  board = b;
  const result = getMaxCaptureMoves(color);
  board = original;
  return result;
}
function applyMoveOnBoard(b, move){
  const nb = b.map(row=>row.slice());
  const p = nb[move.from.r][move.from.c];
  nb[move.from.r][move.from.c]=0;
  nb[move.to.r][move.to.c]=p;
  if(move.captures && move.captures.length){
    for(const cap of move.captures){
      nb[cap.r][cap.c]=0;
    }
  }
  // promotion
  const moved = nb[move.to.r][move.to.c];
  if(moved===1 && move.to.r===0) nb[move.to.r][move.to.c]=3;
  if(moved===2 && move.to.r===BOARD_SIZE-1) nb[move.to.r][move.to.c]=4;
  return nb;
}

 function aiMakeMove(){

  const status = document.getElementById("aiStatus");
  if(status){
    status.classList.add("ai-thinking");
  }

  // AI plays aiSide
  const depth = aiDepth();
  const color = aiSide;

  const mustChain = mustContinueChain;
  const moves = getMovesForColorOnBoard(board, color, mustChain);
  if(!moves.length){
    if(status) status.classList.remove("ai-thinking");
    return;
  }

  // minimax with alpha-beta
  function minimax(b, turnColor, d, alpha, beta, chainPiece=null){
    const winner = winnerOnBoard(b);
    if(winner){
      if(winner===RED) return 99999;
      return -99999;
    }
    if(d===0){
      return evaluateBoard(b);
    }

    const movesHere = getMovesForColorOnBoard(b, turnColor, chainPiece);
    if(!movesHere.length){
      if(turnColor===RED) return -99999;
      return 99999;
    }

    const maximizing = (turnColor===RED);

    if(maximizing){
      let best=-Infinity;
      for(const m of movesHere){
        const nb = applyMoveOnBoard(b,m);

        let nextChain=null;
        if(m.captures && m.captures.length){
          const caps = getMovesForColorOnBoard(nb, turnColor, {r:m.to.r, c:m.to.c});
          if(caps.length) nextChain = {r:m.to.r, c:m.to.c};
        }

        const nextTurn = nextChain ? turnColor : (turnColor===RED?BLACK:RED);
        const score = minimax(nb, nextTurn, d-1, alpha, beta, nextChain);

        best = Math.max(best, score);
        alpha = Math.max(alpha, best);
        if(beta<=alpha) break;
      }
      return best;
    }else{
      let best=Infinity;
      for(const m of movesHere){
        const nb = applyMoveOnBoard(b,m);

        let nextChain=null;
        if(m.captures && m.captures.length){
          const caps = getMovesForColorOnBoard(nb, turnColor, {r:m.to.r, c:m.to.c});
          if(caps.length) nextChain = {r:m.to.r, c:m.to.c};
        }

        const nextTurn = nextChain ? turnColor : (turnColor===RED?BLACK:RED);
        const score = minimax(nb, nextTurn, d-1, alpha, beta, nextChain);

        best = Math.min(best, score);
        beta = Math.min(beta, best);
        if(beta<=alpha) break;
      }
      return best;
    }
  }

  function winnerOnBoard(b){
    let r=0, bl=0;
    for(let i=0;i<BOARD_SIZE;i++){
      for(let j=0;j<BOARD_SIZE;j++){
        const p=b[i][j];
        if(p===1||p===3) r++;
        else if(p===2||p===4) bl++;
      }
    }
    if(r===0) return BLACK;
    if(bl===0) return RED;

    const rm = getMovesForColorOnBoard(b, RED, null).length;
    const bm = getMovesForColorOnBoard(b, BLACK, null).length;
    if(rm===0) return BLACK;
    if(bm===0) return RED;
    return null;
  }

  let bestMove = null;
  let bestScore = (color===RED) ? -Infinity : Infinity;

  const noise = (aiDifficultyEl.value==="legendary") ? 0.03 : 0.0;

  for(const m of moves){
    const nb = applyMoveOnBoard(board, m);

    let nextChain=null;
    if(m.captures && m.captures.length){
      const caps = getMovesForColorOnBoard(nb, color, {r:m.to.r, c:m.to.c});
      if(caps.length) nextChain = {r:m.to.r, c:m.to.c};
    }

    const nextTurn = nextChain ? color : (color===RED?BLACK:RED);
    const score = minimax(nb, nextTurn, depth-1, -Infinity, Infinity, nextChain) + (Math.random()*noise);

    if(color===RED){
      if(score>bestScore){ bestScore=score; bestMove=m; }
    }else{
      if(score<bestScore){ bestScore=score; bestMove=m; }
    }
  }

  if(!bestMove){
    bestMove = moves[Math.floor(Math.random()*moves.length)];
  }

  // ⬇️ DELAY ONLY THE REAL BOARD MOVE
  const thinkTime = 400 + depth * 120; // deeper AI thinks longer

  setTimeout(() => {

   const result = applyMove(bestMove, true);
const didCapture = result.didCapture;
const promoted = result.promoted;

   // INTERNATIONAL RULE: crowned piece cannot continue capture
if(didCapture && !promoted){
  const nextCaps = getCaptureMovesForChainAt(bestMove.to.r, bestMove.to.c);
  if(nextCaps.length){
    mustContinueChain = {r:bestMove.to.r, c:bestMove.to.c};
    selected = {r:bestMove.to.r, c:bestMove.to.c};
    legalMoves = nextCaps;
    render();
    setTimeout(()=> aiMakeMove(), 300);
    return;
  }
}

     // delayed crowning after full capture sequence (AI)
let endPiece = board[bestMove.to.r][bestMove.to.c];
if(endPiece===1 && bestMove.to.r===0){
  board[bestMove.to.r][bestMove.to.c]=3;
  playSfx(sfxCrown);
}
if(endPiece===2 && bestMove.to.r===BOARD_SIZE-1){
  board[bestMove.to.r][bestMove.to.c]=4;
  playSfx(sfxCrown);
}
    mustContinueChain = null;
    selected = null;
    legalMoves = [];
    turn = (turn===RED) ? BLACK : RED;

    const winner = checkWinner();
    if(winner){
      setMessage(`${winner.toUpperCase()} wins!`);
      playSfx(sfxWin);
    }else{
      setMessage("");
    }

    render();

    if(status){
      status.classList.remove("ai-thinking");
    }

  }, thinkTime);

 }
    

// ---------- Buttons ----------
restartBtn.addEventListener("click", ()=>{
  if(online){
    if(!roomId) return;
    initBoard();
    pushGameState();
    return;
  }
  initBoard();
  render();

  if(mode==="ai" && turn===aiSide){
    setTimeout(()=> aiMakeMove(), 250);
  }
});

modeBtn.addEventListener("click", ()=>{
  if(online){
    alert("Online mode disables AI mode.");
    return;
  }
  mode = (mode==="2p") ? "ai" : "2p";
  modeBtn.textContent = (mode==="ai") ? "Mode: AI" : "Mode: 2 Player";
  setMessage("");
  render();

  if(mode==="ai" && turn===aiSide){
    setTimeout(()=> aiMakeMove(), 250);
  }
});

aiDifficultyEl.addEventListener("change", ()=>{
  if(mode!=="ai") return;
  updateTurnLabel();
});

createRoomBtn.addEventListener("click", ()=>{
  if(online){
    alert("You are already in an online room.");
    return;
  }
  createRoom();
});

joinRoomBtn.addEventListener("click", ()=>{
  if(online){
    alert("You are already in an online room.");
    return;
  }
  joinRoom();
});

// ---------- Boot ----------
function boot(){
  initBoard();
  buildBoardUI();
  render();

  if(!db){
    setMessage("Firebase not connected (offline play still works).");
  }
}

boot();
