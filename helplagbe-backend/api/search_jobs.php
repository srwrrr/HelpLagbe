<?php
header('Content-Type: application/json');
require '../config/db.php';

$query = $_GET['q'] ?? '';

$sql = "SELECT task_id, title 
        FROM tasks 
        WHERE title LIKE :q AND status='Pending' 
        LIMIT 10";

$stmt = $pdo->prepare($sql);
$stmt->execute([':q' => "%$query%"]);
echo json_encode($stmt->fetchAll());
