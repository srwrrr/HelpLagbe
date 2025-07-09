<?php
session_start();
require_once 'db.php'; // Update path if needed

header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
  echo json_encode(['error' => 'Not logged in']);
  exit;
}

$userId = $_SESSION['user_id'];

$sql = "SELECT name, email, phone, address FROM users WHERE id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('i', $userId);
$stmt->execute();
$result = $stmt->get_result();

if ($result && $result->num_rows > 0) {
  $user = $result->fetch_assoc();
  echo json_encode($user);
} else {
  echo json_encode(['error' => 'User not found']);
}

$stmt->close();
$conn->close();
?>