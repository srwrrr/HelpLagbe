<?php
session_start();

require_once 'db.php';  // <- This includes your PDO $pdo connection

// Check if form submitted
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['admin-username'] ?? '';
    $password = $_POST['admin-password'] ?? '';

    if (!$username || !$password) {
        $error = "Please enter both username and password.";
    } else {
        // Fetch user with matching username and admin_id not null (means admin)
        $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? AND admin_id IS NOT NULL LIMIT 1");
        $stmt->execute([$username]);
        $admin = $stmt->fetch();

        if ($admin) {
            // Verify password hash
            if (password_verify($password, $admin['password'])) {
                // Password matches - login successful
                $_SESSION['admin_id'] = $admin['admin_id'];
                $_SESSION['username'] = $admin['username'];
                // Redirect to admin dashboard or admin panel page
                header("Location: admindash.php");
                exit();
            } else {
                $error = "Invalid username or password.";
            }
        } else {
            $error = "Invalid username or password.";
        }
    }
}
?>