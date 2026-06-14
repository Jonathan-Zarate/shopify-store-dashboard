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

const TYPE_EMOJI = { snowboard: '🏂', accessories: '⚙️', giftcard: '🎁', '': '📦' };

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
  const list  = filtered();
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  const slice = list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const grid = $('productsGrid');
  $('emptyState').style.display = (total === 0 && localProducts.length > 0) ? 'flex' : 'none';

  grid.innerHTML = slice.map(p => {
    const type  = (p.product_type || '').toLowerCase();
    const emoji = TYPE_EMOJI[type] || '📦';
    const img   = productImage(p);
    return `
    <div class="product-card" data-id="${p.id}">
      <div class="card-img-wrap">
        <img class="card-img" src="${esc(img)}" alt="${esc(p.title)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="card-img-placeholder" style="display:none">${emoji}</div>
        <span class="card-badge badge-${esc(p.status)}">${esc(p.status)}</span>
        <div class="card-actions">
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
        <div class="card-date">${fmtDate(p.created_at)}</div>
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
  if (btn.dataset.action === 'edit')   openEdit(btn.dataset.id);
  if (btn.dataset.action === 'delete') openDelete(btn.dataset.id);
});

// ── Modal helpers ─────────────────────────────────────────────
const openModal       = () => $('modalOverlay').classList.add('open');
const closeModal      = () => { $('modalOverlay').classList.remove('open'); clearForm(); };
const openDeleteModal  = () => $('deleteOverlay').classList.add('open');
const closeDeleteModal = () => $('deleteOverlay').classList.remove('open');

function clearForm() {
  $('editId').value        = '';
  $('fieldTitle').value    = '';
  $('fieldType').value     = '';
  $('fieldVendor').value   = '';
  $('fieldImageSrc').value = '';
  document.querySelector('input[name="status"][value="active"]').checked = true;
  $('formError').textContent = '';
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
  $('formError').textContent = '';
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
  const payload = {
    title:        $('fieldTitle').value.trim(),
    product_type: $('fieldType').value.trim(),
    vendor:       $('fieldVendor').value.trim(),
    status:       document.querySelector('input[name="status"]:checked').value,
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

// ── Init ──────────────────────────────────────────────────────
fetchProducts();
