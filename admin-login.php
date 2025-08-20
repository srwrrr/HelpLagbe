<?php
session_start();

require_once 'db.php';  // <- This includes your PDO $pdo connection

// Function to create default admin user if it doesn't exist
function createDefaultAdmin($pdo) {
    try {
        // Check if default admin already exists
        $stmt = $pdo->prepare("SELECT * FROM users WHERE username = 'admin' AND admin_id IS NOT NULL LIMIT 1");
        $stmt->execute();
        $existingAdmin = $stmt->fetch();
        
        if (!$existingAdmin) {
            // First, create an entry in the admin table
            $stmt = $pdo->prepare("INSERT INTO admin (created_at) VALUES (NOW())");
            $stmt->execute();
            $adminTableId = $pdo->lastInsertId();
            
            // Create default admin user
            $defaultUsername = 'admin';
            $defaultPassword = 'admin123';
            $hashedPassword = password_hash($defaultPassword, PASSWORD_DEFAULT);
            
            // Insert default admin user with proper column names from your database
            $stmt = $pdo->prepare("INSERT INTO users (username, email, phone_no, password, admin_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())");
            $stmt->execute([
                $defaultUsername,
                'admin@helplagbe.com',
                '+880-1325-409985',
                $hashedPassword,
                $adminTableId
            ]);
            
            return true; // Admin created successfully
        }
        
        return false; // Admin already exists
    } catch (PDOException $e) {
        error_log("Error creating default admin: " . $e->getMessage());
        return false;
    }
}

// Create default admin if it doesn't exist
createDefaultAdmin($pdo);

$error = '';
$success = false;

// Check if form submitted
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['admin-username'] ?? '');
    $password = trim($_POST['admin-password'] ?? '');

    if (!$username || !$password) {
        $error = "Please enter both username and password.";
    } else {
        try {
            // Fetch user with matching username and admin_id not null (means admin)
            $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? AND admin_id IS NOT NULL LIMIT 1");
            $stmt->execute([$username]);
            $admin = $stmt->fetch();

            if ($admin) {
                // Verify password hash
                if (password_verify($password, $admin['password'])) {
                    // Password matches - login successful
                    $_SESSION['admin_id'] = $admin['admin_id'];
                    $_SESSION['user_id'] = $admin['user_id'];
                    $_SESSION['admin_username'] = $admin['username'];
                    $_SESSION['admin_email'] = $admin['email'];
                    $_SESSION['admin_logged_in'] = true;
                    
                    // Log admin login in admin_dashboard table (optional)
                    try {
                        $stmt = $pdo->prepare("INSERT INTO admin_dashboard (admin_id, user_id, Type, action, description, created_at) VALUES (?, ?, ?, ?, ?, NOW())");
                        $stmt->execute([
                            $admin['admin_id'],
                            $admin['user_id'],
                            'Authentication',
                            'Admin Login',
                            'Admin user logged into the system'
                        ]);
                    } catch (PDOException $e) {
                        // Log error but don't fail login
                        error_log("Error logging admin login: " . $e->getMessage());
                    }
                    
                    // Redirect to admin dashboard
                    header("Location: admindash.php");
                    exit();
                } else {
                    $error = "Invalid username or password.";
                }
            } else {
                $error = "Invalid username or password.";
            }
        } catch (PDOException $e) {
            error_log("Database error during admin login: " . $e->getMessage());
            $error = "An error occurred. Please try again.";
        }
    }
}

// If we reach here, either it's a GET request or login failed
// Include the frontend
include 'admin-login-frontend.php';
?>