const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database (creates file if not exists)
const dbPath = path.join(__dirname, 'patients.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initSchema();
  }
});

function initSchema() {
  // Hospitals/Tenants table
  const hospitalsTable = `
    CREATE TABLE IF NOT EXISTS hospitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      address TEXT,
      subscriptionStatus TEXT DEFAULT 'active',
      subscriptionExpiry TEXT,
      createdAt TEXT,
      lastLogin TEXT
    )
  `;

  // Users table (for hospital staff)
  const usersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL,
      password TEXT NOT NULL,
      createdAt TEXT,
      lastLogin TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id),
      UNIQUE(hospitalId, username)
    )
  `;

  // Main patients table with hospital isolation
  const patientsTable = `
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      token INTEGER,
      name TEXT,
      age INTEGER,
      gender TEXT,
      phone TEXT,
      address TEXT,
      bloodGroup TEXT,
      emergencyContact TEXT,
      emergencyPhone TEXT,
      insuranceId TEXT,
      medicalHistory TEXT,
      allergies TEXT,
      chronicConditions TEXT,
      patientType TEXT,
      opdIpd TEXT,
      department TEXT,
      doctorId INTEGER,
      reason TEXT,
      status TEXT,
      registeredAt TEXT,
      appointmentDate TEXT,
      vitals TEXT,
      prescription TEXT,
      diagnosis TEXT,
      pharmacyState TEXT,
      history TEXT,
      cost REAL DEFAULT 0,
      reports TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id)
    )
  `;

  // Vitals tracking table with hospital isolation
  const vitalsTable = `
    CREATE TABLE IF NOT EXISTS vitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      patientId INTEGER,
      bloodPressure TEXT,
      temperature REAL,
      pulse INTEGER,
      oxygenSaturation INTEGER,
      weight REAL,
      height REAL,
      recordedAt TEXT,
      recordedBy TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id),
      FOREIGN KEY (patientId) REFERENCES patients(id)
    )
  `;

  // Lab tests table with hospital isolation
  const labTestsTable = `
    CREATE TABLE IF NOT EXISTS lab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      patientId INTEGER,
      testName TEXT,
      testType TEXT,
      orderedBy TEXT,
      orderedAt TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      resultDate TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id),
      FOREIGN KEY (patientId) REFERENCES patients(id)
    )
  `;

  // Pharmacy inventory table with hospital isolation
  const inventoryTable = `
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      medicationName TEXT,
      batchNumber TEXT,
      quantity INTEGER,
      unitPrice REAL,
      expiryDate TEXT,
      manufacturer TEXT,
      category TEXT,
      addedAt TEXT,
      lastUpdated TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id)
    )
  `;

  // Appointments table with hospital isolation
  const appointmentsTable = `
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      patientId INTEGER,
      patientName TEXT,
      phone TEXT,
      department TEXT,
      doctorId INTEGER,
      appointmentDate TEXT,
      appointmentTime TEXT,
      status TEXT DEFAULT 'scheduled',
      notes TEXT,
      createdAt TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id),
      FOREIGN KEY (patientId) REFERENCES patients(id)
    )
  `;

  // Lab Results table (detailed parameters)
  const labResultsTable = `
    CREATE TABLE IF NOT EXISTS lab_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      testId INTEGER NOT NULL,
      parameterName TEXT NOT NULL,
      value TEXT,
      unit TEXT,
      referenceRange TEXT,
      isAbnormal INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (testId) REFERENCES lab_tests(id)
    )
  `;

  // Lab Inventory table
  const labInventoryTable = `
    CREATE TABLE IF NOT EXISTS lab_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      itemName TEXT NOT NULL,
      batchNumber TEXT,
      quantity INTEGER DEFAULT 0,
      unit TEXT,
      expiryDate TEXT,
      minLevel INTEGER DEFAULT 10,
      status TEXT DEFAULT 'ok',
      addedAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id)
    )
  `;

  // Lab Test Types (Templates)
  const labTestTypesTable = `
    CREATE TABLE IF NOT EXISTS lab_test_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      parameters TEXT, -- JSON defining fields and ranges
      price REAL DEFAULT 0,
      turnaroundTime INTEGER, -- in hours
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id)
    )
  `;

  // Create all tables
  db.run(hospitalsTable, (err) => {
    if (err) console.error('Error creating hospitals table:', err.message);
    else console.log('Hospitals table ready.');
  });

  db.run(usersTable, (err) => {
    if (err) console.error('Error creating users table:', err.message);
    else console.log('Users table ready.');
  });

  db.run(patientsTable, (err) => {
    if (err) {
      console.error('Error creating patients table:', err.message);
    } else {
      console.log('Patients table ready.');

      // Add hospitalId column to existing patients table if it doesn't exist
      db.run(`ALTER TABLE patients ADD COLUMN hospitalId INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding hospitalId column:', err.message);
        } else if (!err) {
          console.log('hospitalId column added to patients.');
        }
      });

      // Add other new columns
      const newColumns = [
        'bloodGroup TEXT',
        'emergencyContact TEXT',
        'emergencyPhone TEXT',
        'insuranceId TEXT',
        'medicalHistory TEXT',
        'allergies TEXT',
        'chronicConditions TEXT',
        'appointmentDate TEXT',
        'diagnosis TEXT',
        'reports TEXT'
      ];

      newColumns.forEach(column => {
        const columnName = column.split(' ')[0];
        db.run(`ALTER TABLE patients ADD COLUMN ${column}`, (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error(`Error adding ${columnName} column:`, err.message);
          }
        });
      });
    }
  });

  db.run(vitalsTable, (err) => {
    if (err) console.error('Error creating vitals table:', err.message);
    else console.log('Vitals table ready.');
  });

  db.run(labTestsTable, (err) => {
    if (err) {
      console.error('Error creating lab_tests table:', err.message);
    } else {
      console.log('Lab tests table ready.');

      // Add new columns to lab_tests
      const newLabColumns = [
        'hospitalId INTEGER',
        'priority TEXT DEFAULT "normal"',
        'sampleStatus TEXT DEFAULT "pending"',
        'technicianId INTEGER',
        'machineId TEXT',
        'sampleCollectedAt TEXT',
        'sampleCollectedBy TEXT',
        'rejectionReason TEXT',
        'startedAt TEXT',
        'completedAt TEXT'
      ];

      newLabColumns.forEach(column => {
        const columnName = column.split(' ')[0];
        db.run(`ALTER TABLE lab_tests ADD COLUMN ${column}`, (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error(`Error adding ${columnName} column to lab_tests:`, err.message);
          }
        });
      });
    }
  });

  db.run(labResultsTable, (err) => {
    if (err) console.error('Error creating lab_results table:', err.message);
    else console.log('Lab results table ready.');
  });

  db.run(labInventoryTable, (err) => {
    if (err) console.error('Error creating lab_inventory table:', err.message);
    else console.log('Lab inventory table ready.');
  });

  db.run(labTestTypesTable, (err) => {
    if (err) console.error('Error creating lab_test_types table:', err.message);
    else console.log('Lab test types table ready.');
  });

  // Prescription Templates table
  const prescriptionTemplatesTable = `
    CREATE TABLE IF NOT EXISTS prescription_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospitalId INTEGER NOT NULL,
      templateName TEXT DEFAULT 'Default Template',
      hospitalName TEXT,
      hospitalAddress TEXT,
      hospitalPhone TEXT,
      hospitalEmail TEXT,
      hospitalLogo TEXT,
      doctorNamePosition TEXT DEFAULT 'top-left',
      headerText TEXT,
      footerText TEXT,
      showQRCode INTEGER DEFAULT 1,
      showWatermark INTEGER DEFAULT 0,
      watermarkText TEXT,
      fontSize INTEGER DEFAULT 12,
      fontFamily TEXT DEFAULT 'Helvetica',
      primaryColor TEXT DEFAULT '#0EA5E9',
      secondaryColor TEXT DEFAULT '#666666',
      paperSize TEXT DEFAULT 'A4',
      marginTop INTEGER DEFAULT 50,
      marginBottom INTEGER DEFAULT 50,
      marginLeft INTEGER DEFAULT 50,
      marginRight INTEGER DEFAULT 50,
      showLetterhead INTEGER DEFAULT 1,
      createdAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (hospitalId) REFERENCES hospitals(id),
      UNIQUE(hospitalId)
    )
  `;

  db.run(inventoryTable, (err) => {
    if (err) console.error('Error creating inventory table:', err.message);
    else console.log('Inventory table ready.');
  });

  db.run(appointmentsTable, (err) => {
    if (err) console.error('Error creating appointments table:', err.message);
    else console.log('Appointments table ready.');
  });

  db.run(prescriptionTemplatesTable, (err) => {
    if (err) console.error('Error creating prescription_templates table:', err.message);
    else console.log('Prescription templates table ready.');
  });
}

module.exports = db;
