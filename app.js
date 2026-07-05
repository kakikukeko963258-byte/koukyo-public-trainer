const DATA = window.HOKEN_DATA;
const MISS_KEY = "koukyo-public-misses-v1";

const state = {
  mode: "study",
  category: "all",
  examOnly: true,
  studyIndex: 0,
  studyOrder: [],
  revealed: false,
  quiz: null,
  practice: null,
  listKind: "terms",
  query: "",
  nextLockedUntil: 0
};

const view = document.querySelector("#view");
const statusChip = document.querySelector("#statusChip");
const categoryFilter = document.querySelector("#categoryFilter");
const examOnly = document.querySelector("#examOnly");
const floatingNext = document.querySelector("#floatingNext");

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shuffle(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sameSet(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function filteredCards() {
  return DATA.cards.filter((card) => {
    if (state.category !== "all" && card.category !== state.category) return false;
    if (state.examOnly && !card.tags.includes("マーカー")) return false;
    return true;
  });
}

function buildQuestions() {
  const cards = filteredCards();
  const generated = cards.flatMap((card) => {
    const byPrompt = {
      id: `prompt-${card.id}`,
      sourceId: card.id,
      category: card.category,
      stem: card.prompt,
      answer: card.answer,
      choices: choicesFrom("answer", card.answer, card.category),
      explanation: card.explanation,
      tags: card.tags
    };

    const byDefinition = {
      id: `term-${card.id}`,
      sourceId: card.id,
      category: card.category,
      stem: `次の説明に当てはまる語句を選べ。${card.definition}`,
      answer: card.term,
      choices: choicesFrom("term", card.term, card.category),
      explanation: `${card.term}: ${card.explanation}`,
      tags: card.tags
    };

    return [byPrompt, byDefinition];
  });

  const fixed = DATA.fixedQuestions.filter((question) => {
    if (state.category !== "all" && question.category !== state.category) return false;
    if (state.examOnly && !question.tags.includes("マーカー")) return false;
    return true;
  });

  return shuffle([...fixed, ...generated]).map((question) => ({
    ...question,
    choices: normalizeChoices(question.answer, question.choices)
  }));
}

function choicesFrom(field, answer, category) {
  const pool = DATA.cards
    .filter((card) => card.category === category)
    .map((card) => card[field])
    .filter((value) => value && value !== answer);
  return normalizeChoices(answer, shuffle(pool).slice(0, 3));
}

function normalizeChoices(answer, choices) {
  const unique = [];
  [answer, ...(choices || [])].forEach((choice) => {
    if (choice && !unique.includes(choice)) unique.push(choice);
  });

  const fallback = DATA.cards
    .flatMap((card) => [card.term, card.answer])
    .filter((choice) => choice && !unique.includes(choice));

  while (unique.length < 4 && fallback.length) {
    const next = fallback.splice(Math.floor(Math.random() * fallback.length), 1)[0];
    if (next && !unique.includes(next)) unique.push(next);
  }

  return shuffle(unique.slice(0, 4));
}

function ensureStudyOrder() {
  const ids = filteredCards().map((card) => card.id);
  if (!sameSet(ids, state.studyOrder)) {
    state.studyOrder = ids;
    state.studyIndex = 0;
    state.revealed = false;
  }
}

function currentStudyCard() {
  ensureStudyOrder();
  const pool = state.studyOrder.map((id) => DATA.cards.find((card) => card.id === id)).filter(Boolean);
  if (!pool.length) return null;
  return pool[state.studyIndex % pool.length];
}

function tagsHtml(tags) {
  return `<div class="tag-row">${tags
    .map((tag) => `<span class="tag ${tag === "最重要" || tag === "重要" || tag === "数字" ? "hot" : ""}">${esc(tag)}</span>`)
    .join("")}</div>`;
}

function renderStudy() {
  const card = currentStudyCard();
  floatingNext.hidden = false;
  floatingNext.textContent = state.revealed ? "次へ" : "答え";

  if (!card) {
    statusChip.textContent = "0 / 0";
    view.innerHTML = `<div class="empty">この条件の暗記カードがありません。</div>`;
    return;
  }

  const total = state.studyOrder.length;
  statusChip.textContent = `${(state.studyIndex % total) + 1} / ${total}`;
  view.innerHTML = `
    <article class="view-card">
      <p class="kicker">${esc(card.category)}</p>
      <h2 class="title">${esc(card.term)}</h2>
      <p class="sub-question">${esc(card.prompt)}</p>
      ${tagsHtml(card.tags)}
      ${
        state.revealed
          ? `<section class="term-answer">
              <h3>答え</h3>
              <dl class="answer-grid">
                <dt>答え</dt><dd>${esc(card.answer)}</dd>
                <dt>説明</dt><dd>${esc(card.definition)}</dd>
                <dt>覚え方</dt><dd>${esc(card.explanation)}</dd>
              </dl>
            </section>`
          : `<section class="term-answer"><h3>問題</h3><p class="muted">答えを見るか、右下の「次へ」で表示できます。</p></section>`
      }
      <div class="action-row answer-actions">
        <button class="bad" data-action="study-again">もう一度</button>
        <button class="warn" data-action="study-unknown">わからない</button>
        <button class="good" data-action="study-good">${state.revealed ? "覚えた" : "答えを見る"}</button>
      </div>
    </article>
  `;
}

function nextStudy() {
  const card = currentStudyCard();
  if (!card) return;
  state.studyIndex += 1;
  state.revealed = false;
  render();
}

function makeQuizQuestion() {
  const questions = buildQuestions();
  if (!questions.length) return null;
  return {
    ...questions[0],
    answered: false,
    selected: null,
    correct: false
  };
}

function renderQuiz() {
  if (!state.quiz) state.quiz = makeQuizQuestion();

  if (!state.quiz) {
    floatingNext.hidden = true;
    statusChip.textContent = "0問";
    view.innerHTML = `<div class="empty">この条件の小テスト問題がありません。</div>`;
    return;
  }

  floatingNext.hidden = !state.quiz.answered;
  floatingNext.textContent = "次へ";
  statusChip.textContent = "小テスト";
  view.innerHTML = questionHtml(state.quiz, "quiz");
}

function questionHtml(question, scope) {
  const feedback = question.answered
    ? `<section class="feedback ${question.correct ? "correct" : "wrong"}">
        <h3>${question.correct ? "正解" : "確認"}</h3>
        <p><strong>答え: ${esc(question.answer)}</strong></p>
        <p>${esc(question.explanation)}</p>
      </section>`
    : "";

  return `
    <article class="question-card">
      <p class="kicker">${esc(question.category)}</p>
      <h2 class="question-text">${esc(question.stem)}</h2>
      <div class="choice-grid">
        ${question.choices
          .map((choice) => {
            const stateClass = !question.answered
              ? ""
              : choice === question.answer
                ? "is-correct"
                : choice === question.selected
                  ? "is-wrong"
                  : "";
            return `<button class="choice ${stateClass}" data-scope="${scope}" data-choice="${esc(choice)}">${esc(choice)}</button>`;
          })
          .join("")}
      </div>
      <div class="action-row answer-actions">
        <button class="warn" data-action="${scope}-unknown">わからない</button>
        <button class="bad" data-action="${scope}-miss">あとで復習</button>
        <button class="good" data-action="${scope}-next">${question.answered ? "次の問題" : "答えを確認"}</button>
      </div>
      ${feedback}
    </article>
  `;
}

function answerQuiz(choice) {
  if (!state.quiz || state.quiz.answered) return;
  state.quiz.selected = choice;
  state.quiz.correct = choice === state.quiz.answer;
  state.quiz.answered = true;
  state.nextLockedUntil = Date.now() + 450;
  if (!state.quiz.correct) recordMiss(state.quiz, choice || "わからない");
  render();
}

function nextQuiz() {
  if (!state.quiz?.answered) {
    answerQuiz("");
    return;
  }
  state.quiz = makeQuizQuestion();
  render();
}

function startPractice() {
  state.practice = {
    questions: buildQuestions().slice(0, 8),
    index: 0,
    score: 0,
    done: false,
    answers: []
  };
}

function renderPractice() {
  if (!state.practice) startPractice();

  const practice = state.practice;
  if (!practice.questions.length) {
    floatingNext.hidden = true;
    statusChip.textContent = "0問";
    view.innerHTML = `<div class="empty">この条件の実戦問題がありません。</div>`;
    return;
  }

  if (practice.done) {
    floatingNext.hidden = true;
    const total = practice.questions.length;
    statusChip.textContent = `${practice.score} / ${total}`;
    view.innerHTML = `
      <article class="question-card">
        <p class="kicker">実戦結果</p>
        <h2 class="title">${practice.score} / ${total}</h2>
        <p class="sub-question">間違えた問題はミス一覧に保存されています。</p>
        <div class="action-row">
          <button class="bad" data-action="practice-review-misses">ミスを見る</button>
          <button class="warn" data-action="practice-reset">同じ条件でもう一回</button>
          <button class="good" data-action="practice-new">新しい問題</button>
        </div>
        <div class="list-grid" style="margin-top:18px">
          ${practice.answers
            .map(
              (item) => `<section class="item">
                <p class="kicker">${esc(item.question.category)}</p>
                <h3>${item.correct ? "正解" : "確認"}: ${esc(item.question.answer)}</h3>
                <p>${esc(item.question.stem)}</p>
                <p>${esc(item.question.explanation)}</p>
              </section>`
            )
            .join("")}
        </div>
      </article>
    `;
    return;
  }

  const current = practice.questions[practice.index];
  floatingNext.hidden = !current.answered;
  floatingNext.textContent = "次へ";
  statusChip.textContent = `${practice.index + 1} / ${practice.questions.length}`;
  const percent = Math.round((practice.index / practice.questions.length) * 100);
  view.innerHTML = `
    <div class="practice-progress">
      <div class="bar"><span style="width:${percent}%"></span></div>
    </div>
    ${questionHtml(current, "practice")}
  `;
}

function answerPractice(choice) {
  const practice = state.practice;
  if (!practice || practice.done) return;
  const question = practice.questions[practice.index];
  if (question.answered) return;
  question.selected = choice;
  question.correct = choice === question.answer;
  question.answered = true;
  state.nextLockedUntil = Date.now() + 450;
  if (question.correct) practice.score += 1;
  if (!question.correct) recordMiss(question, choice || "わからない");
  render();
}

function nextPractice() {
  const practice = state.practice;
  if (!practice || practice.done) return;
  const question = practice.questions[practice.index];
  if (!question.answered) {
    answerPractice("");
    return;
  }
  practice.answers.push({ question, correct: question.correct });
  if (practice.index >= practice.questions.length - 1) {
    practice.done = true;
  } else {
    practice.index += 1;
  }
  render();
}

function renderList() {
  floatingNext.hidden = true;
  statusChip.textContent = state.listKind === "terms" ? `${filteredCards().length}語` : `${buildQuestions().length}問`;
  const query = state.query.trim().toLowerCase();
  const terms = filteredCards().filter((card) => {
    const text = `${card.term} ${card.answer} ${card.definition} ${card.explanation}`.toLowerCase();
    return !query || text.includes(query);
  });
  const questions = buildQuestions().filter((question) => {
    const text = `${question.stem} ${question.answer} ${question.explanation}`.toLowerCase();
    return !query || text.includes(query);
  });

  view.innerHTML = `
    <article class="list-card">
      <p class="kicker">一覧</p>
      <h2 class="title">${state.listKind === "terms" ? "用語辞典" : "問題一覧"}</h2>
      <div class="list-toolbar">
        <input id="searchInput" value="${esc(state.query)}" placeholder="用語・説明を検索">
        <div class="mini-tabs">
          <button class="small-action ${state.listKind === "terms" ? "primary" : ""}" data-action="list-terms">用語</button>
          <button class="small-action ${state.listKind === "questions" ? "primary" : ""}" data-action="list-questions">問題</button>
        </div>
      </div>
      <div class="list-grid">
        ${
          state.listKind === "terms"
            ? terms.map(cardListItem).join("")
            : questions.map(questionListItem).join("")
        }
      </div>
    </article>
  `;

  document.querySelector("#searchInput")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderList();
  });
}

function cardListItem(card) {
  return `
    <section class="item">
      <p class="kicker">${esc(card.category)}</p>
      <h3>${esc(card.term)}</h3>
      <p><strong>${esc(card.answer)}</strong></p>
      <p>${esc(card.definition)}</p>
      <p>${esc(card.explanation)}</p>
      ${tagsHtml(card.tags)}
    </section>
  `;
}

function questionListItem(question) {
  return `
    <section class="item">
      <p class="kicker">${esc(question.category)}</p>
      <h3>${esc(question.answer)}</h3>
      <p>${esc(question.stem)}</p>
      <p>${esc(question.explanation)}</p>
    </section>
  `;
}

function loadMisses() {
  try {
    return JSON.parse(localStorage.getItem(MISS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveMisses(misses) {
  localStorage.setItem(MISS_KEY, JSON.stringify(misses.slice(0, 100)));
}

function recordMiss(item, selected) {
  const misses = loadMisses();
  const key = item.id || item.sourceId || item.term;
  const existing = misses.find((miss) => miss.key === key);
  const payload = {
    key,
    category: item.category,
    stem: item.stem || item.prompt || item.definition,
    answer: item.answer,
    explanation: item.explanation,
    selected,
    count: 1,
    lastAt: new Date().toISOString()
  };

  if (existing) {
    existing.count += 1;
    existing.selected = selected;
    existing.lastAt = payload.lastAt;
  } else {
    misses.unshift(payload);
  }
  saveMisses(misses);
}

function renderMisses() {
  floatingNext.hidden = true;
  const misses = loadMisses();
  const total = misses.reduce((sum, miss) => sum + miss.count, 0);
  statusChip.textContent = `${misses.length}件`;

  view.innerHTML = `
    <article class="miss-card">
      <p class="kicker">復習</p>
      <h2 class="title">間違えた問題</h2>
      <div class="miss-summary">
        <div class="stat"><span>問題数</span><strong>${misses.length}</strong></div>
        <div class="stat"><span>回数</span><strong>${total}</strong></div>
        <div class="stat"><span>範囲</span><strong>${esc(state.category === "all" ? "全" : state.category.slice(0, 2))}</strong></div>
      </div>
      <div class="action-row">
        <button class="bad" data-action="clear-misses">ミスを消す</button>
        <button class="warn" data-action="misses-to-list">一覧で確認</button>
        <button class="good" data-action="misses-quiz">ミスから実戦</button>
      </div>
      ${
        misses.length
          ? `<div class="list-grid" style="margin-top:18px">${misses.map(missListItem).join("")}</div>`
          : `<div class="empty" style="margin-top:18px">まだ記録はありません。間違えたり「わからない」を押した問題がここに残ります。</div>`
      }
    </article>
  `;
}

function missListItem(miss) {
  return `
    <section class="item">
      <p class="kicker">${esc(miss.category)} / ${miss.count}回</p>
      <h3>${esc(miss.answer)}</h3>
      <p>${esc(miss.stem)}</p>
      <p>前回の選択: ${esc(miss.selected || "わからない")}</p>
      <p>${esc(miss.explanation)}</p>
    </section>
  `;
}

function setMode(mode) {
  state.mode = mode;
  if (mode === "quiz") state.quiz = null;
  if (mode === "practice") startPractice();
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  render();
}

function render() {
  document.body.dataset.currentMode = state.mode;
  if (state.mode === "study") renderStudy();
  if (state.mode === "quiz") renderQuiz();
  if (state.mode === "practice") renderPractice();
  if (state.mode === "list") renderList();
  if (state.mode === "misses") renderMisses();
}

function populateCategories() {
  categoryFilter.innerHTML = [
    `<option value="all">全範囲</option>`,
    ...DATA.categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`)
  ].join("");
}

document.addEventListener("click", (event) => {
  if (event.target === floatingNext || floatingNext.contains(event.target)) return;

  const modeButton = event.target.closest("[data-mode]");
  if (modeButton) {
    setMode(modeButton.dataset.mode);
    return;
  }

  const choiceButton = event.target.closest("[data-choice]");
  if (choiceButton) {
    const value = choiceButton.dataset.choice;
    if (choiceButton.dataset.scope === "quiz") answerQuiz(value);
    if (choiceButton.dataset.scope === "practice") answerPractice(value);
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "study-good") {
    if (!state.revealed) state.revealed = true;
    else nextStudy();
    render();
  }
  if (action === "study-again" || action === "study-unknown") {
    const card = currentStudyCard();
    if (card) recordMiss(card, action === "study-unknown" ? "わからない" : "もう一度");
    if (!state.revealed) state.revealed = true;
    else nextStudy();
    render();
  }
  if (action === "quiz-unknown" || action === "quiz-miss") answerQuiz("");
  if (action === "quiz-next") nextQuiz();
  if (action === "practice-unknown" || action === "practice-miss") answerPractice("");
  if (action === "practice-next") nextPractice();
  if (action === "practice-reset" || action === "practice-new") {
    startPractice();
    render();
  }
  if (action === "practice-review-misses") setMode("misses");
  if (action === "list-terms") {
    state.listKind = "terms";
    renderList();
  }
  if (action === "list-questions") {
    state.listKind = "questions";
    renderList();
  }
  if (action === "clear-misses") {
    saveMisses([]);
    renderMisses();
  }
  if (action === "misses-to-list") {
    state.listKind = "terms";
    setMode("list");
  }
  if (action === "misses-quiz") {
    const misses = loadMisses();
    const missedKeys = new Set(misses.map((miss) => miss.key));
    const questions = buildQuestions().filter((question) => missedKeys.has(question.id) || missedKeys.has(question.sourceId));
    state.practice = {
      questions: questions.length ? questions.slice(0, 8) : buildQuestions().slice(0, 8),
      index: 0,
      score: 0,
      done: false,
      answers: []
    };
    setMode("practice");
  }
});

categoryFilter.addEventListener("change", () => {
  state.category = categoryFilter.value;
  state.studyOrder = [];
  state.quiz = null;
  state.practice = null;
  render();
});

examOnly.addEventListener("change", () => {
  state.examOnly = examOnly.checked;
  state.studyOrder = [];
  state.quiz = null;
  state.practice = null;
  render();
});

document.querySelector("#shuffleButton").addEventListener("click", () => {
  state.studyOrder = shuffle(filteredCards().map((card) => card.id));
  state.studyIndex = 0;
  state.revealed = false;
  state.quiz = null;
  state.practice = null;
  render();
});

floatingNext.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (Date.now() < state.nextLockedUntil) return;

  if (state.mode === "study") {
    if (!state.revealed) {
      state.revealed = true;
      render();
    } else {
      nextStudy();
    }
  }
  if (state.mode === "quiz") nextQuiz();
  if (state.mode === "practice") nextPractice();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

populateCategories();
render();
