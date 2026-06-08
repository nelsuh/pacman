// ── Mazes ─────────────────────────────────────────────────
// '#'=wall '.'=dot 'o'=power pellet ' '=empty 'A'=spawn1 'B'=spawn2
// All mazes are 17 cols x 13 rows, symmetric, connected.
const MAZES = [
  // 0 — Cross corridors (classic)
  [
    "#################",
    "#o.............o#",
    "#.##.##.#.##.##.#",
    "#.##.##.#.##.##.#",
    "#...............#",
    "#.##.#.###.#.##.#",
    "#A...#.....#...B#",
    "#.##.#.###.#.##.#",
    "#...............#",
    "#.##.##.#.##.##.#",
    "#.##.##.#.##.##.#",
    "#o.............o#",
    "#################",
  ],
  // 1 — Pillars
  [
    "#################",
    "#o.............o#",
    "#.#.#.#.#.#.#.#.#",
    "#...............#",
    "#.###.#.#.#.###.#",
    "#.....#.#.#.....#",
    "#A....#.#.#....B#",
    "#.....#.#.#.....#",
    "#.###.#.#.#.###.#",
    "#...............#",
    "#.#.#.#.#.#.#.#.#",
    "#o.............o#",
    "#################",
  ],
  // 2 — Vertical strips
  [
    "#################",
    "#o.............o#",
    "#.##.##.#.##.##.#",
    "#.##.##...##.##.#",
    "#.....##.##.....#",
    "#.###.#...#.###.#",
    "#A....##.##....B#",
    "#.###.#...#.###.#",
    "#.....##.##.....#",
    "#.##.##...##.##.#",
    "#.##.##.#.##.##.#",
    "#o.............o#",
    "#################",
  ],
  // 3 — Open arena
  [
    "#################",
    "#o.............o#",
    "#.#####.#.#####.#",
    "#...............#",
    "#.#.###...###.#.#",
    "#.#...........#.#",
    "#A#...........#B#",
    "#.#...........#.#",
    "#.#.###...###.#.#",
    "#...............#",
    "#.#####.#.#####.#",
    "#o.............o#",
    "#################",
  ],
  // 4 — Dense rooms
  [
    "#################",
    "#o.....#.#.....o#",
    "#.###.#...#.###.#",
    "#.#.....#.....#.#",
    "#.#.###.#.###.#.#",
    "#...#.......#...#",
    "#A#.#.#####.#.#B#",
    "#...#.......#...#",
    "#.#.###.#.###.#.#",
    "#.#.....#.....#.#",
    "#.###.#...#.###.#",
    "#o.....#.#.....o#",
    "#################",
  ],
];

let mazeIndex = 0;
const MAZE = MAZES[0];
const COLS = MAZE[0].length;
const ROWS = MAZE.length;

// For the initial multiplayer game, both clients deterministically derive the
// maze from sorted player IDs so they agree without an extra round-trip.
// For rematches, the HOST (player whose id sorts first) picks the maze and
// ships the index in the "started" message — see requestRematchAsHost / accept.
function initialMazeIndex() {
  if (isMultiplayer && players.length >= 2) {
    const ids = players.slice().sort();
    const seed = ids.join("|");
    let h = 5381;
    for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
    return h % MAZES.length;
  }
  return Math.floor(Math.random() * MAZES.length);
}

function isHost() {
  if (!isMultiplayer || players.length < 2) return true;
  return players.slice().sort()[0] === myId;
}

// ── Game State ────────────────────────────────────────────
let grid = [];          // 2D mutable: '#', '.', 'o', ' '
let spawn = [{x:1,y:6}, {x:15,y:6}];
let totalDots = 0;

let pacmen = [
  null,
  // player 1 (yellow) — spawns on the left, faces right toward opponent
  { x: 1, y: 6, dir: {dx:0,dy:0}, nextDir: {dx:0,dy:0}, facing: {dx: 1, dy: 0}, score: 0, powered: 0, color: "#ffe27a", dead: 0 },
  // player 2 (cyan) — spawns on the right, faces left toward opponent
  { x: 15, y: 6, dir: {dx:0,dy:0}, nextDir: {dx:0,dy:0}, facing: {dx: -1, dy: 0}, score: 0, powered: 0, color: "#7adfff", dead: 0 },
];

const SPEED = 5.5;             // tiles/sec
const POWER_TIME = 6.0;        // seconds powered
const RESPAWN_TIME = 1.5;      // seconds dead before respawn
const SCORE_DOT = 10;
const SCORE_PELLET = 50;
const SCORE_EAT = 100;         // bonus for eating opponent
const PENALTY_DEATH = 50;

let gameOver = false;
let lastWinnerPlayer = 0;
let lastTick = 0;
let rafId = 0;
let animMouth = 0;             // 0..1 mouth open/close cycle

// ── Multiplayer State ─────────────────────────────────────
let myId = null;
let myPlayer = 0;              // 1 or 2
let players = [];              // [p1_id, p2_id]
let playerNames = {};
let playerAvatars = {};
let isMultiplayer = false;
let waitingForOpponent = false;
let connectedCount = 0;
let lastSequence = 0;
let rematchRequested = false;
let rematchState = "idle";

// ── DOM ───────────────────────────────────────────────────
const canvas       = document.getElementById("board");
const ctx          = canvas.getContext("2d");
const statusEl     = document.getElementById("status");
const diffSelect   = document.getElementById("difficulty");
const winnerBanner = document.getElementById("winnerBanner");
const winnerName   = document.getElementById("winnerNameDisplay");
const winnerEmoji  = document.getElementById("winnerEmoji");
const winnerBtn    = document.getElementById("winnerPlayAgain");
const waitingOverlay = document.getElementById("waitingOverlay");
const playBotBtn   = document.getElementById("playBotBtn");
const p1Avatar     = document.getElementById("player1Avatar");
const p2Avatar     = document.getElementById("player2Avatar");
const p1Name       = document.getElementById("player1Name");
const p2Name       = document.getElementById("player2Name");
const p1Score      = document.getElementById("player1Score");
const p2Score      = document.getElementById("player2Score");
const p1Panel      = document.getElementById("player1Panel");
const p2Panel      = document.getElementById("player2Panel");

// ── Init / Reset ──────────────────────────────────────────
function buildGrid() {
  const maze = MAZES[mazeIndex] || MAZES[0];
  grid = [];
  totalDots = 0;
  let spawnA = null, spawnB = null;
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      const ch = maze[y][x];
      if (ch === "#") row.push("#");
      else if (ch === ".") { row.push("."); totalDots++; }
      else if (ch === "o") { row.push("o"); totalDots++; }
      else if (ch === "A") { row.push(" "); spawnA = { x, y }; }
      else if (ch === "B") { row.push(" "); spawnB = { x, y }; }
      else row.push(" ");
    }
    grid.push(row);
  }
  if (spawnA) spawn[0] = spawnA;
  if (spawnB) spawn[1] = spawnB;
}

// resetGame() picks a fresh maze (initial-game default).
// resetGame(true) reuses whatever mazeIndex is currently set — used when the
// rematch handler has already assigned the host-picked index.
function resetGame(keepMaze) {
  if (!keepMaze) mazeIndex = initialMazeIndex();
  buildGrid();
  pacmen[1].x = spawn[0].x; pacmen[1].y = spawn[0].y;
  pacmen[2].x = spawn[1].x; pacmen[2].y = spawn[1].y;
  pacmen[1].facing = { dx:  1, dy: 0 }; // yellow faces right toward opponent
  pacmen[2].facing = { dx: -1, dy: 0 }; // cyan faces left toward opponent
  for (let i = 1; i <= 2; i++) {
    pacmen[i].dir = {dx:0, dy:0};
    pacmen[i].nextDir = {dx:0, dy:0};
    pacmen[i].want = {hx:0, vy:0};
    pacmen[i].stopAtNext = false;
    pacmen[i].score = 0;
    pacmen[i].powered = 0;
    pacmen[i].dead = 0;
  }
  gameOver = false;
  lastWinnerPlayer = 0;
  rematchState = "idle";
  rematchRequested = false;
  hideBanner();
  updateScores();
  updateStatus();
  if (!rafId) startLoop();
}

// ── Drawing ───────────────────────────────────────────────
function tileSize() { return canvas.width / COLS; }

function draw() {
  const ts = tileSize();
  ctx.fillStyle = "#0b0e2c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // walls
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y][x];
      if (c === "#") {
        ctx.fillStyle = "#2730a0";
        ctx.fillRect(x*ts+1, y*ts+1, ts-2, ts-2);
        ctx.fillStyle = "#3d42ff";
        ctx.fillRect(x*ts+3, y*ts+3, ts-6, ts-6);
      } else if (c === ".") {
        ctx.fillStyle = "#fff3a8";
        ctx.beginPath();
        ctx.arc(x*ts+ts/2, y*ts+ts/2, ts*0.10, 0, Math.PI*2);
        ctx.fill();
      } else if (c === "o") {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x*ts+ts/2, y*ts+ts/2, ts*0.28, 0, Math.PI*2);
        ctx.fill();
      }
    }
  }

  // pacmen
  for (let i = 1; i <= 2; i++) {
    const p = pacmen[i];
    if (p.dead > 0) continue;
    drawPac(p, ts);
  }
}

function drawPac(p, ts) {
  const cx = p.x*ts + ts/2;
  const cy = p.y*ts + ts/2;
  const r = ts*0.42;
  // Use current motion if moving; otherwise fall back to last-faced direction
  // so a stopped pac doesn't snap back to facing right.
  const f = (p.dir.dx || p.dir.dy) ? p.dir : (p.facing || { dx: 1, dy: 0 });
  // Mirror for left, rotate for up/down — keeps the eye on top regardless of facing.
  let angle = 0, scaleX = 1;
  if (f.dx < 0)      scaleX = -1;
  else if (f.dy < 0) angle = -Math.PI/2;
  else if (f.dy > 0) angle =  Math.PI/2;

  const mouth = (Math.sin(animMouth * Math.PI * 2) * 0.5 + 0.5) * 0.6 + 0.05;
  ctx.save();
  ctx.translate(cx, cy);
  if (scaleX !== 1) ctx.scale(scaleX, 1);
  else ctx.rotate(angle);

  if (p.powered > 0) {
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, mouth, Math.PI*2 - mouth);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();

  // Eye drawn in screen space, perpendicular to facing so it never sits in the mouth.
  let ex = 0, ey = -r*0.45;
  if (f.dy !== 0) { ex = r*0.45; ey = 0; }
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(cx + ex, cy + ey, r*0.12, 0, Math.PI*2);
  ctx.fill();
}

// ── Movement ──────────────────────────────────────────────
function isWall(x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
  return grid[y][x] === "#";
}

function canMove(p, dx, dy) {
  if (dx === 0 && dy === 0) return false;
  const nx = Math.round(p.x) + dx;
  const ny = Math.round(p.y) + dy;
  return !isWall(nx, ny);
}

function atTileCenter(p, eps=0.08) {
  return Math.abs(p.x - Math.round(p.x)) < eps &&
         Math.abs(p.y - Math.round(p.y)) < eps;
}

function eatAt(p) {
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  const c = grid[ty] && grid[ty][tx];
  if (c !== "." && c !== "o") return;
  const isPellet = c === "o";
  grid[ty][tx] = " ";
  const idx = pacmen.indexOf(p);
  pacmen[idx].score += isPellet ? SCORE_PELLET : SCORE_DOT;
  if (isPellet) pacmen[idx].powered = POWER_TIME;
  totalDots--;
  updateScores();
  if (isMultiplayer && idx === myPlayer) {
    Usion.game.realtime("eat", {
      x: tx, y: ty, pellet: isPellet,
      score: pacmen[idx].score, powered: pacmen[idx].powered,
    });
  }
  if (totalDots <= 0) endGame();
}

// Remove a dot/pellet the opponent is standing on, WITHOUT awarding score.
// Score arrives authoritatively via "pos"/"eat" messages; this only keeps the
// grid in sync from the opponent's position so a dropped "eat" realtime message
// can't leave a phantom dot behind (which would desync the game-over check).
function clearDotUnder(p) {
  const tx = Math.round(p.x);
  const ty = Math.round(p.y);
  const c = grid[ty] && grid[ty][tx];
  if (c !== "." && c !== "o") return;
  grid[ty][tx] = " ";
  totalDots--;
  updateScores();
  if (totalDots <= 0) endGame();
}

// Diagonal-intent steering for the locally-controlled pac. `want` may hold BOTH
// a horizontal (hx) and vertical (vy) component (e.g. drag up-right). At each
// tile center we turn onto whichever desired axis just opened up — preferring
// the axis perpendicular to current motion so the pac zig-zags toward the
// diagonal target ("going right, turn up when up opens; going up, turn right
// when right opens"). Returns the chosen heading, or null when there's no
// active intent (opponent / bot pacs have no `want`, so they fall back to the
// nextDir mechanism untouched).
function chooseTurn(p) {
  const w = p.want;
  if (!w || (!w.hx && !w.vy)) return null;
  const horiz = w.hx ? { dx: w.hx, dy: 0 } : null;
  const vert  = w.vy ? { dx: 0, dy: w.vy } : null;
  // moving vertically → try to turn horizontal first; otherwise try vertical first
  const pref = (p.dir.dy !== 0) ? [horiz, vert] : [vert, horiz];
  for (const c of pref) if (c && canMove(p, c.dx, c.dy)) return c;
  // no desired turn available here → keep current heading (re-checked next center)
  return (p.dir.dx || p.dir.dy) ? { dx: p.dir.dx, dy: p.dir.dy } : null;
}

// Substep movement: never advances past a tile center in a single sub-step,
// so wall-stop and direction changes fire exactly at each center even when
// dt is large (tab switch, lag, etc.). Prevents wall-clipping.
function step(p, dt) {
  if (p.dead > 0) {
    p.dead -= dt;
    if (p.dead <= 0) {
      p.dead = 0;
      const idx = pacmen.indexOf(p) - 1;
      p.x = spawn[idx].x; p.y = spawn[idx].y;
      p.dir = { dx: 0, dy: 0 };
      p.nextDir = { dx: 0, dy: 0 };
      p.facing = idx === 0 ? { dx: 1, dy: 0 } : { dx: -1, dy: 0 };
    }
    return;
  }
  if (p.powered > 0) p.powered = Math.max(0, p.powered - dt);

  const speed = SPEED * (p.powered > 0 ? 1.1 : 1.0);
  let remaining = dt * speed;
  let guard = 32;

  while (remaining > 1e-6 && guard-- > 0) {
    const tx = Math.round(p.x);
    const ty = Math.round(p.y);
    const atCenter = Math.abs(p.x - tx) < 1e-3 && Math.abs(p.y - ty) < 1e-3;

    if (atCenter) {
      p.x = tx; p.y = ty;
      // diagonal-intent steering takes priority for the controlled pac…
      const turn = chooseTurn(p);
      if (turn && canMove(p, turn.dx, turn.dy)) {
        p.dir = { dx: turn.dx, dy: turn.dy };
        p.facing = { dx: p.dir.dx, dy: p.dir.dy };
      // …otherwise apply the single buffered direction (opponent / bot / keyboard)
      } else if ((p.nextDir.dx || p.nextDir.dy) && canMove(p, p.nextDir.dx, p.nextDir.dy)) {
        p.dir = { dx: p.nextDir.dx, dy: p.nextDir.dy };
        p.facing = { dx: p.dir.dx, dy: p.dir.dy };
      } else if (p.stopAtNext) {
        // finger lifted (touch) → halt at this center, keeping grid alignment
        p.dir = { dx: 0, dy: 0 };
        p.stopAtNext = false;
      }
      // stop if current direction is blocked by a wall
      if (!canMove(p, p.dir.dx, p.dir.dy)) {
        p.dir = { dx: 0, dy: 0 };
      }
      eatAt(p);
      if (p.dir.dx === 0 && p.dir.dy === 0) break;
    }

    // distance to the NEXT tile center along motion axis (using floor/ceil so
    // we never skip a center when p is already past the half-tile mark)
    let distToNext;
    if (p.dir.dx > 0)      distToNext = (Math.floor(p.x) + 1) - p.x;
    else if (p.dir.dx < 0) distToNext = p.x - (Math.ceil(p.x) - 1);
    else if (p.dir.dy > 0) distToNext = (Math.floor(p.y) + 1) - p.y;
    else if (p.dir.dy < 0) distToNext = p.y - (Math.ceil(p.y) - 1);
    else break;
    if (distToNext <= 1e-9) distToNext = 1;

    const advance = Math.min(remaining, distToNext);
    p.x += p.dir.dx * advance;
    p.y += p.dir.dy * advance;
    remaining -= advance;
  }
}

function checkCollision() {
  if (gameOver) return;
  const p1 = pacmen[1], p2 = pacmen[2];
  if (p1.dead > 0 || p2.dead > 0) return;
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  if (dx*dx + dy*dy > 0.6*0.6) return;

  if (p1.powered > 0 && p2.powered <= 0) {
    p1.score += SCORE_EAT;
    p2.score = Math.max(0, p2.score - PENALTY_DEATH);
    p2.dead = RESPAWN_TIME;
    updateScores();
  } else if (p2.powered > 0 && p1.powered <= 0) {
    p2.score += SCORE_EAT;
    p1.score = Math.max(0, p1.score - PENALTY_DEATH);
    p1.dead = RESPAWN_TIME;
    updateScores();
  }
}

function endGame() {
  gameOver = true;
  const s1 = pacmen[1].score, s2 = pacmen[2].score;
  if (s1 > s2) lastWinnerPlayer = 1;
  else if (s2 > s1) lastWinnerPlayer = 2;
  else lastWinnerPlayer = 0;
  showWinner();
}

// ── Loop ──────────────────────────────────────────────────
function startLoop() {
  lastTick = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    animMouth = (animMouth + dt * 4) % 1;

    if (!gameOver) {
      step(pacmen[1], dt);
      step(pacmen[2], dt);
      if (!isMultiplayer) botThink(pacmen[2], dt);
      checkCollision();
      // Reconcile dots from the opponent's position so a lost "eat" message
      // can't leave phantom dots and desync the totalDots / game-over check.
      if (isMultiplayer && !gameOver) {
        const opp = pacmen[myPlayer === 1 ? 2 : 1];
        if (opp.dead <= 0) clearDotUnder(opp);
      }
      // periodic position broadcast
      if (isMultiplayer) maybeBroadcastPos(now);
    }
    draw();
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

// ── Input ─────────────────────────────────────────────────
function setMyDir(dx, dy) {
  if (gameOver) return;
  const me = isMultiplayer ? myPlayer : 1;
  if (!me) return;
  const p = pacmen[me];
  // `want` may carry both axes (diagonal drag) — chooseTurn() resolves it to a
  // legal heading at each tile center.
  p.want = { hx: dx, vy: dy };
  p.stopAtNext = false;
  // single-axis representative for the opponent-facing broadcast / buffered turn
  p.nextDir = dx ? { dx, dy: 0 } : { dx: 0, dy };
}

// Touch: lifting the finger halts the pac at the next tile center (instead of
// coasting forever in the last-dragged direction).
function stopMyPac() {
  if (gameOver) return;
  const me = isMultiplayer ? myPlayer : 1;
  if (!me) return;
  const p = pacmen[me];
  p.want = { hx: 0, vy: 0 };
  p.nextDir = { dx: 0, dy: 0 };
  p.stopAtNext = true;
}

document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowUp": case "w": case "W": setMyDir(0, -1); e.preventDefault(); break;
    case "ArrowDown": case "s": case "S": setMyDir(0, 1); e.preventDefault(); break;
    case "ArrowLeft": case "a": case "A": setMyDir(-1, 0); e.preventDefault(); break;
    case "ArrowRight": case "d": case "D": setMyDir(1, 0); e.preventDefault(); break;
  }
});

// ── Invisible joystick (mobile only) ──────────────────────
// No visual at all — touch anywhere on the canvas, drag in a direction, and
// the dominant axis of the drag from the touch origin sets the heading.
// The origin re-anchors when you cross the deadzone in a new direction so
// re-aiming feels instant without lifting your finger.
const JOY_DEAD = 18;  // px the finger must travel before a direction registers

let joyOrigin = null;
let joyTouchId = null;

canvas.addEventListener("touchstart", (e) => {
  if (joyTouchId !== null) return;
  const t = e.changedTouches[0];
  joyTouchId = t.identifier;
  joyOrigin = { x: t.clientX, y: t.clientY };
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  if (!joyOrigin) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== joyTouchId) continue;
    const dx = t.clientX - joyOrigin.x;
    const dy = t.clientY - joyOrigin.y;
    // Per-axis intent: a diagonal drag arms BOTH axes, so the pac steers toward
    // whichever turn opens first. Keep the origin fixed (no re-anchor) so the
    // offset keeps expressing the diagonal; bring an axis back inside the
    // deadzone to drop that component and aim along a single axis again.
    const hx = Math.abs(dx) > JOY_DEAD ? (dx > 0 ? 1 : -1) : 0;
    const vy = Math.abs(dy) > JOY_DEAD ? (dy > 0 ? 1 : -1) : 0;
    if (hx || vy) setMyDir(hx, vy);
    e.preventDefault();
    break;
  }
}, { passive: false });

function endTouch(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joyTouchId) {
      joyOrigin = null;
      joyTouchId = null;
      stopMyPac();
      break;
    }
  }
}
canvas.addEventListener("touchend",    endTouch, { passive: true });
canvas.addEventListener("touchcancel", endTouch, { passive: true });

// ── Bot AI ────────────────────────────────────────────────
let botRetargetTimer = 0;
let botTarget = null;

function botThink(p, dt) {
  if (p.dead > 0) return;
  botRetargetTimer -= dt;
  const diff = diffSelect.value;
  const retargetEvery = diff === "hard" ? 0.4 : diff === "medium" ? 0.8 : 1.6;

  if (atTileCenter(p)) {
    if (botRetargetTimer <= 0 || !botTarget) {
      botTarget = pickBotTarget(p);
      botRetargetTimer = retargetEvery;
    }
    const tx = Math.round(p.x), ty = Math.round(p.y);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    // skip reverse unless dead-end
    const opts = dirs.filter(([dx,dy]) => !isWall(tx+dx, ty+dy) &&
      !(dx === -p.dir.dx && dy === -p.dir.dy && (p.dir.dx || p.dir.dy)));
    const choices = opts.length > 0 ? opts : dirs.filter(([dx,dy]) => !isWall(tx+dx, ty+dy));
    if (choices.length === 0) return;

    // pick dir minimizing manhattan distance to target (or away if scared)
    const opp = pacmen[1];
    const scared = opp.powered > 0 && p.powered <= 0;
    let best = choices[0];
    let bestScore = -Infinity;
    for (const [dx, dy] of choices) {
      const nx = tx + dx, ny = ty + dy;
      let d = botTarget ? -(Math.abs(nx - botTarget.x) + Math.abs(ny - botTarget.y)) : 0;
      if (scared) d = -(Math.abs(nx - opp.x) + Math.abs(ny - opp.y)); // farther is better
      // small randomness on easy
      if (diff === "easy") d += (Math.random() - 0.5) * 4;
      if (d > bestScore) { bestScore = d; best = [dx, dy]; }
    }
    p.nextDir = { dx: best[0], dy: best[1] };
  }
}

function pickBotTarget(p) {
  // hunt opponent if powered, else nearest dot/pellet
  const opp = pacmen[1];
  if (p.powered > 0 && opp.dead <= 0) {
    return { x: Math.round(opp.x), y: Math.round(opp.y) };
  }
  // pellets prioritized when low score difference
  let best = null, bestDist = Infinity;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = grid[y][x];
      if (c !== "." && c !== "o") continue;
      const d = Math.abs(x - p.x) + Math.abs(y - p.y) - (c === "o" ? 3 : 0);
      if (d < bestDist) { bestDist = d; best = { x, y }; }
    }
  }
  return best;
}

// ── Multiplayer ───────────────────────────────────────────
let lastPosBroadcast = 0;
function maybeBroadcastPos(now) {
  if (now - lastPosBroadcast < 80) return;
  lastPosBroadcast = now;
  const me = pacmen[myPlayer];
  Usion.game.realtime("pos", {
    x: me.x, y: me.y,
    dx: me.dir.dx, dy: me.dir.dy,
    ndx: me.nextDir.dx, ndy: me.nextDir.dy,
    fx: (me.facing && me.facing.dx) || 0,
    fy: (me.facing && me.facing.dy) || 0,
    powered: me.powered, dead: me.dead, score: me.score,
  });
}

let bootedStandalone = false;
Usion.init(async function(config) {
  if (bootedStandalone) return;
  myId = config.userId;
  playerNames[myId] = config.userName || "You";
  if (config.userAvatar) playerAvatars[myId] = config.userAvatar;

  if (config.roomId) {
    showWaiting();
    await setupMultiplayer(config.roomId);
  } else {
    setupBotMode();
  }
});

// Standalone fallback: if we're not embedded in a host (no INIT postMessage
// within 600ms), boot in solo bot mode so the game works when the file is
// opened directly.
setTimeout(() => {
  if (Usion._initialized) return;
  bootedStandalone = true;
  myId = "local-" + Math.random().toString(36).slice(2, 8);
  playerNames[myId] = "You";
  setupBotMode();
}, 600);

async function setupMultiplayer(roomId) {
  try {
    await Usion.game.connect();
    Usion.game.onJoined(onJoined);
    Usion.game.onPlayerJoined(onPlayerJoined);
    Usion.game.onPlayerLeft(() => {
      connectedCount = Math.max(0, connectedCount - 1);
      if (!gameOver) updateStatus("Opponent left");
    });
    Usion.game.onAction(() => {});
    Usion.game.onSync(() => {});
    Usion.game.onRealtime(onRealtime);
    Usion.game.onRematchRequest(onRematchRequest);
    Usion.game.onGameRestarted(onGameRestarted);
    Usion.game.onDisconnect(() => { if (!gameOver) updateStatus("Disconnected…"); });
    Usion.game.onReconnect(() => { if (!gameOver) updateStatus(); });
    await Usion.game.join(roomId);
  } catch (err) {
    console.error("MP setup failed:", err);
    setupBotMode();
  }
}

function onJoined(data) {
  players = data.player_ids || [];
  connectedCount = Number(data.connected_count || 0);
  if (data.sequence !== undefined) lastSequence = data.sequence;
  Usion.game.realtime("info", {
    name: playerNames[myId],
    avatar: playerAvatars[myId] || null,
  });
  if (connectedCount >= 2 && waitingForOpponent) startOnline();
}

function onPlayerJoined(data) {
  if (data.player_ids) players = data.player_ids;
  if (data.player && data.player.is_connected) {
    connectedCount = Math.max(connectedCount, 2);
  }
  Usion.game.realtime("info", {
    name: playerNames[myId],
    avatar: playerAvatars[myId] || null,
  });
  if (connectedCount >= 2 && waitingForOpponent) startOnline();
}

function onRealtime(data) {
  if (data.player_id === myId) return;
  if (data.action_type === "info") {
    if (data.action_data.name)   playerNames[data.player_id]   = data.action_data.name;
    if (data.action_data.avatar) playerAvatars[data.player_id] = data.action_data.avatar;
    updatePanels();
    return;
  }
  if (data.action_type === "pos" && data.action_data) {
    const idx = players.indexOf(data.player_id) + 1;
    if (idx !== 1 && idx !== 2) return;
    const p = pacmen[idx];
    p.x = data.action_data.x;
    p.y = data.action_data.y;
    p.dir = { dx: data.action_data.dx, dy: data.action_data.dy };
    p.nextDir = { dx: data.action_data.ndx, dy: data.action_data.ndy };
    if (data.action_data.fx !== undefined || data.action_data.fy !== undefined) {
      const fx = data.action_data.fx || 0;
      const fy = data.action_data.fy || 0;
      if (fx || fy) p.facing = { dx: fx, dy: fy };
    }
    p.powered = data.action_data.powered || 0;
    p.dead = data.action_data.dead || 0;
    p.score = data.action_data.score || 0;
    updateScores();
    return;
  }
  if (data.action_type === "eat" && data.action_data) {
    const { x, y, pellet, score, powered } = data.action_data;
    if (grid[y] && (grid[y][x] === "." || grid[y][x] === "o")) {
      grid[y][x] = " ";
      totalDots--;
    }
    const idx = players.indexOf(data.player_id) + 1;
    if (idx === 1 || idx === 2) {
      pacmen[idx].score = score;
      if (pellet) pacmen[idx].powered = powered;
      updateScores();
    }
    if (totalDots <= 0) endGame();
    return;
  }
  if (data.action_type === "rematch" && data.action_data) {
    if (data.action_data.state === "requested") {
      // Both ready → host picks the maze and ships it in "started".
      // Non-host just waits.
      if (rematchRequested && isHost()) {
        hostStartRematch();
      } else if (!rematchRequested) {
        rematchState = "requested";
        syncRematchUi();
      }
    } else if (data.action_data.state === "started") {
      if (typeof data.action_data.mazeIndex === "number") {
        mazeIndex = data.action_data.mazeIndex;
      }
      resetGame(true);
    }
  }
}

function onRematchRequest(data) {
  if (data.player_id === myId) return;
  if (rematchRequested && isHost()) {
    hostStartRematch();
    return;
  }
  if (!rematchRequested) {
    rematchState = "requested";
    syncRematchUi();
  }
}

// Host picks the next maze, broadcasts it as "started", and resets locally.
// Only the host runs this — guarantees both clients use the same mazeIndex.
function hostStartRematch() {
  mazeIndex = Math.floor(Math.random() * MAZES.length);
  Usion.game.realtime("rematch", { state: "started", mazeIndex });
  resetGame(true);
}

function onGameRestarted() {
  resetGame();
}

function startOnline() {
  isMultiplayer = true;
  waitingForOpponent = false;
  myPlayer = players.indexOf(myId) + 1;
  hideWaiting();
  updatePanels();
  diffSelect.style.display = "none";
  resetGame();
}

function setupBotMode() {
  isMultiplayer = false;
  hideWaiting();
  myPlayer = 1;
  p1Name.textContent = playerNames[myId] || "You";
  p2Name.textContent = "Bot";
  if (playerAvatars[myId]) p1Avatar.src = playerAvatars[myId];
  p2Avatar.src = "https://api.dicebear.com/7.x/bottts/svg?seed=cyan";
  resetGame();
}

function updatePanels() {
  const p1 = players[0], p2 = players[1];
  if (p1) {
    p1Name.textContent = p1 === myId ? "You" : (playerNames[p1] || "Opponent");
    if (playerAvatars[p1]) p1Avatar.src = playerAvatars[p1];
  }
  if (p2) {
    p2Name.textContent = p2 === myId ? "You" : (playerNames[p2] || "Opponent");
    if (playerAvatars[p2]) p2Avatar.src = playerAvatars[p2];
  }
}

// ── UI ────────────────────────────────────────────────────
function showWaiting() {
  waitingForOpponent = true;
  waitingOverlay.classList.add("show");
}
function hideWaiting() { waitingOverlay.classList.remove("show"); }

playBotBtn.addEventListener("click", () => { setupBotMode(); });

function updateScores() {
  p1Score.textContent = String(pacmen[1].score);
  p2Score.textContent = String(pacmen[2].score);
  p1Panel.classList.toggle("powered", pacmen[1].powered > 0);
  p2Panel.classList.toggle("powered", pacmen[2].powered > 0);
}

function updateStatus(text) {
  if (text) { statusEl.hidden = false; statusEl.textContent = text; return; }
  if (gameOver) return;
  statusEl.hidden = false;
  const hint = ("ontouchstart" in window) ? "Drag anywhere to move" : "Arrow keys or WASD to move";
  statusEl.textContent = isMultiplayer ? "Eat dots! Power up to eat opponent." : hint;
}

function hideBanner() { winnerBanner.hidden = true; }

function showWinner() {
  let name, emoji;
  if (lastWinnerPlayer === 0) { name = "Tie game"; emoji = "🤝"; }
  else {
    const idx = lastWinnerPlayer;
    if (isMultiplayer) {
      const id = players[idx - 1];
      name = id === myId ? "You" : (playerNames[id] || "Opponent");
    } else {
      name = idx === 1 ? "You" : "Bot";
    }
    emoji = idx === 1 ? "🟡" : "🔵";
  }
  winnerName.textContent = name;
  winnerEmoji.textContent = emoji;
  statusEl.hidden = true;
  if (isMultiplayer) syncRematchUi();
  else {
    winnerBtn.textContent = "Play Again";
    winnerBtn.disabled = false;
    winnerBtn.onclick = () => { hideBanner(); resetGame(); };
  }
  winnerBanner.hidden = false;
}

function clickRematch() {
  rematchRequested = true;
  Usion.game.realtime("rematch", { state: "requested" });
  Usion.game.requestRematch();
  // Both sides have now requested → if I'm the host, ship the start.
  if (rematchState === "requested" && isHost()) {
    hostStartRematch();
    return;
  }
  rematchState = "requested";
  syncRematchUi();
}

function syncRematchUi() {
  if (rematchState === "requested" && !rematchRequested) {
    winnerBtn.textContent = "Accept Rematch";
    winnerBtn.disabled = false;
    winnerBtn.onclick = clickRematch;
  } else if (rematchRequested) {
    winnerBtn.textContent = "Waiting for rematch…";
    winnerBtn.disabled = true;
  } else {
    winnerBtn.textContent = "Rematch";
    winnerBtn.disabled = false;
    winnerBtn.onclick = clickRematch;
  }
}
