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
    $stmt = $db->prepare("SELECT t.task_id as id, u_customer.username as customer_name, tech.Full_Name as technician_name, p.Category as category, t.price, t.task_status as status, t.created_at FROM tasks t JOIN posts p ON t.post_id = p.post_id JOIN users u_customer ON p.user_id = u_customer.user_id JOIN technician tech ON t.technician_id = tech.technician_id ORDER BY t.created_at DESC");
    $stmt->execute();

    $tasks = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $tasks, 'Tasks retrieved successfully');

} catch(PDOException $exception) {
    error_log("Get admin tasks error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get tasks', 500);
}
