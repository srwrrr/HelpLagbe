<?php
session_start();
require '../config/db.php';

if (!isset($_SESSION['user_id'])) {
  http_response_code(403);
  echo json_encode(['error' => 'Not authenticated']);
  exit;
}

// Static for now, update later with real transactions
echo json_encode(['balance' => 1500]);
?>
