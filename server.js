const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ExcelJS = require('exceljs');
const session = require('express-session');
const db = require('./database');
const auth = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: 'MedFlowProSecretKey2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Sample departments and doctors (Static for now)
const departments = [
  'General', 'Orthopedics', 'Gynecology', 'Pediatrics', 'ENT', 'Dermatology', 'Cardiology', 'Medicine'
];

const doctors = [
  { id: 1, name: 'Dr. Asha Patel', dept: 'General', status: 'available' },
  { id: 2, name: 'Dr. Rajesh Singh', dept: 'Orthopedics', status: 'available' },
  { id: 3, name: 'Dr. Nisha Rao', dept: 'Gynecology', status: 'available' },
  { id: 4, name: 'Dr. Vikram Shah', dept: 'Cardiology', status: 'available' }
];

// --- Authentication & Hospital Management APIs ---

// Hospital Registration
app.post('/api/hospitals/register', (req, res) => {
  const { hospital, admin } = req.body;

  if (!hospital || !hospital.name || !hospital.email || !admin || !admin.username || !admin.password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Check if email already exists
  db.get('SELECT id FROM hospitals WHERE email = ?', [hospital.email], (err, existing) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (existing) {
      return res.status(400).json({ success: false, message: 'Hospital email already registered' });
    }

    // Insert hospital
    const subscriptionExpiry = new Date();
    subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 30); // 30-day trial

    const hospitalSql = `INSERT INTO hospitals (name, email, phone, address, subscriptionStatus, subscriptionExpiry, createdAt) 
                         VALUES (?, ?, ?, ?, 'active', ?, ?)`;

    db.run(hospitalSql, [
      hospital.name,
      hospital.email,
      hospital.phone || null,
      hospital.address || null,
      subscriptionExpiry.toISOString(),
      new Date().toISOString()
    ], function (err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Failed to create hospital' });
      }

      const hospitalId = this.lastID;

      // Generate monthly password for hospital
      const monthlyPassword = auth.generateHospitalPassword(hospitalId);

      // Hash admin password
      const hashedPassword = auth.hashPassword(admin.password);

      // Insert admin user
      const userSql = `INSERT INTO users (hospitalId, username, email, role, password, createdAt) 
                       VALUES (?, ?, ?, 'admin', ?, ?)`;

      db.run(userSql, [
        hospitalId,
        admin.username,
        admin.email || null,
        hashedPassword,
        new Date().toISOString()
      ], function (err) {
        if (err) {
          return res.status(500).json({ success: false, message: 'Failed to create admin user' });
        }

        res.json({
          success: true,
          message: 'Hospital registered successfully',
          hospitalId: hospitalId,
          password: monthlyPassword
        });
      });
    });
  });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { hospitalPassword, username, userPassword } = req.body;

  if (!hospitalPassword || !username || !userPassword) {
    return res.status(400).json({ success: false, message: 'Missing credentials' });
  }

  // First, find if any hospital has this password
  db.all('SELECT id, subscriptionStatus FROM hospitals', [], (err, hospitals) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    // Check which hospital matches the password
    let matchedHospitalId = null;
    for (const hospital of hospitals) {
      if (auth.verifyHospitalPassword(hospital.id, hospitalPassword)) {
        if (hospital.subscriptionStatus !== 'active') {
          return res.status(403).json({ success: false, message: 'Subscription expired' });
        }
        matchedHospitalId = hospital.id;
        break;
      }
    }

    if (!matchedHospitalId) {
      return res.status(401).json({ success: false, message: 'Invalid hospital password' });
    }

    // Now verify user credentials for this hospital
    db.get('SELECT * FROM users WHERE hospitalId = ? AND username = ?',
      [matchedHospitalId, username],
      (err, user) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (!user || !auth.comparePassword(userPassword, user.password)) {
          return res.status(401).json({ success: false, message: 'Invalid username or password' });
        }

        // Update last login
        db.run('UPDATE users SET lastLogin = ? WHERE id = ?', [new Date().toISOString(), user.id]);
        db.run('UPDATE hospitals SET lastLogin = ? WHERE id = ?', [new Date().toISOString(), matchedHospitalId]);

        // Set session
        req.session.userId = user.id;
        req.session.hospitalId = matchedHospitalId;
        req.session.username = user.username;
        req.session.role = user.role;

        res.json({
          success: true,
          message: 'Login successful',
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            hospitalId: matchedHospitalId
          }
        });
      });
  });
});

// Auth status check
app.get('/api/auth/status', (req, res) => {
  if (req.session.userId) {
    res.json({
      authenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role,
        hospitalId: req.session.hospitalId
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user's hospital info
app.get('/api/hospital/info', (req, res) => {
  if (!req.session.hospitalId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  db.get('SELECT * FROM hospitals WHERE id = ?', [req.session.hospitalId], (err, hospital) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(hospital);
  });
});

// --- Superadmin APIs ---

// List all hospitals
app.get('/api/admin/hospitals', (req, res) => {
  db.all('SELECT * FROM hospitals ORDER BY createdAt DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// List all users
app.get('/api/admin/users', (req, res) => {
  db.all('SELECT id, hospitalId, username, email, role, createdAt, lastLogin FROM users ORDER BY createdAt DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get hospital password
app.get('/api/admin/hospital-password/:id', (req, res) => {
  const hospitalId = parseInt(req.params.id);
  const password = auth.generateHospitalPassword(hospitalId);
  res.json({ password });
});

// Update hospital subscription status
app.put('/api/admin/hospitals/:id/status', (req, res) => {
  const hospitalId = parseInt(req.params.id);
  const { status } = req.body;

  db.run('UPDATE hospitals SET subscriptionStatus = ? WHERE id = ?',
    [status, hospitalId],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

// Update hospital subscription expiry
app.put('/api/admin/hospitals/:id/expiry', (req, res) => {
  const hospitalId = parseInt(req.params.id);
  const { expiryDate, daysToAdd } = req.body;

  let newExpiry;
  if (expiryDate) {
    // Use provided date
    newExpiry = new Date(expiryDate).toISOString();

    db.run('UPDATE hospitals SET subscriptionExpiry = ?, subscriptionStatus = ? WHERE id = ?',
      [newExpiry, 'active', hospitalId],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, expiryDate: newExpiry });
      }
    );
  } else if (daysToAdd) {
    // Add days to current expiry or today
    db.get('SELECT subscriptionExpiry FROM hospitals WHERE id = ?', [hospitalId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      const baseDate = row && row.subscriptionExpiry ? new Date(row.subscriptionExpiry) : new Date();
      baseDate.setDate(baseDate.getDate() + parseInt(daysToAdd));
      newExpiry = baseDate.toISOString();

      db.run('UPDATE hospitals SET subscriptionExpiry = ?, subscriptionStatus = ? WHERE id = ?',
        [newExpiry, 'active', hospitalId],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, expiryDate: newExpiry });
        }
      );
    });
  } else {
    return res.status(400).json({ error: 'Either expiryDate or daysToAdd required' });
  }
});

// Public endpoint to get list of hospitals (for login page)
app.get('/api/hospitals', (req, res) => {
  db.all('SELECT id, name, email FROM hospitals ORDER BY name ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get patients with hospital filtering
app.get('/api/patients', (req, res) => {
  const { phone } = req.query;
  const hospitalId = req.session.hospitalId;

  let sql = `SELECT * FROM patients`;
  let params = [];

  // Filter by hospital if logged in
  if (hospitalId) {
    sql += ` WHERE hospitalId = ?`;
    params.push(hospitalId);

    if (phone) {
      sql += ` AND phone = ?`;
      params.push(phone);
    }
  } else if (phone) {
    // Fallback for non-authenticated requests
    sql += ` WHERE phone = ?`;
    params.push(phone);
  }

  sql += ` ORDER BY id DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/patients/:id', (req, res) => {
  const hospitalId = req.session.hospitalId;
  let sql = `SELECT * FROM patients WHERE id = ?`;
  let params = [req.params.id];

  // Filter by hospital if logged in
  if (hospitalId) {
    sql += ` AND hospitalId = ?`;
    params.push(hospitalId);
  }

  db.get(sql, params, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });
});

app.get('/api/doctors', (req, res) => {
  const { dept } = req.query;
  if (dept) return res.json(doctors.filter(d => d.dept === dept));
  res.json(doctors);
});

app.get('/api/departments', (req, res) => {
  res.json(departments);
});

app.get('/api/prescriptions', (req, res) => {
  const hospitalId = req.session.hospitalId;

  // Patients with prescription OR in pharmacy flow
  let sql = `SELECT * FROM patients WHERE ((prescription IS NOT NULL AND prescription != '') OR status = 'pharmacy' OR pharmacyState IS NOT NULL)`;
  let params = [];

  if (hospitalId) {
    sql += ` AND hospitalId = ?`;
    params.push(hospitalId);
  }

  sql += ` ORDER BY token ASC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Excel Export Endpoint
app.get('/api/export', async (req, res) => {
  const { type } = req.query; // 'month' or 'year'
  const now = new Date();
  let startDate;

  if (type === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1).toISOString();
  } else {
    // Default to current month
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  const sql = `SELECT * FROM patients WHERE registeredAt >= ? ORDER BY registeredAt DESC`;

  db.all(sql, [startDate], async (err, rows) => {
    if (err) return res.status(500).send('Database error');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Patients');

    sheet.columns = [
      { header: 'Patient Name', key: 'name', width: 25 },
      { header: 'Visit Date', key: 'registeredAt', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Age', key: 'age', width: 10 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Department', key: 'department', width: 15 },
      { header: 'Reason', key: 'reason', width: 20 },
      { header: 'Prescription', key: 'prescription', width: 30 },
      { header: 'Cost Paid', key: 'cost', width: 12 },
      { header: 'Status', key: 'status', width: 15 }
    ];

    // Format the data for better readability
    const formattedRows = rows.map(row => ({
      ...row,
      registeredAt: new Date(row.registeredAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }),
      cost: row.cost || 0
    }));

    sheet.addRows(formattedRows);

    // Style the header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0EA5E9' }
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=patients_${type}_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  });
});

// --- Lab Dashboard APIs ---

// Get Lab Stats
app.get('/api/lab/stats', (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  const stats = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    urgent: 0,
    samplesToCollect: 0
  };

  const sql = `
    SELECT 
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as inProgress,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN priority = 'urgent' AND status != 'completed' THEN 1 END) as urgent,
      COUNT(CASE WHEN sampleStatus = 'pending' THEN 1 END) as samplesToCollect
    FROM lab_tests
    WHERE hospitalId = ?
  `;

  db.get(sql, [hospitalId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    // Merge row data with default stats to ensure all fields exist
    res.json({ ...stats, ...row });
  });
});

// Get Lab Tests with Filters
app.get('/api/lab/tests', (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  const { status, date, search } = req.query;
  let sql = `
    SELECT lt.*, p.name as patientName, p.age as patientAge, p.gender as patientGender, p.phone as patientPhone 
    FROM lab_tests lt
    JOIN patients p ON lt.patientId = p.id
    WHERE lt.hospitalId = ?
  `;
  const params = [hospitalId];

  if (status && status !== 'all') {
    sql += ` AND lt.status = ?`;
    params.push(status);
  }

  if (date) {
    // Assuming date is YYYY-MM-DD
    sql += ` AND lt.orderedAt LIKE ?`;
    params.push(`${date}%`);
  }

  if (search) {
    sql += ` AND (p.name LIKE ? OR p.phone LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY CASE WHEN lt.priority = 'urgent' THEN 0 ELSE 1 END, lt.orderedAt DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Assign Technician
app.post('/api/lab/tests/:id/assign', (req, res) => {
  const { technicianId } = req.body;
  const testId = req.params.id;

  db.run('UPDATE lab_tests SET technicianId = ? WHERE id = ?', [technicianId, testId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Update Sample Status
app.post('/api/lab/tests/:id/sample', (req, res) => {
  const { status, rejectionReason } = req.body; // status: 'collected', 'rejected'
  const testId = req.params.id;
  const user = req.session.username || 'Unknown';
  const now = new Date().toISOString();

  let sql = 'UPDATE lab_tests SET sampleStatus = ?, sampleCollectedBy = ?, sampleCollectedAt = ?';
  const params = [status, user, now];

  if (status === 'rejected') {
    sql += ', rejectionReason = ?';
    params.push(rejectionReason);
  }

  sql += ' WHERE id = ?';
  params.push(testId);

  db.run(sql, params, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Update Test Processing Status
app.post('/api/lab/tests/:id/process', (req, res) => {
  const { status, machineId } = req.body; // status: 'in_progress', 'completed'
  const testId = req.params.id;
  const now = new Date().toISOString();

  let sql = 'UPDATE lab_tests SET status = ?';
  const params = [status];

  if (status === 'in_progress') {
    sql += ', startedAt = ?, machineId = ?';
    params.push(now, machineId);
  } else if (status === 'completed') {
    sql += ', completedAt = ?';
    params.push(now);
  }

  sql += ' WHERE id = ?';
  params.push(testId);

  db.run(sql, params, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Save Lab Results
app.post('/api/lab/tests/:id/results', (req, res) => {
  const testId = req.params.id;
  const { results } = req.body; // Array of { parameterName, value, unit, referenceRange, isAbnormal, notes }

  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'Invalid results data' });
  }

  // Use a transaction-like approach (serialize)
  db.serialize(() => {
    db.run('DELETE FROM lab_results WHERE testId = ?', [testId]); // Clear old results first

    const stmt = db.prepare('INSERT INTO lab_results (testId, parameterName, value, unit, referenceRange, isAbnormal, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');

    results.forEach(r => {
      stmt.run(testId, r.parameterName, r.value, r.unit, r.referenceRange, r.isAbnormal ? 1 : 0, r.notes);
    });

    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });

      // Also mark test as completed if results are saved
      db.run('UPDATE lab_tests SET status = "completed", resultDate = ? WHERE id = ?', [new Date().toISOString(), testId]);

      res.json({ success: true });
    });
  });
});

// Get Test Details & Results
app.get('/api/lab/tests/:id', (req, res) => {
  const testId = req.params.id;

  db.get('SELECT * FROM lab_tests WHERE id = ?', [testId], (err, test) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!test) return res.status(404).json({ error: 'Test not found' });

    db.all('SELECT * FROM lab_results WHERE testId = ?', [testId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ...test, results });
    });
  });
});

// Inventory Management
app.get('/api/lab/inventory', (req, res) => {
  const hospitalId = req.session.hospitalId;
  db.all('SELECT * FROM lab_inventory WHERE hospitalId = ?', [hospitalId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/lab/inventory', (req, res) => {
  const hospitalId = req.session.hospitalId;
  const { itemName, quantity, unit, minLevel } = req.body;

  db.run('INSERT INTO lab_inventory (hospitalId, itemName, quantity, unit, minLevel, addedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [hospitalId, itemName, quantity, unit, minLevel, new Date().toISOString()],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Test Types (Templates)
app.get('/api/lab/settings/test-types', (req, res) => {
  const hospitalId = req.session.hospitalId;
  db.all('SELECT * FROM lab_test_types WHERE hospitalId = ?', [hospitalId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/lab/settings/test-types', (req, res) => {
  const hospitalId = req.session.hospitalId;
  const { name, category, parameters, price } = req.body;

  db.run('INSERT INTO lab_test_types (hospitalId, name, category, parameters, price) VALUES (?, ?, ?, ?, ?)',
    [hospitalId, name, category, JSON.stringify(parameters), price],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// --- Prescription Template APIs ---

// Get hospital's prescription template
app.get('/api/prescription-template', (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  db.get('SELECT * FROM prescription_templates WHERE hospitalId = ?', [hospitalId], (err, template) => {
    if (err) return res.status(500).json({ error: err.message });

    // If no template exists, return default
    if (!template) {
      return res.json({
        hospitalId,
        templateName: 'Default Template',
        fontSize: 12,
        fontFamily: 'Helvetica',
        primaryColor: '#0EA5E9',
        secondaryColor: '#666666',
        paperSize: 'A4',
        showQRCode: 1,
        showWatermark: 0,
        showLetterhead: 1,
        marginTop: 50,
        marginBottom: 50,
        marginLeft: 50,
        marginRight: 50
      });
    }

    res.json(template);
  });
});

// Create or update prescription template
app.post('/api/prescription-template', (req, res) => {
  const hospitalId = req.session.hospitalId;
  if (!hospitalId) return res.status(401).json({ error: 'Not authenticated' });

  const {
    templateName, hospitalName, hospitalAddress, hospitalPhone, hospitalEmail,
    hospitalLogo, headerText, footerText, showQRCode, showWatermark, watermarkText,
    fontSize, fontFamily, primaryColor, secondaryColor, paperSize,
    marginTop, marginBottom, marginLeft, marginRight, showLetterhead, doctorNamePosition
  } = req.body;

  // Check if template exists
  db.get('SELECT id FROM prescription_templates WHERE hospitalId = ?', [hospitalId], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });

    const now = new Date().toISOString();

    if (existing) {
      // Update existing template
      const sql = `UPDATE prescription_templates SET 
        templateName = ?, hospitalName = ?, hospitalAddress = ?, hospitalPhone = ?, 
        hospitalEmail = ?, hospitalLogo = ?, headerText = ?, footerText = ?,
        showQRCode = ?, showWatermark = ?, watermarkText = ?, fontSize = ?, 
        fontFamily = ?, primaryColor = ?, secondaryColor = ?, paperSize = ?,
        marginTop = ?, marginBottom = ?, marginLeft = ?, marginRight = ?, 
        showLetterhead = ?, doctorNamePosition = ?, updatedAt = ?
        WHERE hospitalId = ?`;

      db.run(sql, [
        templateName, hospitalName, hospitalAddress, hospitalPhone, hospitalEmail,
        hospitalLogo, headerText, footerText, showQRCode, showWatermark, watermarkText,
        fontSize, fontFamily, primaryColor, secondaryColor, paperSize,
        marginTop, marginBottom, marginLeft, marginRight, showLetterhead, doctorNamePosition,
        now, hospitalId
      ], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Template updated' });
      });
    } else {
      // Create new template
      const sql = `INSERT INTO prescription_templates (
        hospitalId, templateName, hospitalName, hospitalAddress, hospitalPhone, hospitalEmail,
        hospitalLogo, headerText, footerText, showQRCode, showWatermark, watermarkText,
        fontSize, fontFamily, primaryColor, secondaryColor, paperSize,
        marginTop, marginBottom, marginLeft, marginRight, showLetterhead, doctorNamePosition,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      db.run(sql, [
        hospitalId, templateName, hospitalName, hospitalAddress, hospitalPhone, hospitalEmail,
        hospitalLogo, headerText, footerText, showQRCode, showWatermark, watermarkText,
        fontSize, fontFamily, primaryColor, secondaryColor, paperSize,
        marginTop, marginBottom, marginLeft, marginRight, showLetterhead, doctorNamePosition,
        now, now
      ], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Template created' });
      });
    }
  });
});

// Generate Prescription PDF
app.get('/api/prescription-pdf/:patientId', async (req, res) => {
  console.log('PDF Generation Request received for patient:', req.params.patientId);
  const hospitalId = req.session.hospitalId;
  const patientId = req.params.patientId;

  if (!hospitalId) {
    console.log('PDF Error: Not authenticated');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Get patient details
    console.log('Fetching patient details...');
    const patient = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM patients WHERE id = ? AND hospitalId = ?', [patientId, hospitalId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!patient) {
      console.log('PDF Error: Patient not found');
      return res.status(404).json({ error: 'Patient not found' });
    }
    console.log('Patient found:', patient.name);

    // Get prescription template
    console.log('Fetching template...');
    const template = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM prescription_templates WHERE hospitalId = ?', [hospitalId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });
    console.log('Template loaded:', template ? 'Custom' : 'Default');

    // Get hospital info
    const hospital = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM hospitals WHERE id = ?', [hospitalId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get doctor info
    const doctorName = req.session.username || 'Dr. Unknown';

    console.log('Initializing PDFKit...');
    const PDFDocument = require('pdfkit');

    // Validate paper size
    const validSizes = ['A4', 'LETTER', 'A5', 'LEGAL'];
    let paperSize = (template.paperSize || 'A4').toUpperCase();
    if (!validSizes.includes(paperSize)) paperSize = 'A4';

    const doc = new PDFDocument({
      size: paperSize,
      margins: {
        top: Number(template.marginTop) || 50,
        bottom: Number(template.marginBottom) || 50,
        left: Number(template.marginLeft) || 50,
        right: Number(template.marginRight) || 50
      }
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=prescription_${patient.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`);

    // Pipe PDF to response
    doc.pipe(res);

    const primaryColor = template.primaryColor || '#0EA5E9';
    const secondaryColor = template.secondaryColor || '#666666';
    const fontSize = Number(template.fontSize) || 12;

    // Add watermark if enabled
    if (template.showWatermark && template.watermarkText) {
      doc.save();
      doc.fontSize(60)
        .fillColor('#f0f0f0')
        .opacity(0.1)
        .rotate(45, { origin: [300, 300] })
        .text(template.watermarkText, 100, 100, {
          align: 'center',
          width: 400
        });
      doc.restore();
    }

    // Header/Letterhead
    if (template.showLetterhead) {
      doc.fontSize(20)
        .fillColor(primaryColor)
        .text(template.hospitalName || hospital.name || 'Medical Center', { align: 'center' });

      doc.fontSize(10)
        .fillColor(secondaryColor)
        .text(template.hospitalAddress || hospital.address || '', { align: 'center' })
        .text((template.hospitalPhone || hospital.phone || '') +
          (template.hospitalEmail ? ' | ' + template.hospitalEmail : ''), { align: 'center' });

      // Horizontal line
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y)
        .lineTo(550, doc.y)
        .strokeColor(primaryColor)
        .stroke();

      doc.moveDown(1.5);
    }

    // Doctor Info
    doc.fontSize(fontSize)
      .fillColor('#000000')
      .text(`Doctor: ${doctorName}`, { continued: true })
      .text(`Date: ${new Date().toLocaleDateString('en-IN')}`, { align: 'right' });

    doc.moveDown(1);

    // Patient Information
    doc.fontSize(fontSize + 2)
      .fillColor(primaryColor)
      .text('Patient Information', { underline: true });

    doc.fontSize(fontSize)
      .fillColor('#000000')
      .moveDown(0.5)
      .text(`Name: ${patient.name}`)
      .text(`Age: ${patient.age} years | Gender: ${patient.gender}`)
      .text(`Phone: ${patient.phone}`)
      .text(`Token No: ${patient.token}`)
      .text(`Department: ${patient.department}`);

    doc.moveDown(1.5);

    // Chief Complaint / Reason for Visit
    if (patient.reason) {
      doc.fontSize(fontSize + 2)
        .fillColor(primaryColor)
        .text('Chief Complaint', { underline: true });

      doc.fontSize(fontSize)
        .fillColor('#000000')
        .moveDown(0.5)
        .text(patient.reason);

      doc.moveDown(1.5);
    }

    // Diagnosis
    if (patient.diagnosis) {
      doc.fontSize(fontSize + 2)
        .fillColor(primaryColor)
        .text('Diagnosis', { underline: true });

      doc.fontSize(fontSize)
        .fillColor('#000000')
        .moveDown(0.5)
        .text(patient.diagnosis);

      doc.moveDown(1.5);
    }

    // Prescription (Rx)
    doc.fontSize(fontSize + 4)
      .fillColor(primaryColor)
      .text('℞ Prescription', { underline: true });

    doc.fontSize(fontSize)
      .fillColor('#000000')
      .moveDown(0.5);

    if (patient.prescription) {
      const prescriptionLines = patient.prescription.split('\n');
      prescriptionLines.forEach(line => {
        if (line.trim()) {
          doc.text(`• ${line.trim()}`);
        }
      });
    } else {
      doc.text('No prescription provided');
    }

    doc.moveDown(2);

    // Footer with header text
    if (template.headerText) {
      doc.fontSize(fontSize - 2)
        .fillColor(secondaryColor)
        .text(template.headerText, { align: 'center' });
    }

    // Add footer at bottom
    const bottomY = doc.page.height - (Number(template.marginBottom) || 50) - 50;

    // Only move if we aren't already past it
    if (doc.y < bottomY) {
      doc.y = bottomY;
    }

    if (template.footerText) {
      doc.fontSize(fontSize - 2)
        .fillColor(secondaryColor)
        .text(template.footerText, { align: 'center' });
    }

    // Doctor signature line
    doc.moveDown(2);
    doc.fontSize(fontSize - 1)
      .fillColor('#000000')
      .text('_____________________', 350, doc.y, { align: 'right' })
      .text(doctorName, 350, doc.y + 5, { align: 'right', width: 200 });

    // Finalize PDF
    console.log('Finalizing PDF...');
    doc.end();
    console.log('PDF generated successfully');

  } catch (error) {
    console.error('PDF generation error:', error);
    // If headers haven't been sent, send error response
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
    }
  }
});

io.on('connection', (socket) => {
  // Store session data in socket for easy access
  socket.on('join', (role) => {
    if (role === 'doctor') socket.join('doctors');
    if (role === 'reception') socket.join('reception');
    if (role === 'pharmacy') socket.join('pharmacy');
    if (role === 'lab') socket.join('lab');
    socket.role = role;
    console.log(`Socket ${socket.id} joined as ${role}`);
  });

  socket.on('register-patient', (data) => {
    const dept = data.department || 'General';
    const hospitalId = data.hospitalId || 1; // Use hospitalId from data, fallback to 1 for testing

    // Calculate next token for this department today
    // For simplicity in this demo, we just count total patients in dept + 1
    // In prod, you'd filter by date too.
    db.get(`SELECT COUNT(*) as count FROM patients WHERE department = ? AND hospitalId = ?`,
      [dept, hospitalId], (err, row) => {
        if (err) return console.error(err);

        const token = (row.count || 0) + 1;

        let assignedDoctor = data.doctorId || null;
        if (!assignedDoctor) {
          const avail = doctors.find(d => d.dept === dept && d.status === 'available');
          if (avail) assignedDoctor = avail.id;
        }

        const patient = {
          hospitalId,
          token,
          name: data.name || 'Unknown',
          age: data.age || '',
          gender: data.gender || '',
          phone: data.phone || '',
          address: data.address || '',
          patientType: data.patientType || 'New',
          opdIpd: data.opdIpd || 'OPD',
          department: dept,
          doctorId: assignedDoctor,
          reason: data.reason || '',
          status: 'waiting',
          registeredAt: new Date().toISOString(),
          vitals: data.vitals || {},
          prescription: data.prescription || '',
          history: data.history || [],
          pharmacyState: null,
          cost: data.cost || 0
        };

        const sql = `INSERT INTO patients (hospitalId, token, name, age, gender, phone, address, patientType, opdIpd, department, doctorId, reason, status, registeredAt, vitals, prescription, pharmacyState, history, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
          patient.hospitalId, patient.token, patient.name, patient.age, patient.gender, patient.phone, patient.address,
          patient.patientType, patient.opdIpd, patient.department, patient.doctorId, patient.reason,
          patient.status, patient.registeredAt, JSON.stringify(patient.vitals), patient.prescription,
          patient.pharmacyState, JSON.stringify(patient.history), patient.cost
        ];

        db.run(sql, params, function (err) {
          if (err) {
            console.error(err.message);
            socket.emit('patient-registration-error', { message: 'Database error: ' + err.message });
            return;
          }

          patient.id = this.lastID; // Get the auto-increment ID
          console.log(`Registered patient ${patient.id} token ${patient.token} for hospital ${hospitalId}`);

          // Broadcast
          io.to('doctors').emit('patient-registered', patient);
          io.to('reception').emit('patient-registered', patient);
          io.emit('queue-updated', { patient });
          socket.emit('patient-registered', patient);
        });
      });
  });

  socket.on('move-patient', ({ id, status, doctorId, pharmacyState }) => {
    const pid = Number(id);

    // First get current state to merge
    db.get(`SELECT * FROM patients WHERE id = ?`, [pid], (err, current) => {
      if (err || !current) return;

      const newStatus = status || current.status;
      const newDocId = doctorId || current.doctorId;
      const newPharmState = pharmacyState || current.pharmacyState;
      const updatedAt = new Date().toISOString();

      const sql = `UPDATE patients SET status = ?, doctorId = ?, pharmacyState = ? WHERE id = ?`;
      db.run(sql, [newStatus, newDocId, newPharmState, pid], (err) => {
        if (err) return console.error(err);

        // Fetch updated to broadcast
        db.get(`SELECT * FROM patients WHERE id = ?`, [pid], (err, updated) => {
          if (updated) {
            io.emit('patient-updated', updated);
            io.to('doctors').emit('queue-updated', { patient: updated });
            io.to('reception').emit('queue-updated', { patient: updated });
            io.to('pharmacy').emit('queue-updated', { patient: updated });
          }
        });
      });
    });
  });

  socket.on('update-prescription', ({ id, prescription }) => {
    const pid = Number(id);
    const sql = `UPDATE patients SET prescription = ? WHERE id = ?`;
    db.run(sql, [prescription, pid], (err) => {
      if (err) return console.error(err);

      // Check for lab keywords and auto-create lab request
      const labKeywords = ['test', 'lab', 'cbc', 'blood', 'urine', 'x-ray', 'scan', 'profile', 'panel'];
      const lowerPrescription = prescription.toLowerCase();
      const hasLabRequest = labKeywords.some(keyword => lowerPrescription.includes(keyword));

      if (hasLabRequest) {
        // Fetch patient details to get hospitalId
        db.get('SELECT hospitalId, name, doctorId FROM patients WHERE id = ?', [pid], (err, patient) => {
          if (patient) {
            // Check if a pending test already exists for this patient today to avoid duplicates (simple check)
            const today = new Date().toISOString().split('T')[0];
            db.get('SELECT id FROM lab_tests WHERE patientId = ? AND orderedAt LIKE ? AND status = "pending"',
              [pid, `${today}%`], (err, existing) => {
                if (!existing) {
                  const testName = "Lab Test Request (from Prescription)"; // In future, parse specific test names
                  const insertSql = `INSERT INTO lab_tests (hospitalId, patientId, testName, orderedBy, orderedAt, status, priority, sampleStatus) 
                                       VALUES (?, ?, ?, ?, ?, 'pending', 'normal', 'pending')`;

                  // Get doctor name
                  let doctorName = 'Doctor';
                  const doc = doctors.find(d => d.id === patient.doctorId);
                  if (doc) doctorName = doc.name;

                  db.run(insertSql, [patient.hospitalId, pid, testName, doctorName, new Date().toISOString()], function (err) {
                    if (!err) {
                      console.log(`Auto-created lab test ${this.lastID} for patient ${pid}`);
                      io.to('lab').emit('lab-update'); // Notify lab
                    }
                  });
                }
              });
          }
        });
      }

      db.get(`SELECT * FROM patients WHERE id = ?`, [pid], (err, updated) => {
        if (updated) {
          io.to('doctors').emit('prescription-updated', updated);
          io.to('reception').emit('prescription-updated', updated);
          socket.emit('prescription-updated', updated);
        }
      });
    });
  });

  socket.on('create-lab-request', ({ patientId, testName, doctorId }) => {
    const pid = Number(patientId);
    const tName = testName || "Manual Lab Request";

    db.get('SELECT hospitalId, name FROM patients WHERE id = ?', [pid], (err, patient) => {
      if (err || !patient) return;

      const insertSql = `INSERT INTO lab_tests (hospitalId, patientId, testName, orderedBy, orderedAt, status, priority, sampleStatus) 
                           VALUES (?, ?, ?, ?, ?, 'pending', 'normal', 'pending')`;

      // Get doctor name
      let doctorName = 'Doctor';
      const doc = doctors.find(d => d.id === doctorId);
      if (doc) doctorName = doc.name;

      db.run(insertSql, [patient.hospitalId, pid, tName, doctorName, new Date().toISOString()], function (err) {
        if (!err) {
          console.log(`Manual lab test ${this.lastID} created for patient ${pid}`);
          io.to('lab').emit('lab-update'); // Notify lab
          socket.emit('lab-request-created', { success: true, testId: this.lastID });
        } else {
          socket.emit('lab-request-created', { success: false, message: err.message });
        }
      });
    });
  });

  socket.on('disconnect', () => { });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
