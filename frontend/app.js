/* ═══════════════════════════════════════════════
   QUIZCRAFT — app.js
   Replace firebaseConfig with YOUR values from
   Firebase Console > Project Settings > Web App
═══════════════════════════════════════════════ */

// ─── FIREBASE CONFIG (Replace with yours!) ─────
const firebaseConfig = {
  apiKey: "AIzaSyDbXCHMU1RFJcGDqkCMu6ToD_q1W6kdP5g",
  authDomain: "quizcraft-app-5a7da.firebaseapp.com",
  projectId: "quizcraft-app-5a7da",
  storageBucket: "quizcraft-app-5a7da.firebasestorage.app",
  messagingSenderId: "380002450266",
  appId: "1:380002450266:web:84149d831ee56096cc5163",
};

// ─── INIT ───────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ─── STATE ──────────────────────────────────────
let currentUser   = null;
let allQuizzes    = [];
let currentQuiz   = null;
let currentQIndex = 0;
let score         = 0;
let timer         = null;
let timeLeft      = 30;
let answered      = false;
let questionQty   = 0;

// ─── LOADER ─────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('loader').classList.add('hidden');
  }, 1600);
});

// ─── AUTH STATE ─────────────────────────────────
auth.onAuthStateChanged(user => {
  currentUser = user;
  const navGuest  = document.getElementById('navGuest');
  const navUser   = document.getElementById('navUser');
  const mobileG   = document.getElementById('mobileNavGuest');
  const mobileU   = document.getElementById('mobileNavUser');
  const createLink = document.getElementById('createNavLink');
  const createML   = document.getElementById('createMobileLink');

  if (user) {
    navGuest.style.display  = 'none';
    navUser.style.display   = 'flex';
    mobileG.style.display   = 'none';
    mobileU.style.display   = 'block';
    createLink.style.display = '';
    createML.style.display   = '';
    document.getElementById('dashNavLink').style.display  = '';
    document.getElementById('dashMobileLink').style.display = '';
    const displayName = user.displayName || user.email.split('@')[0];
    document.getElementById('navUsername').textContent = displayName;
    const avatarEl = document.getElementById('navAvatar');
    if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();
    // Make the user pill clickable → Dashboard
    const pill = document.getElementById('navUser');
    if (pill) { pill.style.cursor = 'pointer'; pill.onclick = (e) => { if (!e.target.classList.contains('btn')) showPage('dashboard'); }; }
  } else {
    navGuest.style.display  = '';
    navUser.style.display   = 'none';
    mobileG.style.display   = 'block';
    mobileU.style.display   = 'none';
    createLink.style.display = 'none';
    createML.style.display   = 'none';
    document.getElementById('dashNavLink').style.display  = 'none';
    document.getElementById('dashMobileLink').style.display = 'none';
  }

  loadStats();
  loadQuizzes();
});

// ─── NAVIGATION ─────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (name === 'dashboard') loadDashboard();
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.textContent.toLowerCase() === name || (name === 'home' && l.textContent === 'Home'));
  });
  window.scrollTo(0, 0);
  if (name === 'browse') loadQuizzes();
  if (name === 'myquizzes') loadMyQuizzes();
}

function toggleMobileMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

// ─── MODALS ─────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function switchModal(from, to) { closeModal(from); openModal(to); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ─── TOAST ──────────────────────────────────────
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast ' + type + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── AUTH FUNCTIONS ─────────────────────────────
async function register() {
  const name  = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const pass  = document.getElementById('registerPassword').value;
  const errEl = document.getElementById('registerError');

  if (!name || !email || !pass) { showError(errEl, 'Please fill in all fields.'); return; }
  if (pass.length < 6)          { showError(errEl, 'Password must be at least 6 characters.'); return; }

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });

    // save user doc
    await db.collection('users').doc(cred.user.uid).set({
      name, email, createdAt: firebase.firestore.FieldValue.serverTimestamp(), quizCount: 0
    });

    closeModal('registerModal');
    showToast('Welcome to QuizCraft! 🎉', 'success');
    errEl.classList.remove('show');
    // increment user count
    await db.collection('stats').doc('global').set(
      { users: firebase.firestore.FieldValue.increment(1) }, { merge: true }
    );
  } catch (e) { showError(errEl, friendlyError(e.code)); }
}

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');

  if (!email || !pass) { showError(errEl, 'Please enter email and password.'); return; }

  try {
    await auth.signInWithEmailAndPassword(email, pass);
    closeModal('loginModal');
    showToast('Welcome back! 👋', 'success');
    errEl.classList.remove('show');
  } catch (e) { showError(errEl, friendlyError(e.code)); }
}

async function googleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const cred = await auth.signInWithPopup(provider);
    const user = cred.user;

    // Upsert user doc
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (!userDoc.exists) {
      await db.collection('users').doc(user.uid).set({
        name: user.displayName, email: user.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(), quizCount: 0
      });
      await db.collection('stats').doc('global').set(
        { users: firebase.firestore.FieldValue.increment(1) }, { merge: true }
      );
    }

    closeModal('loginModal'); closeModal('registerModal');
    showToast('Signed in with Google! 🚀', 'success');
  } catch (e) { showToast(friendlyError(e.code), 'error'); }
}

function logout() {
  auth.signOut().then(() => {
    showPage('home');
    showToast('Signed out. See you soon!', 'info');
  });
}

function showError(el, msg) { el.textContent = msg; el.classList.add('show'); }

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use': 'Email already in use. Try logging in.',
    'auth/invalid-email':        'Please enter a valid email.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/too-many-requests':    'Too many attempts. Try again later.',
    'auth/popup-closed-by-user': 'Sign-in cancelled.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ─── STATS ──────────────────────────────────────
async function loadStats() {
  try {
    const doc = await db.collection('stats').doc('global').get();
    const d   = doc.data() || {};
    animateCount('statQuizzes', d.quizzes || 0);
    animateCount('statUsers',   d.users   || 0);
    animateCount('statPlays',   d.plays   || 0);
  } catch (e) {}
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  let cur = 0; const step = Math.ceil(target / 40);
  const t = setInterval(() => {
    cur = Math.min(cur + step, target);
    el.textContent = cur.toLocaleString();
    if (cur >= target) clearInterval(t);
  }, 40);
}

// ─── LOAD QUIZZES ───────────────────────────────
async function loadQuizzes() {
  const grid = document.getElementById('quizGrid');
  grid.innerHTML = '<div class="loading-quizzes">Loading quizzes...</div>';

  try {
    const snap = await db.collection('quizzes')
      .where('visibility', '==', 'public')
      .limit(50)
      .get();

    allQuizzes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderQuizGrid(grid, allQuizzes);
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><div class="es-icon">⚡</div><h3>Firestore not set up yet</h3><p>Follow the setup guide in README.md</p></div>';
  }
}

function renderQuizGrid(grid, quizzes) {
  if (!quizzes.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="es-icon">🎯</div>
      <h3>No quizzes yet</h3>
      <p>Be the first to create one!</p>
    </div>`;
    return;
  }
  grid.innerHTML = quizzes.map((q, i) => `
    <div class="quiz-card" onclick="openQuiz('${q.id}')" style="animation-delay:${i*0.05}s">
      <div class="qc-category">
        ${q.category || 'General'}
        <span class="qc-badge">${q.questions?.length || 0} Qs</span>
      </div>
      <div class="qc-title">${esc(q.title)}</div>
      <div class="qc-desc">${esc(q.description || 'No description')}</div>
      <div class="qc-meta">
        <span>by <span class="qc-author">${esc(q.authorName || 'Anonymous')}</span></span>
        <span>▶ ${q.plays || 0} plays</span>
      </div>
      <div class="qc-actions">
        <button class="btn btn-primary" onclick="event.stopPropagation();openQuiz('${q.id}')">Play ⚡</button>
      </div>
    </div>
  `).join('');
}

function filterQuizzes() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const filtered = allQuizzes.filter(quiz =>
    quiz.title?.toLowerCase().includes(q) ||
    quiz.category?.toLowerCase().includes(q) ||
    quiz.description?.toLowerCase().includes(q)
  );
  renderQuizGrid(document.getElementById('quizGrid'), filtered);
}

// ─── MY QUIZZES ─────────────────────────────────
async function loadMyQuizzes() {
  if (!currentUser) { showPage('home'); openModal('loginModal'); return; }
  const grid = document.getElementById('myQuizGrid');
  grid.innerHTML = '<div class="loading-quizzes">Loading...</div>';

  try {
    const snap = await db.collection('quizzes')
      .where('authorId', '==', currentUser.uid)
      .orderBy('createdAt', 'desc')
      .get();

    const quizzes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!quizzes.length) {
      grid.innerHTML = `<div class="empty-state"><div class="es-icon">✏️</div><h3>No quizzes yet</h3><p>Create your first quiz!</p></div>`;
      return;
    }
    grid.innerHTML = quizzes.map((q, i) => `
      <div class="quiz-card" style="animation-delay:${i*0.05}s">
        <div class="qc-category">
          ${q.category || 'General'}
          <span class="qc-badge">${q.visibility === 'private' ? '🔒' : '🌐'} ${q.questions?.length || 0} Qs</span>
        </div>
        <div class="qc-title">${esc(q.title)}</div>
        <div class="qc-desc">${esc(q.description || '')}</div>
        <div class="qc-meta"><span>▶ ${q.plays || 0} plays</span></div>
        <div class="qc-actions">
          <button class="btn btn-primary" onclick="openQuiz('${q.id}')">Play ⚡</button>
          <button class="btn btn-danger" onclick="deleteQuiz('${q.id}', event)">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (e) { grid.innerHTML = '<div class="empty-state"><h3>Error loading quizzes</h3></div>'; }
}

async function deleteQuiz(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this quiz permanently?')) return;
  try {
    await db.collection('quizzes').doc(id).delete();
    await db.collection('stats').doc('global').set(
      { quizzes: firebase.firestore.FieldValue.increment(-1) }, { merge: true }
    );
    showToast('Quiz deleted.', 'info');
    loadMyQuizzes();
  } catch (err) { showToast('Error deleting quiz.', 'error'); }
}

// ─── CREATE QUIZ ────────────────────────────────
let questionCount = 0;

function addQuestion() {
  questionCount++;
  const idx = questionCount;
  const list = document.getElementById('questionsList');
  const div  = document.createElement('div');
  div.className = 'question-item';
  div.id = 'q-' + idx;
  div.innerHTML = `
    <div class="qi-header">
      <span class="qi-num">Question ${idx}</span>
      <button type="button" class="btn btn-ghost" style="padding:.3rem .7rem;font-size:.8rem" onclick="removeQuestion(${idx})">✕ Remove</button>
    </div>
    <div class="form-group">
      <label>Question Text</label>
      <input type="text" id="qtext-${idx}" placeholder="Enter your question..." required />
    </div>
    <label style="font-size:.85rem;font-weight:600;color:var(--text2);display:block;margin-bottom:.5rem">
      Options <small style="color:var(--text3)">(select the correct answer)</small>
    </label>
    <div class="options-list">
      ${[0,1,2,3].map(j => `
        <div class="option-row">
          <input type="radio" name="correct-${idx}" value="${j}" id="r-${idx}-${j}" ${j===0?'checked':''}>
          <input type="text" id="opt-${idx}-${j}" placeholder="Option ${j+1}" required />
        </div>
      `).join('')}
    </div>
  `;
  list.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function removeQuestion(idx) {
  const el = document.getElementById('q-' + idx);
  if (el) el.remove();
}

document.getElementById('createQuizForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser) { openModal('loginModal'); return; }

  const title   = document.getElementById('quizTitle').value.trim();
  const desc    = document.getElementById('quizDesc').value.trim();
  const cat     = document.getElementById('quizCategory').value;
  const vis     = document.getElementById('quizVisibility').value;
  const qItems  = document.querySelectorAll('.question-item');

  if (!title) { showToast('Please enter a quiz title.', 'error'); return; }
  if (qItems.length === 0) { showToast('Add at least one question.', 'error'); return; }

  const questions = [];
  let valid = true;

  qItems.forEach(item => {
    const id   = item.id.replace('q-', '');
    const text = document.getElementById('qtext-' + id)?.value.trim();
    const opts = [0,1,2,3].map(j => document.getElementById('opt-' + id + '-' + j)?.value.trim() || '');
    const corrRadio = document.querySelector(`input[name="correct-${id}"]:checked`);
    const correct   = corrRadio ? parseInt(corrRadio.value) : 0;

    if (!text || opts.some(o => !o)) { valid = false; }
    questions.push({ text, options: opts, correct });
  });

  if (!valid) { showToast('Please fill in all question fields.', 'error'); return; }

  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Publishing...';

  try {
    await db.collection('quizzes').add({
      title, description: desc, category: cat, visibility: vis,
      questions, authorId: currentUser.uid,
      authorName: currentUser.displayName || currentUser.email.split('@')[0],
      plays: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('stats').doc('global').set(
      { quizzes: firebase.firestore.FieldValue.increment(1) }, { merge: true }
    );

    showToast('Quiz published! 🎉', 'success');
    document.getElementById('createQuizForm').reset();
    document.getElementById('questionsList').innerHTML = '';
    questionCount = 0;
    showPage('browse');
    loadQuizzes();
  } catch (err) {
    showToast('Error publishing: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Publish Quiz ✦';
  }
});

// ─── PLAY QUIZ ──────────────────────────────────
async function openQuiz(id) {
  try {
    const doc = await db.collection('quizzes').doc(id).get();
    if (!doc.exists) { showToast('Quiz not found.', 'error'); return; }
    currentQuiz = { id: doc.id, ...doc.data() };
    currentQIndex = 0; score = 0; answered = false;

    document.getElementById('playCategory').textContent    = currentQuiz.category || 'General';
    document.getElementById('playTitle').textContent       = currentQuiz.title;
    document.getElementById('playDesc').textContent        = currentQuiz.description || '';
    document.getElementById('playQuestionCount').textContent = `${currentQuiz.questions?.length || 0} Questions`;
    document.getElementById('playAuthor').textContent      = 'by ' + (currentQuiz.authorName || 'Anonymous');

    document.getElementById('play-start').style.display = 'flex';
    document.getElementById('play-quiz').style.display  = 'none';
    document.getElementById('play-result').style.display= 'none';

    showPage('play');
  } catch (err) { showToast('Error loading quiz.', 'error'); }
}

function startQuiz() {
  document.getElementById('play-start').style.display = 'none';
  document.getElementById('play-quiz').style.display  = 'block';
  loadQuestion();
}

function loadQuestion() {
  const q = currentQuiz.questions[currentQIndex];
  const total = currentQuiz.questions.length;

  document.getElementById('questionNum').textContent = `${currentQIndex + 1} / ${total}`;
  document.getElementById('progressFill').style.width = `${(currentQIndex / total) * 100}%`;
  document.getElementById('currentQuestion').textContent = q.text;
  answered = false;

  const grid = document.getElementById('optionsGrid');
  grid.innerHTML = q.options.map((opt, i) => `
    <button class="option-btn" onclick="answerQuestion(${i})">${esc(opt)}</button>
  `).join('');

  // Timer
  timeLeft = 30;
  clearInterval(timer);
  updateTimer();
  timer = setInterval(() => {
    timeLeft--;
    updateTimer();
    if (timeLeft <= 0) { clearInterval(timer); autoAdvance(); }
  }, 1000);
}

function updateTimer() {
  const el = document.getElementById('timerDisplay');
  el.textContent = `⏱ ${timeLeft}s`;
  el.className   = 'timer' + (timeLeft <= 10 ? ' urgent' : '');
}

function answerQuestion(idx) {
  if (answered) return;
  answered = true;
  clearInterval(timer);

  const q     = currentQuiz.questions[currentQIndex];
  const btns  = document.querySelectorAll('.option-btn');
  const correct = q.correct;

  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === correct) b.classList.add('correct');
    else if (i === idx && idx !== correct) b.classList.add('wrong');
  });

  if (idx === correct) score++;

  setTimeout(nextQuestion, 1200);
}

function autoAdvance() {
  if (answered) return;
  answered = true;
  const q    = currentQuiz.questions[currentQIndex];
  const btns = document.querySelectorAll('.option-btn');
  btns.forEach((b, i) => { b.disabled = true; if (i === q.correct) b.classList.add('correct'); });
  setTimeout(nextQuestion, 1200);
}

function nextQuestion() {
  currentQIndex++;
  if (currentQIndex >= currentQuiz.questions.length) { showResult(); }
  else { loadQuestion(); }
}

async function showResult() {
  clearInterval(timer);
  document.getElementById('play-quiz').style.display   = 'none';
  document.getElementById('play-result').style.display = 'flex';

  const total = currentQuiz.questions.length;
  const pct   = Math.round((score / total) * 100);

  document.getElementById('resultScore').textContent = pct + '%';
  document.getElementById('resultBreakdown').innerHTML = `
    <div class="rb-item rb-correct"><div class="rb-num">${score}</div><small>Correct</small></div>
    <div class="rb-item rb-wrong"><div class="rb-num">${total - score}</div><small>Wrong</small></div>
    <div class="rb-item"><div class="rb-num">${total}</div><small>Total</small></div>
  `;

  let emoji, title, msg;
  if (pct === 100) { emoji='🏆'; title='Perfect Score!'; msg='Flawless. You absolutely crushed it!'; }
  else if (pct >= 80) { emoji='🎉'; title='Excellent!'; msg='Great work — nearly perfect!'; }
  else if (pct >= 60) { emoji='👍'; title='Good Job!'; msg='Solid performance. Keep it up!'; }
  else if (pct >= 40) { emoji='😅'; title='Keep Practicing!'; msg='Almost there — try again!'; }
  else { emoji='💪'; title='Don\'t Give Up!'; msg='Everyone starts somewhere. Try again!'; }

  document.getElementById('resultEmoji').textContent   = emoji;
  document.getElementById('resultTitle').textContent   = title;
  document.getElementById('resultMessage').textContent = msg;

  // Save play result + increment plays
  try {
    await db.collection('quizzes').doc(currentQuiz.id).update({
      plays: firebase.firestore.FieldValue.increment(1)
    });
    await db.collection('stats').doc('global').set(
      { plays: firebase.firestore.FieldValue.increment(1) }, { merge: true }
    );
    // Save user play record for dashboard
    if (currentUser) {
      await db.collection('users').doc(currentUser.uid).collection('plays').add({
        quizId:    currentQuiz.id,
        quizTitle: currentQuiz.title,
        category:  currentQuiz.category || 'General',
        score:     score,
        total:     total,
        pct:       pct,
        playedAt:  firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (e) {}
}

function retryQuiz() {
  score = 0; currentQIndex = 0;
  document.getElementById('play-result').style.display = 'none';
  document.getElementById('play-start').style.display  = 'flex';
}

// ─── UTILS ──────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── DASHBOARD ───────────────────────────────
async function loadDashboard() {
  if (!currentUser) return;

  const name  = currentUser.displayName || currentUser.email.split('@')[0];
  const email = currentUser.email;

  // Set header info
  document.getElementById('dashName').textContent  = name;
  document.getElementById('dashEmail').textContent = email;
  const lgAvatar = document.getElementById('dashAvatarLg');
  if (lgAvatar) lgAvatar.textContent = name.charAt(0).toUpperCase();

  try {
    // Load user play history
    const playsSnap = await db.collection('users').doc(currentUser.uid)
      .collection('plays').orderBy('playedAt', 'desc').limit(20).get();

    const plays = [];
    playsSnap.forEach(d => plays.push({ id: d.id, ...d.data() }));

    // Compute stats
    const totalPlayed = plays.length;
    const totalCorrect = plays.reduce((a, p) => a + p.score, 0);
    const totalQs      = plays.reduce((a, p) => a + p.total, 0);
    const bestScore    = plays.length ? Math.max(...plays.map(p => p.pct)) : null;
    const accuracy     = totalQs > 0 ? Math.round((totalCorrect / totalQs) * 100) : 0;

    document.getElementById('dsTotalPlays').textContent = totalPlayed;
    document.getElementById('dsAccuracy').textContent   = totalPlayed ? accuracy + '%' : '—';
    document.getElementById('dsBestScore').textContent  = bestScore !== null ? bestScore + '%' : '—';

    // Accuracy ring
    const circumference = 2 * Math.PI * 50; // r=50 → ~314
    const offset = circumference - (accuracy / 100) * circumference;
    const ring = document.getElementById('accRingFill');
    if (ring) {
      ring.style.strokeDasharray  = circumference;
      ring.style.strokeDashoffset = offset;
      // Color by accuracy
      ring.style.stroke = accuracy >= 80 ? '#2ecc71' : accuracy >= 60 ? '#4a9eff' : accuracy >= 40 ? '#f7c948' : '#e74c3c';
    }
    document.getElementById('accRingPct').textContent  = accuracy + '%';
    document.getElementById('accCorrectNum').textContent = totalCorrect;
    document.getElementById('accWrongNum').textContent   = totalQs - totalCorrect;
    document.getElementById('accTotalNum').textContent   = totalQs;

    // Bar chart (last 10 plays, reversed for chronological order)
    const chartPlays = plays.slice(0, 10).reverse();
    const chartEl = document.getElementById('dashChart');
    if (chartEl) {
      if (chartPlays.length === 0) {
        chartEl.innerHTML = '<div class="chart-empty">No quiz attempts yet.<br>Play some quizzes to see your progress!</div>';
      } else {
        chartEl.innerHTML = chartPlays.map((p, i) => {
          const h = Math.max(8, Math.round(p.pct * 1.4)); // max ~140px for 100%
          const colorClass = p.pct === 100 ? 'chart-bar-perfect' :
                             p.pct >= 75   ? 'chart-bar-great'   :
                             p.pct >= 50   ? 'chart-bar-ok'      : 'chart-bar-poor';
          const short = p.quizTitle.length > 10 ? p.quizTitle.substring(0,9)+'…' : p.quizTitle;
          return `
            <div class="chart-bar-wrap">
              <div class="chart-bar ${colorClass}" style="height:${h}px">
                <div class="chart-bar-tooltip">${p.quizTitle}: ${p.pct}%</div>
              </div>
              <div class="chart-bar-label">${short}</div>
            </div>`;
        }).join('');
      }
    }

    // History list
    const histEl = document.getElementById('dashHistoryList');
    const subEl  = document.getElementById('dashHistorySub');
    if (subEl) subEl.textContent = totalPlayed ? totalPlayed + ' attempt' + (totalPlayed !== 1 ? 's' : '') : '';
    if (histEl) {
      if (plays.length === 0) {
        histEl.innerHTML = '<div class="dash-empty-sm">No quiz history yet. Start playing! 🎮</div>';
      } else {
        histEl.innerHTML = plays.slice(0, 8).map((p, i) => {
          const scoreClass = p.pct === 100 ? 'hist-score-perfect' :
                             p.pct >= 75   ? 'hist-score-great'   :
                             p.pct >= 50   ? 'hist-score-ok'      : 'hist-score-poor';
          const date = p.playedAt?.toDate ? p.playedAt.toDate().toLocaleDateString('en-US', { month:'short', day:'numeric' }) : 'Recent';
          return `
            <div class="hist-item">
              <div class="hist-rank">${i+1}</div>
              <div class="hist-info">
                <div class="hist-title">${esc(p.quizTitle)}</div>
                <div class="hist-meta">${esc(p.category)} · ${date}</div>
              </div>
              <div class="hist-score-wrap">
                <div class="hist-score ${scoreClass}">${p.pct}%</div>
                <div class="hist-fraction">${p.score}/${p.total}</div>
              </div>
            </div>`;
        }).join('');
      }
    }

    // My Quizzes (created)
    const mySnap = await db.collection('quizzes')
      .where('authorId', '==', currentUser.uid)
      .orderBy('createdAt', 'desc').limit(5).get();

    document.getElementById('dsCreated').textContent = mySnap.size;

    const myListEl = document.getElementById('dashMyQuizList');
    if (myListEl) {
      if (mySnap.empty) {
        myListEl.innerHTML = '<div class="dash-empty-sm">No quizzes created yet.<br><a href="#" onclick="showPage(&quot;create&quot;)" style="color:var(--accent);font-weight:700">Create your first →</a></div>';
      } else {
        myListEl.innerHTML = '';
        mySnap.forEach(d => {
          const q = d.data();
          const item = document.createElement('div');
          item.className = 'dash-myq-item';
          item.onclick   = () => openQuiz(d.id);
          item.innerHTML = `
            <div class="dmq-dot"></div>
            <div class="dmq-info">
              <div class="dmq-title">${esc(q.title)}</div>
              <div class="dmq-meta">${esc(q.category)} · ${q.questions?.length || 0} Qs</div>
            </div>
            <div class="dmq-plays">▶ ${q.plays || 0}</div>`;
          myListEl.appendChild(item);
        });
      }
    }

  } catch (err) {
    console.error('Dashboard error:', err);
  }
}