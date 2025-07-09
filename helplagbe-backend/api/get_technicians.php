<?php
header('Content-Type: application/json');
require '../config/db.php';

$sql = "SELECT tech.technician_id, tech.full_name, tech.skills,
               COALESCE(AVG(r.rating), 0) AS avg_rating,
               COUNT(r.review_id) AS jobs_completed
        FROM technicians tech
        LEFT JOIN reviews r ON tech.technician_id = r.technician_id
        GROUP BY tech.technician_id
        ORDER BY jobs_completed DESC
        LIMIT 5";

$stmt = $pdo->query($sql);
$techs = $stmt->fetchAll();

echo json_encode($techs);
