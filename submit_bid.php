<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
    exit;
}

// DB connection
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
    echo json_encode(['status' => 'error', 'message' => 'Database connection failed']);
    exit;
}

// 🔍 Decode JSON input
$data = json_decode(file_get_contents("php://input"), true);

// 🛑 Validate input
if (!$data || !isset($data['technician_id'], $data['task_id'], $data['amount'])) {
    echo json_encode(['status' => 'error', 'message' => 'Invalid input']);
    exit;
}

// ✅ Extract and sanitize data
$technician_id = intval($data['technician_id']);
$task_id = intval($data['task_id']);
$amount = floatval($data['amount']);
$message = htmlspecialchars($data['message'] ?? '');

try {
    $stmt = $pdo->prepare("INSERT INTO bids (technician_id, task_id, amount, message) VALUES (?, ?, ?, ?)");
    $stmt->execute([$technician_id, $task_id, $amount, $message]);

    echo json_encode(['status' => 'success', 'message' => 'Bid submitted successfully']);
} catch (Exception $e) {
    echo json_encode(['status' => 'error', 'message' => 'Failed to submit bid']);
}
?>
