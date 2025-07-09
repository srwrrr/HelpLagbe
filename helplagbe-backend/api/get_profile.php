<?php
session_start();
require '../config/db.php';

if (!isset($_SESSION['user_id'])) {
  http_response_code(403);
  echo json_encode(['error' => 'Not authenticated']);
  exit;
}

$stmt = $pdo->prepare("SELECT name, email, phone, address FROM users WHERE id = ?");
$stmt->execute([$_SESSION['user_id']]);
$user = $stmt->fetch();

echo json_encode($user);
?>
