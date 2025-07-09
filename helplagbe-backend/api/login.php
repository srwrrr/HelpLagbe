<?php
session_start();
require '../config/db.php';

$data = json_decode(file_get_contents("php://input"), true);
$email = $data['email'] ?? '';
$password = $data['password'] ?? '';

$stmt = $pdo->prepare("SELECT * FROM users WHERE email = ?");
$stmt->execute([$email]);
$user = $stmt->fetch();

if ($user && password_verify($password, $user['password'])) {
  $_SESSION['user_id'] = $user['id'];
  echo json_encode(['success' => true, 'user' => $user]);
} else {
  http_response_code(401);
  echo json_encode(['success' => false, 'message' => 'Invalid credentials']);
}
?>
