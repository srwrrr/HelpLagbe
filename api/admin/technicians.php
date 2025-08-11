<?php
session_start();
include_once '../config/database.php';
include_once '../helpers/functions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    sendResponse(false, null, 'Admin authentication required', 401);
}

$database = new Database();
$db = $database->getConnection();

try {
    $stmt = $db->prepare("SELECT t.technician_id as id, t.Full_Name as name, u.email, u.phone_no as phone, t.Skill_details as skills, t.status, COUNT(tasks.task_id) as completed_tasks, COALESCE(AVG(tf.consumer_rating), 0) as rating FROM technician t JOIN users u ON t.user_id = u.user_id LEFT JOIN tasks ON t.technician_id = tasks.technician_id AND tasks.task_status = 'completed' LEFT JOIN task_feedback tf ON tasks.task_id = tf.task_id GROUP BY t.technician_id ORDER BY t.created_at DESC");
    $stmt->execute();

    $technicians = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($technicians as &$tech) {
        $tech['rating'] = round($tech['rating'], 1);
        $tech['status'] = $tech['status'] === 'approved' ? 'verified' : $tech['status'];
    }

    sendResponse(true, $technicians, 'Technicians retrieved successfully');

} catch(PDOException $exception) {
    error_log("Get admin technicians error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get technicians', 500);
}
