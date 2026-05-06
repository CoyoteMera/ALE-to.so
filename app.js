// ============================================================
// ALEtoso — ALE Editor
// ============================================================

// === STATE ===
const state = {
  heading:       [],        // [{key, value}]
  columns:       [],        // [string]
  rows:          [],        // [[string, ...]]
  modifiedCells: new Set(), // "r,c"
  warningCells:  new Set(), // "r,c"
  renamedCols:   new Set(), // column indices (number)
  fileName:      '',
  dirty:         false,
  activeCell:    null,      // {r, c}
  editMode:      null,      // {r, c}
  selectedRows:  new Set(),
  lastSelectedRow: undefined,
  filterQuery:   '',
};

// === DOM HELPERS ===
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class')   node.className = v;
    else if (k === 'id') node.id = v;
    else if (k.startsWith('data-')) node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    else if (k === 'title') node.title = v;
    else if (k === 'type')  node.type  = v;
    else if (k === 'tabindex') node.tabIndex = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clearEl(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// === PARSER ===
function parseALE(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let section = null;
  const heading = [];
  let columns = [];
  const rows = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'Heading') { section = 'heading'; continue; }
    if (trimmed === 'Column')  { section = 'column';  continue; }
    if (trimmed === 'Data')    { section = 'data';    continue; }

    if (section === 'heading' && trimmed) {
      const tabIdx = line.indexOf('\t');
      if (tabIdx >= 0) heading.push({ key: line.slice(0, tabIdx), value: line.slice(tabIdx + 1) });
      else             heading.push({ key: line, value: '' });
    } else if (section === 'column' && trimmed) {
      columns = line.split('\t');
    } else if (section === 'data' && trimmed) {
      const cells = line.split('\t');
      while (cells.length < columns.length) cells.push('');
      rows.push(cells.slice(0, columns.length));
    }
  }

  return { heading, columns, rows };
}

// === SERIALIZER ===
function serializeALE() {
  const CRLF = '\r\n';
  const parts = ['Heading' + CRLF];
  for (const { key, value } of state.heading) parts.push(key + '\t' + value + CRLF);
  parts.push(CRLF);
  parts.push('Column' + CRLF);
  parts.push(state.columns.join('\t') + CRLF);
  parts.push(CRLF);
  parts.push('Data' + CRLF);
  for (const row of state.rows) parts.push(row.join('\t') + CRLF);
  return parts.join('');
}

// === FILE I/O ===
function openFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = parseALE(e.target.result);
      state.heading       = parsed.heading;
      state.columns       = parsed.columns;
      state.rows          = parsed.rows;
      state.modifiedCells.clear();
      state.warningCells.clear();
      state.renamedCols.clear();
      state.fileName      = file.name;
      state.dirty         = false;
      state.activeCell    = null;
      state.editMode      = null;
      state.selectedRows.clear();
      state.lastSelectedRow = undefined;
      state.filterQuery   = '';

      document.getElementById('search-input').value    = '';
      document.getElementById('btn-save').disabled     = false;
      document.getElementById('file-info').textContent = file.name;

      renderHeading();
      renderTable();
      updateStatusBar();
      showToast(file.name + ' — ' + parsed.rows.length + ' filas, ' + parsed.columns.length + ' columnas');
    } catch (err) {
      showToast('Error al leer el archivo: ' + err.message, 'error');
    }
  };
  reader.onerror = () => showToast('Error al leer el archivo', 'error');
  reader.readAsText(file, 'UTF-8');
}

function downloadFile() {
  if (!state.fileName) { showToast('No hay archivo abierto', 'warn'); return; }
  commitEdit();
  const text  = serializeALE();
  const blob  = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url   = URL.createObjectURL(blob);
  const base  = state.fileName.replace(/\.ale$/i, '').replace(/_edited$/, '');
  const fname = state.dirty ? base + '_edited.ale' : state.fileName;
  const a     = el('a');
  a.href      = url;
  a.download  = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Descargado: ' + fname);
}

function setupDragDrop() {
  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; overlay.classList.add('active'); });
  window.addEventListener('dragleave', () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('active'); } });
  window.addEventListener('dragover',  (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file) openFile(file);
  });
}

// === HEADING ===
function renderHeading() {
  const content = document.getElementById('heading-content');
  clearEl(content);

  state.heading.forEach((pair, i) => {
    const keyInput = el('input', { class: 'heading-key', placeholder: 'Clave' });
    keyInput.value = pair.key;

    const valInput = el('input', { class: 'heading-value', placeholder: 'Valor' });
    valInput.value = pair.value;

    const delBtn = el('button', { class: 'btn-delete-heading-row', title: 'Eliminar par' }, '×');

    keyInput.addEventListener('change', () => { state.heading[i].key = keyInput.value; state.dirty = true; updateStatusBar(); updateHeadingPreview(); });
    valInput.addEventListener('change', () => { state.heading[i].value = valInput.value; state.dirty = true; updateStatusBar(); updateHeadingPreview(); });
    delBtn.addEventListener('click', () => { state.heading.splice(i, 1); state.dirty = true; renderHeading(); updateStatusBar(); });

    content.appendChild(el('div', { class: 'heading-row' }, keyInput, el('span', { class: 'heading-sep' }, '→'), valInput, delBtn));
  });

  const addBtn = el('button', { class: 'btn-add-heading-row' }, '+ Añadir par');
  addBtn.addEventListener('click', () => {
    state.heading.push({ key: '', value: '' });
    state.dirty = true;
    renderHeading();
    updateStatusBar();
    const keys = content.querySelectorAll('.heading-key');
    if (keys.length) keys[keys.length - 1].focus();
  });
  content.appendChild(addBtn);
  updateHeadingPreview();
}

function updateHeadingPreview() {
  const preview = document.getElementById('heading-preview');
  preview.textContent = state.heading
    .filter(p => p.key)
    .slice(0, 5)
    .map(p => p.key + ': ' + p.value)
    .join('  ·  ');
}

// === TABLE RENDER ===
function buildEmptyState() {
  const p1   = el('p');
  const code = el('code');
  code.textContent = '.ale';
  p1.append('Abre un archivo ', code, ' para comenzar');
  const p2 = el('p', { class: 'empty-hint' }, 'Arrastra el archivo aquí o usa el botón Abrir');
  return el('div', { class: 'empty-state' }, el('div', { class: 'empty-icon' }, '◈'), p1, p2);
}

function buildHeaderRow() {
  const tr = el('tr');
  tr.appendChild(el('th', { class: 'row-num-header' }, '#'));
  for (let c = 0; c < state.columns.length; c++) {
    const th = el('th', { 'data-col-idx': c, title: 'Click derecho para opciones' });
    th.textContent = state.columns[c];
    if (state.renamedCols.has(c)) {
      th.classList.add('col-renamed');
      const dot = el('span', { class: 'renamed-dot', title: 'Renombrada' }, '●');
      th.appendChild(dot);
    }
    tr.appendChild(th);
  }
  return tr;
}

function buildDataRow(r) {
  const row = state.rows[r];
  const tr  = el('tr', { 'data-row-idx': r });
  if (state.selectedRows.has(r)) tr.classList.add('row-selected');

  const rowNum = el('td', { class: 'row-num', 'data-row-idx': r }, String(r + 1));
  tr.appendChild(rowNum);

  for (let c = 0; c < state.columns.length; c++) {
    const key = r + ',' + c;
    const td  = el('td', { class: 'data-cell', 'data-row': r, 'data-col': c });
    if (state.modifiedCells.has(key)) td.classList.add('cell-modified');
    if (state.warningCells.has(key))  td.classList.add('cell-warning');
    if (state.activeCell && state.activeCell.r === r && state.activeCell.c === c) td.classList.add('cell-active');
    td.textContent = row[c];
    tr.appendChild(td);
  }
  return tr;
}

function renderTable() {
  if (state.editMode) {
    const { r, c } = state.editMode;
    const td = getCell(r, c);
    if (td) {
      const input = td.querySelector('.cell-input');
      if (input) { state.rows[r][c] = input.value.replace(/\t/g, ' '); state.modifiedCells.add(r + ',' + c); state.dirty = true; }
    }
    state.editMode = null;
  }

  const container = document.getElementById('table-container');
  clearEl(container);

  if (!state.columns.length) {
    container.appendChild(buildEmptyState());
    return;
  }

  const table  = el('table', { id: 'ale-table' });
  const thead  = el('thead');
  const tbody  = document.createElement('tbody');
  const frag   = document.createDocumentFragment();

  thead.appendChild(buildHeaderRow());
  table.appendChild(thead);

  for (let r = 0; r < state.rows.length; r++) {
    frag.appendChild(buildDataRow(r));
  }
  tbody.appendChild(frag);
  table.appendChild(tbody);
  container.appendChild(table);

  setupTableEvents();
  applyFilter(state.filterQuery);

  // Re-apply find & replace highlights after re-render
  if (fnr.matches.length) {
    fnr.matches.forEach(({ r, c }, i) => {
      const td = getCell(r, c);
      if (!td) return;
      td.classList.add('cell-match');
      if (i === fnr.activeIdx) td.classList.add('cell-match-active');
    });
  }
}

function setupTableEvents() {
  const table = document.getElementById('ale-table');
  if (!table) return;

  table.addEventListener('click', (e) => {
    if (e.target.classList.contains('cell-input')) return;

    const td = e.target.closest('td.data-cell');
    if (td) {
      const r = parseInt(td.dataset.row), c = parseInt(td.dataset.col);
      if (state.editMode && (state.editMode.r !== r || state.editMode.c !== c)) commitEdit();
      selectCell(r, c);
      return;
    }

    const rowNum = e.target.closest('td.row-num');
    if (rowNum) {
      const r = parseInt(rowNum.dataset.rowIdx);
      if (e.shiftKey && state.lastSelectedRow !== undefined) {
        const lo = Math.min(r, state.lastSelectedRow), hi = Math.max(r, state.lastSelectedRow);
        for (let i = lo; i <= hi; i++) state.selectedRows.add(i);
      } else if (e.ctrlKey || e.metaKey) {
        if (state.selectedRows.has(r)) state.selectedRows.delete(r); else state.selectedRows.add(r);
      } else {
        state.selectedRows.clear();
        state.selectedRows.add(r);
      }
      state.lastSelectedRow = r;
      table.querySelectorAll('tbody tr').forEach(tr => {
        tr.classList.toggle('row-selected', state.selectedRows.has(parseInt(tr.dataset.rowIdx)));
      });
    }
  });

  table.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td.data-cell');
    if (td) startEdit(parseInt(td.dataset.row), parseInt(td.dataset.col));
  });

  table.addEventListener('contextmenu', (e) => {
    const th = e.target.closest('th[data-col-idx]');
    if (th) { e.preventDefault(); showColumnContextMenu(e.clientX, e.clientY, parseInt(th.dataset.colIdx)); }
  });
}

// === CELL NAVIGATION & EDITING ===
function getCell(r, c) {
  return document.querySelector('#ale-table td[data-row="' + r + '"][data-col="' + c + '"]');
}

function selectCell(r, c) {
  if (r < 0 || r >= state.rows.length || c < 0 || c >= state.columns.length) return;

  if (state.activeCell) {
    const old = getCell(state.activeCell.r, state.activeCell.c);
    if (old) old.classList.remove('cell-active');
  }
  state.activeCell = { r, c };
  const td = getCell(r, c);
  if (td) { td.classList.add('cell-active'); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  document.getElementById('table-container').focus({ preventScroll: true });
}

function startEdit(r, c) {
  if (r < 0 || r >= state.rows.length || c < 0 || c >= state.columns.length) return;
  commitEdit();
  selectCell(r, c);
  state.editMode = { r, c };

  const td = getCell(r, c);
  if (!td) { state.editMode = null; return; }

  const input    = el('input', { class: 'cell-input' });
  input.value    = state.rows[r][c];
  td.textContent = '';
  td.appendChild(input);
  td.classList.add('cell-editing');
  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); commitEdit(); selectCell(Math.min(state.rows.length - 1, r + 1), c);
    } else if (e.key === 'Tab') {
      e.preventDefault(); commitEdit();
      if (e.shiftKey) { if (c > 0) startEdit(r, c - 1); else if (r > 0) startEdit(r - 1, state.columns.length - 1); else selectCell(r, c); }
      else            { if (c < state.columns.length - 1) startEdit(r, c + 1); else if (r < state.rows.length - 1) startEdit(r + 1, 0); else selectCell(r, c); }
    } else if (e.key === 'Escape') {
      e.preventDefault(); cancelEdit();
    }
  });

  input.addEventListener('blur', () => {
    if (state.editMode && state.editMode.r === r && state.editMode.c === c) commitEdit();
  });
}

function commitEdit() {
  if (!state.editMode) return;
  const { r, c } = state.editMode;
  state.editMode = null;

  const td    = getCell(r, c);
  if (!td) return;
  const input = td.querySelector('.cell-input');
  if (!input) return;

  const newValue = input.value.replace(/\t/g, ' ');
  const oldValue = state.rows[r][c];
  state.rows[r][c] = newValue;
  td.textContent = newValue;
  td.classList.remove('cell-editing');

  if (newValue !== oldValue) {
    const key = r + ',' + c;
    state.modifiedCells.add(key);
    state.dirty = true;
    td.classList.add('cell-modified');
    if (newValue.trim()) { state.warningCells.delete(key); td.classList.remove('cell-warning'); }
    updateStatusBar();
  }
  if (state.activeCell && state.activeCell.r === r && state.activeCell.c === c) td.classList.add('cell-active');
}

function cancelEdit() {
  if (!state.editMode) return;
  const { r, c } = state.editMode;
  state.editMode = null;
  const td = getCell(r, c);
  if (!td) return;
  td.textContent = state.rows[r][c];
  td.classList.remove('cell-editing');
  const key = r + ',' + c;
  if (state.modifiedCells.has(key)) td.classList.add('cell-modified');
  if (state.warningCells.has(key))  td.classList.add('cell-warning');
  if (state.activeCell && state.activeCell.r === r && state.activeCell.c === c) td.classList.add('cell-active');
}

function updateCell(r, c, value) {
  const td = getCell(r, c);
  if (!td) return;
  td.textContent = value;
  const key = r + ',' + c;
  td.className  = 'data-cell';
  if (state.modifiedCells.has(key)) td.classList.add('cell-modified');
  if (state.warningCells.has(key))  td.classList.add('cell-warning');
  if (state.activeCell && state.activeCell.r === r && state.activeCell.c === c) td.classList.add('cell-active');
}

function handleKeyDown(e) {
  if (e.target.tagName === 'INPUT') return;
  if (!state.activeCell) return;

  const { r, c } = state.activeCell;
  const maxR = state.rows.length - 1;
  const maxC = state.columns.length - 1;

  switch (e.key) {
    case 'ArrowUp':    e.preventDefault(); selectCell(Math.max(0, r - 1), c); break;
    case 'ArrowDown':  e.preventDefault(); selectCell(Math.min(maxR, r + 1), c); break;
    case 'ArrowLeft':  e.preventDefault(); selectCell(r, Math.max(0, c - 1)); break;
    case 'ArrowRight': e.preventDefault(); selectCell(r, Math.min(maxC, c + 1)); break;

    case 'Enter': case 'F2':
      e.preventDefault(); startEdit(r, c); break;

    case 'Tab':
      e.preventDefault();
      if (e.shiftKey) { if (c > 0) selectCell(r, c - 1); else if (r > 0) selectCell(r - 1, maxC); }
      else            { if (c < maxC) selectCell(r, c + 1); else if (r < maxR) selectCell(r + 1, 0); }
      break;

    case 'Delete':
      e.preventDefault();
      state.rows[r][c] = '';
      state.modifiedCells.add(r + ',' + c);
      state.dirty = true;
      updateCell(r, c, '');
      updateStatusBar();
      break;

    case 'Backspace':
      startEdit(r, c);
      { const inp = getCell(r, c)?.querySelector('.cell-input'); if (inp) inp.value = ''; }
      break;

    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        startEdit(r, c);
        const inp = getCell(r, c)?.querySelector('.cell-input');
        if (inp) { inp.value = e.key; inp.setSelectionRange(1, 1); }
      }
  }
}

// === ROW / COLUMN OPERATIONS ===
function addRow() {
  commitEdit();
  state.rows.push(state.columns.map(() => ''));
  state.dirty = true;
  renderTable();
  selectCell(state.rows.length - 1, 0);
  updateStatusBar();
}

function deleteSelectedRows() {
  if (state.selectedRows.size === 0) { showToast('Selecciona al menos una fila (click en el número de fila)', 'warn'); return; }
  if (state.selectedRows.size >= 3 && !confirm('¿Eliminar ' + state.selectedRows.size + ' filas?')) return;

  commitEdit();
  const toDelete = new Set(state.selectedRows);

  const rebuildByRow = (set) => {
    const next = new Set();
    let offset = 0;
    for (let row = 0; row < state.rows.length; row++) {
      if (toDelete.has(row)) { offset++; continue; }
      set.forEach(key => {
        const sep = key.indexOf(',');
        if (parseInt(key.slice(0, sep)) === row) next.add((row - offset) + key.slice(sep));
      });
    }
    return next;
  };

  state.modifiedCells = rebuildByRow(state.modifiedCells);
  state.warningCells  = rebuildByRow(state.warningCells);
  state.rows          = state.rows.filter((_, r) => !toDelete.has(r));
  state.selectedRows.clear();
  state.activeCell = null;
  state.dirty = true;
  renderTable();
  updateStatusBar();
  const n = toDelete.size;
  showToast(n + ' fila' + (n !== 1 ? 's' : '') + ' eliminada' + (n !== 1 ? 's' : ''));
}

function addColumn() {
  const name = prompt('Nombre de la nueva columna:');
  if (name === null || name.trim() === '') return;
  const colName = name.trim();
  state.columns.push(colName);
  state.rows.forEach(row => row.push(''));
  state.dirty = true;
  renderTable();
  updateStatusBar();
  showToast('Columna "' + colName + '" añadida');
}

function deleteColumn(colIdx) {
  const colName = state.columns[colIdx];
  if (!confirm('¿Eliminar la columna "' + colName + '"?')) return;

  state.columns.splice(colIdx, 1);
  state.rows.forEach(row => row.splice(colIdx, 1));

  const adjustSet = (set) => {
    const next = new Set();
    set.forEach(key => {
      const sep = key.indexOf(',');
      const r = parseInt(key.slice(0, sep)), c = parseInt(key.slice(sep + 1));
      if (c !== colIdx) next.add(r + ',' + (c < colIdx ? c : c - 1));
    });
    return next;
  };
  state.modifiedCells = adjustSet(state.modifiedCells);
  state.warningCells  = adjustSet(state.warningCells);

  const nextRenamed = new Set();
  state.renamedCols.forEach(c => { if (c !== colIdx) nextRenamed.add(c < colIdx ? c : c - 1); });
  state.renamedCols = nextRenamed;

  if (state.activeCell) {
    if (state.activeCell.c === colIdx) state.activeCell = null;
    else if (state.activeCell.c > colIdx) state.activeCell.c--;
  }

  state.dirty = true;
  renderTable();
  updateStatusBar();
  showToast('Columna "' + colName + '" eliminada');
}

function showColumnContextMenu(x, y, colIdx) {
  document.getElementById('col-context-menu')?.remove();

  const item = el('div', { class: 'context-menu-item' }, 'Eliminar columna "' + state.columns[colIdx] + '"');
  item.addEventListener('click', () => { menu.remove(); deleteColumn(colIdx); });

  const menu = el('div', { id: 'col-context-menu', class: 'context-menu' }, item);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right  > window.innerWidth)  menu.style.left = (x - rect.width)  + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + 'px';

  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

// === UTILITIES ===
function util_normalizeTracksToV() {
  if (!state.columns.length) { showToast('No hay archivo cargado', 'warn'); return; }
  const colIdx = state.columns.indexOf('Tracks');
  if (colIdx === -1) { showToast('No hay columna "Tracks"', 'error'); return; }

  commitEdit();
  let count = 0;
  state.rows.forEach((row, r) => {
    if (row[colIdx] !== 'V') {
      row[colIdx] = 'V';
      state.modifiedCells.add(r + ',' + colIdx);
      count++;
    }
  });

  if (count === 0) { showToast('Todas las filas ya tienen Tracks = V'); return; }
  state.dirty = true;
  renderTable();
  updateStatusBar();
  showToast('Tracks → V en ' + count + ' fila' + (count !== 1 ? 's' : ''));
}

function util_renameAuxTC1ToSoundTC() {
  if (!state.columns.length) { showToast('No hay archivo cargado', 'warn'); return; }
  const auxIdx   = state.columns.indexOf('Auxiliary TC1');
  const soundIdx = state.columns.indexOf('Sound TC');
  if (auxIdx === -1)   { showToast('No hay columna "Auxiliary TC1"', 'warn'); return; }
  if (soundIdx !== -1) { showToast('Ya existe "Sound TC" — no se renombra', 'warn'); return; }

  commitEdit();
  state.columns[auxIdx] = 'Sound TC';
  state.renamedCols.add(auxIdx);
  state.dirty = true;
  renderTable();
  updateStatusBar();
  showToast('Columna Auxiliary TC1 → Sound TC');
}

function util_highlightEmptyCritical() {
  if (!state.columns.length) { showToast('No hay archivo cargado', 'warn'); return; }

  commitEdit();
  state.warningCells.clear();

  ['Tape', 'Start', 'End', 'Sound TC'].forEach(colName => {
    const colIdx = state.columns.indexOf(colName);
    if (colIdx === -1) return;
    state.rows.forEach((row, r) => {
      if (!row[colIdx].trim()) state.warningCells.add(r + ',' + colIdx);
    });
  });

  renderTable();
  const n = state.warningCells.size;
  showToast(n === 0
    ? 'No hay celdas críticas vacías'
    : n + ' celda' + (n !== 1 ? 's' : '') + ' crítica' + (n !== 1 ? 's' : '') + ' vacía' + (n !== 1 ? 's' : '') + ' detectada' + (n !== 1 ? 's' : ''));
}

// === SEARCH ===
let filterTimer = null;

function applyFilter(query) {
  state.filterQuery = (query || '').toLowerCase().trim();
  const tbody = document.querySelector('#ale-table tbody');
  if (!tbody) return;

  Array.from(tbody.rows).forEach(tr => {
    if (!state.filterQuery) { tr.style.display = ''; return; }
    const rowIdx = parseInt(tr.dataset.rowIdx);
    if (isNaN(rowIdx)) { tr.style.display = ''; return; }
    const matches = state.rows[rowIdx].some(cell => cell.toLowerCase().includes(state.filterQuery));
    tr.style.display = matches ? '' : 'none';
  });
}

// === FIND & REPLACE ===
const fnr = {
  matches:     [],   // [{r, c}]
  activeIdx:   -1,   // índice actual en matches
};

function fnrOpen() {
  const panel = document.getElementById('fnr-panel');
  panel.hidden = false;
  document.getElementById('fnr-find').focus();
  document.getElementById('fnr-find').select();
}

function fnrClose() {
  document.getElementById('fnr-panel').hidden = true;
  fnrClearHighlights();
  fnr.matches   = [];
  fnr.activeIdx = -1;
  document.getElementById('fnr-count').textContent = '';
  document.getElementById('fnr-count').classList.remove('no-match');
}

function fnrClearHighlights() {
  document.querySelectorAll('td.cell-match, td.cell-match-active').forEach(td => {
    td.classList.remove('cell-match', 'cell-match-active');
  });
}

function fnrSearch() {
  const query = document.getElementById('fnr-find').value;
  fnrClearHighlights();
  fnr.matches   = [];
  fnr.activeIdx = -1;

  if (!query || !state.columns.length) {
    fnrUpdateCount();
    return;
  }

  const lower = query.toLowerCase();
  state.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.toLowerCase().includes(lower)) {
        fnr.matches.push({ r, c });
        const td = getCell(r, c);
        if (td) td.classList.add('cell-match');
      }
    });
  });

  if (fnr.matches.length > 0) { fnr.activeIdx = 0; fnrActivate(0); }
  fnrUpdateCount();
}

function fnrActivate(idx) {
  // Remove previous active highlight
  document.querySelectorAll('td.cell-match-active').forEach(td => td.classList.remove('cell-match-active'));

  if (idx < 0 || idx >= fnr.matches.length) return;
  fnr.activeIdx = idx;
  const { r, c } = fnr.matches[idx];
  const td = getCell(r, c);
  if (td) {
    td.classList.add('cell-match-active');
    td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  fnrUpdateCount();
}

function fnrNext() {
  if (!fnr.matches.length) { fnrSearch(); return; }
  fnrActivate((fnr.activeIdx + 1) % fnr.matches.length);
}

function fnrPrev() {
  if (!fnr.matches.length) { fnrSearch(); return; }
  fnrActivate((fnr.activeIdx - 1 + fnr.matches.length) % fnr.matches.length);
}

function fnrReplaceOne() {
  if (fnr.activeIdx < 0 || !fnr.matches.length) { fnrSearch(); return; }
  const find    = document.getElementById('fnr-find').value;
  const replace = document.getElementById('fnr-replace').value;
  if (!find) return;

  const { r, c } = fnr.matches[fnr.activeIdx];
  state.rows[r][c] = state.rows[r][c].replace(new RegExp(escapeRegex(find), 'gi'), replace);
  state.modifiedCells.add(r + ',' + c);
  state.dirty = true;

  const prevIdx = fnr.activeIdx;
  fnrSearch(); // re-scan
  // Try to stay at same position
  fnrActivate(Math.min(prevIdx, fnr.matches.length - 1));
  updateStatusBar();
  updateCell(r, c, state.rows[r][c]);
}

function fnrReplaceAll() {
  const find    = document.getElementById('fnr-find').value;
  const replace = document.getElementById('fnr-replace').value;
  if (!find || !state.columns.length) return;

  commitEdit();
  const re = new RegExp(escapeRegex(find), 'gi');
  let count = 0;
  state.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.toLowerCase().includes(find.toLowerCase())) {
        state.rows[r][c] = cell.replace(re, replace);
        state.modifiedCells.add(r + ',' + c);
        count++;
      }
    });
  });

  if (count > 0) { state.dirty = true; renderTable(); updateStatusBar(); }
  fnrSearch(); // re-scan after replace
  showToast(count + ' reemplazo' + (count !== 1 ? 's' : '') + ' realizad' + (count !== 1 ? 'os' : 'o'));
}

function fnrUpdateCount() {
  const countEl = document.getElementById('fnr-count');
  const n = fnr.matches.length;
  if (!document.getElementById('fnr-find').value) {
    countEl.textContent = '';
    countEl.classList.remove('no-match');
    return;
  }
  if (n === 0) {
    countEl.textContent = 'sin resultados';
    countEl.classList.add('no-match');
  } else {
    countEl.textContent = (fnr.activeIdx + 1) + ' / ' + n;
    countEl.classList.remove('no-match');
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// === TOAST ===
function showToast(msg, type) {
  type = type || 'info';
  const container = document.getElementById('toast-container');
  const toast = el('div', { class: 'toast toast-' + type });
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 3500);
}

// === STATUS BAR ===
function updateStatusBar() {
  let text = state.fileName
    ? state.rows.length + ' filas · ' + state.columns.length + ' columnas'
    : 'Sin archivo';

  if (state.filterQuery) {
    const visible = Array.from(document.querySelectorAll('#ale-table tbody tr'))
      .filter(tr => tr.style.display !== 'none').length;
    text += ' · Filtradas: ' + visible;
  }
  if (state.dirty) text += ' · Sin guardar ●';
  document.getElementById('status-text').textContent = text;
}

// === BOOT ===
function init() {
  setupDragDrop();

  document.getElementById('btn-open').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
  document.getElementById('btn-save').addEventListener('click', downloadFile);

  document.getElementById('heading-toggle').addEventListener('click', () => {
    const content  = document.getElementById('heading-content');
    const arrow    = document.getElementById('heading-arrow');
    const preview  = document.getElementById('heading-preview');
    content.hidden    = !content.hidden;
    arrow.textContent = content.hidden ? '▶' : '▼';
    preview.style.display = content.hidden ? '' : 'none';
  });

  document.getElementById('btn-add-col').addEventListener('click', addColumn);
  document.getElementById('btn-add-row').addEventListener('click', addRow);
  document.getElementById('btn-delete-rows').addEventListener('click', deleteSelectedRows);
  document.getElementById('btn-util-tracks').addEventListener('click', util_normalizeTracksToV);
  document.getElementById('btn-util-rename-tc').addEventListener('click', util_renameAuxTC1ToSoundTC);
  document.getElementById('btn-util-highlight').addEventListener('click', util_highlightEmptyCritical);

  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { applyFilter(e.target.value); updateStatusBar(); }, 150);
  });

  document.getElementById('table-container').addEventListener('keydown', handleKeyDown);

  // Find & Replace
  document.getElementById('btn-fnr-open').addEventListener('click', () => {
    const panel = document.getElementById('fnr-panel');
    if (panel.hidden) fnrOpen(); else fnrClose();
  });
  document.getElementById('fnr-close').addEventListener('click', fnrClose);
  document.getElementById('fnr-next').addEventListener('click', fnrNext);
  document.getElementById('fnr-prev').addEventListener('click', fnrPrev);
  document.getElementById('fnr-replace-one').addEventListener('click', fnrReplaceOne);
  document.getElementById('fnr-replace-all').addEventListener('click', fnrReplaceAll);

  document.getElementById('fnr-find').addEventListener('input', fnrSearch);
  document.getElementById('fnr-find').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); e.shiftKey ? fnrPrev() : fnrNext(); }
    if (e.key === 'Escape') { e.preventDefault(); fnrClose(); }
  });
  document.getElementById('fnr-replace').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); fnrReplaceOne(); }
    if (e.key === 'Escape') { e.preventDefault(); fnrClose(); }
  });

  // Global shortcut: Ctrl+H / Cmd+H
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      const panel = document.getElementById('fnr-panel');
      if (panel.hidden) fnrOpen(); else fnrClose();
    }
  });

  renderHeading();
  renderTable();
  updateStatusBar();
}

document.addEventListener('DOMContentLoaded', init);
