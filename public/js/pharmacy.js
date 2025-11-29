const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
const socket = io();
const hospitalId = sessionStorage.getItem('hospitalId');
const role = sessionStorage.getItem('role') || 'pharmacy';
socket.emit('join', { role, hospitalId });

// DOM Elements
const tableBody = document.getElementById('pharmacy-table-body');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search');

// Stats Elements
const statPending = document.getElementById('stat-pending');
const statPrepared = document.getElementById('stat-prepared');
const statDelivered = document.getElementById('stat-delivered');

let prescriptionsList = [];

// --- Initialization ---
function init() {
  loadPrescriptions();
  setupEventListeners();
}

function setupEventListeners() {
  searchInput.addEventListener('input', () => renderTable());

  // Table Actions (Delegation)
  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'prepare') {
      socket.emit('move-patient', { id, pharmacyState: 'prepared' });
      // Update local state immediately for better UX
      const idx = prescriptionsList.findIndex(x => x.id === parseInt(id));
      if (idx >= 0) {
        prescriptionsList[idx].pharmacyState = 'prepared';
        renderTable();
        updateStats();
      }
    } else if (action === 'deliver') {
      socket.emit('move-patient', { id, pharmacyState: 'delivered', status: 'completed' });
      // Update local state immediately for better UX
      const idx = prescriptionsList.findIndex(x => x.id === parseInt(id));
      if (idx >= 0) {
        prescriptionsList[idx].pharmacyState = 'delivered';
        prescriptionsList[idx].status = 'completed';
        renderTable();
        updateStats();
      }
    }
  });
}

// --- Data Loading ---
function loadPrescriptions() {
  fetch(`${API_BASE}/api/prescriptions`, { credentials: 'include' }).then(r => r.json()).then(list => {
    prescriptionsList = list;
    renderTable();
    updateStats();
  });
}

// --- Rendering ---
function renderTable() {
  tableBody.innerHTML = '';

  const term = searchInput.value.toLowerCase();
  const filtered = prescriptionsList.filter(p => p.name.toLowerCase().includes(term));

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'animate-fade-in';

    // Status Logic
    let status = p.pharmacyState || 'pending';
    let badgeClass = 'pending';
    if (status === 'prepared') badgeClass = 'prepared';
    if (status === 'delivered') badgeClass = 'delivered';

    // Actions
    let actionsHtml = '';
    if (status === 'pending' || !status) {
      actionsHtml = `<button class="btn btn-sm btn-primary" data-id="${p.id}" data-action="prepare">Mark Prepared</button>`;
    } else if (status === 'prepared') {
      actionsHtml = `<button class="btn btn-sm btn-accent" data-id="${p.id}" data-action="deliver">Mark Delivered</button>`;
    } else {
      actionsHtml = '<span class="text-muted">Completed</span>';
    }

    tr.innerHTML = `
      <td><strong>#${p.token}</strong></td>
      <td>
        <div style="font-weight:600;">${p.name}</div>
        <div class="text-muted" style="font-size:0.85rem;">${p.age} / ${p.gender}</div>
      </td>
      <td>
        <div style="white-space: pre-wrap; font-size: 0.9rem;">${p.prescription || '-'}</div>
      </td>
      <td><span class="badge ${badgeClass}">${status.toUpperCase()}</span></td>
      <td>${actionsHtml}</td>
    `;
    tableBody.appendChild(tr);
  });
}

function updateStats() {
  const today = new Date().toISOString().split('T')[0];
  // Ideally filter by date, but for now just count current list states
  // Assuming list contains recent relevant items

  statPending.innerText = prescriptionsList.filter(p => !p.pharmacyState || p.pharmacyState === 'pending').length;
  statPrepared.innerText = prescriptionsList.filter(p => p.pharmacyState === 'prepared').length;
  statDelivered.innerText = prescriptionsList.filter(p => p.pharmacyState === 'delivered').length;
}

// --- Socket Events ---
socket.on('queue-updated', ({ patient }) => {
  if (patient) {
    // Check if relevant to pharmacy (has prescription or in pharmacy flow)
    const isRelevant = (patient.prescription && patient.prescription !== '') || patient.status === 'pharmacy' || patient.pharmacyState;

    const idx = prescriptionsList.findIndex(x => x.id === patient.id);
    if (idx >= 0) {
      if (isRelevant) prescriptionsList[idx] = patient;
      else prescriptionsList.splice(idx, 1); // Remove if no longer relevant (unlikely but possible)
    } else if (isRelevant) {
      prescriptionsList.push(patient);
    }
    renderTable();
    updateStats();
  } else {
    loadPrescriptions();
  }
});

socket.on('prescription-updated', (p) => {
  const idx = prescriptionsList.findIndex(x => x.id === p.id);
  if (idx >= 0) prescriptionsList[idx] = p;
  else prescriptionsList.push(p);
  renderTable();
  updateStats();
});

// Start
init();
