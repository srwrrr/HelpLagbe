<?php
session_start();
header('Content-Type: application/json');

require_once 'db.php';

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['message' => 'User not logged in']);
    exit();
}

$user_id = $_SESSION['user_id'];

$stmt = $conn->prepare("SELECT id, category, description, budget, location, preferred_date, status, created_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC");
$stmt->bind_param("i", $user_id);
$stmt->execute();

$result = $stmt->get_result();
$tasks = [];

while ($row = $result->fetch_assoc()) {
    $tasks[] = $row;
}

echo json_encode($tasks);

$stmt->close();
$conn->close();
