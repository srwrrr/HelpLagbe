<?php
session_start();
require '../config/db.php';

if (!isset($_SESSION['user_id'])) {
  http_response_code(403);
  echo json_encode(['error' => 'Not authenticated']);
  exit;
}

$stmt1 = $pdo->prepare("SELECT * FROM tasks WHERE user_id = ?");
$stmt1->execute([$_SESSION['user_id']]);
$posted = $stmt1->fetchAll();

$stmt2 = $pdo->prepare("SELECT t.*, u.name AS technician 
  FROM accepted_tasks at 
  JOIN tasks t ON t.id = at.task_id 
  JOIN users u ON at.technician_id = u.id 
  WHERE t.user_id = ?");
$stmt2->execute([$_SESSION['user_id']]);
$accepted = $stmt2->fetchAll();

echo json_encode([
  'posted' => $posted,
  'accepted' => $accepted
]);
?>
