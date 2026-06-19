// ── Config ────────────────────────────────────────────────────
const API = '/api/products';   // local proxy → Shopify Admin API
const PAGE_SIZE = 12;

// ── State ─────────────────────────────────────────────────────
let allProducts   = [];
let localProducts = [];
let currentFilter = 'all';
let currentSort   = 'title';
let currentType   = '';
let currentPage   = 1;
let pendingDeleteId = null;
let isSaving      = false;
let cachedImages  = null;

// ── Helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDate = iso => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

function productImage(p) {
  // Use the first Shopify image if available
  if (p.images && p.images.length > 0) return p.images[0].src;
  // Fallback: spread across picsum using index
  const n = ((p._imgIdx || 0) * 17 + 3) % 1000 + 1;
  return `https://picsum.photos/id/${n}/400/400`;
}

function productPlaceholderIcon(type) {
  const icons = {
    snowboard:   `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3c0 0-5 4-5 9a5 5 0 0010 0c0-5-5-9-5-9z"/><ellipse cx="12" cy="19" rx="3" ry="1.5"/></svg>`,
    accessories: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
    giftcard:    `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 12v10H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>`,
  };
  return icons[type] || `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
}

function filtered() {
  const q = $('searchInput').value.toLowerCase().trim();
  let list = localProducts.filter(p => {
    if (q && !p.title.toLowerCase().includes(q) &&
        !(p.vendor || '').toLowerCase().includes(q) &&
        !(p.product_type || '').toLowerCase().includes(q)) return false;
    if (currentFilter !== 'all' && p.status !== currentFilter) return false;
    if (currentType && p.product_type !== currentType) return false;
    return true;
  });
  return list.sort((a, b) => {
    if (currentSort === 'title')      return a.title.localeCompare(b.title);
    if (currentSort === 'title-desc') return b.title.localeCompare(a.title);
    if (currentSort === 'date-desc')  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    if (currentSort === 'date-asc')   return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    return 0;
  });
}

// ── Render ────────────────────────────────────────────────────
function render() {
  if (currentView !== 'products') return;
  const list  = filtered();
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  const slice = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const grid = $('productsGrid');
  $('emptyState').style.display = (total === 0 && localProducts.length > 0) ? 'flex' : 'none';
  grid.style.display = '';

  grid.innerHTML = slice.map(p => {
    const type = (p.product_type || '').toLowerCase();
    const icon = productPlaceholderIcon(type);
    const img  = productImage(p);
    const price = p.price ? `$${parseFloat(p.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
    return `
    <div class="product-card" data-id="${p.id}">
      <div class="card-img-wrap">
        <img class="card-img" src="${esc(img)}" alt="${esc(p.title)}" loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="card-img-placeholder" style="display:none">${icon}</div>
        <span class="card-badge badge-${esc(p.status)}">${esc(p.status)}</span>
        <div class="card-actions">
          <button class="card-action-btn" data-action="inventory" data-id="${p.id}" title="Inventory">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
              <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
            </svg>
          </button>
          <button class="card-action-btn" data-action="edit" data-id="${p.id}" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="card-action-btn del" data-action="delete" data-id="${p.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title" title="${esc(p.title)}">${esc(p.title)}</div>
        <div class="card-meta">
          <span class="card-type">${esc(p.product_type || 'uncategorized')}</span>
          <span class="card-vendor" title="${esc(p.vendor || '')}">${esc(p.vendor || '—')}</span>
        </div>
        <div class="card-footer-row">
          ${price ? `<span class="card-price">${price}</span>` : '<span></span>'}
          <span class="card-date">${fmtDate(p.created_at)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Stats
  $('statTotal').textContent    = localProducts.length;
  $('statActive').textContent   = localProducts.filter(p => p.status === 'active').length;
  $('statDraft').textContent    = localProducts.filter(p => p.status === 'draft').length;
  $('statArchived').textContent = localProducts.filter(p => p.status === 'archived').length;
  $('sidebarCount').textContent = localProducts.length;

  // Pagination
  $('paginationWrap').style.display = total > PAGE_SIZE ? 'flex' : 'none';
  $('paginationInfo').textContent = total
    ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total} products`
    : '';

  const pnums = $('pageNumbers');
  pnums.innerHTML = '';
  pageRange(currentPage, pages).forEach(n => {
    if (n === '…') {
      const s = document.createElement('span');
      s.className = 'page-num'; s.textContent = '…'; s.style.cursor = 'default';
      pnums.appendChild(s);
    } else {
      const btn = document.createElement('button');
      btn.className = 'page-num' + (n === currentPage ? ' active' : '');
      btn.textContent = n;
      btn.addEventListener('click', () => { currentPage = n; render(); scrollTop(); });
      pnums.appendChild(btn);
    }
  });
  $('prevPage').disabled = currentPage === 1;
  $('nextPage').disabled = currentPage === pages;
}

function pageRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (cur <= 4)       return [1, 2, 3, 4, 5, '…', total];
  if (cur >= total-3) return [1, '…', total-4, total-3, total-2, total-1, total];
  return [1, '…', cur-1, cur, cur+1, '…', total];
}

function scrollTop() {
  document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' });
}

function populateTypeFilter(products) {
  const types = [...new Set(products.map(p => p.product_type || ''))].sort();
  const sel = $('typeFilter');
  sel.innerHTML = '<option value="">All types</option>';
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t || 'uncategorized';
    sel.appendChild(opt);
  });
}

// ── API ───────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.errors || `HTTP ${res.status}`);
  return data;
}

// ── LOAD products ─────────────────────────────────────────────
async function fetchProducts() {
  showLoading(true);
  hideError();
  $('productsGrid').innerHTML = '';
  try {
    const data = await apiFetch(API);
    allProducts   = (data.products || []).map((p, i) => ({ ...p, _imgIdx: i }));
    localProducts = [...allProducts];
    populateTypeFilter(allProducts);
    $('apiSource').textContent = `${allProducts.length} products · Shopify live`;
    currentPage = 1;
    render();
    showLoading(false);
  } catch (err) {
    showLoading(false);
    showError(err.message);
  }
}

// ── CREATE ────────────────────────────────────────────────────
async function createProduct(payload) {
  const created = await apiFetch(API, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  created._imgIdx = localProducts.length;
  localProducts.unshift(created);
  allProducts.unshift(created);
  populateTypeFilter(localProducts);
  return created;
}

// ── UPDATE ────────────────────────────────────────────────────
async function updateProduct(id, payload) {
  const updated = await apiFetch(`${API}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const merge = p => String(p.id) === String(id) ? { ...p, ...updated, _imgIdx: p._imgIdx } : p;
  localProducts = localProducts.map(merge);
  allProducts   = allProducts.map(merge);
  return updated;
}

// ── DELETE ────────────────────────────────────────────────────
async function deleteProduct(id) {
  await apiFetch(`${API}/${id}`, { method: 'DELETE' });
  localProducts = localProducts.filter(p => String(p.id) !== String(id));
  allProducts   = allProducts.filter(p => String(p.id) !== String(id));
}

// ── UI events ─────────────────────────────────────────────────
$('refreshBtn').addEventListener('click', fetchProducts);
$('retryBtn').addEventListener('click', fetchProducts);
$('searchInput').addEventListener('input', () => { currentPage = 1; render(); });

document.querySelectorAll('.filter-tab').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    currentPage = 1;
    render();
  })
);

$('typeFilter').addEventListener('change', e => { currentType = e.target.value; currentPage = 1; render(); });
$('sortSelect').addEventListener('change', e => { currentSort = e.target.value; render(); });

$('prevPage').addEventListener('click', () => { if (currentPage > 1) { currentPage--; render(); scrollTop(); } });
$('nextPage').addEventListener('click', () => {
  const pages = Math.ceil(filtered().length / PAGE_SIZE);
  if (currentPage < pages) { currentPage++; render(); scrollTop(); }
});

// card actions
$('productsGrid').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.stopPropagation();
  if (btn.dataset.action === 'inventory') openInventory(btn.dataset.id);
  if (btn.dataset.action === 'edit')      openEdit(btn.dataset.id);
  if (btn.dataset.action === 'delete')    openDelete(btn.dataset.id);
});

// ── Modal helpers ─────────────────────────────────────────────
const openModal       = () => $('modalOverlay').classList.add('open');
const closeModal      = () => { $('modalOverlay').classList.remove('open'); clearForm(); };
const openDeleteModal  = () => $('deleteOverlay').classList.add('open');
const closeDeleteModal = () => $('deleteOverlay').classList.remove('open');

function clearForm() {
  $('editId').value             = '';
  $('fieldTitle').value         = '';
  $('fieldType').value          = '';
  $('fieldVendor').value        = '';
  $('fieldDescription').value   = '';
  $('fieldImageSrc').value      = '';
  document.querySelector('input[name="status"][value="active"]').checked = true;
  $('formError').textContent    = '';
  setSaving(false);
}

// ── Image picker ──────────────────────────────────────────────
async function loadImagePicker(selectedSrc = '') {
  const wrap = $('imagePickerWrap');
  if (!cachedImages) {
    wrap.innerHTML = '<div class="img-picker-msg">Loading images…</div>';
    try {
      const data = await apiFetch('/api/images');
      cachedImages = data.images || [];
    } catch {
      wrap.innerHTML = '<div class="img-picker-msg">Could not load images.</div>';
      return;
    }
  }
  renderImagePicker(selectedSrc);
}

function renderImagePicker(selectedSrc = '') {
  const wrap = $('imagePickerWrap');
  const grid = document.createElement('div');
  grid.className = 'img-picker-grid';

  const none = document.createElement('div');
  none.className = 'img-picker-none' + (!selectedSrc ? ' selected' : '');
  none.title = 'No image';
  none.textContent = '×';
  none.addEventListener('click', () => selectImage(''));
  grid.appendChild(none);

  cachedImages.forEach(img => {
    const item = document.createElement('div');
    item.className = 'img-picker-item' + (img.src === selectedSrc ? ' selected' : '');
    item.title = img.product_title;
    const el = document.createElement('img');
    el.src = img.src;
    el.alt = img.alt;
    el.loading = 'lazy';
    item.appendChild(el);
    item.addEventListener('click', () => selectImage(img.src));
    grid.appendChild(item);
  });

  wrap.innerHTML = '';
  wrap.appendChild(grid);
}

function selectImage(src) {
  $('fieldImageSrc').value = src;
  document.querySelectorAll('.img-picker-item').forEach(el =>
    el.classList.toggle('selected', el.querySelector('img')?.src === src && src !== '')
  );
  const none = document.querySelector('.img-picker-none');
  if (none) none.classList.toggle('selected', !src);
}

function validate() {
  if (!$('fieldTitle').value.trim()) {
    $('formError').textContent = 'Product title is required.';
    return false;
  }
  $('formError').textContent = '';
  return true;
}

function setSaving(on) {
  isSaving = on;
  const btn = $('saveBtn');
  btn.disabled = on;
  btn.textContent = on ? 'Saving…' : ($('editId').value ? 'Update product' : 'Save product');
}

// ── Add ───────────────────────────────────────────────────────
$('openAddModal').addEventListener('click', () => {
  $('modalTitle').textContent = 'Add product';
  clearForm();
  openModal();
  loadImagePicker('');
});

// ── Edit ──────────────────────────────────────────────────────
function openEdit(id) {
  const p = localProducts.find(x => String(x.id) === String(id));
  if (!p) return;
  $('modalTitle').textContent = 'Edit product';
  $('editId').value      = p.id;
  $('fieldTitle').value  = p.title;
  $('fieldType').value   = p.product_type || '';
  $('fieldVendor').value = p.vendor || '';
  document.querySelector(`input[name="status"][value="${p.status}"]`).checked = true;
  $('fieldDescription').value = p.body_html ? p.body_html.replace(/<[^>]+>/g, '') : '';
  $('formError').textContent  = '';
  setSaving(false);
  openModal();
  const currentImg = (p.images && p.images.length > 0) ? p.images[0].src : '';
  loadImagePicker(currentImg);
}

// ── Save ──────────────────────────────────────────────────────
$('saveBtn').addEventListener('click', async () => {
  if (!validate() || isSaving) return;
  setSaving(true);

  const id = $('editId').value;
  const desc = $('fieldDescription').value.trim();
  const payload = {
    title:        $('fieldTitle').value.trim(),
    product_type: $('fieldType').value.trim(),
    vendor:       $('fieldVendor').value.trim(),
    status:       document.querySelector('input[name="status"]:checked').value,
    body_html:    desc ? `<p>${desc.replace(/\n/g, '<br>')}</p>` : '',
  };
  const imageSrc = $('fieldImageSrc').value;
  if (imageSrc) payload.images = [{ src: imageSrc }];

  try {
    if (id) {
      await updateProduct(id, payload);
      toast('Product updated in Shopify.', 'success');
    } else {
      await createProduct(payload);
      toast('Product created in Shopify.', 'success');
    }
    closeModal();
    render();
  } catch (err) {
    $('formError').textContent = err.message;
    setSaving(false);
  }
});

// ── Delete ────────────────────────────────────────────────────
function openDelete(id) {
  const p = localProducts.find(x => String(x.id) === String(id));
  if (!p) return;
  pendingDeleteId = id;
  $('deleteProductName').textContent = `"${p.title}"`;
  openDeleteModal();
}

$('deleteConfirmBtn').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const btn = $('deleteConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await deleteProduct(pendingDeleteId);
    pendingDeleteId = null;
    closeDeleteModal();
    render();
    toast('Product deleted from Shopify.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
});

// ── Modal close ───────────────────────────────────────────────
$('modalClose').addEventListener('click', closeModal);
$('cancelBtn').addEventListener('click', closeModal);
$('deleteCancelBtn').addEventListener('click', closeDeleteModal);
$('deleteCancelX').addEventListener('click', closeDeleteModal);
$('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });
$('deleteOverlay').addEventListener('click', e => { if (e.target === $('deleteOverlay')) closeDeleteModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeDeleteModal(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('searchInput').focus(); }
});

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Loading / Error ───────────────────────────────────────────
function showLoading(on) {
  $('skeletonGrid').style.display = on ? 'grid' : 'none';
  $('refreshBtn').classList.toggle('spinning', on);
}
function showError(msg) {
  $('apiErrorMsg').textContent = msg;
  $('apiError').style.display = 'flex';
}
function hideError() {
  $('apiError').style.display = 'none';
}

// ── View switching ────────────────────────────────────────────
let currentView = 'products';

function showView(view) {
  currentView = view;
  const isProducts    = view === 'products';
  const isCollections = view === 'collections';
  const isMeetings    = view === 'meetings';
  const isAnalytics   = view === 'analytics';
  const isSettings    = view === 'settings';

  // Hide all sections
  [$('skeletonGrid'), $('productsGrid'), $('paginationWrap'), $('emptyState'), $('apiError')].forEach(el => {
    if (el) el.style.display = 'none';
  });
  $('collectionsView').style.display = 'none';
  $('meetingsView').style.display    = 'none';
  $('analyticsView').style.display   = 'none';
  $('settingsView').style.display    = 'none';

  document.querySelector('.page-header').style.display = isProducts ? '' : 'none';
  document.querySelector('.stats-row').style.display   = isProducts ? '' : 'none';
  document.querySelector('.toolbar').style.display     = isProducts ? '' : 'none';

  if (isProducts) {
    if (localProducts.length > 0) {
      render();
    } else {
      fetchProducts();
    }
  }
  if (isCollections) { $('collectionsView').style.display = 'block'; fetchCollections(); }
  if (isMeetings)    $('meetingsView').style.display = 'block';
  if (isAnalytics)   $('analyticsView').style.display = 'block';
  if (isSettings)    $('settingsView').style.display = 'block';

  $('navProducts').classList.toggle('active',    isProducts);
  $('navCollections').classList.toggle('active', isCollections);
  $('navMeetings').classList.toggle('active',    isMeetings);
  $('navAnalytics').classList.toggle('active',   isAnalytics);
  $('navSettings').classList.toggle('active',    isSettings);

  const labels = { products: 'Products', collections: 'Collections', meetings: 'Meetings', analytics: 'Analytics', settings: 'Settings' };
  $('breadcrumbCurrent').textContent = labels[view] || view;
}

$('navProducts').addEventListener('click',    e => { e.preventDefault(); showView('products'); });
$('navCollections').addEventListener('click', e => { e.preventDefault(); showView('collections'); });
$('navMeetings').addEventListener('click',    e => { e.preventDefault(); showView('meetings'); });
$('navAnalytics').addEventListener('click',   e => { e.preventDefault(); showView('analytics'); });
$('navSettings').addEventListener('click',    e => { e.preventDefault(); showView('settings'); });

// ── Collections ───────────────────────────────────────────────
let collectionsCache = null;

async function fetchCollections() {
  $('collectionsGrid').innerHTML = '<div class="inv-loading">Loading collections…</div>';
  $('collError').style.display = 'none';
  try {
    const data = await apiFetch('/api/collections');
    collectionsCache = data.collections || [];
    $('sidebarCollCount').textContent = collectionsCache.length;
    renderCollections(collectionsCache);
  } catch (err) {
    $('collError').style.display = 'flex';
    $('collErrorMsg').textContent = err.message;
    $('collectionsGrid').innerHTML = '';
  }
}

function renderCollections(list) {
  if (!list.length) {
    $('collectionsGrid').innerHTML = '<div class="inv-loading">No collections yet. Create one!</div>';
    return;
  }
  $('collectionsGrid').innerHTML = list.map(c => {
    const count = c.products_count != null ? c.products_count : 0;
    const rules = c.rules ? c.rules.map(r => `${r.column} ${r.relation} "${r.condition}"`).join(', ') : 'Manual';
    return `
    <div class="coll-card">
      <div class="coll-card-header">
        <span class="coll-type-badge ${c.type}">${c.type === 'smart' ? 'Smart' : 'Custom'}</span>
        <button class="card-action-btn del" data-action="coll-delete" data-id="${c.id}" data-type="${c.type}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>
      <div class="coll-card-title">${esc(c.title)}</div>
      ${c.rules ? `<div class="coll-rules">${esc(rules)}</div>` : ''}
      <div class="coll-card-footer">
        <span class="coll-count">${count} products</span>
        <button class="btn-ghost coll-view-btn" data-action="coll-view" data-id="${c.id}" style="font-size:11px;padding:4px 10px">View products</button>
      </div>
    </div>`;
  }).join('');

  $('collectionsGrid').querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.action === 'coll-view')   openCollectionProducts(btn.dataset.id);
      if (btn.dataset.action === 'coll-delete') deleteCollection(btn.dataset.id, btn.dataset.type);
    });
  });
}

async function openCollectionProducts(id) {
  const c = collectionsCache?.find(x => String(x.id) === String(id));
  $('collProductsTitle').textContent = c ? `${c.title} — Products` : 'Collection products';
  $('collProductsBody').innerHTML = '<div class="inv-loading">Loading…</div>';
  $('collProductsOverlay').classList.add('open');
  try {
    const data = await apiFetch(`/api/collections/${id}/products`);
    const prods = data.products || [];
    if (!prods.length) {
      $('collProductsBody').innerHTML = '<div class="inv-loading">No products in this collection.</div>';
      return;
    }
    $('collProductsBody').innerHTML = prods.map(p => {
      const img = p.images?.[0]?.src;
      return `<div class="coll-prod-row">
        ${img ? `<img class="coll-prod-img" src="${esc(img)}" alt="${esc(p.title)}" loading="lazy">` : '<div class="coll-prod-img-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg></div>'}
        <div class="coll-prod-info">
          <span class="coll-prod-title">${esc(p.title)}</span>
          <span class="coll-prod-meta">${esc(p.vendor || '—')} · ${esc(p.product_type || 'uncategorized')}</span>
        </div>
        <span class="card-badge badge-${esc(p.status)}">${esc(p.status)}</span>
      </div>`;
    }).join('');
  } catch (err) {
    $('collProductsBody').innerHTML = `<div class="inv-loading">${err.message}</div>`;
  }
}

async function deleteCollection(id, type) {
  if (type !== 'smart') { toast('Only smart collections can be deleted here.', 'error'); return; }
  if (!confirm('Delete this collection?')) return;
  try {
    await apiFetch(`/api/collections/${id}`, { method: 'DELETE' });
    toast('Collection deleted.', 'success');
    collectionsCache = null;
    fetchCollections();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Collection modal
$('openAddCollection').addEventListener('click', () => {
  $('collTitle').value = '';
  $('collFormError').textContent = '';
  $('collRules').innerHTML = `<div class="coll-rule-row">
    <select class="select-input coll-rule-col"><option value="type">Product type</option><option value="vendor">Vendor</option><option value="title">Title</option><option value="tag">Tag</option><option value="variant_title">Variant title</option></select>
    <select class="select-input coll-rule-rel"><option value="equals">equals</option><option value="not_equals">not equals</option><option value="contains">contains</option><option value="starts_with">starts with</option></select>
    <input type="text" class="form-input coll-rule-val" placeholder="Value…" />
  </div>`;
  $('collModalOverlay').classList.add('open');
});

$('addRuleBtn').addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'coll-rule-row';
  row.innerHTML = `
    <select class="select-input coll-rule-col"><option value="type">Product type</option><option value="vendor">Vendor</option><option value="title">Title</option><option value="tag">Tag</option><option value="variant_title">Variant title</option></select>
    <select class="select-input coll-rule-rel"><option value="equals">equals</option><option value="not_equals">not equals</option><option value="contains">contains</option><option value="starts_with">starts with</option></select>
    <input type="text" class="form-input coll-rule-val" placeholder="Value…" />
    <button type="button" class="card-action-btn del remove-rule-btn"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  row.querySelector('.remove-rule-btn').addEventListener('click', () => row.remove());
  $('collRules').appendChild(row);
});

$('collSaveBtn').addEventListener('click', async () => {
  const title = $('collTitle').value.trim();
  if (!title) { $('collFormError').textContent = 'Collection name is required.'; return; }
  const rules = [...document.querySelectorAll('.coll-rule-row')].map(row => ({
    column:    row.querySelector('.coll-rule-col').value,
    relation:  row.querySelector('.coll-rule-rel').value,
    condition: row.querySelector('.coll-rule-val').value.trim(),
  })).filter(r => r.condition);
  if (!rules.length) { $('collFormError').textContent = 'Add at least one rule with a value.'; return; }
  const disjunctive = document.querySelector('input[name="disjunctive"]:checked').value === 'true';
  $('collSaveBtn').disabled = true;
  $('collSaveBtn').textContent = 'Creating…';
  try {
    await apiFetch('/api/collections', { method: 'POST', body: JSON.stringify({ title, rules, disjunctive }) });
    toast(`Collection "${title}" created.`, 'success');
    $('collModalOverlay').classList.remove('open');
    collectionsCache = null;
    fetchCollections();
  } catch (err) {
    $('collFormError').textContent = err.message;
  } finally {
    $('collSaveBtn').disabled = false;
    $('collSaveBtn').textContent = 'Create collection';
  }
});

[$('collModalClose'), $('collCancelBtn')].forEach(b => b.addEventListener('click', () => $('collModalOverlay').classList.remove('open')));
[$('collProductsClose'), $('collProductsCloseBtn')].forEach(b => b.addEventListener('click', () => $('collProductsOverlay').classList.remove('open')));
$('collModalOverlay').addEventListener('click',    e => { if (e.target === $('collModalOverlay'))    $('collModalOverlay').classList.remove('open'); });
$('collProductsOverlay').addEventListener('click', e => { if (e.target === $('collProductsOverlay')) $('collProductsOverlay').classList.remove('open'); });

// ── Inventory ─────────────────────────────────────────────────
function openInventory(productId) {
  const p = localProducts.find(x => String(x.id) === String(productId));
  if (!p) return;
  $('inventoryTitle').textContent = `Inventory · ${p.title}`;
  $('inventoryBody').innerHTML = '<div class="inv-loading">Loading inventory…</div>';
  $('inventoryOverlay').classList.add('open');

  apiFetch(`/api/inventory/${productId}`)
    .then(data => renderInventory(p, data))
    .catch(err => { $('inventoryBody').innerHTML = `<div class="inv-loading">${err.message}</div>`; });
}

function renderInventory(product, data) {
  if (!data.variants?.length) {
    $('inventoryBody').innerHTML = '<div class="inv-loading">No variants found.</div>';
    return;
  }
  $('inventoryBody').innerHTML = data.variants.map(v => {
    const low  = v.inventory_management === 'shopify' && v.available <= 5;
    const none = v.inventory_management !== 'shopify';
    return `
    <div class="inv-variant">
      <div class="inv-variant-info">
        <span class="inv-variant-title">${esc(v.title)}</span>
        ${v.sku ? `<span class="inv-sku">SKU: ${esc(v.sku)}</span>` : ''}
        <span class="inv-price">$${v.price}</span>
      </div>
      ${none
        ? `<div class="inv-untracked">Not tracked</div>`
        : `<div class="inv-qty-row">
            <div class="inv-qty-wrap ${low ? 'low' : ''}">
              <input class="inv-qty-input" type="number" min="0" value="${v.available}"
                data-variant-id="${v.id}"
                data-item-id="${v.inventory_item_id}"
                data-product="${esc(product.title)}"
                data-vtitle="${esc(v.title)}" />
              <span class="inv-unit">units</span>
            </div>
            ${low ? `<span class="inv-badge-low"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Low stock</span>` : ''}
            <button class="btn-inv-save" data-variant-id="${v.id}">Save</button>
          </div>`
      }
    </div>`;
  }).join('');

  $('inventoryBody').querySelectorAll('.btn-inv-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const variantId = btn.dataset.variantId;
      const input     = $('inventoryBody').querySelector(`input[data-variant-id="${variantId}"]`);
      btn.disabled    = true;
      btn.textContent = 'Saving…';
      try {
        await apiFetch(`/api/inventory/${variantId}`, {
          method: 'PUT',
          body: JSON.stringify({
            inventory_item_id: input.dataset.itemId,
            available:         input.value,
            product_title:     input.dataset.product,
            variant_title:     input.dataset.vtitle,
          }),
        });
        toast('Stock updated.', 'success');
        const qty = parseInt(input.value, 10);
        input.closest('.inv-qty-wrap').classList.toggle('low', qty <= 5);
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save'; }, 2000);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });
  });
}

$('inventoryClose').addEventListener('click',    () => $('inventoryOverlay').classList.remove('open'));
$('inventoryCloseBtn').addEventListener('click', () => $('inventoryOverlay').classList.remove('open'));
$('inventoryOverlay').addEventListener('click',  e => { if (e.target === $('inventoryOverlay')) $('inventoryOverlay').classList.remove('open'); });

// ── AI description ────────────────────────────────────────────
async function runAI(action) {
  const title = $('fieldTitle').value.trim();
  if (!title) { $('formError').textContent = 'Enter a product title first.'; return; }
  const btn = $(action === 'generate' ? 'aiGenerate' : 'aiImprove');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const data = await apiFetch('/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({
        action,
        title,
        product_type: $('fieldType').value.trim(),
        vendor:       $('fieldVendor').value.trim(),
        description:  $('fieldDescription').value.trim(),
      }),
    });
    $('fieldDescription').value = data.description;
    $('formError').textContent  = '';
  } catch (err) {
    $('formError').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

$('aiGenerate').addEventListener('click', () => runAI('generate'));
$('aiImprove').addEventListener('click',  () => runAI('improve'));

// ── Assistant chat ────────────────────────────────────────────
let chatHistory = [];
let chatInitialized = false;

const SUGGESTIONS = [
  '¿Qué productos tienen disponibles?',
  '¿Cuál es el más vendido?',
  '¿Tienen algo para principiantes?',
  '¿Qué recomiendan para regalo?',
];

function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;
  renderWelcome();
  apiFetch('/api/products')
    .then(data => {
      const count = (data.products || []).filter(p => p.status === 'active').length;
      $('chatSubtitle').innerHTML = `<span class="chat-dot-live"></span>${count} productos activos en catálogo`;
    })
    .catch(() => {
      $('chatSubtitle').textContent = 'Conectado';
    });
}

function renderWelcome() {
  $('chatMessages').innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
      </div>
      <h3>¡Hola! Soy tu asistente de compras</h3>
      <p>Puedo ayudarte a encontrar el producto perfecto,<br>comparar opciones y verificar disponibilidad en tiempo real.</p>
      <div class="chat-suggestions">
        ${SUGGESTIONS.map(s => `<button class="chat-suggestion" data-text="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
    </div>`;
  $('chatMessages').querySelectorAll('.chat-suggestion').forEach(btn => {
    btn.addEventListener('click', () => sendChat(btn.dataset.text));
  });
}

function appendMsg(role, text) {
  const welcome = $('chatMessages').querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  if (role === 'assistant') {
    avatar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.1L12 17.4l-6.2 3.6 2.4-7.1L2 9.4h7.6z"/></svg>`;
  } else {
    avatar.textContent = 'J';
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = text;

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  $('chatMessages').appendChild(wrap);
  $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
  return wrap;
}

function showTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg assistant chat-typing';
  wrap.id = 'chatTyping';
  wrap.innerHTML = `<div class="chat-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.1L12 17.4l-6.2 3.6 2.4-7.1L2 9.4h7.6z"/></svg></div><div class="chat-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
  $('chatMessages').appendChild(wrap);
  $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
}
function hideTyping() {
  const t = $('chatTyping');
  if (t) t.remove();
}

async function sendChat(text) {
  text = (text || $('chatInput').value).trim();
  if (!text) return;
  $('chatInput').value = '';
  $('chatSendBtn').disabled = true;

  appendMsg('user', text);
  chatHistory.push({ role: 'user', content: text });
  showTyping();

  try {
    const data = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: chatHistory }),
    });
    hideTyping();
    appendMsg('assistant', data.reply);
    chatHistory.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    hideTyping();
    appendMsg('assistant', 'Lo siento, hubo un error al procesar tu consulta. Intenta de nuevo.');
  } finally {
    $('chatSendBtn').disabled = false;
    $('chatInput').focus();
  }
}

$('chatSendBtn').addEventListener('click', () => sendChat());
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('chatClearBtn').addEventListener('click', () => {
  chatHistory = [];
  renderWelcome();
});

// ── Meeting summary ───────────────────────────────────────────
$('meetSummarizeBtn').addEventListener('click', async () => {
  const transcript = $('meetTranscript').value.trim();
  if (!transcript) { $('meetError').textContent = 'Please enter meeting notes or a transcript.'; return; }
  $('meetError').textContent = '';

  const btn = $('meetSummarizeBtn');
  btn.disabled = true;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .8s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Summarizing…`;

  try {
    const result = await apiFetch('/api/meetings/summarize', {
      method: 'POST',
      body: JSON.stringify({
        title:        $('meetTitle').value.trim(),
        date:         $('meetDate').value,
        participants: $('meetParticipants').value.trim(),
        transcript,
      }),
    });

    const titleText = $('meetTitle').value.trim() || 'Meeting Summary';
    const dateText  = $('meetDate').value ? ` · ${$('meetDate').value}` : '';
    $('meetResultTitle').textContent = titleText + dateText;
    $('meetSummaryText').textContent = result.summary || '—';

    const renderList = (elId, items) => {
      const ul = $(elId);
      if (!items || !items.length) {
        ul.innerHTML = '<li class="meeting-empty-list">None recorded</li>';
      } else {
        ul.innerHTML = items.map(i => `<li>${esc(i)}</li>`).join('');
      }
    };
    renderList('meetKeyPoints',  result.key_points);
    renderList('meetAgreements', result.agreements);
    renderList('meetActionItems', result.action_items);

    $('meetResult').style.display = 'block';
    $('meetResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Summary generated and sent to Telegram.', 'success');
  } catch (err) {
    $('meetError').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Generate Summary`;
  }
});

// ── Mobile sidebar ────────────────────────────────────────────
function closeMobileSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
}

$('hamburgerBtn').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
  $('sidebarOverlay').classList.toggle('open');
});

$('sidebarOverlay').addEventListener('click', closeMobileSidebar);

document.querySelector('.sidebar').addEventListener('click', e => {
  if (e.target.closest('.nav-item') && window.innerWidth <= 768) {
    setTimeout(closeMobileSidebar, 150);
  }
});

// ── Floating chat widget ──────────────────────────────────────
let chatWidgetOpen = false;

function openChatWidget() {
  chatWidgetOpen = true;
  const panel = $('chatWidgetPanel');
  const fab   = $('chatWidgetBtn');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  fab.classList.add('open');
  fab.querySelector('.cw-fab-open').style.display  = 'none';
  fab.querySelector('.cw-fab-close').style.display = '';
  if (!chatInitialized) initChat();
  setTimeout(() => $('chatInput').focus(), 250);
}

function closeChatWidget() {
  chatWidgetOpen = false;
  const panel = $('chatWidgetPanel');
  const fab   = $('chatWidgetBtn');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  fab.classList.remove('open');
  fab.querySelector('.cw-fab-open').style.display  = '';
  fab.querySelector('.cw-fab-close').style.display = 'none';
}

$('chatWidgetBtn').addEventListener('click', () => {
  chatWidgetOpen ? closeChatWidget() : openChatWidget();
});

$('chatWidgetClose').addEventListener('click', closeChatWidget);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && chatWidgetOpen) closeChatWidget();
});

// ── Prefetch collections count for sidebar badge ──────────────
async function prefetchCollectionsCount() {
  try {
    const data = await apiFetch('/api/collections');
    collectionsCache = data.collections || [];
    $('sidebarCollCount').textContent = collectionsCache.length;
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────
fetchProducts().then(() => prefetchCollectionsCount());
