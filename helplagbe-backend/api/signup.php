<?php
header('Content-Type: application/json');
require_once '../config/db.php';

function respond($status, $message) {
    echo json_encode(['status' => $status, 'message' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond('error', 'Invalid request method');
}

$role = $_POST['role'] ?? '';
if (!in_array($role, ['customer', 'technician', 'admin'])) {
    respond('error', 'Invalid role selected');
}

try {
    if ($role === 'customer') {
        $full_name = trim($_POST['c-name'] ?? '');
        $email = trim($_POST['c-email'] ?? '');
        $phone = trim($_POST['c-phone'] ?? '');
        $address = trim($_POST['c-address'] ?? '');
        $password = $_POST['c-password'] ?? '';
        $confirm_password = $_POST['c-confirm'] ?? '';

        if (!$full_name || !$email || !$phone || !$address || !$password || !$confirm_password) {
            respond('error', 'Please fill all required fields');
        }
        if ($password !== $confirm_password) {
            respond('error', 'Passwords do not match');
        }

        // Check email uniqueness
        $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            respond('error', 'Email already registered');
        }

        $hashed_password = password_hash($password, PASSWORD_DEFAULT);

        $stmt = $pdo->prepare("INSERT INTO users (full_name, email, phone, address, password, role) VALUES (?, ?, ?, ?, ?, 'customer')");
        $stmt->execute([$full_name, $email, $phone, $address, $hashed_password]);

        respond('success', 'Customer registered successfully');

    } elseif ($role === 'technician') {
        $full_name = trim($_POST['t-name'] ?? '');
        $email = trim($_POST['t-email'] ?? '');
        $phone = trim($_POST['t-phone'] ?? '');
        $skills = trim($_POST['t-skills'] ?? '');
        $address = trim($_POST['t-address'] ?? '');
        $password = $_POST['t-password'] ?? '';
        $confirm_password = $_POST['t-confirm'] ?? '';

        if (!$full_name || !$email || !$phone || !$skills || !$address || !$password || !$confirm_password) {
            respond('error', 'Please fill all required fields');
        }
        if ($password !== $confirm_password) {
            respond('error', 'Passwords do not match');
        }

        // Check email uniqueness
        $stmt = $pdo->prepare("SELECT id FROM technicians WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            respond('error', 'Email already registered');
        }

        // Handle image upload
        if (!isset($_FILES['t-image']) || $_FILES['t-image']['error'] !== UPLOAD_ERR_OK) {
            respond('error', 'Profile image upload failed');
        }

        $imgTmpPath = $_FILES['t-image']['tmp_name'];
        $imgName = basename($_FILES['t-image']['name']);
        $imgExt = strtolower(pathinfo($imgName, PATHINFO_EXTENSION));
        $allowed = ['jpg','jpeg','png','gif'];

        if (!in_array($imgExt, $allowed)) {
            respond('error', 'Invalid image format');
        }

        $newFileName = uniqid('tech_', true) . '.' . $imgExt;
        $uploadDir = '../uploads/technicians/';
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        $destPath = $uploadDir . $newFileName;

        if (!move_uploaded_file($imgTmpPath, $destPath)) {
            respond('error', 'Failed to save uploaded image');
        }

        $hashed_password = password_hash($password, PASSWORD_DEFAULT);

        $stmt = $pdo->prepare("INSERT INTO technicians (full_name, email, phone, skills, address, profile_image, password) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$full_name, $email, $phone, $skills, $address, $newFileName, $hashed_password]);

        respond('success', 'Technician registered successfully');

    } elseif ($role === 'admin') {
        $username = trim($_POST['a-username'] ?? '');
        $email = trim($_POST['a-email'] ?? '');
        $password = $_POST['a-password'] ?? '';
        $confirm_password = $_POST['a-confirm'] ?? '';

        if (!$username || !$email || !$password || !$confirm_password) {
            respond('error', 'Please fill all required fields');
        }
        if ($password !== $confirm_password) {
            respond('error', 'Passwords do not match');
        }

        // Check email uniqueness
        $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            respond('error', 'Email already registered');
        }

        // Check username uniqueness
        $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            respond('error', 'Username already taken');
        }

        $hashed_password = password_hash($password, PASSWORD_DEFAULT);

        $stmt = $pdo->prepare("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'admin')");
        $stmt->execute([$username, $email, $hashed_password]);

        respond('success', 'Admin registered successfully');
    }

} catch (Exception $e) {
    respond('error', 'Server error: ' . $e->getMessage());
}
