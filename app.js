// Family Meals — local-only PWA logic. All state lives in localStorage.
const STORAGE_KEY = 'familyMeals_v1';

const CATEGORY_LABELS = {
  produce: 'Produce', protein: 'Protein', dairy: 'Dairy',
  frozen: 'Frozen', pantry: 'Pantry & Dry Goods', spice: 'Spices & Condiments',
};
const CATEGORY_ORDER = ['produce', 'protein', 'dairy', 'frozen', 'pantry', 'spice'];
const STAPLE_CATS = new Set(['pantry', 'spice']);

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function defaultState() {
  const pantryHave = {};
  const seen = {};
  RECIPES.forEach(r => r.ingredients.forEach(ing => {
    const key = ing.name.toLowerCase();
    if (!(key in seen)) { seen[key] = ing.cat; pantryHave[key] = STAPLE_CATS.has(ing.cat); }
  }));
  return {
    kidNames: { a: 'Kid A (5)', b: 'Kid B (2)' },
    pantryHave,
    planRecipeIds: [],
    shoppingChecked: {},
    extraItems: [],
    ratings: {},
    recipeMeta: {}, // id -> {timesCooked, lastCooked}
    history: [],
    oscarOverrides: {}, // id -> bool, lets you tag additional recipes beyond the seed defaults
    oscarPlan: [], // recipe ids Oscar is making this week
    hiddenRecipeIds: [], // seed recipe ids you've removed
    customRecipes: [], // recipes you've added yourself
    ui: { tab: 'recipes', mode: 'all', mealType: 'all', approvedOnly: false, freezerOnly: false, oscarOnly: false, search: '', showHave: false },
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    // merge so new ingredients added in future seed updates still get sane defaults
    return {
      ...base, ...parsed,
      pantryHave: { ...base.pantryHave, ...parsed.pantryHave },
      kidNames: { ...base.kidNames, ...parsed.kidNames },
      ui: { ...base.ui, ...parsed.ui },
    };
  } catch (e) { return defaultState(); }
}

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function ingredientIndex() {
  const idx = {};
  allRecipes().forEach(r => r.ingredients.forEach(ing => {
    const key = ing.name.toLowerCase();
    if (!idx[key]) idx[key] = { name: ing.name, cat: ing.cat };
  }));
  return idx;
}

function allRecipes() {
  return RECIPES.filter(r => !state.hiddenRecipeIds.includes(r.id)).concat(state.customRecipes);
}

function recipeById(id) { return allRecipes().find(r => r.id === id); }

function missingIngredients(recipe) {
  return recipe.ingredients.filter(ing => !state.pantryHave[ing.name.toLowerCase()]);
}

function recentCuisines(days) {
  const cutoff = Date.now() - days * 86400000;
  const set = new Set();
  state.history.forEach(h => {
    if (new Date(h.date).getTime() >= cutoff) {
      const r = recipeById(h.recipeId);
      if (r) set.add(r.cuisine);
    }
  });
  return set;
}

function isApproved(recipeId) {
  const r = state.ratings[recipeId];
  return r && r.a === 'up' && r.b === 'up';
}

function isOscarFriendly(recipe) {
  const override = state.oscarOverrides[recipe.id];
  return override !== undefined ? override : !!recipe.oscarFriendly;
}

function translateIngredient(name) {
  return ITALIAN_INGREDIENTS[name.toLowerCase()] || name;
}

const ITALIAN_UNITS = {
  stick: 'costa', sticks: 'coste',
  clove: 'spicchio', cloves: 'spicchi',
  tin: 'scatoletta', tins: 'scatolette',
  loaf: 'pagnotta',
  large: 'grande',
  handful: 'manciata',
};
function translateUnit(unit) {
  return ITALIAN_UNITS[unit.toLowerCase()] || unit;
}

// ---------- Discovery card ----------
// Surfaces one recipe worth trying: never-cooked first, then longest since last cooked.
let discoveryIndex = 0;

function discoveryCandidates() {
  return allRecipes().slice().sort((a, b) => {
    const ma = state.recipeMeta[a.id], mb = state.recipeMeta[b.id];
    const na = !ma || !ma.timesCooked, nb = !mb || !mb.timesCooked;
    if (na !== nb) return na ? -1 : 1;
    const la = ma && ma.lastCooked ? new Date(ma.lastCooked).getTime() : 0;
    const lb = mb && mb.lastCooked ? new Date(mb.lastCooked).getTime() : 0;
    return la - lb;
  });
}

function recipeTally(recipeId) {
  const tally = { count: 0, up: 0, meh: 0, down: 0 };
  state.history.forEach(h => {
    if (h.recipeId !== recipeId) return;
    tally.count++;
    if (h.ratings.a in tally) tally[h.ratings.a]++;
    if (h.ratings.b in tally) tally[h.ratings.b]++;
  });
  return tally;
}

function renderDiscoveryCard() {
  const card = document.getElementById('discoveryCard');
  const candidates = discoveryCandidates();
  if (!candidates.length) { card.classList.remove('show'); return; }
  if (discoveryIndex >= candidates.length) discoveryIndex = 0;
  const r = candidates[discoveryIndex];
  const meta = state.recipeMeta[r.id];
  const reason = (!meta || !meta.timesCooked)
    ? "You haven't made this one yet."
    : `Last cooked ${new Date(meta.lastCooked).toLocaleDateString()} — worth a repeat?`;
  const tally = recipeTally(r.id);
  const tallyLine = tally.count
    ? `Tried ${tally.count}× — ${['up', 'meh', 'down'].filter(k => tally[k]).map(k => emojiFor(k) + '×' + tally[k]).join(' ')}`
    : 'Not tried yet';
  card.classList.add('show');
  card.innerHTML = `
    <div class="disc-label">Something new to try</div>
    <div class="disc-name">${r.name}</div>
    <div class="disc-reason">${reason}</div>
    <div class="disc-tally">${tallyLine}</div>
    <div class="btn-row">
      <button class="btn secondary" id="discShuffleBtn" style="flex:none;">Show me another</button>
      <button class="btn" id="discViewBtn">View recipe</button>
    </div>`;
  document.getElementById('discShuffleBtn').addEventListener('click', () => {
    discoveryIndex = (discoveryIndex + 1) % candidates.length;
    renderDiscoveryCard();
  });
  document.getElementById('discViewBtn').addEventListener('click', () => openRecipeModal(r.id));
}

// ---------- Tab switching ----------
function setTab(tab) {
  state.ui.tab = tab; save();
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'recipes') { renderRecipes(); renderDiscoveryCard(); }
  if (tab === 'pantry') renderPantry();
  if (tab === 'shopping') renderShopping();
  if (tab === 'history') renderHistory();
  if (tab === 'oscar') renderOscarTab();
}

// ---------- Recipes tab ----------
function renderMealTypeChips() {
  const types = ['all', 'breakfast', 'lunch', 'dinner'];
  const labels = { all: 'All meals', breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
  const el = document.getElementById('mealTypeChips');
  el.innerHTML = types.map(t =>
    `<button class="chip ${state.ui.mealType === t ? 'active' : ''}" data-mealtype="${t}">${labels[t]}</button>`
  ).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.ui.mealType = b.dataset.mealtype; save(); renderMealTypeChips(); renderRecipes();
  }));
}

function filteredRecipes() {
  let list = allRecipes();
  if (state.ui.mealType !== 'all') list = list.filter(r => r.mealType === state.ui.mealType);
  if (state.ui.approvedOnly) list = list.filter(r => isApproved(r.id));
  if (state.ui.freezerOnly) list = list.filter(r => r.freezerFriendly);
  if (state.ui.oscarOnly) list = list.filter(r => isOscarFriendly(r));
  if (state.ui.search.trim()) {
    const q = state.ui.search.trim().toLowerCase();
    list = list.filter(r => r.name.toLowerCase().includes(q) ||
      r.ingredients.some(i => i.name.toLowerCase().includes(q)) ||
      r.cuisine.toLowerCase().includes(q));
  }
  if (state.ui.mode === 'pantry') {
    list = list.map(r => ({ r, missing: missingIngredients(r).length }))
      .sort((a, b) => a.missing - b.missing)
      .map(x => x.r);
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return list;
}

function renderRecipes() {
  const list = filteredRecipes();
  const container = document.getElementById('recipeList');
  if (!list.length) {
    container.innerHTML = `<div class="empty"><div class="big">🍲</div>No recipes match — try a different filter.</div>`;
    return;
  }
  const recent = recentCuisines(14);
  container.innerHTML = list.map(r => {
    const missing = missingIngredients(r);
    let badges = '';
    if (state.ui.mode === 'pantry') {
      badges += missing.length === 0
        ? `<span class="badge ready">✅ Ready now</span>`
        : `<span class="badge missing">Missing ${missing.length}</span>`;
    }
    if (r.freezerFriendly) badges += `<span class="badge freezer">❄️ Freezer</span>`;
    if (isApproved(r.id)) badges += `<span class="badge approved">⭐ Both kids approved</span>`;
    if (isOscarFriendly(r)) badges += `<span class="badge oscar">👨‍🍳 Oscar can make</span>`;
    if (!recent.has(r.cuisine)) badges += `<span class="badge variety">🌱 Adds variety</span>`;

    return `
      <div class="card recipe-card" data-id="${r.id}">
        <div class="title-row">
          <div>
            <div class="title">${r.name}</div>
            <div class="meta">${r.cuisine} · ${cap(r.mealType)} · ${r.prepMin} min</div>
          </div>
        </div>
        <div class="badge-row">${badges}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', () => openRecipeModal(card.dataset.id));
  });
}

// ---------- Recipe detail (full-screen modal) ----------
let currentModalRecipeId = null;

function openRecipeModal(recipeId) {
  const r = recipeById(recipeId);
  if (!r) return;
  currentModalRecipeId = recipeId;
  document.getElementById('recipeModalTitle').textContent = r.name;
  renderRecipeModalBody();
  document.getElementById('recipeDetailModal').classList.remove('hidden');
}

function closeRecipeModal() {
  currentModalRecipeId = null;
  document.getElementById('recipeDetailModal').classList.add('hidden');
}

function renderRecipeModalBody() {
  const r = recipeById(currentModalRecipeId);
  if (!r) { closeRecipeModal(); return; }
  const meta = state.recipeMeta[r.id] || {};
  const ingHtml = r.ingredients.map(ing => {
    const have = !!state.pantryHave[ing.name.toLowerCase()];
    return `<li class="${have ? 'have' : ''}"><span class="dot"></span>${ing.qty ? ing.qty + (ing.unit ? ' ' + ing.unit : '') + ' ' : ''}${ing.name}</li>`;
  }).join('');
  const stepsHtml = r.steps.map(s => `<li>${s}</li>`).join('');
  const inPlan = state.planRecipeIds.includes(r.id);
  const ratingA = (state.ratings[r.id] || {}).a;
  const ratingB = (state.ratings[r.id] || {}).b;
  const tally = recipeTally(r.id);
  const tallyLine = tally.count
    ? ['up', 'meh', 'down'].filter(k => tally[k]).map(k => emojiFor(k) + '×' + tally[k]).join(' ')
    : 'Not tried yet';

  document.getElementById('recipeModalBody').innerHTML = `
    <div class="meta" style="margin-bottom:12px;">${r.cuisine} · ${cap(r.mealType)} · ${r.prepMin} min</div>
    <div class="recipe-detail" style="margin-top:0; border-top:none; padding-top:0;">
    <h4>Ingredients</h4>
    <ul class="ing-list">${ingHtml}</ul>
    <div class="note-box">👶 <strong>Toddler tip:</strong> ${r.toddlerNotes}</div>
    <h4>Steps</h4>
    <ol class="steps-list">${stepsHtml}</ol>
    <h4>Taste-test scorecard</h4>
    <div class="rate-row"><span class="who">${state.kidNames.a}</span><span>${ratingA ? emojiFor(ratingA) : '—'}</span></div>
    <div class="rate-row"><span class="who">${state.kidNames.b}</span><span>${ratingB ? emojiFor(ratingB) : '—'}</span></div>
    <div class="meta" style="margin-top:6px;">${tallyLine}</div>
    ${meta.timesCooked ? `<div class="meta" style="margin-top:2px;">Cooked ${meta.timesCooked}× · last on ${new Date(meta.lastCooked).toLocaleDateString()}</div>` : ''}
    <div class="btn-row">
      <button class="btn ${inPlan ? 'secondary' : ''}" data-action="toggle-plan">${inPlan ? '✓ In shopping plan' : '+ Add to shopping plan'}</button>
      <button class="btn secondary" data-action="mark-cooked">Mark cooked today</button>
    </div>
    <div class="toggle-row">
      <span>👨‍🍳 Oscar can prepare this</span>
      <label class="switch">
        <input type="checkbox" data-action="toggle-oscar" ${isOscarFriendly(r) ? 'checked' : ''}>
        <span class="track"></span>
      </label>
    </div>
    <div class="btn-row">
      <button class="btn danger" data-action="remove-recipe" style="flex:none;">🗑️ Remove recipe</button>
    </div>
    </div>`;

  const body = document.getElementById('recipeModalBody');
  body.querySelector('[data-action="toggle-plan"]').addEventListener('click', () => {
    const i = state.planRecipeIds.indexOf(r.id);
    if (i >= 0) state.planRecipeIds.splice(i, 1); else state.planRecipeIds.push(r.id);
    save(); renderRecipeModalBody();
  });
  body.querySelector('[data-action="mark-cooked"]').addEventListener('click', () => openRateModal(r.id));
  body.querySelector('[data-action="toggle-oscar"]').addEventListener('change', (e) => {
    state.oscarOverrides[r.id] = e.target.checked;
    save(); renderRecipes();
  });
  body.querySelector('[data-action="remove-recipe"]').addEventListener('click', () => {
    if (!confirm(`Remove "${r.name}" from your recipe list? You can restore built-in recipes later from Settings.`)) return;
    if (r.isCustom) {
      state.customRecipes = state.customRecipes.filter(x => x.id !== r.id);
    } else {
      if (!state.hiddenRecipeIds.includes(r.id)) state.hiddenRecipeIds.push(r.id);
    }
    state.planRecipeIds = state.planRecipeIds.filter(id => id !== r.id);
    state.oscarPlan = state.oscarPlan.filter(id => id !== r.id);
    save();
    closeRecipeModal();
    renderRecipes();
    renderDiscoveryCard();
  });
}

document.getElementById('closeRecipeModalBtn').addEventListener('click', closeRecipeModal);

function emojiFor(v) { return v === 'up' ? '👍' : v === 'meh' ? '😐' : '👎'; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------- Rate modal ----------
let rateDraft = { a: null, b: null };
function openRateModal(recipeId) {
  const r = recipeById(recipeId);
  rateDraft = { ...(state.ratings[recipeId] || { a: 'up', b: 'up' }) };
  document.getElementById('rateModalTitle').textContent = `Mark cooked — ${r.name}`;
  renderRateModalBody();
  document.getElementById('rateModal').classList.remove('hidden');
  document.getElementById('saveRateBtn').onclick = () => {
    state.ratings[recipeId] = { ...rateDraft };
    const meta = state.recipeMeta[recipeId] || { timesCooked: 0 };
    meta.timesCooked = (meta.timesCooked || 0) + 1;
    meta.lastCooked = new Date().toISOString();
    state.recipeMeta[recipeId] = meta;
    state.history.unshift({ id: uid(), date: new Date().toISOString(), recipeId, ratings: { ...rateDraft } });
    save();
    document.getElementById('rateModal').classList.add('hidden');
    renderRecipes();
    renderDiscoveryCard();
    if (currentModalRecipeId === recipeId) renderRecipeModalBody();
    if (state.ui.tab === 'history') renderHistory();
  };
}
function renderRateModalBody() {
  const body = document.getElementById('rateModalBody');
  const rows = ['a', 'b'].map(k => `
    <div class="rate-row">
      <span class="who">${state.kidNames[k]}</span>
      <div class="rate-btns">
        <button data-kid="${k}" data-val="up" class="${rateDraft[k] === 'up' ? 'sel' : ''}">👍</button>
        <button data-kid="${k}" data-val="meh" class="${rateDraft[k] === 'meh' ? 'sel' : ''}">😐</button>
        <button data-kid="${k}" data-val="down" class="${rateDraft[k] === 'down' ? 'sel' : ''}">👎</button>
      </div>
    </div>`).join('');
  body.innerHTML = rows;
  body.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    rateDraft[b.dataset.kid] = b.dataset.val;
    renderRateModalBody();
  }));
}
document.getElementById('closeRateBtn').addEventListener('click', () => document.getElementById('rateModal').classList.add('hidden'));

// ---------- Pantry tab ----------
function renderPantry() {
  const idx = ingredientIndex();
  const q = document.getElementById('pantrySearch').value.trim().toLowerCase();
  const byCat = {};
  Object.values(idx).forEach(ing => {
    if (q && !ing.name.toLowerCase().includes(q)) return;
    (byCat[ing.cat] = byCat[ing.cat] || []).push(ing);
  });
  const container = document.getElementById('pantryList');
  container.innerHTML = CATEGORY_ORDER.filter(c => byCat[c] && byCat[c].length).map(cat => {
    const rows = byCat[cat].sort((a, b) => a.name.localeCompare(b.name)).map(ing => {
      const key = ing.name.toLowerCase();
      const have = !!state.pantryHave[key];
      return `
        <div class="pantry-row">
          <span>${cap(ing.name)}</span>
          <label class="switch">
            <input type="checkbox" data-key="${key}" ${have ? 'checked' : ''}>
            <span class="track"></span>
          </label>
        </div>`;
    }).join('');
    return `<div class="pantry-group"><h3>${CATEGORY_LABELS[cat]}</h3>${rows}</div>`;
  }).join('') || `<div class="empty">No ingredients match your search.</div>`;

  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.pantryHave[cb.dataset.key] = cb.checked;
      save();
      if (state.ui.tab === 'recipes') renderRecipes();
    });
  });
}
document.getElementById('pantrySearch').addEventListener('input', renderPantry);

// ---------- Shopping tab ----------
function renderShopping() {
  const planChips = document.getElementById('planChips');
  if (!state.planRecipeIds.length) {
    planChips.innerHTML = '';
  } else {
    planChips.innerHTML = state.planRecipeIds.map(id => {
      const r = recipeById(id);
      return `<span class="plan-chip">${r ? r.name : id}<button data-remove="${id}">×</button></span>`;
    }).join('');
    planChips.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      state.planRecipeIds = state.planRecipeIds.filter(id => id !== b.dataset.remove);
      save(); renderShopping();
    }));
  }

  const content = document.getElementById('shoppingContent');
  if (!state.planRecipeIds.length && !state.extraItems.length) {
    content.innerHTML = `<div class="empty"><div class="big">🛒</div>Add recipes from the Recipes tab ("Add to shopping plan") to build your list, or add items manually below.</div>${renderExtraSection()}`;
    bindExtraSection();
    return;
  }

  // consolidate ingredients from plan recipes
  const items = {}; // key -> {name, cat, from:[recipeNames]}
  state.planRecipeIds.forEach(id => {
    const r = recipeById(id);
    if (!r) return;
    r.ingredients.forEach(ing => {
      const key = ing.name.toLowerCase();
      if (!items[key]) items[key] = { name: ing.name, cat: ing.cat, from: [] };
      items[key].from.push(r.name);
    });
  });

  const showHave = state.ui.showHave;
  let visibleKeys = Object.keys(items).filter(k => showHave || !state.pantryHave[k]);
  const hiddenCount = Object.keys(items).length - visibleKeys.length;

  const byCat = {};
  visibleKeys.forEach(k => (byCat[items[k].cat] = byCat[items[k].cat] || []).push(k));

  let html = `<div class="chip-row">
      <button class="chip ${showHave ? 'active' : ''}" id="toggleShowHave">👁️ Show items I already have ${hiddenCount ? '(' + hiddenCount + ' hidden)' : ''}</button>
    </div>`;

  html += CATEGORY_ORDER.filter(c => byCat[c] && byCat[c].length).map(cat => {
    const rows = byCat[cat].map(k => {
      const item = items[k];
      const checked = !!state.shoppingChecked[k];
      return `
        <div class="shop-item ${checked ? 'checked' : ''}">
          <input type="checkbox" data-key="${k}" ${checked ? 'checked' : ''}>
          <div class="name">${cap(item.name)}<span class="from">for ${[...new Set(item.from)].join(', ')}</span></div>
        </div>`;
    }).join('');
    return `<h4 style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin:14px 4px 6px;">${CATEGORY_LABELS[cat]}</h4>${rows}`;
  }).join('');

  html += renderExtraSection();
  html += `<div class="btn-row">
      <button class="btn secondary" id="copyTickTickBtn">📋 Copy for TickTick</button>
      <button class="btn" id="doneShoppingBtn">✓ Done shopping — update pantry</button>
    </div>`;

  content.innerHTML = html;

  document.getElementById('toggleShowHave').addEventListener('click', () => {
    state.ui.showHave = !state.ui.showHave; save(); renderShopping();
  });
  content.querySelectorAll('.shop-item input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.shoppingChecked[cb.dataset.key] = cb.checked; save(); renderShopping();
    });
  });
  document.getElementById('copyTickTickBtn').addEventListener('click', async () => {
    const text = buildTickTickText();
    const btn = document.getElementById('copyTickTickBtn');
    if (!text) { alert('Nothing to copy yet.'); return; }
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch (e) {
      alert(text);
    }
  });
  document.getElementById('doneShoppingBtn').addEventListener('click', () => {
    if (!confirm('Mark checked items as now in your pantry, and clear the shopping plan?')) return;
    Object.keys(state.shoppingChecked).forEach(k => {
      if (state.shoppingChecked[k]) state.pantryHave[k] = true;
    });
    state.extraItems.forEach(it => { if (it.checked) state.pantryHave[it.name.toLowerCase()] = true; });
    state.planRecipeIds = [];
    state.shoppingChecked = {};
    state.extraItems = [];
    save(); renderShopping();
  });
  bindExtraSection();
}

function buildTickTickText() {
  const seen = new Set();
  const lines = [];
  state.planRecipeIds.forEach(id => {
    const r = recipeById(id);
    if (!r) return;
    r.ingredients.forEach(ing => {
      const key = ing.name.toLowerCase();
      if (state.pantryHave[key] || seen.has(key)) return;
      seen.add(key);
      lines.push(cap(ing.name));
    });
  });
  state.extraItems.filter(it => !it.checked).forEach(it => lines.push(it.name));
  return lines.join('\n');
}

function renderExtraSection() {
  const rows = state.extraItems.map(it => `
    <div class="shop-item ${it.checked ? 'checked' : ''}">
      <input type="checkbox" data-extra="${it.id}" ${it.checked ? 'checked' : ''}>
      <div class="name">${it.name}</div>
      <button class="btn ghost" data-del-extra="${it.id}" style="padding:4px 8px;">✕</button>
    </div>`).join('');
  return `
    <h4 style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin:14px 4px 6px;">Extra items</h4>
    ${rows}
    <div class="add-item-row">
      <input type="text" id="extraItemInput" placeholder="Add something else…">
      <button class="btn" id="addExtraBtn" style="flex:none;">Add</button>
    </div>`;
}
function bindExtraSection() {
  const content = document.getElementById('shoppingContent');
  content.querySelectorAll('[data-extra]').forEach(cb => {
    cb.addEventListener('change', () => {
      const it = state.extraItems.find(x => x.id === cb.dataset.extra);
      if (it) it.checked = cb.checked;
      save(); renderShopping();
    });
  });
  content.querySelectorAll('[data-del-extra]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.extraItems = state.extraItems.filter(x => x.id !== btn.dataset.delExtra);
      save(); renderShopping();
    });
  });
  const addBtn = document.getElementById('addExtraBtn');
  if (addBtn) addBtn.addEventListener('click', addExtraItem);
  const input = document.getElementById('extraItemInput');
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addExtraItem(); });
}
function addExtraItem() {
  const input = document.getElementById('extraItemInput');
  const val = input.value.trim();
  if (!val) return;
  state.extraItems.push({ id: uid(), name: val, checked: false });
  save(); renderShopping();
}

// ---------- History tab ----------
function renderHistory() {
  const total = state.history.length;
  const upA = state.history.filter(h => h.ratings.a === 'up').length;
  const upB = state.history.filter(h => h.ratings.b === 'up').length;
  document.getElementById('statRow').innerHTML = `
    <div class="stat-card"><div class="num">${total}</div><div class="lbl">Meals logged</div></div>
    <div class="stat-card"><div class="num">${total ? Math.round(upA / total * 100) : 0}%</div><div class="lbl">${state.kidNames.a} loved</div></div>
    <div class="stat-card"><div class="num">${total ? Math.round(upB / total * 100) : 0}%</div><div class="lbl">${state.kidNames.b} loved</div></div>`;

  const list = document.getElementById('historyList');
  if (!total) {
    list.innerHTML = `<div class="empty"><div class="big">📋</div>Nothing logged yet — hit "Mark cooked today" on a recipe once you've made it.</div>`;
    return;
  }
  list.innerHTML = state.history.map(h => {
    const r = recipeById(h.recipeId);
    return `
      <div class="hist-row">
        <div class="top"><span>${r ? r.name : 'Unknown recipe'}</span><span class="date">${new Date(h.date).toLocaleDateString()}</span></div>
        <div class="ratings">${state.kidNames.a}: ${emojiFor(h.ratings.a)} &nbsp; ${state.kidNames.b}: ${emojiFor(h.ratings.b)}</div>
      </div>`;
  }).join('');
}

// ---------- Oscar tab ----------
function renderOscarTab() {
  const oscarRecipes = allRecipes().filter(isOscarFriendly).sort((a, b) => a.name.localeCompare(b.name));
  const list = document.getElementById('oscarList');
  if (!oscarRecipes.length) {
    list.innerHTML = `<div class="empty"><div class="big">👨‍🍳</div>No recipes tagged for Oscar yet — open a recipe in the Recipes tab and flip on "Oscar can prepare this".</div>`;
  } else {
    list.innerHTML = oscarRecipes.map(r => `
      <div class="oscar-row">
        <input type="checkbox" data-oscar-plan="${r.id}" ${state.oscarPlan.includes(r.id) ? 'checked' : ''}>
        <div>
          <div class="name">${r.name}${r.it ? ' · ' + r.it.name : ''}</div>
          <div class="meta">${r.cuisine} · ${r.prepMin} min ${r.freezerFriendly ? '· ❄️ freezes well' : ''}</div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-oscar-plan]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.oscarPlan;
        if (cb.checked) { if (!state.oscarPlan.includes(id)) state.oscarPlan.push(id); }
        else state.oscarPlan = state.oscarPlan.filter(x => x !== id);
        save();
      });
    });
  }
  document.getElementById('oscarMessageBox').classList.add('hidden');
  document.getElementById('oscarCopyRow').classList.add('hidden');
}

function buildOscarMessage() {
  const selected = allRecipes().filter(r => state.oscarPlan.includes(r.id));
  if (!selected.length) return null;
  const lines = [];
  lines.push(`Ciao Oscar! 👋 Ecco i piatti di questa settimana:`);
  selected.forEach(r => {
    const name = r.it ? r.it.name : r.name;
    lines.push(`\n🍽️ ${name}`);
    r.ingredients.forEach(ing => {
      const qty = ing.qty ? `${ing.qty}${ing.unit ? ' ' + translateUnit(ing.unit) : ''} ` : '';
      lines.push(`- ${qty}${translateIngredient(ing.name)}`);
    });
  });
  lines.push(`\nGrazie mille! 😊`);
  return lines.join('\n');
}

document.getElementById('generateOscarBtn').addEventListener('click', () => {
  const msg = buildOscarMessage();
  const box = document.getElementById('oscarMessageBox');
  const copyRow = document.getElementById('oscarCopyRow');
  if (!msg) {
    box.value = '';
    box.classList.add('hidden');
    copyRow.classList.add('hidden');
    alert('Tick at least one recipe above first.');
    return;
  }
  box.value = msg;
  box.classList.remove('hidden');
  copyRow.classList.remove('hidden');
});
document.getElementById('copyOscarBtn').addEventListener('click', async () => {
  const box = document.getElementById('oscarMessageBox');
  try {
    await navigator.clipboard.writeText(box.value);
    const btn = document.getElementById('copyOscarBtn');
    const original = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (e) {
    box.select();
    document.execCommand('copy');
  }
});

// ---------- Add recipe ----------
let newRecipeIngredients = [];

function openAddRecipeModal() {
  document.getElementById('newRecipeName').value = '';
  document.getElementById('newRecipeCuisine').value = '';
  document.getElementById('newRecipeMealType').value = 'dinner';
  document.getElementById('newRecipePrepMin').value = '';
  document.getElementById('newRecipeFreezer').checked = false;
  document.getElementById('newRecipeToddlerNotes').value = '';
  document.getElementById('newRecipeSteps').value = '';
  newRecipeIngredients = [{ name: '', qty: '', unit: '', cat: 'produce' }];
  renderIngredientRows();
  document.getElementById('addRecipeModal').classList.remove('hidden');
}

function renderIngredientRows() {
  const container = document.getElementById('newRecipeIngredients');
  container.innerHTML = newRecipeIngredients.map((ing, i) => `
    <div class="ingredient-row">
      <input type="text" placeholder="Ingredient" data-field="name" data-idx="${i}" value="${ing.name.replace(/"/g, '&quot;')}">
      <input type="text" class="qty" placeholder="Qty" data-field="qty" data-idx="${i}" value="${ing.qty.replace(/"/g, '&quot;')}">
      <input type="text" class="unit" placeholder="Unit" data-field="unit" data-idx="${i}" value="${ing.unit.replace(/"/g, '&quot;')}">
      <select data-field="cat" data-idx="${i}">
        ${CATEGORY_ORDER.map(c => `<option value="${c}" ${ing.cat === c ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`).join('')}
      </select>
      <button type="button" data-remove-ing="${i}">✕</button>
    </div>`).join('');
  container.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      newRecipeIngredients[input.dataset.idx][input.dataset.field] = input.value;
    });
    input.addEventListener('change', () => {
      newRecipeIngredients[input.dataset.idx][input.dataset.field] = input.value;
    });
  });
  container.querySelectorAll('[data-remove-ing]').forEach(btn => {
    btn.addEventListener('click', () => {
      newRecipeIngredients.splice(Number(btn.dataset.removeIng), 1);
      if (!newRecipeIngredients.length) newRecipeIngredients.push({ name: '', qty: '', unit: '', cat: 'produce' });
      renderIngredientRows();
    });
  });
}

document.getElementById('openAddRecipeBtn').addEventListener('click', openAddRecipeModal);
document.getElementById('closeAddRecipeBtn').addEventListener('click', () => document.getElementById('addRecipeModal').classList.add('hidden'));
document.getElementById('addIngredientRowBtn').addEventListener('click', () => {
  newRecipeIngredients.push({ name: '', qty: '', unit: '', cat: 'produce' });
  renderIngredientRows();
});
document.getElementById('saveNewRecipeBtn').addEventListener('click', () => {
  const name = document.getElementById('newRecipeName').value.trim();
  if (!name) { alert('Give the recipe a name first.'); return; }
  const ingredients = newRecipeIngredients
    .filter(ing => ing.name.trim())
    .map(ing => ({ name: ing.name.trim(), qty: ing.qty.trim(), unit: ing.unit.trim(), cat: ing.cat }));
  const steps = document.getElementById('newRecipeSteps').value.split('\n').map(s => s.trim()).filter(Boolean);
  const recipe = {
    id: 'custom-' + uid(),
    isCustom: true,
    name,
    cuisine: document.getElementById('newRecipeCuisine').value.trim() || 'Home recipe',
    mealType: document.getElementById('newRecipeMealType').value,
    prepMin: Number(document.getElementById('newRecipePrepMin').value) || 0,
    freezerFriendly: document.getElementById('newRecipeFreezer').checked,
    foodGroups: [],
    toddlerNotes: document.getElementById('newRecipeToddlerNotes').value.trim() || 'Adapt texture and portion size as needed.',
    steps: steps.length ? steps : ['Prepare as usual.'],
    ingredients,
  };
  state.customRecipes.push(recipe);
  save();
  document.getElementById('addRecipeModal').classList.add('hidden');
  renderRecipes();
});

// ---------- Settings ----------
function openSettings() {
  document.getElementById('kidAName').value = state.kidNames.a;
  document.getElementById('kidBName').value = state.kidNames.b;
  renderHiddenRecipesSection();
  document.getElementById('settingsModal').classList.remove('hidden');
}

function renderHiddenRecipesSection() {
  const el = document.getElementById('hiddenRecipesSection');
  if (!state.hiddenRecipeIds.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <h2 style="margin-top:18px;">Removed recipes</h2>
    ${state.hiddenRecipeIds.map(id => {
      const r = RECIPES.find(x => x.id === id);
      if (!r) return '';
      return `<div class="pantry-row"><span>${r.name}</span><button class="btn secondary" data-restore="${id}" style="flex:none;padding:6px 10px;">Restore</button></div>`;
    }).join('')}`;
  el.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.hiddenRecipeIds = state.hiddenRecipeIds.filter(id => id !== btn.dataset.restore);
      save();
      renderHiddenRecipesSection();
      renderRecipes();
    });
  });
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettingsBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  state.kidNames.a = document.getElementById('kidAName').value.trim() || state.kidNames.a;
  state.kidNames.b = document.getElementById('kidBName').value.trim() || state.kidNames.b;
  save();
  document.getElementById('settingsModal').classList.add('hidden');
  renderRecipes();
});
document.getElementById('resetDataBtn').addEventListener('click', () => {
  if (!confirm('This clears all pantry, ratings, shopping plan and history on this device. Continue?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  save();
  document.getElementById('settingsModal').classList.add('hidden');
  setTab('recipes');
});

// ---------- Nav & filters wiring ----------
document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.querySelectorAll('#modeToggle button').forEach(b => b.addEventListener('click', () => {
  state.ui.mode = b.dataset.mode; save();
  document.querySelectorAll('#modeToggle button').forEach(x => x.classList.toggle('active', x === b));
  renderRecipes();
}));
document.getElementById('searchBox').addEventListener('input', (e) => {
  state.ui.search = e.target.value; save(); renderRecipes();
});
document.getElementById('chipApproved').addEventListener('click', () => {
  state.ui.approvedOnly = !state.ui.approvedOnly; save();
  document.getElementById('chipApproved').classList.toggle('active', state.ui.approvedOnly);
  renderRecipes();
});
document.getElementById('chipFreezer').addEventListener('click', () => {
  state.ui.freezerOnly = !state.ui.freezerOnly; save();
  document.getElementById('chipFreezer').classList.toggle('active', state.ui.freezerOnly);
  renderRecipes();
});
document.getElementById('chipOscar').addEventListener('click', () => {
  state.ui.oscarOnly = !state.ui.oscarOnly; save();
  document.getElementById('chipOscar').classList.toggle('active', state.ui.oscarOnly);
  renderRecipes();
});

// ---------- Init ----------
document.getElementById('modeToggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === state.ui.mode));
document.getElementById('chipApproved').classList.toggle('active', state.ui.approvedOnly);
document.getElementById('chipFreezer').classList.toggle('active', state.ui.freezerOnly);
document.getElementById('chipOscar').classList.toggle('active', state.ui.oscarOnly);
document.getElementById('searchBox').value = state.ui.search;
renderMealTypeChips();
setTab(state.ui.tab || 'recipes');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
