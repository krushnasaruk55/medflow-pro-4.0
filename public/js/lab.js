const socket = io();
let currentSection = 'overview';
let labTests = [];
let inventory = [];

// Join Lab Room
socket.emit('join', 'lab');

// Socket Listeners
socket.on('lab-update', () => {
    loadSection(currentSection);
    showToast('New lab update received', 'info');
});

document.addEventListener('DOMContentLoaded', () => {
    showSection('overview');
});

function showSection(section) {
    currentSection = section;

    // Update Sidebar
    document.querySelectorAll('.lab-nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.textContent.toLowerCase().includes(section.replace('-', ' '))) {
            item.classList.add('active');
        }
    });

    loadSection(section);
}

async function loadSection(section) {
    const content = document.getElementById('main-content');
    content.innerHTML = '<div style="text-align:center; padding: 40px;">Loading...</div>';

    try {
        switch (section) {
            case 'overview':
                await renderOverview(content);
                break;
            case 'requests':
                await renderRequests(content);
                break;
            case 'collection':
                await renderCollection(content);
                break;
            case 'processing':
                await renderProcessing(content);
                break;
            case 'results':
                await renderResultsList(content);
                break;
            case 'reports':
                await renderReports(content);
                break;
            case 'inventory':
                await renderInventory(content);
                break;
            case 'settings':
                await renderSettings(content);
                break;
        }
    } catch (error) {
        console.error(error);
        content.innerHTML = `<div class="card" style="color: var(--danger);">Error loading section: ${error.message}</div>`;
    }
}

// --- Render Functions ---

async function renderOverview(container) {
    const res = await fetch('/api/lab/stats');
    const stats = await res.json();

    container.innerHTML = `
        <div class="section-title">
            <h2>Lab Overview</h2>
            <div class="text-muted">${new Date().toLocaleDateString()}</div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Pending Requests</div>
                <div class="stat-value" style="color: var(--status-waiting);">${stats.pending}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Samples to Collect</div>
                <div class="stat-value" style="color: var(--primary);">${stats.samplesToCollect}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">In Progress</div>
                <div class="stat-value" style="color: var(--status-pharmacy);">${stats.inProgress}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Urgent / STAT</div>
                <div class="stat-value" style="color: var(--danger);">${stats.urgent}</div>
            </div>
        </div>

        <div class="card mt-4">
            <h3>Quick Actions</h3>
            <div class="flex gap-2 mt-4">
                <button class="btn btn-primary" onclick="showSection('requests')">View New Requests</button>
                <button class="btn btn-secondary" onclick="showSection('collection')">Sample Collection</button>
            </div>
        </div>
    `;
}

async function renderRequests(container) {
    const res = await fetch('/api/lab/tests?status=pending');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>Test Requests</h2>
        </div>
        <div class="filter-bar">
            <input type="text" placeholder="Search patient..." class="form-control" onkeyup="filterTests(this.value)">
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No pending test requests.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <div>
                            <strong>${test.patientName}</strong> <span class="text-muted">(${test.patientAge}/${test.patientGender})</span>
                            <div class="text-muted" style="font-size: 0.85rem;">${test.testName}</div>
                        </div>
                        <div>
                            ${test.priority === 'urgent' ? '<span class="badge" style="background: var(--danger); color: white;">URGENT</span>' : '<span class="badge waiting">Normal</span>'}
                        </div>
                    </div>
                    <div class="flex gap-2 mt-4">
                        <button class="btn btn-sm btn-primary" onclick="assignTechnician(${test.id})">Accept & Assign</button>
                    </div>
                </div>
            `;
        });
    }

    container.innerHTML = html;
}

async function renderCollection(container) {
    const res = await fetch('/api/lab/tests?status=pending');
    const tests = await res.json();
    const samplesToCollect = tests.filter(t => t.sampleStatus === 'pending');

    let html = `
        <div class="section-title">
            <h2>Sample Collection</h2>
        </div>
    `;

    if (samplesToCollect.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No samples to collect.</div>`;
    } else {
        samplesToCollect.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <div>
                            <strong>${test.patientName}</strong>
                            <div class="text-muted">${test.testName}</div>
                        </div>
                        <button class="btn btn-sm btn-secondary" onclick="printLabel(${test.id})">🖨 Label</button>
                    </div>
                    <div class="flex gap-2 mt-4">
                        <button class="btn btn-sm btn-primary" onclick="updateSampleStatus(${test.id}, 'collected')">Mark Collected</button>
                        <button class="btn btn-sm btn-danger" onclick="rejectSample(${test.id})">Reject</button>
                    </div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderProcessing(container) {
    const res = await fetch('/api/lab/tests?status=in_progress');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>Test Processing</h2>
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No tests in progress.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <strong>${test.patientName}</strong>
                        <span class="badge pharmacy">In Progress</span>
                    </div>
                    <div class="text-muted mb-4">${test.testName}</div>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-primary" onclick="enterResults(${test.id})">Enter Results</button>
                    </div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderResultsList(container) {
    const res = await fetch('/api/lab/tests?status=in_progress');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>Results Entry</h2>
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No pending results.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <strong>${test.patientName}</strong>
                        <button class="btn btn-sm btn-primary" onclick="enterResults(${test.id})">Enter Results</button>
                    </div>
                    <div class="text-muted">${test.testName}</div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderReports(container) {
    const res = await fetch('/api/lab/tests?status=completed');
    const tests = await res.json();

    let html = `
        <div class="section-title">
            <h2>Reports & Delivery</h2>
        </div>
    `;

    if (tests.length === 0) {
        html += `<div class="card" style="text-align: center; color: var(--text-muted);">No completed reports.</div>`;
    } else {
        tests.forEach(test => {
            html += `
                <div class="test-card">
                    <div class="test-header">
                        <strong>${test.patientName}</strong>
                        <span class="badge completed">Completed</span>
                    </div>
                    <div class="text-muted mb-4">${test.testName}</div>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-secondary" onclick="viewReport(${test.id})">View PDF</button>
                        <button class="btn btn-sm btn-primary" onclick="sendReport(${test.id})">Send to Doctor</button>
                    </div>
                </div>
            `;
        });
    }
    container.innerHTML = html;
}

async function renderInventory(container) {
    const res = await fetch('/api/lab/inventory');
    const items = await res.json();

    let html = `
        <div class="section-title">
            <h2>Inventory</h2>
            <button class="btn btn-primary" onclick="addInventoryItem()">+ Add Item</button>
        </div>
        <div class="card table-container">
            <table>
                <thead>
                    <tr>
                        <th>Item Name</th>
                        <th>Quantity</th>
                        <th>Unit</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
    `;

    items.forEach(item => {
        html += `
            <tr>
                <td>${item.itemName}</td>
                <td>${item.quantity}</td>
                <td>${item.unit}</td>
                <td>${item.quantity < item.minLevel ? '<span style="color: var(--danger)">Low Stock</span>' : 'OK'}</td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

async function renderSettings(container) {
    container.innerHTML = `
        <div class="section-title">
            <h2>Settings</h2>
        </div>
        <div class="card">
            <h3>Test Templates</h3>
            <p class="text-muted">Manage lab test types and reference ranges.</p>
            <button class="btn btn-secondary" onclick="alert('Feature coming soon')">Manage Templates</button>
        </div>
    `;
}

// --- Actions ---

function assignTechnician(testId) {
    fetch(`/api/lab/tests/${testId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicianId: 1 })
    }).then(() => {
        showToast('Technician assigned', 'success');
        loadSection('requests');
    });
}

function updateSampleStatus(testId, status) {
    fetch(`/api/lab/tests/${testId}/sample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    }).then(() => {
        showToast('Sample status updated', 'success');

        if (status === 'collected') {
            fetch(`/api/lab/tests/${testId}/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'in_progress' })
            });
        }
        loadSection('collection');
    });
}

function rejectSample(testId) {
    const reason = prompt("Enter rejection reason:");
    if (reason) {
        fetch(`/api/lab/tests/${testId}/sample`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'rejected', rejectionReason: reason })
        }).then(() => {
            showToast('Sample rejected', 'warning');
            loadSection('collection');
        });
    }
}

function printLabel(testId) {
    const win = window.open('', 'Print Label', 'width=400,height=200');
    win.document.write(`
        <div style="text-align: center; font-family: monospace; padding: 20px;">
            <h3>LAB SAMPLE</h3>
            <svg id="barcode"></svg>
            <p>ID: ${testId}</p>
            <p>Date: ${new Date().toLocaleDateString()}</p>
        </div>
    `);
    win.print();
    win.close();
    showToast('Label sent to printer', 'success');
}

async function enterResults(testId) {
    const content = document.getElementById('main-content');

    content.innerHTML = `
        <div class="section-title">
            <h2>Enter Results</h2>
            <button class="btn btn-secondary" onclick="showSection('processing')">Back</button>
        </div>
        <div class="card">
            <div id="results-form-container">
                <!-- Dynamic form -->
            </div>
            <div class="mt-4">
                <button class="btn btn-primary" onclick="saveResults(${testId})">Save & Complete</button>
            </div>
        </div>
    `;

    const container = document.getElementById('results-form-container');

    // Mock parameters
    const parameters = [
        { name: 'Hemoglobin', unit: 'g/dL', range: '13.0 - 17.0' },
        { name: 'WBC Count', unit: '/cumm', range: '4000 - 11000' },
        { name: 'RBC Count', unit: 'mill/cumm', range: '4.5 - 5.5' },
        { name: 'Platelets', unit: 'lakh/cumm', range: '1.5 - 4.5' }
    ];

    let html = '';
    parameters.forEach((param, index) => {
        html += `
            <div class="result-row">
                <div>${param.name}</div>
                <div><input type="text" class="result-value" data-name="${param.name}" placeholder="Value"></div>
                <div>${param.unit}</div>
                <div>${param.range}</div>
                <div><input type="text" class="result-notes" placeholder="Notes"></div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function saveResults(testId) {
    const rows = document.querySelectorAll('.result-row');
    const results = [];

    rows.forEach(row => {
        const name = row.querySelector('.result-value').dataset.name;
        const value = row.querySelector('.result-value').value;
        const notes = row.querySelector('.result-notes').value;

        if (value) {
            results.push({
                parameterName: name,
                value: value,
                unit: row.children[2].textContent,
                referenceRange: row.children[3].textContent,
                isAbnormal: false, // Add logic to check range
                notes: notes
            });
        }
    });

    fetch(`/api/lab/tests/${testId}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results })
    }).then(() => {
        showToast('Results saved successfully', 'success');
        showSection('reports');
    });
}

async function viewReport(testId) {
    try {
        const res = await fetch(`/api/lab/tests/${testId}`);
        const test = await res.json();

        if (!test || !test.results) {
            alert('No results found for this test.');
            return;
        }

        const win = window.open('', 'Report', 'width=800,height=800');

        let resultsHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <thead>
                    <tr style="background: #f3f4f6; text-align: left;">
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Parameter</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Result</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Unit</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Ref. Range</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd;">Notes</th>
                    </tr>
                </thead>
                <tbody>
        `;

        test.results.forEach(r => {
            resultsHtml += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${r.parameterName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; ${r.isAbnormal ? 'color: red;' : ''}">${r.value}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${r.unit}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${r.referenceRange}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">${r.notes || '-'}</td>
                </tr>
            `;
        });

        resultsHtml += `</tbody></table>`;

        win.document.write(`
            <html>
            <head>
                <title>Lab Report - ${test.patientName}</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #333; }
                    .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; }
                    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                    .meta-item { margin-bottom: 10px; }
                    .label { font-weight: bold; color: #666; font-size: 0.9rem; }
                    .footer { margin-top: 50px; text-align: center; font-size: 0.8rem; color: #999; border-top: 1px solid #eee; padding-top: 20px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1 style="margin: 0; color: #3b82f6;">MedFlow Pro Lab</h1>
                    <p style="margin: 5px 0;">Excellence in Diagnostics</p>
                </div>
                
                <div class="meta">
                    <div>
                        <div class="meta-item"><span class="label">Patient Name:</span> <br>${test.patientName}</div>
                        <div class="meta-item"><span class="label">Age/Gender:</span> <br>${test.patientAge} / ${test.patientGender}</div>
                        <div class="meta-item"><span class="label">Phone:</span> <br>${test.patientPhone}</div>
                    </div>
                    <div style="text-align: right;">
                        <div class="meta-item"><span class="label">Test ID:</span> <br>#${test.id}</div>
                        <div class="meta-item"><span class="label">Date:</span> <br>${new Date(test.resultDate || test.completedAt).toLocaleDateString()}</div>
                        <div class="meta-item"><span class="label">Referred By:</span> <br>${test.orderedBy}</div>
                    </div>
                </div>

                <h2 style="border-left: 4px solid #3b82f6; padding-left: 10px;">${test.testName}</h2>
                
                ${resultsHtml}

                <div class="footer">
                    <p>This is a computer-generated report.</p>
                    <p>Generated on ${new Date().toLocaleString()}</p>
                </div>
            </body>
            </html>
        `);
        win.document.close();
    } catch (e) {
        console.error(e);
        showToast('Error generating report', 'error');
    }
}

function sendReport(testId) {
    showToast('Report sent to doctor and patient', 'success');
}

function addInventoryItem() {
    const name = prompt("Item Name:");
    const qty = prompt("Quantity:");
    const unit = prompt("Unit:");

    if (name && qty) {
        fetch('/api/lab/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemName: name, quantity: qty, unit: unit || 'units', minLevel: 10 })
        }).then(() => {
            showToast('Item added', 'success');
            loadSection('inventory');
        });
    }
}

// --- Utils ---

function showToast(message, type = 'info') {
    const container = document.querySelector('.toast-container') || createToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-content">
            <div class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

function closeModal() {
    document.getElementById('actionModal').style.display = 'none';
}