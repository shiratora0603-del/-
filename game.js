/* スパイダーソリティア — 効果音付き
 * 効果音は Web Audio API で生成（外部ファイル不要）
 */
(() => {
  "use strict";

  const SUITS = ["♠", "♥", "♦", "♣"];
  const RED = new Set(["♥", "♦"]);
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const NUM_COLUMNS = 10;

  // ---------- 効果音（Web Audio） ----------
  const Sound = {
    ctx: null,
    enabled: true,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(freq, dur, type = "sine", gain = 0.15, when = 0) {
      if (!this.enabled || !this.ctx) return;
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    // カードを置く
    place() { this.ensure(); this.tone(330, 0.08, "triangle", 0.18); },
    // カードを拾う/選択
    pick() { this.ensure(); this.tone(520, 0.05, "sine", 0.12); },
    // 配る（パラパラ）
    deal() {
      this.ensure();
      for (let i = 0; i < 5; i++) this.tone(260 + Math.random() * 80, 0.05, "triangle", 0.08, i * 0.05);
    },
    // 無効な操作
    invalid() { this.ensure(); this.tone(160, 0.18, "sawtooth", 0.12); },
    // 1スート完成
    complete() {
      this.ensure();
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, "sine", 0.18, i * 0.09));
    },
    // クリア（ファンファーレ）
    win() {
      this.ensure();
      const notes = [523, 587, 659, 784, 880, 1047, 1318];
      notes.forEach((f, i) => this.tone(f, 0.28, "triangle", 0.2, i * 0.12));
    },
    // 戻す
    undo() { this.ensure(); this.tone(400, 0.06, "sine", 0.1); this.tone(300, 0.06, "sine", 0.1, 0.06); },
  };

  // ---------- ゲーム状態 ----------
  let state = null;

  function makeCard(suit, rank) {
    return { suit, rank, value: RANKS.indexOf(rank) + 1, faceUp: false };
  }

  function buildDeck(numSuits) {
    // スパイダーは常に104枚（8デッキ分のランク）。指定スート数を循環使用。
    const usedSuits = SUITS.slice(0, numSuits);
    const deck = [];
    const copies = 8 / numSuits; // 1→8, 2→4, 4→2
    for (let c = 0; c < copies; c++) {
      for (const suit of usedSuits) {
        for (const rank of RANKS) deck.push(makeCard(suit, rank));
      }
    }
    return deck; // 104枚
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function newGame(numSuits) {
    const deck = shuffle(buildDeck(numSuits));
    const columns = Array.from({ length: NUM_COLUMNS }, () => []);
    // 最初の4列は6枚、残り6列は5枚 = 54枚
    for (let i = 0; i < 54; i++) {
      const col = i % NUM_COLUMNS;
      columns[col].push(deck.pop());
    }
    // 各列の一番上だけ表向き
    for (const col of columns) {
      if (col.length) col[col.length - 1].faceUp = true;
    }
    // 残り50枚を10枚ずつ5回の山札に
    const stock = [];
    while (deck.length) stock.push(deck.splice(0, NUM_COLUMNS));

    state = {
      numSuits,
      columns,
      stock,
      completed: 0,
      score: 500,
      moves: 0,
      selected: null, // { col, index }
      history: [],
      won: false,
    };
    render();
  }

  // ---------- 連続列の判定 ----------
  // index から末尾までが「同スートで降順に連続」しているか
  function isMovableSequence(col, index) {
    const cards = state.columns[col];
    if (index < 0 || index >= cards.length) return false;
    if (!cards[index].faceUp) return false;
    for (let i = index; i < cards.length - 1; i++) {
      const a = cards[i], b = cards[i + 1];
      if (a.suit !== b.suit) return false;
      if (a.value !== b.value + 1) return false;
    }
    return true;
  }

  function canDropOn(targetCol, movingValue) {
    const cards = state.columns[targetCol];
    if (cards.length === 0) return true; // 空列には何でも置ける
    const top = cards[cards.length - 1];
    return top.faceUp && top.value === movingValue + 1;
  }

  // ---------- 操作 ----------
  function snapshot() {
    return JSON.stringify({
      columns: state.columns,
      stock: state.stock,
      completed: state.completed,
      score: state.score,
      moves: state.moves,
    });
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 200) state.history.shift();
  }

  function undo() {
    if (!state.history.length) { Sound.invalid(); return; }
    const snap = JSON.parse(state.history.pop());
    state.columns = snap.columns;
    state.stock = snap.stock;
    state.completed = snap.completed;
    state.score = snap.score;
    state.moves = snap.moves;
    state.selected = null;
    state.won = false;
    Sound.undo();
    render();
  }

  function selectAt(col, index) {
    if (isMovableSequence(col, index)) {
      state.selected = { col, index };
      Sound.pick();
    } else {
      Sound.invalid();
      state.selected = null;
    }
    render();
  }

  function tryMoveTo(targetCol) {
    const sel = state.selected;
    if (!sel) return false;
    const moving = state.columns[sel.col].slice(sel.index);
    if (sel.col === targetCol) { state.selected = null; render(); return false; }
    if (!canDropOn(targetCol, moving[0].value)) {
      Sound.invalid();
      state.selected = null;
      render();
      return false;
    }
    pushHistory();
    state.columns[sel.col].splice(sel.index);
    state.columns[targetCol].push(...moving);
    // 移動元の新しい末尾を表向きに
    const src = state.columns[sel.col];
    if (src.length && !src[src.length - 1].faceUp) src[src.length - 1].faceUp = true;
    state.score -= 1;
    state.moves += 1;
    state.selected = null;
    Sound.place();
    checkCompletedSequences(targetCol);
    render();
    checkWin();
    return true;
  }

  // K→A の同スート13枚が揃ったら除去
  function checkCompletedSequences(col) {
    const cards = state.columns[col];
    if (cards.length < 13) return;
    const start = cards.length - 13;
    for (let i = start; i < cards.length; i++) {
      if (!cards[i].faceUp) return;
    }
    // 末尾13枚が K(13)→A(1) 同スート連番か
    for (let i = start; i < cards.length; i++) {
      if (cards[i].value !== 13 - (i - start)) return;
      if (cards[i].suit !== cards[start].suit) return;
    }
    cards.splice(start, 13);
    if (cards.length && !cards[cards.length - 1].faceUp) {
      cards[cards.length - 1].faceUp = true;
    }
    state.completed += 1;
    state.score += 100;
    Sound.complete();
  }

  function dealFromStock() {
    if (!state.stock.length) { Sound.invalid(); return; }
    // 空の列があると配れない（ルール）
    if (state.columns.some(c => c.length === 0)) {
      Sound.invalid();
      flashMessage();
      return;
    }
    pushHistory();
    const row = state.stock.pop();
    row.forEach((card, i) => {
      card.faceUp = true;
      state.columns[i].push(card);
    });
    state.moves += 1;
    Sound.deal();
    // 配った後に完成列ができることもある
    for (let c = 0; c < NUM_COLUMNS; c++) checkCompletedSequences(c);
    render();
    checkWin();
  }

  function flashMessage() {
    const el = document.getElementById("stockCount");
    el.style.color = "#ff5252";
    setTimeout(() => { el.style.color = ""; }, 500);
  }

  function checkWin() {
    if (state.completed >= 8 && !state.won) {
      state.won = true;
      Sound.win();
      const win = document.getElementById("winOverlay");
      document.getElementById("winText").textContent =
        `得点 ${state.score} ／ 手数 ${state.moves} でクリアしました！`;
      win.classList.remove("hidden");
    }
  }

  // ---------- ヒント ----------
  function showHint() {
    // 移動可能な手を探す（より長い列・実のある移動を優先）
    let best = null;
    for (let from = 0; from < NUM_COLUMNS; from++) {
      const cards = state.columns[from];
      for (let i = 0; i < cards.length; i++) {
        if (!isMovableSequence(from, i)) continue;
        const moving = cards.slice(i);
        for (let to = 0; to < NUM_COLUMNS; to++) {
          if (to === from) continue;
          if (!canDropOn(to, moving[0].value)) continue;
          const target = state.columns[to];
          // 同スートに繋がる手を高評価
          let scoreH = moving.length;
          if (target.length && target[target.length - 1].suit === moving[0].suit) scoreH += 50;
          if (target.length === 0) scoreH -= 5; // 空列移動は後回し
          if (i > 0 && !cards[i - 1].faceUp) scoreH += 20; // 裏向きを表に出せる
          if (!best || scoreH > best.scoreH) best = { from, i, to, scoreH };
        }
      }
    }
    if (!best) {
      Sound.invalid();
      flashMessage();
      return;
    }
    Sound.pick();
    render();
    // 対象カードを点滅
    const colEl = document.querySelector(`.column[data-col="${best.from}"]`);
    if (colEl) {
      const cardEls = colEl.querySelectorAll(".card");
      if (cardEls[best.i]) cardEls[best.i].classList.add("hint");
    }
    const targetEl = document.querySelector(`.column[data-col="${best.to}"]`);
    if (targetEl) {
      const cardEls = targetEl.querySelectorAll(".card");
      const last = cardEls[cardEls.length - 1];
      if (last) last.classList.add("hint");
      else targetEl.classList.add("hint");
    }
  }

  // ---------- 描画 ----------
  const board = document.getElementById("board");

  function render() {
    board.innerHTML = "";
    state.columns.forEach((cards, col) => {
      const colEl = document.createElement("div");
      colEl.className = "column" + (cards.length === 0 ? " empty-slot" : "");
      colEl.dataset.col = col;
      colEl.style.height =
        (cards.length ? (cards.length - 1) * stackOffset() + cardHeight() : cardHeight()) + "px";

      cards.forEach((card, index) => {
        const cardEl = document.createElement("div");
        cardEl.className = "card " + (card.faceUp ? (RED.has(card.suit) ? "red" : "black") : "face-down");
        cardEl.style.top = index * stackOffset() + "px";
        if (state.selected && state.selected.col === col && index >= state.selected.index) {
          cardEl.classList.add("selected");
        }
        if (card.faceUp) {
          cardEl.innerHTML =
            `<div class="corner top">${card.rank}<br>${card.suit}</div>` +
            `<div class="center">${card.suit}</div>` +
            `<div class="corner bottom">${card.rank}<br>${card.suit}</div>`;
        }
        cardEl.addEventListener("click", (e) => {
          e.stopPropagation();
          onCardClick(col, index);
        });
        colEl.appendChild(cardEl);
      });

      // 列（空白部分含む）クリックで移動先に
      colEl.addEventListener("click", () => onColumnClick(col));
      board.appendChild(colEl);
    });
    updateStats();
    renderStock();
  }

  function onCardClick(col, index) {
    if (state.won) return;
    if (state.selected) {
      // 選択中 → 同じ列の別カードを選び直すか、移動先指定
      if (state.selected.col === col) {
        // 自分の列をクリック：選択し直し or 解除
        if (index === state.selected.index) { state.selected = null; render(); return; }
        selectAt(col, index);
        return;
      }
      tryMoveTo(col);
    } else {
      selectAt(col, index);
    }
  }

  function onColumnClick(col) {
    if (state.won) return;
    if (state.selected) tryMoveTo(col);
  }

  function renderStock() {
    const pile = document.getElementById("stockPile");
    pile.innerHTML = "";
    const count = state.stock.length;
    pile.classList.toggle("disabled", count === 0);
    for (let i = 0; i < count; i++) {
      const back = document.createElement("div");
      back.className = "deck-back";
      pile.appendChild(back);
    }
    document.getElementById("stockCount").textContent = count;
  }

  function updateStats() {
    document.getElementById("score").textContent = state.score;
    document.getElementById("moves").textContent = state.moves;
    document.getElementById("completed").textContent = state.completed;
  }

  function stackOffset() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue("--stack-offset"));
  }
  function cardHeight() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue("--card-h"));
  }

  // ---------- UI 配線 ----------
  document.getElementById("newGameBtn").addEventListener("click", () => {
    Sound.ensure();
    newGame(parseInt(document.getElementById("suitSelect").value));
  });
  document.getElementById("suitSelect").addEventListener("change", (e) => {
    newGame(parseInt(e.target.value));
  });
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("hintBtn").addEventListener("click", () => { Sound.ensure(); showHint(); });
  document.getElementById("stockArea").addEventListener("click", () => { Sound.ensure(); dealFromStock(); });
  document.getElementById("winNewGameBtn").addEventListener("click", () => {
    document.getElementById("winOverlay").classList.add("hidden");
    newGame(parseInt(document.getElementById("suitSelect").value));
  });

  const soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", () => {
    Sound.enabled = !Sound.enabled;
    Sound.ensure();
    soundBtn.textContent = Sound.enabled ? "🔊 音 ON" : "🔇 音 OFF";
    if (Sound.enabled) Sound.pick();
  });

  // 空白クリックで選択解除
  document.addEventListener("click", (e) => {
    if (state && state.selected && !e.target.closest(".column") && !e.target.closest(".stock-area")) {
      state.selected = null;
      render();
    }
  });

  // 初回スタート
  newGame(2);
})();
