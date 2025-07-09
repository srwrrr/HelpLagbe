<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);
header('Content-Type: application/json');

require_once 'db.php';

function respond($status, $message) {
    echo json_encode(['status' => $status, 'message' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond('error', 'Invalid request method');
}

$role = $_POST['role'] ?? '';

if ($role === 'customer') {
    $name = $_POST['c-name'] ?? '';
    $email = $_POST['c-email'] ?? '';
    $phone = $_POST['c-phone'] ?? '';
    $address = $_POST['c-address'] ?? '';
    $password = $_POST['c-password'] ?? '';

    // Insert into users table
    $stmt = $conn->prepare("INSERT INTO users (user_type, name, email, phone, address, password) VALUES (?, ?, ?, ?, ?, ?)");
    $hashedPassword = password_hash($password, PASSWORD_BCRYPT);
    if ($stmt->execute(['customer', $name, $email, $phone, $address, $hashedPassword])) {
        respond('success', 'Customer registered successfully.');
    } else {
        respond('error', 'Failed to register customer.');
    }

} elseif ($role === 'technician') {
    $name = $_POST['t-name'] ?? '';
    $email = $_POST['t-email'] ?? '';
    $phone = $_POST['t-phone'] ?? '';
    $skills = $_POST['t-skills'] ?? '';
    $address = $_POST['t-address'] ?? '';
    $password = $_POST['t-password'] ?? '';

    // Upload file
    $imagePath = '';
    if (isset($_FILES['t-image']) && $_FILES['t-image']['error'] === UPLOAD_ERR_OK) {
        $uploadDir = 'uploads/';
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        $imageName = time() . '_' . basename($_FILES['t-image']['name']);
        $targetPath = $uploadDir . $imageName;
        if (move_uploaded_file($_FILES['t-image']['tmp_name'], $targetPath)) {
            $imagePath = $targetPath;
        }
    }

    // Insert into users table first
    $stmtUser = $conn->prepare("INSERT INTO users (user_type, name, email, phone, address, password) VALUES (?, ?, ?, ?, ?, ?)");
    $hashedPassword = password_hash($password, PASSWORD_BCRYPT);
    if ($stmtUser->execute(['technician', $name, $email, $phone, $address, $hashedPassword])) {
        // Get last inserted user id
        $userId = $conn->lastInsertId();

        // Insert into technicians profile table
        $stmtTech = $conn->prepare("INSERT INTO technicians (user_id, skills, image) VALUES (?, ?, ?)");
        if ($stmtTech->execute([$userId, $skills, $imagePath])) {
            respond('success', 'Technician registered successfully.');
        } else {
            // Optionally delete user record if technician profile insert fails
            $conn->prepare("DELETE FROM users WHERE id = ?")->execute([$userId]);
            respond('error', 'Failed to save technician profile.');
        }
    } else {
        respond('error', 'Failed to register technician.');
    }

} elseif ($role === 'admin') {
    $username = $_POST['a-username'] ?? '';
    $email = $_POST['a-email'] ?? '';
    $password = $_POST['a-password'] ?? '';

    // Insert admin with username
    $stmt = $conn->prepare("INSERT INTO users (user_type, username, email, password) VALUES (?, ?, ?, ?)");
    $hashedPassword = password_hash($password, PASSWORD_BCRYPT);
    if ($stmt->execute(['admin', $username, $email, $hashedPassword])) {
        respond('success', 'Admin registered successfully.');
    } else {
        respond('error', 'Failed to register admin.');
    }

} else {
    respond('error', 'Invalid role selected');
}
