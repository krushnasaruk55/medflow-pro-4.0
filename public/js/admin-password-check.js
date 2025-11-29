// Super Admin Password Protection
// Add this script to super-admin.html before the closing </body> tag

const ADMIN_PASSWORD = 'SuperAdmin@2025'; // Change this password

function checkPassword() {
    const input = document.getElementById('adminPassword').value;
    const errorMsg = document.getElementById('errorMsg');

    if (input === ADMIN_PASSWORD) {
        document.getElementById('passwordModal').style.display = 'none';
        document.getElementById('adminContent').style.display = 'block';
        loadData(); // Load admin data
    } else {
        errorMsg.textContent = '❌ Incorrect password';
        errorMsg.style.display = 'block';
        document.getElementById('adminPassword').value = '';
        document.getElementById('adminPassword').focus();
    }
}

// Auto-focus password field on load
document.getElementById('adminPassword').focus();
