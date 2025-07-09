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
    $name = $_POST['c-name'];
    $email = $_POST['c-email'];
    $phone = $_POST['c-phone'];
    $address = $_POST['c-address'];
    $password = $_POST['c-password'];

    $stmt = $conn->prepare("INSERT INTO customers (name, email, phone, address, password) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$name, $email, $phone, $address, password_hash($password, PASSWORD_BCRYPT)]);
    respond('success', 'Customer registered successfully.');

} elseif ($role === 'technician') {
    $name = $_POST['t-name'];
    $email = $_POST['t-email'];
    $phone = $_POST['t-phone'];
    $skills = $_POST['t-skills'];
    $address = $_POST['t-address'];
    $password = $_POST['t-password'];

    // Upload file
    $imagePath = '';
    if (isset($_FILES['t-image']) && $_FILES['t-image']['error'] === UPLOAD_ERR_OK) {
        $uploadDir = 'uploads/';
        $imageName = time() . '_' . basename($_FILES['t-image']['name']);
        $targetPath = $uploadDir . $imageName;
        if (!is_dir($uploadDir)) mkdir($uploadDir);
        move_uploaded_file($_FILES['t-image']['tmp_name'], $targetPath);
        $imagePath = $targetPath;
    }

    $stmt = $conn->prepare("INSERT INTO technicians (name, email, phone, skills, address, image, password) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$name, $email, $phone, $skills, $address, $imagePath, password_hash($password, PASSWORD_BCRYPT)]);
    respond('success', 'Technician registered successfully.');

} elseif ($role === 'admin') {
    $username = $_POST['a-username'];
    $email = $_POST['a-email'];
    $password = $_POST['a-password'];

    $stmt = $conn->prepare("INSERT INTO admins (username, email, password) VALUES (?, ?, ?)");
    $stmt->execute([$username, $email, password_hash($password, PASSWORD_BCRYPT)]);
    respond('success', 'Admin registered successfully.');

} else {
    respond('error', 'Invalid role selected');
}
