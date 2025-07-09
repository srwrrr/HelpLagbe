<?php
session_start();
require '../config/db.php';

if (!isset($_SESSION['user_id'])) {
  http_response_code(403);
  echo json_encode(['error' => 'Not authenticated']);
  exit;
}

$data = json_decode(file_get_contents("php://input"), true);

$stmt = $pdo->prepare("INSERT INTO tasks (user_id, category, description, budget, location, preferred_date)
VALUES (?, ?, ?, ?, ?, ?)");

$stmt->execute([
  $_SESSION['user_id'],
  $data['category'],
  $data['description'],
  $data['budget'],
  $data['location'],
  $data['date']
]);

echo json_encode(['success' => true]);
?>
