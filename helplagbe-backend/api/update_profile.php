<?php
session_start();
require '../config/db.php';

if (!isset($_SESSION['user_id'])) {
  http_response_code(403);
  echo json_encode(['error' => 'Not authenticated']);
  exit;
}

$data = json_decode(file_get_contents("php://input"), true);

$stmt = $pdo->prepare("UPDATE users SET name = ?, email = ?, phone = ?, address = ? WHERE id = ?");
$stmt->execute([
  $data['name'], $data['email'], $data['phone'], $data['address'], $_SESSION['user_id']
]);

echo json_encode(['success' => true]);
?>
