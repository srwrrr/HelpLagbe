<?php
session_start();
header('Content-Type: application/json');
require_once 'config/db.php'; // adjust if needed

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  echo json_encode(['status' => 'error', 'message' => 'Invalid request']);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);

$user_id = $_SESSION['user_id'] ?? null;

if (!$user_id) {
  echo json_encode(['status' => 'error', 'message' => 'You must be logged in to post a job.']);
  exit;
}

$category = trim($input['category']);
$description = trim($input['description']);
$budget = (int) $input['budget'];
$location = trim($input['location']);
$date = $input['date'];

$sql = "INSERT INTO tasks (user_id, category, description, budget, location, date_posted) VALUES (?, ?, ?, ?, ?, ?)";
$stmt = $conn->prepare($sql);
$stmt->bind_param("ississ", $user_id, $category, $description, $budget, $location, $date);

if ($stmt->execute()) {
  echo json_encode(['status' => 'success', 'message' => 'Job posted successfully!']);
} else {
  echo json_encode(['status' => 'error', 'message' => 'Failed to post job.']);
}
