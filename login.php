<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);
header('Content-Type: application/json');

require_once 'db.php';  // Make sure this path is correct and db.php returns $conn (PDO instance)

function respond($status, $message, $data = [])
{
    echo json_encode(array_merge(['status' => $status, 'message' => $message], $data));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond('error', 'Invalid request method');
}

$role = $_POST['role'] ?? '';
$emailOrUsername = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';

if (!$role || !$emailOrUsername || !$password) {
    respond('error', 'Please fill in all fields.');
}

try {
    if ($role === 'customer') {
        // Customers login by email only
        $stmt = $conn->prepare("SELECT * FROM customers WHERE email = ?");
        $stmt->execute([$emailOrUsername]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

    } elseif ($role === 'technician') {
        // Technicians login by email only
        $stmt = $conn->prepare("SELECT * FROM technicians WHERE email = ?");
        $stmt->execute([$emailOrUsername]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

    } elseif ($role === 'admin') {
        // Admin login by username or email
        $stmt = $conn->prepare("SELECT * FROM admins WHERE username = ? OR email = ?");
        $stmt->execute([$emailOrUsername, $emailOrUsername]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

    } else {
        respond('error', 'Invalid role selected');
    }

    if (!$user) {
        respond('error', 'User not found.');
    }

    // Check password: you must have hashed passwords stored
    if (!password_verify($password, $user['password'])) {
        respond('error', 'Incorrect password.');
    }

    // Successful login response, return role and display name
    $displayName = $user['name'] ?? $user['username'] ?? 'User';

    respond('success', 'Login successful. Welcome ' . $displayName, [
        'role' => $role,
        'userName' => $displayName
    ]);

} catch (PDOException $e) {
    respond('error', 'Database error: ' . $e->getMessage());
}
