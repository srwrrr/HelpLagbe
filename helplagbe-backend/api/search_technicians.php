<?php
header('Content-Type: application/json');
require '../config/db.php';

$query = $_GET['q'] ?? '';

$sql = "SELECT technician_id, full_name, skills 
        FROM technicians 
        WHERE full_name LIKE :q OR skills LIKE :q
        LIMIT 10";

$stmt = $pdo->prepare($sql);
$stmt->execute([':q' => "%$query%"]);
echo json_encode($stmt->fetchAll());
