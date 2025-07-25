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
} catch (PDOException $e) {
  http_response_code(500);
  echo json_encode(['status' => 'error', 'message' => 'Database connection failed']);
  exit;
}

// Get and decode JSON input
$data = json_decode(file_get_contents("php://input"), true);

if (!$data || !isset($data['category'], $data['description'], $data['budget'], $data['location'], $data['date'])) {
  echo json_encode(['status' => 'error', 'message' => 'Invalid input data']);
  exit;
}

// Dummy user_id (for now)
$user_id = 1; // You should replace this with session/token user ID

$category = htmlspecialchars($data['category']);
$description = htmlspecialchars($data['description']);
$budget = floatval($data['budget']);
$location = htmlspecialchars($data['location']);
$date_posted = $data['date']; // should be in YYYY-MM-DD

try {
  $stmt = $pdo->prepare("INSERT INTO tasks (user_id, category, description, budget, location, date_posted) VALUES (?, ?, ?, ?, ?, ?)");
  $stmt->execute([$user_id, $category, $description, $budget, $location, $date_posted]);

  echo json_encode(['status' => 'success', 'message' => 'Task posted successfully']);
} catch (Exception $e) {
  echo json_encode(['status' => 'error', 'message' => 'Failed to post task']);
}
