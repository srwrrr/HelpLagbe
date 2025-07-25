<?php
header("Content-Type: application/json");

$host = 'localhost';
$db = 'helplagbe';
$user = 'root';
$pass = '';
$dsn = "mysql:host=$host;dbname=$db;charset=utf8mb4";

try {
    $pdo = new PDO($dsn, $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'DB failed']);
    exit;
}

$data = json_decode(file_get_contents("php://input"), true);

if (!isset($data['bid_id'], $data['status']) || !in_array($data['status'], ['accepted', 'declined'])) {
    echo json_encode(['status' => 'error', 'message' => 'Invalid data']);
    exit;
}

$bid_id = intval($data['bid_id']);
$status = $data['status'];

try {
    $stmt = $pdo->prepare("UPDATE bids SET status = ? WHERE id = ?");
    $stmt->execute([$status, $bid_id]);

    echo json_encode(['status' => 'success', 'message' => "Bid $status"]);
} catch (Exception $e) {
    echo json_encode(['status' => 'error', 'message' => 'Update failed']);
}
