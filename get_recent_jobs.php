<?php
header('Content-Type: application/json');
require '../config/db.php';

$sql = "SELECT t.task_id, t.title, t.budget, t.location, 
               DATE_FORMAT(t.created_at, '%M %d, %Y') AS date,
               (SELECT COUNT(*) FROM task_bids b WHERE b.task_id = t.task_id) AS bids
        FROM tasks t
        WHERE t.status = 'Pending'
        ORDER BY t.created_at DESC
        LIMIT 5";

$stmt = $pdo->query($sql);
$jobs = $stmt->fetchAll();

echo json_encode($jobs);
